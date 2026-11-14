import { test, expect, type Page } from "@playwright/test";
import { mentionId, secondId, spaceId } from "../fixtures/wiki-p2-editor/documents";
import { fixtureNote, ids } from "../fixtures/wiki-ui/state";
import { mentionDocument } from "../fixtures/wiki-p2-editor/documents";

const readable = (noteId = mentionId, title = "Current title") => ({ noteId, state: "readable", title, href: `/wiki/_/${noteId}`, spaceId, spaceTitle: "Knowledge", archived: false });
const hit = (id = mentionId, title = "Current title") => ({ id, title, href: `/wiki/_/${id}`, spaceId, spaceTitle: "Knowledge", archived: false, updatedAt: "2026-11-04T12:00:00Z", snippet: [] });
async function routes(page: Page) {
  await page.route("**/api/wiki/mentions/resolve", route => route.fulfill({ json: { ok: true, mentions: route.request().postDataJSON().noteIds.map((id: string) => readable(id)) } }));
  await page.route("**/api/wiki/search?**", route => route.fulfill({ json: { ok: true, pages: [hit(), hit(secondId, "Second page")], offset: 0, limit: 20, hasMore: false } }));
}
async function open(page: Page, query = "") {
  await page.goto(`/editor?${query}`);
  await expect(page.locator(".bn-editor")).toBeVisible();
}
async function saved(page: Page) { return JSON.parse(await page.getByTestId("saved").innerText()); }

const browserErrors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }) => {
  const errors: string[] = []; browserErrors.set(page, errors);
  page.on("pageerror", error => errors.push(error.message));
  await routes(page);
});
test.afterEach(async ({ page }) => { expect(browserErrors.get(page)).toEqual([]); });

test("real schema round trip preserves defaults and emits generic mention Markdown and clipboard HTML", async ({ page }) => {
  await open(page, "kind=defaults");
  await page.getByRole("button", { name: "Schema round trip" }).click();
  const probe = page.getByTestId("probe");
  await expect(probe).toContainText('"supported":true');
  const result = JSON.parse(await probe.innerText());
  expect(result.content.formatVersion).toBe(2);
  expect(result.content.markdown).toContain(`[Wiki page](/wiki/_/${mentionId})`);
  expect(result.html).toContain("Wiki page"); expect(result.html).not.toContain("Current title");
  expect(result.content.blocks.find((block: { id: string }) => block.id === "code").props.language).toBe("typescript");
  expect(result.content.blocks.find((block: { id: string }) => block.id === "list").children[0].props.checked).toBe(true);
  expect(result.content.blocks.find((block: { id: string }) => block.id === "file").props.url).toBe("/api/notes/files/fixture");
  expect(result.content.blocks.find((block: { id: string }) => block.id === "table").content.rows[0].cells).toHaveLength(2);
});

test("keyboard and touch [[ insert ID-only atoms with a trailing space and emit format 2", async ({ page }, testInfo) => {
  await open(page, "kind=empty");
  const editor = page.locator(".bn-editor"); await editor.click(); await editor.pressSequentially("[[cur");
  await expect(page.getByRole("option", { name: "Current title Knowledge", exact: true })).toBeVisible();
  if (testInfo.project.name === "phone") await page.getByRole("option", { name: "Second page Knowledge" }).tap();
  else { await editor.press("ArrowDown"); await editor.press("Enter"); }
  await expect(editor.getByRole("button", { name: "Current title" })).toBeVisible();
  const content = await saved(page);
  expect(content.formatVersion).toBe(2);
  expect(content.blocks[0].content).toContainEqual({ type: "pageMention", props: { noteId: secondId } });
  expect(content.blocks[0].content.at(-1).text).toBe(" ");
  expect(content.markdown).toContain(`[Wiki page](/wiki/_/${secondId})`);
  expect(JSON.stringify(content)).not.toContain("Second page");
  expect(content.text).not.toContain("Current title");
  const url = page.url();
  if (testInfo.project.name === "phone") await editor.getByRole("button", { name: "Current title", exact: true }).tap();
  else await editor.getByRole("button", { name: "Current title", exact: true }).click();
  expect(page.url()).toBe(url);
  await expect(editor.getByRole("link", { name: "Open page" })).toBeVisible();
});

