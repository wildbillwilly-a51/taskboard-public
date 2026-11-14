import type { Task, TaskStatus } from "@/lib/taskboard-data";

// The actions one task offers, in one place, for every surface that lists
// them: the right-click menu, the Ctrl+K palette's task section and the task
// editor's "…" menu. Each surface binds the ids to its handlers; what is
// shown, enabled and checked, and why an item is disabled, is decided here.

export type TaskActionSurface = "menu" | "palette" | "editor";

export type TaskActionId =
  | "open"
  | "open-workspace"
  | "time"
  | `status-${TaskStatus}`
  | "due"
  | "snooze"
  | "move"
  | "view-calendar"
  | "promote"
  | "follow-up"
  | "convert"
  | "archive"
  | "delete";

export type TaskAction = {
  id: TaskActionId;
  label: string;
  enabled: boolean;
  disabledReason?: string;
  /** Defined for the status choices: whether this is the task's status. */
  checked?: boolean;
  /** The item starts a new group in a menu. */
  separator?: boolean;
  danger?: boolean;
};

export type TaskActionContext = {
  canEditBoard: boolean;
  /**
   * Archive, Delete and the Done click that archives. On a team board with
   * lifecycle managers switched on, only a team manager has these.
   */
  canManageLifecycle: boolean;
  isRootTask: boolean;
  /** Archived but still shown in the inspector (Done stays). */
  isArchived: boolean;
  hasCalendarLink: boolean;
};

export const TASK_ACTION_STATUSES: TaskStatus[] = ["todo", "active", "waiting", "done"];

const STATUS_LABELS: Record<TaskStatus, string> = {
  todo: "To do",
  active: "Active",
  waiting: "Waiting",
  done: "Done",
};

// Why a task cannot be changed from here, or null when it can. "schedule"
// covers dates.
export function getTaskEditBlockReason(
  task: Pick<Task, "title" | "importedFrom">,
  canEditBoard: boolean,
  scope: "task" | "schedule",
) {
  if (!canEditBoard) {
    return "You can view this board, but you do not have permission to edit tasks.";
  }
  if (task.importedFrom?.readOnly) {
    return `"${task.title}" is a read-only calendar import, so it can't be changed here.`;
  }
  return null;
}

const VIEWER_REASON = "You can view this board, but you do not have permission to edit tasks.";

