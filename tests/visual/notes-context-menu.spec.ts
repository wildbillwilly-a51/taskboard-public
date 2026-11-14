import { expect, test, type Page } from "@playwright/test";
import { seed, actor } from "../helpers/wiki-real-fixture";

test.use({ viewport: { width: 1440, height: 1000 } });
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const errors = new WeakMap<Page, string[]>();
const noteRow = (page: Page, id: string) => page.locator(`[data-note-row="${id}"]`);
const folderRow = (page: Page, id: string) => page.locator(`[data-notebook-row="${id}"]`);
const menu = (page: Page, kind = "Note") => page.getByRole("menu", { name: `${kind} actions`, exact: true });

test.beforeEach(async ({ page }, testInfo) => {
  const failures: string[] = []; errors.set(page, failures);
  page.on("pageerror", error => failures.push(error.message));
  page.on("console", message => {
    // The failure-recovery test deliberately returns HTTP 409 responses.
    if (message.type() === "error" && !/failed move|concurrent rename|failed rename/.test(testInfo.title)) failures.push(message.text());
  });
  expect((await page.request.post("/api/auth/login", { data: { password: process.env.TASKBOARD_VISUAL_PASSWORD ?? "visual-test-password" } })).ok()).toBe(true);
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

async function addNote(page: Page, title = `Context note ${stamp()}`, extra = {}) {
  const text = "Keep this note body and its editing controls intact.";
  const response = await page.request.post("/api/notes", { data: {
    title, content: { blocks: [{ type: "paragraph", content: [{ type: "text", text, styles: {} }] }], text, markdown: text }, ...extra,
  } });
  expect(response.ok()).toBe(true);
  return (await response.json()).note as { id: string; title: string };
}
async function addFolder(page: Page, title = `Context folder ${stamp()}`, parentNotebookId?: string) {
  const response = await page.request.post("/api/notes/notebooks", { data: { title, parentNotebookId } });
  expect(response.ok()).toBe(true);
  return { id: (await response.json()).notebook.id as string, title };
}
async function saved(page: Page, id: string) {
  const response = await page.request.get(`/api/notes/${id}`);
  expect(response.ok()).toBe(true);
  return (await response.json()).note;
}
async function openList(page: Page) {
  await page.goto("/notes");
  await expect(page.getByRole("navigation", { name: "Notes folders", exact: true })).toBeVisible();
  await expect(page.locator('[data-testid="notes-workspace"]')).toBeVisible();
  expect(await page.title()).toContain("Taskboard");
  expect(page.url()).toContain("/notes");
  await expect(page.locator("nextjs-portal [data-nextjs-dialog]")).toHaveCount(0);
}

test("right-click targets note B while A stays open; pin/archive/unarchive/trash persist", async ({ page }) => {
  const a = await addNote(page); const b = await addNote(page);
  await openList(page);
  await noteRow(page, a.id).click();
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue(a.title);
  await noteRow(page, b.id).click({ button: "right" });
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue(a.title);
  await menu(page).getByRole("menuitem", { name: "Pin", exact: true }).click();
  await expect.poll(async () => (await saved(page, b.id)).pinned).toBe(true);
  expect((await saved(page, a.id)).pinned).toBe(false);
  await noteRow(page, b.id).click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Unpin", exact: true }).click();
  await expect.poll(async () => (await saved(page, b.id)).pinned).toBe(false);
  await noteRow(page, b.id).click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Archive", exact: true }).click();
  await expect.poll(async () => (await saved(page, b.id)).archived).toBe(true);
  await expect(noteRow(page, b.id)).toHaveCount(0);
  await page.getByRole("navigation", { name: "Notes folders", exact: true }).getByRole("button", { name: "Archive", exact: true }).click();
  await noteRow(page, b.id).click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Unarchive", exact: true }).click();
  await expect.poll(async () => (await saved(page, b.id)).archived).toBe(false);
  await page.getByRole("navigation", { name: "Notes folders", exact: true }).getByRole("button", { name: "All notes", exact: true }).click();
  await noteRow(page, b.id).click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Move to trash", exact: true }).click();
  await expect.poll(async () => Boolean((await saved(page, b.id)).deletedAt)).toBe(true);
  expect((await saved(page, a.id)).deletedAt).toBeNull();
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue(a.title);
});

test("rename from the list preserves pending body edits, supports cancel, and Edit opens the target", async ({ page }) => {
  const a = await addNote(page); const b = await addNote(page);
  await openList(page);
  await noteRow(page, a.id).click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Edit", exact: true }).click();
  const editor = page.locator('.bn-editor[contenteditable="true"]');
  await expect(editor).toBeFocused();
  await editor.fill("Unsaved work must survive a row rename.");
  await noteRow(page, a.id).click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Rename…", exact: true }).click();
  await page.getByRole("textbox", { name: "Rename note", exact: true }).fill("Cancelled rename");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("textbox", { name: "Rename note", exact: true })).toHaveCount(0);
  expect((await saved(page, a.id)).title).toBe(a.title);
  await noteRow(page, a.id).click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Rename…", exact: true }).click();
  const title = `Renamed ${stamp()}`;
  await page.getByRole("textbox", { name: "Rename note", exact: true }).fill(title);
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await saved(page, a.id)).title).toBe(title);
  expect((await saved(page, a.id)).contentMarkdown).toContain("Unsaved work must survive");
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue(title);
  await noteRow(page, b.id).click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Edit", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue(b.title);
  await expect(editor).toBeFocused();
});

