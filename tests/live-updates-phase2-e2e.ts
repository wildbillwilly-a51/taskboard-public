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
  login,
  readEnvFile,
} from "./helpers/taskboard-test-helpers";

// Live updates beyond the board (Phase 2), end to end: the calendar, Notes and
// the board list show changes made elsewhere within about 10 seconds, without
// a refresh, and never at the cost of what the viewer is typing or saving.
//
// Run like tests/live-updates-e2e.ts, against a disposable database and a dev
// server started with password auth:
//   TASKBOARD_BASE_URL=http://127.0.0.1:3247 TASKBOARD_APP_PASSWORD=... \
//   DATABASE_URL=postgresql://postgres:...@127.0.0.1:55447/taskboard_live_e2e \
//   node --import tsx tests/live-updates-phase2-e2e.ts

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
// Blocks the page's polling; unroute needs this same matcher to lift it.
const liveChecks = (url: URL) => url.pathname === "/api/live";

async function signIn(page: Page, path: string) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByTestId("taskboard-shell").waitFor();
  await page.goto(`${baseUrl}${path}`, { waitUntil: "networkidle" });
  await page.getByTestId("taskboard-shell").waitFor();
}

const boardCount = async (page: Page) =>
  Number(await page.getByTestId("taskboard-shell").getAttribute("data-accessible-board-count"));

async function waitFor(check: () => Promise<boolean>, message: string, timeout = LIVE_TIMEOUT_MS) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.fail(message);
}

const todayAt = (hour: number) => {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  return date.toISOString();
};

