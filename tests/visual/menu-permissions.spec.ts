import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { AUTH_COOKIE_NAME, createSessionCookieValue } from "../../src/lib/auth";
import { getPool } from "../../src/lib/db";
import { isLocalVisualDatabase } from "../helpers/visual-database";

// Real member sessions and database grants exercise the UI and server together.
// Opt in with DATABASE_URL, the fixture AUTH_SECRET and
// TASKBOARD_TEAM_LIFECYCLE_MANAGERS=enabled on both runner and local server.
test.use({ viewport: { width: 1440, height: 1000 }, isMobile: false, hasTouch: false });
test.setTimeout(90_000);
test.skip(!process.env.DATABASE_URL || !process.env.AUTH_SECRET || process.env.TASKBOARD_TEAM_LIFECYCLE_MANAGERS !== "enabled",
  "Requires an isolated fixture database, its signing secret and enabled team lifecycle restrictions.");

type Fixture = { editorBoardId: string; viewerBoardId: string; taskId: string; viewerTaskId: string; userId: string; teamId: string; boardTitle: string };
let fixture: Fixture;
const card = (page: Page, id: string) => page.locator(`[data-task-nav="${id}"]`);
const menu = (page: Page) => page.getByRole("menu", { name: "Task actions", exact: true });

test.beforeAll(async () => {
  expect(isLocalVisualDatabase(new URL(process.env.DATABASE_URL!))).toBe(true);
  expect(process.env.TASKBOARD_TEAM_LIFECYCLE_MANAGERS).toBe("enabled");
  fixture = JSON.parse(execFileSync(process.execPath,
    ["--conditions", "react-server", "--import", "tsx", "tests/helpers/menu-permission-fixture.ts"],
    { cwd: process.cwd(), env: process.env, encoding: "utf8", timeout: 60_000 },
  )) as Fixture;
});

test.beforeEach(async ({ page, baseURL }) => {
  const value = await createSessionCookieValue({ userId: fixture.userId, authProvider: "local", reservedAdmin: false });
  await page.context().addCookies([{ name: AUTH_COOKIE_NAME, value, url: baseURL! }]);
});

test.afterAll(async () => {
  if (!fixture) return;
  const pool = getPool();
  if (pool) {
    await pool.query("DELETE FROM boards WHERE owner_team_id = $1 OR owner_user_id = $2", [fixture.teamId, fixture.userId]);
    await pool.query("DELETE FROM teams WHERE id = $1", [fixture.teamId]);
    await pool.query("DELETE FROM users WHERE id = $1", [fixture.userId]);
  }
  await pool?.end();
});

test("a team editor changes status but cannot archive or delete through menus", async ({ page }) => {
  await page.goto(`/?boardId=${fixture.editorBoardId}`);
  await card(page, fixture.taskId).click({ button: "right" });
  for (const action of ["Archive", "Delete"]) {
    const item = menu(page).getByRole("menuitem", { name: action, exact: true });
    await expect(item).toBeDisabled();
    await expect(item).toHaveAttribute("title", /Only a team manager/);
  }
  await menu(page).getByRole("menuitemradio", { name: "Active", exact: true }).click();
  const readTask = async () => (await (await page.request.get(`/api/board?boardId=${fixture.editorBoardId}`)).json()).board.buckets.flatMap((b: { tasks: { id: string; status: string }[] }) => b.tasks).find((t: { id: string }) => t.id === fixture.taskId);
  await expect.poll(async () => (await readTask()).status).toBe("active");
  expect((await page.request.post(`/api/tasks/${fixture.taskId}/archive`, { data: { boardId: fixture.editorBoardId } })).ok()).toBe(false);
  expect((await page.request.delete(`/api/tasks/${fixture.taskId}?boardId=${fixture.editorBoardId}`)).ok()).toBe(false);
  expect(await readTask()).toBeTruthy();
});

test("switching to a view-only board closes the old menu and disables editing", async ({ page }) => {
  await page.goto(`/?boardId=${fixture.editorBoardId}`);
  await card(page, fixture.taskId).click({ button: "right" });
  await expect(menu(page)).toBeVisible();
  await page.getByTestId("board-switcher-shell").getByRole("button").first().click();
  const picker = page.getByRole("dialog", { name: "Board picker" });
  await expect(picker).toBeVisible();
  await picker.getByRole("button").filter({ hasText: fixture.boardTitle }).click();
  await expect(menu(page)).toHaveCount(0);
  await card(page, fixture.viewerTaskId).click({ button: "right" });
  await expect(menu(page).getByRole("menuitem", { name: "Open", exact: true })).toBeEnabled();
  for (const action of ["Archive", "Delete", "Move to bucket…", "Set due date…"]) {
    await expect(menu(page).getByRole("menuitem", { name: action, exact: true })).toBeDisabled();
  }
  await expect(menu(page).getByRole("menuitemradio", { name: "Active", exact: true })).toBeDisabled();
  expect((await page.request.patch(`/api/tasks/${fixture.viewerTaskId}`, { data: { boardId: fixture.viewerBoardId, status: "active" } })).ok()).toBe(false);
});