test("move a non-selected note, visibility warnings/cancel, and copy its direct link", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const a = await addNote(page); const b = await addNote(page); const folder = await addFolder(page);
  const { board } = await (await page.request.get("/api/board")).json();
  await openList(page); await noteRow(page, a.id).click();
  await noteRow(page, b.id).click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Move to…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Move note", exact: true });
  await dialog.getByRole("combobox", { name: "Destination" }).selectOption(`board:${board.id}:`);
  await expect(dialog).toContainText("Everyone with access");
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await saved(page, b.id)).home.kind).toBe("personal");
  await noteRow(page, b.id).click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Move to…", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Destination" }).selectOption(`personal:${folder.id}`);
  await dialog.getByRole("button", { name: "Move", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await saved(page, b.id)).notebookId).toBe(folder.id);
  expect((await saved(page, a.id)).notebookId).toBeNull();
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue(a.title);
  await noteRow(page, b.id).click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Move to…", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Destination" }).selectOption(`board:${board.id}:`);
  await dialog.getByRole("button", { name: "Move", exact: true }).click();
  await expect.poll(async () => (await saved(page, b.id)).home.kind).toBe("board");
  await expect(dialog).toHaveCount(0);
  await noteRow(page, b.id).click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Move to…", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Destination" }).selectOption("personal:");
  await expect(dialog).toContainText("Only you will be able to see it");
  await dialog.getByRole("button", { name: "Move", exact: true }).click();
  await expect.poll(async () => (await saved(page, b.id)).home.kind).toBe("personal");
  await expect(dialog).toHaveCount(0);
  await noteRow(page, b.id).click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Copy link", exact: true }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(new URL(`/notes?note=${b.id}`, page.url()).href);
});

