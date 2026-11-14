import assert from "node:assert/strict";
import test from "node:test";
import {
  findBoardItem,
  getAncestors,
  getBoardStatus,
  getCardDropMove,
  getColumnColor,
  getMoveTargets,
  getMoveToMove,
  getPreview,
  getSiblingMove,
  getStepMove,
  getWorkstreamColor,
  WORKSTREAM_PALETTE,
} from "../src/lib/subtask-board";
import { applySubtaskMove } from "../src/lib/subtask-move";
import type { Task } from "../src/lib/taskboard-data";

const task = (id: string, subtasks: Task[] = [], status: Task["status"] = "todo"): Task => ({
  id, title: id, summary: "", status, color: "", icon: "wrench", labels: [], notes: [], checklist: [], attachments: [], subtasks,
});

// Two cards with work under them, and one card on its own.
const tree = () => task("root", [
  task("ops", [task("core", [task("vc"), task("esx")]), task("idf"), task("cams")]),
  task("net", [task("tue"), task("wed")]),
  task("solo"),
]);
const order = (root: Task, id: string) => findBoardItem(root, id)!.subtasks.map(child => child.id).join(",");

test("an item is found by id at any depth, with the items above it", () => {
  const root = tree();
  assert.equal(findBoardItem(root, "esx")?.id, "esx");
  assert.equal(findBoardItem(root, "gone"), null);
  assert.deepEqual(getAncestors(root, "esx")?.map(item => item.id), ["ops", "core"]);
  assert.deepEqual(getAncestors(root, "ops"), [], "A card has nothing above it but the task.");
  assert.equal(getAncestors(root, "gone"), null);
});

test("dragging onto a sibling takes its place, as the sortable list shows", () => {
  const root = tree();
  const down = getSiblingMove(root, "core", "cams");
  assert.deepEqual(down, { taskId: "core", parentTaskId: "ops", targetIndex: 2 });
  assert.equal(order(applySubtaskMove(root, down!), "ops"), "idf,cams,core");
  const up = getSiblingMove(root, "cams", "core");
  assert.equal(order(applySubtaskMove(root, up!), "ops"), "cams,core,idf");
  const cards = getSiblingMove(root, "solo", "ops");
  assert.equal(order(applySubtaskMove(root, cards!), "root"), "solo,ops,net");
});

test("dragging never changes an item's parent", () => {
  const root = tree();
  assert.equal(getSiblingMove(root, "idf", "tue"), null, "A row dropped on another card's row stays put.");
  assert.equal(getSiblingMove(root, "idf", "net"), null, "A row dropped on another card stays put.");
  assert.equal(getSiblingMove(root, "vc", "idf"), null, "A deeper row stays under its own parent.");
  assert.equal(getSiblingMove(root, "idf", "idf"), null);
});

test("Move up and down step among siblings and stop at the ends", () => {
  const root = tree();
  assert.equal(getStepMove(root, "core", -1), null);
  assert.equal(getStepMove(root, "cams", 1), null);
  assert.equal(order(applySubtaskMove(root, getStepMove(root, "core", 1)!), "ops"), "idf,core,cams");
  assert.equal(order(applySubtaskMove(root, getStepMove(root, "cams", -1)!), "ops"), "core,cams,idf");
});

test("Move to offers every other place, never the item or its own work, and names the path", () => {
  const targets = getMoveTargets(tree(), "core");
  assert.deepEqual(targets.map(target => target.id), ["root", "ops", "idf", "cams", "net", "tue", "wed", "solo"]);
  assert.equal(targets[0].isRoot, true);
  assert.equal(targets.find(target => target.id === "tue")?.label, "net › tue");
  const long = task("root", [task("x".repeat(40), [task("leaf")])]);
  assert.equal(getMoveTargets(long, "none").at(-1)?.label, `${"x".repeat(31)}… › leaf`);
});

