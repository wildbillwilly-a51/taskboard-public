import { defineConfig, devices } from "@playwright/test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { visualDatabaseName } from "./tests/helpers/visual-database";

const port = Number(process.env.TASKBOARD_VISUAL_TEST_PORT || 3200);
const baseURL = process.env.TASKBOARD_BASE_URL || `http://127.0.0.1:${port}`;
const visualDatabaseUrl = buildVisualDatabaseUrl();

export default defineConfig({
  testDir: "./tests/visual",
  timeout: 45_000,
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
    },
  },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "test-artifacts/playwright-report" }]],
  outputDir: "test-artifacts/playwright-results",
  use: {
    baseURL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
  },
  webServer: {
    command: `node --conditions react-server --env-file=.env --import tsx ./tests/visual/prepare-database.ts && npm run dev -- --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: {
      DATABASE_URL: visualDatabaseUrl,
      TASKBOARD_AUTH_MODE: "password",
      TASKBOARD_APP_PASSWORD: "visual-test-password",
      AUTH_SECRET: "visual-test-auth-secret-with-enough-length",
      AUTH_COOKIE_SECURE: "false",
    },
  },
  projects: [
    { name: "visual-auth-setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "mobile-chromium",
      dependencies: ["visual-auth-setup"],
      testIgnore: /auth\.setup\.ts/,
      use: { ...devices["Pixel 5"] },
    },
    {
      name: "tablet-chromium",
      dependencies: ["visual-auth-setup"],
      testIgnore: /auth\.setup\.ts/,
      use: { viewport: { width: 768, height: 1024 }, hasTouch: true },
    },
    {
      name: "desktop-chromium",
      dependencies: ["visual-auth-setup"],
      testIgnore: /auth\.setup\.ts/,
      use: { viewport: { width: 1440, height: 1000 } },
    },
  ],
});

function buildVisualDatabaseUrl() {
  const envValues = readEnvFile(path.resolve(".env"));
  const configuredUrl = process.env.DATABASE_URL ?? envValues.DATABASE_URL;

  if (!configuredUrl) {
    throw new Error("DATABASE_URL is required for the isolated visual-test database.");
  }

  const visualUrl = new URL(configuredUrl);
  visualUrl.pathname = `/${visualDatabaseName()}`;
  return visualUrl.toString();
}

function readEnvFile(filePath: string) {
  if (!existsSync(filePath)) {
    return {} as Record<string, string>;
  }

  return Object.fromEntries(
    readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separatorIndex = line.indexOf("=");
        return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)];
      }),
  );
}
