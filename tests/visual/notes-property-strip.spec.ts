import { expect, test, type Page } from "@playwright/test";

// The desktop note property strip: Home, labels and linked tasks on one line,
// with "+ Label" and "+ Link task" opening their field in a popup.
test.use({ viewport: { width: 1440, height: 1000 } });
const stamp = () => `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const errors = new WeakMap<Page, string[]>();
const strip = (page: Page) => page.getByRole("group", { name: "Note properties", exact: true });

test.beforeEach(async ({ page }) => {
  const failures: string[] = []; errors.set(page, failures);
  page.on("pageerror", error => failures.push(error.message));
  page.on("console", message => { if (message.type() === "error") failures.push(message.text()); });
  expect((await page.request.post("/api/auth/login", { data: { password: "visual-test-password" } })).ok()).toBe(true);
});
test.afterEach(async ({ page }) => { expect(errors.get(page)).toEqual([]); });

async function boardHome(page: Page) {
  const state = await (await page.request.get("/api/board")).json();
  return { boardId: state.board.id as string, bucketId: state.board.buckets[0].id as string };
}
async function addTask(page: Page, title: string) {
  const home = await boardHome(page);
  expect((await page.request.post("/api/tasks", { data: { ...home, title } })).ok()).toBe(true);
  const state = await (await page.request.get("/api/board")).json();
  const found: { id: string; title: string }[] = [];
  (function walk(value: unknown) {
    if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") {
      const item = value as { id?: string; title?: string };
      if (item.title === title && item.id) found.push({ id: item.id, title });
      Object.values(value).forEach(walk);
    }
  })(state);
  expect(found.length).toBeGreaterThan(0);
  return found[0];
}
async function addNote(page: Page, title: string, extra = {}) {
  const text = "Property strip review note.";
  const response = await page.request.post("/api/notes", { data: {
    title, content: { blocks: [{ type: "paragraph", content: [{ type: "text", text, styles: {} }] }], text, markdown: text }, ...extra,
  } });
  expect(response.ok()).toBe(true);
  return (await response.json()).note as { id: string; title: string; updatedAt: string };
}
async function saved(page: Page, id: string) {
  const response = await page.request.get(`/api/notes/${id}`);
  expect(response.ok()).toBe(true);
  return (await response.json()).note as { labels: string[]; linkedTasks: { id: string }[]; home: { kind: string }; deletedAt: string | null };
}
async function openNote(page: Page, id: string) {
  await page.goto(`/notes?note=${id}`);
  await expect(strip(page)).toBeVisible();
}

test("properties sit on one line; labels and tasks are added and removed from popups", async ({ page }) => {
  const suffix = stamp();
  const task = await addTask(page, `Strip task ${suffix}`);
  const note = await addNote(page, `Strip note ${suffix}`, await boardHome(page));
  await openNote(page, note.id);

  await expect(page.getByRole("combobox", { name: "Home", exact: true })).toBeEnabled();

  // Enter adds a label and keeps the popup open for the next one.
  const addLabel = strip(page).getByRole("button", { name: "Label", exact: true });
  await addLabel.click();
  const input = page.getByRole("combobox", { name: "Add label", exact: true });
  await expect(input).toBeFocused();
  await input.fill("alpha"); await input.press("Enter");
  await input.fill("beta"); await input.press("Enter");
  await expect.poll(async () => (await saved(page, note.id)).labels.sort()).toEqual(["alpha", "beta"]);
  // A press outside keeps what was typed; Escape does too and returns focus.
  await input.fill("gamma");
  await page.locator(".notes-editor-footer").click();
  await expect(input).toHaveCount(0);
  await expect.poll(async () => (await saved(page, note.id)).labels).toContain("gamma");
  await addLabel.click();
  await input.fill("delta"); await input.press("Escape");
  await expect(addLabel).toBeFocused();
  await expect.poll(async () => (await saved(page, note.id)).labels).toContain("delta");
  await strip(page).getByRole("button", { name: "Remove alpha", exact: true }).click();
  await expect.poll(async () => (await saved(page, note.id)).labels.sort()).toEqual(["beta", "delta", "gamma"]);

  // Link from the popup with the keyboard; focus returns to "+ Link task".
  const linkTask = strip(page).getByRole("button", { name: "Link task", exact: true });
  await linkTask.click();
  const search = page.getByRole("combobox", { name: "Link a task", exact: true });
  await expect(search).toBeFocused();
  await search.fill(task.title);
  // The first Escape closes the results; the second closes the popup.
  await expect(page.getByRole("listbox", { name: "Tasks", exact: true })).toBeVisible();
  await expect(page.getByRole("listbox", { name: "Tasks", exact: true }).getByRole("option").filter({ hasText: task.title })).toBeVisible();
  await search.press("Escape");
  await expect(page.getByRole("listbox", { name: "Tasks", exact: true })).toHaveCount(0);
  await expect(search).toBeVisible();
  await search.press("ArrowDown"); await search.press("Enter");
  await expect(linkTask).toBeFocused();
  await expect.poll(async () => (await saved(page, note.id)).linkedTasks.map(item => item.id)).toEqual([task.id]);
  await expect(strip(page).getByRole("link", { name: task.title, exact: true })).toBeVisible();
  // Three labels and a linked task still fit on one line.
  expect((await strip(page).boundingBox())!.height).toBeLessThan(50);
  // Focus opens the results, so Escape closes them first, then the popup.
  await linkTask.click();
  await expect(search).toBeFocused();
  await search.press("Escape");
  await expect(search).toBeVisible();
  await search.press("Escape");
  await expect(search).toHaveCount(0);
  await expect(linkTask).toBeFocused();
  // Shift+Tab from the popup reaches its button, where Escape still closes it.
  await addLabel.click();
  await expect(input).toBeFocused();
  await input.press("Shift+Tab");
  await expect(addLabel).toBeFocused();
  await addLabel.press("Escape");
  await expect(input).toHaveCount(0);
  await expect(addLabel).toHaveAttribute("aria-expanded", "false");

  // An open popup stays inside the strip when the window narrows, and long
  // chips shrink instead of pushing the strip wider.
  expect((await page.request.patch(`/api/notes/${note.id}`, { data: { labels: ["beta", "delta", "gamma", "a label long enough to need an ellipsis in the strip"] } })).ok()).toBe(true);
  await page.reload();
  await expect(strip(page)).toBeVisible();
  await linkTask.click();
  await page.setViewportSize({ width: 820, height: 1000 });
  const popup = page.getByRole("dialog", { name: "Link a task", exact: true });
  await expect.poll(async () => {
    const [outer, inner] = await Promise.all([strip(page).boundingBox(), popup.boundingBox()]);
    return inner!.x >= outer!.x - 1 && inner!.x + inner!.width <= outer!.x + outer!.width + 1;
  }).toBe(true);
  expect(await strip(page).evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  await strip(page).getByRole("button", { name: `Unlink ${task.title}`, exact: true }).click();
  await expect.poll(async () => (await saved(page, note.id)).linkedTasks).toEqual([]);
});

test("a new note keeps the tag popup open while it is saved, and a typed tag stays with its note", async ({ page }) => {
  const other = await addNote(page, `Strip other ${stamp()}`);
  await page.goto("/notes");
  await page.locator(".notes-sidebar").getByRole("button", { name: "New note", exact: true }).click();
  const addTag = strip(page).getByRole("button", { name: "Tag", exact: true });
  await addTag.click();
  const input = page.getByRole("combobox", { name: "Add tag", exact: true });
  await input.fill("first"); await input.press("Enter");
  await expect.poll(() => new URL(page.url()).searchParams.get("note")).not.toBeNull();
  await expect(addTag).toHaveAttribute("aria-expanded", "true");
  await input.fill("second"); await input.press("Enter");
  const created = new URL(page.url()).searchParams.get("note")!;
  await expect.poll(async () => (await saved(page, created)).labels.sort()).toEqual(["first", "second"]);

  // Leaving with a typed tag commits it to this note, never the next one.
  await input.fill("pending");
  await page.locator(`[data-note-row="${other.id}"]`).click();
  await expect(page.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue(other.title);
  await expect.poll(async () => (await saved(page, created)).labels.sort()).toEqual(["first", "pending", "second"]);
  expect((await saved(page, other.id)).labels).toEqual([]);
  await strip(page).getByRole("button", { name: "Tag", exact: true }).click();
  await expect(page.getByRole("combobox", { name: "Add tag", exact: true })).toHaveValue("");
});

test("Home asks before sharing and stays put when cancelled", async ({ page }) => {
  const note = await addNote(page, `Strip home ${stamp()}`);
  const { boardId } = await boardHome(page);
  await openNote(page, note.id);
  const home = page.getByRole("combobox", { name: "Home", exact: true });
  await home.selectOption(`board:${boardId}:`);
  const dialog = page.getByRole("alertdialog");
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(home).toHaveValue("personal:");
  expect((await saved(page, note.id)).home.kind).toBe("personal");
  await home.selectOption(`board:${boardId}:`);
  await page.getByRole("alertdialog").getByRole("button", { name: "Move note", exact: true }).click();
  await expect.poll(async () => (await saved(page, note.id)).home.kind).toBe("board");
});

test("a note in the trash shows its properties without edit controls", async ({ page }) => {
  const note = await addNote(page, `Strip trash ${stamp()}`, { labels: ["kept"] });
  expect((await page.request.delete(`/api/notes/${note.id}`)).ok()).toBe(true);
  await openNote(page, note.id);
  await expect(page.getByRole("combobox", { name: "Home", exact: true })).toBeDisabled();
  await expect(strip(page).getByText("kept", { exact: true })).toBeVisible();
  await expect(strip(page).getByRole("button", { name: "Tag", exact: true })).toHaveCount(0);
  await expect(strip(page).getByRole("button", { name: "Link task", exact: true })).toHaveCount(0);
  await expect(strip(page).getByRole("button", { name: "Remove kept", exact: true })).toHaveCount(0);
});
