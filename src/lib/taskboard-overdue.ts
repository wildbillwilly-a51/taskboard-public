type OverdueCandidate = {
  status: string;
  dueAt?: string | Date | null;
  importedFrom?: { readOnly?: boolean } | null;
};

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// The moment a due date passes. A date without a time is due by the end of
// that local day, so it only turns overdue the next morning.
export function getDueDeadline(dueAt: string | Date | null | undefined) {
  if (!dueAt) {
    return null;
  }

  if (typeof dueAt === "string" && DATE_ONLY_PATTERN.test(dueAt.trim())) {
    const [year, month, day] = dueAt.trim().split("-").map(Number);
    return new Date(year, month - 1, day + 1).getTime();
  }

  const time = new Date(dueAt).getTime();
  return Number.isNaN(time) ? null : time;
}

// Overdue means still open with a due date in the past. Read-only imported
// calendar items are excluded: nobody can complete or reschedule them here.
export function isTaskOverdue(task: OverdueCandidate, now: Date | number) {
  if (task.status === "done" || task.importedFrom?.readOnly) {
    return false;
  }

  const deadline = getDueDeadline(task.dueAt);
  return deadline !== null && deadline <= (typeof now === "number" ? now : now.getTime());
}

// "Move to today" keeps the usual 5:00 PM due time; after 5 PM it uses the end
// of today so the task does not land overdue again straight away.
export function getRescheduleToTodayDueAt(now: Date) {
  const target = new Date(now);
  target.setHours(17, 0, 0, 0);

  if (target.getTime() <= now.getTime()) {
    target.setHours(23, 59, 0, 0);
  }

  return target.toISOString();
}
