import { expect, test, type Page } from "@playwright/test";

// Task right-click menus (docs/context-menus-phase1-plan.md). Run against an
// isolated password-mode fixture database, never production.
test.use({ viewport: { width: 1440, height: 1000 } });
test.setTimeout(90_000);

type BoardTask = { id: string; title: string; status: string; dueAt?: string | null; workItemType?: string; subtasks: BoardTask[] };
type BoardBucket = { id: string; title: string; tasks: BoardTask[] };

const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const errors = new WeakMap<Page, string[]>();
const card = (page: Page, id: string) => page.locator(`[data-task-nav="${id}"]`);
const menu = (page: Page) => page.getByRole("menu", { name: "Task actions", exact: true });
const item = (page: Page, name: string) => menu(page).getByRole("menuitem", { name, exact: true });
const radio = (page: Page, name: string) => menu(page).getByRole("menuitemradio", { name, exact: true });
const sidebarTitle = (page: Page) => page.getByTestId("task-editor-sidebar").getByTestId("task-inspector-title-input");

test.beforeEach(async ({ page }, testInfo) => {
  const failures: string[] = [];
  errors.set(page, failures);
  page.on("pageerror", (error) => failures.push(error.message));
  page.on("console", (message) => {
    // Tests that hold or fail requests on purpose see aborted fetches.
    if (/Failed to refresh LLM run status/.test(message.text())) return;
    if (message.type() === "error" && !/delayed|failed/.test(testInfo.title)) failures.push(message.text());
  });
  expect((await page.request.post("/api/auth/login", { data: { password: process.env.TASKBOARD_VISUAL_PASSWORD ?? "visual-test-password" } })).ok()).toBe(true);
});
test.afterEach(async ({ page }) => {
  expect(errors.get(page)).toEqual([]);
});

async function fixture(page: Page, titles = ["Alpha", "Bravo", "Charlie"]) {
  await page.goto("/");
  const href = await page.locator('a[href^="/calendar?boardId="]').first().getAttribute("href");
  const boardId = new URL(href!, page.url()).searchParams.get("boardId")!;
  const post = async (url: string, data: object) => {
    const response = await page.request.post(url, { data: { boardId, ...data } });
    expect(response.ok(), url).toBe(true);
    return await response.json();
  };
  const run = stamp();
  const bucket = await post("/api/buckets", { title: `Menus ${run}` });
  const other = await post("/api/buckets", { title: `Menus other ${run}` });
  const ids: string[] = [];
  for (const title of titles) {
    ids.push((await post("/api/tasks", { bucketId: bucket.bucketId, title: `${title} ${run}` })).taskId as string);
  }
  const read = async () => {
    const { board } = await (await page.request.get(`/api/board?boardId=${boardId}`)).json();
    return board.buckets as BoardBucket[];
  };
  const find = async (id: string) => {
    const walk = (tasks: BoardTask[], bucketId: string): { task: BoardTask; bucketId: string } | null => {
      for (const task of tasks) {
        if (task.id === id) return { task, bucketId };
        const found = walk(task.subtasks ?? [], bucketId);
        if (found) return found;
      }
      return null;
    };
    for (const entry of await read()) {
      const found = walk(entry.tasks, entry.id);
      if (found) return found;
    }
    return null;
  };
  return { boardId, bucketId: bucket.bucketId as string, otherBucketId: other.bucketId as string, otherTitle: `Menus other ${run}`, ids, run, post, find };
}

async function openBoard(page: Page, boardId: string, taskId?: string) {
  await page.goto(`/?boardId=${boardId}${taskId ? `&taskId=${taskId}` : ""}`);
  await expect(page.getByTestId("board-stage")).toBeVisible();
}

