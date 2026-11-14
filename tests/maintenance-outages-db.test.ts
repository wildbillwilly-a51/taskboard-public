import assert from "node:assert/strict";
import test from "node:test";

import { getPool } from "@/lib/db";
import {
  createMaintenanceLocation,
  createRootTask,
  getBoardStateFromDatabase,
  updateTask,
} from "@/lib/taskboard-store";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";

const enabled = process.env.MAINTENANCE_OUTAGE_DB_TEST === "1";

test("maintenance outage persistence works on a disposable database clone", { skip: !enabled }, async () => {
  const pool = getPool();
  assert.ok(pool, "DATABASE_URL is required.");

  const actorResult = await pool.query<{
    id: string;
    email: string;
    display_name: string;
    username: string | null;
    role: "admin" | "standard";
    board_id: string;
    bucket_id: string;
  }>(`
    SELECT
      users.id,
      users.email,
      users.display_name,
      users.username,
      users.role,
      boards.id AS board_id,
      buckets.id AS bucket_id
    FROM users
    INNER JOIN boards ON boards.owner_user_id = users.id AND boards.board_type = 'personal'
    INNER JOIN buckets ON buckets.board_id = boards.id
    WHERE users.is_disabled = FALSE
    ORDER BY users.created_at ASC, buckets.sort_order ASC
    LIMIT 1
  `);
  const actor = actorResult.rows[0];
  assert.ok(actor, "A clone user with a personal board and bucket is required.");

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
  const boardContext = {};
  const suffix = Date.now().toString(36);
  const createdTaskIds: string[] = [];
  let locationId: string | null = null;

  try {
    const normalTaskId = await createRootTask(identity, {
      bucketId: actor.bucket_id,
      title: `Clone normal task ${suffix}`,
    }, boardContext);
    assert.ok(normalTaskId);
    createdTaskIds.push(normalTaskId);

    const outageTaskId = await createRootTask(identity, {
      bucketId: actor.bucket_id,
      title: `Clone outage ${suffix}`,
      workItemType: "maintenance_outage",
    }, boardContext);
    assert.ok(outageTaskId);
    createdTaskIds.push(outageTaskId);

    const allDayTaskId = await createRootTask(identity, {
      bucketId: actor.bucket_id,
      title: `Clone all-day task ${suffix}`,
    }, boardContext);
    assert.ok(allDayTaskId);
    createdTaskIds.push(allDayTaskId);

    locationId = await createMaintenanceLocation(identity, `Clone site ${suffix}`, boardContext);
    assert.ok(locationId);

    await updateTask(identity, outageTaskId, {
      maintenanceOutage: {
        locationId,
        owner: "Clone owner",
        attendees: ["Maintenance", "Safety"],
      },
    }, boardContext);
    await updateTask(identity, normalTaskId, {
      promoteToMaintenanceOutage: true,
    }, boardContext);
    await updateTask(identity, allDayTaskId, {
      startAt: "2026-07-15T05:00:00.000Z",
      endAt: "2026-07-16T05:00:00.000Z",
      allDay: true,
    }, boardContext);
    await updateTask(identity, outageTaskId, {
      allDay: true,
    }, boardContext);

    const rows = await pool.query<{
      id: string;
      work_item_type: string;
      start_at: string | null;
      all_day: boolean;
      location_id: string | null;
      owner_name: string | null;
      attendees: unknown;
    }>(`
      SELECT
        tasks.id,
        tasks.work_item_type,
        tasks.start_at,
        tasks.all_day,
        maintenance_outages.location_id,
        maintenance_outages.owner_name,
        maintenance_outages.attendees
      FROM tasks
      LEFT JOIN maintenance_outages ON maintenance_outages.task_id = tasks.id
      WHERE tasks.id = ANY($1::uuid[])
      ORDER BY tasks.id
    `, [createdTaskIds]);

    const normal = rows.rows.find((row) => row.id === normalTaskId);
    const outage = rows.rows.find((row) => row.id === outageTaskId);
    const allDayTask = rows.rows.find((row) => row.id === allDayTaskId);
    assert.equal(normal?.work_item_type, "maintenance_outage");
    assert.ok(normal?.start_at, "Promoted normal tasks keep their existing schedule behavior.");
    assert.equal(outage?.work_item_type, "maintenance_outage");
    assert.equal(outage?.all_day, true);
    assert.equal(outage?.start_at, null, "Title-only outages remain unscheduled.");
    assert.equal(outage?.location_id, locationId);
    assert.equal(outage?.owner_name, "Clone owner");
    assert.deepEqual(outage?.attendees, ["Maintenance", "Safety"]);
    assert.equal(allDayTask?.work_item_type, "task");
    assert.equal(allDayTask?.all_day, true);

    const state = await getBoardStateFromDatabase(identity, boardContext);
    const loadedOutage = state?.board?.buckets
      .flatMap((bucket) => bucket.tasks)
      .find((task) => task.id === outageTaskId);
    assert.equal(loadedOutage?.workItemType, "maintenance_outage");
    assert.equal(loadedOutage?.allDay, true);
    assert.equal(loadedOutage?.maintenanceOutage?.locationName, `Clone site ${suffix}`);
    assert.deepEqual(loadedOutage?.maintenanceOutage?.attendees, ["Maintenance", "Safety"]);
    const loadedAllDayTask = state?.board?.buckets
      .flatMap((bucket) => bucket.tasks)
      .find((task) => task.id === allDayTaskId);
    assert.equal(loadedAllDayTask?.allDay, true);
  } finally {
    if (createdTaskIds.length > 0) {
      await pool.query(`DELETE FROM tasks WHERE id = ANY($1::uuid[])`, [createdTaskIds]);
    }
    if (locationId) {
      await pool.query(`DELETE FROM maintenance_locations WHERE id = $1`, [locationId]);
    }
  }
});
