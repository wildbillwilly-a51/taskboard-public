import assert from "node:assert/strict";
import test from "node:test";
import { getPool } from "../src/lib/db";
import { createRootTask, createSubtask, deleteTask, ensureDatabaseReady, moveSubtask, restoreRecycleBinItem, updateTask } from "../src/lib/taskboard-store";
import type { TaskboardUserIdentity } from "../src/lib/taskboard-request";

// A task its work finished reopens with the status it had before, so Undo
// and unticking do not turn an Active or Waiting task into To do. Subtasks
// are only done or not done, so they reopen as To do.
test("a parent finished by its work reopens with its earlier status", {
  skip: process.env.TASK_COMPLETION_DB_TEST !== "1",
}, async () => {
  await ensureDatabaseReady();
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
  const add = async (parentTaskId: string, title: string) => {
    const id = await createSubtask(identity, { parentTaskId, title });
    assert.ok(id); ids.push(id); return id;
  };
  const state = async (id: string) => {
    const row = (await pool.query<{ status: string; reopen_status: string | null }>(
      "SELECT status, reopen_status FROM tasks WHERE id = $1", [id])).rows[0];
    return `${row.status}/${row.reopen_status ?? "-"}`;
  };
  try {
    const root = await createRootTask(identity, { bucketId: actor.bucket_id, title: "Reopen status regression" });
    assert.ok(root); ids.push(root);
    const ops = await add(root, "Ops"), net = await add(root, "Networking");
    const core = await add(ops, "Core"), host = await add(core, "Host"), tools = await add(ops, "Tools");
    const other = await add(net, "Other");
    // Only the task has Active or Waiting; its subtasks are done or not done.
    await updateTask(identity, root, { status: "active" });
    await assert.rejects(updateTask(identity, ops, { status: "active" }), /either done or not done/);

    // Ticking the last open work finishes every parent; the task remembers
    // the status it had.
    await updateTask(identity, tools, { status: "done" });
    await updateTask(identity, host, { status: "done" });
    await updateTask(identity, other, { status: "done" });
    assert.equal(await state(core), "done/todo");
    assert.equal(await state(ops), "done/todo");
    assert.equal(await state(root), "done/active");

    // A save that repeats the current status (an editor autosave) keeps it.
    await updateTask(identity, root, { title: "Reopen status regression renamed", status: "done" });
    assert.equal(await state(root), "done/active");

    // Unticking reopens each finished parent: subtasks as To do, the task as
    // it was.
    await updateTask(identity, host, { status: "todo" });
    assert.equal(await state(core), "todo/-");
    assert.equal(await state(ops), "todo/-");
    assert.equal(await state(root), "active/-");

    // Deleting the branch with the last open work and restoring it does the same.
    await deleteTask(identity, core);
    assert.equal(await state(ops), "done/todo");
    assert.equal(await state(root), "done/active");
    await restoreRecycleBinItem(identity, core);
    assert.equal(await state(ops), "todo/-");
    assert.equal(await state(root), "active/-");

    // Moving the last open work out of a subtask finishes that subtask;
    // moving it back reopens it.
    await updateTask(identity, other, { status: "todo" });
    await updateTask(identity, host, { status: "done" });
    await moveSubtask(identity, { taskId: other, parentTaskId: ops, targetIndex: 2 });
    assert.equal(await state(net), "todo/-", "A subtask left with no work keeps its own state.");
    await moveSubtask(identity, { taskId: other, parentTaskId: net, targetIndex: 0 });
    assert.equal(await state(ops), "done/todo");

    // Changing a finished task's status by hand forgets the earlier one.
    await updateTask(identity, other, { status: "done" });
    assert.equal(await state(root), "done/active");
    await updateTask(identity, root, { status: "waiting" });
    assert.equal(await state(root), "waiting/-");
    await updateTask(identity, root, { status: "done" });
    await updateTask(identity, other, { status: "todo" });
    assert.equal(await state(root), "todo/-", "Done by hand, then reopened by work: no earlier status to bring back.");
  } finally {
    if (ids.length) await pool.query("DELETE FROM tasks WHERE id = ANY($1::uuid[])", [ids]);
  }
});
