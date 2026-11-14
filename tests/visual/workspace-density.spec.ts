import { expect, test, type Page } from "@playwright/test";

// Run against an isolated password-mode fixture database, never production.
test.setTimeout(120_000);

async function fixture(page: Page) {
  expect((await page.request.post("/api/auth/login", { data: { password: "visual-test-password" } })).ok()).toBe(true);
  await page.goto("/");
  const href = await page.locator('a[href^="/calendar?boardId="]').first().getAttribute("href");
  const boardId = new URL(href!, page.url()).searchParams.get("boardId")!;
  const post = async (url: string, data: object) => {
    const response = await page.request.post(url, { data: { boardId, ...data } });
    expect(response.ok(), url).toBe(true);
    return await response.json();
  };
  const bucket = await post("/api/buckets", { title: `Density ${Date.now()}` });
  const root = await post("/api/tasks", { bucketId: bucket.bucketId, title: "Density review outage", workItemType: "maintenance_outage" });
  const taskId = root.taskId as string;
  const schedule = { startAt: "2026-12-06T00:00:00.000Z", endAt: "2026-12-13T00:00:00.000Z", allDay: true };
  expect((await page.request.patch(`/api/tasks/${taskId}`, { data: { boardId, ...schedule, status: "active", note: "Retain working notes and editing." } })).ok()).toBe(true);
  const window = await post(`/api/tasks/${taskId}/subtasks`, { title: "Network replacement window" });
  expect((await page.request.patch(`/api/tasks/${window.subtaskId}`, { data: { boardId, ...schedule } })).ok()).toBe(true);
  await post(`/api/tasks/${window.subtaskId}/subtasks`, { title: "Nested connectivity check" });
  await post(`/api/tasks/${taskId}/subtasks`, { title: "Direct leaf without children" });
  await post(`/api/tasks/${taskId}/subtasks`, { title: "A very long direct subtask title that must wrap naturally without hiding its words or colliding with the scheduled time beneath it" });
  await post(`/api/tasks/${taskId}/checklist`, { label: "Verify power and cooling" });
  await post(`/api/tasks/${taskId}/checklist`, { label: "Confirm rollback readiness" });
  await page.goto(`/?boardId=${boardId}&taskId=${taskId}`);
  const sidebar = page.getByTestId("task-editor-sidebar");
  await expect(sidebar).toBeVisible();
  const scale = await sidebar.locator("select").first().evaluate(e => ({ font: getComputedStyle(e).fontSize, height: e.getBoundingClientRect().height }));
  const sidebarRoles = await sidebar.evaluate(e => {
    const title = e.querySelector<HTMLElement>('[data-testid="task-inspector-title"] :is(textarea, h2):not(.sr-only)')!;
    return {
      title: { font: getComputedStyle(title).fontSize, weight: getComputedStyle(title).fontWeight },
      clippedChips: [...e.querySelectorAll<HTMLElement>('[data-testid="task-inspector-chips"] > span')]
        .filter(chip => chip.scrollWidth > chip.clientWidth + 1 || chip.getBoundingClientRect().right > e.getBoundingClientRect().right).map(chip => chip.textContent),
      workingNotesLines: [...e.querySelectorAll("*")].filter(node => /^No working notes/.test(node.textContent?.trim() ?? "") && node.children.length === 0).length,
    };
  });
  // A click that lands before hydration is lost, so retry until the workspace opens.
  await expect(async () => {
    await page.getByRole("button", { name: "Open Task Workspace", exact: true }).click({ timeout: 2_000 });
    await expect(page.getByTestId("task-editor-expanded")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
  return { boardId, taskId, scale, sidebarRoles };
}

async function openWorkspace(page: Page, boardId: string, taskId: string) {
  await page.goto(`/?boardId=${boardId}&taskId=${taskId}`);
  await expect(page.getByTestId("task-editor-sidebar")).toBeVisible();
  await expect(async () => {
    if (!(await page.getByTestId("task-editor-expanded").isVisible())) {
      await page.getByRole("button", { name: "Open Task Workspace", exact: true }).click({ timeout: 2_000 });
    }
    await expect(page.getByTestId("task-editor-expanded")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 20_000 });
}

// Luminance-weighted brightness of a computed colour, scaled by its alpha.
function brightness(color: string) {
  const [r, g, b, a = 1] = (color.match(/[\d.]+/g) ?? []).map(Number);
  const [R, G, B] = color.startsWith("color(srgb") ? [r * 255, g * 255, b * 255] : [r, g, b];
  return (0.2126 * R + 0.7152 * G + 0.0722 * B) * a;
}

test("workspace density matches the sidebar across widths and pointer modes", async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  const { scale } = await fixture(page);
  // The sidebar is the desktop reference only when the fixture measured it at desktop width.
  const desktop = page.viewportSize()!.width >= 768 ? scale : { font: "12px", height: 30 };
  const workspace = page.getByTestId("task-editor-expanded");
  const scenarios = [1506, 1280, 1024, 768, 430, 390, 320].map(width => ({ width, theme: "dark", fontScale: "normal" }));
  scenarios.push({ width: 1506, theme: "light", fontScale: "x-large" }, { width: 390, theme: "light", fontScale: "x-large" });
  for (const scenario of scenarios) {
    await page.setViewportSize({ width: scenario.width, height: 844 });
    await page.evaluate(settings => {
      const key = "taskboard-ui-settings";
      localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) || "{}"), ...settings }));
      dispatchEvent(new Event("taskboard-ui-settings-change"));
    }, { theme: scenario.theme, fontScale: scenario.fontScale });
    await workspace.getByRole("tab", { name: "Work", exact: true }).click();
    await expect(workspace.locator('.work-row[data-top-level="true"]')).toHaveCount(3);
    const geometry = await workspace.evaluate(e => ({
      overflow: e.scrollWidth - e.clientWidth,
      rows: [...e.querySelectorAll<HTMLElement>(".work-row")].map(row => {
        // Tablets retain the right-aligned schedule even with touch input.
        // Only phone widths stack it; long titles retain the full tooltip.
        const stacked = matchMedia("(max-width: 767px)").matches;
        const title = row.querySelector<HTMLElement>(".work-title")!;
        const meta = row.querySelector<HTMLElement>(".work-row-meta")!;
        const a = title.getBoundingClientRect(), b = meta.getBoundingClientRect();
        const content = row.querySelector<HTMLElement>(".work-row-content")!.getBoundingClientRect();
        const cut = title.scrollWidth > title.clientWidth + 1;
        return { height: row.getBoundingClientRect().height,
          clipped: cut && title.getAttribute("title") !== title.textContent?.trim(),
          offRight: !stacked && b.width > 0 && Math.abs(b.right - content.right) > 1,
          misaligned: !stacked && b.width > 0 && Math.abs((a.top + a.bottom - b.top - b.bottom) / 2) > 2,
          overlaps: b.width > 0 && (stacked ? a.bottom > b.top + 1 : a.right > b.left + 1) };
      }),
      checks: [...e.querySelectorAll(".work-checklist-toggle")].map(check => ({ width: check.getBoundingClientRect().width, height: check.getBoundingClientRect().height })),
      inputFont: getComputedStyle(e.querySelector(".work-input")!).fontSize,
    }));
    expect(geometry.overflow, JSON.stringify(scenario)).toBeLessThanOrEqual(1);
    expect(geometry.rows.every(row => !row.clipped && !row.overlaps && !row.offRight && !row.misaligned), JSON.stringify(geometry.rows)).toBe(true);
    // Tablets use one line regardless of pointer; phone rows may take two.
    const stacked = await page.evaluate(() => matchMedia("(max-width: 767px)").matches);
    expect(geometry.rows[1].height).toBeLessThanOrEqual(stacked ? 56 : 40);
    expect(geometry.checks).toEqual([{ width: 14, height: 14 }, { width: 14, height: 14 }]);
    if (scenario.width < 768) expect(parseFloat(geometry.inputFont)).toBeGreaterThanOrEqual(16);
    const detailsTab = workspace.getByRole("tab", { name: "Details", exact: true });
    if (await detailsTab.count()) await detailsTab.click();
    const fields = await workspace.locator('[data-destination="details"]').evaluate(e => {
      const start = e.querySelector('[aria-label="Start date"]')!, end = e.querySelector('[aria-label="End date"]')!;
      const a = start.getBoundingClientRect(), b = end.getBoundingClientRect();
      return { font: getComputedStyle(start).fontSize, height: a.height, sameRow: Math.abs(a.top - b.top) < 1, overlap: a.right > b.left + 1,
        descriptionInset: getComputedStyle(e.querySelector('[data-testid="task-primary-note-section"]')!).paddingLeft };
    });
    expect(fields.overlap && fields.sameRow).toBe(false);
    expect(fields.descriptionInset).toBe("0px");
    expect(fields.height).toBe(scenario.width < 768 ? 32 : desktop.height);
    if (scenario.fontScale === "normal") expect(fields.font).toBe(scenario.width < 768 ? "16px" : desktop.font);
    for (const name of [/^Working notes/, /^Notes(?: ·|$)/, /^Files$/]) {
      await workspace.getByRole("tab", { name }).click();
      await expect(workspace.locator('.task-workspace-slot[data-active="true"]')).toBeVisible();
    }
    await workspace.getByRole("tab", { name: "Work", exact: true }).click();
    await workspace.getByRole("button", { name: "Timeline", exact: true }).click();
    await expect(workspace.getByTestId("task-subtask-timeline")).toBeVisible();
    await workspace.getByRole("button", { name: "List", exact: true }).click();
  }
  await page.screenshot({ path: testInfo.outputPath("workspace-density.png"), fullPage: false });
  expect(errors).toEqual([]);
});

