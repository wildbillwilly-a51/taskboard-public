import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 1440, height: 1000 }, isMobile: false, hasTouch: false });
test.setTimeout(90_000);
type Task = { id: string; title: string; status: string; allDay: boolean; startAt?: string; subtasks: Task[] };
const menu = (page: Page) => page.getByRole("menu", { name: "Task actions", exact: true });
const target = (page: Page, id: string) => page.locator(`[data-task-menu-target="${id}"]`).first();

test.beforeEach(async ({ page }) => {
  expect((await page.request.post("/api/auth/login", { data: { password: "visual-test-password" } })).ok()).toBe(true);
});

async function fixture(page: Page) {
  const { board } = await (await page.request.get("/api/board")).json();
  const boardId = board.id as string;
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const post = async (url: string, data: object) => {
    const response = await page.request.post(url, { data: { boardId, ...data } });
    expect(response.ok(), await response.text()).toBe(true);
    return response.json();
  };
  const bucket = await post("/api/buckets", { title: `Simple menu ${suffix}` });
  const root = await post("/api/tasks", { bucketId: bucket.bucketId, title: `Top task ${suffix}` });
  const title = `Simple child ${suffix}`;
  const child = await post(`/api/tasks/${root.taskId}/subtasks`, { title });
  await post(`/api/tasks/${root.taskId}/subtasks`, { title: `Sibling ${suffix}` });
  const grandchild = await post(`/api/tasks/${child.subtaskId}/subtasks`, { title: `Work inside ${suffix}` });
  const stepTitle = `Nested step ${suffix}`;
  const step = await post(`/api/tasks/${grandchild.subtaskId}/subtasks`, { title: stepTitle });
  const read = async () => {
    const { board: current } = await (await page.request.get(`/api/board?boardId=${boardId}`)).json();
    const find = (tasks: Task[], id: string): Task | undefined => {
      for (const task of tasks) { if (task.id === id) return task; const nested = find(task.subtasks, id); if (nested) return nested; }
    };
    const tasks = current.buckets.flatMap((b: { tasks: Task[] }) => b.tasks);
    return { root: find(tasks, root.taskId)!, child: find(tasks, child.subtaskId)!, grandchild: find(tasks, grandchild.subtaskId)! };
  };
  await page.goto(`/?boardId=${boardId}&taskId=${child.subtaskId}`);
  await expect(page.getByTestId("subtask-inspector-title")).toHaveValue(title);
  return { boardId, rootId: root.taskId as string, childId: child.subtaskId as string, grandchildId: grandchild.subtaskId as string, stepId: step.subtaskId as string, stepTitle, title, suffix, read };
}

async function expectSimpleMenu(page: Page) {
  for (const label of ["Active", "Waiting"]) await expect(menu(page).getByRole("menuitemradio", { name: label, exact: true })).toHaveCount(0);
  for (const label of ["Set due date…", "Snooze…", "Move to bucket…", "Promote to outage", "Archive"]) {
    await expect(menu(page).getByRole("menuitem", { name: label, exact: true })).toHaveCount(0);
  }
  await expect(menu(page).getByRole("menuitem", { name: "Edit subtask", exact: true })).toBeVisible();
  await expect(menu(page).getByRole("menuitem", { name: "Open work inside", exact: true })).toBeVisible();
  await expect(menu(page).getByRole("menuitem", { name: "Set time…", exact: true })).toBeVisible();
}

test("subtask context menus save only done and time, while title and its own children stay editable", async ({ page }) => {
  const f = await fixture(page);
  const patches: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    if (request.method() === "PATCH" && new URL(request.url()).pathname === `/api/tasks/${f.childId}`) patches.push(request.postDataJSON());
  });
  await target(page, f.childId).click({ button: "right", position: { x: 3, y: 3 } });
  await expectSimpleMenu(page);
  await menu(page).getByRole("menuitemradio", { name: "Done", exact: true }).click();
  await expect.poll(async () => (await f.read()).child.status).toBe("done");
  expect((await f.read()).root.status).toBe("todo");
  await target(page, f.childId).click({ button: "right", position: { x: 3, y: 3 } });
  await menu(page).getByRole("menuitem", { name: "Set time…", exact: true }).click();
  const dialog = page.getByTestId("task-action-time-dialog");
  await dialog.getByRole("checkbox", { name: "All day", exact: true }).check();
  await dialog.getByLabel("First day", { exact: true }).fill("2026-11-04");
  await dialog.getByLabel("Last day", { exact: true }).fill("2026-11-05");
  await dialog.getByRole("button", { name: "Save time", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(async () => (await f.read()).child.allDay).toBe(true);
  const title = page.getByTestId("subtask-inspector-title");
  await title.click(); await title.fill(`${f.title} renamed`); await title.press("Enter");
  await expect.poll(async () => (await f.read()).child.title).toBe(`${f.title} renamed`);
  const add = page.getByTestId("subtask-inspector").getByRole("textbox", { name: /^Add work inside/ });
  await add.fill(`New inside ${f.suffix}`); await add.press("Enter");
  await expect.poll(async () => (await f.read()).child.subtasks.length).toBe(2);
  expect((await f.read()).grandchild.title).toBe(`Work inside ${f.suffix}`);
  for (const patch of patches) expect(Object.keys(patch).filter((key) => key !== "boardId").every((key) => ["title", "status", "startAt", "endAt", "allDay"].includes(key))).toBe(true);
  expect(patches.length).toBeGreaterThanOrEqual(3);
});

test("the palette targets the focused subtask; list and nested board menus share the rule", async ({ page }) => {
  const f = await fixture(page);
  await target(page, f.childId).focus();
  await page.keyboard.press("Control+k");
  const palette = page.getByTestId("command-palette");
  await expect(palette.getByText(`Task: ${f.title}`, { exact: true })).toBeVisible();
  for (const pattern of [/Set to Active/, /Set to Waiting/, /Set due date/, /Snooze/, /Move to bucket/]) {
    await expect(palette.getByRole("option", { name: pattern })).toHaveCount(0);
  }
  await palette.getByRole("option", { name: /Set time/ }).click();
  await expect(page.getByRole("dialog", { name: `Set time for ${f.title}`, exact: true })).toBeVisible();
  await page.getByTestId("task-action-time-dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "List", exact: true }).click();
  await target(page, f.childId).click({ button: "right", position: { x: 3, y: 3 } });
  await expectSimpleMenu(page);
  await page.keyboard.press("Escape");
  await page.getByTestId("task-subtask-board-toggle").click();
  await target(page, f.grandchildId).click({ button: "right", position: { x: 3, y: 3 } });
  await expectSimpleMenu(page);
  await page.keyboard.press("Escape");
  await target(page, f.stepId).focus(); await page.keyboard.press("Control+k");
  await expect(palette.getByText(`Task: ${f.stepTitle}`, { exact: true })).toBeVisible();
  await expect(palette.getByRole("option", { name: /Set to Active|Set to Waiting/ })).toHaveCount(0);
  await palette.getByRole("option", { name: /Set time/ }).click();
  await page.getByTestId("task-action-time-dialog").getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByTestId("task-action-time-dialog")).toHaveCount(0);
  await target(page, f.stepId).focus(); await page.keyboard.press("Control+k");
  await expect(palette.getByText(`Task: ${f.stepTitle}`, { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await target(page, f.childId).focus(); await page.keyboard.press("2"); await page.keyboard.press("3");
  expect((await f.read()).child.status).toBe("todo");
  expect((await f.read()).root.status).toBe("todo");
});
