import { expect, test, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const visualTestPassword = "visual-test-password";

test.describe("visual layout guardrails", () => {
  test("compact bucket cards clamp long titles to two lines", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/");
    const hasSeedFallbackAccess = await page.getByTestId("taskboard-shell").isVisible();
    if (!hasSeedFallbackAccess) {
      await signIn(page);
    }
    await page.getByTestId("taskboard-shell").waitFor();

    const card = page.getByTestId("task-card").first();
    const title = card.locator(".line-clamp-2").first();
    // A cold dev-server load can paint before the stylesheet applies, so read
    // the clamp inside a retry.
    await expect(async () => {
      const metrics = await title.evaluate((element) => {
        const style = getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        const lineHeight = Number(style.lineHeight.replace("px", ""));
        return {
          lineClamp: style.webkitLineClamp,
          renderedLines: rect.height / lineHeight,
        };
      });

      expect(metrics.lineClamp).toBe("2");
      expect(metrics.renderedLines).toBeLessThanOrEqual(2.01);
    }).toPass({ timeout: 10_000 });
  });

  test("mobile navigation fits and task selection reveals the quick editor", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const hasSeedFallbackAccess = await page.getByTestId("taskboard-shell").isVisible();
    if (!hasSeedFallbackAccess) {
      await signIn(page);
    }
    await page.getByTestId("taskboard-shell").waitFor();

    const navigation = page.getByRole("navigation", { name: "Phone navigation" });
    await expect(navigation).toBeVisible();
    const navigationGeometry = await navigation.evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
    expect(navigationGeometry.scrollWidth).toBeLessThanOrEqual(
      navigationGeometry.clientWidth + 1,
    );
    // Notes, Calendar, Tasks and More share the short phone bar.
    await expect(navigation.locator(":scope > *")).toHaveCount(4);

    const taskCard = page.getByTestId("task-card").first();
    const openTaskButton = taskCard.getByRole("button", {
      // The fixture task is overdue, so its name ends with "(overdue)".
      name: /^Open task Weekly review and reprioritize the board/,
    });
    const sidebar = page.getByTestId("task-editor-sidebar");
    await expect(async () => {
      await openTaskButton.click();
      await expect(sidebar).toBeVisible({ timeout: 1_500 });
    }).toPass({ timeout: 6_000 });
    await expect
      .poll(async () =>
        sidebar.evaluate((element) => {
          const rect = element.getBoundingClientRect();
          return rect.top < window.innerHeight && rect.bottom > 0;
        }),
      )
      .toBe(true);
    expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
  });

  test("dashboard controls and chips fit at core viewport sizes", async ({ page }, testInfo) => {
    const consoleMonitor = monitorUnexpectedClientErrors(page);

    const isSignedIn = await trySignIn(page);
    test.skip(!isSignedIn, "Local password-mode visual auth requires a local admin record/Postgres.");
    await page.getByTestId("taskboard-shell").waitFor();
    await hideNextDevTools(page);
    await captureFullPage(page, testInfo, "taskboard-dashboard.png");
    await assertVisibleElementsFit(page, visualRiskSelector);
    await assertBasicAccessibility(page);
    await assertNoClientErrorBoundary(page);
    consoleMonitor.expectNoUnexpectedErrors();
  });

  test("task inspector header and quick actions fit without overlap", async ({ page }, testInfo) => {
    await signIn(page);
    await page.getByTestId("taskboard-shell").waitFor();
    await openFirstTask(page);
    await hideNextDevTools(page);
    await captureFullPage(page, testInfo, "taskboard-inspector-sidebar.png");
    await assertInspectorLayout(page);
    await assertVisibleElementsFit(page, "[data-testid='task-editor-sidebar'] button, [data-testid='task-editor-sidebar'] [class*='rounded-full']");

    const calendarLink = page.getByTestId("task-inspector-view-calendar");
    await expect(calendarLink).toHaveAttribute("href", /taskId=.+/);
    await expect(calendarLink).toHaveCSS("display", "flex");
    await expect(calendarLink).toHaveCSS("align-items", "center");
    await expect(calendarLink.locator("svg")).toBeVisible();
    const calendarLinkLayout = await calendarLink.evaluate((element) => {
      const linkRect = element.getBoundingClientRect();
      const iconRect = element.querySelector("svg")?.getBoundingClientRect();
      return {
        height: linkRect.height,
        iconCentered: iconRect
          ? Math.abs(iconRect.top + iconRect.height / 2 - (linkRect.top + linkRect.height / 2))
          : Number.POSITIVE_INFINITY,
      };
    });
    expect(calendarLinkLayout.height).toBeGreaterThanOrEqual(28);
    expect(calendarLinkLayout.iconCentered).toBeLessThanOrEqual(1);

    const inspectorHeaderText = await page.getByTestId("task-inspector-header").innerText();
    expect(inspectorHeaderText).not.toMatch(/\nToday\n/);

    await expect(page.locator("html")).toHaveAttribute("data-ui-skin", "architecture");
    await expect(page.locator("html")).toHaveAttribute("data-theme-variant", "neutral");

    const sidebarVariants = [
      {
        name: "narrow-large-font",
        settings: { sidebarWidth: "narrow", fontScale: "large" },
      },
      {
        name: "wide-normal-font",
        settings: { sidebarWidth: "wide", fontScale: "normal" },
      },
    ] as const;

    for (const variant of sidebarVariants) {
      await applyUiSettings(page, variant.settings);
      await page.reload();
      await page.getByTestId("taskboard-shell").waitFor();
      await openFirstTask(page);
      await hideNextDevTools(page);
      await captureFullPage(page, testInfo, `taskboard-inspector-sidebar-${variant.name}.png`);
      await assertInspectorLayout(page);
    }
  });

  test("expanded workspace puts the work first at every viewport", async ({ page }, testInfo) => {
    await page.goto("/");
    const hasSeedFallbackAccess = await page.getByTestId("taskboard-shell").isVisible();
    if (!hasSeedFallbackAccess) {
      await signIn(page);
    }
    await page.getByTestId("taskboard-shell").waitFor();
    await openExpandedWorkspace(page);
    await hideNextDevTools(page);
    await captureFullPage(page, testInfo, "taskboard-expanded-work-first.png");
    await assertWorkFirstWorkspaceLayout(page, testInfo.project.name);

    if (!testInfo.project.name.includes("desktop")) {
      const destinations = page.getByRole("navigation", { name: "Task workspace sections" });
      const composer = page.getByTestId("task-note-composer");
      const draft = "Unposted workspace destination persistence check";

      await destinations.getByRole("button", { name: /^Notes/ }).click();
      await composer.fill(draft);
      await destinations.getByRole("button", { name: "Details", exact: true }).click();
      await expect(page.getByTestId("task-workspace-supporting")).toContainText("Schedule");
      await destinations.getByRole("button", { name: /^Notes/ }).click();
      await expect(composer).toHaveValue(draft);
      await assertVisibleElementsFit(page, ".task-workspace-tabs > button");
    }

    await expect(page.locator("html")).toHaveAttribute("data-ui-skin", "architecture");
    await expect(page.locator("html")).toHaveAttribute("data-theme-variant", "neutral");
    await expect(page.getByTestId("task-working-notes-section")).toBeAttached();
    await assertNoHorizontalPageOverflow(page);
    await assertBasicAccessibility(page);
  });

  test("working notes fold under the work and keep the composer before history", async ({ page }) => {
    await page.goto("/");
    const hasSeedFallbackAccess = await page.getByTestId("taskboard-shell").isVisible();
    if (!hasSeedFallbackAccess) {
      await signIn(page);
    }
    await page.getByTestId("taskboard-shell").waitFor();
    await openExpandedWorkspace(page);
    await showWorkingNotes(page);

    const workingNotes = page.getByTestId("task-working-notes-section");
    const primaryNote = page.getByTestId("task-primary-note-section");
    const composer = page.getByTestId("task-note-composer");
    const activityStream = page.getByTestId("task-notes-activity-stream");

    await expect(workingNotes).toBeVisible();
    await expect(composer).toBeVisible();
    await expect(activityStream).toBeVisible();
    await expect(workingNotes.getByRole("button", { name: "Edit", exact: true })).toHaveCount(1);
    await expect(workingNotes.getByRole("button", { name: "Delete", exact: true })).toHaveCount(1);
    const primaryNoteIsOutsideWorkingNotes = await page.evaluate(() => {
      const primary = document.querySelector("[data-testid='task-primary-note-section']");
      const notes = document.querySelector("[data-testid='task-working-notes-section']");
      return Boolean(primary && notes && !notes.contains(primary));
    });
    expect(primaryNoteIsOutsideWorkingNotes, "Description should be outside Working Notes").toBe(true);
    await expect(primaryNote.getByText("Description", { exact: true })).toHaveCount(1);

    const [composerBox, activityStreamBox] = await Promise.all([
      composer.boundingBox(),
      activityStream.boundingBox(),
    ]);
    expect(composerBox).not.toBeNull();
    expect(activityStreamBox).not.toBeNull();
    expect(composerBox!.y, "composer should precede the activity stream").toBeLessThan(activityStreamBox!.y);
  });

  test("compact workspace keeps the header short and the work near the top", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const hasSeedFallbackAccess = await page.getByTestId("taskboard-shell").isVisible();
    if (!hasSeedFallbackAccess) {
      await signIn(page);
    }
    await page.getByTestId("taskboard-shell").waitFor();
    await openExpandedWorkspace(page);

    await expect(page.getByText("Edit task details inline below.", { exact: true })).toHaveCount(0);
    await expect(page.getByTestId("task-inspector-view-calendar")).toBeVisible();

    const geometry = await page.evaluate(() => {
      const panel = document.querySelector<HTMLElement>("[data-testid='task-editor-expanded']");
      const work = document.querySelector<HTMLElement>("[data-testid='task-work-breakdown']");
      if (!panel || !work) {
        return null;
      }
      return { workOffset: work.getBoundingClientRect().top - panel.getBoundingClientRect().top };
    });

    expect(geometry, "expanded panel and subtasks should render").not.toBeNull();
    expect(geometry!.workOffset, "compact workspace should keep subtasks near the top of the panel").toBeLessThanOrEqual(480);

    const scrollOwnership = await page.evaluate(() => ({
      bodyOverflow: document.body.style.overflow,
      documentOverflow: document.documentElement.style.overflow,
      workspaceOverflow: getComputedStyle(
        document.querySelector<HTMLElement>(".task-workspace-grid")!,
      ).overflowY,
    }));
    expect(scrollOwnership.documentOverflow).toBe("hidden");
    expect(scrollOwnership.bodyOverflow).toBe("hidden");
    expect(scrollOwnership.workspaceOverflow).toBe("auto");
  });

  test("expanded workspace gives the complete note canvas one scroll owner at laptop heights", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 768 });
    await page.goto("/");
    const hasSeedFallbackAccess = await page.getByTestId("taskboard-shell").isVisible();
    if (!hasSeedFallbackAccess) {
      await signIn(page);
    }
    await page.getByTestId("taskboard-shell").waitFor();
    await openExpandedWorkspace(page);
    await showWorkingNotes(page);

    const geometry = await page.evaluate(() => {
      const grid = document.querySelector<HTMLElement>(".task-workspace-grid");
      const primary = document.querySelector<HTMLElement>("[data-testid='task-workspace-primary']");
      const supporting = document.querySelector<HTMLElement>("[data-testid='task-workspace-supporting']");
      const stream = document.querySelector<HTMLElement>("[data-testid='task-notes-activity-stream']");
      const finalNote = stream?.querySelector<HTMLElement>("[data-testid='task-note-item']:last-of-type");
      if (!grid || !primary || !supporting || !stream || !finalNote) {
        return null;
      }

      const gridRect = grid.getBoundingClientRect();
      const initialFinalNoteRect = finalNote.getBoundingClientRect();
      const neededScroll = initialFinalNoteRect.bottom - gridRect.bottom;
      const maxScroll = grid.scrollHeight - grid.clientHeight;
      grid.scrollTop = Math.min(
        maxScroll,
        neededScroll > 0 ? grid.scrollTop + neededScroll : Math.min(maxScroll, 32),
      );
      const finalNoteRect = finalNote.getBoundingClientRect();

      return {
        finalNoteReachable:
          finalNoteRect.bottom > gridRect.top && finalNoteRect.bottom <= gridRect.bottom + 1,
        gridOverflowY: getComputedStyle(grid).overflowY,
        gridScrollable: grid.scrollHeight > grid.clientHeight,
        gridScrollTop: grid.scrollTop,
        primaryOverflowY: getComputedStyle(primary).overflowY,
        supportingOverflowY: getComputedStyle(supporting).overflowY,
        streamOverflowY: getComputedStyle(stream).overflowY,
        streamUsesIntrinsicHeight: stream.scrollHeight <= stream.clientHeight + 1,
      };
    });

    expect(geometry, "workspace columns and the activity stream should render").not.toBeNull();
    expect(geometry!.gridOverflowY, "the workspace grid should own vertical scrolling").toBe("auto");
    expect(geometry!.primaryOverflowY, "the work column should not create a nested scroller").toBe("visible");
    expect(geometry!.supportingOverflowY, "the details column should use the workspace scroll").toBe("visible");
    expect(geometry!.streamOverflowY, "the note history should not create a nested scroller").toBe("visible");
    expect(geometry!.streamUsesIntrinsicHeight, "the note history should expose its full height").toBe(true);
    expect(geometry!.finalNoteReachable, "the workspace scroll should reach its final note").toBe(true);
    if (geometry!.gridScrollable) {
      expect(geometry!.gridScrollTop, "overflowing workspace content should scroll to its final note").toBeGreaterThan(0);
    }
  });

  test("workspace controls are touch-sized on touch screens and compact with a mouse", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const hasSeedFallbackAccess = await page.getByTestId("taskboard-shell").isVisible();
    if (!hasSeedFallbackAccess) {
      await signIn(page);
    }
    await page.getByTestId("taskboard-shell").waitFor();
    await openExpandedWorkspace(page);

    const destinations = page.getByRole("navigation", { name: "Task workspace sections" });
    for (const destination of ["Work", "Details", "Notes", "Files"] as const) {
      await destinations.getByRole("button", { name: new RegExp(`^${destination}`) }).click();
      await assertExpandedTaskTargets(page, destination);
      await assertNoHorizontalPageOverflow(page);
    }
  });

  test("expanded editor uses tabs below the two-zone width", async ({ page }) => {
    await page.setViewportSize({ width: 1050, height: 844 });
    await page.goto("/");
    const hasSeedFallbackAccess = await page.getByTestId("taskboard-shell").isVisible();
    if (!hasSeedFallbackAccess) {
      await signIn(page);
    }
    await page.getByTestId("taskboard-shell").waitFor();
    await openExpandedWorkspace(page);

    const destinations = page.getByRole("navigation", { name: "Task workspace sections" });
    await expect(destinations).toBeVisible();
    const workspaceWidth = await page.getByTestId("task-workspace-layout").evaluate((element) => element.getBoundingClientRect().width);
    expect(workspaceWidth, "workspace should use tabs below 1100px").toBeLessThan(1100);

    for (const destination of ["Work", "Details", "Notes", "Files"] as const) {
      await destinations.getByRole("button", { name: new RegExp(`^${destination}`) }).click();
      await assertExpandedTaskTargets(page, `${destination} below the two-zone width`);
      await assertNoHorizontalPageOverflow(page);
    }
  });

  test("expanded task menu controls are touch-sized only on touch screens", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/");
    const hasSeedFallbackAccess = await page.getByTestId("taskboard-shell").isVisible();
    if (!hasSeedFallbackAccess) {
      await signIn(page);
    }
    await page.getByTestId("taskboard-shell").waitFor();
    await openExpandedWorkspace(page);

    const minimum = (await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches)) ? 44 : 24;
    await page.getByTestId("task-inspector-header-controls").getByRole("button", { name: "Task actions" }).click();
    const menu = page.locator(".taskboard-floating-menu-layer .taskboard-popover");
    await expect(menu).toBeVisible();
    const undersizedTargets = await menu.evaluateAll((menus, min) =>
      menus.flatMap((menu) =>
        Array.from(menu.querySelectorAll<HTMLElement>("button, a[href], [role='button']"))
          .filter((element) => {
            const style = window.getComputedStyle(element);
            const rect = element.getBoundingClientRect();
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              !element.matches(":disabled, [aria-disabled='true']") &&
              rect.width > 2 &&
              rect.height > 2 &&
              (rect.width < min || rect.height < min)
            );
          })
          .map((element) => {
            const rect = element.getBoundingClientRect();
            return {
              name: (element.getAttribute("aria-label") || element.innerText || element.tagName).trim(),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
            };
          }),
      ),
    minimum);
    expect(undersizedTargets, `expanded task menu controls should be at least ${minimum}px`).toEqual([]);
  });

  test("adaptive workspace shows two zones when wide and tabs when narrow", async ({ page }) => {
    await page.goto("/");
    const hasSeedFallbackAccess = await page.getByTestId("taskboard-shell").isVisible();
    if (!hasSeedFallbackAccess) {
      await signIn(page);
    }

    await page.getByTestId("taskboard-shell").waitFor();
    await page.setViewportSize({ width: 1440, height: 1000 });
    await openExpandedWorkspace(page);

    const workspace = page.getByTestId("task-workspace-layout");
    const destinations = page.getByRole("navigation", { name: "Task workspace sections" });
    const primary = page.getByTestId("task-workspace-primary");
    const supporting = page.getByTestId("task-workspace-supporting");

    await expect(workspace).toBeVisible();
    await expect(destinations).toBeHidden();
    await expect(page.getByTestId("task-work-breakdown")).toBeVisible();
    await expect(supporting).toBeVisible();
    await expect(supporting.getByText("Schedule", { exact: true })).toBeVisible();
    await expect(supporting.getByText("Files", { exact: true })).toBeVisible();
    await expect(supporting.getByText("Labels", { exact: true })).toBeVisible();

    const wideLayout = await Promise.all([primary.boundingBox(), supporting.boundingBox()]);
    expect(wideLayout[0]).not.toBeNull();
    expect(wideLayout[1]).not.toBeNull();
    expect(wideLayout[0]!.x + wideLayout[0]!.width).toBeLessThanOrEqual(wideLayout[1]!.x + 1);
    expect(wideLayout[0]!.width / wideLayout[1]!.width, "the work should get most of the width").toBeGreaterThanOrEqual(2.1);
    const supportContainment = await supporting.evaluate((element) => {
      const supportRect = element.getBoundingClientRect();
      const slots = Array.from(element.querySelectorAll<HTMLElement>(".task-workspace-slot"));
      return {
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        slotsFit: slots.every((slot) => {
          const rect = slot.getBoundingClientRect();
          return rect.left >= supportRect.left - 1 && rect.right <= supportRect.right + 1;
        }),
      };
    });
    expect(supportContainment.scrollWidth).toBeLessThanOrEqual(supportContainment.clientWidth + 1);
    expect(supportContainment.slotsFit).toBe(true);
    await assertNoHorizontalPageOverflow(page);

    await page.setViewportSize({ width: 768, height: 1024 });
    await expect(destinations).toBeVisible();
    const work = destinations.getByRole("button", { name: "Work", exact: true });
    const notes = destinations.getByRole("button", { name: /^Notes/ });
    const details = destinations.getByRole("button", { name: "Details", exact: true });
    await expect(work).toHaveAttribute("aria-pressed", "true");

    await notes.click();
    const composer = page.getByTestId("task-note-composer");
    await composer.fill("Keep this unposted working-note draft");
    await details.click();
    await expect(page.locator('[data-destination="details"]')).toBeVisible();
    await expect(composer).toBeHidden();

    await notes.click();
    await expect(composer).toBeVisible();
    await expect(composer).toHaveValue("Keep this unposted working-note draft");
    await assertNoHorizontalPageOverflow(page);
  });

  test("options chips fit at core viewport sizes", async ({ page }, testInfo) => {
    const consoleMonitor = monitorUnexpectedClientErrors(page);

    const isSignedIn = await trySignIn(page, "/options");
    test.skip(!isSignedIn, "Local password-mode visual auth requires a local admin record/Postgres.");
    await page.getByRole("heading", { name: /options|settings/i }).first().waitFor();
    await expect(page.getByRole("link", { name: "Back to previous view", exact: true })).toBeVisible();
    await hideNextDevTools(page);
    await captureFullPage(page, testInfo, "taskboard-options.png");
    await assertNoHorizontalPageOverflow(page);
    await assertVisibleElementsFit(page, visualRiskSelector);
    await assertBasicAccessibility(page);
    await assertNoClientErrorBoundary(page);
    consoleMonitor.expectNoUnexpectedErrors();
  });

  test("task selection returns from options with the shared sidebar intact", async ({ page }) => {
    await signIn(page);
    await page.getByTestId("taskboard-shell").waitFor();
    await openFirstTask(page);
    const selectedTaskId = new URL(page.url()).searchParams.get("taskId");
    expect(selectedTaskId).not.toBeNull();

    // The task route is server-rendered; retry until the hydrated Menu opens.
    const optionsLink = page.getByRole("link", { name: "Options", exact: true });
    await expect(async () => {
      await page.getByTestId("board-header").getByRole("button", { name: "Menu", exact: true }).click();
      await expect(optionsLink).toBeVisible({ timeout: 1_500 });
    }).toPass({ timeout: 10_000 });
    await optionsLink.click();
    await page.getByRole("heading", { name: "Options", exact: true }).waitFor();
    await page.getByRole("link", { name: "Back to previous view", exact: true }).click();

    await page.getByTestId("task-editor-sidebar").waitFor();
    await expect(page).toHaveURL(new RegExp(`taskId=${selectedTaskId}`));
  });

  test("tight density and icon-only popup controls remain usable", async ({ page }) => {
    await page.goto("/options");
    const hasDirectAccess = await page.getByRole("heading", { name: "Options", exact: true }).isVisible();
    const isSignedIn = hasDirectAccess || await trySignIn(page, "/options");
    test.skip(!isSignedIn, "Visual auth requires either direct local access or a local admin record/Postgres.");

    const densityGroup = page.getByText("Density", { exact: true }).locator("..");
    await expect(densityGroup.getByRole("button", { name: "Relaxed", exact: true })).toBeVisible();
    await expect(densityGroup.getByRole("button", { name: "Standard", exact: true })).toBeVisible();
    await expect(densityGroup.getByRole("button", { name: "Tight", exact: true })).toBeVisible();
    await applyUiSettings(page, { density: "tight" });
    await page.reload();
    await expect(page.locator("html")).toHaveAttribute("data-density", "tight");

    await page.goto("/");
    await expect(page.locator("html")).toHaveAttribute("data-density", "tight");
    await expect(page.getByTestId("board-header").getByRole("button", { name: "Share board", exact: true })).toBeVisible();
    await expect(page.getByTestId("board-header").getByRole("button", { name: "Add bucket", exact: true })).toBeVisible();

    await expect(page.getByTestId("board-header").getByRole("button", { name: "Menu", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Bucket actions", exact: true }).first()).toBeVisible();
    await assertNoHorizontalPageOverflow(page);

    await page.goto("/calendar");
    await expect(page.locator("html")).toHaveAttribute("data-density", "tight");
    await assertNoHorizontalPageOverflow(page);
  });

  test("teams page hydrates without client console errors", async ({ page }) => {
    const consoleMonitor = monitorUnexpectedClientErrors(page);

    await page.setViewportSize({ width: 1440, height: 1000 });
    const isSignedIn = await trySignIn(page, "/teams");
    test.skip(!isSignedIn, "Local password-mode visual auth requires a local admin record/Postgres.");
    await page.getByRole("heading", { name: "Team administration" }).waitFor();
    await expect(page.getByRole("link", { name: "Back to board", exact: true })).toBeVisible();
    await expect(page.getByText("Teams", { exact: true }).first()).toBeVisible();
    await assertNoHorizontalPageOverflow(page);
    await assertNoClientErrorBoundary(page);
    consoleMonitor.expectNoUnexpectedErrors();
  });

  test("calendar workspace renders direct route and preserves calendar interactions", async ({ page }, testInfo) => {
    const consoleMonitor = monitorUnexpectedClientErrors(page);

    await page.setViewportSize({ width: 1440, height: 1000 });
    await signIn(page, "/calendar");
    await expect(page).toHaveTitle("Calendar | Taskboard");
    await assertCalendarShell(page, "Week");
    await expect(page.getByTestId("taskboard-shell")).toBeVisible();
    await expect(page.getByTestId("calendar-stage")).toBeVisible();
    await expect(page.getByRole("link", { name: "Open Board workspace", exact: true })).toHaveAttribute("href", /\/(\?boardId=.+)?$/);
    await expect(page.getByRole("link", { name: "Open Agenda workspace", exact: true })).toHaveAttribute("href", /\/\?boardId=.+&view=agenda/);
    await expect(page.getByRole("link", { name: "Open Focus workspace", exact: true })).toHaveAttribute("href", /\/\?boardId=.+&view=focus/);
    await expect(boardSwitcherButton(page)).toBeVisible();
    await expect(page.getByTestId("board-header").getByLabel("Search calendar")).toHaveAttribute("placeholder", "Search calendar...");
    await expect(page.getByTestId("board-header").getByRole("button", { name: "Share board", exact: true })).toBeVisible();
    await expect(page.locator("#calendar-board-context-note")).toHaveText(
      "Imported calendars follow the personal calendar.",
    );
    await openCalendarFilterMenu(page);
    const hideLocalSamplesToggle = page.getByLabel("Hide local samples");
    await expect(hideLocalSamplesToggle).toBeVisible();
    if (await hideLocalSamplesToggle.isChecked()) {
      await expect(page.getByText("Sample calendar", { exact: true })).toHaveCount(0);
      await hideLocalSamplesToggle.uncheck();
    }
    await closeCalendarFilterMenu(page);
    await expect(page.locator(".calendar-proof-event").filter({ hasText: "Sample calendar" }).first()).toBeVisible();
    await expect(page.locator(".calendar-proof-inspector")).toHaveCount(0);
    await expect(page.getByRole("group", { name: "Filters" })).toBeVisible();
    await expect(calendarFilterMenuButton(page)).toContainText(/All\s+\d+/);
    await openCalendarFilterMenu(page);
    await expect(page.getByRole("button", { name: "Show all calendar events", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Show Taskboard task events", exact: true })).toContainText(/\d+/);
    await expect(page.getByRole("button", { name: "Show imported calendar events", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Show converted task events", exact: true })).toBeVisible();
    await closeCalendarFilterMenu(page);

    await page.getByRole("button", { name: "Month", exact: true }).click();
    await expect(activeCalendarView(page)).toHaveText("Month");
    await expect(page.locator(".taskboard-calendar-proof__calendar")).toHaveAttribute("data-calendar-active-view", "month");
    await expect(page.getByTestId("horizontal-grid-header")).toBeHidden();
    const selectableMonthDay = page.locator(".fc-daygrid-day[data-date]:not(:has(.fc-event))").first();
    const selectedMonthDate = await selectableMonthDay.getAttribute("data-date");
    expect(selectedMonthDate).not.toBeNull();
    await selectableMonthDay.click({ position: { x: 18, y: 52 } });
    await expect(activeCalendarView(page)).toHaveText("Month");
    await expect(selectableMonthDay).toHaveClass(/calendar-proof-day--selected/);
    await expect(page.locator("#calendar-slot-selection-status")).toContainText("Selected");

    for (const view of ["Day", "Week"] as const) {
      await page.getByRole("button", { name: view, exact: true }).click();
      await expect(activeCalendarView(page)).toHaveText(view);
    }

    await page.getByRole("button", { name: "Day", exact: true }).click();
    // Local sample events move with the weekday (Friday has one at 1 PM); noon
    // is free on every day, so the slot click never lands on an event. On
    // weekends the non-business shading covers the slot; the grid still
    // selects through it, so click by position and require the highlight.
    const noonSlot = page.locator('.fc-timegrid-slot-lane[data-time="12:00:00"]');
    await expect(noonSlot).toHaveCount(1);
    await noonSlot.click({ position: { x: 300, y: 3 }, force: true });
    await expect(page.locator(".fc-highlight")).toHaveCount(1);
    await expect(page.getByRole("dialog", { name: "New calendar item" })).toHaveCount(0);

    await page.getByRole("button", { name: "Create a new calendar entry" }).click();
    const entryForm = page.getByRole("dialog", { name: "New calendar item" });
    await expect(entryForm).toHaveClass(/calendar-entry-form--sidebar/);
    await expect(entryForm.getByRole("textbox", { name: "Start", exact: true })).toHaveValue(/T12:00$/);
    await expect(entryForm.getByRole("textbox", { name: "End", exact: true })).toHaveValue(/T12:15$/);
    await entryForm.getByRole("button", { name: "Expand new calendar item" }).click();
    await expect(entryForm).toHaveClass(/calendar-entry-form--expanded/);
    await entryForm.getByRole("button", { name: "Return new calendar item to sidebar" }).click();
    await expect(entryForm).toHaveClass(/calendar-entry-form--sidebar/);
    await entryForm.getByRole("button", { name: "Close calendar entry form" }).click();
    await expect(entryForm).toHaveCount(0);
    await page.getByRole("button", { name: "Week", exact: true }).click();
    await assertCalendarEventCardsReadable(page);

    await openCalendarFilterMenu(page);
    await page.getByRole("button", { name: "Show Taskboard task events", exact: true }).focus();
    await expect(page.getByRole("button", { name: "Show Taskboard task events", exact: true })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(calendarFilterMenuButton(page)).toContainText(/Tasks\s+\d+/);

    await selectCalendarEventFilter(page, "Show imported calendar events");
    await openCalendarFilterMenu(page);
    await expect(page.getByRole("button", { name: "Show imported calendar events", exact: true })).toHaveAttribute("aria-pressed", "true");
    await closeCalendarFilterMenu(page);
    await expect(page.getByText("No imported calendar events in this range", { exact: false })).toBeVisible();

    await selectCalendarEventFilter(page, "Show converted task events");
    await expect(calendarFilterMenuButton(page)).toContainText(/Converted\s+\d+/);

    await openCalendarFilterMenu(page);
    await hideLocalSamplesToggle.focus();
    await expect(hideLocalSamplesToggle).toBeFocused();
    if (!(await hideLocalSamplesToggle.isChecked())) {
      await page.keyboard.press("Space");
    }
    await expect(hideLocalSamplesToggle).toBeChecked();
    await expect(page.getByText("No converted tasks in this range", { exact: false })).toBeVisible();
    await hideLocalSamplesToggle.uncheck();
    await selectCalendarEventFilter(page, "Show all calendar events");

    const sampleImportEvent = page.locator(".calendar-proof-event").filter({ hasText: "Sample calendar" });
    await expect(sampleImportEvent.first()).toBeVisible();
    const sampleImportTitle = await sampleImportEvent.first().locator(".calendar-proof-event__title").innerText();
    await sampleImportEvent.first().click({ force: true });
    await expect(page.locator(".calendar-proof-inspector__status")).toContainText("Sample calendar");
    await expect(page.locator(".calendar-proof-inspector")).toContainText(
      "This sample import is local to this browser session.",
    );
    await selectCalendarEventFilter(page, "Show Taskboard task events");
    await expect(page.locator(".calendar-proof-inspector")).toContainText("Selection hidden");
    await expect(page.locator(".calendar-proof-inspector")).toContainText(sampleImportTitle);
    await page.getByRole("button", { name: "Show selected event" }).click();
    await expect(calendarFilterMenuButton(page)).toContainText(/All\s+\d+/);
    await expect(page.locator(".calendar-proof-inspector__status")).toContainText("Sample calendar");
    await page.getByRole("button", { name: /Convert sample locally for/ }).click();
    await expect(page.locator(".calendar-proof-inspector")).toContainText("Local sample task");
    await expect(page.locator(".calendar-proof-inspector")).toContainText("local calendar task replaces a sample import");

    await hideNextDevTools(page);
    await captureFullPage(page, testInfo, "taskboard-calendar.png");
    await assertNoHorizontalPageOverflow(page);
    consoleMonitor.expectNoUnexpectedErrors();
  });

  test("calendar scrolls inside its own frame and opens Week and Day at 7 AM", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 650 });
    await page.goto("/calendar");

    const calendarNavigation = page.locator(".taskboard-calendar-proof__masthead");
    const dateHeader = page.locator(".fc-scrollgrid-section-header").first();
    const timeGridScroller = page.locator(".fc-scroller-liquid-absolute").filter({
      has: page.locator(".fc-timegrid-body"),
    });
    await expect(calendarNavigation).toHaveCount(1);

    for (const view of ["Month", "Week", "Day"] as const) {
      await page.getByRole("button", { name: view, exact: true }).click();
      await expect(activeCalendarView(page)).toHaveText(view);
      // The calendar fills the window, so the page itself has nothing to scroll.
      await expect
        .poll(() => page.evaluate(() => document.documentElement.scrollHeight - window.innerHeight))
        .toBeLessThanOrEqual(1);

      if (view === "Month") {
        continue;
      }

      await expect(timeGridScroller).toHaveCount(1);
      await expect
        .poll(() =>
          timeGridScroller.evaluate((scroller) => {
            const sevenAm = scroller.querySelector('.fc-timegrid-slot-lane[data-time="07:00:00"]');
            return sevenAm
              ? Math.abs(sevenAm.getBoundingClientRect().top - scroller.getBoundingClientRect().top)
              : Number.POSITIVE_INFINITY;
          }),
        )
        .toBeLessThanOrEqual(2);

      // Scrolling the time grid moves only the grid; the navigation and date
      // headers stay where they are.
      const navigationBefore = await calendarNavigation.boundingBox();
      const headerBefore = await dateHeader.boundingBox();
      const scrolled = await timeGridScroller.evaluate((scroller) => {
        scroller.scrollTop = scroller.scrollHeight;
        return { scrollTop: scroller.scrollTop, windowScrollY: window.scrollY };
      });
      expect(scrolled.scrollTop).toBeGreaterThan(0);
      expect(scrolled.windowScrollY).toBe(0);
      const navigationAfter = await calendarNavigation.boundingBox();
      const headerAfter = await dateHeader.boundingBox();
      expect(navigationAfter?.y).toBe(navigationBefore?.y);
      expect(headerAfter?.y).toBe(headerBefore?.y);
      expect(headerAfter!.y).toBeGreaterThanOrEqual(navigationAfter!.y + navigationAfter!.height);
    }
  });

  test("calendar keyboard resize keeps focus on the handle so Enter and Escape work", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await signIn(page, "/calendar");

    const title = `Keyboard resize ${Date.now()}`;
    const startAt = new Date();
    startAt.setHours(9, 0, 0, 0);
    const endAt = new Date(startAt.getTime() + 60 * 60 * 1000);
    const created = await page.request.post("/api/calendar/entries", {
      data: { title, startAt: startAt.toISOString(), endAt: endAt.toISOString(), allDay: false },
    });
    expect(created.ok(), "the calendar entry fixture should be created").toBe(true);
    const createdBody = (await created.json()) as { calendarEntryId: string; calendarEntry: { updatedAt: string } };
    const entryId = createdBody.calendarEntryId;
    let expectedUpdatedAt = createdBody.calendarEntry.updatedAt;

    try {
      await page.reload();
      await page.getByRole("button", { name: "Day", exact: true }).click();
      await expect(activeCalendarView(page)).toHaveText("Day");
      await page.locator(".calendar-proof-event").filter({ hasText: title }).click();

      const handle = page.getByLabel(`Adjust end time for ${title}`, { exact: true });
      const resizeStatus = (text: string) => page.getByRole("status").filter({ hasText: text });
      await handle.focus();

      // Each proposed schedule redraws the event card; focus stays on its handle.
      await page.keyboard.press("ArrowDown");
      await expect(resizeStatus("Proposed schedule")).toHaveCount(1);
      await expect(handle).toBeFocused();
      await page.keyboard.press("ArrowDown");
      await expect(handle).toBeFocused();

      await page.keyboard.press("Escape");
      await expect(resizeStatus("Schedule change canceled.")).toHaveCount(1);
      await expect(handle).toBeFocused();

      await page.keyboard.press("ArrowDown");
      await expect(handle).toBeFocused();
      const saved = page.waitForResponse(
        (response) =>
          response.request().method() === "PATCH" &&
          new URL(response.url()).pathname === `/api/calendar/entries/${entryId}/schedule`,
      );
      await page.keyboard.press("Enter");
      const savedResponse = await saved;
      expect(savedResponse.status()).toBe(200);
      const savedBody = (await savedResponse.json()) as { endAt: string; updatedAt: string };
      expectedUpdatedAt = savedBody.updatedAt;
      expect(Date.parse(savedBody.endAt)).toBe(endAt.getTime() + 15 * 60 * 1000);
      await expect(resizeStatus("Schedule updated.")).toHaveCount(1);
      await expect(handle).toBeFocused();
    } finally {
      await page.request.delete(`/api/calendar/entries/${entryId}`, { data: { expectedUpdatedAt } });
    }
  });

  test("calendar board context fallback stays readable and suppresses explicit-board source feed", async ({ page }) => {
    const consoleMonitor = monitorUnexpectedClientErrors(page);

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto("/calendar?boardId=00000000-0000-4000-8000-000000000000");
    await assertCalendarShell(page, "Week");
    await expect(page.getByTestId("calendar-board-context")).toContainText(
      "Requested board was unavailable; showing your default board.",
    );
    await expect(boardSwitcherButton(page)).toBeVisible();
    await expect(page.getByText("Stored import", { exact: true })).toHaveCount(0);
    await assertNoHorizontalPageOverflow(page);
    await assertNoClientErrorBoundary(page);
    consoleMonitor.expectNoUnexpectedErrors();
  });

  test("calendar task events open the shared Taskboard task sidebar", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const isSignedIn = await trySignIn(page);
    test.skip(!isSignedIn, "Local password-mode visual auth requires a local admin record/Postgres.");
    await page.getByTestId("taskboard-shell").waitFor();
    await openFirstTask(page);
    const scheduledTaskLink = page.getByTestId("task-inspector-view-calendar");
    await expect(scheduledTaskLink).toBeVisible();
    const scheduledTaskHref = await scheduledTaskLink.getAttribute("href");
    expect(scheduledTaskHref).not.toBeNull();
    const scheduledTaskUrl = new URL(scheduledTaskHref ?? "/calendar", page.url());
    scheduledTaskUrl.searchParams.delete("taskId");
    await page.goto(`${scheduledTaskUrl.pathname}?${scheduledTaskUrl.searchParams.toString()}`);
    // Task-focused dates move the calendar without overriding the saved grid view.
    await assertCalendarShell(page, "Week");

    const taskEvents = page.locator(".calendar-proof-event").filter({ hasText: "Taskboard task" });
    await expect(taskEvents.first()).toBeVisible();

    const eventCount = await taskEvents.count();

    for (let index = 0; index < eventCount; index += 1) {
      await taskEvents.nth(index).click({ force: true });

      if ((await page.getByTestId("task-editor-sidebar").count()) > 0) {
        break;
      }
    }

    await page.getByTestId("taskboard-shell").waitFor();
    await page.getByTestId("task-editor-sidebar").waitFor();
    await expect(page.getByTestId("task-inspector-header")).toBeVisible();
    await expect(page.getByRole("link", { name: /Open .+ in Taskboard/ })).toHaveCount(0);
    // Workspace links navigate client-side and the previous page keeps its
    // sidebar until the new one commits, so wait for the URL before acting.
    await page.getByRole("link", { name: "Open Board workspace", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/");
    await page.getByTestId("task-editor-sidebar").waitFor();
    await page.getByRole("button", { name: "Agenda", exact: true }).click();
    await expect(page.getByTestId("task-editor-sidebar")).toBeVisible();
    await page.getByRole("button", { name: "Focus", exact: true }).click();
    await expect(page.getByTestId("task-editor-sidebar")).toBeVisible();
    await page.getByRole("link", { name: "Open Calendar workspace", exact: true }).click();
    await page.waitForURL((url) => url.pathname === "/calendar" && url.searchParams.get("view") !== "outages");
    await page.getByTestId("task-editor-sidebar").waitFor();
    // The Outages calendar remounts the app, so an expand click on the
    // standard calendar would be discarded.
    const outagesLink = page.getByRole("link", { name: "Open maintenance outages in Calendar", exact: true });
    await outagesLink.click();
    await page.waitForURL((url) => url.pathname === "/calendar" && url.searchParams.get("view") === "outages");
    await expect(outagesLink).toHaveClass(/ui-chip-active/);
    await page.getByTestId("task-editor-sidebar").waitFor();
    const expandButton = page.getByTestId("task-inspector-open-workspace").first();
    await expect(expandButton).toBeVisible();
    await expandButton.click();
    await expect(page.getByTestId("task-editor-expanded")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("task-editor-expanded")).toHaveCount(0);
    const viewInCalendarLink = page.getByTestId("task-inspector-view-calendar");
    await expect(viewInCalendarLink).toBeVisible();
    await expect(viewInCalendarLink).toHaveAttribute(
      "href",
      /\/calendar\?boardId=.+&date=\d{4}-\d{2}-\d{2}T\d{2}%3A\d{2}%3A\d{2}\.\d{3}Z&taskId=.+/,
    );
    const focusedHref = await viewInCalendarLink.getAttribute("href");
    expect(focusedHref).not.toBeNull();
    const focusedUrl = new URL(focusedHref ?? "/", page.url());
    await viewInCalendarLink.click();
    await page.waitForURL(/\/calendar\?boardId=.+&date=\d{4}-\d{2}-\d{2}T.+&taskId=.+/);
    await assertCalendarShell(page, "Week");
    const focusedCalendarEvent = page.locator("[data-calendar-focused='true']");
    await expect(focusedCalendarEvent).toHaveCount(1);
    await expect(focusedCalendarEvent).toBeInViewport();
    await expect(page.getByTestId("task-editor-sidebar")).toBeVisible();
    await expect(page.getByText("Focused Taskboard task selected from the main workspace.")).toHaveCount(0);
    await expect(page.locator(".calendar-proof-inspector")).toHaveCount(0);
    await expect(page.getByText("Imported calendars are hidden in explicit board views.")).toBeVisible();
    await selectCalendarEventFilter(page, "Show imported calendar events");
    await expect(page.locator("[data-calendar-focused='true']")).toHaveCount(0);
    await expect(page.getByText("The focused Taskboard task is hidden by the current event filters.")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Show focused task", exact: true })).toHaveCount(0);
    await expect(page.getByTestId("task-editor-sidebar")).toBeVisible();
    await selectCalendarEventFilter(page, "Show all calendar events");
    await expect(page.locator("[data-calendar-focused='true']")).toHaveCount(1);

    await page.getByRole("link", { name: "Open Board workspace", exact: true }).click();
    await page.getByTestId("task-editor-sidebar").waitFor();
    await expect(page).toHaveURL(new RegExp(`taskId=${focusedUrl.searchParams.get("taskId")}`));

    await page.getByRole("button", { name: "Agenda", exact: true }).click();
    await expect(page.getByTestId("task-editor-sidebar")).toBeVisible();
    await page.getByRole("button", { name: "Focus", exact: true }).click();
    await expect(page.getByTestId("task-editor-sidebar")).toBeVisible();

    await page.goBack();
    await expect(page.getByTestId("task-editor-sidebar")).toBeVisible();

    await page.goto("/");
    await page.getByTestId("taskboard-shell").waitFor();
    await expect(page.getByTestId("taskboard-calendar-arrival-notice")).toHaveCount(0);
    await expect(page.getByTestId("task-inspector-calendar-handoff")).toHaveCount(0);

    await page.goto(`/?boardId=${focusedUrl.searchParams.get("boardId") ?? ""}&taskId=missing-calendar-task&from=calendar`);
    await page.getByTestId("taskboard-shell").waitFor();
    await expect(page.getByTestId("taskboard-calendar-arrival-notice")).toHaveCount(0);
    await expect(page.getByTestId("task-inspector-calendar-handoff")).toHaveCount(0);
  });

  test("calendar event geometry preserves overlaps and multi-day spans", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await signIn(page, "/calendar?date=2026-07-20");
    await assertCalendarShell(page, "Week");
    await page.getByRole("button", { name: "Day", exact: true }).click();
    await expect(activeCalendarView(page)).toHaveText("Day");

    const overlappingEvents = page.locator(".fc-timegrid-event").filter({
      hasText: /Overlapping review [AB]/,
    });
    await expect(overlappingEvents).toHaveCount(2);
    const timedRects = await overlappingEvents.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      }),
    );
    expect(
      Math.min(timedRects[0].right, timedRects[1].right) -
        Math.max(timedRects[0].left, timedRects[1].left),
      "concurrent timed entries should not cover each other",
    ).toBeLessThanOrEqual(1);

    await page.getByRole("button", { name: "Week", exact: true }).click();
    const weekMultiDay = page.locator(".fc-daygrid-event").filter({
      hasText: "Multi-day maintenance window",
    });
    await expect(weekMultiDay).toHaveCount(1);
    const weekSpan = await weekMultiDay.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const dayColumns = Array.from(document.querySelectorAll<HTMLElement>(".fc-timegrid-col"))
        .map((column) => column.getBoundingClientRect())
        .filter((column) => column.width > 0);
      return {
        eventLeft: rect.left,
        eventRight: rect.right,
        dayWidth: dayColumns[0]?.width ?? 0,
      };
    });
    expect(weekSpan.dayWidth).toBeGreaterThan(0);
    expect(
      weekSpan.eventRight - weekSpan.eventLeft,
      "multi-day all-day event should span every covered day",
    ).toBeGreaterThan(weekSpan.dayWidth * 3 - 4);

    await page.getByRole("button", { name: "Month", exact: true }).click();
    const monthMultiDay = page.locator(".fc-daygrid-event").filter({
      hasText: "Multi-day maintenance window",
    });
    await expect(monthMultiDay).toHaveCount(2);
    const monthEventBoxes = await monthMultiDay.evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { left: rect.left, right: rect.right, width: rect.width };
      }),
    );
    const monthDayBox = await page.locator(".fc-daygrid-day[data-date='2026-07-19']").boundingBox();
    expect(monthDayBox).not.toBeNull();
    expect(
      monthEventBoxes.reduce((total, box) => total + box.width, 0),
      "month segments should cover all four dates across the row boundary",
    ).toBeGreaterThan(monthDayBox!.width * 4 - 12);
    for (const box of monthEventBoxes) {
      expect(box.left).toBeGreaterThanOrEqual(monthDayBox!.x - monthDayBox!.width * 6 - 4);
      expect(box.right).toBeLessThanOrEqual(monthDayBox!.x + monthDayBox!.width + 4);
    }
    await assertNoHorizontalPageOverflow(page);
  });

  test("calendar is available as a first-class authenticated workspace link", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 1000 });
    const isSignedIn = await trySignIn(page);
    test.skip(!isSignedIn, "Local password-mode visual auth requires a local admin record/Postgres.");
    await page.getByTestId("taskboard-shell").waitFor();

    const workspaceCalendarLink = page.getByTestId("board-header").getByRole("link", {
      name: "Open Calendar workspace",
      exact: true,
    });
    await expect(workspaceCalendarLink).toHaveCount(1);
    await expect(workspaceCalendarLink).toHaveAttribute("href", /\/calendar\?boardId=.+/);
    await expect(page.getByRole("button", { name: "Saved views", exact: true })).toHaveCount(0);

    await page.getByTestId("board-header").getByRole("button", { name: "Menu", exact: true }).click();
    await expect(page.getByTestId("board-header").getByRole("link", { name: "Calendar", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Options", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Teams", exact: true })).toBeVisible();

    await page.keyboard.press("Escape");
    await boardSwitcherButton(page).click();
    await expect(page.getByRole("dialog", { name: "Board picker" })).toBeVisible();
    await page.keyboard.press("Escape");

    await workspaceCalendarLink.click();
    await page.waitForURL(/\/calendar\?boardId=.+/);
    await assertCalendarShell(page, "Week");
    await expect(page.getByTestId("board-header").getByRole("link", { name: "Open Board workspace", exact: true })).toBeVisible();
    await expect(page.getByTestId("board-header").getByRole("link", { name: "Open Agenda workspace", exact: true })).toBeVisible();
    await expect(page.getByTestId("board-header").getByRole("link", { name: "Open Focus workspace", exact: true })).toBeVisible();
    await expect(page.getByTestId("board-header").getByRole("button", { name: "Add bucket", exact: true })).toHaveCount(0);
    // Recycle Bin and Archives live together in the Menu's Manage group.
    await page.getByTestId("board-header").getByRole("button", { name: "Menu", exact: true }).click();
    await expect(page.getByRole("button", { name: "Recycle Bin", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Archives", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("calendar-inline-toolbar").locator(".calendar-proof-header")).toBeVisible();
    await expect(page.getByText("Imported calendars are hidden in explicit board views.")).toBeVisible();
    await page.getByRole("link", { name: "Open Agenda workspace", exact: true }).click();
    await page.waitForURL(/\/\?boardId=.+&view=agenda/);
    await expect(page.getByTestId("board-header").getByRole("button", { name: "Agenda", exact: true })).toHaveClass(/ui-chip-active/);

    await page.goto("/calendar");
    await assertCalendarShell(page, "Week");
    await page.getByRole("link", { name: "Open Focus workspace", exact: true }).click();
    await page.waitForURL(/\/\?boardId=.+&view=focus/);
    await expect(page.getByTestId("board-header").getByRole("button", { name: "Focus", exact: true })).toHaveClass(/ui-chip-active/);

    await page.goto("/calendar");
    await assertCalendarShell(page, "Week");
    await page.getByRole("link", { name: "Open Board workspace", exact: true }).click();
    await page.waitForURL(/\/(\?boardId=.+)?$/);
    await page.getByTestId("taskboard-shell").waitFor();
  });

  test("mobile Calendar defaults to Agenda with compact view selection and shared navigation", async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await trySignIn(page);
    await page.goto("/calendar");
    await expect(page.locator(".phone-calendar")).toHaveAttribute("data-calendar-active-view", "agenda");
    await expect(page.getByRole("navigation", { name: "Phone navigation" })).toBeVisible();
    const view = page.getByRole("button", { name: "Choose Calendar view", exact: true });
    await view.click();
    await page.getByRole("dialog", { name: "Calendar views" }).getByRole("button", { name: "Week overview", exact: true }).click();
    await expect(page.locator(".phone-calendar-agenda-day")).toHaveCount(7);
    await view.click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Calendar views" })).toHaveCount(0);

    await hideNextDevTools(page);
    await captureFullPage(page, testInfo, "taskboard-calendar-mobile.png");
    await assertNoHorizontalPageOverflow(page);
  });

  test("outage navigation opens a prominent current-month calendar view", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto("/calendar?view=outages");
    await assertCalendarShell(page, "Month", "Outages");
    await expect(page.getByRole("button", { name: "Outage View", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open maintenance outages in Calendar" })).toHaveClass(/ui-chip-active/);
    await expect(page.locator(".taskboard-calendar-proof__calendar")).toHaveAttribute("data-calendar-active-view", "month");
  });

  test("calendar and outages keep independent saved views across workspaces and reloads", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await signIn(page, "/calendar");
    await assertCalendarShell(page, "Week");

    await page.getByRole("button", { name: "Day", exact: true }).click();
    await expect(activeCalendarView(page)).toHaveText("Day");
    await page.getByRole("link", { name: "Open Board workspace", exact: true }).click();
    await page.getByRole("link", { name: "Open Calendar workspace", exact: true }).click();
    await assertCalendarShell(page, "Day");

    await page.getByRole("link", { name: "Open maintenance outages in Calendar", exact: true }).click();
    await assertCalendarShell(page, "Month", "Outages");
    await page.getByRole("button", { name: "Week", exact: true }).click();
    await expect(activeCalendarView(page)).toHaveText("Week");
    await page.reload();
    await assertCalendarShell(page, "Week", "Outages");

    await page.goto("/calendar");
    await assertCalendarShell(page, "Day");
  });

  test("calendar controls inherit the Architecture (Linen) shape", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 860 });
    await page.goto("/calendar");
    await assertCalendarShell(page, "Week");

    await expect(page.locator("html")).toHaveAttribute("data-ui-skin", "architecture");
    const architecture = await page.evaluate(() => {
      const boardSwitcher = document.querySelector("[data-testid='board-switcher-shell'] button");
      const activeViewButton = document.querySelector(".calendar-proof-header button.is-active");
      const activeFilterButton = document.querySelector(".calendar-proof-filter-menu summary");
      const calendarBody = document.querySelector(
        ".taskboard-calendar-proof__calendar .fc-scrollgrid",
      );
      const read = (element: Element | null) => {
        if (!element) {
          return null;
        }

        const style = getComputedStyle(element);
        return {
          background: style.backgroundColor,
          borderRadius: style.borderRadius,
          boxShadow: style.boxShadow,
        };
      };

      return {
        activeFilterButton: read(activeFilterButton),
        activeViewButton: read(activeViewButton),
        boardSwitcher: read(boardSwitcher),
        calendarBody: read(calendarBody),
      };
    });
    expect(architecture.boardSwitcher?.borderRadius).toBe("3px");
    expect(architecture.activeViewButton?.borderRadius).toBe("3px");
    expect(architecture.activeFilterButton?.borderRadius).toBe("3px");
    expect(architecture.calendarBody?.borderRadius).toBe("3px");
  });
});