test("all five font preferences visibly scale workspace text without scaling control chrome", async ({ page }, testInfo) => {
  await fixture(page);
  const workspace = page.getByTestId("task-editor-expanded");
  const preferences = ["small", "normal", "large", "x-large", "xx-large"];
  // The subtask list keeps its restored scale (14.5 / 12.5 / 11.5px at Normal), and the
  // rest of the editor the board's 12px card text, all in proportion to the 17/18.5/20/22/24px roots.
  const roots = [17, 18.5, 20, 22, 24];
  const expectedFonts = roots.map(root => (root * 12) / 18.5);
  const scaled = (px: number) => roots.map(root => (root * px) / 18.5);
  const [workTitle, workText] = [scaled(14.5), scaled(12.5)];
  const measurements: object[] = [];
  for (const width of [1506, 1024, 390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    for (const [index, fontScale] of preferences.entries()) {
      await page.evaluate(fontScale => {
        const key = "taskboard-ui-settings";
        localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) || "{}"), fontScale }));
        dispatchEvent(new Event("taskboard-ui-settings-change"));
      }, fontScale);
      await expect.poll(() => page.locator("html").getAttribute("data-font-scale")).toBe(fontScale);
      await workspace.getByRole("tab", { name: "Work", exact: true }).click();
      const read = await workspace.evaluate(e => {
        const font = (selector: string) => parseFloat(getComputedStyle(e.querySelector(selector)!).fontSize);
        const stacked = matchMedia("(max-width: 767px)").matches;
        const rows = [...e.querySelectorAll<HTMLElement>(".work-row")].map(row => {
          const title = row.querySelector<HTMLElement>(".work-title")!, meta = row.querySelector<HTMLElement>(".work-row-meta")!;
          const a = title.getBoundingClientRect(), b = meta.getBoundingClientRect();
          const cut = title.scrollWidth > title.clientWidth + 1;
          return { clipped: cut && title.getAttribute("title") !== title.textContent?.trim(),
            overlap: b.width > 0 && (stacked ? a.bottom > b.top + 1 : a.right > b.left + 1) };
        });
        return { title: font(".work-title"), schedule: font(".work-when"), checklist: font(".work-checklist .task-editor-item-text"),
          lineHeight: parseFloat(getComputedStyle(e.querySelector(".work-title")!).lineHeight),
          input: font(".work-input"), overflow: e.scrollWidth - e.clientWidth, rows,
          checkbox: e.querySelector(".work-checklist-toggle")!.getBoundingClientRect().width };
      });
      measurements.push({ width, fontScale, ...read });
      expect(read.title).toBeCloseTo(workTitle[index], 2);
      expect(read.checklist).toBeCloseTo(expectedFonts[index], 2);
      expect(read.schedule).toBeCloseTo(workText[index], 2);
      expect(read.lineHeight).toBeCloseTo(workTitle[index] * 1.3, 1);
      expect(read.input).toBeCloseTo(width < 768 ? Math.max(16, expectedFonts[index]) : expectedFonts[index], 2);
      expect(read.rows.every(row => !row.clipped && !row.overlap), JSON.stringify({ width, fontScale, rows: read.rows })).toBe(true);
      expect(read.overflow).toBeLessThanOrEqual(1);
      expect(read.checkbox).toBe(14);
      if (["normal", "xx-large"].includes(fontScale) && [1506, 390].includes(width)) {
        await page.screenshot({ path: testInfo.outputPath(`font-${fontScale}-${width}.png`) });
      }
      await workspace.getByRole("button", { name: "Timeline", exact: true }).click();
      const timeline = await workspace.getByTestId("task-subtask-timeline").evaluate(e => ({
        font: parseFloat(getComputedStyle(e.querySelector(".work-timeline-label")!).fontSize),
        clippedBars: [...e.querySelectorAll<HTMLElement>(".work-timeline-bar")].some(bar => bar.scrollHeight > bar.clientHeight + 1
          || bar.getBoundingClientRect().bottom > bar.parentElement!.getBoundingClientRect().bottom + 1),
      }));
      expect(timeline.font).toBeCloseTo(workText[index], 2);
      expect(timeline.clippedBars).toBe(false);
      await workspace.getByRole("button", { name: "List", exact: true }).click();
      const detailsTab = workspace.getByRole("tab", { name: "Details", exact: true });
      if (await detailsTab.count()) await detailsTab.click();
      const field = workspace.getByLabel("Start date", { exact: true });
      expect(await field.evaluate(e => parseFloat(getComputedStyle(e).fontSize))).toBeCloseTo(width < 768 ? Math.max(16, expectedFonts[index]) : expectedFonts[index], 2);
      expect((await field.boundingBox())!.height).toBe(width < 768 ? 32 : 30);
      const fit = await field.evaluate(e => {
        // Native date controls hide clipped segments without scroll overflow.
        // Measure the browser's intrinsic width at the actual inherited font.
        const clone = e.cloneNode(true) as HTMLInputElement;
        for (const [property, value] of Object.entries({ position: "fixed", visibility: "hidden", width: "max-content", "max-width": "none", "min-width": "0" })) {
          clone.style.setProperty(property, value, "important");
        }
        e.parentElement!.appendChild(clone);
        const required = clone.getBoundingClientRect().width;
        clone.remove();
        return { actual: e.getBoundingClientRect().width, required };
      });
      expect(fit.actual, JSON.stringify({ width, fontScale, ...fit })).toBeGreaterThanOrEqual(fit.required - 1);
    }
  }
  await testInfo.attach("font-measurements", { body: JSON.stringify(measurements, null, 2), contentType: "application/json" });
});

