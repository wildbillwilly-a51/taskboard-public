import assert from "node:assert/strict";
import test from "node:test";
import { getPool } from "../src/lib/db";
import { createRootTask, moveRootTaskInTransaction, updateTaskInTransaction } from "../src/lib/taskboard-store";
import type { TaskboardUserIdentity } from "../src/lib/taskboard-request";

// A board move locks its buckets and then the task. A save that changes the
// same task's bucket used to lock the task and then wait for the new bucket,
// so the two deadlocked. This drives that exact interleaving: the move holds
// its bucket locks while the save starts, then finishes while the save waits.
test("a bucket-changing save waits behind a concurrent move instead of deadlocking", {
  skip: process.env.TASK_MOVE_LOCK_DB_TEST !== "1",
}, async () => {
  const pool = getPool();
  assert.ok(pool);
  const fixture = await pool.query<{
    id: string; email: string; display_name: string; role: "admin" | "standard";
    board_id: string; owner_user_id: string; bucket_ids: string[];
  }>(`
    SELECT users.id, users.email, users.display_name, users.role, boards.id AS board_id, boards.owner_user_id,
      ARRAY(SELECT buckets.id::text FROM buckets WHERE buckets.board_id = boards.id ORDER BY buckets.sort_order LIMIT 2) AS bucket_ids
    FROM users JOIN boards ON boards.owner_user_id = users.id AND boards.board_type = 'personal'
    WHERE users.is_disabled = FALSE
      AND (SELECT COUNT(*) FROM buckets WHERE buckets.board_id = boards.id) >= 2
    ORDER BY users.created_at LIMIT 1
  `);
  const actor = fixture.rows[0];
  assert.ok(actor, "A fixture user with a two-bucket personal board is required.");
  const identity: TaskboardUserIdentity = {
    id: actor.id, email: actor.email, displayName: actor.display_name, role: actor.role,
    authMode: "authelia", authProvider: "authelia", isDisabled: false,
  };
  const board = { id: actor.board_id, owner_user_id: actor.owner_user_id, board_type: "personal" as const };
  const [sourceBucketId, targetBucketId] = actor.bucket_ids;
  const taskId = await createRootTask(identity, { bucketId: sourceBucketId, title: "Move and save lock regression" });
  assert.ok(taskId);

  const mover = await pool.connect();
  const saver = await pool.connect();
  try {
    const saverPid = (await saver.query<{ pid: number }>("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await mover.query("BEGIN");
    await mover.query(
      "SELECT id FROM buckets WHERE board_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE",
      [board.id, [sourceBucketId, targetBucketId]],
    );

    await saver.query("BEGIN");
    const save = updateTaskInTransaction(saver, identity, board, taskId, {
      summary: "Saved during a move", status: "active", bucketId: targetBucketId,
    }).then(
      async () => { await saver.query("COMMIT"); return null; },
      async (error: unknown) => { await saver.query("ROLLBACK"); return error; },
    );

    let saverBlocked = false;
    for (let attempt = 0; attempt < 100 && !saverBlocked; attempt += 1) {
      const activity = await pool.query<{ wait_event_type: string | null }>(
        "SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1", [saverPid]);
      saverBlocked = activity.rows[0]?.wait_event_type === "Lock";
      if (!saverBlocked) await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.ok(saverBlocked, "The save should wait on the move's bucket locks.");

    await moveRootTaskInTransaction(mover, board, { taskId, targetBucketId, targetIndex: 0 });
    await mover.query("COMMIT");
    const saveError = await save;
    assert.equal(saveError, null, `The save should succeed after the move: ${String(saveError)}`);

    const saved = await pool.query<{ bucket_id: string; summary: string; status: string }>(
      "SELECT bucket_id, summary, status FROM tasks WHERE id = $1", [taskId]);
    assert.equal(saved.rows[0].bucket_id, targetBucketId);
    assert.equal(saved.rows[0].summary, "Saved during a move");
    assert.equal(saved.rows[0].status, "active");
  } finally {
    await mover.query("ROLLBACK").catch(() => undefined);
    mover.release();
    saver.release();
    await pool.query("DELETE FROM tasks WHERE id = $1", [taskId]);
    await pool.end();
  }
});
