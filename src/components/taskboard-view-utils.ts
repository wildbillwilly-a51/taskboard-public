import type { Board, Task, ViewFilters, ViewPreset } from "@/lib/taskboard-data";

export function applyViewPreset(board: Board, view: ViewPreset): Board {
  const filters = view.filters;
  const bucketFilter = new Set(filters.bucketIds ?? []);
  const hasTaskFilters = Boolean(
    filters.statuses?.length ||
      filters.labels?.length ||
      (filters.due && filters.due !== "any") ||
      (filters.source && filters.source !== "all"),
  );

  return {
    ...board,
    buckets: board.buckets
      .filter((bucket) => bucketFilter.size === 0 || bucketFilter.has(bucket.id))
      .map((bucket) => ({
        ...bucket,
        tasks: bucket.tasks.filter((task) => taskMatchesFilters(task, filters)),
      }))
      .filter((bucket) => !hasTaskFilters || bucket.tasks.length > 0 || bucketFilter.size > 0),
  };
}

export function taskMatchesFilters(task: Task, filters: ViewFilters) {
  if (filters.statuses?.length && !filters.statuses.includes(task.status)) {
    return false;
  }

  if (filters.labels?.length) {
    const labels = new Set(task.labels.map((label) => label.toLowerCase()));
    if (!filters.labels.some((label) => labels.has(label.toLowerCase()))) {
      return false;
    }
  }

  if (filters.source === "native" && task.importedFrom) {
    return false;
  }

  if (filters.source === "imported" && !task.importedFrom) {
    return false;
  }

  if (filters.due && filters.due !== "any") {
    const due = task.dueAt ? new Date(task.dueAt) : null;
    const now = new Date();

    if (filters.due === "with" && !due) {
      return false;
    }

    if (filters.due === "without" && due) {
      return false;
    }

    if (filters.due === "overdue" && (!due || due >= now)) {
      return false;
    }

    if (filters.due === "today" && (!due || !isSameDay(due, now))) {
      return false;
    }

    if (filters.due === "week" && (!due || due.getTime() > now.getTime() + 7 * 86400000)) {
      return false;
    }
  }

  return true;
}

export function isSameDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function buildCurrentViewFilters(board: Board, activeView: ViewPreset | null): ViewFilters {
  if (activeView) {
    return activeView.filters;
  }

  return {
    bucketIds: board.buckets.map((bucket) => bucket.id),
  };
}