const visualRiskSelector = [
  ".taskboard-agenda-badge",
  ".taskboard-label-chip",
  ".taskboard-status-badge",
  ".taskboard-status-chip",
  ".ui-chip-button",
  ".ui-button",
  "button",
  "[class*='rounded-full']",
].join(",");

async function signIn(page: Page, nextPath = "/") {
  const isSignedIn = await trySignIn(page, nextPath);
  expect(isSignedIn, "password-mode visual sign-in should succeed").toBe(true);
}

async function trySignIn(page: Page, nextPath = "/") {
  await page.addInitScript(() => {
    if (!window.localStorage.getItem("taskboard-ui-settings")) {
      window.localStorage.setItem(
        "taskboard-ui-settings",
        JSON.stringify({
          theme: "light",
          themeVariant: "neutral",
          uiSkin: "architecture",
          density: "standard",
          fontScale: "normal",
          cardDetailLevel: "minimal",
          sidebarWidth: "normal",
          bucketWidthMode: "balanced",
          backgroundStyle: "minimal",
          surfaceStyle: "normal",
          boardCollapsePreference: "collapsed",
          boardCollapsePreferenceInitialized: false,
          headerPinned: true,
        }),
      );
    }
  });

  await page.goto(`/login?next=${encodeURIComponent(nextPath)}`);
  await page.getByLabel("Password", { exact: true }).fill(visualTestPassword);
  await page.getByRole("button", { name: "Sign in" }).click();

  const result = await Promise.race([
    page.waitForURL(nextPath, { timeout: 10_000 }).then(() => "signed-in" as const).catch(() => null),
    page
      .getByText("Unable to sign in.")
      .waitFor({ state: "visible", timeout: 10_000 })
      .then(() => "rejected" as const)
      .catch(() => null),
  ]);

  return result === "signed-in";
}

