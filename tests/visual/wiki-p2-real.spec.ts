import { test, expect, type Page } from "@playwright/test";
import { seed, body, current, actor, content } from "../helpers/wiki-real-fixture";

// Real authentication, stores and HTTP throughout. No route fulfillments.
async function action(page: Page, label: string) {
  await page.getByRole("button", { name: "Page actions", exact: true }).click();
  await page.getByRole("menuitem", { name: label, exact: true }).click();
}
async function login(page: Page) {
  await body(await page.request.post("/api/auth/login", { data: { password: process.env.TASKBOARD_VISUAL_PASSWORD ?? "visual-test-password" } }));
}
const errors = new WeakMap<Page, string[]>();
test.beforeEach(async ({ page }, info) => {
  const list: string[] = []; errors.set(page, list);
  page.on("pageerror", error => list.push(error.message));
  await page.addInitScript(theme => localStorage.setItem("taskboard-ui-settings", JSON.stringify({ theme })), info.project.name.endsWith("light") ? "light" : "dark");
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

test("real topics, mention rename/restriction, backlinks, ranked snippets and public sanitization", async ({ page, browser }, info) => {
  const f = await seed(page);
  try {
    const target = (await body(await page.request.post(`/api/wiki/spaces/${f.spaces[1].id}/pages`, { data: { title: `Needle${f.suffix}`, content: content("Target procedure") } }))).note;
    await page.goto(f.note.wiki.canonicalHref);
    const drawer = page.getByRole("button", { name: "Open navigation", exact: true });
    if (await drawer.isVisible()) await drawer.click();
    await page.getByRole("button", { name: "Manage topics", exact: true }).filter({ visible: true }).click();
    const manager = page.getByRole("dialog", { name: "Manage topics", exact: true });
    await manager.getByRole("button", { name: "Create topic", exact: true }).click();
    await manager.getByLabel("Topic title").fill(`Operations ${f.suffix}`);
    await manager.getByRole("button", { name: "Create topic", exact: true }).click();
    await expect(manager.getByRole("button", { name: `Edit Operations ${f.suffix}`, exact: true })).toBeVisible();
    const tree = await body(await page.request.get(`/api/wiki/spaces/${f.spaces[0].id}/topics`));
    const root = tree.topics.find((topic: { title: string }) => topic.title === `Operations ${f.suffix}`);
    await manager.getByRole("button", { name: "Create topic", exact: true }).click();
    await manager.getByLabel("Topic title").fill(`Daily ${f.suffix}`);
    await manager.getByLabel("Parent topic").selectOption(root.id);
    await manager.getByRole("button", { name: "Create topic", exact: true }).click();
    await expect(manager.getByText(`Operations ${f.suffix} / Daily ${f.suffix}`, { exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath("nested-topics.png"), fullPage: true });
    await actor(page, f.editor); await page.goto(f.note.wiki.canonicalHref);
    await page.getByRole("button", { name: "Edit topics", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Page topics", exact: true });
    await expect(picker.getByRole("button", { name: "Create topic", exact: true })).toHaveCount(0);
    await picker.getByRole("checkbox", { name: `Operations ${f.suffix} / Daily ${f.suffix}`, exact: true }).check();
    await picker.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(picker).toHaveCount(0);
    await expect(page.locator(".wiki-topic-chips")).toContainText(`Daily ${f.suffix}`);
    const editor = page.locator(".wiki-edit .bn-editor");
    await editor.getByText("Original document body", { exact: true }).click();
    await expect(editor).toBeFocused();
    await page.keyboard.press("Control+End"); await page.keyboard.type(` [[Needle${f.suffix}`);
    const option = page.getByRole("option").filter({ hasText: `Needle${f.suffix}` });
    await expect(option).toBeVisible();
    if (info.project.name.startsWith("desktop")) await page.keyboard.press("Enter"); else await option.tap();
    await expect.poll(async () => JSON.stringify((await current(page, f.note.id)).content)).toContain('"pageMention"');
    const mentionVersion = (await current(page, f.note.id)).contentVersion;
    const saved = await current(page, f.note.id);
    expect(JSON.stringify(saved.content)).not.toContain(`Needle${f.suffix}`);
    expect(saved.contentMarkdown).toContain(`[Wiki page](/wiki/_/${target.id})`);
    await body(await page.request.patch(`/api/notes/${target.id}`, { data: { title: `Renamed${f.suffix}`, expectedVersion: target.contentVersion } }));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(editor.locator(".page-mention")).toContainText(`Renamed${f.suffix}`);
    await page.screenshot({ path: info.outputPath("mention-current-title.png"), fullPage: true });
    await page.goto(target.wiki.canonicalHref);
    await expect(page.getByRole("region", { name: "Backlinks" })).toContainText(f.note.title);
    await page.goto(f.note.wiki.canonicalHref);
    // A different author starts a distinct history session; same-author edits
    // intentionally coalesce into one version during the autosave window.
    await login(page);
    await body(await page.request.patch(`/api/notes/${f.note.id}`, { data: { content: content("Replacement body before restoring mentions"), expectedVersion: (await current(page, f.note.id)).contentVersion } }));
    await actor(page, f.editor);
    await page.reload();
    await expect(editor.locator(".page-mention")).toHaveCount(0);
    await expect.poll(async () => (await current(page, f.note.id)).contentMarkdown).toContain("Replacement body");
    await action(page, "History");
    await page.getByRole("button", { name: new RegExp(`^Version ${mentionVersion} ·`) }).click();
    await expect(page.locator(".wiki-document .page-mention")).toContainText(`Renamed${f.suffix}`);
    await page.getByRole("button", { name: `Restore version ${mentionVersion}`, exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Restore version", exact: true }).click();
    await expect(editor.locator(".page-mention")).toContainText(`Renamed${f.suffix}`);
    expect((await body(await page.request.get(`/api/wiki/pages/${f.note.id}/topics`))).topics).toHaveLength(1);
    // The viewer keeps source access but loses target access on the other board.
    await f.pool.query("DELETE FROM board_members WHERE board_id=$1 AND user_id=$2", [f.boards[1].boardId, f.viewer]);
    await actor(page, f.viewer); await page.goto(f.note.wiki.canonicalHref);
    await expect(page.getByLabel("Restricted page", { exact: true })).toBeVisible();
    await expect(page.locator(".page-mention a")).toHaveCount(0);
    await expect(page.locator(".wiki-document")).not.toContainText(`Renamed${f.suffix}`);
    await page.screenshot({ path: info.outputPath("restricted-mention.png"), fullPage: true });
    await login(page);
    await body(await page.request.post(`/api/wiki/spaces/${f.spaces[0].id}/pages`, { data: { title: `Ranking${f.suffix}`, content: content("A title hit") } }));
    await body(await page.request.post(`/api/wiki/spaces/${f.spaces[0].id}/pages`, { data: { title: `Body-only ${f.suffix}`, content: content(`Paragraph Ranking${f.suffix} with a useful snippet`) } }));
    await page.goto(`/wiki?q=Ranking${f.suffix}`);
    const results = page.getByRole("region", { name: "Search results", exact: true });
    await expect(results.locator("li").first()).toContainText(`Ranking${f.suffix}`);
    await expect(results.locator("li").nth(1)).toContainText("useful snippet");
    await expect(results.locator("mark").first()).toBeVisible();
    await page.screenshot({ path: info.outputPath("ranked-search.png"), fullPage: true });
    const state = await body(await page.request.get(`/api/board?boardId=${f.boards[0].boardId}`));
    const task = await body(await page.request.post("/api/tasks", { data: { boardId: f.boards[0].boardId, bucketId: state.board.buckets[0].id, title: `Published ${f.suffix}` } }));
    await body(await page.request.post(`/api/notes/${f.note.id}/links`, { data: { taskId: task.taskId } }));
    const share = await body(await page.request.post(`/api/tasks/${task.taskId}/public-share`, { headers: { origin: process.env.TASKBOARD_BASE_URL! }, data: { action: "create" } }));
    const anonymous = await browser.newContext({ viewport: page.viewportSize()!, colorScheme: info.project.name.endsWith("light") ? "light" : "dark" });
    try {
      const publicPage = await anonymous.newPage(), requests: string[] = [];
      publicPage.on("request", request => requests.push(request.url()));
      await publicPage.goto(new URL(share.url, process.env.TASKBOARD_BASE_URL).href);
      await publicPage.getByRole("tab", { name: /^Notes/ }).click();
      await expect(publicPage.getByRole("tabpanel", { name: /^Notes/ })).toContainText("Wiki page");
      const html = await publicPage.content();
      expect(html).not.toContain(target.id); expect(html).not.toContain(`Renamed${f.suffix}`);
      expect(requests.filter(url => url.includes("/api/wiki/mentions"))).toEqual([]);
      await publicPage.screenshot({ path: info.outputPath("public-generic-mention.png"), fullPage: true });
    } finally { await anonymous.close(); }
    await page.goto(f.note.wiki.canonicalHref); await action(page, "Copy to my notes");
    await expect(page).toHaveURL(/\/notes\?note=/);
    const copiedId = new URL(page.url()).searchParams.get("note")!;
    const copied = (await body(await page.request.get(`/api/notes/${copiedId}`))).note;
    expect(copied.contentFormatVersion).toBe(1); expect(JSON.stringify(copied.content)).not.toContain('"pageMention"');
    await page.goto(f.note.wiki.canonicalHref); await action(page, "Move to space…");
    await page.getByRole("combobox", { name: "Destination space", exact: true }).selectOption(f.spaces[1].id);
    await page.getByRole("button", { name: "Move page", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Move page", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/wiki/${f.spaces[1].slug}/`));
    expect((await body(await page.request.get(`/api/wiki/pages/${f.note.id}/topics`))).topics).toHaveLength(0);
    await body(await page.request.patch(`/api/wiki/spaces/${f.spaces[1].id}`, { data: { archived: true } }));
    await page.reload(); await expect(page.getByText("Archived space · Read only", { exact: true })).toBeVisible();
    await expect(page.locator('.bn-editor[contenteditable="true"]')).toHaveCount(0);
  } finally { await f.cleanup(); }
});

test("real format-1 page opens and upgrades on edit while ordinary Notes stay format 1", async ({ page }, info) => {
  const f = await seed(page);
  try {
    await f.pool.query("UPDATE notes SET content_format_version=1 WHERE id=$1", [f.note.id]);
    await page.goto(f.note.wiki.canonicalHref);
    const editor = page.locator(".wiki-edit .bn-editor");
    await expect(editor).toContainText("Original document body");
    await expect(editor).toHaveAttribute("contenteditable", "true");
    await expect(page.getByRole("textbox", { name: "Page title", exact: true })).toBeEnabled();
    await editor.getByText("Original document body", { exact: true }).click();
    await expect(editor).toBeFocused();
    await editor.press("End");
    await editor.press("Enter");
    await editor.pressSequentially("Preserved legacy content");
    await expect.poll(async () => (await current(page, f.note.id)).contentFormatVersion).toBe(2);
    expect((await current(page, f.note.id)).contentMarkdown).toContain("Original document body");
    await page.screenshot({ path: info.outputPath("legacy-page-upgraded.png"), fullPage: true });
    const ordinary = (await body(await page.request.post("/api/notes", { data: { title: `Ordinary ${f.suffix}`, content: { ...content("Ordinary body"), formatVersion: 1 } } }))).note;
    await page.goto(`/notes?note=${ordinary.id}`);
    await page.locator(".bn-editor").fill("Ordinary edit remains format one");
    await expect.poll(async () => (await body(await page.request.get(`/api/notes/${ordinary.id}`))).note.contentMarkdown).toContain("Ordinary edit remains");
    expect((await body(await page.request.get(`/api/notes/${ordinary.id}`))).note.contentFormatVersion).toBe(1);
  } finally { await f.cleanup(); }
});

test("real concurrent topic edits preserve intent and dirty body; stale filters and drawer are safe", async ({ page }, info) => {
  const f = await seed(page);
  const topicsUrl = `/api/wiki/spaces/${f.spaces[0].id}/topics`;
  const assignmentUrl = `/api/wiki/pages/${f.note.id}/topics`;
  try {
    await page.goto(f.note.wiki.canonicalHref);
    const trigger = page.getByRole("button", { name: "Open navigation", exact: true });
    if (await trigger.isVisible()) {
      await trigger.click();
      const drawer = page.getByRole("dialog", { name: "Navigation", exact: true });
      for (let i = 0; i < 15; i++) {
        await page.keyboard.press("Tab");
        expect(await drawer.evaluate(element => element.contains(document.activeElement))).toBe(true);
      }
      await page.screenshot({ path: info.outputPath("navigation-drawer.png"), fullPage: true });
      await page.keyboard.press("Escape"); await expect(trigger).toBeFocused(); await trigger.click();
    }
    await page.getByRole("button", { name: "Manage topics", exact: true }).filter({ visible: true }).click();
    const manager = page.getByRole("dialog", { name: "Manage topics", exact: true });
    await manager.getByRole("button", { name: "Create topic", exact: true }).click();
    await manager.getByLabel("Topic title").fill(`Kept ${f.suffix}`);
    const before = await body(await page.request.get(topicsUrl));
    const external = await body(await page.request.post(topicsUrl, { data: { title: `External ${f.suffix}`, expectedTopicsVersion: before.topicsVersion } }));
    await manager.getByRole("button", { name: "Create topic", exact: true }).click();
    await expect(manager.getByRole("alert")).toContainText("Topics changed elsewhere");
    await expect(manager.getByLabel("Topic title")).toHaveValue(`Kept ${f.suffix}`);
    await manager.getByRole("button", { name: "Create topic", exact: true }).click();
    await expect(manager.getByRole("button", { name: `Edit Kept ${f.suffix}`, exact: true })).toBeVisible();
    await manager.getByRole("button", { name: "Close Manage topics", exact: true }).click();
    const drawer = page.getByRole("dialog", { name: "Navigation", exact: true });
    if (await drawer.isVisible()) await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Edit topics", exact: true }).click();
    const picker = page.getByRole("dialog", { name: "Page topics", exact: true });
    await picker.getByRole("checkbox", { name: `Kept ${f.suffix}`, exact: true }).check();
    await body(await page.request.put(assignmentUrl, { data: { sourceSpaceId: f.spaces[0].id, expectedTopicIds: [], topicIds: [external.topic.id] } }));
    await picker.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(picker.getByRole("alert")).toContainText("Assignments changed elsewhere");
    await expect(picker.getByRole("checkbox", { name: `Kept ${f.suffix}`, exact: true })).toBeChecked();
    await picker.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(picker).toHaveCount(0);
    await expect(page.locator(".wiki-topic-chips")).toContainText(`Kept ${f.suffix}`);
    // Delay transport only: the save still reaches the real authenticated API.
    let release!: () => void;
    const held = new Promise<void>(resolve => { release = resolve; });
    await page.route(`**/api/notes/${f.note.id}`, async route => {
      if (route.request().method() === "PATCH") await held;
      await route.continue();
    });
    const editor = page.locator(".wiki-edit .bn-editor");
    await editor.getByText("Original document body", { exact: true }).click();
    await page.keyboard.press("End"); await page.keyboard.type(" Pending body survives topic metadata");
    const assigned = await body(await page.request.get(assignmentUrl));
    await body(await page.request.put(assignmentUrl, { data: { sourceSpaceId: f.spaces[0].id, expectedTopicIds: assigned.topics.map((t: { id: string }) => t.id), topicIds: [] } }));
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.locator(".wiki-topic-chips")).toContainText("No topics");
    await expect(editor).toContainText("Pending body survives topic metadata");
    release();
    await expect.poll(async () => (await current(page, f.note.id)).contentMarkdown).toContain("Pending body survives topic metadata");
    await page.unroute(`**/api/notes/${f.note.id}`);
    for (const topic of ["bad-id", crypto.randomUUID()]) {
      await page.goto(`/wiki/${f.spaces[0].slug}?topicId=${topic}&q=${f.suffix}`);
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(f.spaces[0].title);
      await expect(page.getByRole("alert").filter({ hasText: "Show all pages in this space" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Search results", exact: true })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Pages", exact: true })).toHaveCount(0);
    }
  } finally { await f.cleanup(); }
});

test("real search and backlink pagination exclude unreadable source pages", async ({ page }) => {
  const f = await seed(page);
  try {
    const prefix = `Pagination${f.suffix}`;
    const linked = { ...content("Source"), blocks: [{ type: "paragraph", content: [{ type: "pageMention", props: { noteId: f.note.id } }] }] };
    for (let i = 0; i < 55; i++) {
      await body(await page.request.post(`/api/wiki/spaces/${f.spaces[0].id}/pages`, { data: { title: `${prefix} ${String(i).padStart(2, "0")}`, content: linked } }));
    }
    const hidden = `${prefix} Private source`;
    await body(await page.request.post(`/api/wiki/spaces/${f.spaces[1].id}/pages`, { data: { title: hidden, content: linked } }));
    await f.pool.query("DELETE FROM board_members WHERE board_id=$1 AND user_id=$2", [f.boards[1].boardId, f.viewer]);
    await actor(page, f.viewer);
    for (const [url, name] of [[`/wiki?q=${prefix}`, "Search results"], [f.note.wiki.canonicalHref, "Backlinks"]]) {
      await page.goto(url);
      // Let the initial live-token refresh finish: a new authorized first page
      // deliberately invalidates previously appended pages, even if unchanged.
      await page.waitForLoadState("networkidle");
      const results = page.getByRole("region", { name, exact: true });
      await expect(results.getByRole("button", { name: "Load more pages", exact: true })).toBeVisible();
      expect(await results.getByRole("listitem").count()).toBeLessThan(55);
      while (await results.getByRole("button", { name: "Load more pages", exact: true }).isVisible()) {
        const before = await results.getByRole("listitem").count();
        await results.getByRole("button", { name: "Load more pages", exact: true }).click();
        await expect.poll(() => results.getByRole("listitem").count()).toBeGreaterThan(before);
      }
      await expect(results.getByRole("listitem")).toHaveCount(55);
      await expect(results).not.toContainText(hidden);
      expect(new Set(await results.getByRole("link").evaluateAll(links => links.map(link => link.getAttribute("href")))).size).toBe(55);
    }
  } finally { await f.cleanup(); }
});
