import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { chromium, type Page } from "playwright-core";
import {
  assertServerReachable,
  createAuthenticatedClient,
  createTestPrefix,
  findBucketByTitle,
  findTaskByTitle,
  readEnvFile,
} from "./helpers/taskboard-test-helpers";

// Live board updates end to end: a page that is left open shows changes made
// elsewhere within about 10 seconds, without a refresh, and never at the cost
// of what its viewer is typing.
//
// Run against a disposable database and a dev server started with password
// auth, for example:
//   TASKBOARD_BASE_URL=http://127.0.0.1:3247 TASKBOARD_APP_PASSWORD=... \
//   DATABASE_URL=postgresql://postgres:...@127.0.0.1:55447/taskboard_live_e2e \
//   node --import tsx tests/live-updates-e2e.ts
// DATABASE_URL must be able to create a role: one write goes through a role
// with narrow grants.

const baseUrl = process.env.TASKBOARD_BASE_URL ?? "http://127.0.0.1:3247";
const env = readEnvFile(".env");
const password = process.env.TASKBOARD_APP_PASSWORD ?? env.TASKBOARD_APP_PASSWORD ?? "";
const databaseUrl = process.env.DATABASE_URL ?? env.DATABASE_URL ?? "";
const chromePath =
  process.env.PLAYWRIGHT_CHROME_PATH ??
  [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].find((candidate) => existsSync(candidate));

assert.ok(chromePath, "Chrome or Edge was not found. Set PLAYWRIGHT_CHROME_PATH.");
assert.ok(password, "TASKBOARD_APP_PASSWORD is required.");
assert.ok(databaseUrl, "DATABASE_URL is required.");

const LIVE_TIMEOUT_MS = 16_000;

async function openBoard(page: Page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByTestId("taskboard-shell").waitFor();
  const expandAll = page.getByRole("button", { name: "Expand all visible buckets" });
  if ((await expandAll.count()) === 1) await expandAll.click();
}

const card = (page: Page, title: string) => page.getByTestId("task-card").filter({ hasText: title }).first();

