import type { Board, CalendarSource, Task, TaskIcon, TaskRecurrenceRule, TaskStatus } from "@/lib/taskboard-data";
import { normalizeCalendarTaskDate } from "@/lib/calendar-date-utils";
import { getItemSpan, getWindowFill } from "@/lib/work-windows";
import { getWorkstreamColor } from "@/lib/subtask-board";

type TaskImportMetadata = {
  source: CalendarSource;
  readOnly: boolean;
  convertToTask: boolean;
  providerLabel: string;
  syncStatus?: "active" | "stale" | "deleted";
  isRecurring?: boolean;
};

export type TaskboardCalendarTaskEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  color: string;
  backgroundColor: string;
  data: {
    kind: "taskboard-task";
    source: string;
    sourceType: "task";
    status: string;
    badge: string;
    owner: string;
    readOnly: boolean;
    taskEditable: boolean;
    linkedTaskId: string;
    tone: "task";
    taskId: string;
    boardId: string;
    taskStatus: TaskStatus;
    taskIcon: TaskIcon;
    taskStartAt?: string;
    taskEndAt?: string;
    taskDueAt?: string;
    bucketId: string;
    bucketTitle: string;
    bucketColor: string;
    labels: string[];
    summary?: string;
    parentTaskTitle?: string;
    importedFrom?: TaskImportMetadata;
    hasRecurrence?: boolean;
    workItemType?: "task" | "maintenance_outage";
    outageLocation?: string;
    outageOwner?: string;
    /** The outage this item is, or belongs to as a subtask. */
    outageTaskId?: string;
    /** Short name for the outage: its location, else its title ("ELD"). */
    outageLabel?: string;
    /** A timed subtask with work under it is a window; its children are work. */
    windowRole?: "window" | "work";
    /** For work, the window it sits in. */
    windowTaskId?: string;
    windowFill?: CalendarWindowFill;
  };
};

export type CalendarWindowFill = {
  totalHours: number;
  scheduledHours: number;
  scheduledCount: number;
  unscheduledCount: number;
};