test("Move to puts the item last under its new parent, and refuses its current parent or its own work", () => {
  const root = tree();
  const move = getMoveToMove(root, "idf", "net");
  assert.deepEqual(move, { taskId: "idf", parentTaskId: "net", targetIndex: 2 });
  const moved = applySubtaskMove(root, move!);
  assert.equal(order(moved, "net"), "tue,wed,idf");
  assert.equal(order(moved, "ops"), "core,cams");
  assert.deepEqual(getMoveToMove(root, "vc", "root"), { taskId: "vc", parentTaskId: "root", targetIndex: 3 }, "Moving to the task makes it a card.");
  assert.equal(getMoveToMove(root, "idf", "ops"), null);
  assert.equal(getMoveToMove(root, "ops", "core"), null);
  assert.equal(getMoveToMove(root, "ops", "gone"), null);
});

test("an item shows done when everything under it is done, else its own status", () => {
  assert.equal(getBoardStatus(task("p", [task("x", [], "done")])), "done");
  assert.equal(getBoardStatus(task("p", [task("x", [], "done"), task("y")], "done")), "todo", "A stale done parent shows as open.");
  assert.equal(getBoardStatus(task("leaf", [], "done")), "done");
});

test("a closed list previews its first open items, keeps a selected one, and counts hidden done ones", () => {
  const items = Array.from({ length: 10 }, (_, index) => task(`i${index}`, [], index < 3 ? "done" : "todo"));
  const names = (shown: Task[]) => shown.map(item => item.id).join(",");
  assert.equal(names(getPreview(items, 4, null, false).shown), "i3,i4,i5,i6");
  assert.equal(getPreview(items, 4, null, false).hiddenDone, 3);
  assert.equal(names(getPreview(items, 4, "i1", false).shown), "i1,i3,i4,i5,i6", "A selected item stays in view, in its place.");
  assert.equal(getPreview(items, 4, null, true).shown.length, 10);
  assert.equal(getPreview(items.slice(0, 5), 4, null, false).shown.length, 5, "One extra item shows rather than a link.");
  const allDone = items.slice(0, 3);
  assert.equal(names(getPreview([...allDone, ...allDone.map(item => ({ ...item, id: `${item.id}b` }))], 2, null, false).shown), "i0,i1", "With nothing open, the first items show.");
});

test("a column takes the palette by position", () => {
  const palette = ["#a", "#b", "#c"];
  assert.equal(getColumnColor(0, palette), "#a");
  assert.equal(getColumnColor(1, palette), "#b");
  assert.equal(getColumnColor(4, palette), "#b", "The palette repeats past its end.");
});

test("a workstream's color is its Board column's, by its place among all top-level subtasks", () => {
  const root = task("root", [task("a"), task("b"), task("c")]);
  root.subtasks[1].color = "#0f766e";
  assert.equal(getWorkstreamColor(root, root.subtasks[0]), WORKSTREAM_PALETTE[0]);
  assert.equal(getWorkstreamColor(root, root.subtasks[1]), WORKSTREAM_PALETTE[1], "A stored color is ignored: subtasks have none of their own.");
  assert.equal(getWorkstreamColor(root, root.subtasks[2]), WORKSTREAM_PALETTE[2]);
});

test("a card dropped in another column lands before the card under it, or at the end", () => {
  const root = tree();
  const before = getCardDropMove(root, "idf", "net", "wed");
  assert.deepEqual(before, { taskId: "idf", parentTaskId: "net", targetIndex: 1 });
  assert.equal(order(applySubtaskMove(root, before!), "net"), "tue,idf,wed");
  assert.equal(order(applySubtaskMove(root, before!), "ops"), "core,cams");
  const end = getCardDropMove(root, "core", "solo", null);
  assert.deepEqual(end, { taskId: "core", parentTaskId: "solo", targetIndex: 0 }, "A column with no cards takes a card.");
  assert.equal(order(applySubtaskMove(root, getCardDropMove(root, "idf", "ops", null)!), "ops"), "core,cams,idf", "Its own column's end counts it once.");
  assert.equal(getCardDropMove(root, "ops", "net", null), null, "Columns do not move into columns.");
  assert.equal(getCardDropMove(root, "idf", "net", "idf"), null);
  assert.equal(getCardDropMove(root, "idf", "net", "core"), null, "The card it lands before must be in that column.");
  assert.equal(getCardDropMove(root, "vc", "net", null)?.parentTaskId, "net", "Deeper work dropped as a card becomes a card.");
});
