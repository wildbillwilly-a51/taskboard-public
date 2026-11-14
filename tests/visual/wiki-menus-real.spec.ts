import { test, expect, type Page, type Locator, type TestInfo } from "@playwright/test";
import { seed, body, actor } from "../helpers/wiki-real-fixture";

test.beforeEach(async ({ page }, info) => {
  await page.addInitScript(theme => { const stored = JSON.parse(localStorage.getItem("taskboard-ui-settings") || "{}"); localStorage.setItem("taskboard-ui-settings", JSON.stringify({ ...stored, theme, fontScale: stored.fontScale ?? "x-large" })); }, info.project.name.endsWith("light") ? "light" : "dark");
});

async function navigation(page: Page) {
  const button = page.getByRole("button", { name: "Open navigation", exact: true });
  if (await button.isVisible()) { await button.click(); return page.getByRole("dialog", { name: "Navigation", exact: true }); }
  return page.locator(".wiki-sidebar");
}

async function captureSurface(page: Page, surface: Locator, info: TestInfo, filename: string) {
  await expect(surface).toBeVisible();
  await expect.poll(() => surface.evaluate(el => { let opacity = 1; for (let item: Element | null = el; item; item = item.parentElement) opacity *= Number(getComputedStyle(item).opacity); return opacity; })).toBe(1);
  const viewport = page.viewportSize()!;
  await expect.poll(async () => { const box = await surface.boundingBox(); return Math.max(-box!.x, -box!.y, box!.x + box!.width - viewport.width, box!.y + box!.height - viewport.height); }).toBeLessThanOrEqual(1);
  if (viewport.width < 680 && await surface.getAttribute("role") === "menu") {
    const heights = await surface.locator('[role^="menuitem"]').evaluateAll(items => items.map(item => item.getBoundingClientRect().height));
    expect(heights.every(height => height >= 44)).toBe(true);
  }
  await page.screenshot({ path: info.outputPath(filename), animations: "disabled" });
}

