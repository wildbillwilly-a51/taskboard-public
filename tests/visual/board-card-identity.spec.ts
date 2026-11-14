import { expect, test, type Page } from "@playwright/test";

// Board cards must keep their DOM identity after the first load, so a card
// focused right away stays focused. Run against an isolated password-mode
// fixture database, never production.
test.use({ viewport: { width: 1440, height: 1000 } });
test.setTimeout(90_000);

const errors = new WeakMap<Page, string[]>();
const card = (page: Page, id: string) => page.locator(`[data-task-nav="${id}"]`);

test.beforeEach(async ({ page }) => {
  const failures: string[] = [];
  errors.set(page, failures);
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    if (/Failed to refresh LLM run status/.test(message.text())) return;
    if (message.type() === "error") failures.push(message.text());
  });
  expect((await page.request.post("/api/auth/login", { data: { password: "visual-test-password" } })).ok()).toBe(true);
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

test("a card focused right after load keeps its element and focus", async ({ page }) => {
  // The first visit in a fresh browser applies the collapse preference once.
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  const href = await page.locator('a[href^="/calendar?boardId="]').first().getAttribute("href");
  const boardId = new URL(href!, page.url()).searchParams.get("boardId")!;
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const post = async (url: string, data: object) => {
    const response = await page.request.post(url, { data: { boardId, ...data } });
    expect(response.ok(), url).toBe(true);
    return await response.json();
  };
  // Created through the API, so the bucket is saved expanded.
  const bucket = await post("/api/buckets", { title: `Identity ${run}` });
  const ids: string[] = [];
  for (const title of ["Alpha", "Bravo"]) {
    ids.push((await post("/api/tasks", { bucketId: bucket.bucketId, title: `${title} ${run}` })).taskId as string);
  }

  await page.goto(`/?boardId=${boardId}`);
  await card(page, ids[0]).waitFor();
  await card(page, ids[0]).focus();
  await page.evaluate((id) => {
    (window as unknown as { focusedCard: Element | null }).focusedCard = document.querySelector(`[data-task-nav="${id}"]`);
  }, ids[0]);

  // The replacement used to land 0.3 to 1 second after the first render.
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(1500);
  await expect(card(page, ids[0])).toBeFocused();
  expect(
    await page.evaluate((id) => (window as unknown as { focusedCard: Element | null }).focusedCard === document.querySelector(`[data-task-nav="${id}"]`), ids[0]),
    "the focused card should still be the same element",
  ).toBe(true);
  // The saved expanded bucket stays expanded on a later visit.
  await expect(page.locator(`article[data-task-id="${ids[0]}"]`)).toBeVisible();

  // Keyboard navigation still starts from the focused card.
  await page.keyboard.press("j");
  await expect(card(page, ids[1])).toBeFocused();
});