// The switcher's accessible name carries the current board ("Board: <title>").
function boardSwitcherButton(page: Page) {
  return page.getByTestId("board-header").getByRole("button", { name: /^Board: / });
}

function activeCalendarView(page: Page) {
  return page.locator(".calendar-proof-header__views button[aria-pressed='true']");
}

function monitorUnexpectedClientErrors(page: Page) {
  const messages: string[] = [];

  page.on("pageerror", (error) => {
    messages.push(`pageerror: ${error.message}`);
  });

  page.on("console", (message) => {
    const type = message.type();

    if (type !== "error" && type !== "warning") {
      return;
    }

    const text = message.text();
    const isKnownLocalDatabaseFallback =
      /Failed to load (preferred board|board) from database, falling back/.test(text) ||
      /Failed to load imported calendar source events\./.test(text) ||
      /Failed to load native calendar entries\./.test(text);

    if (isKnownLocalDatabaseFallback) {
      return;
    }

    const isHydrationWarning =
      /hydration|Minified React error #418|server[- ]rendered HTML|DndDescribedBy|Text content did not match/i.test(
        text,
      );

    if (type === "warning" && !isHydrationWarning) {
      return;
    }

    messages.push(`${type}: ${text}`);
  });

  return {
    expectNoUnexpectedErrors() {
      expect(messages, "browser flows should not emit client errors or hydration warnings").toEqual([]);
    },
  };
}

