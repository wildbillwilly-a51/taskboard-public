import assert from "node:assert/strict";
import test from "node:test";
import { getPool } from "../src/lib/db";
import { createRootTask, createSubtask, moveSubtask, updateTask } from "../src/lib/taskboard-store";
import type { TaskboardUserIdentity } from "../src/lib/taskboard-request";

// New and moved subtasks keep the rule status edits already follow: a parent
// with work under it is done exactly when all of that work is done.
test("adding and moving subtasks keep parent completion in step", {
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
  const addChild = async (parentTaskId: string) => {
    const id = await createSubtask(identity, { parentTaskId, title: "Structure child" });
    assert.ok(id); ids.push(id); return id;
  };
  const status = async () => {
    const rows = await pool.query<{ id: string; status: string; completed_at: Date | null }>(
      "SELECT id, status, completed_at FROM tasks WHERE id = ANY($1::uuid[])", [ids]);
    return new Map(rows.rows.map(row => [row.id, row]));
  };
  try {
    const root = await createRootTask(identity, { bucketId: actor.bucket_id, title: "Structure completion regression" });
    assert.ok(root); ids.push(root);
    const first = await addChild(root), a = await addChild(first);
    const second = await addChild(root), b = await addChild(second);
    await updateTask(identity, root, { status: "done" });
    let saved = await status();
    for (const id of [root, first, a, second, b]) assert.equal(saved.get(id)?.status, "done");

    // New open work under a finished parent reopens it and its ancestors.
    const c = await addChild(first);
    saved = await status();
    for (const id of [c, first, root]) assert.equal(saved.get(id)?.status, "todo");
    assert.equal(saved.get(first)?.completed_at, null);
    for (const id of [a, second, b]) assert.equal(saved.get(id)?.status, "done", "Reopening keeps finished siblings.");

    // Moving the open item: its new parent reopens, its old parent finishes.
    await moveSubtask(identity, { taskId: c, parentTaskId: second, targetIndex: 0 });
    saved = await status();
    assert.equal(saved.get(first)?.status, "done");
    assert.ok(saved.get(first)?.completed_at);
    for (const id of [second, root]) assert.equal(saved.get(id)?.status, "todo");

    // Reordering among the same siblings changes no completion.
    await moveSubtask(identity, { taskId: c, parentTaskId: second, targetIndex: 1 });
    saved = await status();
    assert.equal(saved.get(first)?.status, "done");
    assert.equal(saved.get(second)?.status, "todo");

    // A parent left with no subtasks keeps its own status.
    const lone = await addChild(root), only = await addChild(lone);
    await moveSubtask(identity, { taskId: only, parentTaskId: root, targetIndex: 0 });
    saved = await status();
    assert.equal(saved.get(lone)?.status, "todo", "An emptied parent is not marked done.");

    // Finishing the last open item still rolls all the way up.
    await Promise.all([c, only, lone].map(id => updateTask(identity, id, { status: "done" })));
    saved = await status();
    for (const id of [root, first, second, lone]) assert.equal(saved.get(id)?.status, "done");

    // Structural and status edits in one tree at once apply one at a time.
    await Promise.all([
      addChild(first),
      addChild(second),
      updateTask(identity, b, { status: "todo" }),
      moveSubtask(identity, { taskId: a, parentTaskId: second, targetIndex: 0 }),
    ]);
    saved = await status();
    for (const id of [root, first, second]) assert.equal(saved.get(id)?.status, "todo");
  } finally {
    await pool.query("DELETE FROM tasks WHERE id = ANY($1::uuid[])", [ids]);
    await pool.end();
  }
});
