import assert from "node:assert/strict";
import test from "node:test";

import { getPool } from "@/lib/db";
import { getStartOfTodayInTimeZone } from "@/lib/task-schedule";
import { createRootTask } from "@/lib/taskboard-store";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";

const enabled = process.env.TASK_DEFAULT_START_DB_TEST === "1";

test("undated tasks are stored as all-day starts for today on a disposable database", { skip: !enabled }, async () => {
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

  try {
    const expectedStart = getStartOfTodayInTimeZone(new Date(), "America/Chicago");
    const undatedTaskId = await createRootTask(identity, {
      bucketId: actor.bucket_id,
      title: `Undated task ${suffix}`,
      timeZone: "America/Chicago",
    });
    const datedTaskId = await createRootTask(identity, {
      bucketId: actor.bucket_id,
      title: `Dated task ${suffix}`,
      startAt: "2026-07-15T14:30:00.000Z",
    });
    const outageTaskId = await createRootTask(identity, {
      bucketId: actor.bucket_id,
      title: `Outage ${suffix}`,
      workItemType: "maintenance_outage",
      timeZone: "America/Chicago",
    });
    for (const id of [undatedTaskId, datedTaskId, outageTaskId]) {
      assert.ok(id);
      createdTaskIds.push(id);
    }

    const rows = await pool.query<{ id: string; start_at: Date | null; all_day: boolean }>(
      `SELECT id, start_at, all_day FROM tasks WHERE id = ANY($1::uuid[])`,
      [createdTaskIds],
    );
    const byId = new Map(rows.rows.map((row) => [row.id, row]));
    const undated = byId.get(undatedTaskId!);
    const dated = byId.get(datedTaskId!);
    const outage = byId.get(outageTaskId!);

    assert.equal(undated?.start_at?.toISOString(), expectedStart);
    assert.equal(undated?.all_day, true);
    assert.equal(dated?.start_at?.toISOString(), "2026-07-15T14:30:00.000Z");
    assert.equal(dated?.all_day, false, "An explicit start keeps its time.");
    assert.equal(outage?.start_at, null, "Outages stay unscheduled.");
    assert.equal(outage?.all_day, false);
  } finally {
    if (createdTaskIds.length > 0) {
      await pool.query(`DELETE FROM tasks WHERE id = ANY($1::uuid[])`, [createdTaskIds]);
    }
  }
});