test("folder rename/move excludes descendants; deletion keeps notes and child folders", async ({ page }, testInfo) => {
  const parent = await addFolder(page); const child = await addFolder(page, `Child ${stamp()}`, parent.id);
  const destination = await addFolder(page); const item = await addNote(page, undefined, { notebookId: parent.id });
  await openList(page);
  await folderRow(page, parent.id).locator(".notes-nav-item").click();
  await folderRow(page, parent.id).click({ button: "right" });
  await expect(menu(page, "Folder")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("folder-context-menu.png") });
  await menu(page, "Folder").getByRole("menuitem", { name: "Rename…", exact: true }).click();
  const title = `Renamed folder ${stamp()}`;
  await page.getByRole("textbox", { name: "Rename folder", exact: true }).fill(title);
  await page.keyboard.press("Enter");
  await expect(folderRow(page, parent.id)).toContainText(title);
  await folderRow(page, parent.id).click({ button: "right" });
  await menu(page, "Folder").getByRole("menuitem", { name: "Move to…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Move folder", exact: true });
  await expect(dialog.locator(`option[value="${parent.id}"], option[value="${child.id}"]`)).toHaveCount(0);
  await dialog.getByRole("combobox", { name: "Destination" }).selectOption(destination.id);
  await dialog.getByRole("button", { name: "Move", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await folderRow(page, parent.id).click({ button: "right" });
  await menu(page, "Folder").getByRole("menuitem", { name: "Delete folder…", exact: true }).click();
  const confirmation = page.getByRole("alertdialog");
  await expect(confirmation).toContainText("No notes are deleted");
  await confirmation.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(folderRow(page, parent.id)).toBeVisible();
  await folderRow(page, parent.id).click({ button: "right" });
  await menu(page, "Folder").getByRole("menuitem", { name: "Delete folder…", exact: true }).click();
  await confirmation.getByRole("button", { name: "Delete notebook", exact: true }).click();
  await expect(folderRow(page, parent.id)).toHaveCount(0);
  expect((await saved(page, item.id)).notebookId).toBe(destination.id);
  const listing = await (await page.request.get("/api/notes/notebooks")).json();
  expect(listing.notebooks.find((entry: { id: string }) => entry.id === child.id).parentNotebookId).toBe(destination.id);
});

test("folder creation commands target the right-clicked folder without empty-note writes", async ({ page }) => {
  const folder = await addFolder(page);
  await openList(page);
  await folderRow(page, folder.id).click({ button: "right" });
  await menu(page, "Folder").getByRole("menuitem", { name: "New subfolder…", exact: true }).click();
  const title = `New child ${stamp()}`;
  await page.getByRole("textbox", { name: `New notebook inside ${folder.title}`, exact: true }).fill(title);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", { name: `${folder.title} / ${title}`, exact: true })).toBeVisible();
  await folderRow(page, folder.id).click({ button: "right" });
  await menu(page, "Folder").getByRole("menuitem", { name: "New note here", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue("");
  const notesHere = async () => (await (await page.request.get(`/api/notes?scope=personal&notebookId=${folder.id}`)).json()).notes;
  expect(await notesHere()).toHaveLength(0);
  await page.getByRole("textbox", { name: "Note title", exact: true }).fill(`Created here ${stamp()}`);
  await expect.poll(async () => (await notesHere()).length).toBe(1);
});

test("keyboard/ellipsis access, edge positioning, dismissal, light/dark and native editor menus", async ({ page }, testInfo) => {
  const item = await addNote(page);
  await openList(page); await noteRow(page, item.id).click();
  await noteRow(page, item.id).focus(); await page.keyboard.press("Shift+F10");
  await expect(menu(page).getByRole("menuitem", { name: "Edit", exact: true })).toBeFocused();
  await page.keyboard.press("End");
  await expect(menu(page).getByRole("menuitem", { name: "Move to trash", exact: true })).toBeFocused();
  await page.keyboard.press("Home"); await page.keyboard.press("ArrowDown");
  await expect(menu(page).getByRole("menuitem", { name: "Rename…", exact: true })).toBeFocused();
  await page.keyboard.press("Escape"); await expect(noteRow(page, item.id)).toBeFocused();
  await page.getByRole("button", { name: `Note actions for ${item.title}`, exact: true }).click();
  await expect(menu(page)).toBeVisible(); await page.keyboard.press("Tab"); await expect(menu(page)).toHaveCount(0);
  await expect(page.locator("body")).not.toBeFocused();
  await page.getByRole("button", { name: `Note actions for ${item.title}`, exact: true }).click();
  await page.keyboard.press("Shift+Tab"); await expect(noteRow(page, item.id)).toBeFocused();
  await noteRow(page, item.id).dispatchEvent("contextmenu", { clientX: 1437, clientY: 997 });
  const box = await menu(page).boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(1440);
  expect(box!.y + box!.height).toBeLessThanOrEqual(1000);
  await page.screenshot({ path: testInfo.outputPath("notes-context-dark.png") });
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    const key = "taskboard-ui-settings";
    localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) ?? "{}"), theme: "light" }));
    window.dispatchEvent(new StorageEvent("storage", { key }));
  });
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await noteRow(page, item.id).click({ button: "right" });
  await page.screenshot({ path: testInfo.outputPath("notes-context-light.png") });
  await page.getByRole("heading", { name: "All notes", exact: true }).click();
  await expect(menu(page)).toHaveCount(0);
  const editor = page.locator('.bn-editor[contenteditable="true"]');
  const cancelled = await editor.evaluate(element => !element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })));
  expect(cancelled).toBe(false);
  await expect(menu(page)).toHaveCount(0);
  const allNotes = page.getByRole("navigation", { name: "Notes folders", exact: true }).getByRole("button", { name: "All notes", exact: true });
  expect(await allNotes.evaluate(element => !element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })))).toBe(false);
  const title = page.getByRole("textbox", { name: "Note title", exact: true });
  expect(await title.evaluate(element => !element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })))).toBe(false);
  await expect(page.locator(".bn-formatting-toolbar")).toHaveCount(0);
  await editor.fill("Editor formatting still works");
  await editor.press("Control+a");
  await expect(page.getByRole("button", { name: /Bold/ }).first()).toBeVisible();
});