test("compact checkbox targets, row actions and sidebar fields remain functional", async ({ page }) => {
  const { taskId } = await fixture(page);
  const workspace = page.getByTestId("task-editor-expanded");
  const check = workspace.locator(".work-checklist-toggle").first();
  await check.locator("..").click({ position: { x: 2, y: 2 } });
  await expect(check).toHaveAttribute("aria-pressed", "true");
  await check.click();
  await expect(check).toHaveAttribute("aria-pressed", "false");
  const parent = workspace.locator('.work-row[data-has-children="true"]').first();
  const phoneWidth = page.viewportSize()!.width < 768;
  const coarse = await page.evaluate(() => matchMedia("(pointer:coarse)").matches);
  const toggle = parent.locator(phoneWidth ? ".work-title" : ".work-caret");
  await toggle.click();
  await expect(workspace.getByRole("button", { name: "Nested connectivity check", exact: true })).toBeHidden();
  await toggle.click();
  await expect(workspace.getByRole("button", { name: "Nested connectivity check", exact: true })).toBeVisible();
  const leaf = workspace.locator(".work-row").filter({ has: page.getByRole("button", { name: "Direct leaf without children", exact: true }) });
  if (phoneWidth) {
    await leaf.locator(".work-row-menu").click();
    await workspace.getByRole("button", { name: "Rename", exact: true }).click();
  } else await leaf.locator(".work-title").click();
  const renameFont = await workspace.getByRole("textbox", { name: "Subtask title", exact: true }).evaluate(e => parseFloat(getComputedStyle(e).fontSize));
  if (phoneWidth) expect(renameFont).toBeGreaterThanOrEqual(16);
  await workspace.getByRole("textbox", { name: "Subtask title", exact: true }).fill("Renamed compact row");
  await workspace.getByRole("textbox", { name: "Subtask title", exact: true }).press("Enter");
  await expect(workspace.getByRole("button", { name: "Renamed compact row", exact: true })).toBeVisible();
  if (phoneWidth) {
    await parent.locator(".work-row-menu").click();
    await workspace.getByRole("button", { name: "Set time", exact: true }).click();
  } else {
    if (coarse) await parent.locator(".work-actions-trigger").tap();
    else await parent.locator(".work-actions").hover();
    await parent.getByRole("button", { name: "Change time", exact: true }).click();
  }
  await expect(workspace.getByTestId("task-subtask-time-editor")).toBeVisible();
  await workspace.getByRole("button", { name: "Cancel", exact: true }).click();
  const detailsTab = workspace.getByRole("tab", { name: "Details", exact: true });
  if (await detailsTab.count()) await detailsTab.click();
  const details = workspace.locator('[data-destination="details"]');
  const saveAllDay = async (allDay: boolean) => {
    const [response] = await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/api/tasks/${taskId}`)
        && response.request().method() === "PATCH" && response.request().postDataJSON()?.allDay === allDay),
      details.getByLabel("All day", { exact: true }).click(),
    ]);
    expect(response.ok()).toBe(true);
    await response.finished();
    await expect(details.getByLabel("All day", { exact: true })).toBeChecked({ checked: allDay });
  };
  await saveAllDay(false);
  await expect(details.getByLabel("Start time", { exact: true })).toBeVisible();
  await saveAllDay(true);
  await expect(details.getByLabel("Start time", { exact: true })).toHaveCount(0);
  await workspace.getByRole("tab", { name: /^Notes(?: ·|$)/ }).click();
  await workspace.getByRole("button", { name: "New linked note", exact: true }).click();
  const title = `Compact workspace note ${Date.now()}`;
  await workspace.getByRole("textbox", { name: "Note title", exact: true }).fill(title);
  await workspace.locator('.bn-editor[contenteditable="true"]').fill("Notes remain editable at the sidebar scale.");
  await expect(workspace.locator(".task-note-info")).toContainText("Saved");
  const noteFonts = await workspace.locator(".task-embedded-notes").evaluate(e => ({
    body: parseFloat(getComputedStyle(e.querySelector(".bn-editor")!).fontSize),
    title: parseFloat(getComputedStyle(e.querySelector(".task-note-title")!).fontSize),
  }));
  if (phoneWidth) expect(Math.min(noteFonts.body, noteFonts.title)).toBeGreaterThanOrEqual(16);
  await workspace.getByRole("tab", { name: "Work", exact: true }).click();
  await workspace.getByRole("tab", { name: /^Notes(?: ·|$)/ }).click();
  await expect(workspace.getByRole("textbox", { name: "Note title", exact: true })).toHaveValue(title);
  await expect(workspace.locator(".bn-editor")).toContainText("Notes remain editable at the sidebar scale.");
});

test("editor roles keep sidebar and workspace consistent", async ({ page }) => {
  const { boardId, taskId, sidebarRoles } = await fixture(page);
  const workspace = page.getByTestId("task-editor-expanded");
  // The sidebar header shows every chip in full and says "no working notes" once.
  expect(sidebarRoles.clippedChips).toEqual([]);
  expect(sidebarRoles.workingNotesLines).toBe(1);
  await workspace.getByRole("tab", { name: "Work", exact: true }).click();
  const read = await workspace.evaluate(e => {
    const title = e.querySelector<HTMLElement>(".workspace-title-input, .workspace-title-text")!;
    const checkX = (name: string) => {
      const row = [...e.querySelectorAll<HTMLElement>(".work-row")].find(item => item.querySelector(".work-title")?.textContent?.trim() === name)!;
      return row.querySelector(".work-check, .work-check-target")!.getBoundingClientRect().left;
    };
    const attachments = e.querySelector<HTMLElement>('[aria-label="Task attachments"]')!;
    const field = e.querySelector<HTMLInputElement>('input[placeholder="Add subtask. Enter adds another."]')!;
    return {
      title: { font: getComputedStyle(title).fontSize, weight: getComputedStyle(title).fontWeight },
      parentX: checkX("Network replacement window"), nestedX: checkX("Nested connectivity check"), leafX: checkX("Direct leaf without children"),
      attachments: { shown: attachments.checkVisibility(), text: attachments.textContent?.trim(), width: attachments.getBoundingClientRect().width, clipped: attachments.scrollWidth > attachments.clientWidth + 1 },
      placeholder: getComputedStyle(field, "::placeholder").color, value: getComputedStyle(field).color,
      rawSizes: [...e.querySelectorAll("[class]")].filter(node => /(^|\s)text-\[(9|1\d)px\]/.test(String(node.getAttribute("class")))).length,
    };
  });
  // One title role for both editors.
  expect(read.title).toEqual(sidebarRoles.title);
  // Checkboxes move with depth only: a childless sibling lines up with its parent.
  expect(Math.abs(read.leafX - read.parentX)).toBeLessThanOrEqual(1);
  expect(read.nestedX).toBeGreaterThan(read.parentX + 4);
  // No attachments: a plain icon button, never a squeezed "0". Narrow headers move it into the menu.
  expect(read.attachments.text).toBe("");
  if (read.attachments.shown) {
    expect(read.attachments.width).toBeGreaterThanOrEqual(28);
    expect(read.attachments.clipped).toBe(false);
  }
  // Placeholders read clearly weaker than typed values.
  expect(brightness(read.value) - brightness(read.placeholder)).toBeGreaterThan(60);
  // No editor element is sized by a raw pixel utility.
  expect(read.rawSizes).toBe(0);
  // Notes without links shows its empty message, not an empty two-pane grid.
  await workspace.getByRole("tab", { name: /^Notes(?: ·|$)/ }).click();
  await expect(workspace.locator(".work-empty")).toBeVisible();
  await expect(workspace.locator(".task-note-grid")).toHaveCount(0);
  // Menus portalled out of the editor keep its text scale.
  await workspace.getByRole("tab", { name: "Work", exact: true }).click();
  // The editor root carries the editor's body text size.
  const body = await workspace.getByTestId("task-editor").evaluate(e => getComputedStyle(e).fontSize);
  await workspace.getByRole("button", { name: "Task actions", exact: true }).click();
  const menu = page.locator('.taskboard-floating-menu-layer[data-editor-scale="true"] .ed-menu-item').first();
  await expect(menu).toBeVisible();
  expect(await menu.evaluate(e => getComputedStyle(e).fontSize)).toBe(body);
  await page.keyboard.press("Escape");
  // Twelve attachments: the header button widens for a two-digit count instead of clipping it.
  const files = new FormData();
  for (let index = 1; index <= 12; index++) files.append("files", new File([`evidence ${index}`], `evidence-${index}.txt`, { type: "text/plain" }));
  const upload = await page.request.post(`/api/tasks/${taskId}/attachments?boardId=${boardId}`, { multipart: files });
  expect(upload.ok(), await upload.text()).toBe(true);
  await openWorkspace(page, boardId, taskId);
  const populated = await page.getByTestId("task-editor-expanded").locator('[aria-label="Task attachments"]').evaluate(e => ({
    shown: e.checkVisibility(), text: e.textContent?.trim(), clipped: e.scrollWidth > e.clientWidth + 1, height: e.getBoundingClientRect().height,
  }));
  if (populated.shown) {
    expect(populated.text).toBe("12");
    expect(populated.clipped).toBe(false);
    expect(populated.height).toBe(28);
  }
});

test("board cards, the sidebar and the workspace share one text scale at every font preference", async ({ page }) => {
  const { boardId, taskId } = await fixture(page);
  const sizes: number[] = [];
  for (const fontScale of ["small", "normal", "large", "x-large", "xx-large"]) {
    await page.evaluate(fontScale => {
      const key = "taskboard-ui-settings";
      localStorage.setItem(key, JSON.stringify({ ...JSON.parse(localStorage.getItem(key) || "{}"), fontScale }));
      dispatchEvent(new Event("taskboard-ui-settings-change"));
    }, fontScale);
    await expect.poll(() => page.locator("html").getAttribute("data-font-scale")).toBe(fontScale);
    await openWorkspace(page, boardId, taskId);
    const font = (selector: string) => page.locator(selector).first().evaluate(e => parseFloat(getComputedStyle(e).fontSize));
    const workspace = await font('[data-testid="task-editor-expanded"] [data-testid="task-editor"]');
    await page.goto(`/?boardId=${boardId}&taskId=${taskId}`);
    await expect(page.getByTestId("task-editor-sidebar")).toBeVisible();
    const card = await font('[data-testid="task-card"] .line-clamp-2');
    const sidebar = await font('[data-testid="task-editor-sidebar"] [data-testid="task-editor"]');
    // Card text, sidebar body and workspace body are the same step of one scale.
    expect(sidebar, fontScale).toBeCloseTo(card, 2);
    expect(workspace, fontScale).toBeCloseTo(card, 2);
    sizes.push(card);
  }
  // Every preference is larger than the one before it.
  expect(sizes.every((size, index) => index === 0 || size > sizes[index - 1]), JSON.stringify(sizes)).toBe(true);
});
