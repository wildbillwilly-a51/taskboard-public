import assert from "node:assert/strict";
import test from "node:test";

import { getPool } from "@/lib/db";
import { createRootTask, createSubtask, moveSubtask } from "@/lib/taskboard-store";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";

const enabled = process.env.SUBTASK_MOVE_DB_TEST === "1";

test("subtasks move between parents within their task and keep a clean order", { skip: !enabled }, async () => {
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
  const roots: string[] = [];
  const children = async (parentId: string) =>
    (await pool.query<{ title: string }>(
      `SELECT title FROM tasks WHERE parent_task_id = $1 ORDER BY sort_order ASC`,
      [parentId],
    )).rows.map((row) => row.title);

  try {
    const outage = await createRootTask(identity, { bucketId: actor.bucket_id, title: `Move outage ${suffix}` });
    const other = await createRootTask(identity, { bucketId: actor.bucket_id, title: `Move other ${suffix}` });
    assert.ok(outage && other);
    roots.push(outage, other);
    const w1 = (await createSubtask(identity, { parentTaskId: outage, title: "w1" }))!;
    const w2 = (await createSubtask(identity, { parentTaskId: outage, title: "w2" }))!;
    const a = (await createSubtask(identity, { parentTaskId: w1, title: "a" }))!;
    await createSubtask(identity, { parentTaskId: w1, title: "b" });
    const c = (await createSubtask(identity, { parentTaskId: w2, title: "c" }))!;
    const elsewhere = (await createSubtask(identity, { parentTaskId: other, title: "elsewhere" }))!;

    // Drag "a" into the second window, before "c".
    await moveSubtask(identity, { taskId: a, parentTaskId: w2, targetIndex: 0 });
    assert.deepEqual(await children(w1), ["b"]);
    assert.deepEqual(await children(w2), ["a", "c"]);

    // Shift+Tab "c" out of the window, right after it.
    await moveSubtask(identity, { taskId: c, parentTaskId: outage, targetIndex: 2 });
    assert.deepEqual(await children(outage), ["w1", "w2", "c"]);

    // An index past the end lands last.
    await moveSubtask(identity, { taskId: a, parentTaskId: outage, targetIndex: 99 });
    assert.deepEqual(await children(outage), ["w1", "w2", "c", "a"]);

    await assert.rejects(moveSubtask(identity, { taskId: w1, parentTaskId: w1, targetIndex: 0 }), /inside itself/);
    await assert.rejects(moveSubtask(identity, { taskId: elsewhere, parentTaskId: w1, targetIndex: 0 }), /within its own task/);
    await assert.rejects(moveSubtask(identity, { taskId: outage, parentTaskId: other, targetIndex: 0 }), /Only a subtask/);
    await assert.rejects(moveSubtask(identity, { taskId: a, parentTaskId: w1, targetIndex: -1 }), /targetIndex/);
  } finally {
    if (roots.length > 0) {
      await pool.query(
        `
          WITH RECURSIVE tree AS (
            SELECT id FROM tasks WHERE id = ANY($1::uuid[])
            UNION ALL
            SELECT tasks.id FROM tasks INNER JOIN tree ON tasks.parent_task_id = tree.id
          )
          DELETE FROM tasks WHERE id IN (SELECT id FROM tree)
        `,
        [roots],
      );
    }
  }
});