test("read-only notes disable mutations; failed move and rename do not affect other notes", async ({ page }) => {
  const a = await addNote(page); const b = await addNote(page); const folder = await addFolder(page);
  const f = await seed(page);
  try {
    const readonly = await addNote(page, `Viewer note ${f.suffix}`, { boardId: f.boards[0].boardId });
    await actor(page, f.viewer);
    await page.goto(`/notes?note=${readonly.id}`);
    await noteRow(page, readonly.id).click({ button: "right" });
    for (const name of ["Rename…", "Move to…", "Pin", "Archive", "Move to trash"]) {
      await expect(menu(page).getByRole("menuitem", { name, exact: true })).toBeDisabled();
    }
    await expect(menu(page).getByRole("menuitem", { name: "Copy link", exact: true })).toBeEnabled();
  } finally { await f.cleanup(); }
  expect((await page.request.post("/api/auth/login", { data: { password: process.env.TASKBOARD_VISUAL_PASSWORD ?? "visual-test-password" } })).ok()).toBe(true);
  await openList(page);
  await page.route(`**/api/notes/${b.id}`, async route => {
    if (route.request().method() === "PATCH") {
      if (route.request().postDataJSON().home) {
        // The destination disappears after the real dialog loaded it.
        expect((await page.request.delete(`/api/notes/notebooks/${folder.id}`)).ok()).toBe(true);
      } else {
        const latest = await saved(page, b.id);
        expect((await page.request.patch(`/api/notes/${b.id}`, { data: { expectedVersion: latest.contentVersion, content: { blocks: [{ type: "paragraph", content: [{ type: "text", text: "Concurrent edit", styles: {} }] }], text: "Concurrent edit", markdown: "Concurrent edit" } } })).ok()).toBe(true);
      }
    }
    await route.continue();
  });
  await noteRow(page, b.id).click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Move to…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Move note", exact: true });
  await dialog.getByRole("combobox", { name: "Destination" }).selectOption(`personal:${folder.id}`);
  await dialog.getByRole("button", { name: "Move", exact: true }).click();
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect.poll(() => dialog.evaluate(element => element.contains(document.activeElement))).toBe(true);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await noteRow(page, b.id).click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Rename…", exact: true }).click();
  await page.getByRole("textbox", { name: "Rename note", exact: true }).fill("Conflicting rename");
  await page.keyboard.press("Enter"); await expect(page.getByRole("alert").filter({ hasText: "rename could not be saved" })).toBeVisible();
  expect((await saved(page, b.id)).title).toBe(b.title);
  expect((await saved(page, a.id)).title).toBe(a.title);
});

