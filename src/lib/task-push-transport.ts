import { createECDH, ECDH } from "node:crypto";
import { generateRequestDetails } from "web-push";
import { z } from "zod";

export const subscriptionSchema = z.object({
  endpoint: z.string().max(4096).transform((endpoint, ctx) => {
    let url: URL;
    try {
      url = new URL(endpoint);
    } catch {
      ctx.addIssue({ code: "custom", message: "Invalid push endpoint" });
      return z.NEVER;
    }
    const windows = url.hostname.endsWith(".notify.windows.com") && /^\/w\//.test(url.pathname);
    const providerPath =
      url.hostname.endsWith(".push.apple.com") ? "/" :
      url.hostname === "fcm.googleapis.com" ? "/fcm/send/" :
      url.hostname === "updates.push.services.mozilla.com" ? "/wpush/v2/" :
      windows ? "/w/" : null;
    if (url.protocol !== "https:" || url.port || url.username || url.password ||
        (url.search && (!windows || [...url.searchParams.keys()].some((key) => key !== "token"))) ||
        url.hash || !providerPath ||
        !url.pathname.startsWith(providerPath) || url.pathname.length < providerPath.length + 7) {
      ctx.addIssue({ code: "custom", message: "Unsupported push endpoint" });
      return z.NEVER;
    }
    return url.href;
  }),
  keys: z.object({
    p256dh: z.string().regex(/^[\w-]{87}$/).refine((value) => {
      try {
        const bytes = Buffer.from(value, "base64url");
        return bytes.length === 65 && bytes[0] === 4 &&
          ECDH.convertKey(bytes, "prime256v1").length === 65;
      } catch {
        return false;
      }
    }),
    auth: z.string().regex(/^[\w-]{22}$/),
  }),
});

export async function isPushDatabase(pool: import("pg").Pool) {
  const result = await pool.query<{ id: string }>(
    "SELECT system_identifier::text AS id FROM pg_control_system()",
  );
  return result.rows[0]?.id === process.env.TASKBOARD_WEB_PUSH_CLUSTER_ID;
}

export type PushSubscriptionData = z.infer<typeof subscriptionSchema>;

export function taskPushConfig() {
  if (process.env.TASKBOARD_WEB_PUSH_ENABLED !== "true" || !process.env.DATABASE_URL) return null;
  if (!/^\d{1,20}$/.test(process.env.TASKBOARD_WEB_PUSH_CLUSTER_ID ?? "")) return null;
  const {
    TASKBOARD_WEB_PUSH_PUBLIC_KEY: publicKey,
    TASKBOARD_WEB_PUSH_PRIVATE_KEY: privateKey,
    TASKBOARD_WEB_PUSH_SUBJECT: subject,
  } = process.env;
  if (!publicKey || !privateKey || !/^[A-Za-z0-9_-]{43}$/.test(privateKey) || !subject || !/^(mailto:|https:\/\/)/.test(subject)) return null;
  try {
    const key = createECDH("prime256v1");
    key.setPrivateKey(Buffer.from(privateKey, "base64url"));
    if (key.getPublicKey().toString("base64url") !== publicKey) return null;
  } catch {
    return null;
  }
  return { publicKey, privateKey, subject };
}

type PushPayload = { id: string; boardId: string; taskId: string } | { id: "test" };

export async function sendTaskPush(
  config: NonNullable<ReturnType<typeof taskPushConfig>>,
  subscription: PushSubscriptionData,
  payload: PushPayload,
  ttl: number,
) {
  const target = subscriptionSchema.safeParse(subscription);
  if (!target.success) return 410;

  const request = generateRequestDetails(target.data, JSON.stringify(payload), {
    vapidDetails: config,
    TTL: ttl,
    topic: payload.id.replaceAll("-", ""),
  });
  const response = await fetch(target.data.endpoint, {
    method: "POST",
    headers: request.headers as Record<string, string>,
    body: request.body ? new Uint8Array(request.body) : null,
    redirect: "manual",
    signal: AbortSignal.timeout(5_000),
  });
  await response.body?.cancel();
  return response.status;
}
