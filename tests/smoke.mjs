import { existsSync, readFileSync } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright-core";

const baseUrl = process.env.TASKBOARD_BASE_URL ?? "http://localhost:3000";
const artifactDir = path.resolve("test-artifacts", "visual-smoke");
const calendarFixturePath = path.resolve("tests", "fixtures", "calendar-import-smoke.ics");
const chromePath =
  process.env.PLAYWRIGHT_CHROME_PATH ??
  [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  ].find((candidate) => existsSync(candidate));

const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "ipad", width: 900, height: 1100 },
  { name: "phone", width: 390, height: 900 },
];
const themes = [
  { name: "light", value: "light", colorScheme: "light" },
  { name: "dark", value: "dark", colorScheme: "dark" },
  { name: "system", value: "system", colorScheme: "dark" },
];
const defaultUiSettings = {
  theme: "light",
  density: "standard",
  fontScale: "normal",
  cardDetailLevel: "minimal",
  sidebarWidth: "normal",
  bucketWidthMode: "balanced",
  backgroundStyle: "atmospheric",
  surfaceStyle: "normal",
};

if (!chromePath) {
  throw new Error("Chrome or Edge was not found. Set PLAYWRIGHT_CHROME_PATH to a Chromium executable.");
}

const env = readEnvFile(".env");
const password = process.env.TASKBOARD_APP_PASSWORD ?? env.TASKBOARD_APP_PASSWORD;

if (!password) {
  throw new Error("TASKBOARD_APP_PASSWORD is required in the environment or .env for smoke tests.");
}

await assertServerReachable();
await rm(artifactDir, { force: true, recursive: true });
await mkdir(artifactDir, { recursive: true });

const browser = await chromium.launch({
  executablePath: chromePath,
  headless: true,
});

try {
  for (const theme of themes) {
    for (const viewport of viewports) {
      const context = await browser.newContext({
        colorScheme: theme.colorScheme,
        viewport: { width: viewport.width, height: viewport.height },
      });

      try {
        const page = await context.newPage();
        await openBoard(page, theme.value);
        await assertCorePlannerVisibility(page);
        await assertCoreTypography(page);
        await saveScreenshot(page, `${theme.name}-${viewport.name}-board.png`);

        if (theme.name === "light" && viewport.name === "desktop") {
          await exerciseMutationAndViewFlows(page);
        }

        if (theme.name === "dark" && viewport.name === "desktop") {
          await exerciseExpandedEditor(page);
          await saveScreenshot(page, `${theme.name}-${viewport.name}-expanded-editor.png`);
          await assertDarkThemeSurfaces(page);
        }
      } finally {
        await context.close();
      }
    }
  }
} finally {
  await browser.close();
}

console.log(`Smoke tests passed. Visual screenshots: ${artifactDir}`);