test("suggestions keep no-match/error/retry states, explicit archive scope, Escape and IME safe", async ({ page }) => {
  let fail = true;
  await page.route("**/api/wiki/search?**", route => fail ? route.fulfill({ status: 503, json: { error: "Unavailable" } }) : route.fulfill({ json: { ok: true, pages: new URL(route.request().url()).searchParams.get("includeArchivedSpaces") === "1" ? [hit()] : [], limit: 20, offset: 0, hasMore: false } }));
  await open(page, "kind=empty");
  const editor = page.locator(".bn-editor"); await editor.click(); await editor.pressSequentially("[[");
  await expect(page.getByText("Unable to find pages.")).toBeVisible(); fail = false;
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByText("No matching pages.")).toBeVisible();
  await page.getByRole("button", { name: "Include archived spaces" }).click();
  await expect(page.getByRole("option")).toHaveCount(1);
  await editor.pressSequentially("query");
  await expect(page.getByRole("button", { name: "Include archived spaces" })).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByRole("option")).toHaveCount(1);
  await editor.dispatchEvent("keydown", { key: "Enter", code: "Enter", isComposing: true, bubbles: true });
  await expect(page.getByRole("option")).toHaveCount(1);
  await editor.press("Escape"); await expect(page.getByRole("option")).toHaveCount(0);
  expect((await saved(page)).blocks[0].content[0].text).toBe("[[query");
});

test("late suggestion responses cannot overwrite the latest query", async ({ page }) => {
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void; const requested = new Promise<void>(resolve => { started = resolve; });
  await page.route("**/api/wiki/search?**", async route => {
    const q = new URL(route.request().url()).searchParams.get("q");
    if (q === "a") { started(); await gate; }
    await route.fulfill({ json: { ok: true, pages: [hit(mentionId, q === "a" ? "Stale result" : "Latest result")], limit: 20, offset: 0, hasMore: false } }).catch(() => {});
  });
  await open(page, "kind=empty"); const editor = page.locator(".bn-editor"); await editor.click(); await editor.pressSequentially("[[a");
  await requested; await editor.pressSequentially("b"); await expect(page.getByRole("option")).toContainText("Latest result");
  release(); await expect(page.getByRole("option")).not.toContainText("Stale result");
});

test("resolver batches unique IDs, invalidates current titles on tokens, ignores late prior session", async ({ page }) => {
  let title = "Original title", restricted = false;
  const batches: string[][] = [];
  await page.route("**/api/wiki/mentions/resolve", route => {
    const ids: string[] = route.request().postDataJSON().noteIds; batches.push(ids);
    return route.fulfill({ json: { ok: true, mentions: ids.map(noteId => restricted ? { noteId, state: "restricted" } : readable(noteId, title)) } });
  });
  await open(page, "kind=batch");
  await expect(page.locator(".page-mention button")).toHaveCount(205);
  // Dev StrictMode may start and cancel the first request before remounting.
  expect(batches.slice(-3).map(batch => batch.length)).toEqual([100, 100, 5]);
  expect(batches.length).toBeLessThanOrEqual(5);
  expect(batches.every(batch => new Set(batch).size === batch.length && batch.length <= 100)).toBe(true);
  await open(page);
  await expect(page.locator(".page-mention button")).toHaveText("Original title");
  title = "Renamed target"; await page.getByRole("button", { name: "Notes token" }).click();
  await expect(page.locator(".page-mention button")).toHaveText("Renamed target");
  restricted = true; await page.getByRole("button", { name: "Board token" }).click();
  await expect(page.locator(".page-mention")).toHaveText("Restricted page");
  await expect(page.locator(".page-mention a")).toHaveCount(0);
  await expect(page.getByTestId("changes")).toHaveText("0");
});

test("resolver clears before a failed refresh and discards an obsolete session response", async ({ page }) => {
  await open(page); await expect(page.locator(".page-mention button")).toHaveText("Current title");
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  let started!: () => void; const requested = new Promise<void>(resolve => { started = resolve; });
  let first = true;
  await page.route("**/api/wiki/mentions/resolve", async route => {
    if (first) { first = false; started(); await gate; await route.fulfill({ json: { ok: true, mentions: [readable(mentionId, "Obsolete private title")] } }).catch(() => {}); }
    else await route.fulfill({ status: 503, json: { error: "Offline" } });
  });
  await page.getByRole("button", { name: "Notes token" }).click(); await requested;
  await expect(page.locator(".page-mention")).toHaveText("Wiki page");
  await page.getByRole("button", { name: "New session" }).click();
  release(); await expect(page.locator(".page-mention")).toHaveText("Wiki page");
  await expect(page.locator(".bn-editor")).not.toContainText("Obsolete private title");
});

