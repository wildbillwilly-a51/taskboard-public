import { test, expect, type Page } from "@playwright/test";
import { seed, body, current, actor, content } from "../helpers/wiki-real-fixture";
import { createSessionCookieValue } from "../../src/lib/auth";

const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }, info) => {
  const list: string[] = []; errors.set(page, list);
  page.on("pageerror", error => list.push(error.message));
  page.on("response", response => { if (response.status() >= 500) list.push(`HTTP ${response.status()}: ${new URL(response.url()).pathname}`); });
  page.on("console", message => {
    if (/hydration|didn't match|did not match/i.test(message.text())
      || (message.type() === "error" && !/Failed to load resource|net::ERR_FAILED|net::ERR_ABORTED/i.test(message.text()))) list.push(message.text());
  });
  await page.addInitScript(theme => localStorage.setItem("taskboard-ui-settings", JSON.stringify({ theme })), info.project.name.endsWith("light") ? "light" : "dark");
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

test("real space creation, page writing, files, history restore, move, copy, search and archive", async ({ page }, info) => {
  const f = await seed(page);
  try {
    // Create an additional eligible team board, then create its space in the UI.
    const board = (await body(await page.request.post(`/api/teams/${f.team.id}/boards`, { data: { title: `UI board ${f.suffix}` } }))).board;
    await page.goto("/wiki");
    expect(await page.title()).toContain("Taskboard");
    await expect(page.locator("html")).toHaveAttribute("data-theme", info.project.name.endsWith("light") ? "light" : "dark");
    await page.getByRole("button", { name: "Create space", exact: true }).click();
    await page.getByRole("combobox", { name: "Team board", exact: true }).selectOption(board.boardId);
    await page.getByLabel("Space title", { exact: true }).fill(`UI space ${f.suffix}`);
    await page.getByLabel("Description", { exact: true }).fill("Created through real browser auth");
    await page.locator("form.wiki-panel").getByRole("button", { name: "Create space", exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(`UI space ${f.suffix}`);
    await page.getByRole("button", { name: "New page", exact: true }).click();
    const count = async () => Number((await f.pool.query("SELECT count(*) FROM notes WHERE title=$1", [`Typed ${f.suffix}`])).rows[0].count);
    expect(await count()).toBe(0);
    await page.getByRole("textbox", { name: "Page title", exact: true }).fill(`Typed ${f.suffix}`);
    await expect(page).toHaveURL(/\/wiki\/[^/]+\/[0-9a-f-]{36}-.*/);
    await expect(page.locator(".wiki-edit .bn-editor")).toBeVisible();
    await page.locator(".wiki-edit .bn-editor").pressSequentially("Browser-written knowledge and decisions.");
    await expect(page.locator(".wiki-save-status")).toHaveText("Saved");
    await pageSurface(page);
    await expect(page.locator(".wiki-edit .bn-editor")).toContainText("Browser-written knowledge");
    await page.getByRole("region", { name: "Current files" }).locator('input[type="file"]').setInputFiles({ name: "browser-proof.txt", mimeType: "text/plain", buffer: Buffer.from("Independent real upload bytes") });
    await expect(page.getByRole("link", { name: "browser-proof.txt", exact: true })).toBeVisible();
    const href = await page.getByRole("link", { name: "browser-proof.txt", exact: true }).getAttribute("href");
    expect(await (await page.request.get(href!)).text()).toBe("Independent real upload bytes");
    await page.screenshot({ path: info.outputPath("written-page-with-file.png"), fullPage: true });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Exercise snapshots and the manual barrier using the independently seeded page.
    await page.goto(f.note.wiki.canonicalHref + "?mode=edit");
    await page.getByRole("textbox", { name: "Page title", exact: true }).fill(`Edited ${f.suffix}`);
    await expect.poll(async () => (await current(page, f.note.id)).title).toBe(`Edited ${f.suffix}`);
    await pageAction(page, "History");
    await page.getByRole("button", { name: /Version 1 ·/ }).click();
    await expect(page.getByRole("heading", { name: `Original ${f.suffix}`, exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("history-preview.png"), fullPage: true });
    await page.getByRole("button", { name: "Restore version 1", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Restore version", exact: true }).click();
    await expect.poll(async () => (await current(page, f.note.id)).title).toBe(`Original ${f.suffix}`);
    await expect(page).not.toHaveURL(/view=history/);
    await expect(page.locator(".wiki-edit .bn-editor")).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Page title", exact: true })).toHaveValue(`Original ${f.suffix}`);
    await expect(page.locator(".wiki-edit .bn-editor")).toContainText("Original document body");
    await pageSurface(page);
    await pageAction(page, "Move to space…");
    await page.getByRole("combobox", { name: "Destination space", exact: true }).selectOption(f.spaces[1].id);
    await page.getByRole("button", { name: "Move page", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toContainText(f.boards[1].title);
    await page.getByRole("alertdialog").getByRole("button", { name: "Move page", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/wiki/${f.spaces[1].slug}/`));
    await pageAction(page, "Copy to my notes");
    await expect(page).toHaveURL(/\/notes\?note=/);
    const copiedId = new URL(page.url()).searchParams.get("note")!;
    const copied = (await body(await page.request.get(`/api/notes/${copiedId}`))).note;
    expect(copied.wiki).toBeFalsy(); expect(copied.home.kind).toBe("personal");
    await page.goto(`/wiki/${f.spaces[1].slug}`);
    await page.getByRole("searchbox", { name: "Search this space", exact: true }).fill(f.suffix);
    await page.getByRole("button", { name: "Search", exact: true }).click();
    await expect(page.getByRole("region", { name: "Search results", exact: true }).getByRole("link", { name: new RegExp(`^Original ${f.suffix}`) })).toBeVisible();
    await page.getByRole("button", { name: "Space settings", exact: true }).click();
    await page.getByRole("button", { name: "Archive space", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Archive space", exact: true }).click();
    await expect(page.getByText(/Archived space\. Pages are read only/)).toBeVisible();
    await page.goto((await current(page, f.note.id)).wiki.canonicalHref);
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("archived-readonly.png"), fullPage: true });
  } finally { await f.cleanup(); }
});

test("real file checkpoints, removed history, manager deletion, trash and recovery", async ({ page }, info) => {
  const f = await seed(page);
  try {
    await page.goto(f.note.wiki.canonicalHref);
    await expect(page.locator(".wiki-edit .bn-editor")).toBeVisible();
    await expect(page.getByRole("region", { name: "Current files" }).locator('input[type="file"]')).toBeEnabled();
    await page.getByRole("region", { name: "Current files" }).locator('input[type="file"]').setInputFiles({ name: "history-file.txt", mimeType: "text/plain", buffer: Buffer.from("Historical file bytes") });
    await expect(page.getByRole("link", { name: "history-file.txt", exact: true })).toBeVisible();
    const uploaded = await current(page, f.note.id);
    expect(uploaded.contentVersion).toBe(f.note.contentVersion);
    const fileId = uploaded.attachments[0].id;
    await page.getByRole("region", { name: "Current files" }).getByRole("button", { name: "Remove", exact: true }).click();
    await expect(page.getByRole("link", { name: "history-file.txt", exact: true })).toHaveCount(0);
    expect(await (await page.request.get(`/api/notes/${f.note.id}/attachments/${fileId}`)).text()).toBe("Historical file bytes");
    await page.getByRole("region", { name: "Current files" }).locator('input[type="file"]').setInputFiles({ name: "delete-now.txt", mimeType: "text/plain", buffer: Buffer.from("Delete through the manager UI") });
    await expect(page.getByRole("link", { name: "delete-now.txt", exact: true })).toBeVisible();
    await page.getByRole("region", { name: "Current files" }).getByRole("button", { name: "Delete permanently", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toContainText("old versions");
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete permanently", exact: true }).click();
    await expect(page.getByRole("link", { name: "delete-now.txt", exact: true })).toHaveCount(0);
    await pageAction(page, "History");
    await page.getByRole("button", { name: /Version 2 ·/ }).click();
    await expect(page.getByText("· Removed from current files", { exact: false })).toBeVisible();
    await body(await page.request.delete(`/api/notes/${f.note.id}/attachments/${fileId}?permanent=1`));
    await page.reload();
    await expect(page.getByText("File unavailable", { exact: true }).first()).toBeVisible();
    await page.screenshot({ path: info.outputPath("historical-file-unavailable.png"), fullPage: true });
    await pageSurface(page);
    await pageAction(page, "Move to trash");
    await page.getByRole("alertdialog").getByRole("button", { name: "Move to trash", exact: true }).click();
    await expect(page).toHaveURL(/status=trash/);
    await page.goto(f.note.wiki.canonicalHref);
    await expect(page.getByRole("button", { name: "Copy to my notes", exact: true })).toHaveCount(0);
    await pageAction(page, "Restore from trash");
    await expect(page.getByRole("textbox", { name: "Page title", exact: true })).toBeEnabled();
    await actor(page, f.editor); await page.reload();
    await expect(page.getByRole("button", { name: "Delete permanently", exact: true })).toHaveCount(0);
    expect((await page.request.delete(`/api/notes/${f.note.id}/permanent`)).ok()).toBe(false);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await body(await page.request.post("/api/auth/login", { data: { password: process.env.TASKBOARD_VISUAL_PASSWORD ?? (process.env.TASKBOARD_WIKI_P2_REAL === "1" ? "wiki-p2-ui-fixture" : "visual-test-password") } }));
    await page.reload();
    await pageAction(page, "Move to trash");
    await page.getByRole("alertdialog").getByRole("button", { name: "Move to trash", exact: true }).click();
    await expect(page).toHaveURL(/status=trash/);
    await page.goto(f.note.wiki.canonicalHref);
    await pageAction(page, "Delete permanently");
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete permanently", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/wiki/${f.spaces[0].slug}$`));
    expect((await page.request.get(`/api/wiki/pages/${f.note.id}`)).status()).toBe(404);
    await page.getByRole("button", { name: "Space settings", exact: true }).click();
    await page.getByRole("button", { name: "Remove empty space", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove space", exact: true }).click();
    await expect(page).toHaveURL(/\/wiki$/);
  } finally { await f.cleanup(); }
});

test("real untouched draft, command capture, delayed creation navigation and phone focus", async ({ page }, info) => {
  const f = await seed(page);
  let release = () => {};
  try {
    await page.goto(`/wiki?new=1&spaceId=${f.spaces[0].id}`);
    await expect(page.getByRole("region", { name: "New wiki page" })).toBeVisible();
    expect(Number((await f.pool.query("SELECT count(*) FROM notes WHERE wiki_space_id=$1", [f.spaces[0].id])).rows[0].count)).toBe(1);
    await page.getByRole("button", { name: "Close draft", exact: true }).click();
    await page.keyboard.press("Control+k");
    await page.getByText(`New wiki page in ${f.spaces[0].title}`, { exact: true }).click();
    await expect(page.getByRole("region", { name: "New wiki page" })).toBeVisible();
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**/wiki/${f.spaces[0].slug}/**`, async route => { await gate; await route.continue(); });
    const createdResponse = page.waitForResponse(response => response.request().method() === "POST" && response.url().endsWith(`/spaces/${f.spaces[0].id}/pages`));
    await page.getByRole("textbox", { name: "Page title", exact: true }).fill(`First ${f.suffix}`);
    const created = (await (await createdResponse).json()).note;
    await page.getByRole("textbox", { name: "Page title", exact: true }).fill(`Later ${f.suffix}`);
    await expect.poll(async () => (await current(page, created.id)).title).toBe(`Later ${f.suffix}`);
    release();
    await expect(page).toHaveURL(new RegExp(`/wiki/${f.spaces[0].slug}/${created.id}`));
    await expect(page.getByRole("textbox", { name: "Page title", exact: true })).toHaveValue(`Later ${f.suffix}`);
    if (info.project.name.startsWith("phone")) await page.setViewportSize({ width: 390, height: 480 });
    await page.getByRole("textbox", { name: "Page title", exact: true }).focus();
    await expect(page.getByRole("textbox", { name: "Page title", exact: true })).toBeFocused();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("draft-focus.png"), fullPage: true });
  } finally { release(); await f.cleanup(); }
});

test("real archive and membership revocation preserve failed drafts and allow explicit recovery", async ({ page }) => {
  const f = await seed(page);
  const admin = await page.context().browser()!.newContext({ baseURL: process.env.TASKBOARD_BASE_URL });
  try {
    await body(await admin.request.post("/api/auth/login", { data: { password: process.env.TASKBOARD_VISUAL_PASSWORD ?? (process.env.TASKBOARD_WIKI_P2_REAL === "1" ? "wiki-p2-ui-fixture" : "visual-test-password") } }));
    await actor(page, f.editor);
    await page.goto(f.note.wiki.canonicalHref + "?mode=edit");
    let fail = true;
    await page.route(`**/api/notes/${f.note.id}`, async route => { if (fail && route.request().method() === "PATCH") await route.abort("failed"); else await route.continue(); });
    await page.getByRole("textbox", { name: "Page title", exact: true }).fill("Retained through archive");
    await expect(page.locator(".wiki-save-status")).toContainText("Save failed");
    await body(await admin.request.patch(`/api/wiki/spaces/${f.spaces[0].id}`, { data: { archived: true } }));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByText("Archived space · Read only", { exact: true })).toBeVisible();
    await body(await admin.request.patch(`/api/wiki/spaces/${f.spaces[0].id}`, { data: { archived: false } }));
    fail = false; await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByRole("button", { name: "Save pending edits", exact: true }).click();
    await expect.poll(async () => (await current(page, f.note.id)).title).toBe("Retained through archive");
    fail = true; await pageSurface(page);
    await page.getByRole("textbox", { name: "Page title", exact: true }).fill("Retained through revocation");
    await expect(page.locator(".wiki-save-status")).toContainText("Save failed");
    await f.pool.query("DELETE FROM board_members WHERE board_id=$1 AND user_id=$2", [f.boards[0].boardId, f.editor]);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("heading", { name: "Page unavailable", exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Unsaved local text", exact: true })).toHaveValue(/Retained through revocation/);
    await f.pool.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'editor')", [f.boards[0].boardId, f.editor]);
    fail = false; await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await page.getByRole("button", { name: "Save pending edits", exact: true }).click();
    await expect.poll(async () => (await current(page, f.note.id)).title).toBe("Retained through revocation");
  } finally { await admin.close(); await f.cleanup(); }
});

test("real inline upload preserves the stale content baseline against another author", async ({ page }) => {
  const f = await seed(page);
  const other = await page.context().browser()!.newContext({ baseURL: process.env.TASKBOARD_BASE_URL });
  let release = () => {};
  try {
    await body(await other.request.post("/api/auth/login", { data: { password: process.env.TASKBOARD_VISUAL_PASSWORD ?? (process.env.TASKBOARD_WIKI_P2_REAL === "1" ? "wiki-p2-ui-fixture" : "visual-test-password") } }));
    await page.goto(f.note.wiki.canonicalHref + "?mode=edit");
    await expect(page.locator(".wiki-edit .bn-editor")).toBeVisible();
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**/api/notes/${f.note.id}/attachments`, async route => { if (route.request().method() === "POST") await gate; await route.continue(); });
    const uploadStarted = page.waitForRequest(request => request.method() === "POST" && request.url().endsWith(`/notes/${f.note.id}/attachments`));
    const transfer = await page.evaluateHandle(() => { const data = new DataTransfer(); data.items.add(new File([new Uint8Array([137,80,78,71,13,10,26,10])], "inline.png", { type: "image/png" })); return data; });
    await page.locator(".wiki-edit .bn-editor").dispatchEvent("drop", { dataTransfer: transfer });
    await uploadStarted;
    const server = await current(page, f.note.id);
    await body(await other.request.patch(`/api/notes/${f.note.id}`, { data: { title: "Another author during upload", expectedVersion: server.contentVersion } }));
    release();
    await expect.poll(async () => (await current(page, f.note.id)).attachmentCount).toBe(1);
    await page.getByRole("textbox", { name: "Page title", exact: true }).fill("Keep my inline upload draft");
    await expect(page.locator(".wiki-save-status")).toContainText("Conflicting edits");
    expect((await current(page, f.note.id)).title).toBe("Another author during upload");
    await expect(page.getByRole("textbox", { name: "Page title", exact: true })).toHaveValue("Keep my inline upload draft");
  } finally { release(); await other.close(); await f.cleanup(); }
});

test("real Notes promotion, live viewer updates, canonical redirect and viewer write guards", async ({ page }, info) => {
  const f = await seed(page);
  try {
    const ordinary = (await body(await page.request.post("/api/notes", { data: { title: `Promote ${f.suffix}`, boardId: f.boards[0].boardId, content: content("Ordinary board note") } }))).note;
    await page.goto(`/notes?note=${ordinary.id}`);
    await page.getByRole("button", { name: "Add to wiki…", exact: true }).click();
    await page.getByRole("button", { name: "Add to wiki", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/wiki/${f.spaces[0].slug}/${ordinary.id}`));
    expect((await current(page, ordinary.id)).wiki.spaceId).toBe(f.spaces[0].id);
    await actor(page, f.viewer);
    await page.goto(`/wiki/stale-title/${f.note.id}-old?unknown=secret`);
    await expect(page).toHaveURL(new RegExp(f.note.wiki.canonicalHref + "$"));
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Current files" }).locator('input[type="file"]')).toHaveCount(0);
    const rejected = await page.request.patch(`/api/notes/${f.note.id}`, { data: { title: "Viewer bypass", expectedVersion: f.note.contentVersion } });
    expect([403, 404]).toContain(rejected.status());
    // A second real session edits, while the viewer observes actual notes-token polling.
    const editor = await page.context().browser()!.newContext({ baseURL: process.env.TASKBOARD_BASE_URL });
    try {
      await editor.addCookies([{ name: "taskboard_session", value: await createSessionCookieValue({ userId: f.editor, authProvider: "authelia", reservedAdmin: false }), url: process.env.TASKBOARD_BASE_URL! }]);
      const response = await editor.request.patch(`/api/notes/${f.note.id}`, { data: { title: `Another author ${f.suffix}`, expectedVersion: f.note.contentVersion } });
      await body(response);
      // Wait for the normal notes-token poll; no focus-triggered refresh.
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(`Another author ${f.suffix}`);
      await pageAction(page, "Copy to my notes");
      await expect(page).toHaveURL(/\/notes\?note=/);
    } finally { await editor.close(); }
    await page.screenshot({ path: info.outputPath("viewer-independent-copy.png"), fullPage: true });
  } finally { await f.cleanup(); }
});

test("real conflicting save blocks restore and retains text; archive and access recover", async ({ page }) => {
  const f = await seed(page);
  try {
    await page.goto(f.note.wiki.canonicalHref + "?mode=edit");
    await expect(page.getByRole("textbox", { name: "Page title", exact: true })).toBeVisible();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    // Delay only transport; every response and conflict comes from the real server.
    await page.route(`**/api/notes/${f.note.id}`, async route => { if (route.request().method() === "PATCH") await gate; await route.continue(); });
    await page.getByRole("textbox", { name: "Page title", exact: true }).fill("Retain conflicting local title");
    await body(await page.request.patch(`/api/notes/${f.note.id}`, { data: { title: "Concurrent server title", expectedVersion: f.note.contentVersion } }));
    release();
    await expect(page.locator(".wiki-save-status")).toContainText("Conflicting edits");
    await pageAction(page, "History");
    await page.getByRole("button", { name: /Version 1 ·/ }).click();
    await page.getByRole("button", { name: "Restore version 1", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Restore version", exact: true }).click();
    await expect(page.locator(".wiki-banner[role=alert]")).toContainText("Save or resolve");
    expect((await current(page, f.note.id)).title).toBe("Concurrent server title");
    await pageSurface(page);
    await expect(page.getByRole("textbox", { name: "Page title", exact: true })).toHaveValue("Retain conflicting local title");
    await body(await page.request.patch(`/api/wiki/spaces/${f.spaces[0].id}`, { data: { archived: true } }));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByText("Archived space · Read only", { exact: true })).toBeVisible();
    await body(await page.request.patch(`/api/wiki/spaces/${f.spaces[0].id}`, { data: { archived: false } }));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("button", { name: "Save pending edits", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Save pending edits", exact: true }).click();
    await expect(page.locator(".wiki-save-status")).toContainText("Conflicting edits");
    expect((await current(page, f.note.id)).title).toBe("Concurrent server title");
  } finally { await f.cleanup(); }
});

test("real Linked notes edits the same wiki page and honors archived read-only state", async ({ page }, info) => {
  const f = await seed(page);
  try {
    const state = await body(await page.request.get(`/api/board?boardId=${f.boards[0].boardId}`));
    const task = await body(await page.request.post("/api/tasks", { data: { boardId: f.boards[0].boardId, bucketId: state.board.buckets[0].id, title: `Linked wiki ${f.suffix}` } }));
    await body(await page.request.post(`/api/notes/${f.note.id}/links`, { data: { taskId: task.taskId } }));
    await page.goto(`/?boardId=${f.boards[0].boardId}&taskId=${task.taskId}`);
    if (info.project.name.startsWith("phone")) await page.getByRole("button", { name: `Open task Linked wiki ${f.suffix}`, exact: true }).click();
    else await page.getByRole("button", { name: "Expand detail panel", exact: true }).click();
    await page.getByRole("tab", { name: /^Notes/ }).click();
    const linked = page.getByTestId("task-linked-notes");
    await expect(linked.getByRole("link", { name: "Open in wiki ↗", exact: true })).toBeVisible();
    await linked.getByRole("textbox", { name: "Note title", exact: true }).fill(`Linked edit ${f.suffix}`);
    await expect.poll(async () => (await current(page, f.note.id)).title).toBe(`Linked edit ${f.suffix}`);
    await linked.locator(".bn-editor").fill("Body saved through the real Linked notes editor.");
    await expect.poll(async () => (await current(page, f.note.id)).contentMarkdown).toContain("Body saved through the real Linked notes editor");
    await body(await page.request.patch(`/api/wiki/spaces/${f.spaces[0].id}`, { data: { archived: true } }));
    await page.reload();
    if (info.project.name.startsWith("phone")) await page.getByRole("button", { name: `Open task Linked wiki ${f.suffix}`, exact: true }).click();
    else await page.getByRole("button", { name: "Expand detail panel", exact: true }).click();
    await page.getByRole("tab", { name: /^Notes/ }).click();
    await expect(linked.getByRole("textbox", { name: "Note title", exact: true })).toBeDisabled();
    await expect(linked.getByRole("status")).toContainText("Read only");
  } finally { await f.cleanup(); }
});





async function pageAction(page: Page, name: string) {
  await page.getByRole("button", { name: "Page actions", exact: true }).click();
  await page.getByRole("menuitem", { name, exact: true }).click();
}
async function pageSurface(page: Page) {
  const back = page.getByRole("button", { name: "Back to page", exact: true });
  if (await back.isVisible()) await back.click();
  await expect(page.locator(".wiki-edit .bn-editor")).toBeVisible();
}