async function openBoard(page, theme) {
  await page.addInitScript(
    ({ settings }) => {
      window.localStorage.setItem("taskboard-ui-settings", JSON.stringify(settings));
    },
    {
      settings: {
        ...defaultUiSettings,
        theme,
      },
    },
  );

  await page.goto(`${baseUrl}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await waitForBoardReady(page);
  await cleanupSmokeViews(page);
}

async function exerciseMutationAndViewFlows(page) {
  const smokeBucketName = `Smoke bucket ${Date.now()}`;
  await cleanupBucketsByPrefix(page, "Smoke bucket ");

  const header = page.getByTestId("board-header");
  await header.getByRole("button", { name: "Add bucket", exact: true }).click();
  await header.getByPlaceholder("New bucket").fill(smokeBucketName);
  await expectFontSize(header.getByPlaceholder("New bucket"), "11px", "New bucket input");
  await header.getByRole("button", { name: "Add", exact: true }).click();
  await page.getByRole("button", { name: smokeBucketName, exact: true }).waitFor();
  await cleanupBucketsByPrefix(page, "Smoke bucket ");
  await page.reload({ waitUntil: "networkidle" });
  await page.getByTestId("board-header").waitFor();
  await exerciseHeaderUtilityActions(page);

  await exerciseIcsImport(page);

  const addTaskButton = page.locator(".taskboard-add-button").first();
  await expectFontSize(addTaskButton, "10px", "Add task button");
  await addTaskButton.click();

  const addTaskInput = page.getByPlaceholder("Task title").first();
  await expectFontSize(addTaskInput, "10px", "Add task input");
  await expectFontSize(page.getByRole("button", { name: "Add" }).last(), "10px", "Inline Add button");
  await expectFontSize(page.getByRole("button", { name: "Cancel" }).last(), "10px", "Inline Cancel button");
  await saveScreenshot(page, "light-desktop-add-task-inline.png");
  await page.getByRole("button", { name: "Cancel" }).last().click();

  await openFirstTask(page);
  await expectFontSize(page.getByLabel("Title").first(), "10px", "Task editor title input");
  await saveScreenshot(page, "light-desktop-editor-sidebar.png");

  const smokeViewName = `Smoke view ${Date.now()}`;

  await openSavedViewMenu(page);
  await page.getByRole("button", { name: "Save current view" }).click();
  await page.getByText("View name").waitFor();
  await page.getByLabel("View name").fill(smokeViewName);
  await page.getByRole("button", { name: "Save view" }).last().click();
  await header.getByRole("button", { name: "Saved views" }).waitFor();
  await openSavedViewMenu(page);
  await page.getByRole("button", { name: smokeViewName }).waitFor();
  await closeSavedViewMenu(page);

  await page.getByRole("button", { name: "Agenda", exact: true }).click();
  await page.getByText(/agenda view|No tasks match this agenda view|Weekly review/i).first().waitFor();
  await page.getByText("Smoke ICS planning block").waitFor();
  await expectFontSize(page.locator(".taskboard-section-card").first().locator("p").first(), "12px", "Agenda row title");
  await saveScreenshot(page, "light-desktop-agenda.png");

  await page.getByRole("button", { name: "Focus", exact: true }).last().click();
  await page.getByTestId("task-card").first().waitFor();
  await saveScreenshot(page, "light-desktop-focus.png");

  await page.getByRole("button", { name: "Board", exact: true }).last().click();
  await openSavedViewMenu(page);
  await page.getByRole("button", { name: smokeViewName }).click();
  await openSavedViewMenu(page);
  await page.getByRole("button", { name: "Delete view" }).click();
  await page.getByRole("button", { name: smokeViewName }).waitFor({ state: "detached" });
  await cleanupSmokeViews(page);

  await page.goto(`${baseUrl}/options`, { waitUntil: "networkidle" });
  await page.getByRole("heading", { name: "Options" }).waitFor();
  await page.getByRole("heading", { name: "Board settings" }).waitFor();
  await page.getByRole("link", { name: "Back to previous view" }).click();
  await waitForBoardReady(page);

  await openMoreMenu(page);
  await page.getByRole("button", { name: "Logout" }).click();
  await page.getByRole("heading", { name: /sign in to taskboard/i }).waitFor();
}

async function waitForBoardReady(page) {
  await page.getByTestId("taskboard-shell").waitFor();
  await page.getByTestId("board-header").waitFor();
  await page.getByTestId("board-stage").waitFor();
}

async function openMoreMenu(page) {
  const header = page.getByTestId("board-header");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await page.getByText("Capture", { exact: true }).isVisible().catch(() => false)) {
      return;
    }

    await header.getByRole("button", { name: "Menu", exact: true }).click();
    await page.waitForTimeout(350);
  }

  await page.getByText("Capture", { exact: true }).waitFor();
}

async function exerciseHeaderUtilityActions(page) {
  const header = page.getByTestId("board-header");

  const themeButton = header.getByRole("button", { name: /^(Light|Dark|System)$/ }).first();
  await expect(themeButton).toHaveCount(0);

  const recycleButton = header.getByRole("button", { name: "Recycle Bin", exact: true });
  if (await recycleButton.isEnabled()) {
    await recycleButton.click();
    await page.getByRole("heading", { name: "Recycle Bin", exact: true }).waitFor();
    await page.getByLabel("Close recycle bin").click();
  }

  await openMoreMenu(page);
  const archivesButton = page.getByRole("button", { name: "Archives", exact: true });
  if (await archivesButton.isEnabled()) {
    await archivesButton.click();
    await page.getByRole("heading", { name: "Archives", exact: true }).waitFor();
    await page.getByLabel("Close archives").click();
  }
}

async function openSavedViewMenu(page) {
  const header = page.getByTestId("board-header");

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await page.getByRole("button", { name: "Save current view", exact: true }).isVisible().catch(() => false)) {
      return;
    }

    await header.getByRole("button", { name: "Saved views", exact: true }).click();
    await page.waitForTimeout(350);
  }

  await page.getByRole("button", { name: "Save current view", exact: true }).waitFor();
}

async function closeSavedViewMenu(page) {
  if ((await page.getByRole("button", { name: "Save current view", exact: true }).count()) > 0) {
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Save current view", exact: true }).waitFor({ state: "detached" });
  }
}

async function exerciseIcsImport(page) {
  const header = page.getByTestId("board-header");
  await openMoreMenu(page);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByRole("button", { name: ".ics import", exact: true }).click();
  await page.locator("#ics-import-file").setInputFiles(calendarFixturePath);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByText(/created .* updated .* past skipped .* recurring skipped .* unsupported skipped/i).waitFor();
  await page.getByRole("button", { name: "Calendar Imports", exact: true }).waitFor();
  await page.getByText("Smoke ICS planning block").waitFor();

  await page.getByRole("button", { name: "Close", exact: true }).click();
  await openMoreMenu(page);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByRole("button", { name: ".ics import", exact: true }).click();
  await page.locator("#ics-import-file").setInputFiles(calendarFixturePath);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await page.getByText(/updated/i).waitFor();

  const importedCount = await page.evaluate(async () => {
    const response = await fetch("/api/board");

    if (!response.ok) {
      throw new Error(`Unable to load board after ICS import: ${response.status}`);
    }

    const state = await response.json();
    const buckets = state.board?.buckets ?? [];
    const countTaskTitles = (tasks) =>
      tasks.reduce(
        (count, task) =>
          count +
          (task.title === "Smoke ICS planning block" ? 1 : 0) +
          countTaskTitles(task.subtasks ?? []),
        0,
      );

    return buckets.reduce((count, bucket) => count + countTaskTitles(bucket.tasks ?? []), 0);
  });

  if (importedCount !== 1) {
    throw new Error(`Expected one imported smoke event after reimport, found ${importedCount}.`);
  }

  await saveScreenshot(page, "light-desktop-ics-import.png");
  await page.getByRole("button", { name: "Close", exact: true }).click();
}

async function exerciseExpandedEditor(page) {
  await openFirstTask(page);
  await page.getByLabel("Expand detail panel").click();
  await page.getByTestId("task-editor-expanded").waitFor();
  await expectFontSize(page.getByTestId("task-editor-expanded").locator("input").first(), "10px", "Expanded editor input");
}

async function cleanupSmokeViews(page) {
  await openSavedViewMenu(page);
  const smokeViews = page.locator("button").filter({ hasText: /^Smoke view / });

  for (let count = await smokeViews.count(); count > 0; count = await smokeViews.count()) {
    const view = smokeViews.first();
    const name = (await view.textContent())?.trim();

    if (!name) {
      break;
    }

    await view.click();
    await openSavedViewMenu(page);
    await page.getByRole("button", { name: "Delete view" }).click();
    await page.getByRole("button", { name }).waitFor({ state: "detached" });
  }

  await closeSavedViewMenu(page);
}

async function cleanupBucketsByPrefix(page, prefix) {
  const deletedBucketIds = await page.evaluate(async (bucketPrefix) => {
    const response = await fetch("/api/board");

    if (!response.ok) {
      throw new Error(`Unable to load board for bucket cleanup: ${response.status}`);
    }

    const state = await response.json();
    const board = state.board;

    if (!board?.buckets) {
      return [];
    }

    const matches = board.buckets.filter((bucket) => bucket.title.startsWith(bucketPrefix));

    for (const bucket of matches) {
      const deleteResponse = await fetch(`/api/buckets/${bucket.id}`, {
        method: "DELETE",
      });

      if (!deleteResponse.ok) {
        throw new Error(`Unable to delete smoke bucket ${bucket.id}: ${deleteResponse.status}`);
      }
    }

    return matches.map((bucket) => bucket.id);
  }, prefix);

  return deletedBucketIds;
}

async function openFirstTask(page) {
  const firstTaskCard = page.getByTestId("task-card").first();
  await firstTaskCard.waitFor();
  await firstTaskCard.click();
  await page.getByTestId("task-inspector-quick-edit").waitFor();
}

async function assertCorePlannerVisibility(page) {
  await page.getByTestId("taskboard-shell").waitFor();
  await page.getByTestId("board-header").waitFor();
  await page.getByTestId("board-stage").waitFor();
  await expectHiddenOrDetached(page.getByTestId("task-editor-sidebar"), "Task inspector should start hidden.");
  await page.locator(".taskboard-add-button").first().waitFor();
  const expandAllButton = page.getByRole("button", { name: "Expand all visible buckets" });
  if ((await expandAllButton.count()) === 1) {
    await expandAllButton.click();
  }
  await page.getByTestId("task-card").first().waitFor();
  await openFirstTask(page);
  await page.getByTestId("task-editor-sidebar").waitFor();
  await page.getByRole("button", { name: "Close task inspector" }).click();
  await expectHiddenOrDetached(page.getByTestId("task-editor-sidebar"), "Task inspector should hide after closing.");
}

async function assertCoreTypography(page) {
  await openFirstTask(page);
  const expectations = [
    [page.locator(".taskboard-add-button").first(), "10px", "Add task button"],
    [page.getByTestId("board-header").locator(".ui-chip-button").first(), "11px", "Header chip"],
    [page.getByTestId("task-editor-sidebar").locator(".task-editor-root").first(), "10px", "Task editor base"],
  ];

  for (const [locator, size, label] of expectations) {
    await expectFontSize(locator, size, label);
  }

  await assertNoOversizedOrdinaryControls(page);
}

async function expectHiddenOrDetached(locator, message) {
  const count = await locator.count();

  if (count === 0) {
    return;
  }

  if (await locator.first().isVisible()) {
    throw new Error(message);
  }
}

async function assertNoOversizedOrdinaryControls(page) {
  const offenders = await page.evaluate(() => {
    const allowedHeadingSelectors = [
      "h1",
      "h2",
      ".taskboard-icon-surface",
      "[aria-label='Expand detail panel']",
      "[aria-label='Collapse detail panel']",
    ];
    const ordinarySelectors = [
      "button",
      "input",
      "textarea",
      "select",
      ".taskboard-label-chip",
      ".taskboard-status-chip",
      ".taskboard-status-badge",
      ".taskboard-inline-meta",
      ".taskboard-agenda-badge",
      ".ui-menu-item",
    ].join(",");

    return Array.from(document.querySelectorAll(`.taskboard-shell ${ordinarySelectors}`))
      .filter((element) => {
        if (!(element instanceof HTMLElement)) {
          return false;
        }

        if (allowedHeadingSelectors.some((selector) => element.matches(selector))) {
          return false;
        }

        if (element.matches('[data-testid="task-card"]')) {
          return false;
        }

        if (element.tagName.toLowerCase() === "button") {
          const directText = Array.from(element.childNodes)
            .filter((node) => node.nodeType === Node.TEXT_NODE)
            .map((node) => node.textContent?.trim() ?? "")
            .join("");

          if (!directText) {
            return false;
          }
        }

        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((element) => {
        const fontSize = Number.parseFloat(getComputedStyle(element).fontSize);

        return {
          tag: element.tagName.toLowerCase(),
          text: (element.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 80),
          fontSize,
          className: element.className.toString(),
        };
      })
      .filter((entry) => entry.fontSize > 11.5 && !entry.className.includes("taskboard-add-button"));
  });

  if (offenders.length > 0) {
    throw new Error(`Oversized ordinary controls found: ${JSON.stringify(offenders, null, 2)}`);
  }
}

async function assertDarkThemeSurfaces(page) {
  const issues = await page.evaluate(() => {
    function parseRgb(value) {
      const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);

      if (!match) {
        return null;
      }

      return {
        red: Number(match[1]),
        green: Number(match[2]),
        blue: Number(match[3]),
      };
    }

    const selectors = [
      "[data-testid='board-header']",
      "[data-testid='board-stage']",
      "[data-testid='task-editor-sidebar']",
      ".taskboard-popover",
      ".taskboard-card",
      ".taskboard-section-card",
      ".ui-control",
      ".ui-button-surface",
    ].join(",");

    return Array.from(document.querySelectorAll(selectors))
      .filter((element) => element instanceof HTMLElement)
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .map((element) => {
        const rgb = parseRgb(getComputedStyle(element).backgroundColor);
        const brightness = rgb ? (rgb.red * 299 + rgb.green * 587 + rgb.blue * 114) / 1000 : 0;

        return {
          tag: element.tagName.toLowerCase(),
          className: element.className.toString(),
          brightness,
        };
      })
      .filter((entry) => entry.brightness > 120);
  });

  if (issues.length > 0) {
    throw new Error(`Light surfaces found in dark theme: ${JSON.stringify(issues, null, 2)}`);
  }
}

async function saveScreenshot(page, name) {
  await page.screenshot({
    fullPage: true,
    path: path.join(artifactDir, name),
  });
}

function readEnvFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  return Object.fromEntries(
    readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1)];
      }),
  );
}

async function assertServerReachable() {
  try {
    await fetch(`${baseUrl}/login`);
  } catch (error) {
    throw new Error(
      `Taskboard is not reachable at ${baseUrl}. Start Docker or the dev server before running smoke tests.`,
      { cause: error },
    );
  }
}

async function expectFontSize(locator, expected, label) {
  await locator.waitFor();
  let actual = "";
  const expectedPx = Number.parseFloat(expected);

  for (let attempt = 0; attempt < 20; attempt += 1) {
    actual = await locator.evaluate((element) => getComputedStyle(element).fontSize);
    const actualPx = Number.parseFloat(actual);

    if (Number.isFinite(actualPx) && Math.abs(actualPx - expectedPx) <= 0.5) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  throw new Error(`${label} expected font-size ${expected}, got ${actual || "empty"}.`);
}