test("public reader is read-only and makes zero resolver calls; unknown content never mounts", async ({ page }) => {
  let calls = 0; page.on("request", request => { if (request.url().includes("/api/wiki/")) calls++; });
  await open(page, "kind=public");
  await expect(page.locator(".bn-editor")).toHaveAttribute("contenteditable", "false");
  await expect(page.locator(".page-mention")).toHaveText("Wiki page");
  await expect(page.locator(".page-mention a")).toHaveCount(0);
  await page.getByRole("button", { name: "Board token" }).click(); expect(calls).toBe(0);
  for (const query of ["kind=unknown", "format=3", "format=1"]) {
    await page.goto(`/editor?${query}`);
    await expect(page.locator('main [role="alert"]')).toContainText("content has been preserved");
    await expect(page.locator(".bn-editor")).toHaveCount(0);
    await expect(page.getByTestId("changes")).toHaveText("0");
  }
});

test("ordinary paste uses generic links; wiki paste validates IDs and strips clipboard titles", async ({ page }) => {
  const paste = async () => page.locator(".bn-editor").evaluate((element, id) => {
    const transfer = new DataTransfer();
    transfer.setData("text/html", `<p>Copied <span data-inline-content-type="pageMention" data-note-id="${id}" data-title="Private cached title"><b>Private cached title</b></span></p>`);
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, mentionId);
  await open(page, "kind=ordinary"); await page.locator(".bn-editor").click(); await paste();
  await expect(page.locator(`.bn-editor a[href="/wiki/_/${mentionId}"]`)).toHaveText("Wiki page");
  expect(JSON.stringify(await saved(page))).not.toContain("pageMention");
  expect(JSON.stringify(await saved(page))).not.toContain("Private cached title");
  await open(page, "kind=empty"); await page.locator(".bn-editor").click(); await paste();
  await expect(page.locator(".page-mention button")).toHaveText("Current title");
  expect(JSON.stringify(await saved(page))).not.toContain("Private cached title");
  expect((await saved(page)).blocks[0].content).toContainEqual({ type: "pageMention", props: { noteId: mentionId } });
});

test("read-only to editable restores formatting and clears mention controls without resetting text", async ({ page }) => {
  await open(page, "readonly=1&mobile=1");
  const editor = page.locator(".bn-editor"); await expect(editor).toHaveAttribute("contenteditable", "false");
  await page.getByRole("button", { name: "Toggle editability" }).press("Enter");
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await editor.click(); await editor.press("End"); await editor.pressSequentially(" retained draft");
  await page.getByRole("button", { name: "Toggle formatting" }).click();
  await editor.click(); await editor.press("Control+a");
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toContain("retained draft");
  await expect(page.getByRole("button", { name: "Heading", exact: true })).toBeVisible();
  await editor.press("ArrowRight");
  await editor.getByRole("button", { name: "Current title", exact: true }).click();
  await expect(editor.getByRole("link", { name: "Open page" })).toBeVisible();
  await page.getByRole("button", { name: "Toggle editability" }).press("Enter");
  await expect(editor.getByRole("link", { name: "Open page" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Heading", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Toggle editability" }).press("Enter");
  await expect(editor).toContainText("retained draft");
  await expect(editor.getByRole("link", { name: "Open page" })).toHaveCount(0);
});

test("native copy carries neutral labels in every clipboard flavor and pastes into ordinary Notes", async ({ page }) => {
  await open(page); const editor = page.locator(".bn-editor");
  await expect(editor.locator(".page-mention button")).toHaveText("Current title");
  await editor.click(); await editor.press("Control+a");
  const clipboard = await editor.evaluate(element => {
    const data = new DataTransfer();
    element.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }));
    return Object.fromEntries(data.types.map(type => [type, data.getData(type)]));
  });
  expect(clipboard["text/plain"]).toContain("Wiki page");
  expect(clipboard["blocknote/html"]).toContain("pageMention");
  expect(JSON.stringify(clipboard)).not.toContain("Current title");
  await open(page, "kind=ordinary"); await page.locator(".bn-editor").click();
  await page.locator(".bn-editor").evaluate((element, values) => {
    const data = new DataTransfer(); for (const [type, value] of Object.entries(values)) data.setData(type, value);
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, clipboard);
  await expect(page.locator(`.bn-editor a[href="/wiki/_/${mentionId}"]`)).toHaveText("Wiki page");
  expect(JSON.stringify(await saved(page))).not.toContain("pageMention");
});

