import assert from "node:assert/strict";
import test from "node:test";
import {
  applySubtaskMove,
  getCurrentPlacement,
  getDropMove,
  getIndentMove,
  getOutdentMove,
  isNoOpMove,
  type SubtaskNode,
} from "../src/lib/subtask-move";

const node = (id: string, subtasks: SubtaskNode[] = []): SubtaskNode => ({ id, subtasks });
// outage
//   w1: a, b
//   w2: c
//   loose
const tree = () => node("outage", [node("w1", [node("a"), node("b")]), node("w2", [node("c")]), node("loose")]);
const shape = (n: SubtaskNode): unknown => (n.subtasks.length ? { [n.id]: n.subtasks.map(shape) } : n.id);

test("Tab nests under the subtask above; the first child cannot", () => {
  assert.deepEqual(getIndentMove(tree(), "loose"), { taskId: "loose", parentTaskId: "w2", targetIndex: 1 });
  assert.deepEqual(getIndentMove(tree(), "b"), { taskId: "b", parentTaskId: "a", targetIndex: 0 });
  assert.equal(getIndentMove(tree(), "a"), null);
  assert.equal(getIndentMove(tree(), "w1"), null);
});

test("Shift+Tab moves out to just after the parent; top-level subtasks stay", () => {
  assert.deepEqual(getOutdentMove(tree(), "a"), { taskId: "a", parentTaskId: "outage", targetIndex: 1 });
  assert.deepEqual(getOutdentMove(tree(), "c"), { taskId: "c", parentTaskId: "outage", targetIndex: 2 });
  assert.equal(getOutdentMove(tree(), "loose"), null);
});

test("drops go before, after, or inside, counting siblings without the moved row", () => {
  assert.deepEqual(getDropMove(tree(), "a", "w2", "inside"), { taskId: "a", parentTaskId: "w2", targetIndex: 1 });
  assert.deepEqual(getDropMove(tree(), "a", "c", "before"), { taskId: "a", parentTaskId: "w2", targetIndex: 0 });
  assert.deepEqual(getDropMove(tree(), "a", "b", "after"), { taskId: "a", parentTaskId: "w1", targetIndex: 1 });
  assert.deepEqual(getDropMove(tree(), "loose", "w1", "before"), { taskId: "loose", parentTaskId: "outage", targetIndex: 0 });
});

test("a row cannot be dropped on itself or inside its own children", () => {
  assert.equal(getDropMove(tree(), "w1", "w1", "inside"), null);
  assert.equal(getDropMove(tree(), "w1", "a", "inside"), null);
  assert.equal(getDropMove(tree(), "w1", "b", "after"), null);
  assert.equal(getDropMove(tree(), "outage", "a", "inside"), null);
});

test("applying a move reshapes the tree and undo puts it back", () => {
  const original = tree();
  const undo = getCurrentPlacement(original, "a");
  assert.deepEqual(undo, { taskId: "a", parentTaskId: "w1", targetIndex: 0 });
  const moved = applySubtaskMove(original, { taskId: "a", parentTaskId: "w2", targetIndex: 1 });
  assert.deepEqual(shape(moved), { outage: [{ w1: ["b"] }, { w2: ["c", "a"] }, "loose"] });
  assert.deepEqual(shape(applySubtaskMove(moved, undo!)), shape(original));
  assert.equal(applySubtaskMove(original, { taskId: "w1", parentTaskId: "a", targetIndex: 0 }), original);
  assert.equal(isNoOpMove(original, { taskId: "b", parentTaskId: "w1", targetIndex: 1 }), true);
});
