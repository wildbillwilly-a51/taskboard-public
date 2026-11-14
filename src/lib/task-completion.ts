import type { Task, TaskStatus } from "./taskboard-data";

export type TaskCompletion = "none" | "mixed" | "done";

export function getTaskCompletion(task: Task): TaskCompletion {
  if (task.subtasks.length === 0) return task.status === "done" ? "done" : "none";
  const states = task.subtasks.map(getTaskCompletion);
  if (states.every(state => state === "done")) return "done";
  return states.some(state => state !== "none") ? "mixed" : "none";
}

function setSubtreeStatus(task: Task, status: TaskStatus): Task {
  return { ...task, status, subtasks: task.subtasks.map(child => setSubtreeStatus(child, status)) };
}

// After a subtask is added, moved, or deleted, each listed parent is done
// exactly when all of its subtasks are, and a change climbs to its ancestors.
// A parent left with no subtasks keeps its status. A delete holds a recurring
// top-level task open. Mirrors the persisted rule.
export function reconcileParentCompletion(
  tasks: Task[],
  parentIds: string[],
  { holdRecurringRoot = false }: { holdRecurringRoot?: boolean } = {},
): Task[] {
  const ids = new Set(parentIds);
  const visit = (task: Task, isRoot: boolean): { task: Task; changed: boolean } => {
    let childChanged = false;
    const subtasks = task.subtasks.map(child => {
      const result = visit(child, false);
      childChanged ||= result.changed;
      return result.task;
    });
    const same = subtasks.every((child, index) => child === task.subtasks[index]);
    const next = same ? task : { ...task, subtasks };
    if (subtasks.length === 0 || !(ids.has(task.id) || childChanged)) return { task: next, changed: false };
    const allDone = subtasks.every(child => child.status === "done");
    if (allDone === (task.status === "done")) return { task: next, changed: false };
    if (allDone && holdRecurringRoot && isRoot && task.recurrence) return { task: next, changed: false };
    return { task: { ...next, status: allDone ? "done" : "todo" }, changed: true };
  };
  return tasks.map(task => visit(task, true).task);
}

// Mirror the persisted completion rules for boards without a database.
export function updateTaskCompletion(tasks: Task[], taskId: string, status: TaskStatus): Task[] {
  return tasks.map(task => {
    if (task.id === taskId) {
      return status === "done" || task.status === "done"
        ? { ...setSubtreeStatus(task, status === "done" ? "done" : "todo"), status }
        : { ...task, status };
    }
    const subtasks = updateTaskCompletion(task.subtasks, taskId, status);
    if (subtasks.every((child, index) => child === task.subtasks[index])) return task;
    const allDone = subtasks.every(child => child.status === "done");
    return { ...task, subtasks, status: allDone ? "done" : task.status === "done" ? "todo" : task.status };
  });
}