async function assertNoClientErrorBoundary(page: Page) {
  await expect(page.getByText(/Application error|client-side exception/i)).toHaveCount(0);
}

async function assertCalendarShell(
  page: Page,
  expectedView: "Month" | "Week" | "Day",
  expectedFilter: "All" | "Outages" = "All",
) {
  await expect(page.getByTestId("taskboard-shell")).toBeVisible();
  await expect(page.getByTestId("calendar-stage")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Board workspace", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Agenda workspace", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Focus workspace", exact: true })).toBeVisible();
  await expect(page.getByTestId("calendar-inline-toolbar").locator(".calendar-proof-header")).toBeVisible();
  await expect(page.getByRole("group", { name: "Filters" })).toBeVisible();
  await expect(calendarFilterMenuButton(page)).toContainText(new RegExp(`${expectedFilter}\\s+\\d+`));

  for (const view of ["Month", "Week", "Day"] as const) {
    await expect(page.getByRole("button", { name: view, exact: true })).toBeVisible();
  }
  await expect(page.getByRole("button", { name: "Agenda", exact: true })).toHaveCount(0);

  await expect(activeCalendarView(page)).toHaveText(expectedView);
}

function calendarFilterMenuButton(page: Page) {
  return page.locator(".calendar-proof-filter-menu summary");
}

async function openCalendarFilterMenu(page: Page) {
  const menu = page.locator(".calendar-proof-filter-menu");
  if ((await menu.getAttribute("open")) === null) {
    await calendarFilterMenuButton(page).click();
  }
}

async function closeCalendarFilterMenu(page: Page) {
  const menu = page.locator(".calendar-proof-filter-menu");
  if ((await menu.getAttribute("open")) !== null) {
    await calendarFilterMenuButton(page).click();
  }
}

async function selectCalendarEventFilter(page: Page, ariaName: string) {
  await openCalendarFilterMenu(page);
  await page.getByRole("button", { name: ariaName, exact: true }).click();
}

async function openFirstTask(page: Page) {
  const taskCard = page
    .getByTestId("task-card")
    .filter({ hasText: "Weekly review and reprioritize the board" });
  const taskId = await taskCard.getAttribute("data-task-id");
  expect(taskId, "seeded scheduled task should expose its task id").not.toBeNull();
  const phoneCalendar = page.getByRole("navigation", { name: "Phone navigation" }).getByRole("link", { name: "Calendar", exact: true });
  const calendarHref = await (await phoneCalendar.isVisible()
    ? phoneCalendar
    : page.getByRole("link", { name: "Open Calendar workspace", exact: true })).getAttribute("href");
  const boardId = new URL(calendarHref ?? "/calendar", page.url()).searchParams.get("boardId");
  expect(boardId, "active board link should expose its board id").not.toBeNull();
  await page.goto(`/?boardId=${encodeURIComponent(boardId ?? "")}&taskId=${encodeURIComponent(taskId ?? "")}`);
  await page.getByTestId("task-editor-sidebar").waitFor();
  await page.getByTestId("task-inspector-header").waitFor();
}

async function openExpandedWorkspace(page: Page) {
  await openFirstTask(page);
  const isCompact = await page.evaluate(() => window.innerWidth < 1024);
  if (isCompact) {
    const workspaceButtons = page.getByTestId("task-inspector-open-workspace");
    for (let index = 0; index < await workspaceButtons.count(); index += 1) {
      const workspaceButton = workspaceButtons.nth(index);
      if (await workspaceButton.isVisible()) {
        await workspaceButton.click();
        break;
      }
    }
  } else {
    await page
      .getByTestId("task-inspector-header-controls")
      .getByRole("button", { name: "Expand detail panel" })
      .click();
  }
  await page.getByTestId("task-editor-expanded").waitFor();
  await page.getByTestId("task-overview-section").waitFor();
}

async function applyUiSettings(
  page: Page,
  overrides: Partial<{ sidebarWidth: string; fontScale: string; density: string; uiSkin: string }>,
) {
  await page.evaluate((settingsOverrides) => {
    const key = "taskboard-ui-settings";
    const current = JSON.parse(window.localStorage.getItem(key) || "{}");
    window.localStorage.setItem(key, JSON.stringify({ ...current, ...settingsOverrides }));
    window.dispatchEvent(new Event("taskboard-ui-settings-change"));
  }, overrides);
}

async function assertInspectorLayout(page: Page) {
  await assertNoSidebarOverflow(page);
  await assertInspectorHeaderFits(page);
  await assertInspectorBodyFits(page);
}

async function assertNoHorizontalPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => {
    const root = document.documentElement;
    return Math.ceil(root.scrollWidth - root.clientWidth);
  });
  expect(overflow, "page should not create horizontal overflow").toBeLessThanOrEqual(1);
}

