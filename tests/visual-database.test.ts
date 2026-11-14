import assert from "node:assert/strict";
import test from "node:test";
import { isLocalVisualDatabase, visualDatabaseName } from "./helpers/visual-database";

test("visual fixture preparation refuses other databases and URL overrides", () => {
  const previous = process.env.TASKBOARD_VISUAL_DATABASE_NAME;
  try {
    process.env.TASKBOARD_VISUAL_DATABASE_NAME = "taskboard_visual_test_release3";
    assert.equal(isLocalVisualDatabase(new URL("postgresql://localhost:55503/taskboard_visual_test_release3")), true);
    for (const url of [
      "postgresql://localhost:55503/taskboard_visual_test",
      "postgresql://localhost:55503/taskboard",
      "postgresql://remote.example/taskboard_visual_test_release3",
      "postgresql://localhost/taskboard_visual_test_release3?host=remote.example",
      "https://localhost/taskboard_visual_test_release3",
    ]) assert.equal(isLocalVisualDatabase(new URL(url)), false, url);
    for (const name of ["taskboard", "taskboard_visual_test;DROP DATABASE postgres", `taskboard_visual_test_${"a".repeat(64)}`]) {
      process.env.TASKBOARD_VISUAL_DATABASE_NAME = name;
      assert.throws(visualDatabaseName);
    }
  } finally {
    if (previous === undefined) delete process.env.TASKBOARD_VISUAL_DATABASE_NAME;
    else process.env.TASKBOARD_VISUAL_DATABASE_NAME = previous;
  }
});