test("right-click targets B while A stays open; status, due date and move persist on B only", async ({ page }) => {
  const f = await fixture(page);
  const [a, b] = f.ids;
  await openBoard(page, f.boardId, a);
  await expect(sidebarTitle(page)).toHaveValue(new RegExp(`^Alpha`));

  await card(page, b).click({ button: "right" });
  await expect(menu(page)).toBeVisible();
  await expect(sidebarTitle(page)).toHaveValue(new RegExp(`^Alpha`));
  await expect(radio(page, "To do")).toHaveAttribute("aria-checked", "true");
  await radio(page, "Active").click();
  await expect.poll(async () => (await f.find(b))?.task.status).toBe("active");
  expect((await f.find(a))?.task.status).toBe("todo");
  await expect(card(page, b)).toBeFocused();

  await card(page, b).click({ button: "right" });
  await item(page, "Set due date…").click();
  await page.getByTestId("command-palette").getByRole("option", { name: /Due tomorrow/ }).click();
  await expect.poll(async () => Boolean((await f.find(b))?.task.dueAt)).toBe(true);
  expect((await f.find(a))?.task.dueAt ?? null).toBeNull();

  await card(page, b).click({ button: "right" });
  await item(page, "Move to bucket…").click();
  await page.getByTestId("command-palette").getByRole("option", { name: new RegExp(f.otherTitle) }).click();
  await expect.poll(async () => (await f.find(b))?.bucketId).toBe(f.otherBucketId);
  await expect(sidebarTitle(page)).toHaveValue(new RegExp(`^Alpha`));
});

test("with the inspector closed it stays closed; Archive and Delete on B keep A open", async ({ page }) => {
  const f = await fixture(page);
  const [a, b, c] = f.ids;
  await openBoard(page, f.boardId);
  await expect(page.getByTestId("task-editor-sidebar")).toHaveCount(0);
  await card(page, b).click({ button: "right" });
  await item(page, "Archive").click();
  await expect(card(page, b)).toHaveCount(0);
  await expect(page.getByTestId("task-editor-sidebar")).toHaveCount(0);
  // Focus moves to the card that took B's place, not to the page.
  await expect(card(page, c)).toBeFocused();
  await page.getByTestId("undo-toast").getByRole("button", { name: "Undo" }).click();
  await expect(card(page, b)).toBeVisible();

  await card(page, a).click();
  await expect(sidebarTitle(page)).toHaveValue(/^Alpha/);
  await card(page, c).click({ button: "right" });
  await item(page, "Archive").click();
  await expect(card(page, c)).toHaveCount(0);
  await expect(sidebarTitle(page)).toHaveValue(/^Alpha/);

  await card(page, b).click({ button: "right" });
  await item(page, "Delete").click();
  await expect(card(page, b)).toHaveCount(0);
  await expect(sidebarTitle(page)).toHaveValue(/^Alpha/);
  expect(await f.find(b)).toBeNull();
});

