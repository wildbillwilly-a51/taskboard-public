import { expect, test, type Page } from "@playwright/test";

// Uses the existing isolated visual-test server/auth setup. No production data.
test.beforeEach(async ({ page }) => {
  const login = await page.request.post("/api/auth/login", { data: { password: "visual-test-password" } });
  expect(login.ok()).toBe(true);
});

async function createNote(page: Page, title: string, notebookId?: string) {
  const response = await page.request.post("/api/notes", { data: {
    title, notebookId,
    content: { blocks: [{ type: "paragraph", content: [{ type: "text", text: "A compact preview with room for reading and editing.", styles: {} }] }], markdown: "A compact preview with room for reading and editing.", text: "A compact preview with room for reading and editing." },
  } });
  expect(response.ok()).toBe(true);
  return (await response.json()).note as { id: string };
}

test("phone browse, nested folders, reading scale and editing preserve the note", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const suffix = Date.now();
  const parentName = `Personal review ${suffix}`;
  const childName = `Nested review ${suffix}`;
  const notebook = async (title: string, parentNotebookId?: string) => {
    const response = await page.request.post("/api/notes/notebooks", { data: { title, parentNotebookId } });
    expect(response.ok()).toBe(true);
    return (await response.json()).notebook.id as string;
  };
  const parent = await notebook(parentName);
  const child = await notebook(childName, parent);
  const title = `Phone reading ${suffix}`;
  const note = await createNote(page, title, child);
  await createNote(page, `Parent note ${suffix}`, parent);
  await page.goto("/notes");
  const nav = page.getByRole("navigation", { name: "Phone navigation" });
  await expect(nav).toBeVisible();
  await expect(nav).toHaveCSS("height", "52px");
  await expect(page.locator(".taskboard-main-header")).toBeHidden();
  await expect(page.getByRole("searchbox", { name: "Search notes" })).toBeVisible();
  const row = page.locator(`[data-note-row="${note.id}"]`);
  await expect(row).toHaveCSS("height", "64px");
  await page.getByRole("button", { name: "Show folders" }).click();
  await page.getByRole("button", { name: "Personal notebooks", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(parentName) }).click();
  await expect(page.getByRole("button", { name: new RegExp(childName) })).toBeVisible();
  await expect(row).toHaveCount(0); // Children are browsed separately.
  await page.getByRole("button", { name: new RegExp(childName) }).click();
  await row.click();
  await expect(page.getByRole("button", { name: "Reading text size" })).toBeVisible();
  await expect(nav).toBeVisible();
  await page.getByRole("button", { name: "Reading text size" }).click();
  await page.getByRole("slider", { name: "Note text size" }).fill("140");
  await expect(page.locator(".bn-editor")).toHaveCSS("font-size", "22.4px");
  await expect(nav).toHaveCSS("height", "52px");
  await page.getByRole("button", { name: "Close text size" }).click();
  const input = page.locator("textarea.notes-mobile-title");
  await input.fill(`${title} edited`);
  await expect(page.getByRole("button", { name: "Formatting" })).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reading text size" })).toBeVisible();
  await expect.poll(async () => (await (await page.request.get(`/api/notes/${note.id}`)).json()).note.title).toBe(`${title} edited`);
  await page.screenshot({ path: testInfo.outputPath("phone-note-reading.png") });
  await page.getByRole("button", { name: "Back to notes", exact: true }).click();
  await expect(page.getByRole("heading", { name: childName, exact: true })).toBeVisible();
  await expect(page.locator("body")).toHaveJSProperty("scrollWidth", 390);
  await page.screenshot({ path: testInfo.outputPath("phone-notes-browse.png") });
  await page.reload();
  await expect(page.locator(".bn-editor")).toHaveCSS("font-size", "22.4px");
});

