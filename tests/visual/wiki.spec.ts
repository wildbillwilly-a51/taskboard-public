import { test, expect, type Page } from "@playwright/test";
import { installWikiFixture } from "./wiki-seed";
import { fixtureNote, ids } from "../fixtures/wiki-ui/state";

test("responsive read, history, missing files and restored editor in both themes", async ({ page }, info) => {
  const { fixture, assertExpected } = await installWikiFixture(page);
  await page.goto(fixtureNote().wiki.canonicalHref);
  await expect(page.getByRole("textbox", { name: "Page title", exact: true })).toHaveValue("Welcome to the handbook");
  await expect(page.getByText("Review handbook", { exact: true })).toBeVisible();
  for (const theme of ["light", "dark"]) {
    if (await page.locator("html").getAttribute("data-theme") !== theme) await page.getByRole("button", { name: "Switch color theme" }).click();
    await expect(page.locator(".taskboard-settings-root")).toHaveAttribute("data-theme", theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath(`read-${theme}.png`), fullPage: true });
  }
  if (info.project.name === "phone") await page.setViewportSize({ width: 390, height: 480 });
  await pageSurface(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole("textbox", { name: "Page title", exact: true }).fill("A title typed before history");
  await expect.poll(() => fixture.note.title).toBe("A title typed before history");
  await pageAction(page, "History");
  await expect(page.getByRole("heading", { name: "Original welcome" })).toBeVisible();
  await expect(page.getByText("File unavailable", { exact: true }).first()).toBeVisible();
  await page.screenshot({ path: info.outputPath("history.png"), fullPage: true });
  await page.getByRole("button", { name: "Restore version 1", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Restore version", exact: true }).click();
  await expect.poll(() => fixture.note.contentVersion).toBe(3);
  await expect(page).not.toHaveURL(/view=history/);
  await expect(page.locator(".wiki-edit .bn-editor")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Page title", exact: true })).toHaveValue("Original welcome");
  await expect(page.locator(".wiki-edit .bn-editor")).toContainText("Original document body");
  assertExpected();
});
test("failed save and conflict stop restore and preserve unsaved text", async ({ page }) => {
  const { fixture, assertExpected } = await installWikiFixture(page);
  fixture.setFailSave();
  await page.goto(`${fixtureNote().wiki.canonicalHref}?mode=edit`);
  await page.getByRole("textbox", { name: "Page title", exact: true }).fill("Keep my unsaved title");
  await expect(page.getByRole("status").filter({ hasText: "Save failed" })).toBeVisible();
  await pageAction(page, "History");
  await page.getByRole("button", { name: "Restore version 1", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Restore version", exact: true }).click();
  await expect(page.locator(".wiki-banner[role=alert]")).toContainText("Save or resolve");
  expect(fixture.requests.some(request => request.path.includes("/versions/") && request.method === "POST")).toBe(false);
  fixture.setFailSave(false); fixture.setConflict();
  await pageSurface(page);
  await expect(page.getByRole("textbox", { name: "Page title", exact: true })).toHaveValue("Keep my unsaved title");
  await page.getByRole("button", { name: "Retry save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Conflicting edits" })).toBeVisible();
  assertExpected();
});
test("wiki poller sees live archive and read revocation without sending local drafts", async ({ page }) => {
  const { fixture, assertExpected } = await installWikiFixture(page);
  await page.goto(`${fixtureNote().wiki.canonicalHref}?mode=edit`);
  await expect.poll(() => fixture.requests.filter(request => request.path === "/api/live").length).toBeGreaterThan(0);
  fixture.archive();
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("Archived space · Read only", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
  fixture.revoke(); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading", { name: "Page unavailable", exact: true })).toBeVisible();
  await expect(page.getByText("Review handbook", { exact: true })).toHaveCount(0);
  assertExpected();
});
test("stale space and title redirect only after current page authorization", async ({ page }) => {
  await installWikiFixture(page, "moved");
  await page.goto(`/wiki/old-space/${ids.note}-old-title?mode=edit&view=history&version=${ids.version}&unknown=secret`);
  await expect(page).toHaveURL(new RegExp(`/wiki/operations/${ids.note}-welcome-to-the-handbook\\?view=history&version=${ids.version}$`));
  await expect(page.getByRole("heading", { name: "Welcome to the handbook" })).toBeVisible();
});
test("new page is an untouched local draft and palette offers eligible capture", async ({ page }) => {
  const { fixture, assertExpected } = await installWikiFixture(page);
  await page.goto(`/wiki?new=1&spaceId=${ids.space}`);
  await expect(page.getByRole("region", { name: "New wiki page" })).toBeVisible();
  expect(fixture.requests.some(request => request.method === "POST")).toBe(false);
  await page.getByRole("button", { name: "Close draft" }).click();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("New wiki page in Team handbook", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await page.getByText("New wiki page in Team handbook", { exact: true }).click();
  await expect(page.getByRole("region", { name: "New wiki page" })).toBeVisible();
  assertExpected();
});

test("move names the new audience, preserves version and copy uses the acknowledged version", async ({ page }) => {
  const { fixture, assertExpected } = await installWikiFixture(page);
  await page.goto(fixtureNote().wiki.canonicalHref);
  await pageAction(page, "Move to space…");
  await page.getByRole("button", { name: "Move page", exact: true }).click();
  await expect(page.getByRole("alertdialog")).toContainText("Operations team");
  await page.getByRole("alertdialog").getByRole("button", { name: "Move page", exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/wiki/operations/${ids.note}`));
  const move = fixture.requests.find(request => request.path.endsWith("/move"));
  expect(move?.body).toEqual({ spaceId: ids.other, sourceSpaceId: ids.space, expectedVersion: 1 });
  await pageAction(page, "Copy to my notes");
  await expect.poll(() => fixture.requests.find(request => request.path.endsWith("/copy"))?.body).toEqual({ expectedVersion: 1 });
  assertExpected();
});

test("manual upload leaves the content version and manager file deletion is explicit", async ({ page }) => {
  const { fixture, assertExpected } = await installWikiFixture(page);
  await page.goto(fixtureNote().wiki.canonicalHref);
  await page.locator('input[type="file"]').setInputFiles({ name: "upload.txt", mimeType: "text/plain", buffer: Buffer.from("Example bytes") });
  await expect(page.getByRole("link", { name: "upload.txt", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "guide.txt", exact: true })).toHaveCount(1);
  expect(fixture.note.contentVersion).toBe(1);
  await page.getByRole("region", { name: "Current files" }).getByRole("button", { name: "Delete permanently", exact: true }).first().click();
  await expect(page.getByRole("alertdialog")).toContainText("old versions");
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete permanently", exact: true }).click();
  await expect(page.getByRole("link", { name: "guide.txt", exact: true })).toHaveCount(0);
  assertExpected();
});

test("viewers receive new content and copy its fresh version", async ({ page }) => {
  const { fixture, assertExpected } = await installWikiFixture(page, "viewer");
  await page.goto(fixtureNote("viewer").wiki.canonicalHref);
  await expect.poll(() => fixture.requests.filter(request => request.path === "/api/live").length).toBeGreaterThan(0);
  fixture.externalEdit("Updated by another writer");
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading", { name: "Updated by another writer", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/updated-by-another-writer$/);
  await pageAction(page, "Copy to my notes");
  await expect.poll(() => fixture.requests.find(request => request.path.endsWith("/copy"))?.body).toEqual({ expectedVersion: 2 });
  assertExpected();
});

test("pending text can resume after archive or revoked access without rebasing", async ({ page }) => {
  const { fixture, assertExpected } = await installWikiFixture(page);
  fixture.setFailSave();
  await page.goto(`${fixtureNote().wiki.canonicalHref}?mode=edit`);
  await page.getByRole("textbox", { name: "Page title", exact: true }).fill("Local recovery title");
  await expect(page.locator(".wiki-save-status")).toContainText("Save failed");
  fixture.archive(); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByText("Archived space · Read only", { exact: true })).toBeVisible();
  fixture.archive(false); fixture.setFailSave(false); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("textbox", { name: "Page title", exact: true })).toBeEnabled();
  await page.getByRole("button", { name: "Save pending edits", exact: true }).click();
  await expect.poll(() => fixture.note.title).toBe("Local recovery title");
  fixture.revoke(); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("heading", { name: "Page unavailable", exact: true })).toBeVisible();
  fixture.revoke(false); await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByRole("textbox", { name: "Page title", exact: true })).toHaveValue("Local recovery title");
  assertExpected();
});

test("typing after create completes is saved while navigation is still pending", async ({ page }) => {
  const { fixture, assertExpected } = await installWikiFixture(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/wiki/handbook/**", async route => { await gate; await route.continue(); });
  await page.goto(`/wiki?new=1&spaceId=${ids.space}`);
  await page.getByRole("textbox", { name: "Page title", exact: true }).fill("First text");
  await expect.poll(() => fixture.requests.filter(request => request.path.endsWith("/pages") && request.method === "POST").length).toBe(1);
  await expect.poll(() => fixture.note.title).toBe("First text");
  await page.getByRole("textbox", { name: "Page title", exact: true }).fill("Typed after creation");
  await expect.poll(() => fixture.note.title).toBe("Typed after creation");
  release();
  await expect(page).toHaveURL(new RegExp(`/wiki/handbook/${ids.note}`));
  await expect(page.getByRole("textbox", { name: "Page title", exact: true })).toHaveValue("Typed after creation");
  assertExpected();
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
