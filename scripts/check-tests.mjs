import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { once } from "node:events";
import { readdirSync } from "node:fs";

const nodeArgs = ["--conditions=react-server", "--import=tsx"];
const mode = process.argv[2];

if (mode === "unit") {
  const files = readdirSync("tests")
    .filter((file) => /\.test\.tsx?$/.test(file)
      && !/-db\.test\.tsx?$/.test(file)
      && file !== "outage-people-store.test.ts")
    .map((file) => "tests/" + file);
  assert.ok(files.length, "No unit test files found.");
  const env = { ...process.env };
  delete env.DATABASE_URL;
  // react-dom/server uses the normal React export, even for server rendering.
  const renderingTests = new Set([
    "tests/hydration-regression.test.tsx",
    "tests/subtask-board-ui.test.ts",
    "tests/task-workspace-ui.test.ts",
    "tests/wiki-p2-editor.test.tsx",
    "tests/wiki-p2-ui.test.tsx",
    "tests/wiki-ui.test.tsx",
  ]);
  const testArgs = ["--test", "--test-concurrency=2"];
  await run([...nodeArgs, ...testArgs, ...files.filter((file) => !renderingTests.has(file))], env);
  await run(["--import=tsx", ...testArgs, ...files.filter((file) => renderingTests.has(file))], env);
} else if (mode === "database") {
  const databaseName = "taskboard_visual_test_folio";
  const url = new URL(process.env.DATABASE_URL ?? "");
  assert.ok(["postgres:", "postgresql:"].includes(url.protocol)
    && ["127.0.0.1", "localhost"].includes(url.hostname)
    && url.pathname === "/" + databaseName
    && !url.search && !url.hash, "Use a disposable loopback " + databaseName + " database.");
  const env = {
    ...process.env,
    TASKBOARD_VISUAL_DATABASE_NAME: databaseName,
    DATABASE_POOL_IDLE_TIMEOUT_MS: "1000",
    TASKBOARD_SHARE_LINK_SECRET: randomBytes(32).toString("hex"),
  };
  await run([...nodeArgs, "src/scripts/init-db.ts"], env);

  const suites = [
    ["folio-db", "FOLIO_DB_TEST"],
    ["folio-privacy-db", "FOLIO_DB_TEST"],
    ["public-task-share-db", "TASKBOARD_PUBLIC_SHARE_DB_TEST"],
    ["public-task-work-db", "TASKBOARD_PUBLIC_WORK_DB_TEST"],
  ];
  for (const [suite, flag] of suites) {
    console.log("Database suite: " + suite);
    const output = await run([...nodeArgs, "--test", "--test-reporter=tap", "tests/" + suite + ".test.ts"], {
      ...env,
      [flag]: "1",
    }, true);
    const count = (key) => Number(output.match(new RegExp("^# " + key + " (\\d+)$", "m"))?.[1]);
    assert.ok(count("tests") > 0 && count("skipped") === 0 && count("todo") === 0,
      suite + " must execute tests without skips or todos.");
  }
} else {
  throw new Error("Usage: node scripts/check-tests.mjs unit|database");
}

async function run(args, env, readSummary = false) {
  const child = spawn(process.execPath, args, {
    env,
    stdio: ["ignore", readSummary ? "pipe" : "inherit", "inherit"],
    timeout: 180_000,
  });
  let summary = "";
  child.stdout?.setEncoding("utf8").on("data", (chunk) => {
    process.stdout.write(chunk);
    summary = (summary + chunk).slice(-4096);
  });
  const [status, signal] = await once(child, "close");
  if (status !== 0) {
    throw new Error("Node command failed (" + (signal ?? status) + ").");
  }
  return summary;
}