test("phone rows keep native long-press behavior and existing note actions", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const item = await addNote(page);
  await page.goto("/notes");
  await expect(noteRow(page, item.id)).toBeVisible();
  expect(await noteRow(page, item.id).evaluate(element => !element.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true })))).toBe(false);
  await expect(menu(page)).toHaveCount(0);
  await noteRow(page, item.id).click();
  await page.getByRole("button", { name: "Note actions", exact: true }).click();
  await expect(menu(page).getByRole("menuitem", { name: "Export Markdown", exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Phone navigation", exact: true })).toBeVisible();
  expect(await page.locator("body").evaluate(element => element.scrollWidth)).toBe(390);
});

test("concurrent rename cannot advance the version of a stale editor body", async ({ page }) => {
  const item = await addNote(page);
  await openList(page); await noteRow(page, item.id).click();
  const editor = page.locator('.bn-editor[contenteditable="true"]');
  await expect(editor).toContainText("Keep this note body");
  const current = await saved(page, item.id);
  const text = "COLLABORATOR UPDATE MUST SURVIVE";
  expect((await page.request.patch(`/api/notes/${item.id}`, { data: {
    expectedVersion: current.contentVersion,
    content: { blocks: [{ type: "paragraph", content: [{ type: "text", text, styles: {} }] }], text, markdown: text },
  } })).ok()).toBe(true);
  await noteRow(page, item.id).click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Rename…", exact: true }).click();
  await page.getByRole("textbox", { name: "Rename note", exact: true }).fill("Concurrent renamed title");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "rename could not be saved" })).toBeVisible();
  expect((await saved(page, item.id)).contentMarkdown).toContain(text);
  await page.getByRole("textbox", { name: "Rename note", exact: true }).press("Escape");
  await editor.fill("My stale body edit must remain a conflict");
  await expect(page.getByRole("button", { name: "Reload theirs", exact: true })).toBeVisible();
  expect((await saved(page, item.id)).contentMarkdown).toContain(text);
  await page.getByRole("button", { name: "Reload theirs", exact: true }).click();
  await expect(editor).toContainText(text);
  await editor.fill(`${text} plus a resolved edit`);
  await expect.poll(async () => (await saved(page, item.id)).contentMarkdown).toContain("plus a resolved edit");
});

test("failed rename releases its editor lock when changing folders", async ({ page }) => {
  const folder = await addFolder(page);
  const a = await addNote(page); const b = await addNote(page, `Other folder ${stamp()}`, { notebookId: folder.id });
  await openList(page); await noteRow(page, a.id).click();
  await page.route(`**/api/notes/${a.id}`, async route => {
    if (route.request().method() === "PATCH") await route.abort("failed");
    else await route.continue();
  });
  await noteRow(page, a.id).click({ button: "right" });
  await menu(page).getByRole("menuitem", { name: "Rename…", exact: true }).click();
  await page.getByRole("textbox", { name: "Rename note", exact: true }).fill("Retained failed title");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("alert").filter({ hasText: "rename could not be saved" })).toBeVisible();
  await folderRow(page, folder.id).locator(".notes-nav-item").click();
  await page.getByRole("button", { name: `Note actions for ${b.title}`, exact: true }).click();
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator('.bn-editor[contenteditable="true"]')).toBeVisible();
  await page.unroute(`**/api/notes/${a.id}`);
});

test("pending move contains focus and repeated ellipsis clicks dismiss menus", async ({ page }) => {
  const folder = await addFolder(page); const item = await addNote(page);
  await openList(page);
  const trigger = page.getByRole("button", { name: `Note actions for ${item.title}`, exact: true });
  await trigger.click(); await expect(menu(page)).toBeVisible();
  await trigger.click(); await expect(menu(page)).toHaveCount(0);
  const folderTrigger = page.getByRole("button", { name: `Folder actions for ${folder.title}`, exact: true });
  await folderTrigger.click(); await expect(menu(page, "Folder")).toBeVisible();
  await folderTrigger.click(); await expect(menu(page, "Folder")).toHaveCount(0);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route(`**/api/notes/${item.id}`, async route => {
    if (route.request().method() === "PATCH") await pending;
    await route.continue();
  });
  await trigger.click(); await menu(page).getByRole("menuitem", { name: "Move to…", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Move note", exact: true });
  await dialog.getByRole("combobox", { name: "Destination" }).selectOption(`personal:${folder.id}`);
  try {
    await dialog.getByRole("button", { name: "Move", exact: true }).click();
    await expect(dialog).toHaveAttribute("aria-busy", "true");
    await page.keyboard.press("Tab");
    await expect(dialog).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(dialog).toBeFocused();
  } finally { release(); }
  await expect(dialog).toHaveCount(0);
});

test("keyboard archive restores focus to a remaining note", async ({ page }) => {
  const a = await addNote(page); const b = await addNote(page);
  await openList(page);
  await noteRow(page, a.id).focus();
  await noteRow(page, a.id).press("Shift+F10");
  await menu(page).getByRole("menuitem", { name: "Archive", exact: true }).click();
  await expect(noteRow(page, a.id)).toHaveCount(0);
  await expect.poll(() => page.locator('[data-note-row]').evaluateAll(rows => rows.some(row => row === document.activeElement))).toBe(true);
  await expect(noteRow(page, b.id)).toBeVisible();
});