test("real Wiki menus support pointer and keyboard, protect native targets and honor viewer access", async ({ page }, info) => {
  const f = await seed(page);
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  try {
    await page.goto(f.note.wiki.canonicalHref);
    await expect(page.locator(".wiki-edit .bn-editor")).toBeVisible();
    const trigger = page.getByRole("button", { name: "Page actions", exact: true });
    await trigger.focus(); await page.keyboard.press("ArrowDown");
    const menu = page.getByRole("menu", { name: "Page actions", exact: true });
    await expect(menu.getByRole("menuitem", { name: "History", exact: true })).toBeFocused();
    const labels = await menu.getByRole("menuitem").allTextContents();
    await page.keyboard.press("End"); await expect(menu.getByRole("menuitem", { name: "Export Markdown", exact: true })).toBeFocused();
    await page.keyboard.press("ArrowDown"); await expect(menu.getByRole("menuitem", { name: "History", exact: true })).toBeFocused();
    await page.screenshot({ path: info.outputPath("page-menu.png") });
    const viewport = page.viewportSize()!;
    await info.attach("menu-geometry.json", { body: JSON.stringify(await menu.evaluate(el => ({ menu: el.getBoundingClientRect().toJSON(), left: (el as HTMLElement).style.left, html: document.documentElement.getBoundingClientRect().toJSON(), htmlClientWidth: document.documentElement.clientWidth, body: document.body.getBoundingClientRect().toJSON(), visual: { width: visualViewport?.width, left: visualViewport?.offsetLeft }, gutter: getComputedStyle(document.documentElement).scrollbarGutter, margin: getComputedStyle(el).margin }))), contentType: "application/json" });
    await expect.poll(async () => { const box = await menu.boundingBox(); return box!.x + box!.width; }).toBeLessThanOrEqual(viewport.width);
    const geometry = await menu.boundingBox();
    expect(geometry!.x).toBeGreaterThanOrEqual(0); expect(geometry!.x + geometry!.width).toBeLessThanOrEqual(viewport.width);
    expect(geometry!.y + geometry!.height).toBeLessThanOrEqual(viewport.height);
    await page.keyboard.press("Escape"); await expect(trigger).toBeFocused();
    // An explicit later menu request owns the surface, even when a command
    // permission lookup is still pending. Hold the real response, not a mock.
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const delay = async (route: import("@playwright/test").Route) => { await gate; await route.continue(); };
    await page.route("**/api/wiki/spaces", delay);
    try {
      const requested = page.waitForRequest(request => new URL(request.url()).pathname === "/api/wiki/spaces" && !new URL(request.url()).search);
      await trigger.focus(); await page.keyboard.press("Control+k"); await requested;
      await trigger.press("Shift+F10");
      const completed = page.waitForResponse(response => new URL(response.url()).pathname === "/api/wiki/spaces" && !new URL(response.url()).search);
      release(); await completed;
      await expect(menu).toBeVisible(); await expect(page.getByRole("dialog", { name: "Wiki commands", exact: true })).toHaveCount(0);
      await page.keyboard.press("Escape");
    } finally { release(); await page.unroute("**/api/wiki/spaces", delay); }
    await trigger.press("Shift+F10"); await page.keyboard.press("Tab"); await expect(menu).toHaveCount(0);
    const nativeSelection = await page.locator(".wiki-attribution").evaluate(el => { const selection = window.getSelection()!; const range = document.createRange(); range.selectNodeContents(el); selection.removeAllRanges(); selection.addRange(range); const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true }); el.dispatchEvent(e); selection.removeAllRanges(); return e.defaultPrevented; });
    expect(nativeSelection).toBe(false);
    const header = page.locator(".wiki-page-menu-heading");
    expect(await header.evaluate(el => { const e = new PointerEvent("contextmenu", { pointerType: "touch", bubbles: true, cancelable: true }); el.dispatchEvent(e); return e.defaultPrevented; })).toBe(false);
    await header.click({ button: "right", position: { x: (await header.boundingBox())!.width - 2, y: (await header.boundingBox())!.height - 2 } });
    await expect(menu).toBeVisible(); expect(await menu.getByRole("menuitem").allTextContents()).toEqual(labels);
    await menu.getByRole("menuitem", { name: "Move to trash", exact: true }).click();
    await expect(page.getByRole("alertdialog")).toContainText("Move page to trash?");
    await page.getByRole("alertdialog").getByRole("button", { name: "Cancel", exact: true }).click();
    const title = page.getByRole("textbox", { name: "Page title", exact: true });
    const nativeTitle = await title.evaluate(el => { const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true }); el.dispatchEvent(event); return event.defaultPrevented; });
    expect(nativeTitle).toBe(false);
    const nativeEditor = await page.locator(".wiki-edit .bn-editor").evaluate(el => { const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true }); el.dispatchEvent(event); return event.defaultPrevented; });
    expect(nativeEditor).toBe(false);
    await page.goto(`/wiki/${f.spaces[0].slug}`);
    const row = page.locator("main .wiki-page-list .wiki-link-menu").first();
    const link = row.getByRole("link");
    expect(await link.evaluate(el => { const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true }); el.dispatchEvent(e); return e.defaultPrevented; })).toBe(false);
    const rowButton = row.getByRole("button"); await rowButton.focus(); await page.keyboard.press("Shift+F10");
    await expect(page.getByRole("menu").getByRole("menuitem", { name: "History", exact: true })).toBeVisible();
    // Exercise a rejected browser permission without touching the OS clipboard.
    await page.evaluate(() => Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async () => { throw new Error("Clipboard permission denied in synthetic test"); } } }));
    await page.getByRole("menu").getByRole("menuitem", { name: "Copy link", exact: true }).click();
    await expect(row.getByRole("alert")).toContainText("Unable to copy the link");
    await rowButton.click(); await expect(row.getByRole("alert")).toHaveCount(0);
    await page.getByRole("menu").getByRole("menuitem", { name: "History", exact: true }).click();
    await expect(page).toHaveURL(/view=history/); await expect(page.getByRole("button", { name: "Back to page", exact: true })).toBeVisible();
    await actor(page, f.viewer); await page.goto(f.note.wiki.canonicalHref);
    await page.getByRole("button", { name: "Page actions", exact: true }).click();
    await expect(menu.getByRole("menuitem", { name: "History", exact: true })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Copy to my notes", exact: true })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Move to trash", exact: true })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Move to space…", exact: true })).toHaveCount(0);
    await expect(menu.getByRole("menuitem", { name: "Set as space home", exact: true })).toHaveCount(0);
    await page.screenshot({ path: info.outputPath("viewer-menu.png") });
    expect(errors).toEqual([]);
  } finally { await f.cleanup(); }
});

