import assert from "node:assert/strict";
import test from "node:test";

import {
  findRootTaskBucketId,
  getRootTaskIndex,
  getSameBucketDropPlacement,
  getTaskDropPlacement,
  moveRootTaskOnBoard,
  type TaskDropPlacement,
} from "@/lib/taskboard-drag";
import type { Board, Task } from "@/lib/taskboard-data";

function task(id: string): Task {
  return {
    id,
    title: id,
    summary: "",
    status: "todo",
    color: "#2563eb",
    icon: "flag",
    labels: [],
    notes: [],
    checklist: [],
    attachments: [],
    subtasks: [],
  };
}

function board(sourceCollapsed = false, targetCollapsed = false): Board {
  return {
    id: "board",
    title: "Drag test",
    description: "",
    views: [],
    buckets: [
      {
        id: "source",
        title: "Source",
        color: "#2563eb",
        icon: "inbox",
        collapsed: sourceCollapsed,
        tasks: [task("a"), task("b"), task("c")],
      },
      {
        id: "target",
        title: "Target",
        color: "#0f766e",
        icon: "kanban",
        collapsed: targetCollapsed,
        tasks: [task("d"), task("e")],
      },
      {
        id: "empty",
        title: "Empty",
        color: "#64748b",
        icon: "folder",
        collapsed: targetCollapsed,
        tasks: [],
      },
    ],
  };
}

function ids(value: Board, bucketId: string) {
  return value.buckets.find((bucket) => bucket.id === bucketId)?.tasks.map((item) => item.id);
}

test("reorders root tasks before and after another task in the same bucket", () => {
  const initial = board();

  const before = moveRootTaskOnBoard(initial, "c", "source", "before", "a");
  assert.deepEqual(ids(before, "source"), ["c", "a", "b"]);

  const after = moveRootTaskOnBoard(initial, "a", "source", "after", "b");
  assert.deepEqual(ids(after, "source"), ["b", "a", "c"]);

  const append = moveRootTaskOnBoard(initial, "a", "source", "append");
  assert.deepEqual(ids(append, "source"), ["b", "c", "a"]);
});

test("same-bucket drops land in the hovered card's slot, matching the sortable list", () => {
  const initial = board();
  const tasks = initial.buckets.find((bucket) => bucket.id === "source")?.tasks ?? [];
  const drop = (activeId: string, overId: string) =>
    ids(
      moveRootTaskOnBoard(
        initial,
        activeId,
        "source",
        getSameBucketDropPlacement(tasks, activeId, overId),
        overId,
      ),
      "source",
    );

  // Moving down takes the hovered card's slot (after it); moving up goes before it.
  assert.deepEqual(drop("a", "b"), ["b", "a", "c"]);
  assert.deepEqual(drop("a", "c"), ["b", "c", "a"]);
  assert.deepEqual(drop("c", "a"), ["c", "a", "b"]);
  assert.deepEqual(drop("c", "b"), ["a", "c", "b"]);
  // Dropping on its own slot (after leaving the bucket and coming back) keeps it in place.
  assert.deepEqual(drop("a", "a"), ["a", "b", "c"]);
  assert.equal(moveRootTaskOnBoard(initial, "b", "source", getSameBucketDropPlacement(tasks, "b", "b"), "b"), initial);
});

test("drop placement follows the pointer, not the dragged card's center", () => {
  const lastCard = { top: 400, height: 40 }; // center 420
  // A tall card grabbed near its bottom: its center (380) is above the last card's
  // center even though the pointer (455) is below the last card.
  const tallCard = { top: 280, height: 200 };
  assert.equal(getTaskDropPlacement(tallCard, lastCard, "task", 455), "after");
  assert.equal(getTaskDropPlacement(tallCard, lastCard, "task", 410), "before");
  // Without a pointer (keyboard drag) the dragged card's center decides.
  assert.equal(getTaskDropPlacement(tallCard, lastCard, "task"), "before");
  assert.equal(getTaskDropPlacement({ top: 430, height: 40 }, lastCard, "task"), "after");
  // Dropping on a bucket appends.
  assert.equal(getTaskDropPlacement(tallCard, lastCard, "bucket", 455), "append");
});

test("cross-bucket preview supports before, after, and empty-bucket insertion", () => {
  const initial = board();
  const before = moveRootTaskOnBoard(initial, "b", "target", "before", "e");
  assert.deepEqual(ids(before, "source"), ["a", "c"]);
  assert.deepEqual(ids(before, "target"), ["d", "b", "e"]);

  const after = moveRootTaskOnBoard(initial, "b", "target", "after", "d");
  assert.deepEqual(ids(after, "target"), ["d", "b", "e"]);

  const empty = moveRootTaskOnBoard(initial, "b", "empty", "append");
  assert.deepEqual(ids(empty, "empty"), ["b"]);
});

test("task movement preserves expanded and collapsed state for every bucket combination", () => {
  for (const sourceCollapsed of [false, true]) {
    for (const targetCollapsed of [false, true]) {
      const initial = board(sourceCollapsed, targetCollapsed);
      const moved = moveRootTaskOnBoard(initial, "a", "target", "before", "d");

      assert.equal(
        moved.buckets.find((bucket) => bucket.id === "source")?.collapsed,
        sourceCollapsed,
      );
      assert.equal(
        moved.buckets.find((bucket) => bucket.id === "target")?.collapsed,
        targetCollapsed,
      );
      assert.equal(
        moved.buckets.find((bucket) => bucket.id === "empty")?.collapsed,
        targetCollapsed,
      );
    }
  }
});

test("repeated live-preview moves are deterministic and leave the drag snapshot untouched", () => {
  const snapshot = board(true, false);
  const firstPreview = moveRootTaskOnBoard(snapshot, "a", "target", "before", "e");
  const secondPreview = moveRootTaskOnBoard(firstPreview, "a", "target", "after", "e");
  const returnPreview = moveRootTaskOnBoard(secondPreview, "a", "source", "before", "b");

  assert.deepEqual(ids(firstPreview, "target"), ["d", "a", "e"]);
  assert.deepEqual(ids(secondPreview, "target"), ["d", "e", "a"]);
  assert.deepEqual(ids(returnPreview, "source"), ["a", "b", "c"]);
  assert.deepEqual(ids(snapshot, "source"), ["a", "b", "c"]);
  assert.deepEqual(ids(snapshot, "target"), ["d", "e"]);
  assert.equal(snapshot.buckets[0].collapsed, true);
});

test("invalid task and bucket targets are no-ops", () => {
  const initial = board();
  const cases: Array<[string, string, TaskDropPlacement, string?]> = [
    ["missing", "target", "append"],
    ["a", "missing", "append"],
  ];

  for (const [taskId, bucketId, placement, overTaskId] of cases) {
    assert.equal(
      moveRootTaskOnBoard(initial, taskId, bucketId, placement, overTaskId),
      initial,
    );
  }
});

test("root task lookup follows live cross-bucket movement", () => {
  const initial = board();
  const moved = moveRootTaskOnBoard(initial, "b", "target", "append");

  assert.equal(findRootTaskBucketId(initial.buckets, "b"), "source");
  assert.equal(findRootTaskBucketId(moved.buckets, "b"), "target");
  assert.equal(getRootTaskIndex(moved.buckets, "target", "b"), 2);
});
