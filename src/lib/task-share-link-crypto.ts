import "server-only";
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";

type LinkIdentity = { id: string; taskId: string; mode: string; tokenHash: string };
const aad = (identity: LinkIdentity) => Buffer.from(JSON.stringify(["taskboard-share-url-v1", identity.id, identity.taskId, identity.mode, identity.tokenHash]));
function keyFor(secret: string) {
  if (secret.length < 32) throw new Error("Share link recovery key is not configured.");
  const key = Buffer.from(hkdfSync("sha256", secret, "taskboard-share-links-v1", "url-recovery", 32));
  return { id: createHash("sha256").update(key).digest("hex").slice(0, 16), key };
}
export function shareLinkRecoveryAvailable() { return (process.env.TASKBOARD_SHARE_LINK_SECRET?.length ?? 0) >= 32; }
export function encryptShareToken(token: string, identity: LinkIdentity) {
  const { id, key } = keyFor(process.env.TASKBOARD_SHARE_LINK_SECRET ?? "");
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(aad(identity));
  const ciphertext = Buffer.concat([cipher.update(token, "utf8"), cipher.final()]);
  return `v1.${id}.${Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url")}`;
}
export function recoverShareToken(value: string | null | undefined, identity: LinkIdentity): string | null {
  if (!value) return null;
  try {
    const [version, id, payload, extra] = value.split(".");
    if (version !== "v1" || !id || !payload || extra || !/^[A-Za-z0-9_-]+$/.test(payload)) return null;
    const secrets = [process.env.TASKBOARD_SHARE_LINK_SECRET ?? "", ...(process.env.TASKBOARD_SHARE_LINK_PREVIOUS_SECRETS ?? "").split(",")].filter(secret => secret.length >= 32);
    const selected = secrets.map(keyFor).find(key => key.id === id);
    if (!selected) return null;
    const bytes = Buffer.from(payload, "base64url");
    if (bytes.length !== 71) return null; // 12-byte IV, 16-byte tag, 43-character token.
    const decipher = createDecipheriv("aes-256-gcm", selected.key, bytes.subarray(0, 12));
    decipher.setAAD(aad(identity)); decipher.setAuthTag(bytes.subarray(12, 28));
    const token = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
    return /^[A-Za-z0-9_-]{43}$/.test(token) && createHash("sha256").update(token).digest("hex") === identity.tokenHash ? token : null;
  } catch { return null; }
}