async function assertExpandedTaskTargets(page: Page, destination: string) {
  const minimum = (await page.evaluate(() => window.matchMedia("(pointer: coarse)").matches)) ? 44 : 24;
  const undersizedTargets = await page.getByTestId("task-editor-expanded").evaluate((editor, min) => {
    const isVisible = (element: HTMLElement) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 2 && rect.height > 2;
    };
    const isDisabled = (element: HTMLElement) =>
      element instanceof HTMLButtonElement ||
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
        ? element.disabled
        : element.getAttribute("aria-disabled") === "true";
    const describe = (element: HTMLElement) => {
      const rect = element.getBoundingClientRect();
      return {
        name: (element.getAttribute("aria-label") || element.innerText || element.tagName)
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 80),
        tagName: element.tagName,
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };

    const targets = Array.from(
      editor.querySelectorAll<HTMLElement>("button, a[href], [role='button'], input, select, textarea, label"),
    );
    const undersized = targets.filter((element) => {
      if (!isVisible(element) || isDisabled(element)) {
        return false;
      }

      if (element instanceof HTMLLabelElement) {
        const labelledControl = element.control ?? element.querySelector<HTMLInputElement>("input, select, textarea");
        return Boolean(
          labelledControl &&
            (labelledControl instanceof HTMLInputElement &&
              ["file", "checkbox", "radio"].includes(labelledControl.type)) &&
            (() => {
              const rect = element.getBoundingClientRect();
              return rect.width < min || rect.height < min;
            })(),
        );
      }

      if (element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio")) {
        const labelProvidesTarget = Array.from(element.labels ?? []).some((label) => {
          const labelElement = label as HTMLElement;
          const rect = labelElement.getBoundingClientRect();
          return isVisible(labelElement) && rect.width >= min && rect.height >= min;
        });
        return !labelProvidesTarget;
      }

      const rect = element.getBoundingClientRect();
      return rect.width < min || rect.height < min;
    });

    return undersized.map(describe);
  }, minimum);

  expect(undersizedTargets, `${destination} destination controls should be at least ${minimum}px`).toEqual([]);
}

