import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { getPool } from "../src/lib/db";
import { ensureDatabaseReady } from "../src/lib/taskboard-store";
import { getPublicTaskWorkspace, manageTaskShare, TaskShareConflict } from "../src/lib/public-task-share-store";
import { isLocalVisualDatabase } from "./helpers/visual-database";
import type { TaskboardUserIdentity } from "../src/lib/taskboard-request";

test("durable share URLs, isolation, stale writers, legacy links and key failures", { skip: process.env.TASKBOARD_PUBLIC_SHARE_DB_TEST !== "1", timeout: 120_000 }, async t => {
  assert.ok(isLocalVisualDatabase(new URL(process.env.DATABASE_URL!)));
  await ensureDatabaseReady();
  const pool = getPool()!;
  const ownerId = randomUUID(), otherId = randomUUID(), board = randomUUID(), root = randomUUID();
  const owner: TaskboardUserIdentity = { id: ownerId, email: `${ownerId}@example.invalid`, displayName: "Share publisher", authMode: "password", role: "standard" };
  const key = process.env.TASKBOARD_SHARE_LINK_SECRET;
  const token = (url: string) => url.split("/").at(-1)!;
  try {
    await pool.query("INSERT INTO users(id,email,display_name,role) VALUES($1,$2,'Publisher','standard'),($3,$4,'Outsider','standard')", [ownerId, owner.email, otherId, `${otherId}@example.invalid`]);
    await pool.query("INSERT INTO boards(id,title,owner_user_id,board_type) VALUES($1,'Share recovery tests',$2,'personal')", [board, ownerId]);
    await pool.query("INSERT INTO tasks(id,board_id,title,status,sort_order) VALUES($1,$2,'Published test','todo',1000)", [root, board]);
    let current = await manageTaskShare(owner, root, "create", "UTC", { mode: "view", expectedShareId: null });
    const firstUrl = current.url!;
    await t.test("authorized status retrieves the same URL without rotation and never exposes it to an outsider", async () => {
      const a = await manageTaskShare(owner, root, "status"), b = await manageTaskShare(owner, root, "status");
      assert.equal(a.links?.view.url, firstUrl); assert.equal(b.links?.view.id, a.links?.view.id);
      const denied = await manageTaskShare({ ...owner, id: otherId }, root, "status");
      assert.equal(denied.allowed, false); assert.equal(denied.links, undefined);
      const row = (await pool.query("SELECT token_hash,token_ciphertext FROM task_public_shares WHERE id=$1", [a.links!.view.id])).rows[0];
      assert.ok(row.token_ciphertext && !row.token_ciphertext.includes(token(firstUrl)) && !row.token_hash.includes(token(firstUrl)));
    });
    await t.test("concurrent replacement has one winner, with the loser preserving its link", async () => {
      const id = current.links!.view.id;
      const results = await Promise.allSettled([manageTaskShare(owner, root, "replace", "UTC", { expectedShareId: id }), manageTaskShare(owner, root, "replace", "UTC", { expectedShareId: id })]);
      assert.equal(results.filter(r => r.status === "fulfilled").length, 1);
      assert.ok(results.some(r => r.status === "rejected" && r.reason instanceof TaskShareConflict));
      current = await manageTaskShare(owner, root, "status");
      assert.notEqual(current.links!.view.url, firstUrl);
      await assert.rejects(getPublicTaskWorkspace(token(firstUrl), "http://localhost"));
      assert.equal((await getPublicTaskWorkspace(token(current.links!.view.url!), "http://localhost")).task.id, root);
    });
    await t.test("expiry preserves URL and expired links can be extended without rotation", async () => {
      const link = current.links!.view, until = new Date(Date.now() + 3600000).toISOString();
      current = await manageTaskShare(owner, root, "update", "UTC", { expectedShareId: link.id, expiresAt: until });
      assert.equal(current.links!.view.url, link.url);
      await pool.query("UPDATE task_public_shares SET expires_at=NOW()-interval '1 second' WHERE id=$1", [link.id]);
      assert.equal((await manageTaskShare(owner, root, "status")).links!.view.expired, true);
      current = await manageTaskShare(owner, root, "update", "UTC", { expectedShareId: link.id, expiresAt: until });
      assert.equal(current.links!.view.active, true); assert.equal(current.links!.view.url, link.url);
    });
    await t.test("missing key never revokes the currently working URL", async () => {
      const link = current.links!.view;
      delete process.env.TASKBOARD_SHARE_LINK_SECRET;
      await assert.rejects(manageTaskShare(owner, root, "replace", "UTC", { expectedShareId: link.id }), /not configured/);
      assert.equal((await getPublicTaskWorkspace(token(link.url!), "http://localhost")).task.id, root);
      const status = await manageTaskShare(owner, root, "status");
      assert.equal(status.canGenerateLinks, false); assert.equal(status.links!.view.retrieval, "unavailable");
      assert.equal(status.links!.view.url, undefined);
      process.env.TASKBOARD_SHARE_LINK_SECRET = key;
    });
    await t.test("hash-only legacy links work until explicitly replaced", async () => {
      const link = current.links!.view;
      await pool.query("UPDATE task_public_shares SET token_ciphertext=NULL WHERE id=$1", [link.id]);
      const legacy = await manageTaskShare(owner, root, "status");
      assert.equal(legacy.links!.view.retrieval, "legacy"); assert.equal(legacy.links!.view.url, undefined);
      assert.equal((await getPublicTaskWorkspace(token(link.url!), "http://localhost")).task.id, root);
      current = await manageTaskShare(owner, root, "replace", "UTC", { expectedShareId: link.id });
      assert.ok(current.links!.view.url); await assert.rejects(getPublicTaskWorkspace(token(link.url!), "http://localhost"));
    });
    await t.test("view/edit remain independent and revoked tokens are not decrypted", async () => {
      const edit = await manageTaskShare(owner, root, "create", "UTC", { mode: "edit_work", expectedShareId: null });
      const view = current.links!.view;
      await manageTaskShare(owner, root, "disable", "UTC", { expectedShareId: view.id });
      const disabled = await manageTaskShare(owner, root, "status");
      assert.equal(disabled.links!.view.disabled, true); assert.equal(disabled.links!.view.url, undefined);
      assert.equal(disabled.links!.edit_work.url, edit.url); assert.equal(disabled.links!.edit_work.active, true);
      await assert.rejects(getPublicTaskWorkspace(token(view.url!), "http://localhost"));
      assert.equal((await getPublicTaskWorkspace(token(edit.url!), "http://localhost")).sharing?.mode, "edit_work");
    });
  } finally {
    if (key === undefined) delete process.env.TASKBOARD_SHARE_LINK_SECRET; else process.env.TASKBOARD_SHARE_LINK_SECRET = key;
    await pool.query("DELETE FROM boards WHERE id=$1", [board]);
    await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [[ownerId, otherId]]);
    await pool.end();
  }
});
