import assert from "node:assert/strict";
import test from "node:test";
import { getTaskCompletion, reconcileParentCompletion, updateTaskCompletion } from "../src/lib/task-completion";
import type { Task } from "../src/lib/taskboard-data";

const task = (id: string, status: Task["status"] = "todo", subtasks: Task[] = []): Task => ({
  id, title: id, summary: "", status, color: "", icon: "wrench", labels: [], notes: [], checklist: [], attachments: [], subtasks,
});
const fixture = () => [task("root", "active", [task("parent", "todo", [task("a"), task("b")]), task("sibling")])];

test("parent completion follows descendants, including mixed nested branches", () => {
  assert.equal(getTaskCompletion(fixture()[0]), "none");
  assert.equal(getTaskCompletion(task("parent", "todo", [task("a", "done"), task("b")])), "mixed");
  assert.equal(getTaskCompletion(task("parent", "todo", [task("a", "done")])), "done");
  assert.equal(getTaskCompletion(task("parent", "todo", [task("branch", "todo", [task("a", "done"), task("b")])])), "mixed");
});

test("completing a parent completes every descendant without touching other branches", () => {
  const source = fixture();
  const [root] = updateTaskCompletion(source, "parent", "done");
  assert.equal(root.status, "active");
  assert.equal(root.subtasks[0].status, "done");
  assert.deepEqual(root.subtasks[0].subtasks.map(child => child.status), ["done", "done"]);
  assert.equal(root.subtasks[1], source[0].subtasks[1]);
  assert.equal(source[0].subtasks[0].status, "todo");
});

test("last child rolls completion to the root; reopening one child preserves completed siblings", () => {
  let tree = updateTaskCompletion(fixture(), "root", "done");
  tree = updateTaskCompletion(tree, "a", "todo");
  assert.equal(tree[0].status, "todo");
  assert.equal(tree[0].subtasks[0].status, "todo");
  assert.equal(tree[0].subtasks[0].subtasks[1].status, "done");
  assert.equal(tree[0].subtasks[1].status, "done");
  tree = updateTaskCompletion(tree, "a", "done");
  assert.equal(tree[0].status, "done");
  assert.equal(tree[0].subtasks[0].status, "done");
});

test("reopening a completed parent clears descendants; unchanged unfinished status preserves child progress", () => {
  const done = updateTaskCompletion(fixture(), "parent", "done");
  const reopened = updateTaskCompletion(done, "parent", "todo");
  assert.deepEqual(reopened[0].subtasks[0].subtasks.map(child => child.status), ["todo", "todo"]);
  const mixed = updateTaskCompletion(fixture(), "a", "done");
  assert.equal(updateTaskCompletion(mixed, "parent", "todo")[0].subtasks[0].subtasks[0].status, "done");
});

test("added or moved work keeps listed parents and their ancestors in step", () => {
  const done = [task("root", "done", [task("parent", "done", [task("a", "done")]), task("other", "done", [task("b", "done")])])];
  const added = reconcileParentCompletion([{ ...done[0], subtasks: [{ ...done[0].subtasks[0], subtasks: [task("a", "done"), task("new")] }, done[0].subtasks[1]] }], ["parent"]);
  assert.equal(added[0].status, "todo");
  assert.equal(added[0].subtasks[0].status, "todo");
  assert.equal(added[0].subtasks[1].status, "done");

  // The open item moves from "parent" into "other": "other" reopens, "parent" finishes.
  const moved = reconcileParentCompletion([task("root", "todo", [task("parent", "todo", [task("a", "done")]), task("other", "done", [task("b", "done"), task("new")])])], ["other", "parent"]);
  assert.equal(moved[0].subtasks[0].status, "done");
  assert.equal(moved[0].subtasks[1].status, "todo");
  assert.equal(moved[0].status, "todo");

  // An emptied parent keeps its status; unrelated branches are untouched.
  const source = [task("root", "todo", [task("empty", "todo"), task("legacy", "todo", [task("c", "done")])])];
  const result = reconcileParentCompletion(source, ["empty"]);
  assert.equal(result[0], source[0]);
});

test("a delete holds a recurring top-level task open but still finishes ordinary parents", () => {
  const recurringRoot = { ...task("root", "todo", [task("done", "done")]), recurrence: { frequency: "daily" as const, interval: 1, mode: "on_schedule" as const } };
  assert.equal(reconcileParentCompletion([recurringRoot], ["root"], { holdRecurringRoot: true })[0].status, "todo");
  assert.equal(reconcileParentCompletion([recurringRoot], ["root"])[0].status, "done", "Status edits still roll up as before.");
  const nested = [{ ...task("root", "todo", [task("branch", "todo", [task("leaf", "done")])]), recurrence: recurringRoot.recurrence }];
  const held = reconcileParentCompletion(nested, ["branch"], { holdRecurringRoot: true });
  assert.equal(held[0].subtasks[0].status, "done", "Work under the recurring task still finishes.");
  assert.equal(held[0].status, "todo");
});