test("native read-only copy and partial atom selections never export resolved titles or public IDs", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  for (const query of ["readonly=1", "kind=reader", "kind=public"]) {
    await open(page, query);
    const editor = page.locator(".bn-editor");
    await expect(editor.locator(".page-mention")).toHaveText(query === "kind=public" ? "Wiki page" : "Current title");
    await editor.evaluate(element => {
      const selection = window.getSelection()!; const range = document.createRange();
      range.selectNodeContents(element); selection.removeAllRanges(); selection.addRange(range);
    });
    await page.keyboard.press("Control+c");
    const clipboard = await page.evaluate(async () => {
      const result: Record<string, string> = {};
      for (const item of await navigator.clipboard.read()) for (const type of item.types) result[type] = await (await item.getType(type)).text();
      return result;
    });
    expect(clipboard["text/plain"]).toContain("Wiki page");
    expect(JSON.stringify(clipboard)).not.toContain("Current title");
    if (query === "kind=public") expect(JSON.stringify(clipboard)).not.toContain(mentionId);
    else expect(clipboard["text/html"]).toContain(`/wiki/_/${mentionId}`);
  }
  await open(page);
  await expect(page.locator(".page-mention button")).toHaveText("Current title");
  const partial = await page.locator(".bn-editor").evaluate(element => {
    const text = element.querySelector(".page-mention button")!.firstChild!;
    const range = document.createRange(); range.setStart(text, 2); range.setEnd(text, 6);
    const selection = window.getSelection()!; selection.removeAllRanges(); selection.addRange(range);
    const data = new DataTransfer(); text.parentElement!.dispatchEvent(new ClipboardEvent("copy", { clipboardData: data, bubbles: true, cancelable: true }));
    return data.getData("text/plain");
  });
  expect(partial).toBe("Wiki page");
});

test("external mention drop into ordinary Notes becomes a generic link and keeps autosave working", async ({ page }) => {
  await open(page, "kind=ordinary"); const editor = page.locator(".bn-editor"); await editor.click();
  await editor.evaluate((element, id) => {
    const data = new DataTransfer(); data.setData("text/html", `<p><span data-inline-content-type="pageMention" data-note-id="${id}">Private drag title</span></p>`);
    const target = element.querySelector(".bn-inline-content")!; const rect = target.getBoundingClientRect();
    target.dispatchEvent(new DragEvent("drop", { dataTransfer: data, clientX: rect.left + 3, clientY: rect.top + 5, bubbles: true, cancelable: true }));
  }, mentionId);
  await expect(editor.locator(`a[href="/wiki/_/${mentionId}"]`)).toHaveText("Wiki page");
  await editor.press("End"); await editor.pressSequentially(" after drop");
  const content = await saved(page);
  expect(content.formatVersion).toBe(1); expect(JSON.stringify(content)).not.toContain("pageMention");
  expect(content.text).toContain("after drop"); expect(JSON.stringify(content)).not.toContain("Private drag title");
});

test("editable mention Open action is reachable and operable by keyboard", async ({ page, context }) => {
  await open(page); const editor = page.locator(".bn-editor");
  const button = editor.getByRole("button", { name: "Current title", exact: true }); await expect(button).toBeVisible();
  await editor.focus(); await page.keyboard.press("Tab"); await expect(button).toBeFocused();
  await page.keyboard.press("Enter"); const link = editor.getByRole("link", { name: "Open page" });
  await expect(link).toBeVisible(); await page.keyboard.press("Tab"); await expect(link).toBeFocused();
  await context.route(`**/wiki/_/${mentionId}`, route => route.fulfill({ body: "Target page", contentType: "text/html" }));
  const popup = page.waitForEvent("popup"); await page.keyboard.press("Enter"); const opened = await popup;
  await expect(opened).toHaveURL(new RegExp(`/wiki/_/${mentionId}$`)); await opened.close();
});