async function main() {
  await assertServerReachable(baseUrl);
  const client = await createAuthenticatedClient({ baseUrl, password });
  const cookie = await login(baseUrl, password);
  const api = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(new URL(path, baseUrl), {
      ...init,
      headers: { cookie, "Content-Type": "application/json", ...(init.headers ?? {}) },
    });
    const body = await response.json();
    assert.ok(response.ok, `${init.method ?? "GET"} ${path}: ${response.status} ${JSON.stringify(body)}`);
    return body;
  };
  const prefix = createTestPrefix("live-phase2");
  const board = await client.getBoard();
  await client.createBucket(`${prefix} Live`);
  const bucket = findBucketByTitle(await client.getBoard(), `${prefix} Live`);
  assert.ok(bucket);
  const scheduled = await client.createTask(bucket.id, `${prefix} scheduled`);
  const local = await client.createTask(bucket.id, `${prefix} local`);
  await client.patchTask(local.taskId, { startAt: todayAt(9), endAt: todayAt(10), allDay: false });

  const db = new Client({ connectionString: databaseUrl });
  await db.connect();
  const viewerId = (await db.query<{ owner_user_id: string }>(`SELECT owner_user_id FROM boards WHERE id = $1`, [board.id])).rows[0].owner_user_id;
  const otherId = randomUUID();
  const sharedBoardId = randomUUID();
  await db.query(
    `INSERT INTO users (id, email, display_name, auth_provider) VALUES ($1, $2, 'Live Phase2 Other', 'local')`,
    [otherId, `${prefix}-other@example.test`],
  );

  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    const boardPage = await context.newPage();
    const counts = { live: 0, board: 0, calendar: 0, notes: 0 };
    boardPage.on("request", (request) => {
      if (request.method() !== "GET") return;
      const path = new URL(request.url()).pathname;
      if (path === "/api/live") counts.live += 1;
      if (path === "/api/board") counts.board += 1;
      if (path === "/api/calendar/snapshot") counts.calendar += 1;
      if (path.startsWith("/api/notes")) counts.notes += 1;
    });
    await signIn(boardPage, "/");

    // 1. A board shared with the viewer appears in the board list. (Password
    // sign-in is an admin, who can open every board, so a new board is shared
    // with them by being created.)
    const before = await boardCount(boardPage);
    let started = Date.now();
    await db.query(
      `INSERT INTO boards (id, owner_user_id, board_type, personal_visibility, title) VALUES ($1, $2, 'personal', 'private', $3)`,
      [sharedBoardId, otherId, `${prefix} shared`],
    );
    await db.query(`INSERT INTO buckets (id, board_id, title, sort_order) VALUES ($1, $2, 'Shared work', 1000)`, [randomUUID(), sharedBoardId]);
    await db.query(`INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, 'editor')`, [sharedBoardId, viewerId]);
    await waitFor(async () => (await boardCount(boardPage)) === before + 1, "the shared board joins the list");
    console.log(`board shared: listed after ${Date.now() - started} ms`);

    // 2. A page showing that board loses it (here the board is deleted; lost
    // access reports the same way): a notice says so, and the board list
    // keeps updating.
    const sharedPage = await context.newPage();
    await sharedPage.goto(`${baseUrl}/?boardId=${sharedBoardId}`, { waitUntil: "networkidle" });
    await sharedPage.getByTestId("taskboard-shell").waitFor();
    assert.equal(await sharedPage.getByTestId("taskboard-shell").getAttribute("data-current-board-id"), sharedBoardId);
    started = Date.now();
    await db.query(`UPDATE users SET last_selected_board_id = NULL WHERE last_selected_board_id = $1`, [sharedBoardId]);
    await db.query(`DELETE FROM boards WHERE id = $1`, [sharedBoardId]);
    await sharedPage.getByTestId("taskboard-board-notice").filter({ hasText: "can no longer open this board" }).waitFor({ timeout: LIVE_TIMEOUT_MS });
    await waitFor(async () => (await boardCount(sharedPage)) === before, "the list drops the board on the page that lost it");
    await waitFor(async () => (await boardCount(boardPage)) === before, "and on the other page");
    console.log(`board lost: notice and list after ${Date.now() - started} ms`);
    await sharedPage.close();

    // 3. Calendar: an entry and a task scheduled elsewhere appear.
    const calendarPage = await context.newPage();
    await calendarPage.goto(`${baseUrl}/calendar`, { waitUntil: "networkidle" });
    await calendarPage.locator(".fc").first().waitFor();
    const calendarEvent = (title: string) => calendarPage.locator(".fc-event").filter({ hasText: title }).first();
    await calendarEvent(`${prefix} local`).waitFor();
    started = Date.now();
    const created = await api("/api/calendar/entries", {
      method: "POST",
      body: JSON.stringify({ boardId: board.id, title: `${prefix} entry`, startAt: todayAt(14), endAt: todayAt(15), allDay: false }),
    });
    const entryId = (created.calendarEntry ?? created.entry)?.id as string;
    assert.ok(entryId, `entry id in ${JSON.stringify(created)}`);
    await calendarEvent(`${prefix} entry`).waitFor({ timeout: LIVE_TIMEOUT_MS });
    console.log(`calendar entry created elsewhere: shown after ${Date.now() - started} ms`);
    started = Date.now();
    await client.patchTask(scheduled.taskId, { startAt: todayAt(16), endAt: todayAt(17), allDay: false });
    await calendarEvent(`${prefix} scheduled`).waitFor({ timeout: LIVE_TIMEOUT_MS });
    console.log(`task scheduled elsewhere: shown after ${Date.now() - started} ms`);

    // 4. The viewer edits that entry; someone else changes it meanwhile. The
    // calendar shows their change, the form keeps the viewer's text, and
    // saving is refused instead of overwriting theirs.
    await calendarEvent(`${prefix} entry`).click();
    const entryTitle = calendarPage.locator(".calendar-entry-form__grid label").filter({ hasText: "Title" }).locator("input").first();
    await entryTitle.waitFor();
    await entryTitle.click();
    await entryTitle.press("End");
    await entryTitle.type(" mine");
    await entryTitle.evaluate((element) => (element as HTMLElement).blur());
    await db.query(`UPDATE calendar_entries SET title = $2, updated_at = NOW() WHERE id = $1`, [entryId, `${prefix} entry theirs`]);
    await calendarEvent(`${prefix} entry theirs`).waitFor({ timeout: LIVE_TIMEOUT_MS });
    assert.equal(await entryTitle.inputValue(), `${prefix} entry mine`, "the form keeps the viewer's text");
    const saved = calendarPage.waitForResponse(
      (response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/calendar/entries/${entryId}`,
    );
    await calendarPage.getByRole("button", { name: "Save changes" }).click();
    assert.equal((await saved).status(), 409, "the save is refused as stale");
    assert.equal(
      (await db.query<{ title: string }>(`SELECT title FROM calendar_entries WHERE id = $1`, [entryId])).rows[0].title,
      `${prefix} entry theirs`,
      "a save based on the old version does not overwrite the newer one",
    );
    assert.equal(await entryTitle.inputValue(), `${prefix} entry mine`, "the refused save keeps the viewer's text");
    console.log("calendar edit overtaken elsewhere: refused, typing kept");
    await calendarPage.keyboard.press("Escape");

    // 5. A calendar change lands, then the viewer's own task save moves the
    // board's revision past it before any poll: the calendar still reloads.
    // Polling is blocked, so only the save can bring the change in.
    await calendarPage.route(liveChecks, (route) => route.abort());
    await db.query(
      `INSERT INTO calendar_entries (id, board_id, title, starts_at, ends_at, all_day, color) VALUES ($1, $2, $3, $4, $5, FALSE, '#14b8a6')`,
      [randomUUID(), board.id, `${prefix} quiet entry`, todayAt(11), todayAt(12)],
    );
    await calendarEvent(`${prefix} local`).click();
    const sidebarTitle = calendarPage.locator("[data-testid='task-editor-sidebar']").getByLabel("Title");
    await sidebarTitle.waitFor();
    await sidebarTitle.click();
    await sidebarTitle.press("End");
    await sidebarTitle.type(" saved");
    await sidebarTitle.evaluate((element) => (element as HTMLElement).blur());
    started = Date.now();
    await calendarEvent(`${prefix} quiet entry`).waitFor({ timeout: LIVE_TIMEOUT_MS });
    console.log(`calendar change behind a local save: shown after ${Date.now() - started} ms`);
    await calendarPage.unroute(liveChecks);
    // Blocked checks back off; focus checks at once, as when a viewer returns.
    await calendarPage.evaluate(() => window.dispatchEvent(new Event("focus")));

    // 5b. The viewer resizes an entry, then edits its title before any reload:
    // the save goes through, since the only change in between was their own.
    // Polling is blocked so the resize answer alone must move the form on.
    const resized = await api("/api/calendar/entries", {
      method: "POST",
      body: JSON.stringify({ boardId: board.id, title: `${prefix} resized`, startAt: todayAt(12), endAt: todayAt(13), allDay: false }),
    });
    const resizedId = (resized.calendarEntry ?? resized.entry)?.id as string;
    await calendarEvent(`${prefix} resized`).waitFor({ timeout: LIVE_TIMEOUT_MS });
    await calendarPage.route(liveChecks, (route) => route.abort());
    await calendarEvent(`${prefix} resized`).click();
    await entryTitle.waitFor();
    const handle = calendarPage.getByLabel(`Adjust end time for ${prefix} resized`).first();
    await handle.focus();
    const scheduleSaved = calendarPage.waitForResponse(
      (response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/calendar/entries/${resizedId}/schedule`,
    );
    await calendarPage.keyboard.press("ArrowDown");
    await calendarPage.keyboard.press("Enter");
    assert.equal((await scheduleSaved).status(), 200, "the resize saves");
    await entryTitle.click();
    await entryTitle.press("End");
    await entryTitle.type(" after");
    await entryTitle.evaluate((element) => (element as HTMLElement).blur());
    const titleSaved = calendarPage.waitForResponse(
      (response) => response.request().method() === "PATCH" && new URL(response.url()).pathname === `/api/calendar/entries/${resizedId}`,
    );
    await calendarPage.getByRole("button", { name: "Save changes" }).click();
    assert.equal((await titleSaved).status(), 200, "an edit after the viewer's own resize is not refused");
    await calendarPage.unroute(liveChecks);
    await calendarPage.evaluate(() => window.dispatchEvent(new Event("focus")));
    console.log("own resize then edit: saved");

    // 5c. An entry being edited is deleted elsewhere: the typing stays, as a
    // new item the viewer can create again.
    const doomed = await api("/api/calendar/entries", {
      method: "POST",
      body: JSON.stringify({ boardId: board.id, title: `${prefix} doomed`, startAt: todayAt(13), endAt: todayAt(14), allDay: false }),
    });
    const doomedId = (doomed.calendarEntry ?? doomed.entry)?.id as string;
    await calendarEvent(`${prefix} doomed`).waitFor({ timeout: LIVE_TIMEOUT_MS });
    await calendarEvent(`${prefix} doomed`).click();
    await entryTitle.waitFor();
    await entryTitle.click();
    await entryTitle.press("End");
    await entryTitle.type(" kept");
    await entryTitle.evaluate((element) => (element as HTMLElement).blur());
    await db.query(`UPDATE calendar_entries SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1`, [doomedId]);
    await calendarPage.getByText("deleted elsewhere").first().waitFor({ timeout: LIVE_TIMEOUT_MS });
    assert.equal(await entryTitle.inputValue(), `${prefix} doomed kept`, "the typing survives the deletion");
    console.log("entry deleted while edited: typing kept");
    await calendarPage.close();

    // 6. Notes: a note created elsewhere joins the list; the open note follows
    // changes while idle and keeps the viewer's typing otherwise.
    const notesPage = await context.newPage();
    await notesPage.goto(`${baseUrl}/notes`, { waitUntil: "networkidle" });
    await notesPage.getByTestId("notes-workspace").waitFor();
    started = Date.now();
    const createdNote = await api("/api/notes", { method: "POST", body: JSON.stringify({ title: `${prefix} note` }) });
    const noteId = createdNote.note.id as string;
    let version = createdNote.note.contentVersion as number;
    const row = notesPage.locator(`[data-note-row="${noteId}"]`);
    await row.waitFor({ timeout: LIVE_TIMEOUT_MS });
    console.log(`note created elsewhere: listed after ${Date.now() - started} ms`);
    // The list request fails once (as if the server hiccuped) while another
    // note is created elsewhere: the list is tried again and shows it.
    let failedLists = 0;
    const listRequests = (url: URL) => url.pathname === "/api/notes";
    await notesPage.route(listRequests, (route) => {
      if (route.request().method() === "GET" && failedLists === 0) {
        failedLists += 1;
        return route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Temporarily unavailable." }) });
      }
      return route.continue();
    });
    started = Date.now();
    const retried = await api("/api/notes", { method: "POST", body: JSON.stringify({ title: `${prefix} after hiccup` }) });
    await notesPage.locator(`[data-note-row="${retried.note.id}"]`).waitFor({ timeout: LIVE_TIMEOUT_MS + 25_000 });
    assert.equal(failedLists, 1, "one list request failed");
    await notesPage.unroute(listRequests);
    console.log(`note list failed once: shown after ${Date.now() - started} ms`);

    await row.click();
    const noteTitle = notesPage.getByTestId("note-editor-pane").getByLabel("Note title");
    await waitFor(async () => (await noteTitle.inputValue()) === `${prefix} note`, "the note opens");
    // Leave the title so the page is idle.
    await noteTitle.evaluate((element) => (element as HTMLElement).blur());

    started = Date.now();
    const renamed = await api(`/api/notes/${noteId}`, {
      method: "PATCH",
      body: JSON.stringify({ title: `${prefix} note theirs`, expectedVersion: version }),
    });
    version = renamed.note.contentVersion;
    await waitFor(async () => (await noteTitle.inputValue()) === `${prefix} note theirs`, "the idle open note follows");
    console.log(`open note changed elsewhere: shown after ${Date.now() - started} ms`);

    await noteTitle.click();
    await noteTitle.press("End");
    await noteTitle.type(" mine");
    await api(`/api/notes/${noteId}`, {
      method: "PATCH",
      body: JSON.stringify({ title: `${prefix} note theirs again`, expectedVersion: version }),
    });
    await notesPage.waitForTimeout(13_000);
    assert.equal(await noteTitle.inputValue(), `${prefix} note theirs mine`, "typing is never replaced");
    await noteTitle.evaluate((element) => (element as HTMLElement).blur());
    await notesPage.locator(".notes-conflict").filter({ hasText: "changed since you opened it" }).waitFor({ timeout: 10_000 });
    assert.equal(
      (await db.query<{ title: string }>(`SELECT title FROM notes WHERE id = $1`, [noteId])).rows[0].title,
      `${prefix} note theirs again`,
      "their change is not overwritten",
    );
    assert.equal(await noteTitle.inputValue(), `${prefix} note theirs mine`, "the viewer's text is still there to keep or drop");
    console.log("note typed in while changed elsewhere: typing kept, conflict shown");
    await notesPage.close();

    // 7. Nothing changes: the board page only polls.
    const snapshot = { ...counts };
    await boardPage.waitForTimeout(25_000);
    assert.equal(counts.board, snapshot.board, "no board reloads");
    assert.equal(counts.calendar, snapshot.calendar, "no calendar reloads");
    assert.equal(counts.notes, snapshot.notes, "no notes reloads");
    assert.ok(counts.live - snapshot.live >= 1, "the page keeps polling");
    console.log(`idle 25 s: ${counts.live - snapshot.live} live checks, nothing reloaded`);
  } finally {
    await db.query(`DELETE FROM boards WHERE id = $1`, [sharedBoardId]).catch(() => {});
    await db.query(`DELETE FROM notes WHERE owner_user_id = $1`, [otherId]).catch(() => {});
    await db.query(`DELETE FROM users WHERE id = $1`, [otherId]).catch(() => {});
    await db.end();
    await browser.close();
  }
}

main().then(
  () => console.log("live updates phase 2 e2e: passed"),
  (error) => {
    console.error(error);
    process.exitCode = 1;
  },
);
