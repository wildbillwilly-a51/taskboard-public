import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const taskboardSource = readFileSync("src/components/taskboard.tsx", "utf8");

test("archive, delete, restore and purge controls follow lifecycle access", () => {
  assert.match(taskboardSource, /canManageLifecycle: boardAccess\.canManageLifecycle,/);
  // Task menus in the sidebar and the workspace, and right-click menus, take
  // Archive and Delete from the shared task actions, which gate them.
  assert.equal(taskboardSource.match(/canManageLifecycle=\{canManageTaskLifecycle\}/g)?.length, 2);
  assert.match(taskboardSource, /canManageLifecycle: currentBoardPermissions\.canManageLifecycle,/);
  const taskActionsSource = readFileSync("src/lib/task-actions.ts", "utf8");
  assert.equal(taskActionsSource.match(/enabled: canEditBoard && canManageLifecycle,/g)?.length, 3);
  // Done on a done task archives only with lifecycle access.
  assert.match(taskboardSource, /if \(currentBoardPermissions\.canManageLifecycle\) \{\s+void handleArchiveTask\(taskId\);/);
  // Subtask delete buttons disappear without it.
  assert.match(taskboardSource, /onDeleteTask=\{canManageTaskLifecycle \? onDeleteTask : undefined\}/);
  // Archives and Recycle Bin actions.
  assert.equal(taskboardSource.match(/disabled=\{isBusy \|\| !currentBoardPermissions\.canManageLifecycle\}/g)?.length, 3);
  // A bucket that still has tasks needs lifecycle access to delete.
  assert.match(taskboardSource, /disabled=\{!canEditBoard \|\| \(!canManageTaskLifecycle && bucket\.tasks\.length > 0\)\}/);
});

test("disabled shared controls look unavailable", () => {
  const css = readFileSync("src/app/globals.css", "utf8");
  assert.match(css, /\.taskboard-shell :is\(\.ui-button, \.ui-inline-button, \.ui-chip-button, \.ui-menu-item\):disabled \{\s+opacity: 0\.45;\s+cursor: not-allowed;/);
});

test("finishing the last subtask of a recurring task offers Undo", () => {
  assert.match(taskboardSource, /which finished "\$\{rootTitle\}" and moved it to Archives\./);
  assert.match(taskboardSource, /const restored = await persistRestoreArchiveTask\(rootTaskId, activeBoardRequestOptions\);/);
  // A failed step after the restore is reported, not hidden.
  assert.match(taskboardSource, /if \(!reopened\?\.board\) \{\s+applyBoardMutationResponse\(restored\);\s+reportMutationFailure\(reopened,/);
  assert.match(taskboardSource, /if \(!rootReset\?\.board\) \{\s+applyBoardMutationResponse\(reopened\);\s+reportMutationFailure\(rootReset,/);
});
