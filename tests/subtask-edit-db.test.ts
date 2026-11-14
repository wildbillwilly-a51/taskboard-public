import assert from "node:assert/strict";
import test from "node:test";

import { getPool } from "@/lib/db";
import { createRootTask, createSubtask, updateTask } from "@/lib/taskboard-store";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";

const enabled = process.env.SUBTASK_EDIT_DB_TEST === "1";

// A subtask save may change its title, done state and time, and nothing
// else, even to an empty value (see subtask-rule.ts).
test("subtasks of normal and outage tasks take only a title, done and a time", { skip: !enabled }, async () => {
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
    SELECT
      users.id,
      users.email,
      users.display_name,
      users.username,
      users.role,
      buckets.id AS bucket_id
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

  try {
    for (const workItemType of ["task", "maintenance_outage"] as const) {
      const parentId = await createRootTask(identity, {
        bucketId: actor.bucket_id,
        title: `Subtask edit parent ${workItemType} ${suffix}`,
        workItemType,
      });
      assert.ok(parentId);
      createdTaskIds.push(parentId);

      const subtaskId = await createSubtask(identity, { parentTaskId: parentId, title: `Step ${suffix}` });
      assert.ok(subtaskId);

      await updateTask(identity, subtaskId, {
        title: `Step ${suffix} renamed`,
        status: "todo",
        startAt: "2026-12-01T17:00:00.000Z",
        endAt: "2026-12-01T18:00:00.000Z",
        allDay: false,
      });
      await updateTask(identity, subtaskId, { status: "done" });

      const saved: { rows: Array<{ title: string; status: string; start_at: Date | null }> } =
        await pool.query(`SELECT title, status, start_at FROM tasks WHERE id = $1`, [subtaskId]);
      assert.equal(saved.rows[0]?.title, `Step ${suffix} renamed`);
      assert.equal(saved.rows[0]?.status, "done");
      assert.ok(saved.rows[0]?.start_at);

      for (const patch of [
        { summary: "" }, { nextAction: "" }, { labels: [] }, { color: "#14b8a6" }, { icon: "flag" as const },
        { dueAt: null }, { recurrence: null }, { reminderOffsetMinutes: null }, { overdueReminderEnabled: false },
        { status: "waiting" as const }, { status: "active" as const },
      ]) {
        await assert.rejects(updateTask(identity, subtaskId, patch), /Subtasks only have|either done or not done/, JSON.stringify(patch));
      }
      // A request naming a detail field is refused even when the route
      // dropped its value (for example summary: null).
      await assert.rejects(updateTask(identity, subtaskId, { title: "Kept" }, {}, ["title", "summary"]), /Subtasks only have/);
      await updateTask(identity, subtaskId, { title: "Kept" }, {}, ["title"]);
    }
  } finally {
    if (createdTaskIds.length > 0) {
      await pool.query(`DELETE FROM tasks WHERE id = ANY($1::uuid[]) OR parent_task_id = ANY($1::uuid[])`, [
        createdTaskIds,
      ]);
    }
  }
});