test("phone navigation works across views and More shows task context", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/notes");
  const nav = page.getByRole("navigation", { name: "Phone navigation" });
  await nav.getByRole("link", { name: "Calendar", exact: true }).click();
  await expect(page).toHaveURL(/\/calendar/);
  await expect(nav).toBeVisible();
  await nav.getByRole("link", { name: "Tasks", exact: true }).click();
  await expect(page).toHaveURL(/\/\?boardId=/);
  await nav.getByRole("button", { name: "More" }).click();
  await expect(page.getByRole("combobox", { name: "Choose board" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Task view" })).toBeVisible();
  await page.getByRole("combobox", { name: "Task view" }).selectOption("agenda");
  await expect(page.getByRole("navigation", { name: "Workspace menu" })).toHaveCount(0);
});

test.describe("phone menu dismissal", () => {
  test.use({ hasTouch: true });
  for (const width of [320, 390]) {
    test(`both phone menu triggers toggle, dismiss outside, close and Escape at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
      await page.goto("/notes");
      await expect(page.locator(".notes-phone-folders")).toHaveCount(1);
      await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
      const top = page.locator(".taskboard-mobile-header").getByRole("button", { name: "Menu", exact: true });
      const bottom = page.getByRole("navigation", { name: "Phone navigation" }).getByRole("button", { name: "More", exact: true });
      const menu = page.getByRole("navigation", { name: "Workspace menu" });
      for (const trigger of [top, bottom]) {
        await trigger.tap();
        await expect(menu).toBeVisible();
        await expect(trigger).toHaveAttribute("aria-expanded", "true");
        await expect(menu.getByRole("button", { name: "New note", exact: true })).toBeVisible();
        await expect(page.getByText("User administration", { exact: true })).toHaveCount(0);
        await expect(page.getByText("Weekly review", { exact: true })).toHaveCount(0);
        const bounds = await menu.evaluate(el => el.getBoundingClientRect().toJSON());
        expect(bounds.height).toBeLessThan(400);
        expect(bounds.width).toBeLessThanOrEqual(272);
        await page.screenshot({ path: testInfo.outputPath(trigger === top ? "phone-top-menu.png" : "phone-bottom-menu.png"), scale: "css" });
        await trigger.tap();
        await expect(menu).toHaveCount(0);
        await trigger.tap();
        await menu.getByRole("button", { name: "Close menu" }).tap();
        await expect(menu).toHaveCount(0);
        await expect(trigger).toBeFocused();
        await trigger.tap();
        await page.locator(".taskboard-mobile-brand").tap();
        await expect(menu).toHaveCount(0);
        await trigger.tap();
        await page.keyboard.press("Escape");
        await expect(menu).toHaveCount(0);
      }
      await top.tap();
      await menu.getByRole("link", { name: "Calendar", exact: true }).tap();
      await expect(page).toHaveURL(/\/calendar/);
      await expect(menu).toHaveCount(0);
      await page.locator(".taskboard-mobile-header").getByRole("button", { name: "Menu", exact: true }).tap();
      await expect(menu.getByRole("link", { name: "Outages", exact: true })).toBeVisible();
      await expect(menu.getByRole("button", { name: "New note", exact: true })).toHaveCount(0);
    });
  }
});

test("desktop keeps the original header, columns and note formatting", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const note = await createNote(page, `Desktop continuity ${Date.now()}`);
  await page.goto("/notes");
  await expect(page.locator(".taskboard-main-header")).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Phone navigation" })).toBeHidden();
  await expect(page.locator(".notes-desktop-folders")).toBeVisible();
  const desktopMenu = page.locator(".taskboard-main-header").getByRole("button", { name: "Menu", exact: true });
  await desktopMenu.click();
  await expect(page.getByRole("button", { name: "Close menu", exact: true })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Workspace menu" })).toHaveCount(0);
  await desktopMenu.click();
  await expect(page.getByRole("button", { name: "Close menu", exact: true })).toHaveCount(0);
  await page.locator(`[data-note-row="${note.id}"]`).click();
  await expect(page.locator("input.notes-title-input")).toBeVisible();
  await expect(page.locator("textarea.notes-mobile-title")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reading text size" })).toHaveCount(0);
  await expect(page.locator(".bn-editor")).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("desktop-notes.png") });
});

test("narrow phones have no outer scrolling or small title inputs", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 568 });
  const note = await createNote(page, `A long title that wraps across several lines on a narrow phone ${Date.now()}`);
  await page.goto("/notes");
  await page.locator(`[data-note-row="${note.id}"]`).click();
  await expect(page.locator("textarea.notes-mobile-title")).toHaveCSS("font-size", "29px");
  await expect.poll(() => page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }))).toEqual({ width: 320, height: 568 });
  const toolbar = await page.locator(".notes-editor-toolbar").evaluate(el => ({ width: el.clientWidth, scroll: el.scrollWidth }));
  expect(toolbar.scroll).toBeLessThanOrEqual(toolbar.width);
});

test("keyboard replaces navigation with the optional compact formatting row", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const note = await createNote(page, `Keyboard review ${Date.now()}`);
  await page.goto("/notes");
  await page.locator(`[data-note-row="${note.id}"]`).click();
  const editor = page.locator(".bn-editor");
  await expect(editor).toBeVisible();
  await editor.click();
  await editor.press("Control+Home");
  await editor.press("Control+Shift+End");
  const viewportHeight = await page.evaluate(() => window.visualViewport!.height);
  const setVisualHeight = async (height: number) => page.evaluate(value => {
    // Desktop automation cannot raise an OS keyboard. Exercise the same
    // visualViewport event/geometry exposed by iPhone Safari instead.
    Object.defineProperty(window.visualViewport, "height", { configurable: true, value });
    window.visualViewport!.dispatchEvent(new Event("resize"));
  }, height);
  const nav = page.getByRole("navigation", { name: "Phone navigation" });
  await setVisualHeight(500);
  await expect(page.getByTestId("taskboard-shell")).toHaveCSS("height", "500px");
  await expect(nav).toBeHidden();
  await expect(page.locator(".bn-mobile-formatting-toolbar")).toBeHidden();
  await page.getByRole("button", { name: "Formatting", exact: true }).click();
  const toolbar = page.locator(".bn-mobile-formatting-toolbar");
  await expect(toolbar).toBeVisible();
  await expect(toolbar.locator(".bn-formatting-toolbar")).toHaveCSS("height", "42px");
  await toolbar.locator('[data-test="bold"]').click();
  await expect(editor).toBeFocused();
  await expect(editor.locator("strong")).toHaveText("A compact preview with room for reading and editing.");
  await page.screenshot({ path: testInfo.outputPath("phone-keyboard-formatting.png") });
  await page.getByRole("button", { name: "Collapse formatting" }).click();
  await expect(toolbar).toBeHidden();
  await setVisualHeight(viewportHeight);
  await expect(nav).toBeVisible();
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect.poll(async () => (await (await page.request.get(`/api/notes/${note.id}`)).json()).note.contentMarkdown).toContain("**A compact preview");
});

test("light phone browsing remains compact and supports header search", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.addInitScript(() => localStorage.setItem("taskboard-ui-settings", JSON.stringify({ theme: "light" })));
  const title = `Light review ${Date.now()}`;
  const note = await createNote(page, title);
  await page.goto("/notes");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.getByRole("searchbox", { name: "Search notes" }).fill(title);
  await expect(page.locator("[data-note-row]")).toHaveCount(1);
  await expect(page.locator(`[data-note-row="${note.id}"]`)).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath("phone-notes-light.png") });
});

test("phone New note preserves draft behavior and saves typed content", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const listIds = async () => (await (await page.request.get("/api/notes?scope=all&limit=1000")).json()).notes.map((note: { id: string }) => note.id) as string[];
  const before = await listIds();
  await page.goto("/notes");
  await expect(page.locator(".notes-phone-folders")).toHaveCount(1);
  await page.locator(".taskboard-mobile-header").getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("navigation", { name: "Workspace menu" }).getByRole("button", { name: "New note", exact: true }).click();
  await page.getByRole("button", { name: "Back to notes", exact: true }).click();
  expect(await listIds()).toEqual(before);
  await page.getByRole("button", { name: "New note here", exact: true }).click();
  await page.locator("textarea.notes-mobile-title").fill("A few thoughts for the week");
  const editor = page.locator(".bn-editor");
  await editor.fill("Make room for the work that matters. Keep a short list, capture ideas as they arrive, and leave space to think.");
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect.poll(async () => (await listIds()).length).toBe(before.length + 1);
  await expect(page.locator(".notes-save-state")).toHaveText("Saved");
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.screenshot({ path: testInfo.outputPath("phone-notes-preview.png"), scale: "css" });
  await page.reload();
  await expect(page.locator("textarea.notes-mobile-title")).toHaveValue("A few thoughts for the week");
  await expect(editor).toHaveText(/Make room for the work that matters/);
});

test("board folders show buckets and only notes directly in the selected folder", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const { board } = await (await page.request.get("/api/board")).json();
  const bucket = board.buckets[0];
  const add = async (title: string, bucketId?: string) => {
    const response = await page.request.post("/api/notes", { data: { title, boardId: board.id, bucketId } });
    expect(response.ok()).toBe(true);
    return (await response.json()).note.id as string;
  };
  const direct = await add("Board folder review");
  const nested = await add("Bucket folder review", bucket.id);
  await page.goto("/notes");
  await expect(page.locator(".notes-phone-folders")).toHaveCount(1);
  await page.getByRole("button", { name: "Show folders" }).click();
  await page.getByRole("button", { name: "Board notes", exact: true }).click();
  await page.locator(".notes-phone-folders").getByRole("button", { name: board.title, exact: true }).click();
  await expect(page.locator(`[data-note-row="${direct}"]`)).toBeVisible();
  await expect(page.locator(`[data-note-row="${nested}"]`)).toHaveCount(0);
  await page.getByRole("button", { name: bucket.title, exact: true }).click();
  await expect(page.locator(`[data-note-row="${nested}"]`)).toBeVisible();
  await expect(page.locator(`[data-note-row="${direct}"]`)).toHaveCount(0);
  await page.getByRole("button", { name: "Show folders" }).click();
  await expect(page.locator(`[data-note-row="${direct}"]`)).toBeVisible();
});
