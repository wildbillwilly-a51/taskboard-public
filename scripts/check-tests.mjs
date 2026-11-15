import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
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
  run([...nodeArgs, "--test", "--test-concurrency=2", ...files], env);
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
  };
  run([...nodeArgs, "src/scripts/init-db.ts"], env);

  const suites = [
    ["folio-db", "FOLIO_DB_TEST"],
    ["folio-privacy-db", "FOLIO_DB_TEST"],
    ["public-task-share-db", "TASKBOARD_PUBLIC_SHARE_DB_TEST"],
    ["public-task-work-db", "TASKBOARD_PUBLIC_WORK_DB_TEST"],
  ];
  for (const [suite, flag] of suites) {
    console.log("Database suite: " + suite);
    const output = run([...nodeArgs, "--test", "--test-reporter=tap", "tests/" + suite + ".test.ts"], {
      ...env,
      [flag]: "1",
    });
    const count = (key) => Number(output.match(new RegExp("^# " + key + " (\\d+)$", "m"))?.[1]);
    assert.ok(count("tests") > 0 && count("skipped") === 0 && count("todo") === 0,
      suite + " must execute tests without skips or todos.");
  }
} else {
  throw new Error("Usage: node scripts/check-tests.mjs unit|database");
}

function run(args, env) {
  const result = spawnSync(process.execPath, args, {
    env,
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error("Node command failed (" + (result.signal ?? result.status) + ").");
  }
  return result.stdout;
}
