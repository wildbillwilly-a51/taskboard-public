import { test, expect, type Page } from "@playwright/test";

test.skip(process.env.TASKBOARD_OUTAGE_UI_TEST !== "1", "Requires the explicitly enabled isolated outage fixture and public sharing.");
test.setTimeout(120_000);

async function seed(page: Page) {
  expect((await page.request.post("/api/auth/login", { data: { password: "visual-test-password" } })).ok()).toBe(true);
  await page.goto("/");
  const href = await page.locator('a[href^="/calendar?boardId="]').first().getAttribute("href");
  const boardId = new URL(href!, page.url()).searchParams.get("boardId")!;
  const headers = { Origin: new URL(page.url()).origin };
  const post = async (url: string, data: object) => {
    const response = await page.request.post(url, { headers, data: { boardId, ...data } });
    expect(response.ok(), await response.text()).toBe(true); return response.json();
  };
  const bucket = await post("/api/buckets", { title: `Outage UI ${Date.now()}` });
  const root = (await post("/api/tasks", { bucketId: bucket.bucketId, title: "Outage UI test", workItemType: "maintenance_outage" })).taskId as string;
  expect((await page.request.patch(`/api/tasks/${root}`, { headers, data: { boardId, maintenanceOutage: { attendees: ["Alex Morgan", "Jordan Ellis"] } } })).ok()).toBe(true);
  const child = async (parent: string, title: string) => (await post(`/api/tasks/${parent}/subtasks`, { title })).subtaskId as string;
  const it = await child(root, "IT Ops"), core = await child(it, "Core infrastructure"), parent = await child(core, "Validate services"), leaf = await child(parent, "Check sign-in and permissions");
  const electrical = await child(root, "Electrical");
  await child(it, "Windows Updates"); await child(electrical, "Windows Updates");
  const endpoint = `/api/tasks/${root}/people`;
  let state = await (await page.request.get(endpoint)).json();
  for (const [name, id] of [["Alex Morgan", leaf], ["Jordan Ellis", core]]) {
    const person = state.people.find((p: { name: string }) => p.name === name);
    const response = await page.request.patch(endpoint, { headers, data: { mutationId: crypto.randomUUID(), field: "activity", value: "Server resolves the title", linkedTaskId: id, updates: [{ personKey: person.key, expectedRevision: person.activity.revision }] } });
    expect(response.ok()).toBe(true); state = await response.json();
  }
  const url = `/?boardId=${boardId}&taskId=${root}`;
  await page.goto(url); await openWorkspace(page);
  return { boardId, root, it, core, parent, leaf, electrical, endpoint, url, headers };
}

