import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { seed, actor } from "../helpers/wiki-real-fixture";

test.use({ hasTouch: true, actionTimeout: 10000 });
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const pageErrors = new WeakMap<Page, string[]>();

test.beforeEach(async ({ page }) => {
  const errors: string[] = []; pageErrors.set(page, errors);
  page.on("pageerror", error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  expect((await page.request.post("/api/auth/login", { data: { password: "visual-test-password" } })).ok()).toBe(true);
});

test.afterEach(async ({ page }) => { expect(pageErrors.get(page)).toEqual([]); });

async function notebook(page: Page, title: string, parentNotebookId?: string) {
  const response = await page.request.post("/api/notes/notebooks", { data: { title, parentNotebookId } });
  expect(response.ok()).toBe(true);
  return (await response.json()).notebook.id as string;
}
async function note(page: Page, title = `Audit ${stamp()}`, extra: Record<string, unknown> = {}) {
  const text = "Capture decisions while they are fresh. Keep the next step small and clear.";
  const response = await page.request.post("/api/notes", { data: {
    title, content: { blocks: [{ type: "paragraph", content: [{ type: "text", text, styles: {} }] }], text, markdown: text }, ...extra,
  } });
  expect(response.ok()).toBe(true);
  return (await response.json()).note as { id: string; title: string };
}
async function saved(page: Page, id: string) {
  return (await (await page.request.get(`/api/notes/${id}`)).json()).note;
}
async function open(page: Page, id: string) {
  await page.goto(`/notes?note=${id}`);
  await expect(page.locator(".bn-editor")).toBeVisible();
  await expect(page.getByRole("button", { name: "Reading text size", exact: true })).toBeVisible();
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
}
async function folders(page: Page, label: string) {
  await expect(page.locator(".notes-phone-folders")).toHaveCount(1);
  if (await page.getByRole("button", { name: "Back to notes", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Back to notes", exact: true }).click();
  }
  await page.getByRole("button", { name: "Show folders", exact: true }).click();
  await page.getByRole("navigation", { name: "Phone notes folders" }).getByRole("button", { name: label, exact: true }).click();
}

test("reader size buttons, slider, reset, dismissal and unchanged chrome", async ({ page }) => {
  const item = await note(page);
  await open(page, item.id);
  const aa = page.getByRole("button", { name: "Reading text size", exact: true });
  await aa.click();
  const dialog = page.getByRole("dialog", { name: "Reading text size" });
  await dialog.getByRole("button", { name: "Larger text" }).click();
  await expect(dialog.getByRole("slider")).toHaveValue("110");
  await dialog.getByRole("button", { name: "Smaller text" }).click();
  await expect(dialog.getByRole("slider")).toHaveValue("100");
  await expect(dialog.getByRole("button", { name: "Smaller text" })).toBeDisabled();
  await dialog.getByRole("slider").fill("160");
  await expect(dialog.getByRole("button", { name: "Larger text" })).toBeDisabled();
  await expect(page.locator(".bn-editor")).toHaveCSS("font-size", "25.6px");
  await expect(page.getByRole("navigation", { name: "Phone navigation" })).toHaveCSS("height", "52px");
  await dialog.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(dialog.getByRole("slider")).toHaveValue("100");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await aa.click();
  await page.locator(".notes-mobile-path").last().tap({ position: { x: 5, y: 5 } });
  await expect(dialog).toHaveCount(0);
  await aa.click();
  await aa.click();
  await expect(dialog).toHaveCount(0);
  await aa.click();
  await dialog.getByRole("button", { name: "Close text size" }).click();
  await expect(aa).toBeFocused();
});

test("folders create, cancel, rename, nest, create here, delete/cancel and preserve notes at 320px", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await page.goto("/notes");
  await expect(page.locator(".notes-phone-folders")).toHaveCount(1);
  await folders(page, "Personal notebooks");
  await page.getByRole("button", { name: "New notebook", exact: true }).click();
  await page.getByRole("textbox", { name: "New notebook name", exact: true }).press("Escape");
  await expect(page.getByRole("textbox", { name: "New notebook name", exact: true })).toBeHidden();
  const title = `Audit folder ${stamp()}`;
  await page.getByRole("button", { name: "New notebook", exact: true }).click();
  await page.getByRole("textbox", { name: "New notebook name", exact: true }).fill(title);
  await page.getByRole("textbox", { name: "New notebook name", exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Folder actions", exact: true }).tap();
  await page.getByRole("menuitem", { name: "Rename notebook", exact: true }).tap();
  await page.getByRole("textbox", { name: "Rename notebook", exact: true }).fill(`${title} renamed`);
  await page.getByRole("textbox", { name: "Rename notebook", exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: `${title} renamed`, exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("phone-folder-320.png"), scale: "css" });
  await page.getByRole("button", { name: "Folder actions", exact: true }).tap();
  await page.getByRole("menuitem", { name: "New notebook inside this one", exact: true }).tap();
  const childTitle = `Child ${stamp()}`;
  await page.getByRole("textbox", { name: "New notebook name", exact: true }).fill(childTitle);
  await page.getByRole("textbox", { name: "New notebook name", exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: childTitle, exact: true })).toBeVisible();
  await page.getByRole("list").getByRole("button", { name: "New note", exact: true }).tap();
  await page.locator("textarea.notes-mobile-title").fill(`Child note ${stamp()}`);
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.locator(".notes-save-state")).toHaveText("Saved");
  const id = new URL(page.url()).searchParams.get("note")!;
  await page.getByRole("button", { name: "Back to notes", exact: true }).click();
  await page.getByRole("button", { name: "Folder actions", exact: true }).tap();
  await page.getByRole("menuitem", { name: "Delete notebook", exact: true }).tap();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByRole("heading", { name: childTitle, exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Folder actions", exact: true }).tap();
  await page.getByRole("menuitem", { name: "Delete notebook", exact: true }).tap();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete notebook", exact: true }).click();
  await expect(page.getByRole("heading", { name: `${title} renamed`, exact: true })).toBeVisible();
  const result = await saved(page, id);
  expect(result.deletedAt).toBeNull();
  await expect(page.locator(`[data-note-row="${id}"]`)).toBeVisible();
});

test("details pin, tags, home changes, linked task search/select/unlink and panel close", async ({ page }) => {
  const item = await note(page);
  const home = await notebook(page, `Home ${stamp()}`);
  const { board } = await (await page.request.get("/api/board")).json();
  const task = board.buckets.flatMap((bucket: { tasks: unknown[] }) => bucket.tasks).find((item: { archived: boolean }) => !item.archived);
  await open(page, item.id);
  await page.getByRole("button", { name: "Note details", exact: true }).click();
  await page.getByRole("button", { name: "Pin note", exact: true }).click();
  await expect.poll(async () => (await saved(page, item.id)).pinned).toBe(true);
  await page.getByRole("button", { name: "Unpin note", exact: true }).click();
  await expect.poll(async () => (await saved(page, item.id)).pinned).toBe(false);
  await page.getByRole("button", { name: "Tags", exact: true }).click();
  await page.getByRole("combobox", { name: "Add tag", exact: true }).fill("audit-tag");
  await page.getByRole("combobox", { name: "Add tag", exact: true }).press("Enter");
  await expect.poll(async () => (await saved(page, item.id)).labels).toEqual(["audit-tag"]);
  await page.getByRole("button", { name: "Remove audit-tag", exact: true }).click();
  await expect.poll(async () => (await saved(page, item.id)).labels).toEqual([]);
  await page.getByRole("button", { name: "Back to note details" }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.getByRole("combobox", { name: "Home", exact: true }).selectOption(`personal:${home}`);
  await expect.poll(async () => (await saved(page, item.id)).notebookId).toBe(home);
  await page.getByRole("button", { name: "Back to note details" }).click();
  await page.getByRole("button", { name: "Linked tasks", exact: true }).click();
  await page.getByRole("combobox", { name: "Link a task", exact: true }).fill(task.title);
  await page.getByRole("option").filter({ hasText: task.title }).tap();
  await expect.poll(async () => (await saved(page, item.id)).linkedTaskCount).toBe(1);
  await page.getByRole("button", { name: `Unlink ${task.title}`, exact: true }).click();
  await expect.poll(async () => (await saved(page, item.id)).linkedTaskCount).toBe(0);
  await page.getByRole("button", { name: "Close note details", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Note details", exact: true })).toBeHidden();
});

test("note actions toggle, outside/Escape, export, archive/unarchive, trash/restore and delete confirmation", async ({ page }) => {
  const item = await note(page, `Action audit ${stamp()}`);
  await open(page, item.id);
  const trigger = page.getByRole("button", { name: "Note actions", exact: true });
  const menu = page.getByRole("menu", { name: "Note actions", exact: true });
  await trigger.click(); await trigger.click(); await expect(menu).toHaveCount(0);
  await trigger.click(); await page.keyboard.press("Escape"); await expect(menu).toHaveCount(0);
  await trigger.tap(); await menu.getByRole("menuitem", { name: "Close", exact: true }).tap(); await expect(menu).toBeHidden();
  await trigger.click(); await page.locator(".notes-mobile-path").last().tap({ position: { x: 5, y: 5 } }); await expect(menu).toHaveCount(0);
  await trigger.click();
  const download = page.waitForEvent("download");
  await menu.getByRole("menuitem", { name: "Export Markdown", exact: true }).click();
  const file = await download;
  expect(file.suggestedFilename()).toBe(`${item.title}.md`);
  expect(await readFile((await file.path())!, "utf8")).toContain("Capture decisions");
  await trigger.click(); await menu.getByRole("menuitem", { name: "Archive", exact: true }).click();
  await expect.poll(async () => (await saved(page, item.id)).archived).toBe(true);
  await trigger.click(); await menu.getByRole("menuitem", { name: "Unarchive", exact: true }).click();
  await expect.poll(async () => (await saved(page, item.id)).archived).toBe(false);
  await trigger.click(); await menu.getByRole("menuitem", { name: "Move to trash", exact: true }).click();
  await expect.poll(async () => Boolean((await saved(page, item.id)).deletedAt)).toBe(true);
  await folders(page, "Trash");
  await page.locator(`[data-note-row="${item.id}"]`).click();
  await trigger.click(); await menu.getByRole("menuitem", { name: "Restore", exact: true }).click();
  await expect.poll(async () => (await saved(page, item.id)).deletedAt).toBeNull();
  await trigger.click(); await menu.getByRole("menuitem", { name: "Move to trash", exact: true }).click();
  await page.locator(`[data-note-row="${item.id}"]`).click();
  await trigger.click(); await menu.getByRole("menuitem", { name: "Delete forever", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
  expect((await page.request.get(`/api/notes/${item.id}`)).ok()).toBe(true);
  await trigger.click(); await menu.getByRole("menuitem", { name: "Delete forever", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete forever", exact: true }).click();
  await expect.poll(async () => (await page.request.get(`/api/notes/${item.id}`)).status()).toBe(404);
});

test("all reader toolbar targets and note menu rows match the phone hit area", async ({ page }) => {
  await open(page, (await note(page)).id);
  const targets = await page.locator(".notes-editor-toolbar button:visible").evaluateAll(elements => elements.map(el => ({ name: el.getAttribute("aria-label") ?? el.textContent, width: el.getBoundingClientRect().width, height: el.getBoundingClientRect().height })));
  for (const target of targets) { expect(target.width, String(target.name)).toBeGreaterThanOrEqual(44); expect(target.height, String(target.name)).toBeGreaterThanOrEqual(44); }
  await page.getByRole("button", { name: "Note actions", exact: true }).click();
  for (const row of await page.getByRole("menu", { name: "Note actions" }).getByRole("menuitem").all()) {
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  }
});


test("attachments upload, real download, removal cancel/confirm, errors and details dismissal", async ({ page }, testInfo) => {
  const item = await note(page);
  await open(page, item.id);
  await page.getByRole("button", { name: "Note actions", exact: true }).tap();
  await page.getByRole("menuitem", { name: "Note details", exact: true }).tap();
  const panel = page.getByRole("dialog", { name: "Note details", exact: true });
  await panel.getByRole("button", { name: "Attachments", exact: true }).tap();
  const chooser = page.waitForEvent("filechooser");
  await panel.getByRole("button", { name: "Add attachment", exact: true }).tap();
  await (await chooser).setFiles({ name: "audit.txt", mimeType: "text/plain", buffer: Buffer.from("Attachment audit content") });
  await expect(panel.getByRole("link", { name: "Download audit.txt", exact: true })).toBeVisible();
  await expect.poll(async () => (await saved(page, item.id)).attachments.length).toBe(1);
  const download = page.waitForEvent("download");
  await panel.getByRole("link", { name: "Download audit.txt", exact: true }).tap();
  const file = await download;
  expect(file.suggestedFilename()).toBe("audit.txt");
  expect(await readFile((await file.path())!, "utf8")).toBe("Attachment audit content");
  await panel.getByRole("button", { name: "Remove audit.txt", exact: true }).tap();
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).tap();
  await expect(panel).toBeVisible();
  expect((await saved(page, item.id)).attachments.length).toBe(1);
  await panel.getByRole("button", { name: "Remove audit.txt", exact: true }).tap();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove attachment", exact: true }).tap();
  await expect(panel.getByText("No attachments", { exact: true })).toBeVisible();
  await page.route(`**/api/notes/${item.id}/attachments`, route => route.abort("failed"));
  await panel.getByLabel("Upload attachment").setInputFiles({ name: "retry.txt", mimeType: "text/plain", buffer: Buffer.from("Retry") });
  await expect(panel.getByRole("alert")).toContainText(/fetch|upload/i);
  await page.unroute(`**/api/notes/${item.id}/attachments`);
  await panel.getByLabel("Upload attachment").setInputFiles({ name: "retry.txt", mimeType: "text/plain", buffer: Buffer.from("Retry") });
  await expect(panel.getByRole("link", { name: "Download retry.txt", exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("phone-attachments.png"), scale: "css" });
  await page.keyboard.press("Escape"); await expect(panel).toBeHidden();
  await expect(page.getByRole("button", { name: "Note details", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "Note details", exact: true }).tap();
  await page.locator(".notes-mobile-path").last().tap({ position: { x: 5, y: 5 } });
  await expect(panel).toBeHidden();
});

test("convert menu cancel, destination selection, create and linked task navigation", async ({ page }) => {
  const item = await note(page, `Convert ${stamp()}`);
  await open(page, item.id);
  const convert = async () => {
    await page.getByRole("button", { name: "Note actions", exact: true }).tap();
    await page.getByRole("menuitem", { name: "Convert to task", exact: true }).tap();
  };
  await convert();
  const panel = page.getByRole("group", { name: "Create a task from this note" });
  await panel.getByRole("button", { name: "Cancel", exact: true }).tap(); await expect(panel).toBeHidden();
  expect((await saved(page, item.id)).linkedTaskCount).toBe(0);
  await convert();
  const choices = await panel.getByRole("combobox", { name: "New task in" }).locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value));
  await panel.getByRole("combobox", { name: "New task in" }).selectOption(choices[1]);
  await panel.getByRole("button", { name: "Create task", exact: true }).tap();
  await expect(panel).toBeHidden();
  await expect.poll(async () => (await saved(page, item.id)).linkedTaskCount).toBe(1);
  await page.getByRole("link", { name: "Open task", exact: true }).tap();
  await expect(page).toHaveURL(/taskId=/);
  await expect(page.getByRole("navigation", { name: "Phone navigation" })).toBeVisible();
});

test("save error retry and both conflict recovery buttons preserve chosen text", async ({ page }) => {
  const item = await note(page);
  await open(page, item.id);
  const title = page.locator("textarea.notes-mobile-title");
  await page.route(`**/api/notes/${item.id}`, route => route.request().method() === "PATCH" ? route.abort("failed") : route.continue());
  await title.fill("Retry this title");
  await page.getByRole("button", { name: "Done", exact: true }).tap();
  await expect(page.getByRole("button", { name: "Retry save", exact: true })).toBeVisible();
  await expect(title).toHaveValue("Retry this title");
  await page.unroute(`**/api/notes/${item.id}`);
  await page.getByRole("button", { name: "Retry save", exact: true }).tap();
  await expect.poll(async () => (await saved(page, item.id)).title).toBe("Retry this title");
  await expect(page.locator(".notes-save-state")).toHaveText("Saved");
  await page.request.patch(`/api/notes/${item.id}`, { data: { title: "Remote version", expectedVersion: (await saved(page, item.id)).contentVersion } });
  await title.fill("Local version");
  await page.getByRole("button", { name: "Done", exact: true }).tap();
  await expect(page.getByRole("button", { name: "Keep mine", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Keep mine", exact: true }).tap();
  await expect.poll(async () => (await saved(page, item.id)).title).toBe("Local version");
  await page.request.patch(`/api/notes/${item.id}`, { data: { title: "Remote final", expectedVersion: (await saved(page, item.id)).contentVersion } });
  await title.fill("Discard local");
  await page.getByRole("button", { name: "Done", exact: true }).tap();
  await page.getByRole("button", { name: "Reload theirs", exact: true }).tap();
  await expect(title).toHaveValue("Remote final");
});

test("every compact formatting control saves and restores the reading/navigation layout", async ({ page }, testInfo) => {
  const item = await note(page);
  await open(page, item.id);
  const editor = page.locator(".bn-editor");
  await editor.tap();
  const height = await page.evaluate(() => window.visualViewport!.height);
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "height", { configurable: true, value: 500 });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  });
  await page.getByRole("button", { name: "Formatting", exact: true }).tap();
  const toolbar = page.locator(".bn-mobile-formatting-toolbar");
  await expect(toolbar).toBeVisible();
  await expect(toolbar.getByRole("button", { name: "Select text to add a link" })).toBeDisabled();
  await editor.press("Control+Home"); await editor.press("Control+Shift+End");
  await toolbar.locator('[data-test="bold"]').tap();
  await toolbar.locator('[data-test="italic"]').tap();
  await expect(editor.locator("strong em, em strong")).toHaveText(/Capture decisions/);
  await toolbar.getByRole("button", { name: "Heading", exact: true }).tap();
  await expect(editor.locator('[data-content-type="heading"]')).toHaveCount(1);
  await expect(editor.locator('[data-content-type="heading"]')).toHaveCSS("font-size", "19.2px");
  await expect(editor.locator('[data-content-type="heading"]')).toHaveCSS("line-height", "32.64px");
  await toolbar.getByRole("button", { name: "Heading", exact: true }).tap();
  await expect(editor.locator('[data-content-type="paragraph"]')).toHaveCSS("font-size", "16px");
  await toolbar.getByRole("button", { name: "Checklist", exact: true }).tap();
  await expect(editor.locator('[data-content-type="checkListItem"]')).toHaveCount(1);
  await editor.getByRole("checkbox").check();
  await expect(page.getByRole("navigation", { name: "Phone navigation" })).toBeVisible();
  await editor.locator("p").tap();
  await toolbar.getByRole("button", { name: "Checklist", exact: true }).tap();
  await editor.press("Control+Home"); await editor.press("Control+Shift+End");
  await toolbar.locator('[data-test="createLink"]').tap();
  const url = page.locator('input[name="url"]');
  await url.fill("https://example.com/notes"); await url.press("Enter");
  await expect(editor.locator('a[href="https://example.com/notes"]')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("phone-format-controls.png"), scale: "css" });
  await toolbar.getByRole("button", { name: "Collapse formatting" }).tap();
  await expect(toolbar).toBeHidden();
  await page.evaluate(value => {
    Object.defineProperty(window.visualViewport, "height", { configurable: true, value });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  }, height);
  await page.getByRole("button", { name: "Done", exact: true }).tap();
  await expect(page.getByRole("navigation", { name: "Phone navigation" })).toBeVisible();
  await expect.poll(async () => (await saved(page, item.id)).contentMarkdown).toContain("https://example.com/notes");
  await page.reload(); await expect(editor.locator('a[href="https://example.com/notes"]')).toBeVisible();
});


test("portrait resize and touch landscape retain single-pane phone layout and title height", async ({ page }, testInfo) => {
  const item = await note(page, "A long note title that wraps across several lines when this phone is turned to portrait and landscape");
  await open(page, item.id);
  for (const viewport of [{ width: 320, height: 568 }, { width: 844, height: 390 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    await page.setViewportSize(viewport);
    const title = page.locator("textarea.notes-mobile-title");
    await expect(title).toBeVisible();
    await expect(page.locator(".taskboard-main-header")).toBeHidden();
    await expect(page.getByRole("navigation", { name: "Phone navigation" })).toBeVisible();
    await expect.poll(() => title.evaluate(el => Math.abs(el.clientHeight - el.scrollHeight))).toBeLessThanOrEqual(1);
    await expect.poll(() => page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))).toEqual(viewport);
    await page.screenshot({ path: testInfo.outputPath(`phone-reader-${viewport.width}.png`), scale: "css" });
  }
});

test("folder actions dismiss by repeat tap, outside, Close and Escape", async ({ page }) => {
  const id = await notebook(page, `Menu folder ${stamp()}`);
  const item = await note(page, undefined, { notebookId: id });
  await open(page, item.id);
  await page.getByRole("button", { name: "Back to notes", exact: true }).tap();
  const trigger = page.getByRole("button", { name: "Folder actions", exact: true });
  const menu = page.getByRole("menu", { name: "Folder actions", exact: true });
  await trigger.tap(); await trigger.tap(); await expect(menu).toBeHidden();
  await trigger.tap(); await page.keyboard.press("Escape"); await expect(menu).toBeHidden();
  await trigger.tap(); await menu.getByRole("menuitem", { name: "Close", exact: true }).tap(); await expect(trigger).toBeFocused();
  await trigger.tap(); await page.getByRole("searchbox", { name: "Search notes" }).tap(); await expect(menu).toBeHidden();
});


test("home sharing confirmation cancels or moves to board/bucket and back to private", async ({ page }) => {
  const item = await note(page);
  const { board } = await (await page.request.get("/api/board")).json();
  await open(page, item.id);
  await page.getByRole("button", { name: "Note details", exact: true }).tap();
  const panel = page.getByRole("dialog", { name: "Note details", exact: true });
  await panel.getByRole("button", { name: "Home", exact: true }).tap();
  const home = panel.getByRole("combobox", { name: "Home", exact: true });
  await home.selectOption(`board:${board.id}:${board.buckets[0].id}`);
  await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).tap();
  expect((await saved(page, item.id)).home.kind).toBe("personal");
  await expect(panel).toBeVisible();
  await home.selectOption(`board:${board.id}:${board.buckets[0].id}`);
  await page.getByRole("alertdialog").getByRole("button", { name: "Move note", exact: true }).tap();
  await expect.poll(async () => (await saved(page, item.id)).home.bucketId).toBe(board.buckets[0].id);
  await home.selectOption("personal:");
  await page.getByRole("alertdialog").getByRole("button", { name: "Make personal", exact: true }).tap();
  await expect.poll(async () => (await saved(page, item.id)).home.kind).toBe("personal");
});

test("browse shortcuts, tag results, empty state, search clearing and load more", async ({ page }) => {
  // Pinning belongs to PATCH; POST previously ignored this unsupported field.
  const item = await note(page, `Browse ${stamp()}`, { labels: ["audit-browse"] });
  expect((await page.request.patch(`/api/notes/${item.id}`, { data: { pinned: true } })).ok()).toBe(true);
  await page.goto("/notes");
  await folders(page, "Pinned");
  await expect(page.locator(`[data-note-row="${item.id}"]`)).toBeVisible();
  await folders(page, "audit-browse");
  await expect(page.locator(`[data-note-row="${item.id}"]`)).toBeVisible();
  const search = page.getByRole("searchbox", { name: "Search notes" });
  await search.fill("nothing-can-match-this-audit-string");
  await expect(page.getByText("No notes match your search.", { exact: true })).toBeVisible();
  await search.fill(""); await expect(page.locator(`[data-note-row="${item.id}"]`)).toBeVisible();
  await folders(page, "Inbox");
  await expect(page.locator(`[data-note-row="${item.id}"]`)).toBeVisible();
  await folders(page, "All notes");
  const more = page.getByRole("button", { name: "Show more notes", exact: true });
  if (!(await more.isVisible())) {
    const existing = (await (await page.request.get("/api/notes?scope=all&limit=1000")).json()).notes.length;
    for (let i = existing; i < 101; i++) await note(page, `Pagination ${stamp()}`);
    await page.reload();
  }
  const before = await page.locator("[data-note-row]").count();
  expect((await more.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await more.tap();
  await expect.poll(() => page.locator("[data-note-row]").count()).toBeGreaterThan(before);
});

test("trash and read-only notes keep mutation controls unavailable", async ({ page }) => {
  const item = await note(page);
  await page.request.delete(`/api/notes/${item.id}`);
  await open(page, item.id);
  await expect(page.locator("textarea.notes-mobile-title")).toBeDisabled();
  await expect(page.getByRole("button", { name: "Edit note", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Note actions", exact: true }).tap();
  await expect(page.getByRole("menuitem", { name: "Restore", exact: true })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: "Move to trash", exact: true })).toHaveCount(0);
  const f = await seed(page);
  try {
  const readonly = await note(page, `Viewer note ${f.suffix}`, { boardId: f.boards[0].boardId });
  await actor(page, f.viewer);
  await open(page, readonly.id);
  await expect(page.locator("textarea.notes-mobile-title")).toBeDisabled();
  await page.getByRole("button", { name: "Note actions", exact: true }).tap();
  for (const name of ["Convert to task", "Archive", "Move to trash"]) await expect(page.getByRole("menuitem", { name, exact: true })).toBeDisabled();
  await page.getByRole("menuitem", { name: "Note details", exact: true }).tap();
  await page.getByRole("button", { name: "Attachments", exact: true }).tap();
  await expect(page.getByRole("button", { name: "Add attachment", exact: true })).toHaveCount(0);
  } finally { await f.cleanup(); }
});


test("link context controls edit, open and remove links with touch", async ({ page }) => {
  const item = await note(page, undefined, { content: { blocks: [{ type: "paragraph", content: [{ type: "link", href: "https://example.com/original", content: [{ type: "text", text: "A reference link", styles: {} }] }] }], text: "A reference link", markdown: "[A reference link](https://example.com/original)" } });
  await open(page, item.id);
  const editor = page.locator(".bn-editor");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  // ProseMirror counts presses on one spot less than 500 ms apart as double and
  // triple clicks, and a triple click selects the whole paragraph. Keep each
  // tap on the link a single tap, as a person's taps between these steps are.
  let lastLinkTap = 0;
  const tapLink = async () => {
    await page.waitForTimeout(Math.max(0, lastLinkTap + 550 - Date.now()));
    await editor.locator("a").tap(); lastLinkTap = Date.now();
  };
  await tapLink();
  const toolbar = page.locator(".bn-link-toolbar");
  await expect(toolbar).toBeVisible();
  await toolbar.getByRole("button", { name: "Close link menu", exact: true }).tap();
  await expect(toolbar).toBeHidden();
  await editor.press("ArrowRight");
  await tapLink();
  await toolbar.getByRole("button", { name: "Edit link", exact: true }).tap();
  const url = page.locator('input[name="url"]');
  await url.fill("https://example.com/changed"); await url.press("Enter");
  await expect(editor.locator('a[href="https://example.com/changed"]')).toBeVisible();
  await tapLink();
  // Exercise the native popup; no response is substituted.
  const popup = page.waitForEvent("popup");
  await toolbar.getByRole("button", { name: "Open in new tab", exact: true }).tap();
  const opened = await popup; await expect(opened).toHaveURL("https://example.com/changed"); await opened.close();
  await page.bringToFront();
  await editor.press("ArrowRight");
  await tapLink();
  await toolbar.getByRole("button", { name: "Remove link", exact: true }).tap();
  await expect(editor.locator("a")).toHaveCount(0);
  await page.getByRole("button", { name: "Done", exact: true }).tap();
  await expect.poll(async () => (await saved(page, item.id)).contentMarkdown).not.toContain("https://");
});

test("tapping the link that holds the caret reopens its working controls", async ({ page }) => {
  const item = await note(page, undefined, { content: { blocks: [{ type: "paragraph", content: [{ type: "link", href: "https://example.com/original", content: [{ type: "text", text: "A reference link", styles: {} }] }] }], text: "A reference link", markdown: "[A reference link](https://example.com/original)" } });
  await open(page, item.id);
  const editor = page.locator(".bn-editor");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  const toolbar = page.locator(".bn-link-toolbar");
  await editor.locator("a").tap();
  await toolbar.getByRole("button", { name: "Close link menu", exact: true }).tap();
  await expect(toolbar).toBeHidden();
  // The caret is still inside the link, so this tap does not move the selection.
  await editor.locator("a").tap();
  const popup = page.waitForEvent("popup");
  await toolbar.getByRole("button", { name: "Open in new tab", exact: true }).tap();
  const opened = await popup; await expect(opened).toHaveURL("https://example.com/original"); await opened.close();
});

test("empty folders create here and failed new-note creation can retry", async ({ page }) => {
  await page.goto("/notes");
  await folders(page, "Personal notebooks");
  await page.getByRole("button", { name: "New note here", exact: true }).tap();
  await page.route("**/api/notes", route => route.request().method() === "POST" ? route.abort("failed") : route.continue());
  await page.locator("textarea.notes-mobile-title").fill(`Draft retry ${stamp()}`);
  await expect(page.getByRole("button", { name: "Retry save", exact: true })).toBeVisible();
  await page.unroute("**/api/notes");
  await page.getByRole("button", { name: "Retry save", exact: true }).tap();
  await expect(page).toHaveURL(/note=[0-9a-f-]{36}/);
  await expect(page.locator(".notes-save-state")).toHaveText("Saved");
});
