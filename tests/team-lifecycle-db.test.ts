import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { getPool } from "@/lib/db";
import {
  addTeamBoardMemberGrant,
  addTeamMember,
  archiveTask,
  createBucket,
  createRootTask,
  createSubtask,
  createTeam,
  createTeamBoard,
  deleteBucket,
  deleteTask,
  getBoardStateFromDatabase,
  permanentlyDeleteRecycleBinItem,
  restoreArchiveItem,
  restoreRecycleBinItem,
  updateTask,
} from "@/lib/taskboard-store";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";

const enabled = process.env.TEAM_LIFECYCLE_DB_TEST === "1";
const managerOnly = /team manager/i;

function syntheticIdentity(id: string, suffix: string): TaskboardUserIdentity {
  return {
    id,
    authMode: "authelia",
    authProvider: "authelia",
    email: `team-lifecycle-${suffix}@example.invalid`,
    username: `team-lifecycle-${suffix}`,
    displayName: `Team lifecycle ${suffix}`,
    role: "standard",
    isDisabled: false,
  };
}

test("team-board archive, delete, restore and purge are manager-only while enabled", { skip: !enabled }, async () => {
  const pool = getPool();
  assert.ok(pool, "DATABASE_URL is required.");
  const previousFlag = process.env.TASKBOARD_TEAM_LIFECYCLE_MANAGERS;
  process.env.TASKBOARD_TEAM_LIFECYCLE_MANAGERS = "enabled";

  const adminRow = (await pool.query<{
    id: string;
    email: string;
    username: string | null;
    display_name: string;
  }>(`
    SELECT id, email, username, display_name
    FROM users
    WHERE role = 'admin' AND is_disabled = FALSE
    ORDER BY created_at ASC
    LIMIT 1
  `)).rows[0];
  assert.ok(adminRow, "An enabled administrator is required in the disposable database.");
  const admin: TaskboardUserIdentity = {
    id: adminRow.id,
    authMode: "authelia",
    authProvider: "authelia",
    email: adminRow.email,
    ...(adminRow.username ? { username: adminRow.username } : {}),
    displayName: adminRow.display_name,
    role: "admin",
    isDisabled: false,
  };
  const suffix = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const manager = syntheticIdentity(randomUUID(), `${suffix}-manager`);
  const editor = syntheticIdentity(randomUUID(), `${suffix}-editor`);
  const otherEditor = syntheticIdentity(randomUUID(), `${suffix}-other`);
  const grantOwner = syntheticIdentity(randomUUID(), `${suffix}-grant-owner`);
  const people = [manager, editor, otherEditor, grantOwner];
  let teamId: string | null = null;

  try {
    for (const person of people) {
      await pool.query(
        `INSERT INTO users (id, email, username, display_name, role, auth_provider)
         VALUES ($1, $2, $3, $4, 'standard', 'authelia')`,
        [person.id, person.email, person.username, person.displayName],
      );
    }

    const team = await createTeam(admin, { name: `Lifecycle team ${suffix}`, description: "Disposable lifecycle validation" });
    teamId = team.id;
    await addTeamMember(admin, team.id, { userId: manager.id!, role: "manager" });
    for (const member of [editor, otherEditor, grantOwner]) {
      await addTeamMember(admin, team.id, { userId: member.id!, role: "member" });
    }
    const board = await createTeamBoard(admin, team.id, {
      title: `Lifecycle board ${suffix}`,
      teamMemberDefaultAccess: "editor",
    });
    // An explicit board-owner grant is not team management.
    await addTeamBoardMemberGrant(admin, team.id, board.boardId, { userId: grantOwner.id!, role: "owner" });
    const options = { boardId: board.boardId };
    const bucketId = (await pool.query<{ id: string }>(
      `SELECT id FROM buckets WHERE board_id = $1 ORDER BY sort_order ASC LIMIT 1`,
      [board.boardId],
    )).rows[0]?.id;
    assert.ok(bucketId, "The team board should have a seeded bucket.");
    const archivedAt = async (taskId: string) =>
      (await pool.query<{ archived_at: string | null; deleted_at: string | null }>(
        `SELECT archived_at, deleted_at FROM tasks WHERE id = $1`,
        [taskId],
      )).rows[0];

    const editorState = await getBoardStateFromDatabase(editor, options);
    assert.equal(editorState?.boardAccess.canEdit, true);
    assert.equal(editorState?.boardAccess.canManageLifecycle, false, "A team editor has no lifecycle access.");
    const grantState = await getBoardStateFromDatabase(grantOwner, options);
    assert.equal(grantState?.boardAccess.canManage, true);
    assert.equal(grantState?.boardAccess.canManageLifecycle, false, "A board-owner grant is not team management.");
    assert.equal((await getBoardStateFromDatabase(manager, options))?.boardAccess.canManageLifecycle, true);
    assert.equal((await getBoardStateFromDatabase(admin, options))?.boardAccess.canManageLifecycle, true);

    // Editors finish work but do not archive or delete it.
    const taskId = await createRootTask(editor, { bucketId, title: `Editor work ${suffix}` }, options);
    assert.ok(taskId);
    await updateTask(editor, taskId, { status: "done" }, options);
    await assert.rejects(archiveTask(editor, taskId, options), managerOnly);
    await assert.rejects(archiveTask(grantOwner, taskId, options), managerOnly);
    await assert.rejects(deleteTask(editor, taskId, options), managerOnly);
    assert.equal((await archivedAt(taskId))?.archived_at, null, "A refused archive changes nothing.");

    // Managers archive and restore; editors cannot restore.
    await archiveTask(manager, taskId, options);
    assert.ok((await archivedAt(taskId))?.archived_at);
    await assert.rejects(restoreArchiveItem(editor, taskId, options), managerOnly);
    await restoreArchiveItem(manager, taskId, options);
    assert.equal((await archivedAt(taskId))?.archived_at, null);

    // Recycle bin: editors cannot restore or purge.
    await deleteTask(manager, taskId, options);
    assert.ok((await archivedAt(taskId))?.deleted_at);
    await assert.rejects(restoreRecycleBinItem(editor, taskId, options), managerOnly);
    await assert.rejects(permanentlyDeleteRecycleBinItem(editor, taskId, options), managerOnly);
    await restoreRecycleBinItem(manager, taskId, options);
    assert.equal((await archivedAt(taskId))?.deleted_at, null);

    // Admins keep manager-level actions.
    await archiveTask(admin, taskId, options);
    assert.ok((await archivedAt(taskId))?.archived_at);
    await restoreArchiveItem(admin, taskId, options);

    // Buckets: editors may delete an empty bucket, not one that still has tasks.
    const emptyBucketId = await createBucket(editor, { title: `Empty ${suffix}` }, options);
    assert.ok(emptyBucketId);
    await deleteBucket(editor, emptyBucketId, options);
    const fullBucketId = await createBucket(editor, { title: `Full ${suffix}` }, options);
    assert.ok(fullBucketId);
    const bucketTaskId = await createRootTask(editor, { bucketId: fullBucketId, title: `In bucket ${suffix}` }, options);
    assert.ok(bucketTaskId);
    await assert.rejects(deleteBucket(editor, fullBucketId, options), managerOnly);
    assert.equal((await archivedAt(bucketTaskId))?.deleted_at, null, "A refused bucket delete recycles nothing.");
    await deleteBucket(manager, fullBucketId, options);
    assert.ok((await archivedAt(bucketTaskId))?.deleted_at);

    // A recurring completion still archives the occurrence for an editor, and
    // only that editor may undo it.
    const recurringId = await createRootTask(editor, { bucketId, title: `Recurring ${suffix}` }, options);
    assert.ok(recurringId);
    await updateTask(editor, recurringId, {
      dueAt: "2026-12-01T17:00:00.000Z",
      recurrence: { frequency: "weekly", interval: 1, mode: "on_schedule" },
    }, options);
    await updateTask(editor, recurringId, { status: "done" }, options);
    assert.ok((await archivedAt(recurringId))?.archived_at, "Recurring completion still archives the occurrence.");
    await assert.rejects(restoreArchiveItem(otherEditor, recurringId, options), managerOnly);
    await restoreArchiveItem(editor, recurringId, options);
    assert.equal((await archivedAt(recurringId))?.archived_at, null, "The completing editor can undo it.");

    // The undo window closes; after that it is an ordinary manager restore.
    await updateTask(editor, recurringId, { status: "done" }, options);
    await pool.query(`UPDATE tasks SET archived_at = NOW() - INTERVAL '1 hour' WHERE id = $1`, [recurringId]);
    await assert.rejects(restoreArchiveItem(editor, recurringId, options), managerOnly);

    // Finishing the last subtask finishes and archives a recurring task; the
    // person who finished it may undo that too.
    const rolledId = await createRootTask(editor, { bucketId, title: `Rolled ${suffix}` }, options);
    assert.ok(rolledId);
    await updateTask(editor, rolledId, {
      dueAt: "2026-12-01T17:00:00.000Z",
      recurrence: { frequency: "weekly", interval: 1, mode: "on_schedule" },
    }, options);
    const childId = await createSubtask(editor, { parentTaskId: rolledId, title: `Rolled child ${suffix}` }, options);
    assert.ok(childId);
    await updateTask(editor, childId, { status: "done" }, options);
    const rolled = (await pool.query<{ archived_at: string | null; archive_reason: string | null }>(
      `SELECT archived_at, archive_reason FROM tasks WHERE id = $1`,
      [rolledId],
    )).rows[0];
    assert.ok(rolled?.archived_at, "Finishing the last subtask archives the recurring task.");
    assert.equal(rolled?.archive_reason, "recurring_completion");
    await restoreArchiveItem(editor, rolledId, options);
    assert.equal((await archivedAt(rolledId))?.archived_at, null);
    // The rest of the Undo: the subtask reopens and the task stays live.
    await updateTask(editor, childId, { status: "todo" }, options);
    const afterUndo = (await pool.query<{ id: string; status: string; archived_at: string | null }>(
      `SELECT id, status, archived_at FROM tasks WHERE id = ANY($1::uuid[])`,
      [[rolledId, childId]],
    )).rows;
    assert.deepEqual(
      afterUndo.map((row) => [row.id === rolledId ? "root" : "child", row.status, row.archived_at]).sort(),
      [["child", "todo", null], ["root", "todo", null]],
    );

    // A manual archive is not a completion, even for a recurring task archived
    // by someone who is no longer a manager.
    const manualId = await createRootTask(manager, { bucketId, title: `Manual ${suffix}` }, options);
    assert.ok(manualId);
    await updateTask(manager, manualId, {
      dueAt: "2026-12-01T17:00:00.000Z",
      recurrence: { frequency: "weekly", interval: 1, mode: "on_schedule" },
    }, options);
    await archiveTask(manager, manualId, options);
    await pool.query(`UPDATE team_members SET role = 'member' WHERE team_id = $1 AND user_id = $2`, [team.id, manager.id]);
    assert.equal((await getBoardStateFromDatabase(manager, options))?.boardAccess.canManageLifecycle, false);
    await assert.rejects(restoreArchiveItem(manager, manualId, options), managerOnly);
    await pool.query(`UPDATE team_members SET role = 'manager' WHERE team_id = $1 AND user_id = $2`, [team.id, manager.id]);

    // With the setting off, team editors keep today's behavior.
    process.env.TASKBOARD_TEAM_LIFECYCLE_MANAGERS = "";
    assert.equal((await getBoardStateFromDatabase(editor, options))?.boardAccess.canManageLifecycle, true);
    const legacyTaskId = await createRootTask(editor, { bucketId, title: `Legacy ${suffix}` }, options);
    assert.ok(legacyTaskId);
    await archiveTask(editor, legacyTaskId, options);
    assert.ok((await archivedAt(legacyTaskId))?.archived_at);
  } finally {
    if (previousFlag === undefined) delete process.env.TASKBOARD_TEAM_LIFECYCLE_MANAGERS;
    else process.env.TASKBOARD_TEAM_LIFECYCLE_MANAGERS = previousFlag;
    if (teamId) {
      await pool.query(`DELETE FROM boards WHERE owner_team_id = $1`, [teamId]);
      await pool.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
    }
    await pool.query(`DELETE FROM notes WHERE owner_user_id = ANY($1::uuid[])`, [people.map((person) => person.id)]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [people.map((person) => person.id)]);
  }
});