test("real space and topic menus stay in the native drawer and hand navigation to their destination", async ({ page }, info) => {
  const f = await seed(page);
  try {
    const topicUrl = `/api/wiki/spaces/${f.spaces[0].id}/topics`;
    const tree = await body(await page.request.get(topicUrl));
    await body(await page.request.post(topicUrl, { data: { title: "Procedures", expectedTopicsVersion: tree.topicsVersion } }));
    await page.goto(f.note.wiki.canonicalHref);
    let nav = await navigation(page);
    const topicButton = nav.getByRole("button", { name: "Topic actions for Procedures", exact: true });
    await topicButton.click();
    const menu = page.getByRole("menu", { name: "Topic actions for Procedures", exact: true });
    await expect(menu.getByRole("menuitem", { name: "Manage topics", exact: true })).toBeVisible();
    if (await page.getByRole("dialog", { name: "Navigation", exact: true }).count()) expect(await menu.evaluate(el => Boolean(el.closest("dialog[open]")))).toBe(true);
    await page.screenshot({ path: info.outputPath("topic-menu.png") });
    await menu.getByRole("menuitem", { name: "Manage topics", exact: true }).click();
    const manager = page.getByRole("dialog", { name: "Manage topics", exact: true });
    await manager.getByRole("button", { name: "Edit Procedures", exact: true }).click();
    await expect(manager.getByRole("textbox", { name: "Topic title", exact: true })).toHaveValue("Procedures");
    await page.keyboard.press("Escape"); await expect(topicButton).toBeFocused();
    await topicButton.click(); await menu.getByRole("menuitem", { name: "Open topic", exact: true }).click();
    await expect(page).toHaveURL(/topicId=/); await expect(page.getByRole("dialog", { name: "Navigation", exact: true })).toHaveCount(0);
    nav = await navigation(page);
    await nav.getByRole("button", { name: `Space actions for ${f.spaces[0].title}`, exact: true }).click();
    await page.getByRole("menu").getByRole("menuitem", { name: "Space settings", exact: true }).click();
    await expect(page).toHaveURL(/settings=1/); await expect(page.getByRole("dialog", { name: "Navigation", exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Space settings", exact: true })).toBeVisible();
    nav = await navigation(page);
    await nav.getByRole("button", { name: `Space actions for ${f.spaces[0].title}`, exact: true }).click();
    await page.getByRole("menu").getByRole("menuitem", { name: "New page", exact: true }).click();
    await expect(page).toHaveURL(/new=1/); await expect(page.getByRole("dialog", { name: "Navigation", exact: true })).toHaveCount(0);
    const draft = page.getByRole("region", { name: "New wiki page", exact: true });
    await expect(draft).toBeVisible();
    await expect(draft.getByRole("combobox", { name: "Space", exact: true })).toHaveValue(f.spaces[0].id);
    await actor(page, f.viewer); await page.goto(`/wiki/${f.spaces[0].slug}`);
    nav = await navigation(page);
    await nav.getByRole("button", { name: `Space actions for ${f.spaces[0].title}`, exact: true }).click();
    await expect(page.getByRole("menu").getByRole("menuitem", { name: "Space settings", exact: true })).toHaveCount(0);
    await expect(page.getByRole("menu").getByRole("menuitem", { name: "New page", exact: true })).toHaveCount(0);
    await page.goto(`/wiki/${f.spaces[0].slug}?settings=1`);
    await expect(page.getByRole("region", { name: "Space settings", exact: true })).toHaveCount(0);
  } finally { await f.cleanup(); }
});

test("real Wiki editor menus and all text settings fit the viewport", async ({ page }, info) => {
  const f = await seed(page);
  const metrics: Array<{ scale: string; font: number; height: number }> = [];
  try {
    for (const scale of ["small", "normal", "large", "x-large", "xx-large"]) {
      await page.goto(f.note.wiki.canonicalHref);
      await page.evaluate(scale => { const settings = JSON.parse(localStorage.getItem("taskboard-ui-settings")!); settings.fontScale = scale; localStorage.setItem("taskboard-ui-settings", JSON.stringify(settings)); }, scale);
      await page.reload(); await expect(page.locator(".wiki-edit .bn-editor")).toBeVisible();
      await page.getByRole("button", { name: "Page actions", exact: true }).click();
      const menu = page.getByRole("menu", { name: "Page actions", exact: true });
      await expect(menu).toBeVisible();
      const row = menu.getByRole("menuitem", { name: "History", exact: true });
      metrics.push({ scale, ...await row.evaluate(el => ({ font: parseFloat(getComputedStyle(el).fontSize), height: el.getBoundingClientRect().height })) });
      const size = page.viewportSize()!;
      await expect.poll(async () => { const box = await menu.boundingBox(); return box!.x + box!.width; }).toBeLessThanOrEqual(size.width);
      await page.keyboard.press("Escape");
    }
    expect(new Set(metrics.map(m => m.font)).size).toBe(5);
    expect(metrics.every((m,i) => !i || m.font > metrics[i-1].font)).toBe(true);
    if (page.viewportSize()!.width < 680) expect(metrics.every(item => item.height >= 44)).toBe(true);
    await info.attach("menu-font-metrics.json", { body: JSON.stringify(metrics), contentType: "application/json" });
    const paragraph = page.locator('.wiki-edit [data-content-type="paragraph"]').first();
    await paragraph.click({ clickCount: 3 });
    const format = page.getByRole("toolbar").filter({ has: page.getByRole("button", { name: "Bold", exact: true }) });
    await expect(format).toBeVisible();
    await format.locator(".bn-ak-button").filter({ hasText: "Paragraph" }).click();
    const types = page.locator(".bn-ak-popover.bn-select");
    await captureSurface(page, types, info, "block-types.png");
    await page.keyboard.press("Escape");
    await paragraph.click({ clickCount: 3 });
    await page.getByRole("button", { name: "Colors", exact: true }).click();
    const colors = page.locator(".bn-color-picker-dropdown");
    await captureSurface(page, colors, info, "text-colors.png");
    await page.keyboard.press("Escape");
    await paragraph.click({ clickCount: 3 }); await page.keyboard.press("Control+k");
    await expect(page.getByPlaceholder("Edit URL")).toBeVisible();
    await expect(page.getByRole("dialog", { name: "Wiki commands", exact: true })).toHaveCount(0);
    await captureSurface(page, page.locator(".bn-form-popover"), info, "link-popover.png"); await page.keyboard.press("Escape");
    await paragraph.click(); await paragraph.hover();
    await page.getByRole("button", { name: "Open block menu", exact: true }).click();
    await expect(page.getByRole("menuitem", { name: "Delete", exact: true })).toBeVisible();
    await captureSurface(page, page.locator(".bn-drag-handle-menu"), info, "block-menu.png");
    await page.getByRole("menuitem", { name: "Colors", exact: true }).click();
    await captureSurface(page, page.locator(".bn-color-picker-dropdown"), info, "block-colors.png");
    await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
    const cell = page.locator(".wiki-edit table td").first();
    await cell.click(); await cell.hover();
    const tableHandle = page.locator(".bn-table-handle").filter({ visible: true }).first();
    await tableHandle.click();
    await expect(page.getByRole("menuitem", { name: /Delete (row|column)/ })).toBeVisible();
    await captureSurface(page, page.locator(".bn-table-handle-menu"), info, "table-menu.png"); await page.keyboard.press("Escape");
    await paragraph.click(); await page.keyboard.press("End"); await page.keyboard.press("Enter"); await page.keyboard.type("/");
    const slash = page.locator(".bn-suggestion-menu");
    await captureSurface(page, slash, info, "slash-menu.png");
    await page.keyboard.press("Escape");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { await f.cleanup(); }
});