async function assertCalendarEventCardsReadable(page: Page) {
  const eventCard = await page.locator(".calendar-proof-event").evaluateAll((elements) => {
    const visibleElement = elements.find((element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    });

    if (!visibleElement) {
      return null;
    }

    const style = window.getComputedStyle(visibleElement);
    const rect = visibleElement.getBoundingClientRect();

    return {
      backgroundColor: style.backgroundColor,
      color: style.color,
      height: Math.round(rect.height),
      hasReadableSurface:
        style.backgroundColor !== "rgba(0, 0, 0, 0)" &&
        style.backgroundColor !== "transparent",
    };
  });

  expect(eventCard, "calendar should render at least one visible custom event card").not.toBeNull();
  if (!eventCard) {
    throw new Error("calendar should render at least one visible custom event card");
  }
  expect(eventCard.hasReadableSurface, "calendar event cards should have a readable surface").toBe(true);
  expect(eventCard.color, "calendar event text should use the foreground token").not.toBe("rgb(180, 83, 9)");
  expect(eventCard.height, "calendar event cards should keep enough vertical room for time and title").toBeGreaterThanOrEqual(28);
}

async function assertNoSidebarOverflow(page: Page) {
  const overflow = await page.getByTestId("task-editor-sidebar").evaluate((element) => ({
    width: Math.ceil(element.scrollWidth - element.clientWidth),
    height: Math.ceil(element.scrollHeight - element.clientHeight),
  }));

  expect(overflow.width, "task inspector should not create horizontal overflow").toBeLessThanOrEqual(1);
  expect(overflow.height, "task inspector may scroll vertically but should not clip its own scroll height").toBeGreaterThanOrEqual(0);
}

