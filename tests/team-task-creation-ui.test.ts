import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/components/taskboard.tsx", "utf8");

test("inline task creation keeps the draft open when persistence fails", () => {
  assert.match(
    source,
    /const created = await onCreateTask\(bucket\.id, newTaskTitle, newWorkItemType\);\s+if \(!created\) \{\s+return;\s+\}/,
  );
});

test("inline task creation stays open for the next task except on narrow screens", () => {
  assert.match(
    source,
    /if \(window\.matchMedia\("\(max-width: 767px\)"\)\.matches\) \{\s+closeInlineTask\(\);\s+return;\s+\}\s+setNewTaskTitle\(""\);\s+quickAddInputRef\.current\?\.focus\(\{ preventScroll: true \}\);/,
  );
  assert.match(source, /ref=\{quickAddInputRef\}\s+autoFocus/);
});

test("task creation surfaces the server mutation error and reports failure", () => {
  assert.match(
    source,
    /setMutationError\(response\?\.error \?\? "Unable to create task\."\);\s+return false;/,
  );
  assert.match(
    source,
    /const message = body\?\.error \?\? `Request failed with status \$\{response\.status\}`;/,
  );
});
