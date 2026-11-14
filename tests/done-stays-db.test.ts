import assert from "node:assert/strict";
import test from "node:test";

import { getPool } from "@/lib/db";
import { archiveTask, createRootTask, loadTaskboardState, updateTask } from "@/lib/taskboard-store";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";

const enabled = process.env.DONE_STAYS_DB_TEST === "1";

// A task marked done stays on the board, also across board loads, until it
// is archived. A recurring task still archives its finished occurrence,
// because the next occurrence takes its place.
test("done tasks stay on the board until archived; recurring completions archive", { skip: !enabled }, async () => {
  const pool = getPool();
  assert.ok(pool, "DATABASE_URL is required.");

  const actorResult = await pool.query<{
    id: string;
    email: string;
    display_name: string;
    username: string | null;
    role: "admin" | "standard";
    bucket_id: string;
  }>(`
    SELECT users.id, users.email, users.display_name, users.username, users.role, buckets.id AS bucket_id
    FROM users
    INNER JOIN boards ON boards.owner_user_id = users.id AND boards.board_type = 'personal'
    INNER JOIN buckets ON buckets.board_id = boards.id
    WHERE users.is_disabled = FALSE
    ORDER BY users.created_at ASC, buckets.sort_order ASC
    LIMIT 1
  `);
  const actor = actorResult.rows[0];
  assert.ok(actor, "A user with a personal board and bucket is required.");

  const identity: TaskboardUserIdentity = {
    id: actor.id,
    authMode: "authelia",
    authProvider: "authelia",
    email: actor.email,
    displayName: actor.display_name,
    ...(actor.username ? { username: actor.username } : {}),
    role: actor.role,
    isDisabled: false,
  };
  const suffix = Date.now().toString(36);
  const createdTaskIds: string[] = [];
  const state = async (taskId: string) =>
    (await pool.query<{ status: string; archived_at: string | null; bucket_id: string | null }>(
      `SELECT status, archived_at, bucket_id FROM tasks WHERE id = $1`,
      [taskId],
    )).rows[0];

  try {
    const taskId = await createRootTask(identity, { bucketId: actor.bucket_id, title: `Done stays ${suffix}` });
    assert.ok(taskId);
    createdTaskIds.push(taskId);

    await updateTask(identity, taskId, { status: "done" });
    let row = await state(taskId);
    assert.equal(row?.status, "done");
    assert.equal(row?.archived_at, null, "Marking done must not archive.");
    assert.equal(row?.bucket_id, actor.bucket_id, "A done task stays in its bucket.");

    // A board load used to sweep done tasks into Archives.
    await loadTaskboardState(identity);
    row = await state(taskId);
    assert.equal(row?.archived_at, null, "A board load must not archive done tasks.");

    await archiveTask(identity, taskId);
    row = await state(taskId);
    assert.ok(row?.archived_at, "Archiving a done task archives it.");

    const recurringId = await createRootTask(identity, { bucketId: actor.bucket_id, title: `Done recurring ${suffix}` });
    assert.ok(recurringId);
    createdTaskIds.push(recurringId);
    await updateTask(identity, recurringId, {
      dueAt: "2026-12-01T17:00:00.000Z",
      recurrence: { frequency: "weekly", interval: 1, mode: "on_schedule" },
    });
    await updateTask(identity, recurringId, { status: "done" });
    const recurringRow = await state(recurringId);
    assert.ok(recurringRow?.archived_at, "A finished recurring occurrence goes to Archives.");
    const next = await pool.query<{ id: string; status: string }>(
      `SELECT id, status FROM tasks WHERE title = $1 AND id <> $2 AND archived_at IS NULL AND deleted_at IS NULL`,
      [`Done recurring ${suffix}`, recurringId],
    );
    assert.equal(next.rows.length, 1, "The next occurrence is created.");
    assert.equal(next.rows[0]?.status, "todo");
    createdTaskIds.push(next.rows[0].id);
  } finally {
    if (createdTaskIds.length > 0) {
      await pool.query(`DELETE FROM tasks WHERE id = ANY($1::uuid[]) OR parent_task_id = ANY($1::uuid[])`, [
        createdTaskIds,
      ]);
    }
  }
});
