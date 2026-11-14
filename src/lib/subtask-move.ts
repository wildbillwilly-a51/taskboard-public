// Moving subtasks inside one top-level task: nesting with Tab, un-nesting
// with Shift+Tab, and dropping a dragged row before, after, or inside
// another. A move is a new parent and a position among that parent's other
// children; the root task itself never moves here.

export type SubtaskNode = { id: string; subtasks: SubtaskNode[] };

export type SubtaskMove = { taskId: string; parentTaskId: string; targetIndex: number };

export type DropZone = "before" | "after" | "inside";

type Location = { parent: SubtaskNode; index: number; depth: number };

export function findSubtaskLocation(root: SubtaskNode, taskId: string): Location | null {
  const walk = (parent: SubtaskNode, depth: number): Location | null => {
    for (let index = 0; index < parent.subtasks.length; index += 1) {
      const child = parent.subtasks[index];
      if (child.id === taskId) {
        return { parent, index, depth };
      }
      const found = walk(child, depth + 1);
      if (found) {
        return found;
      }
    }
    return null;
  };
  return walk(root, 0);
}

function findNode(root: SubtaskNode, taskId: string): SubtaskNode | null {
  if (root.id === taskId) {
    return root;
  }
  for (const child of root.subtasks) {
    const found = findNode(child, taskId);
    if (found) {
      return found;
    }
  }
  return null;
}

function containsNode(node: SubtaskNode, taskId: string): boolean {
  return node.id === taskId || node.subtasks.some((child) => containsNode(child, taskId));
}

// Tab: into the subtask just above, as its last child.
export function getIndentMove(root: SubtaskNode, taskId: string): SubtaskMove | null {
  const location = findSubtaskLocation(root, taskId);
  if (!location || location.index === 0) {
    return null;
  }
  const previous = location.parent.subtasks[location.index - 1];
  return { taskId, parentTaskId: previous.id, targetIndex: previous.subtasks.length };
}

// Shift+Tab: out of its parent, placed right after it. A subtask directly
// under the root task stays a subtask.
export function getOutdentMove(root: SubtaskNode, taskId: string): SubtaskMove | null {
  const location = findSubtaskLocation(root, taskId);
  if (!location || location.parent.id === root.id) {
    return null;
  }
  const parentLocation = findSubtaskLocation(root, location.parent.id);
  if (!parentLocation) {
    return null;
  }
  return { taskId, parentTaskId: parentLocation.parent.id, targetIndex: parentLocation.index + 1 };
}

// A dragged row dropped on another row. The index counts the new parent's
// children without the moved row, which is how the server places it.
export function getDropMove(root: SubtaskNode, activeId: string, overId: string, zone: DropZone): SubtaskMove | null {
  const active = findNode(root, activeId);
  const over = findNode(root, overId);
  if (!active || !over || active.id === root.id || over.id === root.id || containsNode(active, overId)) {
    return null;
  }

  if (zone === "inside") {
    const remaining = over.subtasks.filter((child) => child.id !== activeId);
    return { taskId: activeId, parentTaskId: overId, targetIndex: remaining.length };
  }

  const overLocation = findSubtaskLocation(root, overId);
  if (!overLocation) {
    return null;
  }
  const siblings = overLocation.parent.subtasks.filter((child) => child.id !== activeId);
  const overIndex = siblings.findIndex((child) => child.id === overId);
  return {
    taskId: activeId,
    parentTaskId: overLocation.parent.id,
    targetIndex: zone === "before" ? overIndex : overIndex + 1,
  };
}

// Where a subtask sits now, as a move that would put it back (for Undo).
export function getCurrentPlacement(root: SubtaskNode, taskId: string): SubtaskMove | null {
  const location = findSubtaskLocation(root, taskId);
  return location ? { taskId, parentTaskId: location.parent.id, targetIndex: location.index } : null;
}

export function isNoOpMove(root: SubtaskNode, move: SubtaskMove) {
  const current = getCurrentPlacement(root, move.taskId);
  return Boolean(current && current.parentTaskId === move.parentTaskId && current.targetIndex === move.targetIndex);
}

// The tree after a move, for showing it before the server answers.
export function applySubtaskMove<T extends SubtaskNode>(root: T, move: SubtaskMove): T {
  const moving = findNode(root, move.taskId) as T | null;
  if (!moving || moving.id === root.id || containsNode(moving, move.parentTaskId)) {
    return root;
  }

  const without = (node: T): T => ({
    ...node,
    subtasks: (node.subtasks as T[]).filter((child) => child.id !== move.taskId).map(without),
  });
  const insert = (node: T): T => {
    const children = (node.subtasks as T[]).map(insert);
    if (node.id !== move.parentTaskId) {
      return { ...node, subtasks: children };
    }
    const index = Math.max(0, Math.min(move.targetIndex, children.length));
    return { ...node, subtasks: [...children.slice(0, index), moving, ...children.slice(index)] };
  };
  return insert(without(root));
}
