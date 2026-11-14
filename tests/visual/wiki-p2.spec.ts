import { test, expect, type Page } from "@playwright/test";
import { installP2Fixture } from "../helpers/wiki-p2-ui-fixture";
import { fixtureNote, ids } from "../fixtures/wiki-ui/state";
import { topicIds } from "../fixtures/wiki-p2-ui/state";
async function action(page: Page, name: string) { await page.getByRole("button", { name: "Page actions", exact: true }).click(); await page.getByRole("menuitem", { name, exact: true }).click(); }
async function navigation(page: Page) { if (await page.getByRole("button", { name: "Open navigation" }).isVisible()) await page.getByRole("button", { name: "Open navigation" }).click(); }

if (process.env.TASKBOARD_WIKI_P2_REAL !== "1") {
  test("always editable without focus theft; one menu, safe backlinks and responsive themes", async ({ page }, info) => {
    const { check } = await installP2Fixture(page);
    await page.goto(fixtureNote().wiki.canonicalHref + "?mode=read");
    await expect(page.getByRole("textbox", { name: "Page title", exact: true })).toHaveValue(fixtureNote().title);
    await expect(page.locator(".wiki-edit .bn-editor")).toBeVisible();
    expect(await page.evaluate(() => ["INPUT", "TEXTAREA"].includes(document.activeElement?.tagName || "") || document.activeElement?.getAttribute("contenteditable") === "true")).toBe(false);
    await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "History", exact: true })).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Backlinks" })).toContainText("Linked procedure");
    await expect(page.getByRole("region", { name: "Backlinks" }).locator("img")).toHaveCount(0);
    for (const theme of ["light", "dark"]) {
      if (await page.locator(".taskboard-settings-root").getAttribute("data-theme") !== theme) await page.getByRole("button", { name: "Switch color theme" }).click();
      await expect(page.locator(".taskboard-settings-root")).toHaveAttribute("data-theme", theme);
      const overflow = await page.evaluate(() => Array.from(document.querySelectorAll("body *")).filter(element => element.getBoundingClientRect().right > innerWidth + 1).map(element => `${element.tagName}.${element.className}`).slice(0, 12));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), overflow.join(", ")).toBe(true);
      await page.screenshot({ path: info.outputPath(`page-${theme}.png`), fullPage: true });
    }
    await action(page, "History"); await expect(page.getByRole("heading", { name: "Original welcome", exact: true })).toBeVisible();
    await expect(page.getByText("Current topic assignments are kept.", { exact: false })).toBeVisible();
    await page.getByRole("button", { name: "Back to page" }).click();
    await expect(page.locator(".wiki-edit .bn-editor")).toBeVisible(); check();
  });
  test("topic conflict keeps selected set and dirty body; intentional retry uses fresh expected IDs", async ({ page }) => {
    const { fixture, check } = await installP2Fixture(page); fixture.base.setFailSave();
    await page.goto(fixtureNote().wiki.canonicalHref);
    await page.getByRole("textbox", { name: "Page title", exact: true }).fill("My pending title");
    await expect(page.locator(".wiki-save-status")).toContainText("Save failed");
    await page.getByRole("button", { name: "Edit topics" }).click();
    const picker = page.getByRole("dialog", { name: "Page topics", exact: true });
    await picker.getByRole("checkbox", { name: "Operations / Daily routines", exact: true }).check();
    fixture.conflict(); await picker.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(picker.getByRole("alert")).toContainText("Your selections are kept");
    await expect(picker.getByRole("checkbox", { name: "Operations / Daily routines", exact: true })).toBeChecked();
    await picker.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(picker).toHaveCount(0);
    expect(fixture.selected).toEqual(topicIds.slice(0, 2)); expect(fixture.base.note.contentVersion).toBe(1);
    await expect(page.getByRole("textbox", { name: "Page title", exact: true })).toHaveValue("My pending title");
    const writes = fixture.requests.filter(request => request.method === "PUT");
    expect(writes[1].body).toMatchObject({ expectedTopicIds: [topicIds[2]], sourceSpaceId: ids.space }); check();
  });
  test("body autosave carries format 2 and content conflicts block export", async ({ page }) => {
    const { fixture, check } = await installP2Fixture(page);
    await page.goto(fixtureNote().wiki.canonicalHref);
    const editor = page.locator(".wiki-edit .bn-editor"); await expect(editor).toBeVisible();
    await editor.click(); await page.keyboard.press("Control+End"); await page.keyboard.type(" Fresh knowledge");
    await expect.poll(() => fixture.requests.some(request => request.method === "PATCH" && (request.body as { content?: { formatVersion: number } })?.content?.formatVersion === 2)).toBe(true);
    fixture.base.setConflict(); await page.getByRole("textbox", { name: "Page title", exact: true }).fill("Keep conflict");
    await expect(page.locator(".wiki-save-status")).toContainText("Conflicting edits");
    await action(page, "Export Markdown"); await expect(page.locator(".wiki-banner[role=alert]")).toContainText("Save or resolve"); check();
  });
  test("managers create, reparent and delete topics with accurate assignment count", async ({ page }) => {
    const { fixture, check } = await installP2Fixture(page);
    await page.goto(fixtureNote().wiki.canonicalHref); await navigation(page);
    await page.getByRole("button", { name: "Manage topics", exact: true }).filter({ visible: true }).click();
    const manager = page.getByRole("dialog", { name: "Manage topics", exact: true });
    await expect(manager.getByRole("button", { name: "Delete Operations", exact: true })).toBeDisabled();
    await manager.getByRole("button", { name: "Create topic", exact: true }).click();
    await manager.getByLabel("Topic title").fill("New procedure"); await manager.getByLabel("Parent topic").selectOption(topicIds[0]);
    await manager.getByRole("button", { name: "Create topic", exact: true }).click();
    await expect(manager.getByText("Operations / New procedure", { exact: true })).toBeVisible();
    await manager.getByRole("button", { name: "Edit New procedure", exact: true }).click();
    await manager.getByLabel("Parent topic").selectOption(""); await manager.getByLabel("Before sibling").selectOption(topicIds[0]);
    await manager.getByRole("button", { name: "Save topic", exact: true }).click();
    await expect.poll(() => fixture.topics.find(topic => topic.title === "New procedure")?.parentTopicId).toBe(null);
    await manager.getByRole("button", { name: "Delete New procedure", exact: true }).click();
    const confirmation = page.getByRole("dialog", { name: "Delete New procedure?", exact: true });
    await expect(confirmation).toContainText("0 assigned pages, including trash");
    await confirmation.getByRole("button", { name: "Delete topic", exact: true }).click();
    await expect(manager.getByRole("button", { name: "Edit New procedure", exact: true })).toHaveCount(0); check();
  });
  for (const scenario of ["viewer", "archived", "trash", "editor"] as const) test(`${scenario} has role-correct page actions and topics`, async ({ page }) => {
    const { check } = await installP2Fixture(page, scenario); await page.goto(fixtureNote(scenario).wiki.canonicalHref);
    if (scenario === "editor") { await expect(page.getByRole("textbox", { name: "Page title", exact: true })).toBeVisible(); await page.getByRole("button", { name: "Edit topics" }).click(); await expect(page.getByRole("dialog").getByRole("button", { name: "Create topic" })).toHaveCount(0); await page.keyboard.press("Escape"); }
    else { await expect(page.locator(".wiki-document")).toBeVisible(); await expect(page.getByRole("textbox", { name: "Page title", exact: true })).toHaveCount(0); await expect(page.getByRole("button", { name: "Edit topics" })).toHaveCount(0); }
    await page.getByRole("button", { name: "Page actions", exact: true }).click();
    if (scenario === "trash") { await expect(page.getByRole("menuitem", { name: "Restore from trash" })).toBeVisible(); await expect(page.getByRole("menuitem", { name: "Delete permanently", exact: true })).toBeVisible(); await expect(page.getByRole("menuitem", { name: "Copy to my notes" })).toHaveCount(0); }
    else { await expect(page.getByRole("menuitem", { name: "Copy to my notes" })).toBeVisible(); if (scenario !== "editor") await expect(page.getByRole("menuitem", { name: "Move to trash" })).toHaveCount(0); }
    check();
  });
  test("drawer traps focus, restores trigger and closes on topic selection; search is safe", async ({ page }) => {
    const { check } = await installP2Fixture(page); await page.goto(fixtureNote().wiki.canonicalHref);
    const trigger = page.getByRole("button", { name: "Open navigation" });
    if (await trigger.isVisible()) {
      await trigger.click(); const drawer = page.getByRole("dialog", { name: "Navigation", exact: true }); await expect(drawer).toBeVisible();
      for (let i = 0; i < 20; i++) { await page.keyboard.press("Tab"); expect(await drawer.evaluate(element => element.contains(document.activeElement))).toBe(true); }
      await page.keyboard.press("Escape"); await expect(trigger).toBeFocused(); await trigger.click();
      await drawer.getByRole("link", { name: "Daily routines 0", exact: true }).click(); await expect(drawer).toHaveCount(0);
      await expect(page).toHaveURL(new RegExp(`topicId=${topicIds[1]}`));
    }
    await page.goto("/wiki?q=knowledge"); const results = page.getByRole("region", { name: "Search results" });
    await expect(results.locator("mark")).toHaveText("knowledge"); await expect(results.locator("img")).toHaveCount(0); check();
  });
  test("live archive and revoke retain local draft and remove writable/private surfaces", async ({ page }) => {
    const { fixture, check } = await installP2Fixture(page); fixture.base.setFailSave(); await page.goto(fixtureNote().wiki.canonicalHref);
    await page.getByRole("textbox", { name: "Page title", exact: true }).fill("Retain locally"); await expect(page.locator(".wiki-save-status")).toContainText("Save failed");
    fixture.base.archive(); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByText("Archived space · Read only", { exact: true })).toBeVisible();
    fixture.base.archive(false); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("textbox", { name: "Page title", exact: true })).toHaveValue("Retain locally");
    fixture.revoke(); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page.getByRole("heading", { name: "Page unavailable" })).toBeVisible();
    await expect(page.getByLabel("Unsaved local text")).toContainText("Retain locally"); check();
  });
  test("live rename preserves an open topic selection and focus while updating the address", async ({ page }) => {
    const { fixture, check } = await installP2Fixture(page); await page.goto(fixtureNote().wiki.canonicalHref);
    await page.getByRole("button", { name: "Edit topics" }).click();
    const picker = page.getByRole("dialog", { name: "Page topics", exact: true });
    const choice = picker.getByRole("checkbox", { name: "Operations / Daily routines", exact: true });
    await choice.check(); await picker.getByLabel("Find a topic").fill("Daily");
    fixture.base.externalEdit("Renamed during classification"); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(page).toHaveURL(/renamed-during-classification$/);
    await expect(picker.getByLabel("Find a topic")).toHaveValue("Daily"); await expect(picker.getByLabel("Find a topic")).toBeFocused();
    await expect(choice).toBeChecked(); await picker.getByRole("button", { name: "Apply", exact: true }).click();
    await expect(page.locator(".wiki-topic-chips")).toContainText("Daily routines"); check();
  });

  test("open mutation dialogs close on archive and stay closed after recovery", async ({ page }) => {
    const { fixture, check } = await installP2Fixture(page); await page.goto(fixtureNote().wiki.canonicalHref);
    for (const kind of ["move", "topics"]) {
      if (kind === "move") await action(page, "Move to space…"); else await page.getByRole("button", { name: "Edit topics" }).click();
      await expect(page.getByRole("dialog")).toBeVisible();
      fixture.base.archive(); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(page.getByText("Archived space · Read only", { exact: true })).toBeVisible(); await expect(page.getByRole("dialog")).toHaveCount(0);
      fixture.base.archive(false); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
      await expect(page.getByRole("textbox", { name: "Page title", exact: true })).toBeEnabled(); await expect(page.getByRole("dialog")).toHaveCount(0);
      expect(await page.evaluate(() => document.body.style.overflow)).not.toBe("hidden");
    }
    check();
  });

  test("stale and malformed topics keep the space visible without an unfiltered fallback", async ({ page }) => {
    const { check } = await installP2Fixture(page);
    for (const topic of ["bad-id", "70000000-0000-4000-8000-999999999999"]) {
      await page.goto(`/wiki/handbook?topicId=${topic}&q=knowledge`);
      await expect(page.getByRole("heading", { name: "Team handbook", exact: true })).toBeVisible();
      await expect(page.getByRole("alert").filter({ hasText: "Show all pages in this space" })).toBeVisible();
      await expect(page.getByRole("region", { name: "Pages", exact: true })).toHaveCount(0);
      await expect(page.getByRole("region", { name: "Search results", exact: true })).toHaveCount(0);
    }
    check();
  });
  test("temporary topic refresh failure preserves a manager's in-progress form", async ({ page }) => {
    const { check } = await installP2Fixture(page); await page.goto(fixtureNote().wiki.canonicalHref); await navigation(page);
    await page.getByRole("button", { name: "Manage topics", exact: true }).filter({ visible: true }).click();
    const manager = page.getByRole("dialog", { name: "Manage topics", exact: true });
    await manager.getByRole("button", { name: "Create topic", exact: true }).click();
    await manager.getByLabel("Topic title").fill("Keep this draft"); await manager.getByLabel("Parent topic").selectOption(topicIds[2]);
    await page.route(`**/api/wiki/spaces/${ids.space}/topics`, route => route.request().method() === "GET" ? route.fulfill({ status: 503, json: { error: "Temporary test outage", code: "wiki_temporarily_unavailable" } }) : route.fallback());
    // Drive the existing live producer, not a new polling mechanism.
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(manager.getByRole("alert")).toContainText("Your form is kept");
    await expect(manager.getByLabel("Topic title")).toHaveValue("Keep this draft"); await expect(manager.getByLabel("Parent topic")).toHaveValue(topicIds[2]); check();
  });
  test("tree conflict clears vanished parent choices before intentional retry", async ({ page }) => {
    const { fixture, check } = await installP2Fixture(page); await page.goto(fixtureNote().wiki.canonicalHref); await navigation(page);
    await page.getByRole("button", { name: "Manage topics", exact: true }).filter({ visible: true }).click();
    const manager = page.getByRole("dialog", { name: "Manage topics", exact: true });
    await manager.getByRole("button", { name: "Create topic", exact: true }).click();
    await manager.getByLabel("Topic title").fill("Keep after conflict"); await manager.getByLabel("Parent topic").selectOption(topicIds[2]);
    fixture.deleteTopicExternally(topicIds[2]); await manager.getByRole("button", { name: "Create topic", exact: true }).click();
    await expect(manager.getByRole("alert")).toContainText("choices were reset"); await expect(manager.getByLabel("Parent topic")).toHaveValue("");
    await expect(manager.getByLabel("Topic title")).toHaveValue("Keep after conflict"); await manager.getByRole("button", { name: "Create topic", exact: true }).click();
    await expect.poll(() => fixture.topics.find(topic => topic.title === "Keep after conflict")?.parentTopicId).toBe(null);
    await manager.getByRole("button", { name: "Delete Keep after conflict", exact: true }).click();
    fixture.deleteTopicExternally(topicIds[1]);
    await page.evaluate(() => window.dispatchEvent(new Event("focus")));
    await expect(manager.locator("button").filter({ hasText: /^Edit Daily routines$/ })).toHaveCount(0);
    await page.getByRole("dialog", { name: "Delete Keep after conflict?", exact: true }).getByRole("button", { name: "Delete topic", exact: true }).click();
    await expect(manager.getByRole("alert")).toContainText("Topics changed elsewhere");
    expect(fixture.topics.some(topic => topic.title === "Keep after conflict")).toBe(true); check();
  });

} else {
  test("real integrated app: create, edit, classify, search and history without mocks", async ({ page }) => {
    const json = async (response: Awaited<ReturnType<Page["request"]["get"]>>) => { expect(response.ok(), await response.text()).toBe(true); return response.json(); };
    await json(await page.request.post("/api/auth/login", { data: { password: process.env.TASKBOARD_VISUAL_PASSWORD ?? "wiki-p2-ui-fixture" } }));
    const suffix = crypto.randomUUID().slice(0, 8);
    const { team } = await json(await page.request.post("/api/teams", { data: { name: `UI P2 ${suffix}` } }));
    const { board } = await json(await page.request.post(`/api/teams/${team.id}/boards`, { data: { title: `UI P2 ${suffix}`, teamMemberDefaultAccess: "viewer" } }));
    const { space } = await json(await page.request.post("/api/wiki/spaces", { data: { boardId: board.boardId, title: `UI P2 ${suffix}` } }));
    const { note } = await json(await page.request.post(`/api/wiki/spaces/${space.id}/pages`, { data: { title: `Live page ${suffix}` } }));
    await page.goto(note.wiki.canonicalHref);
    await page.getByRole("textbox", { name: "Page title", exact: true }).fill(`Knowledge ${suffix}`);
    await page.locator(".wiki-edit .bn-editor").click(); await page.keyboard.type(`Verified real document ${suffix}`);
    await expect.poll(async () => (await json(await page.request.get(`/api/wiki/pages/${note.id}`))).note.contentMarkdown).toContain(`Verified real document ${suffix}`);
    await page.getByRole("button", { name: "Edit topics" }).click(); const picker = page.getByRole("dialog", { name: "Page topics", exact: true });
    await picker.getByRole("button", { name: "Create topic", exact: true }).click(); await picker.getByLabel("Topic title").fill(`Procedure ${suffix}`); await picker.getByRole("button", { name: "Create topic", exact: true }).click();
    await picker.getByRole("checkbox", { name: `Procedure ${suffix}` }).check(); await picker.getByRole("button", { name: "Apply" }).click();
    await expect(page.locator(".wiki-topic-chips")).toContainText(`Procedure ${suffix}`);
    const assigned = await json(await page.request.get(`/api/wiki/pages/${note.id}/topics`)); expect(assigned.topics.map((topic: { title: string }) => topic.title)).toContain(`Procedure ${suffix}`);
    await action(page, "History"); await expect(page.getByRole("region", { name: "Page history" })).toBeVisible(); await page.getByRole("button", { name: "Back to page" }).click();
    const saved = (await json(await page.request.get(`/api/wiki/pages/${note.id}`))).note; expect(saved.contentFormatVersion).toBe(2); expect(saved.contentMarkdown).toContain(suffix);
    await page.goto(`/wiki?q=${suffix}`); await expect(page.getByRole("region", { name: "Search results" })).toContainText(`Knowledge ${suffix}`);
  });
}