export function getTaskActions(
  task: Pick<Task, "title" | "status" | "importedFrom" | "workItemType">,
  context: TaskActionContext,
  surface: TaskActionSurface,
): TaskAction[] {
  const { canEditBoard, canManageLifecycle, isRootTask, isArchived, hasCalendarLink } = context;
  const actions: TaskAction[] = [];
  if (isArchived) {
    return actions;
  }

  const taskReason = getTaskEditBlockReason(task, canEditBoard, "task");
  const scheduleReason = getTaskEditBlockReason(task, canEditBoard, "schedule");
  const isReadOnlyImport = Boolean(task.importedFrom?.readOnly);
  const isImported = Boolean(task.importedFrom);
  const boardReason = canEditBoard ? undefined : VIEWER_REASON;

  if (surface !== "editor") {
    actions.push(
      { id: "open", label: surface === "palette" ? "Open in sidebar" : "Open", enabled: true },
      { id: "open-workspace", label: "Open task workspace", enabled: true },
    );
  }

  // A subtask has its own title, done state, time and work inside. Everything
  // else belongs to the top task (subtask-rule.ts). Omit refused actions from
  // every surface, rather than displaying commands that can only fail.
  if (!isRootTask) {
    if (surface !== "editor") {
      actions[0].label = "Edit subtask";
      actions[1].label = "Open work inside";
      for (const [index, status] of (["todo", "done"] as const).entries()) {
        actions.push({
          id: `status-${status}`,
          label: surface === "palette" ? `Set to ${STATUS_LABELS[status]}` : STATUS_LABELS[status],
          enabled: !taskReason && task.status !== status,
          disabledReason: taskReason ?? undefined,
          checked: surface === "menu" ? task.status === status : undefined,
          separator: surface === "menu" && index === 0,
        });
      }
      actions.push({ id: "time", label: "Set time…", enabled: !scheduleReason, disabledReason: scheduleReason ?? undefined });
      if (hasCalendarLink) actions.push({ id: "view-calendar", label: "View in Calendar", enabled: true });
    }
    if (surface !== "palette") actions.push({
      id: "delete", label: "Delete subtask", enabled: canEditBoard && canManageLifecycle,
      disabledReason: boardReason ?? (canManageLifecycle ? undefined : "Only a team manager can delete tasks on this board."),
      danger: true, separator: surface === "menu",
    });
    return actions;
  }

  if (surface !== "editor" && (surface === "palette" || !isReadOnlyImport)) {
    TASK_ACTION_STATUSES.forEach((status, index) => {
      // Done on a done root task archives it, as the "4" shortcut does, for
      // those who may archive; for others it is simply the current status.
      const archivesFromDone = status === "done" && task.status === "done" && isRootTask && canManageLifecycle;
      const isCurrent = task.status === status && !archivesFromDone;
      actions.push({
        id: `status-${status}`,
        label: surface === "palette"
          ? archivesFromDone ? "Done: Archive" : `Set to ${STATUS_LABELS[status]}`
          : archivesFromDone ? "Done: Archive" : STATUS_LABELS[status],
        enabled: !taskReason && !isCurrent,
        disabledReason: taskReason ?? undefined,
        // The palette marks the current status in its own way.
        checked: surface === "menu" ? task.status === status : undefined,
        separator: surface === "menu" && index === 0,
      });
    });

    actions.push(
      {
        id: "due",
        label: surface === "palette" ? "Set due date" : "Set due date…",
        enabled: !scheduleReason,
        disabledReason: scheduleReason ?? undefined,
        separator: surface === "menu",
      },
      { id: "snooze", label: surface === "palette" ? "Snooze" : "Snooze…", enabled: !scheduleReason, disabledReason: scheduleReason ?? undefined },
      {
        id: "move",
        label: surface === "palette" ? "Move to bucket" : "Move to bucket…",
        enabled: !taskReason && isRootTask,
        disabledReason: taskReason ?? (isRootTask ? undefined : "A subtask moves with its parent task."),
      },
    );
  }

  if (surface === "palette") {
    return actions;
  }

  if (surface === "menu" && hasCalendarLink) {
    actions.push({ id: "view-calendar", label: "View in Calendar", enabled: true, separator: true });
  }

  if (isRootTask && task.workItemType !== "maintenance_outage" && !isReadOnlyImport) {
    actions.push({
      id: "promote",
      label: "Promote to outage",
      enabled: !taskReason,
      disabledReason: taskReason ?? undefined,
      separator: surface === "menu" && !hasCalendarLink,
    });
  }

  if (surface === "menu" && isImported) {
    actions.push({ id: "follow-up", label: "Create follow-up task", enabled: canEditBoard, disabledReason: boardReason, separator: true });
    if (task.importedFrom?.convertToTask) {
      actions.push({ id: "convert", label: "Convert to task", enabled: canEditBoard, disabledReason: boardReason });
    }
  }

  // Archive on a subtask archives its whole task, as the editor menu always has.
  const lifecycleReason = (verb: string) =>
    boardReason ?? (canManageLifecycle ? undefined : `Only a team manager can ${verb} tasks on this board.`);
  actions.push(
    {
      id: "archive",
      label: "Archive",
      enabled: canEditBoard && canManageLifecycle,
      disabledReason: lifecycleReason("archive"),
      separator: surface === "menu",
    },
    {
      id: "delete",
      label: surface === "menu" && isImported ? "Move import to recycle bin" : "Delete",
      enabled: canEditBoard && canManageLifecycle,
      disabledReason: lifecycleReason("delete"),
      danger: true,
    },
  );

  return actions;
}
