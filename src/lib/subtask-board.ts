// The work tab's board: every subtask is a box of its own, nested the way
// the subtasks are. Nothing is grouped by status, and opening an item never
// leaves the board: it is shown in a side panel. The board, the work list,
// and the timeline all read and change the same subtasks.

import type { Task } from "./taskboard-data";
import { bucketColor } from "./bucket-colors";
import { getTaskCompletion } from "./task-completion";
import { findSubtaskLocation, type SubtaskMove } from "./subtask-move";
import { getItemSpan, isOutsideWindow } from "./work-windows";

export function findBoardItem(root: Task, taskId: string): Task | null {
  if (root.id === taskId) return root;
  for (const child of root.subtasks) {
    const found = findBoardItem(child, taskId);
    if (found) return found;
  }
  return null;
}

// The items above one, from the top-level card down to its parent. The root
// task itself is left out. An id no longer in the tree has no path.
export function getAncestors(root: Task, taskId: string): Task[] | null {
  const walk = (task: Task, above: Task[]): Task[] | null => {
    for (const child of task.subtasks) {
      if (child.id === taskId) return above;
      const found = walk(child, [...above, child]);
      if (found) return found;
    }
    return null;
  };
  return walk(root, []);
}

export function countDone(task: Task) {
  return task.subtasks.filter((child) => getTaskCompletion(child) === "done").length;
}

// Where an item can be moved with Move to: the task itself (as a top-level
// card) and every other item, in list order, except the item and the work
// under it. Each label names the items above it, so repeated titles such as
// "Windows Updates" under two hosts can be told apart.
export type MoveTarget = { id: string; label: string; isRoot: boolean };

const shortTitle = (title: string) => (title.length > 32 ? `${title.slice(0, 31)}…` : title);

export function getMoveTargets(root: Task, taskId: string): MoveTarget[] {
  const targets: MoveTarget[] = [{ id: root.id, label: root.title, isRoot: true }];
  const walk = (task: Task, above: string[]) => {
    for (const child of task.subtasks) {
      if (child.id === taskId) continue;
      const path = [...above, shortTitle(child.title)];
      targets.push({ id: child.id, label: path.join(" › "), isRoot: false });
      walk(child, path);
    }
  };
  walk(root, []);
  return targets;
}

// Into another parent, after its last child.
export function getMoveToMove(root: Task, taskId: string, parentTaskId: string): SubtaskMove | null {
  const parent = findBoardItem(root, parentTaskId);
  const location = findSubtaskLocation(root, taskId);
  if (!parent || !location || location.parent.id === parentTaskId) return null;
  const moving = findBoardItem(root, taskId);
  if (!moving || findBoardItem(moving, parentTaskId)) return null;
  return { taskId, parentTaskId, targetIndex: parent.subtasks.length };
}

// A card or row dropped on a sibling takes that sibling's place, as the
// sortable list shows it. Rows only move among their own parent's children;
// anything else is not a move.
export function getSiblingMove(root: Task, activeId: string, overId: string): SubtaskMove | null {
  const active = findSubtaskLocation(root, activeId);
  const over = findSubtaskLocation(root, overId);
  if (!active || !over || active.parent.id !== over.parent.id || active.index === over.index) return null;
  return { taskId: activeId, parentTaskId: active.parent.id, targetIndex: over.index };
}

// One step up or down among its siblings, for the panel's buttons.
export function getStepMove(root: Task, taskId: string, step: -1 | 1): SubtaskMove | null {
  const location = findSubtaskLocation(root, taskId);
  if (!location) return null;
  const target = location.index + step;
  if (target < 0 || target >= location.parent.subtasks.length) return null;
  return { taskId, parentTaskId: location.parent.id, targetIndex: target };
}

// The status a column, card, or step shows. Work with everything under it done
// shows done, as the list does, even if its own stored status lags behind.
export function getBoardStatus(task: Task): Task["status"] {
  if (getTaskCompletion(task) === "done") return "done";
  return task.status === "done" ? "todo" : task.status;
}

// Which of a parent's children to show while its list is closed: the first
// ones still open, in order, plus a selected one so it stays in view. One
// extra item is shown rather than hidden behind a link. Done items show in
// place once the whole list is open.
export type BoardPreview = { shown: Task[]; hiddenDone: number };

export function getPreview(children: Task[], limit: number, selectedId: string | null, showingAll: boolean): BoardPreview {
  if (showingAll || children.length <= limit + 1) return { shown: children, hiddenDone: 0 };
  const open = children.filter((child) => getTaskCompletion(child) !== "done");
  const picked = new Set((open.length > 0 ? open : children).slice(0, limit));
  const selected = children.find((child) => child.id === selectedId);
  if (selected) picked.add(selected);
  const shown = children.filter((child) => picked.has(child));
  const hiddenDone = children.filter((child) => !picked.has(child) && getTaskCompletion(child) === "done").length;
  return { shown, hiddenDone };
}

// A top-level column's color: the next color of the board palette by
// position, so neighboring columns differ. Subtasks have no color of their
// own (see subtask-rule.ts).
export function getColumnColor(index: number, palette: readonly string[]): string {
  return palette[index % palette.length];
}

// The bucket palette, ordered so neighboring columns contrast.
export const WORKSTREAM_PALETTE = (["Ember", "Teal", "Violet", "Amber", "Blue", "Rose", "Lime", "Cyan", "Indigo"] as const).map(bucketColor);

// A top-level subtask's workstream color, the same one the Board gives its
// column; List rows and Timeline strips use it for that subtask's work.
export function getWorkstreamColor(root: Task, topLevel: Task): string {
  return getColumnColor(root.subtasks.indexOf(topLevel), WORKSTREAM_PALETTE);
}

// The window an item has to fit: its nearest timed parent below the task
// itself, as the work list checks it. Returns that parent when the item's
// time falls outside it.
export function getOutsideWindow(root: Task, taskId: string): Task | null {
  const above = getAncestors(root, taskId);
  const item = findBoardItem(root, taskId);
  if (!above || !item || !getItemSpan(item)) return null;
  const timeWindow = [...above].reverse().find((ancestor) => getItemSpan(ancestor));
  return timeWindow && isOutsideWindow(timeWindow, item) ? timeWindow : null;
}

// A card dropped into another column: before the card it was dropped on, or
// at the end when dropped on the column itself. Positions count the whole
// column, including cards a closed list hides. Only cards (the columns' own
// work) move this way; columns and checklist items stay among their siblings.
export function getCardDropMove(root: Task, activeId: string, columnId: string, beforeId: string | null): SubtaskMove | null {
  const location = findSubtaskLocation(root, activeId);
  const column = root.subtasks.find((child) => child.id === columnId);
  if (!location || !column || location.parent.id === root.id || beforeId === activeId) return null;
  const remaining = column.subtasks.filter((child) => child.id !== activeId);
  const targetIndex = beforeId === null ? remaining.length : remaining.findIndex((child) => child.id === beforeId);
  if (targetIndex < 0) return null;
  return { taskId: activeId, parentTaskId: columnId, targetIndex };
}