async function openWorkspace(page: Page) {
  const workspace = page.getByTestId("task-editor-expanded");
  await expect(async () => {
    if (!await workspace.isVisible()) await page.getByRole("button", { name: "Open Task Workspace", exact: true }).click({ timeout: 2000 });
    await expect(workspace).toBeVisible({ timeout: 2000 });
  }).toPass({ timeout: 20_000 });
  return workspace;
}
async function share(page: Page) {
  await page.getByRole("button", { name: "Share workspace", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Share workspace", exact: true });
  await expect(dialog).toBeVisible(); return dialog;
}

const errors = new WeakMap<Page, string[]>();
test.beforeEach(({ page }) => { const list: string[] = []; errors.set(page, list); page.on("pageerror", error => list.push(error.message)); });
test.afterEach(({ page }) => { expect(errors.get(page)).toEqual([]); });

test("recursive work choice, parent choice, free text, duplicate search and Undo", async ({ page }) => {
  const f = await seed(page), workspace = page.getByTestId("task-editor-expanded");
  await workspace.getByTestId("task-outage-people-toggle").click();
  const person = workspace.locator(".people-person").filter({ has: page.getByRole("button", { name: "Details for Alex Morgan", exact: true }) });
  const field = person.getByRole("textbox", { name: "Working on for Alex Morgan", exact: true });
  await expect(field).toHaveValue("Check sign-in and permissions");
  await person.getByRole("button", { name: "Work choices for Alex Morgan", exact: true }).click();
  const picker = page.getByRole("dialog", { name: "Choose work", exact: true });
  if (page.viewportSize()!.width < 768) {
    await expect(picker.getByRole("button", { name: "Use “Validate services”", exact: true })).toBeVisible();
    await picker.getByRole("button", { name: "Use “Validate services”", exact: true }).click();
    await expect(field).toHaveValue("Validate services");
  } else {
    await picker.locator(".work-picker-choice").getByText("IT Ops", { exact: true }).click();
    await expect(field).toHaveValue("IT Ops");
  }
  await workspace.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(field).toHaveValue("Check sign-in and permissions");
  await person.getByRole("button", { name: "Work choices for Alex Morgan", exact: true }).click();
  await picker.getByRole("textbox", { name: "Search all work", exact: true }).fill("Windows Updates");
  await expect(picker.locator(".work-picker-result")).toHaveCount(2);
  await expect(picker).toContainText("Electrical"); await expect(picker).toContainText("IT Ops");
  await picker.getByRole("button", { name: "Close work picker", exact: true }).click();
  await field.fill("Coordinating with vendor"); await field.press("Enter");
  await expect.poll(async () => (await (await page.request.get(f.endpoint)).json()).people.find((p: { name: string }) => p.name === "Alex Morgan").activity).toMatchObject({ value: "Coordinating with vendor", linkedTaskId: null });
  await workspace.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(field).toHaveValue("Check sign-in and permissions");
});

test("List loads names before People and removes departed attendees", async ({ page }) => {
  test.skip(page.viewportSize()!.width < 768, "Names are a desktop List feature.");
  const f = await seed(page), workspace = page.getByTestId("task-editor-expanded");
  const row = (id: string) => workspace.locator(`.work-row[data-task-menu-target="${id}"]`);
  const coreRoster = row(f.core).locator(".work-roster-button");
  await expect(coreRoster).toHaveAttribute("aria-label", /2 people, 1 directly and 1 in subtasks/);
  await coreRoster.click();
  const detail = page.locator(".work-roster-dialog");
  await expect(detail.getByText("Alex Morgan", { exact: true })).toHaveCount(1);
  await expect(detail.getByText("Jordan Ellis", { exact: true })).toHaveCount(1);
  await detail.getByRole("button", { name: "Close working people", exact: true }).click();
  expect((await page.request.patch(`/api/tasks/${f.root}`, { headers: f.headers, data: { boardId: f.boardId, maintenanceOutage: { attendeeChanges: [{ name: "Alex Morgan", attending: false }] } } })).ok()).toBe(true);
  await expect(coreRoster).toHaveAttribute("aria-label", /1 person, 1 directly and 0 in subtasks/, { timeout: 20_000 });
});

test("bulk can choose the anchor's current task, restores focus and saves later free text on blur", async ({ page }) => {
  const f = await seed(page), workspace = page.getByTestId("task-editor-expanded");
  await workspace.getByTestId("task-outage-people-toggle").click();
  await workspace.getByRole("button", { name: "Menu for Jordan Ellis", exact: true }).click();
  await workspace.getByRole("button", { name: "Select people", exact: true }).click();
  await workspace.getByRole("checkbox", { name: "Select Alex Morgan", exact: true }).check();
  const arrow = workspace.getByRole("button", { name: "Work choices for Jordan Ellis", exact: true });
  await arrow.click();
  const picker = page.getByRole("dialog", { name: "Choose work", exact: true });
  if (page.viewportSize()!.width < 768) {
    await picker.getByRole("button", { name: /^Core infrastructure\s+1 subtask/ }).click();
    await picker.getByRole("button", { name: "Use “Core infrastructure”", exact: true }).click();
  } else await picker.locator('.work-picker-row[data-current="true"] .work-picker-choice').click();
  await picker.getByRole("button", { name: "Set 2 people to this task", exact: true }).click();
  await expect.poll(async () => (await (await page.request.get(f.endpoint)).json()).people.map((p: { activity: { linkedTaskId: string } }) => p.activity.linkedTaskId)).toEqual([f.core, f.core]);
  await expect(arrow).toBeFocused();
  await workspace.getByRole("button", { name: "Done selecting", exact: true }).click();
  await arrow.click();
  if (page.viewportSize()!.width < 768) {
    await picker.getByRole("button", { name: /^Core infrastructure\s+1 subtask/ }).click();
    await picker.getByRole("button", { name: "Use “Core infrastructure”", exact: true }).click();
  } else await picker.locator('.work-picker-row[data-current="true"] .work-picker-choice').click();
  await expect(arrow).toBeFocused();
  const field = workspace.getByRole("textbox", { name: "Working on for Jordan Ellis", exact: true });
  await field.fill("Coordination after choosing work"); await field.press("Tab"); await page.keyboard.press("Tab");
  await expect.poll(async () => (await (await page.request.get(f.endpoint)).json()).people.find((p: { name: string }) => p.name === "Jordan Ellis").activity).toMatchObject({ value: "Coordination after choosing work", linkedTaskId: null });
});

test("persistent sharing fields, Copy, expiry, outside dismissal and independent disable", async ({ page, context }) => {
  const f = await seed(page), dialog = await share(page);
  const view = dialog.getByRole("region", { name: "Read-only link", exact: true }), edit = dialog.getByRole("region", { name: "Edit work link", exact: true });
  await expect(dialog.locator(".workspace-share-url")).toHaveCount(2);
  await expect(view.locator(".workspace-share-buttons button")).toHaveText(["Generate Link", "Disable Link", "Copy Link"]);
  await view.getByRole("button", { name: "Generate Link", exact: true }).click();
  const field = view.getByRole("textbox", { name: "Read-only link URL", exact: true });
  await expect(field).not.toHaveValue(""); const url = await field.inputValue();
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: new URL(page.url()).origin });
  await view.getByRole("button", { name: "Copy Link", exact: true }).click(); await expect(view.getByRole("button", { name: "Copied", exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);
  await view.getByRole("combobox", { name: "Read-only link expiry", exact: true }).selectOption("168");
  await expect(view.getByRole("combobox", { name: "Read-only link expiry", exact: true })).toHaveValue("saved"); await expect(field).toHaveValue(url);
  await page.mouse.click(3, 3); await expect(dialog).toBeHidden(); await expect(page.getByTestId("task-editor-expanded")).toBeVisible();
  await page.reload(); await openWorkspace(page); await share(page); await expect(field).toHaveValue(url);
  await edit.getByRole("button", { name: "Generate Link", exact: true }).click();
  const editField = edit.getByRole("textbox", { name: "Edit work link URL", exact: true }); await expect(editField).not.toHaveValue(""); const editUrl = await editField.inputValue();
  await view.getByRole("button", { name: "Disable Link", exact: true }).click();
  await expect(field).toHaveValue(""); await expect(field).toHaveAttribute("placeholder", "Link disabled"); await expect(editField).toHaveValue(editUrl);
  expect((await page.request.get(new URL(url).pathname + "/data")).status()).toBe(404);
  const status = await (await page.request.get(`/api/tasks/${f.root}/public-share`)).json(); expect(status.links.edit_work.active).toBe(true);
});

test("unchanged bulk fields never autosave or detach work links", async ({ page }) => {
  const f = await seed(page);
  let state = await (await page.request.get(f.endpoint)).json();
  for (const [name, value] of [["Alex Morgan", "Remote"], ["Jordan Ellis", "Data center"]]) {
    const person = state.people.find((p: { name: string }) => p.name === name);
    const response = await page.request.patch(f.endpoint, { headers: f.headers, data: { mutationId: crypto.randomUUID(), field: "location", value, linkedTaskId: null, updates: [{ personKey: person.key, expectedRevision: person.location.revision }] } });
    expect(response.ok()).toBe(true); state = await response.json();
  }
  await page.reload(); const workspace = await openWorkspace(page);
  await workspace.getByTestId("task-outage-people-toggle").click();
  const work = workspace.getByRole("textbox", { name: "Working on for Jordan Ellis", exact: true }), location = workspace.getByRole("textbox", { name: "Location for Jordan Ellis", exact: true });
  await expect(location).toHaveValue("Data center");
  await workspace.getByRole("button", { name: "Menu for Jordan Ellis", exact: true }).click();
  await workspace.getByRole("button", { name: "Select people", exact: true }).click();
  await workspace.getByRole("checkbox", { name: "Select Alex Morgan", exact: true }).check();
  const writes: string[] = [];
  page.on("request", request => { if (request.method() === "PATCH" && new URL(request.url()).pathname === f.endpoint) writes.push(request.postData()!); });
  await work.focus(); await work.press("Enter"); await work.focus(); await work.press("Tab"); await page.keyboard.press("Tab");
  await location.focus(); await location.press("Enter"); await location.focus(); await location.press("Tab"); await page.keyboard.press("Tab");
  await workspace.getByRole("button", { name: "Done selecting", exact: true }).click();
  const after = await (await page.request.get(f.endpoint)).json();
  expect(writes).toEqual([]);
  expect(after.people.map((p: { activity: unknown; location: unknown }) => [p.activity, p.location])).toEqual(state.people.map((p: { activity: unknown; location: unknown }) => [p.activity, p.location]));
});

test("delayed picker save preserves another person's focused draft", async ({ page }) => {
  const f = await seed(page), workspace = page.getByTestId("task-editor-expanded");
  await workspace.getByTestId("task-outage-people-toggle").click();
  let release!: () => void, committed!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), accepted = new Promise<void>(resolve => { committed = resolve; });
  const writes: string[] = [], pattern = `**${f.endpoint}`;
  await page.route(pattern, async route => {
    if (route.request().method() !== "PATCH") return route.continue();
    writes.push(route.request().postData()!);
    const response = await route.fetch(); committed(); await gate; await route.fulfill({ response });
  });
  const arrow = workspace.getByRole("button", { name: "Work choices for Alex Morgan", exact: true }), other = workspace.getByRole("textbox", { name: "Location for Jordan Ellis", exact: true });
  try {
    await arrow.click(); const picker = page.getByRole("dialog", { name: "Choose work", exact: true });
    await picker.getByRole("textbox", { name: "Search all work", exact: true }).fill("IT Ops");
    await picker.getByRole("button", { name: "IT Ops Top-level task", exact: true }).click(); await accepted;
    await other.fill("Draft still being typed"); release();
    await expect(arrow).toBeEnabled(); await expect(other).toBeFocused(); await expect(other).toHaveValue("Draft still being typed");
    expect(writes).toHaveLength(1);
    const after = await (await page.request.get(f.endpoint)).json();
    expect(after.people.find((p: { name: string }) => p.name === "Jordan Ellis").location.value).toBe("");
  } finally { release(); await page.unroute(pattern); }
});

test("pending Generate can close and reopen, and stale windows cannot rotate its result", async ({ page, context }) => {
  const f = await seed(page); let dialog = await share(page);
  let view = dialog.getByRole("region", { name: "Read-only link", exact: true });
  await view.getByRole("button", { name: "Generate Link", exact: true }).click();
  const field = page.getByRole("textbox", { name: "Read-only link URL", exact: true }); await expect(field).not.toHaveValue(""); const oldUrl = await field.inputValue();
  let release!: () => void, committed!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; }), accepted = new Promise<void>(resolve => { committed = resolve; });
  const pattern = `**/api/tasks/${f.root}/public-share`;
  await page.route(pattern, async route => { if (route.request().method() !== "POST") return route.continue(); const response = await route.fetch(); committed(); await gate; await route.fulfill({ response }); });
  try {
    await view.getByRole("button", { name: "Generate Link", exact: true }).click(); await accepted;
    await dialog.getByRole("button", { name: "Close sharing", exact: true }).click(); dialog = await share(page); view = dialog.getByRole("region", { name: "Read-only link", exact: true });
    await expect(view.getByRole("button", { name: "Generate Link", exact: true })).toBeDisabled();
    release(); await expect(field).not.toHaveValue(oldUrl); await expect(view.getByRole("button", { name: "Generate Link", exact: true })).toBeEnabled();
  } finally { release(); await page.unroute(pattern); }
  const other = await context.newPage(); await other.goto(f.url); await openWorkspace(other); const otherDialog = await share(other);
  const previous = await field.inputValue(); await view.getByRole("button", { name: "Generate Link", exact: true }).click();
  await expect.poll(async () => await field.inputValue()).not.toBe(previous); const winner = await field.inputValue();
  await otherDialog.getByRole("region", { name: "Read-only link", exact: true }).getByRole("button", { name: "Generate Link", exact: true }).click();
  await expect(otherDialog.getByRole("alert")).toContainText("changed in another window");
  await expect(other.getByRole("textbox", { name: "Read-only link URL", exact: true })).toHaveValue(winner);
  await other.close();
});

