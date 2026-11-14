import assert from "node:assert/strict";
import test from "node:test";
import { getPool } from "../src/lib/db";
import { createRootTask, createSubtask, updateTask } from "../src/lib/taskboard-store";
import type { TaskboardUserIdentity } from "../src/lib/taskboard-request";

test("persisted completion cascades, rolls up, and serializes sibling clicks", {
  skip: process.env.TASK_COMPLETION_DB_TEST !== "1",
}, async () => {
  const pool = getPool();
  assert.ok(pool);
  const result = await pool.query(`
    SELECT users.id, users.email, users.display_name, users.role, buckets.id AS bucket_id
    FROM users JOIN boards ON boards.owner_user_id = users.id AND boards.board_type = 'personal'
    JOIN buckets ON buckets.board_id = boards.id WHERE users.is_disabled = FALSE
    ORDER BY users.created_at, buckets.sort_order LIMIT 1
  `);
  const actor = result.rows[0];
  assert.ok(actor, "A fixture user and personal board are required.");
  const identity: TaskboardUserIdentity = {
    id: actor.id, email: actor.email, displayName: actor.display_name, role: actor.role,
    authMode: "authelia", authProvider: "authelia", isDisabled: false,
  };
  const ids: string[] = [];
  const addRoot = async () => {
    const id = await createRootTask(identity, { bucketId: actor.bucket_id, title: "Completion regression" });
    assert.ok(id); ids.push(id); return id;
  };
  const addChild = async (parentTaskId: string) => {
    const id = await createSubtask(identity, { parentTaskId, title: "Completion child" });
    assert.ok(id); ids.push(id); return id;
  };
  const read = async () => {
    const rows = await pool.query<{ id: string; status: string; completed_at: Date | null; archived_at: Date | null }>(
      "SELECT id, status, completed_at, archived_at FROM tasks WHERE id = ANY($1::uuid[])", [ids]);
    return new Map(rows.rows.map(row => [row.id, row]));
  };
  try {
    const root = await addRoot(), branch = await addChild(root);
    const a = await addChild(branch), b = await addChild(branch), sibling = await addChild(root);
    await updateTask(identity, branch, { status: "done" });
    let saved = await read();
    for (const id of [branch, a, b]) {
      assert.equal(saved.get(id)?.status, "done");
      assert.ok(saved.get(id)?.completed_at);
    }
    assert.equal(saved.get(root)?.status, "todo");
    await updateTask(identity, sibling, { status: "done" });
    assert.equal((await read()).get(root)?.status, "done");

    await updateTask(identity, a, { status: "todo" });
    saved = await read();
    for (const id of [root, branch, a]) {
      assert.equal(saved.get(id)?.status, "todo");
      assert.equal(saved.get(id)?.completed_at, null);
    }
    for (const id of [b, sibling]) assert.equal(saved.get(id)?.status, "done", "Reopening a child retains siblings.");
    // Full editors resend the unchanged parent status on unrelated edits.
    await updateTask(identity, branch, { title: "Renamed", status: "todo" });
    assert.equal((await read()).get(b)?.status, "done");

    await updateTask(identity, root, { status: "done" });
    await updateTask(identity, root, { status: "todo" });
    saved = await read();
    for (const id of [root, branch, a, b, sibling]) assert.equal(saved.get(id)?.status, "todo");

    await Promise.all([a, b, sibling].map(id => updateTask(identity, id, { status: "done" })));
    saved = await read();
    for (const id of [root, branch, a, b, sibling]) assert.equal(saved.get(id)?.status, "done");

    const recurring = await addRoot();
    const recurringChild = await addChild(recurring);
    await updateTask(identity, recurring, {
      dueAt: "2026-12-01T17:00:00.000Z", recurrence: { frequency: "daily", interval: 1, mode: "on_schedule" },
    });
    await updateTask(identity, recurringChild, { status: "done" });
    const series = await pool.query<{ id: string; status: string; archived_at: Date | null }>(
      "SELECT id, status, archived_at FROM tasks WHERE recurrence_series_id = (SELECT recurrence_series_id FROM tasks WHERE id = $1) AND parent_task_id IS NULL", [recurring]);
    assert.equal(series.rows.length, 2, "Automatic parent completion keeps recurrence working.");
    assert.ok(series.rows.find(row => row.id === recurring)?.archived_at);
    const next = series.rows.find(row => row.id !== recurring)!;
    assert.equal(next.status, "todo");
    ids.push(next.id);
    const nextChildren = await pool.query<{ id: string }>("SELECT id FROM tasks WHERE parent_task_id = $1", [next.id]);
    ids.push(...nextChildren.rows.map(row => row.id));
  } finally {
    await pool.query("DELETE FROM tasks WHERE id = ANY($1::uuid[])", [ids]);
    await pool.end();
  }
});
