import { expect, type Page, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { createSessionCookieValue } from "../../src/lib/auth";
import { isLocalVisualDatabase } from "./visual-database";

export const content = (text: string) => ({ blocks: [{ type: "paragraph", content: [{ type: "text", text, styles: {} }] }], text, markdown: text, formatVersion: 2 });
export async function body(response: Awaited<ReturnType<APIRequestContext["get"]>>) {
  expect(response.ok(), await response.text()).toBe(true);
  return response.json();
}
export async function seed(page: Page) {
  expect(isLocalVisualDatabase(new URL(process.env.DATABASE_URL!))).toBe(true);
  expect(process.env.TASKBOARD_VISUAL_DATABASE_NAME).toMatch(/^(taskboard_visual_test_wiki_p1_int_http|taskboard_visual_test_wiki_p2_(ui|int)(_[a-z0-9_]+)?)$/);
  expect((await page.request.post("/api/auth/login", { data: { password: process.env.TASKBOARD_VISUAL_PASSWORD ?? (process.env.TASKBOARD_WIKI_P2_REAL === "1" ? "wiki-p2-ui-fixture" : "visual-test-password") } })).ok()).toBe(true);
  const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const admin = (await pool.query<{ id: string; last_selected_board_id: string | null }>("SELECT id,last_selected_board_id FROM users WHERE is_reserved_local_admin")).rows[0];
  expect(admin).toBeTruthy();
  const suffix = randomUUID().slice(0, 8);
  const team = (await body(await page.request.post("/api/teams", { data: { name: `Wiki browser ${suffix}` } }))).team;
  const boards = [];
  for (const title of [`Handbook ${suffix}`, `Operations ${suffix}`]) {
    boards.push((await body(await page.request.post(`/api/teams/${team.id}/boards`, { data: { title, teamMemberDefaultAccess: "viewer" } }))).board);
  }
  const spaces = [];
  for (const board of boards) spaces.push((await body(await page.request.post("/api/wiki/spaces", { data: { boardId: board.boardId, title: board.title } }))).space);
  const original = content("Original document body");
  const note = (await body(await page.request.post(`/api/wiki/spaces/${spaces[0].id}/pages`, { data: { title: `Original ${suffix}`, content: { ...original, blocks: [...original.blocks, { type: "table", content: { type: "tableContent", rows: [{ cells: [[{ type: "text", text: "Review handbook", styles: {} }]] }] } }] } } }))).note;
  const viewer = randomUUID(), editor = randomUUID();
  for (const [id, role] of [[viewer, "viewer"], [editor, "editor"]]) {
    await pool.query("INSERT INTO users(id,email,username,display_name,role) VALUES($1,$2,$3,$4,'standard')", [id, `${id}@example.invalid`, id, role]);
    for (const board of boards) await pool.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,$3)", [board.boardId, id, role]);
  }
  return { suffix, team, boards, spaces, note, pool, viewer, editor, async cleanup() {
    // Task entry persists the shared admin's board preference. Restore fixture
    // state so later Notes suites choose their own board independently.
    try { await pool.query("UPDATE users SET last_selected_board_id=$2 WHERE id=$1 AND last_selected_board_id IS DISTINCT FROM $2::uuid", [admin.id, admin.last_selected_board_id]); }
    finally { await pool.end(); }
  } };
}
export async function current(page: Page, id: string) { return (await body(await page.request.get(`/api/wiki/pages/${id}`))).note; }
export async function actor(page: Page, userId: string) {
  await page.context().clearCookies();
  await page.context().addCookies([{ name: "taskboard_session", value: await createSessionCookieValue({ userId, authProvider: "authelia", reservedAdmin: false }), url: process.env.TASKBOARD_BASE_URL! }]);
}