async function assertInspectorHeaderFits(page: Page) {
  const layout = await page.evaluate(() => {
    const sidebar = document.querySelector("[data-testid='task-editor-sidebar']");
    const header = document.querySelector("[data-testid='task-inspector-header']");
    const controls = document.querySelector("[data-testid='task-inspector-header-controls']");
    const autosave = document.querySelector("[data-testid='task-inspector-autosave']");
    const title = document.querySelector("[data-testid='task-inspector-title']");
    const closeButton = controls?.querySelector("[aria-label='Close task inspector']");
    const quickActions = document.querySelector("[data-testid='task-inspector-quick-actions']");
    const quickActionButtons = Array.from(quickActions?.querySelectorAll("button") ?? []);
    const statusButtons = Array.from(quickActions?.querySelectorAll("[data-testid='task-inspector-status-button']") ?? []);
    // Snooze is a scheduling action, kept out of the status box (owner decision 2026-10-14).
    const snoozeButton = sidebar?.querySelector("[data-testid='task-snooze-button']") ?? null;

    if (!sidebar || !header || !controls || !closeButton || !title || !quickActions) {
      return { missing: true };
    }

    const sidebarRect = sidebar.getBoundingClientRect();
    const controlsRect = controls.getBoundingClientRect();
    const closeRect = closeButton.getBoundingClientRect();
    const autosaveRect = autosave?.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const quickActionsRect = quickActions.getBoundingClientRect();
    const statusButtonRects = statusButtons.map((button) => button.getBoundingClientRect());
    const snoozeRect = snoozeButton?.getBoundingClientRect();
    const statusButtonLabels = statusButtons.map((button) => button.textContent?.trim() ?? "");
    const activeStatusButtons = statusButtons.filter((button) => button.getAttribute("aria-pressed") === "true");

    return {
      missing: false,
      controlsInside:
        controlsRect.left >= sidebarRect.left &&
        controlsRect.right <= sidebarRect.right &&
        controlsRect.top >= sidebarRect.top &&
        controlsRect.bottom <= sidebarRect.bottom,
      titleHasRoom: titleRect.width >= Math.min(160, sidebarRect.width - 36),
      autosaveClearOfControls: autosaveRect
        ? !(
            autosaveRect.left < controlsRect.right &&
            autosaveRect.right > controlsRect.left &&
            autosaveRect.top < controlsRect.bottom &&
            autosaveRect.bottom > controlsRect.top
          )
        : true,
      closeIsRightmost:
        closeRect.right >= controlsRect.right - 1 &&
        closeRect.right <= sidebarRect.right,
      quickActionIconCount: quickActions.querySelectorAll("svg").length,
      quickActionButtonCount: quickActionButtons.length,
      statusButtonCount: statusButtons.length,
      statusButtonLabels,
      hasSingleHighlightedStatus:
        activeStatusButtons.length === 1 &&
        activeStatusButtons[0]?.className.toString().includes("ring-"),
      statusRowsCorrect:
        statusButtonRects.length === 4 &&
        Math.abs(statusButtonRects[0].top - statusButtonRects[1].top) <= 1 &&
        Math.abs(statusButtonRects[2].top - statusButtonRects[3].top) <= 1 &&
        statusButtonRects[2].top > statusButtonRects[0].top,
      snoozeOutsideStatusBox:
        Boolean(snoozeButton) &&
        !quickActions.contains(snoozeButton) &&
        (snoozeRect?.top ?? 0) >= quickActionsRect.bottom,
      quickActionButtonsFit: quickActionButtons.every((button) => {
        const htmlButton = button as HTMLElement;
        return htmlButton.scrollWidth - htmlButton.clientWidth <= 1 && htmlButton.scrollHeight - htmlButton.clientHeight <= 1;
      }),
    };
  });

  expect(layout.missing, "task inspector layout hooks should be present").toBe(false);
  expect(layout.controlsInside, "header controls should remain inside the sidebar").toBe(true);
  expect(layout.titleHasRoom, "task title should not be confined to a narrow column").toBe(true);
  expect(layout.autosaveClearOfControls, "autosave status should not overlap header controls").toBe(true);
  expect(layout.closeIsRightmost, "close button should sit at the far right of the header controls").toBe(true);
  expect(layout.quickActionIconCount, "compact quick actions should be text-only").toBe(0);
  expect(layout.quickActionButtonCount, "status box should hold only the four status buttons").toBe(4);
  expect(layout.statusButtonCount, "quick action area should include four status buttons").toBe(4);
  expect(layout.statusButtonLabels, "status buttons should be ordered Active, Todo, Waiting, Done").toEqual(["Active", "Todo", "Waiting", "Done"]);
  expect(layout.hasSingleHighlightedStatus, "current status button should have a visible status highlight").toBe(true);
  expect(layout.statusRowsCorrect, "status buttons should render as Active/Todo then Waiting/Done").toBe(true);
  expect(layout.snoozeOutsideStatusBox, "Snooze should sit below and outside the status box").toBe(true);
  expect(layout.quickActionButtonsFit, "quick action button text should fit").toBe(true);
}

async function assertInspectorBodyFits(page: Page) {
  const layout = await page.evaluate(() => {
    const sidebar = document.querySelector("[data-testid='task-editor-sidebar']");
    const quickEdit = sidebar?.querySelector("[data-testid='task-inspector-quick-edit']");
    const title = sidebar?.querySelector("[data-testid='task-inspector-title']");
    const contentColumn = quickEdit?.parentElement;
    const workspaceButtons = Array.from(
      sidebar?.querySelectorAll("[data-testid='task-inspector-open-workspace']") ?? [],
    );
    const workspaceButton = workspaceButtons.at(-1);
    const quickActions = sidebar?.querySelector("[data-testid='task-inspector-quick-actions']");
    const scheduleInputs = Array.from(
      sidebar?.querySelectorAll(
        'input[aria-label="Start date"], input[aria-label="Start time"], input[aria-label="End date"], input[aria-label="End time"]',
      ) ?? [],
    );
    const quickEditSelects = Array.from(quickEdit?.querySelectorAll("select") ?? []);
    const checklistPreview = sidebar?.querySelector("[data-testid='task-inspector-checklist-preview']");
    const subtaskPreview = sidebar?.querySelector("[data-testid='task-inspector-subtask-preview']");

    if (!sidebar || !quickEdit || !title || !contentColumn || !workspaceButton || !quickActions) {
      return { missing: true };
    }

    const contentRect = contentColumn.getBoundingClientRect();
    const quickEditRect = quickEdit.getBoundingClientRect();
    const quickActionsRect = quickActions.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const workspaceButtonRect = workspaceButton.getBoundingClientRect();
    const actionFooter = workspaceButton.parentElement;
    const actionFooterRect = actionFooter?.getBoundingClientRect();
    const actionFooterStyle = actionFooter ? getComputedStyle(actionFooter) : null;
    const sidebarRect = sidebar.getBoundingClientRect();
    // The footer spans the sidebar's inner box (border and reserved scrollbar
    // gutter excluded) and the button fills the footer's padded content box.
    const sidebarInnerLeft = sidebarRect.left + sidebar.clientLeft;
    const sidebarInnerRight = sidebarInnerLeft + sidebar.clientWidth;

    return {
      missing: false,
      stableScrollbarGutter: getComputedStyle(sidebar).scrollbarGutter.includes("stable"),
      quickEditUsesWidth: quickEditRect.width >= contentRect.width - 2,
      quickEditAlignsWithTitle:
        Math.abs(quickEditRect.left - titleRect.left) <= 2 &&
        titleRect.right >= quickEditRect.right &&
        titleRect.right - quickEditRect.right <= 20,
      quickActionsUseWidth:
        Math.abs(quickActionsRect.left - quickEditRect.left) <= 1 &&
        Math.abs(quickActionsRect.right - quickEditRect.right) <= 1,
      selectsUseWidth: quickEditSelects.every((select) => {
        const selectRect = select.getBoundingClientRect();
        return (
          Math.abs(selectRect.left - quickEditRect.left) <= 1 &&
          Math.abs(selectRect.right - quickEditRect.right) <= 1
        );
      }),
      sidebarSelectCount: quickEditSelects.length,
      hasSidebarStatusSelect: quickEditSelects.some((select) => {
        const label = select.closest("label");
        return label?.textContent?.trim().startsWith("Status") ?? false;
      }),
      workspaceButtonDocked:
        Boolean(actionFooterRect) &&
        getComputedStyle(actionFooter!).flexShrink === "0" &&
        workspaceButtonRect.top >= actionFooterRect!.top &&
        workspaceButtonRect.bottom <= actionFooterRect!.bottom &&
        Math.abs(actionFooterRect!.left - sidebarInnerLeft) <= 1 &&
        Math.abs(actionFooterRect!.right - sidebarInnerRight) <= 1 &&
        Math.abs(
          workspaceButtonRect.left -
            (actionFooterRect!.left + Number.parseFloat(actionFooterStyle!.paddingLeft)),
        ) <= 2 &&
        Math.abs(
          actionFooterRect!.right -
            Number.parseFloat(actionFooterStyle!.paddingRight) -
            workspaceButtonRect.right,
        ) <= 2 &&
        workspaceButtonRect.left - sidebarRect.left <= 20 &&
        Math.abs(sidebarRect.bottom - actionFooterRect!.bottom) <= 2,
      scheduleInputCount: scheduleInputs.length,
      scheduleInputsFit: scheduleInputs.every((input) => {
        const element = input as HTMLInputElement;
        return element.scrollWidth - element.clientWidth <= 1 && element.getBoundingClientRect().width >= 96;
      }),
      hasChecklistPreview: Boolean(checklistPreview),
      hasSubtaskPreview: Boolean(subtaskPreview),
    };
  });

  expect(layout.missing, "task inspector body layout hooks should be present").toBe(false);
  expect(layout.stableScrollbarGutter, "sidebar should reserve stable scrollbar space").toBe(true);
  expect(layout.quickEditUsesWidth, "quick edit body should use the sidebar width").toBe(true);
  expect(layout.quickEditAlignsWithTitle, "sidebar body should use the same content width as the title").toBe(true);
  expect(layout.quickActionsUseWidth, "quick actions should span the sidebar body width").toBe(true);
  expect(layout.selectsUseWidth, "sidebar selects should span the sidebar body width").toBe(true);
  expect(layout.sidebarSelectCount, "sidebar should only have the Bucket select").toBe(1);
  expect(layout.hasSidebarStatusSelect, "sidebar Status select should be removed").toBe(false);
  expect(layout.workspaceButtonDocked, "Open Task Workspace should stay docked in the sidebar footer").toBe(true);
  expect(layout.scheduleInputCount, "schedule controls should default to collapsed").toBe(0);
  const sidebar = page.getByTestId("task-editor-sidebar");
  const scheduleToggle = sidebar.getByRole("button", { name: /^Start/ }).first();
  await expect(scheduleToggle).toHaveAttribute("aria-expanded", "false");
  await scheduleToggle.click();
  await expect(scheduleToggle).toHaveAttribute("aria-expanded", "true");
  const expandedScheduleInputs = sidebar.locator(
    'input[aria-label="Start date"], input[aria-label="Start time"], input[aria-label="End date"], input[aria-label="End time"]',
  );
  await expect(expandedScheduleInputs).toHaveCount(4);
  const expandedScheduleFits = await expandedScheduleInputs.evaluateAll((inputs) =>
    inputs.every((input) => {
      const element = input as HTMLInputElement;
      return element.scrollWidth - element.clientWidth <= 1 && element.getBoundingClientRect().width >= 96;
    }),
  );
  expect(expandedScheduleFits, "expanded schedule date/time controls should not clip").toBe(true);
  await scheduleToggle.click();
  expect(layout.hasChecklistPreview, "checklist preview should render for populated checklist").toBe(true);
  expect(layout.hasSubtaskPreview, "subtask preview should render for populated direct subtasks").toBe(true);
}

