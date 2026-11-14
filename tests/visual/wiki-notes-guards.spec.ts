import { test, expect } from "@playwright/test";
import { installWikiFixture } from "./wiki-seed";
import { fixtureNote } from "../fixtures/wiki-ui/state";

for (const scenario of ["viewer", "archived", "editor", "trash"] as const) {
  test(`${scenario} capability guards and file actions`, async ({ page }) => {
    const { assertExpected } = await installWikiFixture(page, scenario);
    await page.goto(fixtureNote(scenario).wiki.canonicalHref);
    await expect(page.getByRole("link", { name: "guide.txt", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Page actions", exact: true }).click();
    if (scenario === "viewer" || scenario === "archived") {
      await expect(page.getByRole("button", { name: "Edit", exact: true })).toHaveCount(0);
      await expect(page.getByRole("menuitem", { name: "Move to trash", exact: true })).toHaveCount(0);
      await expect(page.getByRole("menuitem", { name: "Copy to my notes", exact: true })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Delete permanently", exact: true })).toHaveCount(0);
    } else if (scenario === "editor") {
      await expect(page.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Delete permanently", exact: true })).toHaveCount(0);
    } else {
      await expect(page.getByRole("menuitem", { name: "Restore from trash", exact: true })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Delete permanently", exact: true })).toBeVisible();
      await expect(page.getByRole("menuitem", { name: "Copy to my notes", exact: true })).toHaveCount(0);
    }
    assertExpected();
  });
}

test("Notes exposes wiki actions and removes ordinary home moves", async ({ page }, info) => {
  const { assertExpected } = await installWikiFixture(page, "editor");
  await page.goto("/notes");
  await expect(page.getByRole("link", { name: "Open in wiki ↗", exact: true })).toBeVisible();
  if (info.project.name === "desktop") {
    await expect(page.getByRole("combobox", { name: "Home", exact: true })).toHaveCount(0);
    await page.locator("[data-note-row]").first().click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Move to…", exact: true })).toHaveCount(0);
    await expect(page.getByRole("menuitem", { name: "Open in wiki", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
  }
  assertExpected();
});

test("ordinary board note promotes through the wiki action", async ({ page }) => {
  const { fixture, assertExpected } = await installWikiFixture(page, "ordinary");
  await page.goto("/notes");
  await page.getByRole("button", { name: "Add to wiki…", exact: true }).click();
  await page.getByRole("button", { name: "Add to wiki", exact: true }).click();
  await expect.poll(() => fixture.requests.find(request => request.path.endsWith("/add"))?.body).toEqual({ spaceId: fixture.note.wiki.spaceId, expectedVersion: 1 });
  await expect(page).toHaveURL(new RegExp(`/wiki/handbook/${fixture.note.id}`));
  assertExpected();
});