test("a delayed status save on the open task keeps the typed title and the action", async ({ page }) => {
  const f = await fixture(page);
  const [a] = f.ids;
  await openBoard(page, f.boardId, a);
  // Hold every save of A for a moment, so the editor's save and the menu's
  // change would overlap if they were not queued.
  let held = 0;
  await page.route((url) => url.pathname === `/api/tasks/${a}`, async (route) => {
    if (route.request().method() === "PATCH") {
      held += 1;
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    await route.continue();
  });
  const title = `Alpha retitled ${f.run}`;
  // Focus as a user would before replacing the title. On a cold navigation,
  // fill alone can lose its selection while React hydrates the textarea.
  await sidebarTitle(page).click();
  await sidebarTitle(page).fill(title);
  await card(page, a).click({ button: "right" });
  await radio(page, "Waiting").click();
  await card(page, a).click({ button: "right" });
  await item(page, "Promote to outage").click();
  await expect.poll(async () => (await f.find(a))?.task, { timeout: 15_000 }).toMatchObject({
    title,
    status: "waiting",
    workItemType: "maintenance_outage",
  });
  await page.waitForTimeout(1500);
  // Nothing wrote an older value back afterwards.
  expect((await f.find(a))?.task).toMatchObject({ title, status: "waiting", workItemType: "maintenance_outage" });
  expect(held).toBeGreaterThanOrEqual(2);
  await expect(sidebarTitle(page)).toHaveValue(title);
});

test("a delayed rename survives expanding into the workspace and changing status there", async ({ page }) => {
  const f = await fixture(page);
  const [a] = f.ids;
  await openBoard(page, f.boardId, a);
  await page.route((url) => url.pathname === `/api/tasks/${a}`, async (route) => {
    if (route.request().method() === "PATCH") await new Promise((resolve) => setTimeout(resolve, 1500));
    await route.continue();
  });
  const title = `Alpha renamed ${f.run}`;
  await sidebarTitle(page).click();
  await sidebarTitle(page).fill(title);
  // Expanding replaces the sidebar editor while its rename is still saving.
  await page.getByTestId("task-editor-sidebar").getByRole("button", { name: "Expand detail panel" }).click();
  const workspace = page.getByTestId("task-editor-expanded");
  await expect(workspace).toBeVisible();
  await workspace.getByRole("group", { name: "Status", exact: true }).getByRole("button", { name: "Active", exact: true }).click();
  await expect.poll(async () => (await f.find(a))?.task, { timeout: 15_000 }).toMatchObject({ title, status: "active" });
  await page.waitForTimeout(2000);
  expect((await f.find(a))?.task).toMatchObject({ title, status: "active" });
});

test("Done then another status, both while a save is delayed, are each sent in order", async ({ page }) => {
  const f = await fixture(page);
  const [a] = f.ids;
  await openBoard(page, f.boardId, a);
  await page.getByTestId("task-editor-sidebar").getByRole("button", { name: "Expand detail panel" }).click();
  const workspace = page.getByTestId("task-editor-expanded");
  await expect(workspace).toBeVisible();
  const statuses: string[] = [];
  await page.route((url) => url.pathname === `/api/tasks/${a}`, async (route) => {
    if (route.request().method() === "PATCH") {
      const status = (route.request().postDataJSON() as { status?: string }).status;
      if (status) statuses.push(status);
      await new Promise((resolve) => setTimeout(resolve, 800));
    }
    await route.continue();
  });
  const status = (name: string) => workspace.getByRole("group", { name: "Status", exact: true }).getByRole("button", { name, exact: true });
  await status("Active").click();
  await status("Done").click();
  await status("Waiting").click();
  await expect.poll(() => statuses, { timeout: 15_000 }).toEqual(["active", "done", "waiting"]);
  await expect.poll(async () => (await f.find(a))?.task.status, { timeout: 15_000 }).toBe("waiting");
});

test("saves still waiting when the viewer switches boards land on their own board", async ({ page }) => {
  const f = await fixture(page);
  const [a] = f.ids;
  const team = await (await page.request.post("/api/teams", { data: { name: `Menus team ${f.run}` } })).json();
  const teamId = (team.team?.id ?? team.team?.teamId) as string;
  const otherTitle = `Menus board ${f.run}`;
  const created = await page.request.post(`/api/teams/${teamId}/boards`, { data: { title: otherTitle } });
  expect(created.ok()).toBe(true);
  await openBoard(page, f.boardId, a);
  await page.route((url) => url.pathname === `/api/tasks/${a}`, async (route) => {
    if (route.request().method() === "PATCH") await new Promise((resolve) => setTimeout(resolve, 2500));
    await route.continue();
  });
  const first = `Alpha first ${f.run}`;
  const second = `Alpha second ${f.run}`;
  await sidebarTitle(page).fill(first);
  // The first save goes out after the typing pause and is held; the second
  // waits behind it when the board switch flushes the editor.
  await page.waitForTimeout(1200);
  await sidebarTitle(page).fill(second);
  await page.keyboard.press("Control+k");
  await page.getByRole("combobox", { name: /Type a command/ }).fill(`Switch to ${otherTitle}`);
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: new RegExp(`Board: ${otherTitle}`) })).toBeVisible({ timeout: 15_000 });
  await expect.poll(async () => (await f.find(a))?.task.title, { timeout: 20_000 }).toBe(second);
});

