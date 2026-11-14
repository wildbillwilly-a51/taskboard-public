import assert from "node:assert/strict";
import test from "node:test";
import { createHash, randomBytes } from "node:crypto";
import { encryptShareToken, recoverShareToken, shareLinkRecoveryAvailable } from "../src/lib/task-share-link-crypto";

test("share recovery authenticates identity, resists tampering, and supports dedicated-key rotation", t => {
  const original = process.env.TASKBOARD_SHARE_LINK_SECRET, oldKeys = process.env.TASKBOARD_SHARE_LINK_PREVIOUS_SECRETS, authSecret = process.env.AUTH_SECRET;
  t.after(() => { if (original === undefined) delete process.env.TASKBOARD_SHARE_LINK_SECRET; else process.env.TASKBOARD_SHARE_LINK_SECRET = original; if (oldKeys === undefined) delete process.env.TASKBOARD_SHARE_LINK_PREVIOUS_SECRETS; else process.env.TASKBOARD_SHARE_LINK_PREVIOUS_SECRETS = oldKeys; });
  const key = randomBytes(32).toString("hex"), token = randomBytes(32).toString("base64url");
  const identity = { id: "share-1", taskId: "task-1", mode: "view", tokenHash: createHash("sha256").update(token).digest("hex") };
  process.env.TASKBOARD_SHARE_LINK_SECRET = key;
  const encrypted = encryptShareToken(token, identity);
  assert.ok(!encrypted.includes(token));
  assert.notEqual(encrypted, encryptShareToken(token, identity));
  assert.equal(recoverShareToken(encrypted, identity), token);
  for (const changed of [{ ...identity, id: "share-2" }, { ...identity, taskId: "task-2" }, { ...identity, mode: "edit_work" }, { ...identity, tokenHash: "wrong" }]) assert.equal(recoverShareToken(encrypted, changed), null);
  assert.equal(recoverShareToken(encrypted.slice(0, -3) + "xxx", identity), null);
  assert.equal(recoverShareToken(null, identity), null);
  process.env.TASKBOARD_SHARE_LINK_SECRET = randomBytes(32).toString("hex");
  assert.equal(recoverShareToken(encrypted, identity), null);
  process.env.TASKBOARD_SHARE_LINK_PREVIOUS_SECRETS = key;
  assert.equal(recoverShareToken(encrypted, identity), token);
  delete process.env.TASKBOARD_SHARE_LINK_SECRET;
  assert.equal(shareLinkRecoveryAvailable(), false);
  assert.throws(() => encryptShareToken(token, identity), /not configured/);
  process.env.AUTH_SECRET = "auth-secret-is-not-a-share-recovery-key";
  assert.equal(shareLinkRecoveryAvailable(), false);
  if (authSecret === undefined) delete process.env.AUTH_SECRET; else process.env.AUTH_SECRET = authSecret;
});
