import assert from "node:assert/strict";
import test from "node:test";

import { getSelectionAfterTaskRemoval } from "../src/lib/task-selection";

const onBoard = (...ids: string[]) => (id: string) => ids.includes(id);

test("removing another task keeps the open task and the inspector as they are", () => {
  const current = { selectedTaskId: "a", isInspectorVisible: true };
  assert.deepEqual(
    getSelectionAfterTaskRemoval({ current, retainedTaskId: null, hasTask: onBoard("a", "c"), fallbackTaskId: "c", firstTaskId: "a" }),
    current,
  );
});

test("a closed inspector stays closed, with or without a selection", () => {
  const closed = { selectedTaskId: null, isInspectorVisible: false };
  assert.deepEqual(
    getSelectionAfterTaskRemoval({ current: closed, retainedTaskId: null, hasTask: onBoard("c"), fallbackTaskId: "c", firstTaskId: "c" }),
    closed,
  );
  assert.deepEqual(
    getSelectionAfterTaskRemoval({
      current: { selectedTaskId: "b", isInspectorVisible: false },
      retainedTaskId: null,
      hasTask: onBoard("c"),
      fallbackTaskId: "c",
      firstTaskId: "c",
    }),
    { selectedTaskId: "c", isInspectorVisible: false },
  );
});

test("removing the open task moves to its neighbour, else the first task", () => {
  const current = { selectedTaskId: "b", isInspectorVisible: true };
  assert.deepEqual(
    getSelectionAfterTaskRemoval({ current, retainedTaskId: null, hasTask: onBoard("a", "c"), fallbackTaskId: "c", firstTaskId: "a" }),
    { selectedTaskId: "c", isInspectorVisible: true },
  );
  assert.deepEqual(
    getSelectionAfterTaskRemoval({ current, retainedTaskId: null, hasTask: onBoard("a"), fallbackTaskId: "c", firstTaskId: "a" }),
    { selectedTaskId: "a", isInspectorVisible: true },
  );
});

test("removing a subtask that was open moves to its parent", () => {
  assert.deepEqual(
    getSelectionAfterTaskRemoval({
      current: { selectedTaskId: "sub", isInspectorVisible: true },
      retainedTaskId: null,
      hasTask: onBoard("parent", "a"),
      fallbackTaskId: "parent",
      firstTaskId: "a",
    }),
    { selectedTaskId: "parent", isInspectorVisible: true },
  );
});

test("archiving a root also removes its open subtask", () => {
  // The selected subtask is gone with its root, so the root's neighbour opens.
  assert.deepEqual(
    getSelectionAfterTaskRemoval({
      current: { selectedTaskId: "root-sub", isInspectorVisible: true },
      retainedTaskId: null,
      hasTask: onBoard("next"),
      fallbackTaskId: "next",
      firstTaskId: "next",
    }),
    { selectedTaskId: "next", isInspectorVisible: true },
  );
});

test("an archived task still shown in the inspector stays open", () => {
  const current = { selectedTaskId: "done", isInspectorVisible: true };
  assert.deepEqual(
    getSelectionAfterTaskRemoval({ current, retainedTaskId: "done", hasTask: onBoard("a"), fallbackTaskId: "a", firstTaskId: "a" }),
    current,
  );
});

test("an empty board closes the inspector", () => {
  assert.deepEqual(
    getSelectionAfterTaskRemoval({
      current: { selectedTaskId: "b", isInspectorVisible: true },
      retainedTaskId: null,
      hasTask: onBoard(),
      fallbackTaskId: null,
      firstTaskId: null,
    }),
    { selectedTaskId: null, isInspectorVisible: false },
  );
});