test("Generate replaces expired links without reactivating their old URLs", async ({ page }) => {
  const f = await seed(page);
  for (const [mode, label, preset] of [["view", "Read-only", "never"], ["edit_work", "Edit work", "168"]] as const) {
    const created = await page.request.post(`/api/tasks/${f.root}/public-share`, { headers: f.headers, data: { action: "create", mode, expectedShareId: null, expiresAt: new Date(Date.now() + 5000).toISOString() } });
    expect(created.ok()).toBe(true);
    const data = await created.json(), oldPath = data.url as string;
    await expect.poll(async () => (await page.request.get(`${oldPath}/data`)).status(), { timeout: 15_000 }).toBe(404);
    const dialog = await share(page), region = dialog.getByRole("region", { name: `${label} link`, exact: true });
    await expect(region.getByText("Expired", { exact: true })).toBeVisible();
    const expiry = region.getByRole("combobox", { name: `${label} link expiry`, exact: true });
    await expect(expiry).toHaveValue(preset);
    if (mode === "view") {
      await expiry.selectOption("168");
      const unchanged = await (await page.request.get(`/api/tasks/${f.root}/public-share`)).json();
      expect(unchanged.links.view.id).toBe(data.links.view.id); expect(unchanged.links.view.expired).toBe(true);
      expect((await page.request.get(`${oldPath}/data`)).status()).toBe(404);
    }
    const field = region.getByRole("textbox", { name: `${label} link URL`, exact: true });
    await region.getByRole("button", { name: "Generate Link", exact: true }).click();
    await expect(field).not.toHaveValue(new URL(oldPath, page.url()).href);
    const newPath = new URL(await field.inputValue()).pathname;
    expect((await page.request.get(`${oldPath}/data`)).status()).toBe(404);
    expect((await page.request.get(`${newPath}/data`)).status()).toBe(200);
    await dialog.getByRole("button", { name: "Close sharing", exact: true }).click();
  }
});