test("touch link controls still reopen, edit, open and remove", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "phone", "Touch-specific regression");
  await open(page, "kind=links&mobile=1");
  const editor = page.locator(".bn-editor"), toolbar = page.locator(".bn-link-toolbar");
  await editor.locator("a").tap();
  await toolbar.getByRole("button", { name: "Close link menu", exact: true }).tap();
  await expect(toolbar).toBeHidden(); await editor.locator("a").tap();
  await toolbar.getByRole("button", { name: "Edit link", exact: true }).tap();
  const input = page.locator('input[name="url"]'); await input.fill("https://example.com/changed"); await input.press("Enter");
  await expect(editor.locator("a")).toHaveAttribute("href", "https://example.com/changed");
  await editor.press("ArrowRight"); await editor.locator("a").tap();
  await page.context().route("https://example.com/changed", route => route.fulfill({ body: "Reference target", contentType: "text/html" }));
  const popup = page.waitForEvent("popup"); await toolbar.getByRole("button", { name: "Open in new tab", exact: true }).tap();
  const opened = await popup; await expect(opened).toHaveURL("https://example.com/changed"); await opened.close();
  await page.bringToFront(); await editor.press("ArrowRight"); await editor.locator("a").tap();
  await toolbar.getByRole("button", { name: "Remove link", exact: true }).tap();
  await expect(editor.locator("a")).toHaveCount(0);
});

test("responsive light and dark editor and menu have no document overflow", async ({ page }, testInfo) => {
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 }); await open(page, "kind=empty");
    const editor = page.locator(".bn-editor"); await editor.click(); await editor.pressSequentially("[[");
    await expect(page.getByRole("option")).toHaveCount(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`editor-${width}-light.png`) });
    await editor.press("Escape"); await page.getByRole("button", { name: "Theme", exact: true }).click();
    await editor.click(); await editor.press("End"); await editor.pressSequentially(" [[");
    await expect(page.getByRole("option")).toHaveCount(2);
    await page.screenshot({ path: testInfo.outputPath(`editor-${width}-dark.png`) });
  }
});

for (const surface of ["notes", "linked"]) test(`${surface} host saves v2 and revokes access with a pending draft, then regrants without losing it`, async ({ page }) => {
  let note = { ...fixtureNote(), content: mentionDocument, contentFormatVersion: 2 };
  const writes: Array<{ content?: { formatVersion: number }; title?: string }> = [];
  await page.route("**/api/notes**", async route => {
    const url = new URL(route.request().url());
    if (url.pathname === `/api/notes/${ids.note}`) {
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON(); writes.push(body);
        if (body.content) note = { ...note, content: body.content.blocks, contentMarkdown: body.content.markdown };
        if (body.title) note = { ...note, title: body.title };
        note = { ...note, contentVersion: note.contentVersion + 1 };
      }
      return route.fulfill({ json: { ok: true, note } });
    }
    if (url.pathname === "/api/notes/homes") return route.fulfill({ json: { ok: true, homeOptions: [] } });
    if (url.pathname === "/api/notes/notebooks") return route.fulfill({ json: { ok: true, notebooks: [], inboxCount: 0 } });
    if (url.pathname === "/api/notes/tags") return route.fulfill({ json: { ok: true, tags: [] } });
    return route.fulfill({ json: { ok: true, notes: [note] } });
  });
  await page.route("**/api/tasks/*/linked-notes**", route => route.fulfill({ json: { ok: true, notes: [note] } }));
  await page.route("**/api/boards/*/labels", route => route.fulfill({ json: { ok: true, labels: [] } }));
  await page.route("**/api/wiki/spaces**", route => route.fulfill({ json: { ok: true, spaces: [] } }));
  await page.goto(`/editor?surface=${surface}`);
  if (surface === "linked") await page.getByRole("tab", { name: /^Notes/ }).click();
  const editor = page.locator(".bn-editor"); await expect(editor).toBeVisible();
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await expect(editor.locator(".page-mention button")).toHaveText("Current title");
  await editor.click(); await editor.press("End"); await editor.pressSequentially(" first save");
  await expect.poll(() => writes.some(body => body.content?.formatVersion === 2)).toBe(true);
  // Retain a new pending body through the same token that changes permissions.
  await editor.pressSequentially(" pending recovery");
  note = { ...note, canEdit: false, wiki: { ...note.wiki!, spaceArchived: true } };
  await page.getByRole("button", { name: "Refresh access and mentions" }).click();
  await expect(editor).toHaveAttribute("contenteditable", "false");
  await expect(editor).toContainText("pending recovery");
  note = { ...note, canEdit: true, wiki: { ...note.wiki!, spaceArchived: false } };
  await page.getByRole("button", { name: "Refresh access and mentions" }).click();
  await expect(editor).toHaveAttribute("contenteditable", "true");
  await expect(editor).toContainText("pending recovery");
  await expect.poll(() => JSON.stringify(writes)).toContain("pending recovery");
});