// Notes fold under the work at width and have their own tab when narrow.
async function showWorkingNotes(page: Page) {
  const destinations = page.getByRole("navigation", { name: "Task workspace sections" });
  if (await destinations.isVisible()) {
    await destinations.getByRole("button", { name: /^Notes/ }).click();
    return;
  }
  const toggle = page.getByTestId("task-working-notes-toggle");
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
}

async function assertWorkFirstWorkspaceLayout(page: Page, projectName: string) {
  const isDesktop = projectName.includes("desktop");
  const layout = await page.evaluate(() => {
    const expanded = document.querySelector("[data-testid='task-editor-expanded']");
    const header = document.querySelector(".task-workspace-header");
    const workspace = document.querySelector("[data-testid='task-workspace-layout']");
    const headerRow = document.querySelector("[data-testid='task-overview-section']");
    const title = document.querySelector("[data-testid='task-overview-title-field']");
    const status = document.querySelector("[data-testid='task-overview-status-button-row']");
    const statusButtons = Array.from(status?.querySelectorAll("[data-testid='task-overview-status-button']") ?? []);
    const nextAction = document.querySelector("[data-testid='task-overview-next-action-input']");
    const primaryNote = document.querySelector("[data-testid='task-primary-note-section']");
    const work = document.querySelector("[data-testid='task-work-breakdown']");
    const workspacePrimary = document.querySelector("[data-testid='task-workspace-primary']");
    const supporting = document.querySelector("[data-testid='task-workspace-supporting']");

    if (!expanded || !header || !workspace || !headerRow || !title || !status || !primaryNote || !work || !workspacePrimary || !supporting) {
      return { missing: true };
    }

    const expandedRect = expanded.getBoundingClientRect();
    const headerRect = header.getBoundingClientRect();
    const titleRect = title.getBoundingClientRect();
    const primaryNoteRect = primaryNote.getBoundingClientRect();
    const workRect = work.getBoundingClientRect();
    const primaryNoteTextarea = primaryNote.querySelector("textarea");
    const expandedStyle = getComputedStyle(expanded);
    const backgroundChannels = expandedStyle.backgroundColor.match(/[\d.]+/g) ?? [];
    const modernAlpha = expandedStyle.backgroundColor.match(/\/\s*([\d.]+)\s*\)$/)?.[1];
    const expandedBackgroundAlpha = modernAlpha
      ? Number(modernAlpha)
      : expandedStyle.backgroundColor.startsWith("rgba") && backgroundChannels.length >= 4
        ? Number(backgroundChannels[3])
        : 1;

    return {
      missing: false,
      expandedBackgroundAlpha,
      nextActionHidden: nextAction === null,
      headerShare: headerRect.height / expandedRect.height,
      titleInHeader: titleRect.top >= headerRect.top - 1 && titleRect.bottom <= headerRect.bottom + 1,
      descriptionBeforeWork: primaryNoteRect.bottom <= workRect.top + 1,
      primaryNoteResize: primaryNoteTextarea ? getComputedStyle(primaryNoteTextarea).resize : "vertical",
      primaryNoteOverflowX: primaryNoteTextarea ? getComputedStyle(primaryNoteTextarea).overflowX : "hidden",
      statusButtonCount: statusButtons.length,
      workToDetailsWidthRatio: workspacePrimary.getBoundingClientRect().width / Math.max(1, supporting.getBoundingClientRect().width),
      expandedOverflowX: Math.ceil(expanded.scrollWidth - expanded.clientWidth),
      workspacePrimaryOverflowX: Math.ceil(workspacePrimary.scrollWidth - workspacePrimary.clientWidth),
      coarsePointer: window.matchMedia("(pointer: coarse)").matches,
    };
  });

  const destinations = page.getByRole("navigation", { name: "Task workspace sections" });

  await expect(page.getByTestId("task-workspace-layout")).toBeVisible();
  await expect(page.getByTestId("task-work-breakdown")).toBeVisible();
  expect(layout.missing, "workspace header and work hooks should be present").toBe(false);
  expect(layout.expandedBackgroundAlpha, "expanded workspace background should be opaque").toBe(1);
  expect(layout.nextActionHidden, "Next Action should not be visible in the workspace").toBe(true);
  expect(layout.headerShare, "the header should stay a small share of the workspace").toBeLessThanOrEqual(0.25);
  expect(layout.titleInHeader, "the title should edit in place in the header").toBe(true);
  expect(layout.descriptionBeforeWork, "the description should sit before the subtasks").toBe(true);
  expect(layout.primaryNoteResize, "the description should be vertically resizable").toBe("vertical");
  expect(layout.primaryNoteOverflowX, "the description should prevent horizontal overflow").toBe("hidden");
  expect(layout.statusButtonCount, "the header should render the status buttons").toBeGreaterThanOrEqual(4);
  expect(layout.expandedOverflowX, "expanded workspace should not create horizontal overflow").toBeLessThanOrEqual(1);
  expect(layout.workspacePrimaryOverflowX, "the work column should not clip content").toBeLessThanOrEqual(1);

  if (isDesktop) {
    await expect(destinations).toBeHidden();
    expect(layout.workToDetailsWidthRatio, "the work should be much wider than the details column").toBeGreaterThanOrEqual(2.1);
  } else {
    await expect(destinations).toBeVisible();
    await expect(destinations.getByRole("button", { name: "Work", exact: true })).toHaveAttribute("aria-pressed", "true");
    const minimum = layout.coarsePointer ? 44 : 24;
    const tabSizes = await destinations.getByRole("button").evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        return { width: rect.width, height: rect.height };
      }),
    );
    for (const size of tabSizes) {
      expect(size.height, `workspace tabs should be at least ${minimum}px tall`).toBeGreaterThanOrEqual(minimum);
      expect(size.width, `workspace tabs should be at least ${minimum}px wide`).toBeGreaterThanOrEqual(minimum);
    }
  }
}

async function assertVisibleElementsFit(page: Page, selector: string) {
  const rawFailures = await page.locator(selector).evaluateAll((elements) =>
    elements
      .filter((element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.visibility !== "hidden" &&
          style.display !== "none" &&
          rect.width > 2 &&
          rect.height > 2
        );
      })
      .map((element) => {
        const htmlElement = element as HTMLElement;
        const rect = htmlElement.getBoundingClientRect();
        const widthOverflow = Math.ceil(htmlElement.scrollWidth - htmlElement.clientWidth);
        const heightOverflow = Math.ceil(htmlElement.scrollHeight - htmlElement.clientHeight);
        return {
          text: (htmlElement.innerText || htmlElement.getAttribute("aria-label") || htmlElement.tagName)
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 100),
          className: htmlElement.className.toString(),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          widthOverflow,
          heightOverflow,
        };
      })
      .filter((item) => item.widthOverflow > 1 || item.heightOverflow > 1),
  );
  const failures = rawFailures.filter((item) => !isFrameworkOverlayText(item.text));

  expect(failures, "visible controls/chips should not clip their content").toEqual([]);
}

async function assertBasicAccessibility(page: Page) {
  const builder = new AxeBuilder({ page }).disableRules(["color-contrast"]);
  const results = await builder.analyze();
  expect(results.violations).toEqual([]);
}

async function captureFullPage(page: Page, testInfo: TestInfo, name: string) {
  const path = testInfo.outputPath(name);
  await page.screenshot({ path, fullPage: true });
  await testInfo.attach(name, { path, contentType: "image/png" });
}

async function hideNextDevTools(page: Page) {
  await page.addStyleTag({
    content: `
      nextjs-portal,
      [aria-label="Open Next.js Dev Tools"],
      [data-nextjs-toast],
      [data-nextjs-dialog-overlay] {
        display: none !important;
      }
    `,
  });
}

function isFrameworkOverlayText(text: string) {
  return text === "Open Next.js Dev Tools" || /^\d+\s+\d+\s+Issue/.test(text);
}