test("personal boards keep edit-level lifecycle", { skip: !enabled }, async () => {
  const pool = getPool();
  assert.ok(pool, "DATABASE_URL is required.");
  const previousFlag = process.env.TASKBOARD_TEAM_LIFECYCLE_MANAGERS;
  process.env.TASKBOARD_TEAM_LIFECYCLE_MANAGERS = "enabled";
  const suffix = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const owner = syntheticIdentity(randomUUID(), `${suffix}-owner`);

  try {
    await pool.query(
      `INSERT INTO users (id, email, username, display_name, role, auth_provider)
       VALUES ($1, $2, $3, $4, 'standard', 'authelia')`,
      [owner.id, owner.email, owner.username, owner.displayName],
    );
    const state = await getBoardStateFromDatabase(owner);
    assert.equal(state?.boardAccess.canManageLifecycle, true);
    const bucketId = state?.board.buckets[0]?.id;
    assert.ok(bucketId);
    const taskId = await createRootTask(owner, { bucketId, title: `Personal ${suffix}` });
    assert.ok(taskId);
    await archiveTask(owner, taskId);
    await restoreArchiveItem(owner, taskId);
    await deleteTask(owner, taskId);
    await restoreRecycleBinItem(owner, taskId);
  } finally {
    if (previousFlag === undefined) delete process.env.TASKBOARD_TEAM_LIFECYCLE_MANAGERS;
    else process.env.TASKBOARD_TEAM_LIFECYCLE_MANAGERS = previousFlag;
    await pool.query(`DELETE FROM notes WHERE owner_user_id = $1`, [owner.id]);
    await pool.query(`DELETE FROM boards WHERE owner_user_id = $1`, [owner.id]);
    await pool.query(`DELETE FROM users WHERE id = $1`, [owner.id]);
  }
});
