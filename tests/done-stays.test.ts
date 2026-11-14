import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const storeSource = readFileSync("src/lib/taskboard-store.ts", "utf8");
const taskboardSource = readFileSync("src/components/taskboard.tsx", "utf8");

test("done tasks are no longer archived automatically", () => {
  assert.doesNotMatch(storeSource, /archiveDoneRootTasks/);
  // Only a recurring completion archives, because its next occurrence replaces it.
  assert.match(storeSource, /if \(transitionedToDone && nextRecurrence && nextDueAt\) \{\s+const originalBucketId/);
});

test("Done becomes Done: Archive on saved top-level done tasks", () => {
  assert.match(
    taskboardSource,
    /const offersArchiveFromDone =\s+isRootTask && canMutateTask && canManageTaskLifecycle && task\.status === "done" && draftStatus === "done";/,
  );
  assert.equal(taskboardSource.match(/onClick=\{\(\) => handleStatusButton\(option\.value\)\}/g)?.length, 3);
  // The palette and right-click menus label it from the shared task actions.
  const taskActionsSource = readFileSync("src/lib/task-actions.ts", "utf8");
  assert.match(taskActionsSource, /archivesFromDone \? "Done: Archive"/);
  assert.match(taskActionsSource, /const archivesFromDone = status === "done" && task\.status === "done" && isRootTask && canManageLifecycle;/);
  assert.match(taskboardSource, /if \(task\.status === "done" && status === "done" && boardIndex\.rootTaskIdByTaskId\.get\(taskId\) === taskId\)/);
});

test("Archives has a Done tab for review and an undo that keeps Done", () => {
  assert.match(taskboardSource, /data-testid="archives-tab-done"/);
  assert.match(taskboardSource, /data-testid="archives-archive-all-done"/);
  assert.match(taskboardSource, /restoreArchivedTaskWithStatus\(rootTaskId, archivedTaskStatus\)/);
});
