import { expect, test, type Page } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: { password: "visual-test-password" } })).ok()).toBe(true);
});

async function fixture(page: Page) {
  const state = await (await page.request.get("/api/board")).json();
  const boardId = state.board.id as string;
  // Keep one searchable alphanumeric token; PostgreSQL can split a hyphen
  // followed by a digit as a signed number rather than the intended suffix.
  const stamp = `linen${Date.now()}${Math.random().toString(36).slice(2, 7)}`;
  async function bucket(title: string, color: string) {
    const response = await page.request.post("/api/buckets", { data: { boardId, title: `${title} ${stamp}` } });
    expect(response.ok()).toBe(true);
    const id = (await response.json()).bucketId as string;
    expect((await page.request.patch(`/api/buckets/${id}`, { data: { boardId, color } })).ok()).toBe(true);
    return { id, title: `${title} ${stamp}`, color };
  }
  const amber = await bucket("Amber", "#d97706");
  const teal = await bucket("Teal", "#0f766e");
  async function note(title: string, bucketId?: string) {
    const text = "Notes Linen review content.";
    const response = await page.request.post("/api/notes", { data: {
      title: `${title} ${stamp}`, ...(bucketId ? { boardId, bucketId } : {}),
      content: { blocks: [{ type: "paragraph", content: [{ type: "text", text, styles: {} }] }], text, markdown: text },
    } });
    expect(response.ok()).toBe(true);
    return (await response.json()).note as { id: string; title: string };
  }
  const first = await note("Amber note", amber.id);
  const second = await note("Teal note", teal.id);
  const personal = await note("Personal note");
  return { boardId, amber, teal, first, second, personal, stamp };
}

test("bucket tint follows the list scope and the selected note follows home changes", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const f = await fixture(page);
  const homes = await (await page.request.get("/api/notes/homes")).json();
  expect(homes.homeOptions.find((home: { boardId: string }) => home.boardId === f.boardId).buckets
    .find((bucket: { id: string }) => bucket.id === f.amber.id).color).toBe(f.amber.color);
  await page.goto(`/notes?boardId=${f.boardId}&bucketId=${f.amber.id}&note=${f.first.id}`);
  const list = page.locator(".notes-list-pane");
  const editor = page.locator(".notes-editor-pane");
  const row = page.locator(`[data-note-row="${f.first.id}"]`);
  await expect(list).toHaveAttribute("data-notes-context", "bucket");
  await expect(list).toHaveCSS("--notes-context-color", f.amber.color);
  await expect(row).toHaveAttribute("data-active", "true");
  const selected = await row.evaluate(element => getComputedStyle(element).backgroundColor);
  await row.hover();
  await expect(row).toHaveCSS("background-color", selected);

  const search = page.getByRole("searchbox", { name: "Search notes", exact: true });
  await search.fill(f.stamp);
  await expect(page.locator(`[data-note-row="${f.second.id}"]`)).toBeVisible();
  await expect(list).not.toHaveAttribute("data-notes-context", "bucket");
  await search.fill("");
  await expect(list).toHaveAttribute("data-notes-context", "bucket");

  const home = page.getByRole("combobox", { name: "Home", exact: true });
  await expect(home).toBeEnabled();
  await home.selectOption(`board:${f.boardId}:${f.teal.id}`);
  await expect(editor).toHaveCSS("--notes-context-color", f.teal.color);
  await expect(list).toHaveCSS("--notes-context-color", f.amber.color);
  await expect(row).toHaveCount(0);
  await home.selectOption("personal:");
  await page.getByRole("alertdialog").getByRole("button", { name: "Make personal", exact: true }).click();
  await expect(editor).not.toHaveAttribute("data-notes-context", "bucket");
  await expect(list).toHaveCSS("--notes-context-color", f.amber.color);

  await page.locator(".notes-desktop-folders").getByRole("button", { name: "All notes", exact: true }).click();
  await expect(list).not.toHaveAttribute("data-notes-context", "bucket");
  const mixed = page.locator(`[data-note-row="${f.second.id}"]`);
  await expect(mixed.locator(".notes-context-mark")).toBeVisible();
  await mixed.click();
  await expect(mixed).toHaveAttribute("data-active", "true");
  await expect(mixed).toHaveCSS("--notes-context-color", f.teal.color);
  const neutral = page.locator(`[data-note-row="${f.personal.id}"]`);
  expect(await mixed.evaluate(element => element.getBoundingClientRect().height))
    .toBe(await neutral.evaluate(element => element.getBoundingClientRect().height));
  await neutral.click();
  await expect(neutral).not.toHaveAttribute("data-notes-context", "bucket");
  await expect(editor).not.toHaveAttribute("data-notes-context", "bucket");
  await page.screenshot({ path: testInfo.outputPath("notes-mixed-neutral.png") });
  expect(errors).toEqual([]);
});