test("a right-click on a card's icon opens the menu", async ({ page }) => {
  const f = await fixture(page);
  const [, b] = f.ids;
  // Overdue, so collapsed cards show their flag icon too.
  expect((await page.request.patch(`/api/tasks/${b}`, { data: { boardId: f.boardId, dueAt: new Date(Date.now() - 86_400_000).toISOString() } })).ok()).toBe(true);
  await openBoard(page, f.boardId);
  const icon = card(page, b).locator("svg").first();
  await icon.scrollIntoViewIfNeeded();
  await icon.click({ button: "right", force: true });
  await expect(menu(page)).toBeVisible();
});

test("a delayed archive response does not move a selection made meanwhile", async ({ page }) => {
  const f = await fixture(page);
  const [a, b, c] = f.ids;
  await openBoard(page, f.boardId, a);
  await page.route((url) => url.pathname === `/api/tasks/${b}/archive`, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await route.continue();
  });
  await card(page, b).click({ button: "right" });
  await item(page, "Archive").click();
  await card(page, c).click();
  await expect(sidebarTitle(page)).toHaveValue(/^Charlie/);
  await expect(card(page, b)).toHaveCount(0, { timeout: 10_000 });
  await expect(sidebarTitle(page)).toHaveValue(/^Charlie/);
});

test("keyboard: Shift+F10 and the Menu key open the menu; arrows, Escape and focus", async ({ page }) => {
  const f = await fixture(page);
  const [, b] = f.ids;
  await openBoard(page, f.boardId);
  await card(page, b).focus();
  await page.keyboard.press("Shift+F10");
  await expect(menu(page)).toBeVisible();
  await expect(item(page, "Open")).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(item(page, "Open task workspace")).toBeFocused();
  await page.keyboard.press("End");
  await expect(item(page, "Delete")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu(page)).toHaveCount(0);
  await expect(card(page, b)).toBeFocused();
  // Single-key shortcuts stay off while the menu is open.
  await page.keyboard.press("ContextMenu");
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press("2");
  await page.keyboard.press("Escape");
  expect((await f.find(b))?.task.status).toBe("todo");
});

test("Agenda rows and Focus cards open the same menu; card borders count; links keep the browser menu", async ({ page }) => {
  const f = await fixture(page);
  const [a, b] = f.ids;
  expect((await page.request.patch(`/api/tasks/${a}`, { data: { boardId: f.boardId, status: "active", dueAt: new Date(Date.now() + 86_400_000).toISOString() } })).ok()).toBe(true);
  await openBoard(page, f.boardId);

  // The card's border sits outside its button.
  await card(page, b).scrollIntoViewIfNeeded();
  const box = (await page.locator(`[data-testid="task-card"][data-task-id="${b}"]`).boundingBox())!;
  await page.mouse.click(box.x + 2, box.y + box.height / 2, { button: "right" });
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press("Escape");

  // Agenda lists only its first items; search narrows it to this run's tasks.
  await page.locator("#taskboard-header-search").fill(f.run);
  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await card(page, a).click({ button: "right" });
  await expect(radio(page, "Active")).toHaveAttribute("aria-checked", "true");
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await card(page, a).click({ button: "right" });
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press("Escape");
});

test("native menus stay in the search box and the task title", async ({ page }) => {
  const f = await fixture(page);
  const [a] = f.ids;
  await openBoard(page, f.boardId, a);
  const prevented = async (selector: string) =>
    page.locator(selector).first().evaluate((element) => {
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 10, clientY: 10 });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
  expect(await prevented("#taskboard-header-search")).toBe(false);
  expect(await prevented('[data-testid="task-editor-sidebar"] [data-testid="task-inspector-title-input"]')).toBe(false);
  await expect(menu(page)).toHaveCount(0);
  expect(await prevented(`[data-task-nav="${a}"]`)).toBe(true);
  await expect(menu(page)).toBeVisible();
});

