import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getPool } from "../../src/lib/db";
import { addTeamMember, createTeam, createTeamBoard, createRootTask, ensureDatabaseReady } from "../../src/lib/taskboard-store";
import { isLocalVisualDatabase } from "./visual-database";

// Invoked in a child Node process so server-only modules do not enter the
// Playwright runner's module graph.
async function main() {
  assert.ok(isLocalVisualDatabase(new URL(process.env.DATABASE_URL!)));
  await ensureDatabaseReady();
  const pool = getPool()!;
  const { rows: [row] } = await pool.query("SELECT id, email, display_name FROM users WHERE role = 'admin' AND NOT is_disabled LIMIT 1");
  assert.ok(row, "A fixture admin is required.");
  const admin = { id: row.id, email: row.email, displayName: row.display_name, role: "admin" as const, authMode: "password" as const, authProvider: "local" as const };
  const userId = randomUUID();
  await pool.query("INSERT INTO users (id, email, display_name, role, auth_provider) VALUES ($1, $2, 'Menu test member', 'standard', 'local')", [userId, `menu-${userId}@example.invalid`]);
  const team = await createTeam(admin, { name: `Menu test ${userId}` });
  await addTeamMember(admin, team.id, { userId, role: "member" });
  const boardTitle = `Menu view only ${userId}`;
  const editable = await createTeamBoard(admin, team.id, { title: `Menu editable ${userId}`, teamMemberDefaultAccess: "editor" });
  const viewOnly = await createTeamBoard(admin, team.id, { title: boardTitle, teamMemberDefaultAccess: "viewer" });
  const addTask = async (boardId: string, title: string) => {
    const { rows: [bucket] } = await pool.query("SELECT id FROM buckets WHERE board_id = $1 ORDER BY sort_order LIMIT 1", [boardId]);
    return (await createRootTask(admin, { bucketId: bucket.id, title }, { boardId }))!;
  };
  const fixture = { userId, teamId: team.id, editorBoardId: editable.boardId, viewerBoardId: viewOnly.boardId, boardTitle,
    taskId: await addTask(editable.boardId, `Member task ${userId}`), viewerTaskId: await addTask(viewOnly.boardId, `Viewer task ${userId}`) };
  console.log(JSON.stringify(fixture));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => { await getPool()?.end(); });