async function main() {
  await assertServerReachable(baseUrl);
  const client = await createAuthenticatedClient({ baseUrl, password });
  const prefix = createTestPrefix("live-updates");
  await client.createBucket(`${prefix} Live`);
  const bucket = findBucketByTitle(await client.getBoard(), `${prefix} Live`);
  assert.ok(bucket);
  const first = await client.createTask(bucket.id, `${prefix} first`);
  const second = await client.createTask(bucket.id, `${prefix} second`);
  const toggled = await client.createTask(bucket.id, `${prefix} toggled`);
  const archived = await client.createTask(bucket.id, `${prefix} archived`);
  const moved = await client.createTask(bucket.id, `${prefix} moved`);
  const overtaken = await client.createTask(bucket.id, `${prefix} overtaken`);
  const failing = await client.createTask(bucket.id, `${prefix} failing`);
  await client.createBucket(`${prefix} Elsewhere`);
  const elsewhere = findBucketByTitle(await client.getBoard(), `${prefix} Elsewhere`);
  assert.ok(elsewhere);

  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  const role = `tb_live_e2e_${randomUUID().replaceAll("-", "").slice(0, 10)}`;

  try {
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 } })).newPage();
    let boardLoads = 0;
    let revisionChecks = 0;
    page.on("request", (request) => {
      const url = new URL(request.url());
      if (request.method() !== "GET") return;
      if (url.pathname === "/api/board") boardLoads += 1;
      if (url.pathname === "/api/live") revisionChecks += 1;
    });
    await openBoard(page);
    await card(page, `${prefix} first`).waitFor();

    // 1. Another device creates and renames tasks: both appear unrefreshed.
    let started = Date.now();
    await client.createTask(bucket.id, `${prefix} created elsewhere`);
    await card(page, `${prefix} created elsewhere`).waitFor({ timeout: LIVE_TIMEOUT_MS });
    console.log(`created elsewhere: shown after ${Date.now() - started} ms`);

    started = Date.now();
    await client.patchTask(second.taskId, { title: `${prefix} second renamed` });
    await card(page, `${prefix} second renamed`).waitFor({ timeout: LIVE_TIMEOUT_MS });
    console.log(`renamed elsewhere: shown after ${Date.now() - started} ms`);

    // 2. A direct database write by a narrowly granted role (as the Taskboard
    // writes from another client) appears the same way.
    await db.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT`);
    await db.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await db.query(`GRANT SELECT, UPDATE ON tasks TO ${role}`);
    started = Date.now();
    await db.query("BEGIN");
    await db.query(`SET LOCAL ROLE ${role}`);
    await db.query(`UPDATE tasks SET title = $2, updated_at = NOW() WHERE id = $1`, [second.taskId, `${prefix} second via mcp`]);
    await db.query("COMMIT");
    await card(page, `${prefix} second via mcp`).waitFor({ timeout: LIVE_TIMEOUT_MS });
    console.log(`restricted database write: shown after ${Date.now() - started} ms`);

    // 3. While the viewer types in a task, the board waits; a status change
    // made elsewhere meanwhile survives the viewer's own save.
    await card(page, `${prefix} first`).click();
    const title = page.locator("[data-testid='task-editor-sidebar']").getByLabel("Title");
    await title.click();
    await client.patchTask(first.taskId, { status: "waiting" });
    await client.patchTask(second.taskId, { title: `${prefix} second while typing` });
    await page.waitForTimeout(13_000);
    assert.equal(await card(page, `${prefix} second while typing`).count(), 0, "no reload while typing");
    await title.fill(`${prefix} first edited`);
    await page.waitForTimeout(1_500);
    await title.evaluate((element) => (element as HTMLElement).blur());
    await card(page, `${prefix} second while typing`).waitFor({ timeout: LIVE_TIMEOUT_MS });
    const saved = findTaskByTitle(await client.getBoard(), `${prefix} first edited`);
    assert.ok(saved, "the viewer's title edit was saved");
    assert.equal(saved.status, "waiting", "the status changed elsewhere was not written back");
    assert.equal(await title.inputValue(), `${prefix} first edited`, "the editor kept the viewer's text");
    console.log("typing guard and changed-fields-only save: ok");

    const sidebar = page.locator("[data-testid='task-editor-sidebar']");
    const statusButton = (status: string) =>
      sidebar.locator(`[data-testid='task-inspector-status-button'][data-status='${status}']`);
    const statusOf = async (taskId: string) =>
      (await db.query<{ status: string }>(`SELECT status FROM tasks WHERE id = $1`, [taskId])).rows[0].status;

    // 4. Taking a change back before its save returns. The first save
    // (Waiting) is answered after 3 s, the second (To do) after 9 s; while the
    // second is still out, the viewer edits the title. To do must win.
    await card(page, `${prefix} toggled`).click();
    await statusButton("todo").waitFor();
    const holds = [3_000, 9_000];
    await page.route(
      (url) => url.pathname === `/api/tasks/${toggled.taskId}`,
      async (route) => {
        const hold = route.request().method() === "PATCH" ? holds.shift() : undefined;
        if (hold === undefined) return route.continue();
        const response = await route.fetch();
        await new Promise((resolve) => setTimeout(resolve, hold));
        await route.fulfill({ response });
      },
    );
    await statusButton("waiting").click();
    await statusButton("todo").click();
    await page.waitForTimeout(4_500);
    const toggledTitle = sidebar.getByLabel("Title");
    await toggledTitle.click();
    await toggledTitle.press("End");
    await toggledTitle.pressSequentially(" edited", { delay: 30 });
    await page.waitForTimeout(1_500);
    await toggledTitle.evaluate((element) => (element as HTMLElement).blur());
    await page.waitForTimeout(9_000);
    assert.equal(await statusOf(toggled.taskId), "todo", "the change taken back was saved");
    assert.equal(await statusButton("todo").getAttribute("aria-pressed"), "true", "and is shown");
    assert.equal(
      (await db.query<{ title: string }>(`SELECT title FROM tasks WHERE id = $1`, [toggled.taskId])).rows[0].title,
      `${prefix} toggled edited`,
      "the title edit made meanwhile was saved",
    );
    await page.unroute((url) => url.pathname === `/api/tasks/${toggled.taskId}`);
    console.log("change taken back during slow saves, with an edit meanwhile: ok");

    // 5. A slow save response must not undo a newer live reload: the archive
    // response is held for 16 s while another device renames a task.
    await card(page, `${prefix} archived`).click();
    const archivePath = `/api/tasks/${archived.taskId}/archive`;
    let archiveSaved = false;
    let archiveResponded = false;
    await page.route(
      (url) => url.pathname === archivePath,
      async (route) => {
        const response = await route.fetch();
        archiveSaved = true;
        await new Promise((resolve) => setTimeout(resolve, 16_000));
        await route.fulfill({ response });
        archiveResponded = true;
      },
    );
    await sidebar.getByRole("button", { name: "Task actions" }).click();
    await page.getByRole("button", { name: "Archive", exact: true }).click();
    // Rename only once the archive is saved, so its held response is older.
    while (!archiveSaved) await page.waitForTimeout(100);
    await client.patchTask(second.taskId, { title: `${prefix} second after archive` });
    await card(page, `${prefix} second after archive`).waitFor({ timeout: LIVE_TIMEOUT_MS });
    while (!archiveResponded) await page.waitForTimeout(250);
    await page.waitForTimeout(2_000);
    assert.equal(await card(page, `${prefix} second after archive`).count(), 1, "the older snapshot was not applied");
    await page.unroute((url) => url.pathname === archivePath);
    console.log("slow save response after a newer reload: ok");

    // 6. A move made elsewhere while the viewer types in that task keeps
    // the typing.
    await card(page, `${prefix} moved`).click();
    const movedTitle = sidebar.getByLabel("Title");
    await movedTitle.click();
    await movedTitle.press("End");
    await movedTitle.pressSequentially(" typed", { delay: 30 });
    await client.moveTask(moved.taskId, elsewhere.id, 0);
    await page.waitForTimeout(1_000);
    await movedTitle.pressSequentially(" more", { delay: 30 });
    await movedTitle.evaluate((element) => (element as HTMLElement).blur());
    await page.waitForTimeout(13_000);
    const movedSaved = (await db.query<{ title: string; bucket_id: string }>(
      `SELECT title, bucket_id FROM tasks WHERE id = $1`,
      [moved.taskId],
    )).rows[0];
    assert.equal(movedSaved.title, `${prefix} moved typed more`, "the typing was saved");
    assert.equal(movedSaved.bucket_id, elsewhere.id, "the move made elsewhere stayed");
    assert.equal(await movedTitle.inputValue(), `${prefix} moved typed more`, "the editor kept the typing");
    console.log("move made elsewhere while typing: ok");

    // 7. A save answered after a newer snapshot: in the task workspace, the
    // viewer sets Waiting (its answer held), another device sets To do, and a
    // checklist add brings a newer snapshot first. The editor must show To do
    // again, and a later title edit must not send Waiting back.
    await card(page, `${prefix} overtaken`).click();
    await sidebar.getByRole("button", { name: "Open Task Workspace" }).click();
    const workspace = page.locator("[data-testid='task-editor-expanded']");
    await workspace.waitFor();
    const workspaceStatus = (status: string) =>
      workspace.locator(`[data-testid='task-overview-status-button'][data-status='${status}']`);
    const overtakenPath = `/api/tasks/${overtaken.taskId}`;
    let overtakenSaved = false;
    let releaseOvertaken = () => {};
    const released = new Promise<void>((resolve) => { releaseOvertaken = resolve; });
    let heldOvertaken = false;
    await page.route(
      (url) => url.pathname === overtakenPath,
      async (route) => {
        if (route.request().method() !== "PATCH" || heldOvertaken) return route.continue();
        heldOvertaken = true;
        const response = await route.fetch();
        overtakenSaved = true;
        await released;
        await route.fulfill({ response });
      },
    );
    await workspaceStatus("waiting").click();
    while (!overtakenSaved) await page.waitForTimeout(100);
    await client.patchTask(overtaken.taskId, { status: "todo" });
    const checklistInput = workspace.getByPlaceholder("Add checklist item");
    await checklistInput.fill(`${prefix} probe item`);
    await checklistInput.press("Enter");
    await workspace.getByText(`${prefix} probe item`).waitFor();
    releaseOvertaken();
    await page.waitForTimeout(2_000);
    assert.equal(await workspaceStatus("todo").getAttribute("aria-pressed"), "true", "the editor shows the newer To do");
    const workspaceTitle = workspace.getByTestId("task-overview-title-input");
    await workspaceTitle.click();
    await workspaceTitle.press("End");
    await workspaceTitle.pressSequentially(" later", { delay: 30 });
    await workspaceTitle.evaluate((element) => (element as HTMLElement).blur());
    await page.waitForTimeout(3_000);
    const overtakenRow = (await db.query<{ status: string; title: string }>(
      `SELECT status, title FROM tasks WHERE id = $1`,
      [overtaken.taskId],
    )).rows[0];
    assert.equal(overtakenRow.title, `${prefix} overtaken later`, "the later title edit was saved");
    assert.equal(overtakenRow.status, "todo", "the overtaken Waiting was not sent back");
    await page.unroute((url) => url.pathname === overtakenPath);
    await page.keyboard.press("Escape");
    console.log("save answered after a newer snapshot: ok");

    // 8. A save that fails keeps the typing in both editors, ready to retry.
    const failingPath = `/api/tasks/${failing.taskId}`;
    await page.route(
      (url) => url.pathname === failingPath,
      async (route) => route.request().method() === "PATCH"
        ? route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Test failure." }) })
        : route.continue(),
    );
    const typeAndBlur = async (field: ReturnType<Page["locator"]>, text: string) => {
      await field.click();
      await field.press("End");
      await field.pressSequentially(text, { delay: 30 });
      await field.evaluate((element) => (element as HTMLElement).blur());
      await page.waitForTimeout(2_500);
    };
    await card(page, `${prefix} failing`).click();
    const failingSidebarTitle = sidebar.getByLabel("Title");
    await typeAndBlur(failingSidebarTitle, " unsaved");
    assert.equal(await failingSidebarTitle.inputValue(), `${prefix} failing unsaved`, "the sidebar keeps text whose save failed");
    await sidebar.getByRole("button", { name: "Open Task Workspace" }).click();
    const failingWorkspaceTitle = workspace.getByTestId("task-overview-title-input");
    await failingWorkspaceTitle.waitFor();
    await typeAndBlur(failingWorkspaceTitle, " again");
    assert.match(await failingWorkspaceTitle.inputValue(), / again$/, "the workspace keeps text whose save failed");
    assert.equal(
      (await db.query<{ title: string }>(`SELECT title FROM tasks WHERE id = $1`, [failing.taskId])).rows[0].title,
      `${prefix} failing`,
      "nothing was saved",
    );
    await page.unroute((url) => url.pathname === failingPath);
    await page.keyboard.press("Escape");
    console.log("failed saves keep the typing: ok");

    // 9. Nothing changes: no board reloads, only cheap revision checks.
    const loadsBefore = boardLoads;
    const checksBefore = revisionChecks;
    await page.waitForTimeout(25_000);
    assert.equal(boardLoads, loadsBefore, "an idle board does not reload");
    assert.ok(revisionChecks - checksBefore >= 1, "the page keeps checking the revision");
    console.log(`idle 25 s: ${boardLoads - loadsBefore} board loads, ${revisionChecks - checksBefore} revision checks`);
  } finally {
    await db.query("ROLLBACK").catch(() => {});
    await db.query(`DROP OWNED BY ${role}`).catch(() => {});
    await db.query(`DROP ROLE IF EXISTS ${role}`).catch(() => {});
    await db.end();
    await browser.close();
  }
}

main().then(
  () => console.log("live updates e2e: passed"),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