test("a press that may become a drag blocks menus until release; dragging still works", async ({ page }) => {
  const f = await fixture(page);
  const [a, b] = f.ids;
  await openBoard(page, f.boardId);
  await card(page, b).scrollIntoViewIfNeeded();
  await card(page, a).hover({ position: { x: 20, y: 10 } });
  const aBox = (await card(page, a).boundingBox())!;
  await page.mouse.down();
  await page.mouse.move(aBox.x + 23, aBox.y + 12);
  await card(page, b).dispatchEvent("contextmenu", { bubbles: true, cancelable: true });
  await expect(menu(page)).toHaveCount(0);
  await page.mouse.up();
  await card(page, b).click({ button: "right" });
  await expect(menu(page)).toBeVisible();
  await page.keyboard.press("Escape");

  // A real drag moves A below B as before.
  const bBox = (await card(page, b).boundingBox())!;
  await page.mouse.move(aBox.x + 20, aBox.y + 10);
  await page.mouse.down();
  await page.mouse.move(aBox.x + 20, aBox.y + 30, { steps: 5 });
  await page.mouse.move(bBox.x + 20, bBox.y + bBox.height - 4, { steps: 10 });
  await page.mouse.up();
  await expect(menu(page)).toHaveCount(0);
});

test("the workspace header menu matches; the editor menu keeps its own items; outages have no Promote", async ({ page }) => {
  const f = await fixture(page);
  const [a] = f.ids;
  const outage = (await f.post("/api/tasks", { bucketId: f.bucketId, title: `Outage ${f.run}`, workItemType: "maintenance_outage" })).taskId as string;
  await openBoard(page, f.boardId, a);
  const header = page.getByTestId("task-editor-sidebar").getByTestId("task-inspector-header");
  await header.click({ button: "right", position: { x: 4, y: 4 } });
  await expect(item(page, "Promote to outage")).toBeVisible();
  await expect(item(page, "Archive")).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByTestId("task-editor-sidebar").getByRole("button", { name: "Task actions" }).click();
  await expect(page.getByRole("button", { name: "Add Reminder" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Promote to outage" })).toBeVisible();
  await page.keyboard.press("Escape");

  await card(page, outage).click({ button: "right" });
  await expect(item(page, "Archive")).toBeVisible();
  await expect(item(page, "Promote to outage")).toHaveCount(0);
});

test("a task removed in another tab closes its open menu", async ({ page }) => {
  const f = await fixture(page);
  const [, b] = f.ids;
  await openBoard(page, f.boardId);
  await card(page, b).click({ button: "right" });
  await expect(menu(page)).toBeVisible();
  expect((await page.request.delete(`/api/tasks/${b}?boardId=${f.boardId}`)).ok()).toBe(true);
  await expect(menu(page)).toHaveCount(0, { timeout: 30_000 });
});

test.describe("phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
  test("phones keep the browser's long-press behaviour", async ({ page }) => {
    const f = await fixture(page);
    await openBoard(page, f.boardId);
    const prevented = await card(page, f.ids[0]).evaluate((element) => {
      const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
      element.dispatchEvent(event);
      return event.defaultPrevented;
    });
    expect(prevented).toBe(false);
    await expect(menu(page)).toHaveCount(0);
  });
});

test("the menu stays inside the window near its edges, in light and dark themes", async ({ page }) => {
  const f = await fixture(page);
  await openBoard(page, f.boardId);
  for (const theme of ["light", "dark"]) {
    await page.evaluate((value) => document.documentElement.setAttribute("data-theme", value), theme);
    const box = (await card(page, f.ids[0]).boundingBox())!;
    await card(page, f.ids[0]).dispatchEvent("contextmenu", { bubbles: true, cancelable: true, clientX: 1435, clientY: 995 });
    await expect(menu(page)).toBeVisible();
    const bounds = (await menu(page).boundingBox())!;
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(1440);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(1000);
    expect(box.width).toBeGreaterThan(0);
    await page.keyboard.press("Escape");
  }
});
