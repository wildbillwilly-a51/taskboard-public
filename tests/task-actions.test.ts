import assert from "node:assert/strict";
import test from "node:test";

import { getTaskActions, getTaskEditBlockReason, type TaskActionContext } from "../src/lib/task-actions";

type TaskFacts = Parameters<typeof getTaskActions>[0];

const task = (overrides: Partial<TaskFacts> = {}): TaskFacts => ({
  title: "Patch servers",
  status: "todo",
  workItemType: "task",
  ...overrides,
});
const root: TaskActionContext = { canEditBoard: true, canManageLifecycle: true, isRootTask: true, isArchived: false, hasCalendarLink: true };
const ids = (actions: ReturnType<typeof getTaskActions>) => actions.map((action) => action.id);
const byId = (actions: ReturnType<typeof getTaskActions>, id: string) => actions.find((action) => action.id === id);

test("the menu offers every existing task action for an editable root task", () => {
  assert.deepEqual(ids(getTaskActions(task(), root, "menu")), [
    "open", "open-workspace",
    "status-todo", "status-active", "status-waiting", "status-done",
    "due", "snooze", "move",
    "view-calendar", "promote", "archive", "delete",
  ]);
  const actions = getTaskActions(task({ status: "active" }), root, "menu");
  assert.equal(byId(actions, "status-active")?.checked, true);
  assert.equal(byId(actions, "status-active")?.enabled, false);
  assert.equal(byId(actions, "status-todo")?.checked, false);
  assert.equal(byId(actions, "delete")?.danger, true);
});

test("the palette keeps its own items and labels", () => {
  const actions = getTaskActions(task(), root, "palette");
  assert.deepEqual(ids(actions), [
    "open", "open-workspace", "status-todo", "status-active", "status-waiting", "status-done", "due", "snooze", "move",
  ]);
  assert.equal(byId(actions, "open")?.label, "Open in sidebar");
  assert.equal(byId(actions, "status-waiting")?.label, "Set to Waiting");
  assert.equal(byId(actions, "due")?.label, "Set due date");
  assert.equal(byId(actions, "status-todo")?.checked, undefined);
});

test("the editor menu shares Promote, Archive and Delete", () => {
  assert.deepEqual(ids(getTaskActions(task(), root, "editor")), ["promote", "archive", "delete"]);
  // An archived task still shown in the inspector has no menu.
  assert.deepEqual(getTaskActions(task(), { ...root, isArchived: true }, "editor"), []);
});

test("Done on a done root archives; on a subtask it is simply current", () => {
  const doneRoot = getTaskActions(task({ status: "done" }), root, "menu");
  assert.equal(byId(doneRoot, "status-done")?.label, "Done: Archive");
  assert.equal(byId(doneRoot, "status-done")?.enabled, true);
  const doneSubtask = getTaskActions(task({ status: "done" }), { ...root, isRootTask: false }, "menu");
  assert.equal(byId(doneSubtask, "status-done")?.label, "Done");
  assert.equal(byId(doneSubtask, "status-done")?.enabled, false);
});

test("subtask menus and palettes offer only their own editable fields and work", () => {
  const sub = { ...root, isRootTask: false };
  const menu = getTaskActions(task(), sub, "menu");
  assert.deepEqual(ids(menu), ["open", "open-workspace", "status-todo", "status-done", "time", "view-calendar", "delete"]);
  assert.equal(byId(menu, "open")?.label, "Edit subtask");
  assert.equal(byId(menu, "open-workspace")?.label, "Open work inside");
  assert.equal(byId(menu, "time")?.enabled, true);
  assert.deepEqual(ids(getTaskActions(task(), sub, "palette")), ["open", "open-workspace", "status-todo", "status-done", "time", "view-calendar"]);
  assert.deepEqual(ids(getTaskActions(task(), sub, "editor")), ["delete"]);
  for (const surface of ["menu", "palette", "editor"] as const) {
    for (const forbidden of ["status-active", "status-waiting", "due", "snooze", "move", "promote", "archive", "follow-up", "convert"]) {
      assert.equal(byId(getTaskActions(task(), sub, surface), forbidden), undefined, `${surface}: ${forbidden}`);
    }
  }
});

