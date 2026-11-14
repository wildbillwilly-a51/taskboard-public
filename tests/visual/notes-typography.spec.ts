import { expect, test, type Locator, type Page } from "@playwright/test";
import { actor, seed } from "../helpers/wiki-real-fixture";

test.beforeEach(async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: { password: "visual-test-password" } })).ok()).toBe(true);
});

async function fixture(page: Page, boardId?: string) {
  const text = (value: string) => [{ type: "text", text: value, styles: {} }];
  const response = await page.request.post("/api/notes", { data: {
    title: "Typography review note", ...(boardId ? { boardId } : {}),
    content: { blocks: [
      { type: "paragraph", content: text("Body text for reading and editing.") },
      ...[1, 2, 3].map(level => ({ type: "heading", props: { level }, content: text(`Level ${level}`) })),
      { type: "bulletListItem", content: text("List text"), children: [
        { type: "heading", props: { level: 2 }, content: text("Nested heading") },
      ] },
      { type: "checkListItem", props: { checked: false }, content: text("Checklist text") },
      { type: "table", content: { type: "tableContent", rows: [{ cells: [text("Table text")] }] } },
      { type: "codeBlock", props: { language: "text" }, content: text("const sample = 1;") },
    ], text: "Body text for reading and editing.", markdown: "Body text for reading and editing." },
  } });
  expect(response.ok(), await response.text()).toBe(true);
  return (await response.json()).note as { id: string };
}

async function size(locator: Locator, expected: number, lineHeight?: number) {
  await expect(locator).toBeVisible();
  await expect.poll(() => locator.evaluate(el => parseFloat(getComputedStyle(el).fontSize))).toBeCloseTo(expected, 1);
  if (lineHeight) await expect.poll(() => locator.evaluate(el => parseFloat(getComputedStyle(el).lineHeight))).toBeCloseTo(lineHeight, 1);
}

async function contentSizes(page: Page, body: number, phone = false) {
  const editor = page.locator(".bn-editor");
  const paragraph = editor.getByText("Body text for reading and editing.", { exact: true });
  await size(paragraph, body, body * (phone ? 1.7 : 1.5));
  await expect(paragraph).toHaveCSS("font-family", /Public Sans/);
  for (const value of ["List text", "Checklist text", "Table text"]) {
    await size(editor.getByText(value, { exact: true }), body, body * (phone ? 1.7 : 1.5));
  }
  for (const [label, ratio] of [["Level 1", 3], ["Level 2", 2], ["Level 3", 1.3], ["Nested heading", 2]] as const) {
    const expected = body * (phone ? 1.2 : ratio);
    await size(editor.getByRole("heading", { name: label, exact: true }), expected, expected * (phone ? 1.7 : 1.5));
  }
  await expect(editor.locator('[data-content-type="codeBlock"] code')).toHaveCSS("font-family", /IBM Plex Mono/);
  await size(editor.getByText("const sample = 1;", { exact: true }), body, body * 1.5);
}

for (const [scale, root] of [["small", 17], ["normal", 18.5], ["large", 20], ["x-large", 22], ["xx-large", 24]] as const) {
  test(`desktop typography follows the ${scale} preference in the document and controls`, async ({ page }, testInfo) => {
    await page.addInitScript(fontScale => {
      const settings = JSON.parse(localStorage.getItem("taskboard-ui-settings") || "{}");
      localStorage.setItem("taskboard-ui-settings", JSON.stringify({ ...settings, fontScale }));
    }, scale);
    const note = await fixture(page);
    await page.goto(`/notes?note=${note.id}`);
    await expect(page.locator("html")).toHaveAttribute("data-font-scale", scale);
    await contentSizes(page, 14.5 * root / 18.5);
    await size(page.locator("input.notes-title-input"), 15 * root / 18.5);
    await size(page.getByRole("combobox", { name: "Home", exact: true }), 12 * root / 18.5);
    await page.locator(".bn-editor").click();
    await contentSizes(page, 14.5 * root / 18.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    if (scale === "x-large") await page.screenshot({ path: testInfo.outputPath("desktop-x-large.png") });
  });
}

for (const width of [320, 390]) {
  test(`phone typography scales actual text in reading and editing at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    const note = await fixture(page);
    await page.goto(`/notes?note=${note.id}`);
    const reader = page.getByRole("button", { name: "Reading text size", exact: true });
    const title = page.locator("textarea.notes-mobile-title");
    await expect(reader).toBeVisible();
    for (const percent of [100, 130, 160]) {
      await reader.click();
      const panel = page.getByRole("dialog", { name: "Reading text size", exact: true });
      if (percent > 100) for (let i = 0; i < 3; i++) await panel.getByRole("button", { name: "Larger text", exact: true }).click();
      await expect(panel.locator("output")).toHaveText(`${percent}%`);
      await panel.getByRole("button", { name: "Close text size", exact: true }).click();
      const factor = percent / 100;
      await contentSizes(page, 16 * factor, true);
      await size(title, 29 * factor, 29 * factor * 1.18);
      await expect(page.getByRole("navigation", { name: "Phone navigation", exact: true })).toHaveCSS("height", "52px");
      await page.getByRole("button", { name: "Edit note", exact: true }).click();
      await contentSizes(page, 16 * factor, true);
      await title.fill(`Typography review note ${percent}`);
      await page.getByRole("button", { name: "Done", exact: true }).click();
      await expect(reader).toBeVisible();
      await expect.poll(async () => (await (await page.request.get(`/api/notes/${note.id}`)).json()).note.title).toBe(`Typography review note ${percent}`);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.reload();
    await expect(reader).toBeVisible();
    await contentSizes(page, 25.6, true);
    await page.screenshot({ path: testInfo.outputPath("phone-reading-160.png") });
    await reader.click();
    await page.getByRole("dialog", { name: "Reading text size" }).getByRole("button", { name: "Reset", exact: true }).click();
    await contentSizes(page, 16, true);
    await size(title, 29);
  });
}

for (const phone of [false, true]) {
  test(`${phone ? "phone" : "desktop"} typography stays consistent for read-only notes and scoped away from Wiki`, async ({ page }) => {
    await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 1000 });
    const f = await seed(page);
    try {
      const note = await fixture(page, f.boards[0].boardId);
      await actor(page, f.viewer);
      await page.goto(`/notes?note=${note.id}`);
      await expect(page.locator(".bn-editor")).toHaveAttribute("contenteditable", "false");
      await contentSizes(page, phone ? 16 : 14.5, phone);
      await page.goto(f.note.wiki.canonicalHref);
      await expect(page.locator(".wiki-app")).toBeVisible();
      await expect(page.locator(".bn-editor")).toBeVisible();
      await expect(page.locator(".bn-editor")).not.toHaveCSS("font-family", /Public Sans/);
      await expect(page.locator(".notes-frame")).toHaveCount(0);
    } finally { await f.cleanup(); }
  });
}
