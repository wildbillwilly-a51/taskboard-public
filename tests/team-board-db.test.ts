import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { getPool } from "@/lib/db";
import {
  addTeamBoardMemberGrant,
  addTeamMember,
  createRootTask,
  createTeam,
  createTeamBoard,
  createViewPreset,
  getBoardStateFromDatabase,
} from "@/lib/taskboard-store";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";

const enabled = process.env.TEAM_BOARD_DB_TEST === "1";

function syntheticIdentity(id: string, suffix: string): TaskboardUserIdentity {
  return {
    id,
    authMode: "authelia",
    authProvider: "authelia",
    email: `team-board-${suffix}@example.invalid`,
    username: `team-board-${suffix}`,
    displayName: `Team board ${suffix}`,
    role: "standard",
    isDisabled: false,
  };
}

test("team board members create tasks according to access and keep per-user views", { skip: !enabled }, async () => {
  const pool = getPool();
  assert.ok(pool, "DATABASE_URL is required.");

  const adminResult = await pool.query<{
    id: string;
    email: string;
    username: string | null;
    display_name: string;
    role: "admin" | "manager" | "standard";
  }>(`
    SELECT id, email, username, display_name, role
    FROM users
    WHERE role = 'admin' AND is_disabled = FALSE
    ORDER BY created_at ASC
    LIMIT 1
  `);
  const adminRow = adminResult.rows[0];
  assert.ok(adminRow, "An enabled administrator is required in the disposable clone.");

  const admin: TaskboardUserIdentity = {
    id: adminRow.id,
    authMode: "authelia",
    authProvider: "authelia",
    email: adminRow.email,
    ...(adminRow.username ? { username: adminRow.username } : {}),
    displayName: adminRow.display_name,
    role: adminRow.role,
    isDisabled: false,
  };
  const suffix = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
  const editor = syntheticIdentity(randomUUID(), `${suffix}-editor`);
  const viewer = syntheticIdentity(randomUUID(), `${suffix}-viewer`);
  let teamId: string | null = null;

  try {
    await pool.query(
      `
        INSERT INTO users (id, email, username, display_name, role, auth_provider)
        VALUES
          ($1, $2, $3, $4, 'standard', 'authelia'),
          ($5, $6, $7, $8, 'standard', 'authelia')
      `,
      [
        editor.id,
        editor.email,
        editor.username,
        editor.displayName,
        viewer.id,
        viewer.email,
        viewer.username,
        viewer.displayName,
      ],
    );

    const team = await createTeam(admin, {
      name: `Clone team ${suffix}`,
      description: "Disposable team-board validation",
    });
    teamId = team.id;
    await addTeamMember(admin, team.id, { userId: editor.id!, role: "member" });
    await addTeamMember(admin, team.id, { userId: viewer.id!, role: "member" });

    const board = await createTeamBoard(admin, team.id, {
      title: `Clone board ${suffix}`,
      teamMemberDefaultAccess: "viewer",
    });
    await addTeamBoardMemberGrant(admin, team.id, board.boardId, {
      userId: editor.id!,
      role: "editor",
    });

    const bucketResult = await pool.query<{ id: string }>(
      `SELECT id FROM buckets WHERE board_id = $1 ORDER BY sort_order ASC LIMIT 1`,
      [board.boardId],
    );
    const bucketId = bucketResult.rows[0]?.id;
    assert.ok(bucketId, "The team board should have a seeded bucket.");

    const managerTaskId = await createRootTask(admin, {
      bucketId,
      title: `Manager task ${suffix}`,
    }, { boardId: board.boardId });
    assert.ok(managerTaskId, "A team manager should be able to create a task.");

    const editorTaskId = await createRootTask(editor, {
      bucketId,
      title: `Editor task ${suffix}`,
      summary: "Created by an explicitly granted editor",
    }, { boardId: board.boardId });
    assert.ok(editorTaskId, "An explicitly granted editor should be able to create a task.");

    await assert.rejects(
      createRootTask(viewer, {
        bucketId,
        title: `Viewer task ${suffix}`,
      }, { boardId: board.boardId }),
      /permission|edit|view|access/i,
    );

    const viewName = `Editor view ${suffix}`;
    const viewId = await createViewPreset(editor, {
      name: viewName,
      layoutMode: "board",
      filters: { statuses: ["todo"] },
    }, { boardId: board.boardId });
    assert.ok(viewId, "A team-board editor should be able to save a view.");

    const state = await getBoardStateFromDatabase(editor, { boardId: board.boardId });
    assert.ok(
      state?.board?.buckets.flatMap((bucket) => bucket.tasks).some((task) => task.id === editorTaskId),
      "The created team task should persist and reload.",
    );
    assert.ok(
      state?.board?.views.some((view) => view.id === viewId && view.name === viewName),
      "The editor's team-board view should persist and reload.",
    );

    const attribution = await pool.query<{ created_by_user_id: string | null }>(
      `
        SELECT created_by_user_id
        FROM task_notes
        WHERE task_id = $1 AND note_type = 'primary' AND deleted_at IS NULL
        LIMIT 1
      `,
      [editorTaskId],
    );
    assert.equal(
      attribution.rows[0]?.created_by_user_id,
      editor.id,
      "The primary note should be attributed to the team member who created the task.",
    );

    const defaultEditorBoard = await createTeamBoard(admin, team.id, {
      title: `Default editor board ${suffix}`,
      teamMemberDefaultAccess: "editor",
    });
    const defaultEditorBucket = await pool.query<{ id: string }>(
      `SELECT id FROM buckets WHERE board_id = $1 ORDER BY sort_order ASC LIMIT 1`,
      [defaultEditorBoard.boardId],
    );
    const defaultEditorBucketId = defaultEditorBucket.rows[0]?.id;
    assert.ok(defaultEditorBucketId, "The default-editor team board should have a seeded bucket.");
    const defaultEditorTaskId = await createRootTask(viewer, {
      bucketId: defaultEditorBucketId,
      title: `Default editor task ${suffix}`,
    }, { boardId: defaultEditorBoard.boardId });
    assert.ok(defaultEditorTaskId, "A member inheriting default editor access should create a task.");
  } finally {
    if (teamId) {
      await pool.query(`DELETE FROM boards WHERE owner_team_id = $1`, [teamId]);
      await pool.query(`DELETE FROM teams WHERE id = $1`, [teamId]);
    }
    await pool.query(`DELETE FROM notes WHERE owner_user_id = ANY($1::uuid[])`, [[editor.id, viewer.id]]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[editor.id, viewer.id]]);
  }
});