test("subtask viewer and lifecycle permissions still apply to allowed actions", () => {
  const viewer = getTaskActions(task(), { ...root, isRootTask: false, canEditBoard: false }, "menu");
  for (const action of viewer) assert.equal(action.enabled, ["open", "open-workspace", "view-calendar"].includes(action.id), action.id);
  const member = getTaskActions(task(), { ...root, isRootTask: false, canManageLifecycle: false }, "menu");
  assert.equal(byId(member, "status-done")?.enabled, true);
  assert.equal(byId(member, "time")?.enabled, true);
  assert.equal(byId(member, "delete")?.enabled, false);
});

test("a viewer sees every action disabled with the reason", () => {
  const viewer = getTaskActions(task(), { ...root, canEditBoard: false }, "menu");
  const reason = "You can view this board, but you do not have permission to edit tasks.";
  for (const action of viewer) {
    if (["open", "open-workspace", "view-calendar"].includes(action.id)) {
      assert.equal(action.enabled, true, action.id);
    } else {
      assert.equal(action.enabled, false, action.id);
      assert.equal(action.disabledReason, reason, action.id);
    }
  }
});

test("a read-only import offers its import actions, not edits", () => {
  const imported = task({ importedFrom: { readOnly: true, convertToTask: true } as TaskFacts["importedFrom"] });
  const actions = getTaskActions(imported, root, "menu");
  assert.deepEqual(ids(actions), ["open", "open-workspace", "view-calendar", "follow-up", "convert", "archive", "delete"]);
  assert.equal(byId(actions, "delete")?.label, "Move import to recycle bin");
  const withoutConvert = task({ importedFrom: { readOnly: true } as TaskFacts["importedFrom"] });
  assert.equal(byId(getTaskActions(withoutConvert, root, "menu"), "convert"), undefined);
  // The palette lists statuses, disabled, as it always has.
  const palette = getTaskActions(imported, root, "palette");
  assert.equal(byId(palette, "status-active")?.enabled, false);
  assert.match(byId(palette, "status-active")?.disabledReason ?? "", /read-only calendar import/);
});

test("an outage has no Promote; a task without dates has no calendar link", () => {
  assert.equal(byId(getTaskActions(task({ workItemType: "maintenance_outage" }), root, "menu"), "promote"), undefined);
  const noLink = getTaskActions(task(), { ...root, hasCalendarLink: false }, "menu");
  assert.equal(byId(noLink, "view-calendar"), undefined);
  // Promote then starts the group the calendar link would have started.
  assert.equal(byId(noLink, "promote")?.separator, true);
});

test("without lifecycle access, Archive, Delete and Done: Archive are off", () => {
  const member = { ...root, canManageLifecycle: false };
  const menu = getTaskActions(task({ status: "done" }), member, "menu");
  assert.equal(byId(menu, "archive")?.enabled, false);
  assert.equal(byId(menu, "archive")?.disabledReason, "Only a team manager can archive tasks on this board.");
  assert.equal(byId(menu, "delete")?.enabled, false);
  assert.equal(byId(menu, "delete")?.disabledReason, "Only a team manager can delete tasks on this board.");
  // Done on a done root is just the current status, not an archive.
  assert.equal(byId(menu, "status-done")?.label, "Done");
  assert.equal(byId(menu, "status-done")?.enabled, false);
  assert.equal(byId(getTaskActions(task({ status: "done" }), member, "palette"), "status-done")?.label, "Set to Done");
  // Everything else stays as it was.
  assert.equal(byId(menu, "status-active")?.enabled, true);
  assert.equal(byId(menu, "promote")?.enabled, true);
  const editor = getTaskActions(task(), member, "editor");
  assert.deepEqual(editor.map((action) => [action.id, action.enabled]), [["promote", true], ["archive", false], ["delete", false]]);
});