function formatHoursValue(hours: number) {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

// "3 scheduled · 5 of 9 h": how full a window is, for its calendar chip.
export function formatWindowFillSummary(fill: CalendarWindowFill | undefined) {
  if (!fill || fill.scheduledCount === 0) {
    return "Nothing scheduled yet";
  }

  return `${fill.scheduledCount} scheduled · ${formatHoursValue(fill.scheduledHours)} of ${formatHoursValue(fill.totalHours)} h`;
}

type FlattenedTask = {
  task: Task;
  bucketId: string;
  bucketTitle: string;
  bucketColor: string;
  parentTaskTitle?: string;
  parent?: Task;
  parentIsWindow?: boolean;
  outage?: Task;
  // Subtasks have no color of their own; their work shows in the color the
  // task's List, Board and Timeline give that workstream.
  workstreamColor?: string;
};

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;
const fallbackTaskColor = "#0f766e";

function isDateOnly(value: string) {
  return dateOnlyPattern.test(value.trim());
}

function addDaysToDateOnly(value: string, days: number) {
  const date = new Date(`${value.trim()}T00:00:00`);
  date.setDate(date.getDate() + days);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function addHours(value: string, hours: number) {
  return new Date(Date.parse(value.trim()) + hours * 60 * 60 * 1000).toISOString();
}

function addDays(value: string, days: number) {
  if (isDateOnly(value)) {
    return addDaysToDateOnly(value, days);
  }

  return new Date(Date.parse(value.trim()) + days * 24 * 60 * 60 * 1000).toISOString();
}

function compareDates(left: string, right: string) {
  return Date.parse(left.trim()) - Date.parse(right.trim());
}

function getTaskDateRange(task: Task) {
  const startAt = normalizeCalendarTaskDate(task.startAt);
  const endAt = normalizeCalendarTaskDate(task.endAt);
  const dueAt = normalizeCalendarTaskDate(task.dueAt);

  if (!startAt && !endAt && !dueAt) {
    return null;
  }

  if (startAt && endAt) {
    const allDay = Boolean(task.allDay) || (isDateOnly(startAt) && isDateOnly(endAt));
    const orderedEnd = compareDates(endAt, startAt) > 0;
    const end = orderedEnd ? endAt : addHours(startAt, 1);

    return {
      start: startAt,
      end: allDay ? addDays(orderedEnd ? endAt : startAt, 1) : end,
      allDay,
      taskStartAt: startAt,
      taskEndAt: endAt,
      taskDueAt: dueAt,
    };
  }

  const singleDate = startAt ?? endAt ?? dueAt;

  if (!singleDate) {
    return null;
  }

  if (task.allDay || isDateOnly(singleDate)) {
    return {
      start: singleDate,
      end: addDays(singleDate, 1),
      allDay: true,
      ...(startAt ? { taskStartAt: startAt } : {}),
      ...(endAt ? { taskEndAt: endAt } : {}),
      ...(dueAt ? { taskDueAt: dueAt } : {}),
    };
  }

  return {
    start: singleDate,
    end: addHours(singleDate, 1),
    allDay: false,
    ...(startAt ? { taskStartAt: startAt } : {}),
    ...(endAt ? { taskEndAt: endAt } : {}),
    ...(dueAt ? { taskDueAt: dueAt } : {}),
  };
}

function hexToRgba(value: string, alpha: number) {
  const normalized = value.trim();
  const match = /^#?([0-9a-f]{6})$/i.exec(normalized);

  if (!match) {
    return `rgba(15, 118, 110, ${alpha})`;
  }

  const hex = match[1];
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function flattenTasks(
  tasks: Task[],
  bucketId: string,
  bucketTitle: string,
  bucketColor: string,
  parent?: Task,
  inheritedOutage?: Task,
  parentIsWindow = false,
  root?: Task,
  inheritedWorkstreamColor?: string,
): FlattenedTask[] {
  return tasks.flatMap((task) => {
    const outage = task.workItemType === "maintenance_outage" ? task : inheritedOutage;
    const workstreamColor = root && parent === root ? getWorkstreamColor(root, task) : inheritedWorkstreamColor;
    return [
      {
        task,
        bucketId,
        bucketTitle,
        bucketColor,
        ...(parent ? { parent, parentTaskTitle: parent.title, parentIsWindow } : {}),
        ...(outage ? { outage } : {}),
        ...(workstreamColor ? { workstreamColor } : {}),
      },
      ...flattenTasks(
        task.subtasks,
        bucketId,
        bucketTitle,
        bucketColor,
        task,
        outage,
        isWindowTask(task, parent),
        root ?? task,
        workstreamColor,
      ),
    ];
  });
}

// Same rule as the task workspace: a subtask with a start and end and work
// under it is a window.
function isWindowTask(task: Task, parent: Task | undefined) {
  return Boolean(parent && task.subtasks.length > 0 && getItemSpan(task));
}

function getCalendarWindowFill(task: Task): CalendarWindowFill | undefined {
  const fill = getWindowFill(task, task.subtasks);
  if (!fill) {
    return undefined;
  }

  const scheduledCount = task.subtasks.filter((child) => getItemSpan(child)).length;
  return {
    ...fill,
    scheduledCount,
    unscheduledCount: task.subtasks.length - scheduledCount,
  };
}

function getOutageLabel(outage: Task) {
  return outage.maintenanceOutage?.locationName?.trim() || outage.title;
}

function getWindowContext({ task, parent, parentIsWindow, outage }: FlattenedTask) {
  const role = isWindowTask(task, parent)
    ? ("window" as const)
    : parentIsWindow
      ? ("work" as const)
      : undefined;
  const windowFill = role === "window" ? getCalendarWindowFill(task) : undefined;

  return {
    ...(outage ? { outageTaskId: outage.id, outageLabel: getOutageLabel(outage) } : {}),
    ...(role ? { windowRole: role } : {}),
    ...(role === "work" && parent ? { windowTaskId: parent.id } : {}),
    ...(windowFill ? { windowFill } : {}),
  };
}

function getTaskStatusLabel(task: Task) {
  if (task.workItemType === "maintenance_outage") {
    return "Maintenance outage";
  }
  if (task.importedFrom && !task.importedFrom.readOnly && task.importedFrom.convertToTask) {
    return "Converted Taskboard task";
  }

  if (task.importedFrom?.readOnly) {
    return getImportedProviderDisplayLabel(task.importedFrom.source);
  }

  if (task.status === "done") {
    return "Completed Taskboard task";
  }

  return "Taskboard task";
}

function getImportedProviderDisplayLabel(source: CalendarSource) {
  switch (source) {
    case "google":
      return "Google";
    case "ics":
      return "ICS";
    default:
      return "Calendar";
  }
}

function getTaskBadge(task: Task): TaskboardCalendarTaskEvent["data"]["badge"] {
  if (task.workItemType === "maintenance_outage") {
    return "Maintenance outage";
  }
  if (task.importedFrom && !task.importedFrom.readOnly && task.importedFrom.convertToTask) {
    return "Converted task";
  }

  if (task.importedFrom?.readOnly) {
    return getImportedProviderDisplayLabel(task.importedFrom.source);
  }

  return "Taskboard task";
}

function isTaskEditable(task: Task) {
  return !task.importedFrom?.readOnly;
}

function hasRecurrence(recurrence: TaskRecurrenceRule | undefined) {
  return Boolean(recurrence);
}

export function mapBoardTasksToCalendarEvents(board: Board): TaskboardCalendarTaskEvent[] {
  return board.buckets
    .flatMap((bucket) => flattenTasks(bucket.tasks, bucket.id, bucket.title, bucket.color))
    .flatMap((item) => {
      const { task, bucketId, bucketTitle, bucketColor, parentTaskTitle } = item;
      const range = getTaskDateRange(task);

      if (!range) {
        return [];
      }

      const color = item.workstreamColor ?? (task.color || fallbackTaskColor);
      const importedFrom = task.importedFrom
        ? {
            ...task.importedFrom,
            providerLabel: getImportedProviderDisplayLabel(task.importedFrom.source),
          }
        : undefined;

      return [
        {
          id: `taskboard-${task.id}`,
          title: task.title,
          start: range.start,
          end: range.end,
          ...(range.allDay ? { allDay: true } : {}),
          color,
          backgroundColor: hexToRgba(color, 0.18),
          data: {
            kind: "taskboard-task",
            source: task.importedFrom?.readOnly
              ? getImportedProviderDisplayLabel(task.importedFrom.source)
              : "Taskboard",
            sourceType: "task",
            status: getTaskStatusLabel(task),
            // Work inside an outage is labelled with the outage, not the
            // generic task badge.
            badge: item.outage && item.outage !== task ? getOutageLabel(item.outage) : getTaskBadge(task),
            owner: task.maintenanceOutage?.owner || "Taskboard",
            readOnly: Boolean(task.importedFrom?.readOnly),
            taskEditable: isTaskEditable(task),
            linkedTaskId: task.id,
            tone: "task",
            taskId: task.id,
            boardId: board.id,
            taskStatus: task.status,
            taskIcon: task.icon,
            ...(range.taskStartAt ? { taskStartAt: range.taskStartAt } : {}),
            ...(range.taskEndAt ? { taskEndAt: range.taskEndAt } : {}),
            ...(range.taskDueAt ? { taskDueAt: range.taskDueAt } : {}),
            bucketId,
            bucketTitle,
            bucketColor,
            labels: task.labels,
            ...(task.summary ? { summary: task.summary } : {}),
            ...(parentTaskTitle ? { parentTaskTitle } : {}),
            ...(importedFrom ? { importedFrom } : {}),
            ...(hasRecurrence(task.recurrence) ? { hasRecurrence: true } : {}),
            workItemType: task.workItemType ?? "task",
            ...(task.maintenanceOutage?.locationName
              ? { outageLocation: task.maintenanceOutage.locationName }
              : {}),
            ...(task.maintenanceOutage?.owner
              ? { outageOwner: task.maintenanceOutage.owner }
              : {}),
            ...getWindowContext(item),
          },
        },
      ];
    });
}
