import { expect, test, type Page } from "@playwright/test";

// Isolated password-mode visual fixture only; never production.
async function createSpace(page: Page, title: string) {
  await page.getByRole("button", { name: "New shared space", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toBeFocused();
  await page.keyboard.insertText(title);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test.beforeEach(async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: {
    password: process.env.TASKBOARD_VISUAL_PASSWORD ?? "visual-test-password",
  } })).ok()).toBe(true);
  await page.goto("/folio");
  await expect(page.getByRole("button", { name: "New shared space", exact: true })).toBeVisible();
});

test("right-click, ellipsis and keyboard hand text focus to native dialogs and return to their origin", async ({ page }) => {
  const title = `Focus fixture ${Date.now()}`;
  await createSpace(page, title);
  const row = page.locator("[data-space-row]").filter({ has: page.getByRole("button", { name: title, exact: true }) });
  const trigger = row.getByRole("button", { name: title, exact: true });
  const more = page.getByRole("button", { name: `Space actions for ${title}`, exact: true });
  for (const path of ["right-click", "ellipsis", "keyboard"] as const) {
    if (path === "right-click") await trigger.click({ button: "right" });
    else if (path === "ellipsis") await more.click();
    else await trigger.press("Shift+F10");
    await page.getByRole("menuitem", { name: "New subspace", exact: true }).click();
    const name = page.getByRole("textbox", { name: "Name", exact: true });
    await expect(name).toBeFocused();
    await page.keyboard.insertText("Unsaved subspace");
    await expect(name).toHaveValue("Unsaved subspace");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(path === "ellipsis" ? more : trigger).toBeFocused();
  }
  await more.click();
  await page.getByRole("menuitem", { name: "Rename or move", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Name", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await more.click();
  await page.getByRole("menuitem", { name: "Delete space", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancel", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("alertdialog")).toHaveCount(0);
});

test("Connect search receives focus after asynchronous menu navigation", async ({ page }) => {
  const created = await page.request.post("/api/folio", { data: { action: "createNote" } });
  expect(created.ok()).toBe(true);
  const { note } = await created.json();
  await page.reload();
  const row = page.locator(`[data-note-row="${note.id}"]`);
  await row.getByRole("button").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Connect to…", exact: true }).click();
  const search = page.getByRole("searchbox", { name: "Find a connection", exact: true });
  await expect(search).toBeFocused();
  await page.keyboard.insertText("Personal");
  await expect(search).toHaveValue("Personal");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(row.getByRole("button").first()).toBeFocused();
});