test("Notes accents and surface tiers stay local after navigating across views", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  async function chrome() {
    return page.locator(".taskboard-main-header").evaluate(header => {
      const nav = header.querySelector(".taskboard-primary-nav");
      const style = getComputedStyle(header);
      return { background: style.backgroundColor, focus: style.getPropertyValue("--focus-ring"),
        nav: nav ? getComputedStyle(nav).backgroundColor : "", font: style.fontFamily };
    });
  }
  await page.goto("/");
  await expect(page.locator(".taskboard-main-header")).toBeVisible();
  const boardChrome = await chrome();
  await page.goto("/wiki");
  const wikiFocus = await page.locator("html").evaluate(element => getComputedStyle(element).getPropertyValue("--focus-ring"));
  const f = await fixture(page);
  await page.goto(`/notes?boardId=${f.boardId}&bucketId=${f.amber.id}&note=${f.first.id}`);
  await expect(page.getByRole("combobox", { name: "Home", exact: true })).toBeEnabled();
  const folder = page.locator(".notes-desktop-folders");
  expect(await folder.evaluate(element => getComputedStyle(element).backgroundColor))
    .not.toBe(await page.locator(".notes-editor-pane").evaluate(element => getComputedStyle(element).backgroundColor));
  const add = folder.getByRole("button", { name: "New note", exact: true });
  const title = page.locator("input.notes-title-input");
  await title.click();
  await expect(title).toHaveCSS("outline-style", "none");
  await add.focus();
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(add).toBeFocused();
  expect(await add.evaluate(element => element.matches(":focus-visible"))).toBe(true);
  await expect(add).toHaveCSS("outline-style", "solid");
  await expect(add).toHaveCSS("outline-width", "2px");
  await page.screenshot({ path: testInfo.outputPath("notes-bucket-desktop.png") });
  await page.goto("/");
  await expect(page.locator(".taskboard-main-header")).toBeVisible();
  expect(await chrome()).toEqual(boardChrome);
  await page.goto("/wiki");
  expect(await page.locator(".notes-frame").count()).toBe(0);
  expect(await page.locator("html").evaluate(element => getComputedStyle(element).getPropertyValue("--focus-ring"))).toBe(wikiFocus);
});

test("phone context cues keep compact rows, bucket navigation and reading controls", async ({ page }, testInfo) => {
  const f = await fixture(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/notes?boardId=${f.boardId}&bucketId=${f.amber.id}&note=${f.first.id}`);
  await expect(page.getByRole("button", { name: "Reading text size", exact: true })).toBeVisible();
  await expect(page.locator(".notes-editor-body > .notes-mobile-path .notes-context-mark")).toBeVisible();
  await page.getByRole("button", { name: "Back to notes", exact: true }).click();
  const row = page.locator(`[data-note-row="${f.first.id}"]`);
  await expect(row).toBeVisible();
  await expect(row).toHaveCSS("height", "64px");
  await expect(row.getByRole("img", { name: new RegExp(f.amber.title) })).toBeVisible();
  await expect(page.locator(".notes-list-pane")).toHaveCSS("--notes-context-color", f.amber.color);
  await page.setViewportSize({ width: 320, height: 700 });
  await expect(row).toHaveCSS("height", "64px");
  expect(await page.locator("body").evaluate(element => element.scrollWidth)).toBe(320);
  await page.screenshot({ path: testInfo.outputPath("notes-bucket-phone-320.png") });
  await page.getByRole("button", { name: "Show folders", exact: true }).click();
  const bucket = page.locator(".notes-mobile-folder-row").filter({ hasText: f.amber.title });
  await expect(bucket).toBeVisible();
  await expect(bucket.locator(".notes-context-mark")).toHaveCSS("width", "18px");
  await bucket.click();
  await expect(page.locator(".notes-list-pane")).toHaveCSS("--notes-context-color", f.amber.color);
  await row.click();
  await expect(page.getByRole("button", { name: "Reading text size", exact: true })).toBeVisible();
  expect(await page.locator("body").evaluate(element => element.scrollWidth)).toBe(320);
  await page.goto("/notes");
  await expect(row).toBeVisible();
  await expect(row.locator(".notes-mobile-bucket-label")).toHaveText(f.amber.title);
  await expect(row).toHaveCSS("height", "64px");
  await page.screenshot({ path: testInfo.outputPath("notes-mixed-phone-320.png") });
});

test("x-large Notes type keeps bucket and neutral rows aligned", async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    const settings = JSON.parse(localStorage.getItem("taskboard-ui-settings") || "{}");
    localStorage.setItem("taskboard-ui-settings", JSON.stringify({ ...settings, fontScale: "x-large" }));
  });
  const f = await fixture(page);
  await page.goto(`/notes?note=${f.second.id}`);
  await expect(page.getByRole("combobox", { name: "Home", exact: true })).toBeEnabled();
  await page.locator(".notes-desktop-folders").getByRole("button", { name: "All notes", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-font-scale", "x-large");
  const bucket = page.locator(`[data-note-row="${f.second.id}"]`);
  const neutral = page.locator(`[data-note-row="${f.personal.id}"]`);
  await expect(bucket).toBeVisible();
  await expect(neutral).toBeVisible();
  expect(await bucket.evaluate(element => element.getBoundingClientRect().height))
    .toBe(await neutral.evaluate(element => element.getBoundingClientRect().height));
  expect(await page.locator("body").evaluate(element => element.scrollWidth)).toBeLessThanOrEqual(1440);
  await page.screenshot({ path: testInfo.outputPath("notes-x-large.png") });
});
