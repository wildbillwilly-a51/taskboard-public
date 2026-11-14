"use client";

import {
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
  ExternalLink,
  Maximize2,
  Minimize2,
  PanelRightOpen,
  Plus,
  RotateCcw,
  Trash2,
  X,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { holdLiveRefresh, trackBoardWrite } from "@/components/use-live-board-revision";
import type {
  DateSelectArg,
  DatesSetArg,
  EventApi,
  EventContentArg,
  EventInput,
} from "@fullcalendar/core";
import dayGridPlugin from "@fullcalendar/daygrid";
import interactionPlugin, {
  type DateClickArg,
  type EventResizeDoneArg,
} from "@fullcalendar/interaction";
import FullCalendar from "@fullcalendar/react";
import timeGridPlugin from "@fullcalendar/timegrid";
import dayjs, { type Dayjs } from "dayjs";
import Link from "next/link";
import { useUiSettings } from "@/components/settings-provider";

import type { CalendarBoardBucketOption, CalendarBoardContext, CalendarBoardOption, CalendarFocusContext, CalendarPhoneActions } from "@/components/calendar-proof";
import { MobileCalendar, PhoneCalendarSheet } from "@/components/mobile-calendar";
import { SafeLinkifiedText } from "@/components/safe-linkified-text";
import { mapCalendarEntriesToCalendarEvents } from "@/lib/calendar-entry-events";
import { normalizeCalendarTimeSelection } from "@/lib/calendar-date-utils";
import { calendarEventMatchesMode, isOutageCalendarEvent as isOutageEvent } from "@/lib/calendar-event-visibility";
import "./calendar-accents.css";
import type { CalendarEntry } from "@/lib/taskboard-data";
import {
  formatWindowFillSummary,
  type CalendarWindowFill,
  type TaskboardCalendarTaskEvent,
} from "@/lib/calendar-task-events";
import type { TaskboardCalendarSourceEvent } from "@/lib/calendar-source-events";
import {
  getEffectiveCalendarTaskResizeRange,
  isTimedCalendarResizeRange,
  resizeCalendarRangeByKeyboard,
  resizeCalendarRangeToDateSpan,
  type CalendarResizeEdge,
  type CalendarResizeRange,
  type CalendarTaskScheduleScope,
  type CalendarTaskScheduleUpdate,
} from "@/lib/calendar-resize";

type CalendarView = "month" | "week" | "day";

type ProofKind = "sample-source" | "imported-source" | "calendar-entry" | "taskboard-task" | "converted-task";

type ProofData = {
  kind: ProofKind;
  source: string;
  sourceType: "meeting" | "appointment" | "calendar-event" | "task";
  status: string;
  badge: string;
  owner: string;
  readOnly: boolean;
  importedEventId?: string;
  sourceEventId?: string;
  linkedTaskId?: string;
  suppressedSourceTitle?: string;
  tone: "sample" | "stored" | "calendar" | "task" | "converted";
  provider?: string;
  providerLabel?: string;
  syncStatus?: string;
  suppressLinkedTaskEvent?: boolean;
  taskId?: string;
  boardId?: string;
  taskStatus?: string;
  taskEditable?: boolean;
  taskIcon?: string;
  taskStartAt?: string;
  taskEndAt?: string;
  taskDueAt?: string;
  bucketId?: string;
  bucketTitle?: string;
  bucketColor?: string;
  workItemType?: "task" | "maintenance_outage";
  outageLocation?: string;
  outageOwner?: string;
  outageTaskId?: string;
  outageLabel?: string;
  windowRole?: "window" | "work";
  windowTaskId?: string;
  windowFill?: CalendarWindowFill;
  /** Shown as an overlay: the viewer's own events on the Outages calendar. */
  overlay?: "mine" | "other";
  labels?: string[];
  summary?: string;
  parentTaskTitle?: string;
  importedFrom?: {
    source: string;
    readOnly: boolean;
    convertToTask: boolean;
    providerLabel: string;
    syncStatus?: string;
    isRecurring?: boolean;
  };
  hasRecurrence?: boolean;
  calendarEntryId?: string;
};

type ProofEvent = {
  id: string;
  title: string;
  start: string | Dayjs;
  end: string | Dayjs;
  allDay?: boolean;
  color?: string;
  backgroundColor?: string;
  location?: string;
  data: ProofData;
};

export type CalendarEvent = ProofEvent;

export type CalendarEventFilter = "all" | "taskboard" | "calendar" | "stored" | "converted" | "outage";

type CalendarResizeDraft = {
  edge: CalendarResizeEdge;
  event: CalendarEvent;
  input: "keyboard" | "pointer";
  original: CalendarResizeRange;
  proposed: CalendarResizeRange;
  revert?: () => void;
};

type CalendarScheduleOverride = CalendarResizeRange;

const calendarEventFilters: Array<{
  id: CalendarEventFilter;
  label: string;
  ariaLabel: string;
}> = [
  { id: "all", label: "All", ariaLabel: "Show all calendar events" },
  { id: "taskboard", label: "Tasks", ariaLabel: "Show Taskboard task events" },
  { id: "calendar", label: "Calendar", ariaLabel: "Show native calendar items" },
  { id: "stored", label: "Imports", ariaLabel: "Show imported calendar events" },
  { id: "converted", label: "Converted", ariaLabel: "Show converted task events" },
];

const visibleBusinessStartHour = 7;
const visibleBusinessEndHour = 20;
const fullCalendarPlugins = [dayGridPlugin, timeGridPlugin, interactionPlugin];
const defaultCalendarScrollTime = "07:00:00";
const minCalendarViewportHeight = 360;

// Height that ends the calendar at the bottom of the window. Padding, borders,
// and margins of the ancestors below it are subtracted so the page itself does
// not overflow. Sibling content, such as a taller inspector, is ignored.
function getCalendarViewportHeight(calendarElement: HTMLElement) {
  let bottomInset = Number.parseFloat(window.getComputedStyle(calendarElement).marginBottom) || 0;
  for (
    let ancestor = calendarElement.parentElement;
    ancestor && ancestor !== document.documentElement;
    ancestor = ancestor.parentElement
  ) {
    const styles = window.getComputedStyle(ancestor);
    bottomInset +=
      (Number.parseFloat(styles.paddingBottom) || 0) +
      (Number.parseFloat(styles.borderBottomWidth) || 0) +
      (Number.parseFloat(styles.marginBottom) || 0);
  }

  const documentTop = calendarElement.getBoundingClientRect().top + window.scrollY;
  return Math.max(
    minCalendarViewportHeight,
    Math.floor(window.innerHeight - documentTop - bottomInset),
  );
}

function startOfWorkWeek(date: Dayjs) {
  const daysSinceMonday = (date.day() + 6) % 7;
  return date.startOf("day").subtract(daysSinceMonday, "day");
}

function at(weekStart: Dayjs, dayOffset: number, hour: number, minute = 0) {
  return weekStart.add(dayOffset, "day").hour(hour).minute(minute).second(0);
}

function makeConvertedTask(source: ProofEvent): ProofEvent {
  const sourceEventId = source.data.sourceEventId ?? String(source.id);

  return {
    ...source,
    id: `task-from-${sourceEventId}`,
    title: `Task: ${source.title}`,
    color: "#0f766e",
    backgroundColor: "rgba(15, 118, 110, 0.16)",
    data: {
      kind: "converted-task",
      source: "Taskboard",
      sourceType: "task",
      status: "Local sample task",
      badge: "Local sample",
      owner: "Local session",
      readOnly: true,
      sourceEventId,
      linkedTaskId: `local-task-${sourceEventId}`,
      suppressedSourceTitle: source.title,
      tone: "converted",
    },
  };
}

function buildMockEvents(weekStart: Dayjs): ProofEvent[] {
  return [
    {
      id: "sample-leadership-sync",
      title: "Leadership sync",
      start: at(weekStart, 1, 10),
      end: at(weekStart, 1, 11),
      color: "#2563eb",
      backgroundColor: "rgba(37, 99, 235, 0.16)",
      location: "Teams",
      data: {
        kind: "sample-source",
        source: "Sample calendar",
        sourceType: "meeting",
        status: "Sample calendar",
        badge: "Sample calendar",
        owner: "Sample imports",
        readOnly: true,
        sourceEventId: "sample-leadership-sync",
        tone: "sample",
      },
    },
    {
      id: "sample-dentist",
      title: "Dentist appointment",
      start: at(weekStart, 2, 14, 30),
      end: at(weekStart, 2, 15, 30),
      color: "#7c3aed",
      backgroundColor: "rgba(124, 58, 237, 0.16)",
      location: "Personal",
      data: {
        kind: "sample-source",
        source: "Sample calendar",
        sourceType: "appointment",
        status: "Sample calendar",
        badge: "Sample calendar",
        owner: "Sample imports",
        readOnly: true,
        taskEditable: false,
        sourceEventId: "sample-dentist",
        tone: "sample",
      },
    },
    {
      id: "taskboard-calendar-brief",
      title: "Draft calendar brief",
      start: at(weekStart, 3, 9),
      end: at(weekStart, 3, 11),
      color: "#b45309",
      backgroundColor: "rgba(180, 83, 9, 0.18)",
      data: {
        kind: "taskboard-task",
        source: "Taskboard",
        sourceType: "task",
        status: "Read-only Taskboard task",
        badge: "Taskboard task",
        owner: "Taskboard",
        readOnly: true,
        taskEditable: false,
        linkedTaskId: "local-task-calendar-brief",
        tone: "task",
      },
    },
    {
      id: "taskboard-all-day-review",
      title: "Release notes review",
      start: at(weekStart, 4, 0),
      end: at(weekStart, 5, 0),
      allDay: true,
      color: "#b45309",
      backgroundColor: "rgba(180, 83, 9, 0.16)",
      data: {
        kind: "taskboard-task",
        source: "Taskboard",
        sourceType: "task",
        status: "Read-only Taskboard task",
        badge: "Taskboard task",
        owner: "Taskboard",
        readOnly: true,
        linkedTaskId: "local-task-release-notes-review",
        tone: "task",
      },
    },
    {
      id: "sample-quarterly-plan",
      title: "Quarterly planning block",
      start: at(weekStart, 4, 13),
      end: at(weekStart, 4, 14, 30),
      color: "#2563eb",
      backgroundColor: "rgba(37, 99, 235, 0.16)",
      location: "Teams",
      data: {
        kind: "sample-source",
        source: "Sample calendar",
        sourceType: "meeting",
        status: "Sample calendar",
        badge: "Sample calendar",
        owner: "Sample imports",
        readOnly: true,
        sourceEventId: "sample-quarterly-plan",
        tone: "sample",
      },
    },
  ];
}

function getProofData(event: CalendarEvent): ProofData {
  return event.data as ProofData;
}

function formatTime(event: CalendarEvent) {
  if (event.allDay) {
    return "All day";
  }

  const start = dayjs(event.start);
  const end = dayjs(event.end);

  if (!start.isSame(end, "day")) {
    return `${start.format("MMM D, h:mm A")} - ${end.format("MMM D, h:mm A")}`;
  }

  return `${start.format("h:mm A")} - ${end.format("h:mm A")}`;
}

function formatCompactTime(event: CalendarEvent) {
  if (event.allDay) {
    return "All day";
  }

  const start = dayjs(event.start);
  const end = dayjs(event.end);
  const clock = (value: dayjs.Dayjs) =>
    `${value.format("h:mm")}${value.format("A").slice(0, 1).toLowerCase()}`;

  if (!start.isSame(end, "day")) {
    return `${start.format("M/D")} ${clock(start)}-${end.format("M/D")} ${clock(end)}`;
  }

  return `${clock(start)}-${clock(end)}`;
}

// A timed event lasting a day or longer. In Week and Day it is shown in the
// all-day row instead of covering every hour of each day it spans.
function isMultiDayTimedEvent(event: CalendarEvent) {
  return !event.allDay && dayjs(event.end).diff(dayjs(event.start), "hour", true) >= 24;
}

function getCalendarCardTitle(event: CalendarEvent) {
  return event.title.replace(/^(Imported|Task):\s+/i, "").trim() || event.title;
}

function formatDateValue(value: string | undefined) {
  if (!value) {
    return undefined;
  }

  const date = dayjs(value);

  if (!date.isValid()) {
    return value;
  }

  return /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
    ? date.format("MMM D, YYYY")
    : date.format("MMM D, YYYY h:mm A");
}

function formatDateTimeInput(value: Dayjs | string | undefined) {
  const date = value ? dayjs(value) : dayjs();
  return date.isValid() ? date.format("YYYY-MM-DDTHH:mm") : dayjs().format("YYYY-MM-DDTHH:mm");
}

function toIsoDateTimeInput(value: string) {
  const date = dayjs(value);
  return date.isValid() ? date.toISOString() : "";
}

function formatTaskStatus(status: string | undefined) {
  switch (status) {
    case "todo":
      return "To do";
    case "active":
      return "Active";
    case "waiting":
      return "Waiting";
    case "done":
      return "Done";
    default:
      return status;
  }
}

function formatSyncStatus(status: string | undefined) {
  switch (status) {
    case "active":
      return "Active";
    case "stale":
      return "Stale";
    case "deleted":
      return "Deleted";
    default:
      return status;
  }
}

function isConvertedTaskboardTask(data: ProofData) {
  return data.kind === "taskboard-task" && data.taskEditable === true && data.importedFrom?.convertToTask === true;
}

function getCalendarModeLabel(data: ProofData) {
  if (data.kind === "calendar-entry") {
    return "Taskboard calendar item";
  }

  if (data.kind === "imported-source") {
    return data.providerLabel ?? "Calendar";
  }

  if (isConvertedTaskboardTask(data)) {
    return "Editable Taskboard task";
  }

  if (data.kind === "taskboard-task" && data.workItemType === "maintenance_outage") {
    return "Maintenance outage";
  }

  if (data.kind === "taskboard-task" && data.taskEditable) {
    return "Editable Taskboard task";
  }

  if (data.kind === "converted-task") {
    return "Local sample replacement";
  }

  if (data.kind === "sample-source") {
    return "Sample import";
  }

  return "Read-only calendar display";
}

function getInspectorSummary(data: ProofData) {
  if (data.kind === "calendar-entry") {
    return "This is a native Taskboard calendar item. It is not a task until it is created or converted with a bucket.";
  }

  if (data.kind === "imported-source") {
    return null;
  }

  if (isConvertedTaskboardTask(data)) {
    return "This is now a Taskboard task created or promoted from a stored imported source. The original source event stays suppressed; no external calendar writeback is implied.";
  }

  if (data.kind === "taskboard-task" && data.workItemType === "maintenance_outage") {
    return "This maintenance outage is a Taskboard task. Schedule changes remain task-backed, and full notes, attachments, checklists, and subtasks are available in the standard task workspace.";
  }

  if (data.importedFrom?.readOnly) {
    return "This is a linked read-only imported Taskboard task. When its stored source event is visible, the calendar suppresses this duplicate task card.";
  }

  if (data.kind === "converted-task") {
    return "This local calendar task replaces a sample import only in this browser session. It does not write to Taskboard or the source calendar.";
  }

  if (data.kind === "sample-source") {
    return "This sample import is local to this browser session. Conversion creates a local Taskboard-style card only; No data is saved to either calendar.";
  }

  return "This Taskboard task is displayed on the calendar from existing task dates. Calendar drag, resize, and edit persistence are not enabled here.";
}

function getTaskboardTaskHref(data: ProofData, fallbackBoardId?: string) {
  if (data.kind === "imported-source" && data.linkedTaskId && fallbackBoardId) {
    return `/?boardId=${encodeURIComponent(fallbackBoardId)}&taskId=${encodeURIComponent(data.linkedTaskId)}&from=calendar`;
  }

  if (data.kind === "taskboard-task" && data.boardId && data.taskId) {
    return `/?boardId=${encodeURIComponent(data.boardId)}&taskId=${encodeURIComponent(data.taskId)}&from=calendar`;
  }

  return null;
}

function getInitialProofView(
  requestedOutageView: boolean,
  calendarView: CalendarView,
  outagesCalendarView: CalendarView,
): CalendarView {
  return requestedOutageView ? outagesCalendarView : calendarView;
}

function formatCalendarToolbarTitle(date: Dayjs, view: CalendarView) {
  if (view === "day") {
    return date.format("dddd, MMM D");
  }

  if (view === "week") {
    const start = startOfWorkWeek(date);
    const end = start.add(6, "day");
    return start.month() === end.month()
      ? `${start.format("MMM D")} - ${end.format("D, YYYY")}`
      : `${start.format("MMM D")} - ${end.format("MMM D, YYYY")}`;
  }

  return date.format("MMMM YYYY");
}

function getBusinessHourWindow(focusedEvent: CalendarEvent | null) {
  if (!focusedEvent || focusedEvent.allDay) {
    return {
      endTime: visibleBusinessEndHour,
      startTime: visibleBusinessStartHour,
    };
  }

  const start = dayjs(focusedEvent.start);
  const end = dayjs(focusedEvent.end);

  if (!start.isValid()) {
    return {
      endTime: visibleBusinessEndHour,
      startTime: visibleBusinessStartHour,
    };
  }

  const startHour = start.hour() + start.minute() / 60;
  const endHour = end.isValid() ? end.hour() + end.minute() / 60 : startHour + 1;

  return {
    endTime: Math.max(visibleBusinessEndHour, Math.min(24, Math.ceil(endHour || startHour + 1))),
    startTime: Math.min(visibleBusinessStartHour, Math.max(0, Math.floor(startHour))),
  };
}

function isSampleEvent(event: ProofEvent) {
  const data = event.data;

  return (
    data.owner === "Sample imports" ||
    data.owner === "Local session" ||
    data.kind === "sample-source" ||
    (data.kind === "converted-task" && data.status === "Local sample task") ||
    (data.kind === "taskboard-task" && Boolean(data.linkedTaskId?.startsWith("local-task-")))
  );
}

function isConvertedCalendarTask(data: ProofData) {
  return data.kind === "converted-task" || isConvertedTaskboardTask(data);
}

const DAY_MS = 24 * 60 * 60 * 1000;

// A timed window shorter than a day. Week and Day draw it as a band behind
// the work, split at midnight; Month draws one chip on the night it starts.
function isWindowBandEvent(event: CalendarEvent) {
  const data = getProofData(event);
  if (data.kind !== "taskboard-task" || data.windowRole !== "window" || event.allDay) {
    return false;
  }

  const length = dayjs(event.end).diff(dayjs(event.start));
  return length > 0 && length < DAY_MS;
}

// A timed event that starts before midnight and ends after it, within a day.
function crossesMidnight(event: CalendarEvent) {
  if (event.allDay) {
    return false;
  }

  const start = dayjs(event.start);
  const end = dayjs(event.end);
  return end.diff(start) < DAY_MS && end.isAfter(start.startOf("day").add(1, "day"));
}

function formatShortClock(value: Dayjs) {
  return value.minute() === 0 ? value.format("h A") : value.format("h:mm A");
}

function formatWindowRange(event: CalendarEvent) {
  return `${formatShortClock(dayjs(event.start))} → ${formatShortClock(dayjs(event.end))}`;
}

function getWindowBandLabel(event: CalendarEvent) {
  const data = getProofData(event);
  const title = getCalendarCardTitle(event);
  return data.outageLabel && data.outageLabel !== title ? `${data.outageLabel} · ${title}` : title;
}

// Work in different outages gets different colors, the same in every view.
const outageWorkAccents = ["#5b9bd5", "#3fa796", "#9a7fd1", "#c98a3c"];

function getOutageWorkAccent(outageTaskId: string) {
  let hash = 0;
  for (const character of outageTaskId) {
    hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  }
  return outageWorkAccents[hash % outageWorkAccents.length];
}

function eventMatchesFilter(event: ProofEvent, filter: CalendarEventFilter) {
  const data = event.data;

  switch (filter) {
    case "outage":
      return isOutageEvent(data);
    case "taskboard":
      return data.kind === "taskboard-task" && !isConvertedTaskboardTask(data);
    case "calendar":
      return data.kind === "calendar-entry";
    case "stored":
      return data.kind === "imported-source";
    case "converted":
      return isConvertedCalendarTask(data);
    case "all":
    default:
      return true;
  }
}

function countCalendarEvents(events: ProofEvent[]) {
  return events.reduce(
    (counts, event) => {
      if (event.data.kind === "imported-source") {
        counts.stored += 1;
      } else if (isConvertedCalendarTask(event.data)) {
        counts.converted += 1;
      } else if (event.data.kind === "calendar-entry") {
        counts.calendar += 1;
      } else if (event.data.kind === "taskboard-task") {
        counts.taskboard += 1;
        if (isOutageEvent(event.data)) {
          counts.outage += 1;
        }
      }

      if (isSampleEvent(event)) {
        counts.samples += 1;
      }

      return counts;
    },
    {
      converted: 0,
      calendar: 0,
      outage: 0,
      samples: 0,
      stored: 0,
      taskboard: 0,
    },
  );
}

// Empty states say what is missing and how to add it, in the viewer's words.
function getFilterEmptyMessage(filter: CalendarEventFilter) {
  switch (filter) {
    case "outage":
      return "No outages in this date range. To plan one, choose Outage from a bucket's Add task menu, or promote a task from its menu.";
    case "taskboard":
      return "No tasks with dates in this range.";
    case "calendar":
      return "No calendar entries in this range. Select a time and choose New entry to add one.";
    case "stored":
      return "No imported calendar events in this range.";
    case "converted":
      return "No converted tasks in this range.";
    case "all":
    default:
      return "Nothing is scheduled in this range.";
  }
}

const calendarFilterNouns: Record<CalendarEventFilter, string> = {
  all: "non-outage entries",
  outage: "outages",
  taskboard: "tasks",
  calendar: "calendar entries",
  stored: "imported events",
  converted: "converted tasks",
};

function CalendarProofHeader({
  embeddedInTaskboardShell,
  onNext,
  onPrevious,
  onToday,
  onViewChange,
  title,
  view,
}: {
  embeddedInTaskboardShell: boolean;
  onNext: () => void;
  onPrevious: () => void;
  onToday: () => void;
  onViewChange: (view: CalendarView) => void;
  title: string;
  view: CalendarView;
}) {
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const viewButtons: Array<{
    id: CalendarView;
    label: string;
  }> = [
    { id: "month", label: "Month" },
    { id: "week", label: "Week" },
    { id: "day", label: "Day" },
  ];
  useEffect(() => {
    if (!embeddedInTaskboardShell) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      setPortalTarget(document.getElementById("taskboard-calendar-inline-toolbar"));
    });

    return () => window.cancelAnimationFrame(frame);
  }, [embeddedInTaskboardShell]);

  const header = (
    <div className="calendar-proof-header">
      <div className="calendar-proof-header__nav">
        <button
          aria-label="Previous period"
          className="calendar-proof-header__button"
          onClick={onPrevious}
          type="button"
        >
          <ChevronLeft aria-hidden="true" />
        </button>
        <button
          aria-label="Next period"
          className="calendar-proof-header__button"
          onClick={onNext}
          type="button"
        >
          <ChevronRight aria-hidden="true" />
        </button>
        <button className="calendar-proof-header__button calendar-proof-header__today" onClick={onToday} type="button">
          Today
        </button>
        <div className="calendar-proof-header__title">
          <CalendarDays aria-hidden="true" />
          <span>{title}</span>
        </div>
      </div>
      <div className="calendar-proof-header__views" role="group" aria-label="Calendar view">
        {viewButtons.map((button) => (
          <button
            aria-pressed={view === button.id}
            className={`calendar-proof-header__button calendar-proof-header__view ${
              view === button.id ? "is-active" : ""
            }`}
            key={button.id}
            onClick={() => onViewChange(button.id)}
            type="button"
          >
            {button.label}
          </button>
        ))}
      </div>
    </div>
  );

  if (embeddedInTaskboardShell && portalTarget) {
    return createPortal(header, portalTarget);
  }

  return header;
}

function getCalendarResizeRange(event: CalendarEvent): CalendarResizeRange | null {
  const data = getProofData(event);

  if (data.kind === "taskboard-task") {
    return getEffectiveCalendarTaskResizeRange({
      allDay: Boolean(event.allDay),
      dueAt: data.taskDueAt,
      endAt: data.taskEndAt,
      startAt: data.taskStartAt,
    });
  }

  if (data.kind === "calendar-entry") {
    return {
      startAt: dayjs(event.start).toISOString(),
      endAt: dayjs(event.end).toISOString(),
    };
  }

  return null;
}

function canResizeCalendarEvent(event: CalendarEvent, canEditBoard: boolean) {
  if (!canEditBoard || event.allDay) {
    return false;
  }

  const data = getProofData(event);
  if (data.kind === "taskboard-task" && (data.workItemType === "maintenance_outage" || data.windowRole === "window")) {
    return false;
  }

  const range = getCalendarResizeRange(event);

  if (!range || !isTimedCalendarResizeRange(range)) {
    return false;
  }

  if (data.kind === "calendar-entry") {
    return Boolean(data.calendarEntryId);
  }

  return data.kind === "taskboard-task" && Boolean(data.taskId && data.taskEditable && !data.importedFrom?.readOnly);
}

function getFullCalendarViewName(view: CalendarView) {
  switch (view) {
    case "month":
      return "dayGridMonth";
    case "week":
      return "timeGridWeek";
    case "day":
      return "timeGridDay";
  }
}

function getTaskboardCalendarView(viewName: string): CalendarView {
  switch (viewName) {
    case "dayGridMonth":
      return "month";
    case "timeGridDay":
      return "day";
    case "timeGridWeek":
    default:
      return "week";
  }
}

function getCalendarEventFromApi(event: EventApi): CalendarEvent {
  const source = event.extendedProps.taskboardEvent as ProofEvent;
  const isDateProjection = event.extendedProps.dateProjection === true;
  if (isDateProjection) {
    return {
      ...source,
      id: source.id ?? event.id,
      title: source.title || event.title,
      start: dayjs(source.start),
      end: dayjs(source.end),
      allDay: Boolean(source.allDay),
    };
  }

  const start = event.start ? dayjs(event.start) : dayjs(source.start);
  const end = event.end
    ? dayjs(event.end)
    : event.allDay
      ? start.add(1, "day")
      : start.add(1, "hour");

  return {
    ...source,
    id: source.id ?? event.id,
    title: source.title || event.title,
    start,
    end,
    allDay: event.allDay,
  };
}

function getWindowChipInput(event: CalendarEvent, idSuffix = ""): EventInput {
  // One chip on the day the window starts, not a bar across two days.
  const startDay = dayjs(event.start).startOf("day");
  return {
    id: `${String(event.id)}${idSuffix}`,
    title: getWindowBandLabel(event),
    start: startDay.format("YYYY-MM-DD"),
    end: startDay.add(1, "day").format("YYYY-MM-DD"),
    allDay: true,
    display: "block",
    durationEditable: false,
    startEditable: false,
    extendedProps: { dateProjection: true, taskboardEvent: event, windowChip: true },
  };
}

// FullCalendar inputs for one event. A window in Week and Day is two: the
// band behind the work, and a chip in the all-day row that no event covers.
function getFullCalendarEventInputs(
  event: ProofEvent,
  canEditBoard: boolean,
  view: CalendarView,
): EventInput[] {
  const normalizedEvent: CalendarEvent = { ...event, start: dayjs(event.start), end: dayjs(event.end) };
  if (isWindowBandEvent(normalizedEvent) && view !== "month") {
    return [
      getFullCalendarEventInput(event, canEditBoard, view),
      getWindowChipInput(normalizedEvent, "::window-chip"),
    ];
  }
  return [getFullCalendarEventInput(event, canEditBoard, view)];
}

function getFullCalendarEventInput(
  event: ProofEvent,
  canEditBoard: boolean,
  view: CalendarView,
): EventInput {
  const normalizedEvent: CalendarEvent = {
    ...event,
    start: dayjs(event.start),
    end: dayjs(event.end),
  };
  const data = getProofData(normalizedEvent);

  if (isWindowBandEvent(normalizedEvent)) {
    if (view === "month") {
      return getWindowChipInput(normalizedEvent);
    }

    return {
      id: String(event.id),
      title: getWindowBandLabel(normalizedEvent),
      start: dayjs(event.start).toISOString(),
      end: dayjs(event.end).toISOString(),
      allDay: false,
      display: "background",
      extendedProps: { dateProjection: false, taskboardEvent: event, windowBand: true },
    };
  }

  const isResizable = canResizeCalendarEvent(normalizedEvent, canEditBoard);
  // Date projection shows a timed event as an all-day bar without changing it:
  // resizable timed events in Month, and multi-day timed events in Week and Day
  // (so they don't cover the time grid). getCalendarEventFromApi restores the
  // real times, and resizing moves dates while keeping them.
  const dateProjection =
    !normalizedEvent.allDay &&
    (view === "month" ? isResizable : isMultiDayTimedEvent(normalizedEvent));
  const projectionEnd = dayjs(normalizedEvent.end)
    .subtract(1, "millisecond")
    .startOf("day")
    .add(1, "day");

  return {
    id: String(event.id),
    title: data.overlay === "mine" ? `You · ${getCalendarCardTitle(normalizedEvent)}` : getCalendarCardTitle(normalizedEvent),
    start: dateProjection
      ? dayjs(normalizedEvent.start).format("YYYY-MM-DD")
      : dayjs(event.start).toISOString(),
    end: dateProjection
      ? projectionEnd.format("YYYY-MM-DD")
      : dayjs(event.end).toISOString(),
    allDay: dateProjection || Boolean(event.allDay),
    backgroundColor: event.backgroundColor,
    borderColor: event.color,
    display: "block",
    durationEditable: isResizable,
    startEditable: false,
    extendedProps: {
      dateProjection,
      taskboardEvent: event,
    },
  };
}

function getCalendarResizeHandleLabel(edge: CalendarResizeEdge, title: string) {
  switch (edge) {
    case "start-time":
      return `Adjust start time for ${title}`;
    case "end-time":
      return `Adjust end time for ${title}`;
    case "start-date":
      return `Adjust start date for ${title}`;
    case "end-date":
      return `Adjust end date for ${title}`;
  }
}

function isCalendarResizeHandleInteraction(event: MouseEvent) {
  return event.composedPath().some((target) =>
    target instanceof Element && (
      target.matches(".fc-event-resizer") ||
      target.hasAttribute("data-calendar-resize-edge")
    ));
}

function isCalendarResizeHandleFor(element: Element, eventId: string, edge: CalendarResizeEdge) {
  return element instanceof HTMLElement &&
    element.dataset.calendarResizeEdge === edge &&
    element.closest<HTMLElement>("[data-calendar-event-id]")?.dataset.calendarEventId === eventId;
}

function findCalendarResizeHandle(root: ParentNode, eventId: string, edge: CalendarResizeEdge) {
  const handles = Array.from(root.querySelectorAll<HTMLElement>(`[data-calendar-resize-edge="${edge}"]`))
    .filter((handle) => isCalendarResizeHandleFor(handle, eventId, edge));
  // An event split across days repeats its handles; its end is on the last piece.
  return edge.startsWith("start") ? handles[0] : handles[handles.length - 1];
}

function createCalendarEventCardNode({
  event,
  displayedAllDay,
  isFocused,
  resizeEdges,
  onResizeKeyDown,
  view,
}: {
  event: CalendarEvent;
  /** True when the calendar shows the event in the all-day row, including a
   * timed event shown there by date projection. Drives the one-line layout. */
  displayedAllDay?: boolean;
  isFocused?: boolean;
  resizeEdges: CalendarResizeEdge[];
  onResizeKeyDown: (event: KeyboardEvent, calendarEvent: CalendarEvent, edge: CalendarResizeEdge) => void;
  view: CalendarView;
}) {
  const data = getProofData(event);
  const cardTitle = data.overlay === "mine" ? `You · ${getCalendarCardTitle(event)}` : getCalendarCardTitle(event);
  const ariaLabel = `${cardTitle}, ${data.badge}, ${formatTime(event)}`;
  const timeLabel = formatTime(event);
  const compactTimeLabel = formatCompactTime(event);
  const card = document.createElement("div");
  card.className = `calendar-proof-event taskboard-card calendar-proof-event--${data.tone} ${
    isFocused ? "calendar-proof-event--focused" : ""
  }`;
  card.setAttribute("aria-label", ariaLabel);
  card.title = ariaLabel;
  card.dataset.calendarEventId = String(event.id);
  card.dataset.calendarAllDay = String(displayedAllDay ?? Boolean(event.allDay));
  card.dataset.calendarView = view;
  if (data.bucketColor) {
    card.dataset.calendarBucketColor = data.bucketColor;
  }
  card.style.setProperty(
    "--calendar-proof-event-accent",
    data.outageTaskId && data.workItemType !== "maintenance_outage"
      ? getOutageWorkAccent(data.outageTaskId)
      : data.bucketColor?.trim() || "currentColor",
  );
  if (data.overlay) {
    card.dataset.calendarOverlay = data.overlay;
  }
  if (data.outageTaskId) {
    card.dataset.calendarOutage = data.workItemType === "maintenance_outage" ? "outage" : "work";
  }
  if (isFocused) {
    card.dataset.calendarFocused = "true";
  }
  if (resizeEdges.length > 0) {
    card.dataset.calendarResizable = "true";
  }

  const meta = document.createElement("span");
  meta.className = "calendar-proof-event__meta";

  const fullTime = document.createElement("span");
  fullTime.className = "calendar-proof-event__time calendar-proof-event__time--full";
  fullTime.textContent =
    view === "month"
      ? event.allDay
        ? "All Day"
        : dayjs(event.start).format("h:mm A")
      : timeLabel;
  meta.append(fullTime);

  const compactTime = document.createElement("span");
  compactTime.className = "calendar-proof-event__time calendar-proof-event__time--compact";
  compactTime.setAttribute("aria-hidden", "true");
  compactTime.textContent =
    view === "month"
      ? event.allDay
        ? "All Day"
        : dayjs(event.start).format("h:mm A")
      : compactTimeLabel;
  meta.append(compactTime);

  const badge = document.createElement("span");
  badge.className = "calendar-proof-event__badge";
  badge.textContent = data.badge;
  meta.append(badge);
  card.append(meta);

  const title = document.createElement("span");
  title.className = "calendar-proof-event__title";
  title.textContent = cardTitle;
  card.append(title);

  for (const edge of resizeEdges) {
    const handle = document.createElement("span");
    handle.className = `calendar-proof-event__resize-handle calendar-proof-event__resize-handle--${edge}`;
    handle.dataset.calendarResizeEdge = edge;
    handle.setAttribute("aria-label", getCalendarResizeHandleLabel(edge, cardTitle));
    handle.setAttribute("role", "button");
    handle.tabIndex = isFocused ? 0 : -1;
    handle.addEventListener("click", (clickEvent) => {
      clickEvent.preventDefault();
      clickEvent.stopPropagation();
    });
    handle.addEventListener("keydown", (keyboardEvent) => onResizeKeyDown(keyboardEvent, event, edge));
    card.append(handle);
  }

  return card;
}

// The label at the top of a window band. The band itself lets clicks through
// to the time grid, so a time inside the window can still be selected; the
// label opens the window.
function createWindowBandNode({
  event,
  isFocused,
  isStart,
  onOpen,
}: {
  event: CalendarEvent;
  isFocused: boolean;
  isStart: boolean;
  onOpen: (event: CalendarEvent) => void;
}) {
  const data = getProofData(event);
  const band = document.createElement("div");
  band.className = "calendar-window-band__content";
  band.dataset.calendarEventId = String(event.id);
  if (isFocused) {
    band.dataset.calendarFocused = "true";
  }

  if (!isStart) {
    return band;
  }

  const labelText = getWindowBandLabel(event);
  const label = document.createElement("span");
  label.className = "calendar-window-band__label";
  label.setAttribute("role", "button");
  label.tabIndex = 0;
  label.dataset.testid = "calendar-window-band-label";
  label.setAttribute(
    "aria-label",
    `Window: ${labelText}, ${formatTime(event)}, ${formatWindowFillSummary(data.windowFill)}`,
  );
  label.title = `${labelText} · ${formatWindowRange(event)} · ${formatWindowFillSummary(data.windowFill)}`;
  label.textContent = labelText;
  const stop = (domEvent: Event) => domEvent.stopPropagation();
  label.addEventListener("mousedown", stop);
  label.addEventListener("touchstart", stop, { passive: true });
  label.addEventListener("pointerdown", stop);
  label.addEventListener("click", (clickEvent) => {
    clickEvent.preventDefault();
    clickEvent.stopPropagation();
    onOpen(event);
  });
  label.addEventListener("keydown", (keyboardEvent) => {
    if (keyboardEvent.key === "Enter" || keyboardEvent.key === " ") {
      keyboardEvent.preventDefault();
      onOpen(event);
    }
  });
  band.append(label);
  return band;
}

function createWindowChipNode({
  event,
  isFocused,
  compact,
}: {
  event: CalendarEvent;
  isFocused: boolean;
  compact: boolean;
}) {
  const data = getProofData(event);
  const labelText = getWindowBandLabel(event);
  const fill = formatWindowFillSummary(data.windowFill);
  const chip = document.createElement("div");
  chip.className = "calendar-window-chip";
  chip.dataset.calendarEventId = String(event.id);
  chip.dataset.testid = "calendar-window-chip";
  if (isFocused) {
    chip.dataset.calendarFocused = "true";
  }
  chip.setAttribute("aria-label", `Window: ${labelText}, ${formatTime(event)}, ${fill}`);
  chip.title = `${formatWindowRange(event)} · ${labelText} · ${fill}`;

  const title = document.createElement("span");
  title.className = "calendar-window-chip__title";
  title.textContent = `${formatWindowRange(event)} · ${labelText}`;
  const summary = document.createElement("span");
  summary.className = "calendar-window-chip__fill";
  summary.textContent = fill;
  chip.append(title);
  if (compact) {
    chip.dataset.compact = "true";
  } else {
    chip.append(summary);
  }
  return chip;
}

function CalendarRecurringResizeDialog({
  draft,
  isSaving,
  onCancel,
  onConfirm,
}: {
  draft: CalendarResizeDraft;
  isSaving: boolean;
  onCancel: () => void;
  onConfirm: (scope: CalendarTaskScheduleScope) => void;
}) {
  const firstActionRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    firstActionRef.current?.focus();

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) {
        event.preventDefault();
        onCancel();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isSaving, onCancel]);

  return (
    <div className="calendar-resize-dialog__backdrop">
      <div
        aria-describedby="calendar-resize-dialog-description"
        aria-labelledby="calendar-resize-dialog-title"
        aria-modal="true"
        className="calendar-resize-dialog"
        role="dialog"
      >
        <p className="calendar-resize-dialog__eyebrow">Recurring task</p>
        <h2 id="calendar-resize-dialog-title">Apply schedule change</h2>
        <p id="calendar-resize-dialog-description">
          Choose whether to resize only this task or this task and active future tasks in the series.
        </p>
        <p className="calendar-resize-dialog__range">
          {dayjs(draft.proposed.startAt).format("ddd, MMM D, h:mm A")}
          {" - "}
          {dayjs(draft.proposed.endAt).format("ddd, MMM D, h:mm A")}
        </p>
        <div className="calendar-resize-dialog__actions">
          <button
            disabled={isSaving}
            onClick={() => onConfirm("single")}
            ref={firstActionRef}
            type="button"
          >
            This task
          </button>
          <button disabled={isSaving} onClick={() => onConfirm("series")} type="button">
            Series
          </button>
          <button disabled={isSaving} onClick={onCancel} type="button">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

type CalendarEntryDraft = {
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string;
  description: string;
  color: string;
  bucketId: string;
};

type CalendarSlotSelection = {
  start: Dayjs;
  end: Dayjs;
  allDay: boolean;
};

function calendarEntryToDraft(entry: CalendarEntry): CalendarEntryDraft {
  return {
    title: entry.title,
    startAt: formatDateTimeInput(dayjs(entry.startAt)),
    endAt: formatDateTimeInput(dayjs(entry.endAt)),
    allDay: entry.allDay,
    location: entry.location,
    description: entry.description,
    color: entry.color,
    bucketId: "",
  };
}

function calendarEntryDraftMatches(entry: CalendarEntry, draft: CalendarEntryDraft) {
  return (
    entry.title === draft.title.trim() &&
    Date.parse(entry.startAt) === Date.parse(toIsoDateTimeInput(draft.startAt) ?? "") &&
    Date.parse(entry.endAt) === Date.parse(toIsoDateTimeInput(draft.endAt) ?? "") &&
    entry.allDay === draft.allDay &&
    entry.location === draft.location.trim() &&
    entry.description === draft.description.trim() &&
    entry.color.toLowerCase() === draft.color.toLowerCase()
  );
}

function CalendarEntryForm({
  boardBuckets,
  canEdit,
  deleteConfirmationOpen,
  draft,
  error,
  intent,
  isDeleting,
  isDirty,
  isSaving,
  mode,
  onCancel,
  onChange,
  onDeleteCancel,
  onDeleteConfirm,
  onDeleteRequest,
  onModeChange,
  onReset,
  onSubmit,
}: {
  boardBuckets: CalendarBoardBucketOption[];
  canEdit: boolean;
  deleteConfirmationOpen: boolean;
  draft: CalendarEntryDraft;
  error: string | null;
  intent: "create" | "edit";
  isDeleting: boolean;
  isDirty: boolean;
  isSaving: boolean;
  mode: "sidebar" | "expanded" | "phone";
  onCancel: () => void;
  onChange: (patch: Partial<CalendarEntryDraft>) => void;
  onDeleteCancel: () => void;
  onDeleteConfirm: () => void;
  onDeleteRequest: () => void;
  onModeChange: () => void;
  onReset: () => void;
  onSubmit: () => void;
}) {
  const isExpanded = mode === "expanded";
  const isEditing = intent === "edit";
  const formTitleId = `calendar-entry-form-title-${intent}`;
  const closeLabel = isEditing ? "Close calendar item editor" : "Close calendar entry form";
  const expandLabel = isEditing
    ? isExpanded
      ? "Return calendar item to sidebar"
      : "Expand calendar item"
    : isExpanded
      ? "Return new calendar item to sidebar"
      : "Expand new calendar item";
  const fieldsDisabled = !canEdit || isSaving || isDeleting;

  return (
    <aside
      className={`calendar-entry-form calendar-entry-form--${mode} calendar-entry-form--${intent}`}
      role={mode === "phone" ? undefined : "dialog"}
      aria-labelledby={formTitleId}
    >
      <div className="calendar-entry-form__header">
        <div>
          <p>{isEditing ? "Taskboard Calendar" : "Calendar entry"}</p>
          <h2 id={formTitleId}>{isEditing ? draft.title || "Calendar item" : "New calendar item"}</h2>
        </div>
        <div className="calendar-entry-form__header-actions">
          <button
            aria-label={expandLabel}
            className="calendar-entry-form__icon-button"
            onClick={onModeChange}
            type="button"
          >
            {isExpanded ? <Minimize2 aria-hidden="true" /> : <Maximize2 aria-hidden="true" />}
          </button>
          <button
            aria-label={closeLabel}
            className="calendar-entry-form__icon-button"
            onClick={onCancel}
            type="button"
          >
            <X aria-hidden="true" />
          </button>
        </div>
      </div>
      <div className="calendar-entry-form__grid">
        <label>
          <span>Title</span>
          <input
            autoFocus={!isEditing}
            disabled={fieldsDisabled}
            value={draft.title}
            onChange={(event) => onChange({ title: event.target.value })}
            placeholder="Add title"
          />
        </label>
        {!isEditing ? (
          <label>
            <span>Bucket</span>
            <select
              disabled={fieldsDisabled}
              value={draft.bucketId}
              onChange={(event) => onChange({ bucketId: event.target.value })}
            >
              <option value="">None</option>
              {boardBuckets.map((bucket) => (
                <option key={bucket.id} value={bucket.id}>
                  {bucket.title}
                </option>
              ))}
            </select>
            <p className="calendar-entry-form__notice">
              Selecting a bucket will create this calendar entry as a Taskboard task.
            </p>
          </label>
        ) : null}
        <label>
          <span>Start</span>
          <input
            disabled={fieldsDisabled}
            type="datetime-local"
            value={draft.startAt}
            onChange={(event) => onChange({ startAt: event.target.value })}
          />
        </label>
        <label>
          <span>End</span>
          <input
            disabled={fieldsDisabled}
            type="datetime-local"
            value={draft.endAt}
            onChange={(event) => onChange({ endAt: event.target.value })}
          />
        </label>
        <label>
          <span>Location</span>
          <input
            disabled={fieldsDisabled}
            value={draft.location}
            onChange={(event) => onChange({ location: event.target.value })}
            placeholder="Optional"
          />
        </label>
        <label className="calendar-entry-form__checkbox">
          <input
            checked={draft.allDay}
            disabled={fieldsDisabled}
            onChange={(event) => onChange({ allDay: event.target.checked })}
            type="checkbox"
          />
          <span>All day</span>
        </label>
        <label>
          <span>Color</span>
          <span className="calendar-entry-form__color-control">
            <input
              aria-label="Calendar item color"
              disabled={fieldsDisabled}
              type="color"
              value={draft.color}
              onChange={(event) => onChange({ color: event.target.value })}
            />
            <span>{draft.color.toUpperCase()}</span>
          </span>
        </label>
        <label className="calendar-entry-form__wide">
          <span>Description</span>
          <textarea
            disabled={fieldsDisabled}
            value={draft.description}
            onChange={(event) => onChange({ description: event.target.value })}
            placeholder="Optional notes"
            rows={3}
          />
        </label>
      </div>
      {error ? <p className="calendar-entry-form__error">{error}</p> : null}
      {isEditing && !canEdit ? (
        <p className="calendar-entry-form__notice">This board is read-only. Calendar item details cannot be changed.</p>
      ) : null}
      {isEditing && deleteConfirmationOpen ? (
        <div className="calendar-entry-form__delete-confirmation" role="alert">
          <div>
            <strong>Delete this calendar item?</strong>
            <span>It will be hidden from Calendar and Agenda.</span>
          </div>
          <div>
            <button className="calendar-entry-form__secondary" disabled={isDeleting} onClick={onDeleteCancel} type="button">
              Keep item
            </button>
            <button className="calendar-entry-form__secondary calendar-entry-form__danger" disabled={isDeleting} onClick={onDeleteConfirm} type="button">
              <Trash2 aria-hidden="true" />
              {isDeleting ? "Deleting..." : "Delete item"}
            </button>
          </div>
        </div>
      ) : null}
      <div className="calendar-entry-form__actions">
        {isEditing && canEdit && !deleteConfirmationOpen ? (
          <button className="calendar-entry-form__secondary calendar-entry-form__danger-link" disabled={mode === "phone" && (isSaving || isDeleting)} onClick={onDeleteRequest} type="button">
            <Trash2 aria-hidden="true" />
            Delete
          </button>
        ) : null}
        <span className="calendar-entry-form__action-spacer" />
        {isEditing && canEdit ? (
          <button
            className="calendar-entry-form__secondary"
            disabled={!isDirty || isSaving || isDeleting}
            onClick={onReset}
            type="button"
          >
            <RotateCcw aria-hidden="true" />
            Reset
          </button>
        ) : (
          <button className="calendar-entry-form__secondary" onClick={onCancel} type="button">
            Cancel
          </button>
        )}
        {canEdit ? (
          <button
            className="calendar-entry-form__primary"
            disabled={isSaving || isDeleting || (isEditing && !isDirty)}
            onClick={onSubmit}
            type="button"
          >
            {isSaving
              ? "Saving..."
              : isEditing
                ? "Save changes"
                : draft.bucketId
                  ? "Create task"
                  : "Create calendar item"}
          </button>
        ) : null}
      </div>
    </aside>
  );
}

function CalendarInspector({
  boardBuckets,
  boardId,
  canEditBoard,
  event,
  hiddenEvent,
  inspectorRef,
  onConvert,
  onClearSelection,
  onShowHiddenEvent,
  convertingEventId,
  conversionError,
  canClearSelection,
}: {
  boardBuckets: CalendarBoardBucketOption[];
  boardId: string;
  canEditBoard: boolean;
  event: CalendarEvent | null;
  hiddenEvent?: CalendarEvent | null;
  inspectorRef?: RefObject<HTMLElement | null>;
  onConvert: (
    event: CalendarEvent,
    options: { bucketId: string; scope: "occurrence" | "series" },
  ) => void | Promise<void>;
  onClearSelection: () => void;
  onShowHiddenEvent: () => void;
  convertingEventId: string | null;
  conversionError: string | null;
  canClearSelection: boolean;
}) {
  const [conversionBucketId, setConversionBucketId] = useState(boardBuckets[0]?.id ?? "");
  const [conversionScope, setConversionScope] = useState<"occurrence" | "series">("occurrence");

  if (!event && hiddenEvent) {
    const hiddenData = getProofData(hiddenEvent);

    return (
      <aside
        aria-labelledby="calendar-proof-inspector-hidden-title"
        className="calendar-proof-inspector calendar-proof-inspector--hidden"
        ref={inspectorRef}
      >
        <div className="calendar-proof-inspector__empty">
          <PanelRightOpen aria-hidden="true" />
          <p className="calendar-proof-inspector__hidden-label">Selection hidden</p>
          <h2 id="calendar-proof-inspector-hidden-title">{hiddenEvent.title}</h2>
          <p>
            The selected {hiddenData.badge.toLowerCase()} is hidden by the current filters.
          </p>
          <div className="calendar-proof-inspector__actions">
            <button
              className="calendar-proof-inspector__primary"
              onClick={onShowHiddenEvent}
              type="button"
            >
              Show selected event
            </button>
            {canClearSelection ? (
              <button
                className="calendar-proof-inspector__secondary"
                onClick={onClearSelection}
                type="button"
              >
                Clear selection
              </button>
            ) : null}
          </div>
        </div>
      </aside>
    );
  }

  if (!event) {
    return (
      <aside
        aria-labelledby="calendar-proof-inspector-empty-title"
        className="calendar-proof-inspector calendar-proof-inspector--empty"
        ref={inspectorRef}
      >
        <div className="calendar-proof-inspector__empty">
          <PanelRightOpen aria-hidden="true" />
          <h2 id="calendar-proof-inspector-empty-title">No event selected</h2>
          <p>Select an event to review details and available Taskboard actions.</p>
        </div>
      </aside>
    );
  }

  const data = getProofData(event);
  const canConvert = data.kind === "sample-source" || (
    data.kind === "imported-source" &&
    Boolean(data.importedEventId) &&
    !data.linkedTaskId
  );
  const convertButtonLabel = data.kind === "imported-source"
    ? "Add task functionality"
    : "Convert sample locally";
  const eventConversionId = data.importedEventId ?? data.sourceEventId ?? String(event.id);
  const isConverting = convertingEventId === eventConversionId;
  const taskStart = formatDateValue(data.taskStartAt);
  const taskEnd = formatDateValue(data.taskEndAt);
  const taskDue = formatDateValue(data.taskDueAt);
  const taskStatus = formatTaskStatus(data.taskStatus);
  const calendarMode = getCalendarModeLabel(data);
  const inspectorSummary = getInspectorSummary(data);
  const taskboardTaskHref = getTaskboardTaskHref(data, boardId);
  const isImportedCalendarSource = data.kind === "imported-source";
  const inspectorTitleId = `calendar-proof-inspector-title-${String(event.id).replace(/[^a-zA-Z0-9_-]/g, "-")}`;

  return (
    <aside
      aria-labelledby={inspectorTitleId}
      aria-live="polite"
      className="calendar-proof-inspector calendar-proof-inspector--selected"
      ref={inspectorRef}
    >
      <div className="calendar-proof-inspector__header">
        <div className={`calendar-proof-inspector__status calendar-proof-inspector__status--${data.tone}`}>
          <span>{data.badge}</span>
          <span>{formatTime(event)}</span>
        </div>
        {!isImportedCalendarSource ? (
          <div className="calendar-proof-inspector__eyebrow">
            <ClipboardCheck aria-hidden="true" />
            <span>{data.status}</span>
          </div>
        ) : null}
      </div>
      <h2 id={inspectorTitleId}>
        {isImportedCalendarSource ? <SafeLinkifiedText text={event.title} /> : event.title}
      </h2>
      {inspectorSummary ? (
        <p className="calendar-proof-inspector__summary">{inspectorSummary}</p>
      ) : null}
      <dl>
        {data.kind === "taskboard-task" ||
        data.kind === "converted-task" ||
        data.kind === "calendar-entry" ? (
          <div>
            <dt>Calendar mode</dt>
            <dd>{calendarMode}</dd>
          </div>
        ) : null}
        <div>
          <dt>When</dt>
          <dd>{formatTime(event)}</dd>
        </div>
        {taskStatus ? (
          <div>
            <dt>Task status</dt>
            <dd>{taskStatus}</dd>
          </div>
        ) : null}
        {taskStart ? (
          <div>
            <dt>Start date</dt>
            <dd>{taskStart}</dd>
          </div>
        ) : null}
        {taskEnd ? (
          <div>
            <dt>End date</dt>
            <dd>{taskEnd}</dd>
          </div>
        ) : null}
        {taskDue ? (
          <div>
            <dt>Due date</dt>
            <dd>{taskDue}</dd>
          </div>
        ) : null}
        <div>
          <dt>Source</dt>
          <dd>{isImportedCalendarSource ? data.providerLabel ?? data.source : data.source}</dd>
        </div>
        {data.providerLabel && !isImportedCalendarSource ? (
          <div>
            <dt>Provider</dt>
            <dd>{data.providerLabel}</dd>
          </div>
        ) : null}
        {data.syncStatus ? (
          <div>
            <dt>Sync status</dt>
            <dd>{formatSyncStatus(data.syncStatus)}</dd>
          </div>
        ) : null}
        {!isImportedCalendarSource ? (
          <div>
            <dt>Owner</dt>
            <dd>{data.owner}</dd>
          </div>
        ) : null}
        {data.outageLocation ? (
          <div>
            <dt>Location</dt>
            <dd>{data.outageLocation}</dd>
          </div>
        ) : null}
        {event.location ? (
          <div>
            <dt>Location</dt>
            <dd className="whitespace-pre-wrap">
              <SafeLinkifiedText text={event.location} />
            </dd>
          </div>
        ) : null}
        {data.linkedTaskId && !isImportedCalendarSource ? (
          <div>
            <dt>Task</dt>
            <dd>{data.linkedTaskId}</dd>
          </div>
        ) : null}
        {data.bucketTitle ? (
          <div>
            <dt>Bucket</dt>
            <dd>{data.bucketTitle}</dd>
          </div>
        ) : null}
        {data.labels?.length ? (
          <div>
            <dt>Labels</dt>
            <dd>{data.labels.join(", ")}</dd>
          </div>
        ) : null}
        {data.importedFrom ? (
          <div>
            <dt>{isConvertedTaskboardTask(data) ? "Converted from" : "Imported from"}</dt>
            <dd>
              {data.importedFrom.providerLabel}
              {data.importedFrom.syncStatus ? ` (${data.importedFrom.syncStatus})` : ""}
            </dd>
          </div>
        ) : null}
        {isConvertedTaskboardTask(data) ? (
          <div>
            <dt>Conversion state</dt>
            <dd>Source suppressed; Taskboard task visible</dd>
          </div>
        ) : null}
        {data.summary ? (
          <div>
            <dt>Summary</dt>
            <dd className="whitespace-pre-wrap">
              <SafeLinkifiedText text={data.summary} />
            </dd>
          </div>
        ) : null}
        {data.parentTaskTitle ? (
          <div>
            <dt>Parent</dt>
            <dd>{data.parentTaskTitle}</dd>
          </div>
        ) : null}
        {data.hasRecurrence ? (
          <div>
            <dt>Recurrence</dt>
            <dd>{isImportedCalendarSource ? "Recurring event" : "Task metadata only"}</dd>
          </div>
        ) : null}
        {data.suppressedSourceTitle ? (
          <div>
            <dt>Replaces</dt>
            <dd>{data.suppressedSourceTitle}</dd>
          </div>
        ) : null}
      </dl>
      <div className="calendar-proof-inspector__actions">
        {taskboardTaskHref ? (
          <Link
            aria-label={`Open ${event.title} in Taskboard`}
            className="calendar-proof-inspector__primary"
            href={taskboardTaskHref}
          >
            <ExternalLink aria-hidden="true" />
            Open in Taskboard
          </Link>
        ) : null}
        {canClearSelection ? (
          <button
            className="calendar-proof-inspector__secondary"
            onClick={onClearSelection}
            type="button"
          >
            Clear selection
          </button>
        ) : null}
        {canConvert ? (
          <div className="grid w-full gap-2">
            <label className="calendar-entry-form__field">
              <span>Task bucket</span>
              <select
                value={conversionBucketId}
                onChange={(changeEvent) => setConversionBucketId(changeEvent.target.value)}
                disabled={!canEditBoard || isConverting}
              >
                {boardBuckets.map((bucket) => (
                  <option key={bucket.id} value={bucket.id}>{bucket.title}</option>
                ))}
              </select>
            </label>
            {data.hasRecurrence ? (
              <label className="calendar-entry-form__field">
                <span>Attach task to</span>
                <select
                  value={conversionScope}
                  onChange={(changeEvent) => setConversionScope(changeEvent.target.value as "occurrence" | "series")}
                  disabled={!canEditBoard || isConverting}
                >
                  <option value="occurrence">This occurrence</option>
                  <option value="series">Entire series</option>
                </select>
              </label>
            ) : null}
            <button
              aria-label={`${isConverting ? "Converting" : convertButtonLabel} for ${event.title}`}
              className="calendar-proof-inspector__secondary"
              disabled={!canEditBoard || isConverting || !conversionBucketId}
              onClick={() => onConvert(event, {
                bucketId: conversionBucketId,
                scope: data.hasRecurrence ? conversionScope : "occurrence",
              })}
              type="button"
            >
              <CheckCircle2 aria-hidden="true" />
              {isConverting ? "Adding task..." : convertButtonLabel}
            </button>
          </div>
        ) : null}
      </div>
      {conversionError ? (
        <p className="calendar-proof-inspector__error">{conversionError}</p>
      ) : null}
      {data.sourceEventId && !isImportedCalendarSource ? (
        <div className="calendar-proof-inspector__source">
          <ExternalLink aria-hidden="true" />
          <span>{data.sourceEventId}</span>
        </div>
      ) : null}
    </aside>
  );
}

export function CalendarProofInner({
  boardContext,
  boardBuckets,
  boardOptions,
  isPhone = false,
  onPhoneBoardChange,
  phoneActionsRef,
  calendarEntries,
  canEditBoard,
  embeddedInTaskboardShell = false,
  focusContext,
  onSidebarTaskSelect,
  onOutageViewChange,
  onTaskSchedulesUpdated,
  onCalendarDataChanged,
  searchQuery = "",
  selectedTaskId,
  sourceEvents,
  taskEvents,
}: {
  boardContext: CalendarBoardContext;
  boardBuckets: CalendarBoardBucketOption[];
  boardOptions: CalendarBoardOption[];
  isPhone?: boolean;
  onPhoneBoardChange?: (boardId: string) => void;
  phoneActionsRef?: RefObject<CalendarPhoneActions | null>;
  calendarEntries: CalendarEntry[];
  canEditBoard: boolean;
  embeddedInTaskboardShell?: boolean;
  focusContext?: CalendarFocusContext;
  onSidebarTaskSelect?: (taskId: string | null) => void;
  onOutageViewChange?: (active: boolean) => void;
  onTaskSchedulesUpdated?: (updates: CalendarTaskScheduleUpdate[]) => void;
  // This calendar saved something: the shell reloads the calendar's data.
  onCalendarDataChanged?: () => void;
  searchQuery?: string;
  selectedTaskId?: string | null;
  sourceEvents: TaskboardCalendarSourceEvent[];
  taskEvents: TaskboardCalendarTaskEvent[];
}) {
  const { settings, updateSetting } = useUiSettings();
  const calendarRef = useRef<FullCalendar | null>(null);
  const calendarSectionRef = useRef<HTMLElement | null>(null);
  const calendarRootRef = useRef<HTMLDivElement | null>(null);
  const filterMenuRef = useRef<HTMLDetailsElement | null>(null);
  const inspectorRef = useRef<HTMLElement | null>(null);
  const requestedInitialDateValue = focusContext?.initialDate;
  const requestedOutageView = focusContext?.initialOutageView === true;
  const requestedInitialDate = useMemo(() => {
    if (!requestedInitialDateValue) {
      return null;
    }

    const parsed = dayjs(requestedInitialDateValue);
    return parsed.isValid() ? parsed : null;
  }, [requestedInitialDateValue]);
  const weekStart = useMemo(() => {
    return startOfWorkWeek(requestedInitialDate ?? dayjs());
  }, [requestedInitialDate]);
  const mockEvents = useMemo(() => buildMockEvents(weekStart), [weekStart]);
  const [initialView] = useState<CalendarView>(() =>
    getInitialProofView(
      requestedOutageView,
      settings.calendarView,
      settings.outagesCalendarView,
    ),
  );
  const [activeCalendarView, setActiveCalendarView] = useState<CalendarView>(initialView);
  const [calendarTitle, setCalendarTitle] = useState(() =>
    formatCalendarToolbarTitle(requestedInitialDate ?? dayjs(), initialView),
  );
  const [visibleRangeStart, setVisibleRangeStart] = useState<Dayjs | null>(null);

  // The calendar has a fixed height that fills the window, so the time grid
  // scrolls inside the calendar instead of scrolling the whole page. The first
  // value is an estimate so FullCalendar never mounts at auto height, where
  // its 7 AM scrollTime would have nothing to scroll.
  const [calendarViewportHeight, setCalendarViewportHeight] = useState(() =>
    Math.max(minCalendarViewportHeight, window.innerHeight - 160),
  );

  useLayoutEffect(() => {
    if (isPhone) return;
    const section = calendarSectionRef.current;
    const calendarRoot = calendarRootRef.current;
    if (!section || !calendarRoot) {
      return;
    }

    const syncCalendarViewportHeight = () => {
      const calendarElement = calendarRoot.querySelector<HTMLElement>(":scope > .fc") ?? calendarRoot;
      const nextHeight = getCalendarViewportHeight(calendarElement);
      setCalendarViewportHeight((current) => (current === nextHeight ? current : nextHeight));
    };

    let frameId = 0;
    const scheduleCalendarViewportHeightSync = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(syncCalendarViewportHeight);
    };

    syncCalendarViewportHeight();
    // Notes, filters, and the masthead above the calendar change the section's
    // height when they appear or wrap, which moves the calendar's top edge.
    const observer = new ResizeObserver(scheduleCalendarViewportHeightSync);
    observer.observe(section, { box: "border-box" });
    window.addEventListener("resize", scheduleCalendarViewportHeightSync);

    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
      window.removeEventListener("resize", scheduleCalendarViewportHeightSync);
    };
  }, [isPhone]);
  const [convertedSourceIds, setConvertedSourceIds] = useState<Set<string>>(
    () => new Set(["sample-quarterly-plan"]),
  );
  const [selectedEvent, setSelectedEvent] = useState<CalendarEvent | null>(null);
  const [convertingEventId, setConvertingEventId] = useState<string | null>(null);
  const [pendingConvertedTaskId, setPendingConvertedTaskId] = useState<string | null>(null);
  const [pendingCreatedSelection, setPendingCreatedSelection] = useState<{
    kind: "calendar-entry" | "task";
    id: string;
  } | null>(null);
  const [conversionError, setConversionError] = useState<string | null>(null);
  const [phoneConversionStatus, setPhoneConversionStatus] = useState<string | null>(null);
  const [isEntryFormOpen, setIsEntryFormOpen] = useState(false);
  const [phoneEditingEntry, setPhoneEditingEntry] = useState(false);
  const [isEntryFormExpanded, setIsEntryFormExpanded] = useState(false);
  const [calendarEntryRecords, setCalendarEntryRecords] = useState<CalendarEntry[]>(calendarEntries);
  // The entry the form was loaded from, as it was then. Saving sends that
  // version, so a change someone made meanwhile is refused rather than
  // overwritten, and newer data replaces the form only while it is untouched.
  const [entryDraftBase, setEntryDraftBase] = useState<{
    entryId: string;
    updatedAt: string;
    draft: CalendarEntryDraft;
  } | null>(null);
  // The calendarEntries prop last put into the records, and whether the
  // selected event must be read again from newer data.
  const appliedCalendarEntriesRef = useRef(calendarEntries);
  const reselectAfterDataRef = useRef(false);
  const [selectedCalendarSlot, setSelectedCalendarSlot] = useState<CalendarSlotSelection | null>(null);
  const [entryDraft, setEntryDraft] = useState<CalendarEntryDraft>(() => {
    const start = requestedInitialDate ?? dayjs().startOf("hour").add(1, "hour");
    return {
      title: "",
      startAt: formatDateTimeInput(start),
      endAt: formatDateTimeInput(start.add(1, "hour")),
      allDay: false,
      location: "",
      description: "",
      color: "#14b8a6",
      bucketId: "",
    };
  });
  const [entryCreateError, setEntryCreateError] = useState<string | null>(null);
  const [phoneNewEntryBaseline, setPhoneNewEntryBaseline] = useState<CalendarEntryDraft | null>(null);
  const [isCreatingEntry, setIsCreatingEntry] = useState(false);
  const [isDeletingEntry, setIsDeletingEntry] = useState(false);
  const [isDeleteConfirmationOpen, setIsDeleteConfirmationOpen] = useState(false);
  const [scheduleOverrides, setScheduleOverrides] = useState<Record<string, CalendarScheduleOverride>>({});
  const [pendingRecurringResize, setPendingRecurringResize] = useState<CalendarResizeDraft | null>(null);
  const [resizingEventId, setResizingEventId] = useState<string | null>(null);
  const [resizeError, setResizeError] = useState<string | null>(null);
  const [resizeStatus, setResizeStatus] = useState<string | null>(null);
  const resizeDraftRef = useRef<CalendarResizeDraft | null>(null);
  // A schedule change being made or saved: live reloads wait for it.
  const [isResizeInProgress, setIsResizeInProgress] = useState(false);
  const [eventFilter, setEventFilter] = useState<CalendarEventFilter>(() =>
    requestedOutageView ? "outage" : "all",
  );
  const lastRequestedOutageView = useRef(requestedOutageView);
  useEffect(() => {
    if (lastRequestedOutageView.current === requestedOutageView) return;
    lastRequestedOutageView.current = requestedOutageView;
    setEventFilter(requestedOutageView ? "outage" : "all");
    const nextView = getInitialProofView(requestedOutageView, settings.calendarView, settings.outagesCalendarView);
    setActiveCalendarView(nextView);
    calendarRef.current?.getApi().changeView(getFullCalendarViewName(nextView));
  }, [requestedOutageView, settings.calendarView, settings.outagesCalendarView]);

  const hasLiveCalendarEvents = taskEvents.length > 0 || sourceEvents.length > 0;
  const [hideSampleEvents, setHideSampleEvents] = useState<boolean | null>(null);
  const effectiveHideSampleEvents = hideSampleEvents ?? hasLiveCalendarEvents;
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase();
  const storedSourceEvents = useMemo(
    () => sourceEvents as ProofEvent[],
    [sourceEvents],
  );
  const nativeCalendarEvents = useMemo(
    () => mapCalendarEntriesToCalendarEvents(calendarEntryRecords) as ProofEvent[],
    [calendarEntryRecords],
  );
  const sampleSourceEvents = useMemo(
    () => mockEvents.filter((event) => event.data.kind === "sample-source"),
    [mockEvents],
  );
  const sampleTaskEvents = useMemo(
    () => mockEvents.filter((event) => event.data.kind !== "sample-source"),
    [mockEvents],
  );
  const visibleEvents = useMemo(() => {
    const convertedTasks = sampleSourceEvents
      .filter((event) => convertedSourceIds.has(event.data.sourceEventId ?? String(event.id)))
      .map(makeConvertedTask);
    const visibleSampleSourceEvents =
      storedSourceEvents.length > 0
        ? []
        : sampleSourceEvents.filter((event) => {
            const sourceEventId = event.data.sourceEventId ?? String(event.id);
            return !convertedSourceIds.has(sourceEventId);
          });

    return [
      ...visibleSampleSourceEvents,
      ...storedSourceEvents,
      ...nativeCalendarEvents,
      ...sampleTaskEvents,
      ...(taskEvents as ProofEvent[]),
      ...convertedTasks,
    ];
  }, [convertedSourceIds, nativeCalendarEvents, sampleSourceEvents, sampleTaskEvents, storedSourceEvents, taskEvents]);
  const displayedEvents = useMemo(
    () =>
      visibleEvents.map((event) => {
        const override = scheduleOverrides[String(event.id)];

        return override ? { ...event, start: override.startAt, end: override.endAt } : event;
      }),
    [scheduleOverrides, visibleEvents],
  );
  // After newer data arrived, the selected event is read again by id so the
  // inspector shows the current copy.
  useEffect(() => {
    if (!reselectAfterDataRef.current) {
      return;
    }

    reselectAfterDataRef.current = false;
    setSelectedEvent((current) => {
      if (!current) {
        return current;
      }

      const latest = displayedEvents.find((event) => String(event.id) === String(current.id));
      return latest ? (latest as CalendarEvent) : current;
    });
  }, [displayedEvents]);
  // The switch and Calendar/Outages navigation share one exclusive mode.
  const isOutagesView = eventFilter === "outage";
  const filteredEvents = useMemo(
    () =>
      displayedEvents.flatMap((event) => {
        const proofEvent = event as ProofEvent;
        const data = proofEvent.data;
        const searchableText = [
          event.title,
          data.badge,
          data.source,
          data.status,
          data.providerLabel,
          data.bucketTitle,
          data.parentTaskTitle,
          data.outageLabel,
          event.location,
          ...(data.labels ?? []),
        ]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase();

        if (
          (effectiveHideSampleEvents && isSampleEvent(proofEvent)) ||
          (normalizedSearchQuery && !searchableText.includes(normalizedSearchQuery))
        ) {
          return [];
        }

        if (!calendarEventMatchesMode(data, isOutagesView)) {
          return [];
        }

        return eventMatchesFilter(proofEvent, eventFilter) ? [proofEvent] : [];
      }),
    [
      displayedEvents,
      effectiveHideSampleEvents,
      eventFilter,
      isOutagesView,
      normalizedSearchQuery,
    ],
  );
  const calendarEvents = useMemo(() => {
    // In Month a window's chip summarizes its work, so the work itself is
    // left out while the window is shown.
    const shownWindowIds = new Set(
      filteredEvents.flatMap((event) => {
        const data = event.data;
        return data.windowRole === "window" && data.taskId && isWindowBandEvent(event as CalendarEvent)
          ? [data.taskId]
          : [];
      }),
    );

    return filteredEvents
      .filter((event) =>
        activeCalendarView !== "month" ||
        !(event.data.windowTaskId && shownWindowIds.has(event.data.windowTaskId)))
      .flatMap((event) => getFullCalendarEventInputs(event, canEditBoard, activeCalendarView));
  }, [activeCalendarView, canEditBoard, filteredEvents]);
  // Day runs past midnight when something on it does, such as an overnight
  // window, so the whole night stays in one piece.
  const overnightDay = useMemo(() => {
    if (activeCalendarView !== "day" || !visibleRangeStart) {
      return null;
    }

    const nextMidnight = visibleRangeStart.startOf("day").add(1, "day");
    const overnight = filteredEvents.filter((event) => {
      const calendarEvent = event as CalendarEvent;
      return crossesMidnight(calendarEvent) && dayjs(calendarEvent.start).isSame(visibleRangeStart, "day");
    });
    if (overnight.length === 0) {
      return null;
    }

    const earliestStart = overnight.reduce(
      (earliest, event) => (dayjs(event.start).isBefore(earliest) ? dayjs(event.start) : earliest),
      dayjs(overnight[0].start),
    );
    const latestEnd = overnight.reduce(
      (latest, event) => (dayjs(event.end).isAfter(latest) ? dayjs(event.end) : latest),
      dayjs(overnight[0].end),
    );
    const hoursPastMidnight = Math.ceil(latestEnd.diff(nextMidnight, "minute") / 60);

    return {
      scrollTime: `${String(Math.max(0, earliestStart.hour() - 1)).padStart(2, "0")}:00:00`,
      slotMaxTime: `${Math.min(36, 24 + hoursPastMidnight + 1)}:00:00`,
    };
  }, [activeCalendarView, filteredEvents, visibleRangeStart]);
  const overnightScrollTime = overnightDay?.scrollTime ?? null;

  useEffect(() => {
    if (!overnightScrollTime) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      calendarRef.current?.getApi().scrollToTime(overnightScrollTime);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [overnightScrollTime, visibleRangeStart]);
  const sidebarSelectedTaskEvent = useMemo(() => {
    if (!selectedTaskId) {
      return null;
    }

    const event = displayedEvents.find((candidate) => {
      const data = getProofData(candidate as CalendarEvent);
      return data.kind === "taskboard-task" && data.taskId === selectedTaskId;
    });

    return event ? (event as CalendarEvent) : null;
  }, [displayedEvents, selectedTaskId]);
  const effectiveSelectedEvent = selectedEvent ?? sidebarSelectedTaskEvent;
  const selectedCalendarEntry = useMemo(() => {
    if (!effectiveSelectedEvent) {
      return null;
    }

    const data = getProofData(effectiveSelectedEvent);
    if (data.kind !== "calendar-entry" || !data.calendarEntryId) {
      return null;
    }

    return calendarEntryRecords.find((entry) => entry.id === data.calendarEntryId) ?? null;
  }, [calendarEntryRecords, effectiveSelectedEvent]);
  const filteredSelectedEvent =
    effectiveSelectedEvent && filteredEvents.some((event) => String(event.id) === String(effectiveSelectedEvent.id))
      ? effectiveSelectedEvent
      : null;
  const selectedEventHiddenByFilters = Boolean(effectiveSelectedEvent && !filteredSelectedEvent);
  const hiddenSelectedEvent = selectedEventHiddenByFilters ? effectiveSelectedEvent : null;
  const initialDateSyncKey = requestedInitialDateValue ?? null;
  const requestedScrollTime =
    requestedInitialDate && requestedInitialDateValue?.includes("T")
      ? requestedInitialDate.format("HH:mm:ss")
      : null;
  const focusedBusinessHours = useMemo(() => getBusinessHourWindow(null), []);
  const hiddenEventCount = visibleEvents.length - filteredEvents.length;
  const filterEmptyMessage = getFilterEmptyMessage(eventFilter);
  const filterStatusMessage =
    normalizedSearchQuery
      ? `Showing ${filteredEvents.length} calendar events matching "${searchQuery.trim()}".`
      : hiddenEventCount > 0
      ? `Showing ${filteredEvents.length} of ${visibleEvents.length} events: ${calendarFilterNouns[eventFilter]} only.`
      : `Showing all ${visibleEvents.length} calendar events.`;
  const shouldShowFilterStatus = eventFilter !== "all" || Boolean(normalizedSearchQuery);
  const boardSourcePolicy = boardContext.isExplicitBoardContext
    ? "Imported calendars are hidden in explicit board views."
    : "Imported calendars follow the personal calendar.";
  const filterCounts = useMemo(() => {
    const countableEvents = visibleEvents.filter(
      (event) => calendarEventMatchesMode((event as ProofEvent).data, isOutagesView) &&
        (!effectiveHideSampleEvents || !isSampleEvent(event as ProofEvent)),
    ) as ProofEvent[];
    const counts = countCalendarEvents(countableEvents);

    return {
      all: countableEvents.length,
      calendar: counts.calendar,
      converted: counts.converted,
      outage: counts.outage,
      stored: counts.stored,
      taskboard: counts.taskboard,
    };
  }, [effectiveHideSampleEvents, isOutagesView, visibleEvents]);
  const appliedInitialDateKeyRef = useRef<string | null>(null);

  useEffect(() => {
    function closeFilterMenu(event: PointerEvent) {
      const menu = filterMenuRef.current;
      if (menu?.open && event.target instanceof Node && !menu.contains(event.target)) {
        menu.removeAttribute("open");
      }
    }

    function closeFilterMenuWithKeyboard(event: KeyboardEvent) {
      const menu = filterMenuRef.current;
      if (event.key === "Escape" && menu?.open) {
        event.preventDefault();
        menu.removeAttribute("open");
        menu.querySelector("summary")?.focus();
      }
    }

    document.addEventListener("pointerdown", closeFilterMenu);
    document.addEventListener("keydown", closeFilterMenuWithKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeFilterMenu);
      document.removeEventListener("keydown", closeFilterMenuWithKeyboard);
    };
  }, []);

  useEffect(() => {
    if (
      !requestedInitialDate ||
      !initialDateSyncKey ||
      appliedInitialDateKeyRef.current === initialDateSyncKey
    ) {
      return;
    }

    let cancelled = false;
    let frameId = 0;
    let attempts = 0;
    let revealAttempts = 0;
    const focusDate = requestedInitialDate;

    function revealFocusedTime() {
      if (cancelled || !requestedScrollTime) {
        return;
      }

      const calendarRoot = calendarRootRef.current;
      const focusedEvent = calendarRoot?.querySelector<HTMLElement>(
        '[data-calendar-focused="true"]',
      );
      const focusedSlot = calendarRoot?.querySelector<HTMLElement>(
        `.fc-timegrid-slot-lane[data-time="${requestedScrollTime}"]`,
      );
      const target = focusedEvent ?? focusedSlot;

      if (!target || target.getBoundingClientRect().height <= 0) {
        revealAttempts += 1;
        if (revealAttempts < 48) {
          frameId = window.requestAnimationFrame(revealFocusedTime);
        }
        return;
      }

      target.scrollIntoView({ behavior: "auto", block: "center", inline: "nearest" });
    }

    function applyCalendarFocus() {
      if (cancelled) {
        return;
      }

      const calendarApi = calendarRef.current?.getApi();
      if (!calendarApi) {
        attempts += 1;
        if (attempts < 24) {
          frameId = window.requestAnimationFrame(applyCalendarFocus);
        }
        return;
      }

      appliedInitialDateKeyRef.current = initialDateSyncKey;
      calendarApi.gotoDate(focusDate.toDate());
      if (
        requestedScrollTime &&
        getTaskboardCalendarView(calendarApi.view.type) !== "month"
      ) {
        calendarApi.scrollToTime(requestedScrollTime);
        frameId = window.requestAnimationFrame(revealFocusedTime);
      }
    }

    frameId = window.requestAnimationFrame(applyCalendarFocus);
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frameId);
    };
  }, [initialDateSyncKey, requestedInitialDate, requestedScrollTime]);

  useEffect(() => {
    if (!pendingConvertedTaskId) {
      return;
    }

    const convertedTask = visibleEvents.find((event) => {
      const data = getProofData(event as CalendarEvent);
      return data.kind === "taskboard-task" && data.taskId === pendingConvertedTaskId;
    });

    if (!convertedTask) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSelectedEvent(convertedTask as CalendarEvent);
      setPendingConvertedTaskId(null);
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [pendingConvertedTaskId, visibleEvents]);

  useEffect(() => {
    if (!pendingCreatedSelection) {
      return;
    }

    const createdEvent = visibleEvents.find((event) => {
      const data = getProofData(event as CalendarEvent);
      return pendingCreatedSelection.kind === "task"
        ? data.kind === "taskboard-task" && data.taskId === pendingCreatedSelection.id
        : data.kind === "calendar-entry" && data.calendarEntryId === pendingCreatedSelection.id;
    });

    if (!createdEvent) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setSelectedEvent(createdEvent as CalendarEvent);
      const data = getProofData(createdEvent as CalendarEvent);
      onSidebarTaskSelect?.(!isPhone && data.kind === "taskboard-task" ? data.taskId ?? null : null);
      setPendingCreatedSelection(null);
      if (!isPhone && window.matchMedia("(max-width: 920px)").matches) {
        window.requestAnimationFrame(() => inspectorRef.current?.scrollIntoView({ block: "start", inline: "nearest", behavior: "smooth" }));
      }
    }, 0);

    return () => window.clearTimeout(timeoutId);
  }, [isPhone, onSidebarTaskSelect, pendingCreatedSelection, visibleEvents]);

  useEffect(() => {
    setScheduleOverrides((current) => {
      let next = current;

      for (const event of visibleEvents) {
        const eventId = String(event.id);
        const override = current[eventId];

        if (!override || resizeDraftRef.current?.event.id === event.id) {
          continue;
        }

        const baseRange = getCalendarResizeRange(event as CalendarEvent);
        if (
          baseRange &&
          Date.parse(baseRange.startAt) === Date.parse(override.startAt) &&
          Date.parse(baseRange.endAt) === Date.parse(override.endAt)
        ) {
          if (next === current) {
            next = { ...current };
          }
          delete next[eventId];
        }
      }

      return next;
    });
  }, [visibleEvents]);

  function loadEntryIntoForm(entry: CalendarEntry) {
    const draft = calendarEntryToDraft(entry);
    setEntryDraft(draft);
    setEntryDraftBase({ entryId: entry.id, updatedAt: entry.updatedAt, draft });
  }

  // Newer calendar data from the shell (a live reload or this calendar's own
  // save). The shell applies it only while nothing here is saving or being
  // resized, so it replaces the records outright, drops the schedule overlays
  // (a remote change could otherwise stay masked under one) and re-reads the
  // selected event. The open form follows only if it is untouched.
  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useEffect(() => {
    if (appliedCalendarEntriesRef.current === calendarEntries) {
      return;
    }

    appliedCalendarEntriesRef.current = calendarEntries;
    setCalendarEntryRecords(calendarEntries);
    setScheduleOverrides({});
    reselectAfterDataRef.current = true;

    if (entryDraftBase) {
      const latest = calendarEntries.find((entry) => entry.id === entryDraftBase.entryId);
      const untouched = JSON.stringify(entryDraft) === JSON.stringify(entryDraftBase.draft);
      if (!latest) {
        setEntryDraftBase(null);
        if (!untouched) {
          // Deleted elsewhere while being edited: the typing stays, as a new
          // item the viewer can create again or cancel.
          setSelectedEvent(null);
          setPhoneEditingEntry(false);
          setPhoneNewEntryBaseline(entryDraftBase.draft);
          setIsDeleteConfirmationOpen(false);
          setIsEntryFormOpen(true);
          setEntryCreateError("This calendar item was deleted elsewhere. Your changes are kept here: create it again, or cancel.");
        }
      } else if (JSON.stringify(entryDraft) === JSON.stringify(calendarEntryToDraft(latest))) {
        // The form already shows this version (for example after this
        // viewer's own change): nothing to protect, so it is the new base.
        setEntryDraftBase({ entryId: latest.id, updatedAt: latest.updatedAt, draft: entryDraft });
      } else if (latest.updatedAt !== entryDraftBase.updatedAt && untouched) {
        loadEntryIntoForm(latest);
      }
    }
  }, [calendarEntries]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  // Hold live reloads while a schedule change is drafted, awaits its
  // recurring-scope choice, or saves.
  const holdsLiveRefresh = isResizeInProgress || pendingRecurringResize !== null || resizingEventId !== null;
  useEffect(() => (holdsLiveRefresh ? holdLiveRefresh() : undefined), [holdsLiveRefresh]);

  function getCurrentCalendarResizeRange(event: CalendarEvent) {
    return scheduleOverrides[String(event.id)] ?? getCalendarResizeRange(event);
  }

  function updateSelectedEventRangeIfCurrent(
    event: CalendarEvent,
    range: CalendarResizeRange,
  ) {
    setSelectedEvent((current) =>
      current && String(current.id) === String(event.id)
        ? {
            ...current,
            start: dayjs(range.startAt),
            end: dayjs(range.endAt),
          }
        : current,
    );
  }

  function applyCalendarResizeDraft(draft: CalendarResizeDraft) {
    resizeDraftRef.current = draft;
    setIsResizeInProgress(true);
    setScheduleOverrides((current) => ({
      ...current,
      [String(draft.event.id)]: draft.proposed,
    }));
    updateSelectedEventRangeIfCurrent(draft.event, draft.proposed);
    setResizeStatus(
      `Proposed schedule ${dayjs(draft.proposed.startAt).format("MMM D, h:mm A")} to ${dayjs(draft.proposed.endAt).format("MMM D, h:mm A")}.`,
    );
    return draft;
  }

  function cancelCalendarResize(draft = resizeDraftRef.current ?? pendingRecurringResize) {
    if (draft) {
      draft.revert?.();
      setScheduleOverrides((current) => {
        const next = { ...current };
        delete next[String(draft.event.id)];
        return next;
      });
      updateSelectedEventRangeIfCurrent(draft.event, draft.original);
    }

    resizeDraftRef.current = null;
    setPendingRecurringResize(null);
    setIsResizeInProgress(false);
    setResizeStatus(draft ? "Schedule change canceled." : null);
  }

  async function persistCalendarResize(
    draft: CalendarResizeDraft,
    scope: CalendarTaskScheduleScope,
  ) {
    const data = getProofData(draft.event);
    const eventId = String(draft.event.id);
    let endpoint: string;

    if (data.kind === "taskboard-task" && data.taskId) {
      endpoint = `/api/calendar/tasks/${encodeURIComponent(data.taskId)}/schedule`;
    } else if (data.kind === "calendar-entry" && data.calendarEntryId) {
      endpoint = `/api/calendar/entries/${encodeURIComponent(data.calendarEntryId)}/schedule`;
    } else {
      cancelCalendarResize(draft);
      return;
    }

    setResizingEventId(eventId);
    setResizeError(null);
    setResizeStatus("Saving schedule change.");

    try {
      const response = await trackBoardWrite(fetch(endpoint, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          boardId: boardContext.activeBoardId,
          expectedStartAt: draft.original.startAt,
          expectedEndAt: draft.original.endAt,
          startAt: draft.proposed.startAt,
          endAt: draft.proposed.endAt,
          ...(data.kind === "taskboard-task" ? { scope } : {}),
        }),
      }));
      const body = await response.json().catch(() => ({})) as {
        error?: string;
        calendarEntryId?: string;
        startAt?: string;
        endAt?: string;
        previousUpdatedAt?: string;
        updatedAt?: string;
        updates?: CalendarTaskScheduleUpdate[];
      };

      if (!response.ok) {
        throw new Error(body.error ?? "Unable to save the calendar schedule.");
      }

      if (data.kind === "taskboard-task") {
        if (!Array.isArray(body.updates) || body.updates.length === 0) {
          throw new Error("The calendar task update did not return a schedule.");
        }

        const updatesByTaskId = new Map(body.updates.map((update) => [update.taskId, update]));
        setScheduleOverrides((current) => {
          const next = { ...current };

          for (const event of visibleEvents) {
            const eventData = getProofData(event as CalendarEvent);
            const update = eventData.taskId ? updatesByTaskId.get(eventData.taskId) : undefined;

            if (update) {
              next[String(event.id)] = { startAt: update.startAt, endAt: update.endAt };
            }
          }

          return next;
        });
        onTaskSchedulesUpdated?.(body.updates);
      } else {
        if (!body.calendarEntryId || !body.startAt || !body.endAt || !body.updatedAt) {
          throw new Error("The calendar entry update did not return a schedule.");
        }
        setScheduleOverrides((current) => ({
          ...current,
          [eventId]: { startAt: body.startAt!, endAt: body.endAt! },
        }));
        setCalendarEntryRecords((current) => current.map((entry) =>
          entry.id === body.calendarEntryId
            ? {
                ...entry,
                startAt: body.startAt!,
                endAt: body.endAt!,
                updatedAt: body.updatedAt!,
              }
            : entry,
        ));
        if (selectedCalendarEntry?.id === body.calendarEntryId) {
          setEntryDraft((current) => ({
            ...current,
            startAt: formatDateTimeInput(dayjs(body.startAt)),
            endAt: formatDateTimeInput(dayjs(body.endAt)),
          }));
        }
        // The form's base moves on with this change only if it was the version
        // the change replaced; otherwise someone else changed the item too, and
        // a save from the form must still be refused.
        setEntryDraftBase((base) =>
          base && base.entryId === body.calendarEntryId && base.updatedAt === body.previousUpdatedAt
            ? {
                ...base,
                updatedAt: body.updatedAt!,
                draft: {
                  ...base.draft,
                  startAt: formatDateTimeInput(dayjs(body.startAt)),
                  endAt: formatDateTimeInput(dayjs(body.endAt)),
                },
              }
            : base,
        );
      }

      updateSelectedEventRangeIfCurrent(draft.event, draft.proposed);
      resizeDraftRef.current = null;
      setPendingRecurringResize(null);
      setResizeStatus("Schedule updated.");
      onCalendarDataChanged?.();
    } catch (error) {
      draft.revert?.();
      setScheduleOverrides((current) => {
        const next = { ...current };
        delete next[eventId];
        return next;
      });
      updateSelectedEventRangeIfCurrent(draft.event, draft.original);
      resizeDraftRef.current = null;
      setPendingRecurringResize(null);
      setResizeStatus(null);
      setResizeError(error instanceof Error ? error.message : "Unable to save the calendar schedule.");
      onCalendarDataChanged?.();
    } finally {
      setResizingEventId(null);
      setIsResizeInProgress(false);
    }
  }

  function requestCalendarResizeCommit(draft: CalendarResizeDraft) {
    if (
      Date.parse(draft.original.startAt) === Date.parse(draft.proposed.startAt) &&
      Date.parse(draft.original.endAt) === Date.parse(draft.proposed.endAt)
    ) {
      cancelCalendarResize(draft);
      return;
    }

    const data = getProofData(draft.event);
    if (data.kind === "taskboard-task" && data.hasRecurrence) {
      setPendingRecurringResize(draft);
      setResizeStatus("Choose whether to update this task or the recurring series.");
      return;
    }

    void persistCalendarResize(draft, "single");
  }

  function handleFullCalendarResize(info: EventResizeDoneArg) {
    const originalEvent = getCalendarEventFromApi(info.oldEvent);
    const original = getCalendarResizeRange(originalEvent);
    const isDateProjection = info.event.extendedProps.dateProjection === true;
    const proposed = isDateProjection && info.event.start && info.event.end
      ? original && resizeCalendarRangeToDateSpan(
          original,
          info.event.start.toISOString(),
          info.event.end.toISOString(),
        )
      : {
          startAt: info.event.start?.toISOString() ?? "",
          endAt: info.event.end?.toISOString() ?? "",
        };

    if (!original || !proposed || !canResizeCalendarEvent(originalEvent, canEditBoard) || !isTimedCalendarResizeRange(proposed)) {
      info.revert();
      setResizeError("That schedule change is not available for this calendar item.");
      return;
    }

    const startChanged = Date.parse(original.startAt) !== Date.parse(proposed.startAt);
    const edge: CalendarResizeEdge = activeCalendarView === "month" || isDateProjection
      ? startChanged ? "start-date" : "end-date"
      : startChanged ? "start-time" : "end-time";
    const draft = applyCalendarResizeDraft({
      edge,
      event: originalEvent,
      input: "pointer",
      original,
      proposed,
      revert: info.revert,
    });

    setResizeError(null);
    requestCalendarResizeCommit(draft);
  }

  // The resize handle being driven from the keyboard. A proposed, canceled or
  // saved schedule redraws the event card, which replaces the focused handle
  // and drops focus to the page; the layout effect below puts it on the new
  // handle for the same event and edge, so Enter and Escape keep working. A
  // pointer press or focus moving anywhere else lets the handle go.
  const keyboardResizeHandleRef = useRef<{ eventId: string; edge: CalendarResizeEdge } | null>(null);

  useEffect(() => {
    function releaseKeyboardResizeHandle(domEvent: Event) {
      const handle = keyboardResizeHandleRef.current;
      if (
        handle &&
        (domEvent.type === "pointerdown" ||
          !(domEvent.target instanceof Element) ||
          !isCalendarResizeHandleFor(domEvent.target, handle.eventId, handle.edge))
      ) {
        keyboardResizeHandleRef.current = null;
      }
    }

    document.addEventListener("pointerdown", releaseKeyboardResizeHandle, true);
    document.addEventListener("focusin", releaseKeyboardResizeHandle);
    return () => {
      document.removeEventListener("pointerdown", releaseKeyboardResizeHandle, true);
      document.removeEventListener("focusin", releaseKeyboardResizeHandle);
    };
  }, []);

  useLayoutEffect(() => {
    const handle = keyboardResizeHandleRef.current;
    const activeElement = document.activeElement;
    if (!handle || (activeElement && activeElement !== document.body)) {
      return;
    }

    const handleNode = calendarRootRef.current
      ? findCalendarResizeHandle(calendarRootRef.current, handle.eventId, handle.edge)
      : undefined;
    if (handleNode) {
      handleNode.focus();
    } else {
      keyboardResizeHandleRef.current = null;
    }
  });

  function handleResizeKeyDown(
    keyboardEvent: KeyboardEvent,
    event: CalendarEvent,
    edge: CalendarResizeEdge,
  ) {
    keyboardResizeHandleRef.current = { eventId: String(event.id), edge };
    if (resizingEventId || !canResizeCalendarEvent(event, canEditBoard)) {
      return;
    }

    const activeDraft = resizeDraftRef.current;
    const isCurrentHandle = activeDraft?.event.id === event.id && activeDraft.edge === edge;

    if (keyboardEvent.key === "Escape" && isCurrentHandle) {
      keyboardEvent.preventDefault();
      keyboardEvent.stopPropagation();
      cancelCalendarResize(activeDraft);
      return;
    }

    if (keyboardEvent.key === "Enter" && isCurrentHandle) {
      keyboardEvent.preventDefault();
      keyboardEvent.stopPropagation();
      requestCalendarResizeCommit(activeDraft);
      return;
    }

    const direction = edge.endsWith("time")
      ? keyboardEvent.key === "ArrowUp"
        ? -1
        : keyboardEvent.key === "ArrowDown"
          ? 1
          : null
      : keyboardEvent.key === "ArrowLeft"
        ? -1
        : keyboardEvent.key === "ArrowRight"
          ? 1
          : null;

    if (!direction) {
      return;
    }

    keyboardEvent.preventDefault();
    keyboardEvent.stopPropagation();
    const original = getCurrentCalendarResizeRange(event);
    if (!original) {
      return;
    }

    const draft = isCurrentHandle
      ? activeDraft
      : { edge, event, input: "keyboard" as const, original, proposed: original };
    const proposed = resizeCalendarRangeByKeyboard(draft.proposed, edge, direction);

    if (!proposed) {
      setResizeStatus("That edge cannot move past the other edge.");
      return;
    }

    setResizeError(null);
    setSelectedEvent(event);
    applyCalendarResizeDraft({ ...draft, proposed });
  }

  function scrollInspectorIntoViewOnNarrowScreens() {
    if (isPhone) return;
    if (!window.matchMedia("(max-width: 920px)").matches) {
      return;
    }

    window.requestAnimationFrame(() => {
      inspectorRef.current?.scrollIntoView({
        block: "start",
        inline: "nearest",
        behavior: "smooth",
      });
    });
  }

  function handleEventClick(event: CalendarEvent) {
    setPhoneEditingEntry(false);
    setPhoneConversionStatus(null);
    calendarRef.current?.getApi().unselect();
    setSelectedCalendarSlot(null);
    setIsEntryFormOpen(false);
    setIsEntryFormExpanded(false);
    setIsDeleteConfirmationOpen(false);
    setEntryCreateError(null);
    setSelectedEvent(event);
    const data = getProofData(event);

    if (data.kind === "calendar-entry" && data.calendarEntryId) {
      const entry = calendarEntryRecords.find((candidate) => candidate.id === data.calendarEntryId);
      if (entry) {
        loadEntryIntoForm(entry);
      }
    }

    if (!isPhone && data.kind === "taskboard-task" && data.taskId) {
      onSidebarTaskSelect?.(data.taskId);
    } else {
      onSidebarTaskSelect?.(null);
    }

    scrollInspectorIntoViewOnNarrowScreens();
  }

  function handleFullCalendarEventClick(event: EventApi) {
    handleEventClick(getCalendarEventFromApi(event));
  }

  function handleCalendarDatesSet(info: DatesSetArg) {
    const nextView = getTaskboardCalendarView(info.view.type);
    setSelectedCalendarSlot(null);
    setActiveCalendarView(nextView);
    setCalendarTitle(info.view.title);
    setVisibleRangeStart((current) => {
      const next = dayjs(info.view.currentStart);
      return current?.isSame(next) ? current : next;
    });
  }

  // Date navigation keeps the time the user scrolled to (scrollTimeReset is
  // off), but switching views returns to 7 AM. FullCalendar reuses its time
  // grid between Week and Day, so that switch needs an explicit scroll.
  function changeCalendarView(viewName: string, date?: Date) {
    const calendarApi = calendarRef.current?.getApi();
    if (!calendarApi) {
      return;
    }

    calendarApi.changeView(viewName, date);
    if (viewName !== "dayGridMonth") {
      calendarApi.scrollToTime(defaultCalendarScrollTime);
    }
  }

  function handleCalendarViewChange(view: CalendarView) {
    updateSetting(isOutagesView ? "outagesCalendarView" : "calendarView", view);
    changeCalendarView(getFullCalendarViewName(view));
  }

  function handleShowSelectedEvent() {
    if (!hiddenSelectedEvent) {
      return;
    }

    const data = getProofData(hiddenSelectedEvent);
    const outages = isOutageEvent(data);
    setEventFilter(outages ? "outage" : "all");
    onOutageViewChange?.(outages);

    if (isSampleEvent(hiddenSelectedEvent as ProofEvent)) {
      setHideSampleEvents(false);
    }

    setSelectedEvent(hiddenSelectedEvent);
    onSidebarTaskSelect?.(data.kind === "taskboard-task" ? data.taskId ?? null : null);
  }

  function handleClearSelection() {
    setSelectedEvent(null);
    setIsEntryFormExpanded(false);
    setIsDeleteConfirmationOpen(false);
    setEntryCreateError(null);
    onSidebarTaskSelect?.(null);
  }

  function openEntryForm(start?: Dayjs, end?: Dayjs, allDay = false) {
    const entryStart = start ?? selectedCalendarSlot?.start ?? requestedInitialDate ?? dayjs().startOf("hour").add(1, "hour");
    const requestedEnd = end ?? selectedCalendarSlot?.end;
    const entryEnd = requestedEnd?.isAfter(entryStart) ? requestedEnd : entryStart.add(1, "hour");
    setEntryCreateError(null);
    setSelectedEvent(null);
    onSidebarTaskSelect?.(null);
    const newDraft = {
      title: "",
      startAt: formatDateTimeInput(entryStart),
      endAt: formatDateTimeInput(entryEnd),
      allDay: selectedCalendarSlot?.allDay ?? allDay,
      location: "",
      description: "",
      color: "#14b8a6",
      bucketId: "",
    };
    setPhoneNewEntryBaseline(newDraft);
    setEntryDraft(newDraft);
    setIsDeleteConfirmationOpen(false);
    setIsEntryFormExpanded(false);
    setIsEntryFormOpen(true);
  }

  function handleDateClick(info: DateClickArg) {
    const start = dayjs(info.date);

    if (activeCalendarView === "month" || info.allDay) {
      applyCalendarSlotSelection(start.startOf("day"), start.startOf("day").add(1, "day"), true);
      info.view.calendar.unselect();
      return;
    }

    const selection = normalizeCalendarTimeSelection(
      start.toDate(),
      start.add(15, "minute").toDate(),
    );

    if (!selection) {
      return;
    }

    applyCalendarSlotSelection(dayjs(selection.start), dayjs(selection.end), false);
    info.view.calendar.select({
      start: selection.start,
      end: selection.end,
      allDay: false,
    });
  }

  function handleCalendarSelect(info: DateSelectArg) {
    if (activeCalendarView === "month" || info.allDay) {
      info.view.calendar.unselect();
      return;
    }

    const selection = normalizeCalendarTimeSelection(info.start, info.end);

    if (!selection) {
      info.view.calendar.unselect();
      return;
    }

    applyCalendarSlotSelection(dayjs(selection.start), dayjs(selection.end), false);
  }

  function applyCalendarSlotSelection(start: Dayjs, end: Dayjs, allDay: boolean) {
    setSelectedCalendarSlot({ start, end, allDay });
    setSelectedEvent(null);
    onSidebarTaskSelect?.(null);
  }

  function handleClearCalendarSlotSelection() {
    calendarRef.current?.getApi().unselect();
    setSelectedCalendarSlot(null);
  }

  function navigateToDay(date: Dayjs) {
    const day = date.startOf("day");
    setIsEntryFormOpen(false);
    setIsEntryFormExpanded(false);
    setSelectedCalendarSlot(null);
    calendarRef.current?.getApi().unselect();
    changeCalendarView("timeGridDay", day.toDate());
  }

  async function handleCreateEntry() {
    const validated = validateCalendarEntryDraft();
    if (!validated) {
      return;
    }

    setIsCreatingEntry(true);
    setEntryCreateError(null);

    try {
      const response = await trackBoardWrite(fetch("/api/calendar/entries", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          boardId: boardContext.activeBoardId,
          title: validated.title,
          startAt: validated.startAt,
          endAt: validated.endAt,
          allDay: entryDraft.allDay,
          location: entryDraft.location,
          description: entryDraft.description,
          color: entryDraft.color,
          bucketId: entryDraft.bucketId || null,
        }),
      }));
      const body = await response.json().catch(() => ({})) as {
        error?: string;
        kind?: "calendar-entry" | "task";
        calendarEntryId?: string;
        calendarEntry?: CalendarEntry;
        taskId?: string;
      };

      if (!response.ok || !body.kind) {
        throw new Error(body.error ?? "Unable to create calendar entry.");
      }

      if (body.kind === "task") {
        if (!body.taskId) {
          throw new Error("The task creation response was incomplete.");
        }
        setPendingCreatedSelection({ kind: "task", id: body.taskId });
      } else {
        if (!body.calendarEntryId || !body.calendarEntry) {
          throw new Error("The calendar entry creation response was incomplete.");
        }
        setCalendarEntryRecords((current) => [
          ...current.filter((entry) => entry.id !== body.calendarEntry!.id),
          body.calendarEntry!,
        ]);
        const createdEvent = mapCalendarEntriesToCalendarEvents([body.calendarEntry])[0];
        if (createdEvent) {
          setSelectedEvent(createdEvent as CalendarEvent);
        }
      }

      setIsEntryFormOpen(false);
      setIsEntryFormExpanded(false);
      setSelectedCalendarSlot(null);
      calendarRef.current?.getApi().unselect();
      onCalendarDataChanged?.();
    } catch (error) {
      setEntryCreateError(error instanceof Error ? error.message : "Unable to create calendar entry.");
    } finally {
      setIsCreatingEntry(false);
    }
  }

  function validateCalendarEntryDraft() {
    const title = entryDraft.title.trim();
    const startAt = toIsoDateTimeInput(entryDraft.startAt);
    const endAt = toIsoDateTimeInput(entryDraft.endAt);

    if (!title) {
      setEntryCreateError("Title is required.");
      return null;
    }

    if (!startAt || !endAt || Date.parse(endAt) <= Date.parse(startAt)) {
      setEntryCreateError("Choose a valid start and end time.");
      return null;
    }

    if (!/^#[0-9a-f]{6}$/i.test(entryDraft.color)) {
      setEntryCreateError("Choose a valid calendar item color.");
      return null;
    }

    return { title, startAt, endAt };
  }

  async function handleUpdateEntry() {
    if (!selectedCalendarEntry || !canEditBoard) {
      return;
    }

    const validated = validateCalendarEntryDraft();
    if (!validated) {
      return;
    }

    setIsCreatingEntry(true);
    setEntryCreateError(null);

    try {
      const response = await trackBoardWrite(fetch(
        `/api/calendar/entries/${encodeURIComponent(selectedCalendarEntry.id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            boardId: boardContext.activeBoardId,
            expectedUpdatedAt:
              entryDraftBase?.entryId === selectedCalendarEntry.id
                ? entryDraftBase.updatedAt
                : selectedCalendarEntry.updatedAt,
            title: validated.title,
            startAt: validated.startAt,
            endAt: validated.endAt,
            allDay: entryDraft.allDay,
            location: entryDraft.location,
            description: entryDraft.description,
            color: entryDraft.color,
          }),
        },
      ));
      const body = await response.json().catch(() => ({})) as {
        error?: string;
        calendarEntry?: CalendarEntry;
      };

      if (!response.ok || !body.calendarEntry) {
        throw new Error(body.error ?? "Unable to update calendar entry.");
      }

      const updatedEntry = body.calendarEntry;
      setCalendarEntryRecords((current) => current.map((entry) =>
        entry.id === updatedEntry.id ? updatedEntry : entry,
      ));
      loadEntryIntoForm(updatedEntry);
      const updatedEvent = mapCalendarEntriesToCalendarEvents([updatedEntry])[0];
      if (updatedEvent) {
        setSelectedEvent(updatedEvent as CalendarEvent);
      }
      setIsDeleteConfirmationOpen(false);
      onCalendarDataChanged?.();
    } catch (error) {
      setEntryCreateError(error instanceof Error ? error.message : "Unable to update calendar entry.");
    } finally {
      setIsCreatingEntry(false);
    }
  }

  async function handleDeleteEntry() {
    if (!selectedCalendarEntry || !canEditBoard) {
      return;
    }

    setIsDeletingEntry(true);
    setEntryCreateError(null);

    try {
      const response = await trackBoardWrite(fetch(
        `/api/calendar/entries/${encodeURIComponent(selectedCalendarEntry.id)}`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            boardId: boardContext.activeBoardId,
            expectedUpdatedAt:
              entryDraftBase?.entryId === selectedCalendarEntry.id
                ? entryDraftBase.updatedAt
                : selectedCalendarEntry.updatedAt,
          }),
        },
      ));
      const body = await response.json().catch(() => ({})) as {
        error?: string;
        calendarEntryId?: string;
      };

      if (!response.ok || body.calendarEntryId !== selectedCalendarEntry.id) {
        throw new Error(body.error ?? "Unable to delete calendar entry.");
      }

      setCalendarEntryRecords((current) => current.filter((entry) => entry.id !== selectedCalendarEntry.id));
      setSelectedEvent(null);
      setIsEntryFormExpanded(false);
      setIsDeleteConfirmationOpen(false);
      onSidebarTaskSelect?.(null);
      onCalendarDataChanged?.();
    } catch (error) {
      setEntryCreateError(error instanceof Error ? error.message : "Unable to delete calendar entry.");
    } finally {
      setIsDeletingEntry(false);
    }
  }

  function handleEntryFormCancel() {
    if (isEntryFormOpen) {
      setIsEntryFormOpen(false);
      setIsEntryFormExpanded(false);
      setIsDeleteConfirmationOpen(false);
      setEntryCreateError(null);
      return;
    }

    handleClearSelection();
  }

  function handleResetEntryDraft() {
    if (!selectedCalendarEntry) {
      return;
    }

    loadEntryIntoForm(selectedCalendarEntry);
    setEntryCreateError(null);
    setIsDeleteConfirmationOpen(false);
  }

  async function handleConvert(
    event: CalendarEvent,
    options: { bucketId: string; scope: "occurrence" | "series" },
  ) {
    const data = getProofData(event);

    if (data.kind === "imported-source" && data.importedEventId) {
      const importedEventId = data.importedEventId;

      setConversionError(null);
      setConvertingEventId(importedEventId);

      try {
        const response = await trackBoardWrite(fetch(
          `/api/calendar/source-events/${encodeURIComponent(importedEventId)}/convert`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify(options),
          },
        ));
        const body = await response.json().catch(() => ({})) as { error?: string; taskId?: string };

        if (!response.ok || !body.taskId) {
          throw new Error(body.error ?? "Unable to convert calendar source event.");
        }

        if (isPhone) {
          // Source records remain read-only after adding task functionality.
          // Their linked task is intentionally suppressed in the calendar feed.
          setSelectedEvent({ ...event, data: { ...data, linkedTaskId: body.taskId } });
          setPhoneConversionStatus("Task functionality added. Open in Taskboard to work on the task.");
        } else {
          setPendingConvertedTaskId(body.taskId);
        }
        onCalendarDataChanged?.();
      } catch (error) {
        setConversionError(error instanceof Error ? error.message : "Unable to convert calendar source event.");
      } finally {
        setConvertingEventId(null);
      }

      return;
    }

    const sourceEventId = data.sourceEventId ?? String(event.id);
    const sourceEvent = sampleSourceEvents.find(
      (candidate) => (candidate.data.sourceEventId ?? String(candidate.id)) === sourceEventId,
    );

    if (!sourceEvent) {
      return;
    }

    const convertedTask = makeConvertedTask(sourceEvent);
    setConversionError(null);
    setConvertedSourceIds((previous) => new Set(previous).add(sourceEventId));
    setSelectedEvent(convertedTask as CalendarEvent);
  }

  function getFilterCount(filter: CalendarEventFilter) {
    switch (filter) {
      case "outage":
        return filterCounts.outage;
      case "taskboard":
        return filterCounts.taskboard;
      case "calendar":
        return filterCounts.calendar;
      case "stored":
        return filterCounts.stored;
      case "converted":
        return filterCounts.converted;
      case "all":
      default:
        return filterCounts.all;
    }
  }

  const activeFilterOption =
    eventFilter === "outage"
      ? { id: "outage" as const, label: "Outages", ariaLabel: "Show maintenance outages" }
      : calendarEventFilters.find((filter) => filter.id === eventFilter) ?? calendarEventFilters[0];

  const activeEntryFormIntent = isEntryFormOpen
    ? "create" as const
    : selectedCalendarEntry && filteredSelectedEvent
      ? "edit" as const
      : null;
  const isEntryFormDirty = selectedCalendarEntry
    ? !calendarEntryDraftMatches(selectedCalendarEntry, entryDraft)
    : true;
  const isSidebarEntryFormOpen = Boolean(activeEntryFormIntent && !isEntryFormExpanded);
  const shouldRenderCalendarInspector =
    !isEntryFormExpanded && (
      isSidebarEntryFormOpen ||
      !embeddedInTaskboardShell ||
      Boolean(
        filteredSelectedEvent &&
          getProofData(filteredSelectedEvent).kind !== "taskboard-task",
      ) ||
      Boolean(
        hiddenSelectedEvent &&
          getProofData(hiddenSelectedEvent).kind !== "taskboard-task",
      )
    );

  if (isPhone) {
    const phoneFormIntent = isEntryFormOpen ? "create" : phoneEditingEntry && selectedCalendarEntry ? "edit" : null;
    const phoneFormDirty = phoneFormIntent === "edit" ? isEntryFormDirty : JSON.stringify(entryDraft) !== JSON.stringify(phoneNewEntryBaseline);
    const closePhoneSelection = () => {
      setIsEntryFormOpen(false);
      setPhoneEditingEntry(false);
      handleClearSelection();
    };
    return <MobileCalendar key={`${boardContext.activeBoardId}:${requestedInitialDateValue ?? "today"}`}
      events={filteredEvents}
      initialDate={requestedInitialDateValue}
      boardId={boardContext.activeBoardId}
      boardTitle={boardContext.activeBoardTitle}
      boardOptions={boardOptions}
      onBoardChange={onPhoneBoardChange}
      actionsRef={phoneActionsRef}
      filter={eventFilter}
      onFilterChange={value => { setEventFilter(value); onOutageViewChange?.(value === "outage"); handleClearSelection(); }}
      isOutages={isOutagesView}
      hideSamples={effectiveHideSampleEvents}
      onHideSamplesChange={setHideSampleEvents}
      canCreate={canEditBoard}
      onNew={date => { setPhoneEditingEntry(false); openEntryForm(date); }}
      onEvent={handleEventClick}
      sheet={phoneFormIntent ? <PhoneCalendarSheet key={`form-${phoneFormIntent}`} label={phoneFormIntent === "edit" ? "Edit entry" : "New entry"}
        busy={isCreatingEntry || isDeletingEntry} dirty={phoneFormDirty} onClose={closePhoneSelection}>
        {requestClose => <CalendarEntryForm
          boardBuckets={boardBuckets} canEdit={canEditBoard} deleteConfirmationOpen={isDeleteConfirmationOpen}
          draft={entryDraft} error={entryCreateError} intent={phoneFormIntent} isDeleting={isDeletingEntry}
          isDirty={isEntryFormDirty} isSaving={isCreatingEntry} mode="phone"
          onCancel={requestClose} onChange={patch => setEntryDraft(current => ({ ...current, ...patch }))}
          onDeleteCancel={() => setIsDeleteConfirmationOpen(false)} onDeleteConfirm={() => void handleDeleteEntry()}
          onDeleteRequest={() => setIsDeleteConfirmationOpen(true)} onModeChange={() => {}}
          onReset={handleResetEntryDraft} onSubmit={() => void (phoneFormIntent === "edit" ? handleUpdateEntry() : handleCreateEntry())}
        />}
      </PhoneCalendarSheet> : effectiveSelectedEvent ? <PhoneCalendarSheet key={effectiveSelectedEvent.id} label="Event details" busy={Boolean(convertingEventId) || isDeletingEntry} onClose={closePhoneSelection}>
        {effectiveSelectedEvent.data.readOnly ? <p className="phone-calendar-import-notice">Imported event · read-only</p> : null}
        {phoneConversionStatus ? <p className="phone-calendar-import-notice" role="status">{phoneConversionStatus}</p> : null}
        <CalendarInspector boardBuckets={boardBuckets} boardId={boardContext.activeBoardId} canEditBoard={canEditBoard}
          canClearSelection={false} conversionError={conversionError} convertingEventId={convertingEventId}
          event={filteredSelectedEvent} hiddenEvent={hiddenSelectedEvent} onClearSelection={closePhoneSelection}
          onConvert={handleConvert} onShowHiddenEvent={handleShowSelectedEvent} />
        {selectedCalendarEntry && filteredSelectedEvent ? <>
          {entryCreateError ? <p role="alert">{entryCreateError}</p> : null}
          {isDeleteConfirmationOpen ? <div className="phone-calendar-delete" role="alertdialog" aria-label="Delete entry?">
            <p>Delete this calendar item?</p>
            <button type="button" disabled={isDeletingEntry} onClick={() => { setIsDeleteConfirmationOpen(false); setEntryCreateError(null); }}>Keep entry</button>
            <button type="button" disabled={isDeletingEntry} onClick={() => void handleDeleteEntry()}>{isDeletingEntry ? "Deleting..." : "Delete entry"}</button>
          </div> : <div className="phone-calendar-detail-actions">
            <button type="button" className="phone-calendar-edit" disabled={!canEditBoard} onClick={() => {
              loadEntryIntoForm(selectedCalendarEntry); setPhoneEditingEntry(true);
            }}>Edit entry</button>
            <button type="button" disabled={!canEditBoard} onClick={() => setIsDeleteConfirmationOpen(true)}>Delete entry</button>
          </div>}
        </> : null}
      </PhoneCalendarSheet> : null}
    />;
  }

  return (
    <section
      className={`taskboard-calendar-proof ${
        embeddedInTaskboardShell ? "taskboard-calendar-proof--embedded" : ""
      }`}
      aria-label="Calendar workspace"
      ref={calendarSectionRef}
    >
      <div
        className={`taskboard-calendar-proof__masthead ${
          embeddedInTaskboardShell ? "taskboard-calendar-proof__masthead--compact" : ""
        }`}
      >
        {!embeddedInTaskboardShell ? (
          <div className="taskboard-calendar-proof__identity">
            <p>Calendar</p>
            <h1>Taskboard schedule</h1>
            <span className="taskboard-calendar-proof__board">
              {boardContext.activeBoardTitle}
            </span>
          </div>
        ) : null}
        <div className="taskboard-calendar-proof__controls">
          <div
            aria-live="polite"
            className="taskboard-calendar-proof__context calendar-proof-sr-only"
            data-testid="calendar-board-context"
            role="status"
          >
            <span id="calendar-board-context-note">
              {boardContext.requestedBoardRejected
                ? "Requested board was unavailable; showing your default board."
                : boardSourcePolicy}
            </span>
          </div>
          <div
            className="taskboard-calendar-proof__inline-toolbar"
            data-testid="calendar-inline-toolbar"
            id="taskboard-calendar-inline-toolbar"
          />
          <div className="calendar-proof-entry-actions">
            <button
              aria-label="Create a new calendar entry"
              aria-describedby="calendar-slot-selection-status"
              className="calendar-proof-new-entry-button"
              disabled={!canEditBoard}
              onClick={() => openEntryForm()}
              title={canEditBoard ? "Create a new calendar entry" : "This board is read-only"}
              type="button"
            >
              <Plus aria-hidden="true" />
              New entry
              {/* A click on the calendar only selects a time; New entry then uses it. */}
              {selectedCalendarSlot ? (
                <span className="calendar-proof-new-entry-slot" data-testid="calendar-new-entry-slot">
                  {selectedCalendarSlot.allDay
                    ? selectedCalendarSlot.start.format("ddd MMM D")
                    : selectedCalendarSlot.start.format("ddd h:mm A")}
                </span>
              ) : null}
            </button>
            <button
              aria-label="Clear selected calendar time"
              className="calendar-proof-new-entry-button calendar-proof-clear-slot-button"
              disabled={!selectedCalendarSlot}
              onClick={handleClearCalendarSlotSelection}
              title="Clear selected calendar time"
              type="button"
            >
              <X aria-hidden="true" />
            </button>
          </div>
          <span
            aria-live="polite"
            className="calendar-proof-sr-only"
            id="calendar-slot-selection-status"
            role="status"
          >
            {selectedCalendarSlot
              ? selectedCalendarSlot.allDay
                ? `Selected ${selectedCalendarSlot.start.format("dddd, MMMM D")}.`
                : `Selected ${selectedCalendarSlot.start.format("dddd, MMMM D [from] h:mm A")} to ${selectedCalendarSlot.end.format("h:mm A")}.`
              : "No calendar time selected. New entry will use the next available hour."}
          </span>
          <div
            aria-labelledby="calendar-proof-filters-heading"
            className="calendar-proof-filters"
            data-testid="calendar-event-filters"
            role="group"
          >
            <span className="calendar-proof-filters__label" id="calendar-proof-filters-heading">
              {embeddedInTaskboardShell ? "Filters" : "Event filters"}
            </span>
            <details className="calendar-proof-filter-menu" ref={filterMenuRef}>
              <summary aria-label="Calendar event filters">
                <span>{activeFilterOption.label}</span>
                {" "}
                <span className="calendar-proof-filters__count">{getFilterCount(eventFilter)}</span>
              </summary>
              <div className="calendar-proof-filter-menu__panel">
                <button
                  className="calendar-proof-filter-menu__option calendar-proof-filter-menu__close"
                  aria-label="Close calendar filters"
                  type="button"
                  onClick={() => {
                    filterMenuRef.current?.removeAttribute("open");
                    filterMenuRef.current?.querySelector("summary")?.focus();
                  }}
                >
                  Close<X aria-hidden="true" size={14} />
                </button>
                <div aria-label="Filter visible calendar events by type" role="group">
                  {calendarEventFilters.map((filter) => (
                    <button
                      aria-label={filter.ariaLabel}
                      aria-pressed={eventFilter === filter.id}
                      className={`calendar-proof-filter-menu__option ${
                        eventFilter === filter.id ? "is-active" : ""
                      }`}
                      key={filter.id}
                      onClick={(event) => {
                        setEventFilter(filter.id);
                        onOutageViewChange?.(false);
                        event.currentTarget.closest("details")?.removeAttribute("open");
                      }}
                      type="button"
                    >
                      <span>{filter.label}</span>
                      {" "}
                      <span className="calendar-proof-filters__count">{getFilterCount(filter.id)}</span>
                    </button>
                  ))}
                </div>
                <label className="calendar-proof-filters__toggle">
                  <input
                    checked={effectiveHideSampleEvents}
                    onChange={(event) => setHideSampleEvents(event.target.checked)}
                    type="checkbox"
                  />
                  <span>Hide local samples</span>
                </label>
              </div>
            </details>
            <label
              className="calendar-proof-filters__toggle calendar-proof-outages-toggle"
              data-testid="calendar-outages-toggle"
              title="Switch between calendar entries and outages with their work"
            >
              <input
                checked={isOutagesView}
                onChange={(event) => {
                  setEventFilter(event.target.checked ? "outage" : "all");
                  onOutageViewChange?.(event.target.checked);
                }}
                type="checkbox"
              />
              <span>Outages</span>
            </label>
          </div>
        </div>
      </div>
      {activeEntryFormIntent && isEntryFormExpanded && typeof document !== "undefined"
        ? createPortal(
            <div className="taskboard-shell calendar-entry-workspace">
              <button
                aria-label={`Return ${activeEntryFormIntent === "edit" ? "calendar item" : "new calendar item"} to sidebar`}
                className="calendar-entry-workspace__backdrop"
                onClick={() => setIsEntryFormExpanded(false)}
                type="button"
              />
              <div className="calendar-entry-workspace__panel" data-testid="calendar-entry-expanded">
                <CalendarEntryForm
                  boardBuckets={boardBuckets}
                  canEdit={canEditBoard}
                  deleteConfirmationOpen={isDeleteConfirmationOpen}
                  draft={entryDraft}
                  error={entryCreateError}
                  intent={activeEntryFormIntent}
                  isDeleting={isDeletingEntry}
                  isDirty={isEntryFormDirty}
                  isSaving={isCreatingEntry}
                  mode="expanded"
                  onCancel={handleEntryFormCancel}
                  onChange={(patch) => setEntryDraft((current) => ({ ...current, ...patch }))}
                  onDeleteCancel={() => setIsDeleteConfirmationOpen(false)}
                  onDeleteConfirm={() => void handleDeleteEntry()}
                  onDeleteRequest={() => setIsDeleteConfirmationOpen(true)}
                  onModeChange={() => setIsEntryFormExpanded(false)}
                  onReset={handleResetEntryDraft}
                  onSubmit={() => void (activeEntryFormIntent === "edit" ? handleUpdateEntry() : handleCreateEntry())}
                />
              </div>
            </div>,
            document.body,
          )
        : null}
      {pendingRecurringResize ? (
        <CalendarRecurringResizeDialog
          draft={pendingRecurringResize}
          isSaving={resizingEventId === String(pendingRecurringResize.event.id)}
          onCancel={() => cancelCalendarResize(pendingRecurringResize)}
          onConfirm={(scope) => void persistCalendarResize(pendingRecurringResize, scope)}
        />
      ) : null}
      {resizeError ? (
        <p className="taskboard-calendar-proof__resize-error" role="alert">
          {resizeError}
        </p>
      ) : null}
      <p aria-live="polite" className="calendar-proof-sr-only" role="status">
        {resizeStatus}
      </p>
      {taskEvents.length === 0 ? (
        <p className="taskboard-calendar-proof__empty-note">
          No dated Taskboard tasks are available on the current/preferred board. Calendar only shows tasks
          with start or due dates; a sample stored import remains visible when no stored imported calendar rows
          are available.
        </p>
      ) : null}
      {hiddenEventCount > 0 && shouldShowFilterStatus && filteredEvents.length > 0 ? (
        <p aria-live="polite" className="taskboard-calendar-proof__filter-note" role="status">
          {filterStatusMessage}
        </p>
      ) : (
        <p aria-live="polite" className="calendar-proof-sr-only" role="status">
          {filterStatusMessage}
        </p>
      )}
      {visibleEvents.length > 0 && filteredEvents.length === 0 ? (
        <p aria-live="polite" className="taskboard-calendar-proof__empty-note" role="status">
          {filterEmptyMessage}
        </p>
      ) : null}
      <div
        className={`taskboard-calendar-proof__workspace ${
          shouldRenderCalendarInspector ? "taskboard-calendar-proof__workspace--with-inspector" : ""
        }`}
      >
        <div
          className={`taskboard-calendar-proof__calendar ${
            selectedCalendarSlot ? "taskboard-calendar-proof__calendar--slot-selected" : ""
          }`}
          data-calendar-active-view={activeCalendarView}
          ref={calendarRootRef}
        >
          <CalendarProofHeader
            embeddedInTaskboardShell={embeddedInTaskboardShell}
            onNext={() => calendarRef.current?.getApi().next()}
            onPrevious={() => calendarRef.current?.getApi().prev()}
            onToday={() => calendarRef.current?.getApi().today()}
            onViewChange={handleCalendarViewChange}
            title={calendarTitle}
            view={activeCalendarView}
          />
          {activeCalendarView === "week" ? (
            <p className="taskboard-calendar-proof__week-note">
              Week is condensed on phones. Use Day for full event titles.
            </p>
          ) : null}
          <FullCalendar
            allDaySlot
            businessHours={{
              daysOfWeek: [1, 2, 3, 4, 5],
              endTime: `${String(focusedBusinessHours.endTime).padStart(2, "0")}:00`,
              startTime: `${String(focusedBusinessHours.startTime).padStart(2, "0")}:00`,
            }}
            dateClick={handleDateClick}
            datesSet={handleCalendarDatesSet}
            dayCellClassNames={(info) =>
              selectedCalendarSlot?.allDay && dayjs(info.date).isSame(selectedCalendarSlot.start, "day")
                ? ["calendar-proof-day--selected"]
                : []
            }
            dayMaxEvents={4}
            editable={false}
            eventClassNames={(info) => {
              if (!info.event.extendedProps.taskboardEvent) {
                return [];
              }

              const event = getCalendarEventFromApi(info.event);
              const data = getProofData(event);
              if (info.event.extendedProps.windowBand === true) {
                return [
                  "calendar-window-band",
                  String(event.id) === String(filteredSelectedEvent?.id) ? "calendar-window-band--focused" : "",
                ].filter(Boolean);
              }
              return [
                "taskboard-calendar-event-shell",
                `taskboard-calendar-event-shell--${data.tone}`,
                String(event.id) === String(filteredSelectedEvent?.id)
                  ? "taskboard-calendar-event-shell--focused"
                  : "",
              ].filter(Boolean);
            }}
            eventClick={(info) => {
              info.jsEvent.preventDefault();
              if (isCalendarResizeHandleInteraction(info.jsEvent)) {
                info.jsEvent.stopPropagation();
                return;
              }
              handleFullCalendarEventClick(info.event);
            }}
            eventContent={(info: EventContentArg) => {
              if (!info.event.extendedProps.taskboardEvent) {
                return undefined;
              }

              const event = getCalendarEventFromApi(info.event);
              const isFocused = String(event.id) === String(filteredSelectedEvent?.id);
              if (info.event.extendedProps.windowBand === true) {
                return {
                  domNodes: [createWindowBandNode({
                    event,
                    isFocused,
                    isStart: info.isStart,
                    onOpen: handleEventClick,
                  })],
                };
              }
              if (info.event.extendedProps.windowChip === true) {
                return {
                  domNodes: [createWindowChipNode({ event, isFocused, compact: activeCalendarView !== "month" })],
                };
              }
              const isResizable = canResizeCalendarEvent(event, canEditBoard);
              const resizeEdges: CalendarResizeEdge[] = !isResizable
                ? []
                : activeCalendarView === "month" || event.allDay || info.event.extendedProps.dateProjection === true
                  ? ["start-date", "end-date"]
                  : ["start-time", "end-time"];

              return {
                domNodes: [createCalendarEventCardNode({
                  event,
                  displayedAllDay: info.event.allDay,
                  isFocused: String(event.id) === String(filteredSelectedEvent?.id),
                  onResizeKeyDown: handleResizeKeyDown,
                  resizeEdges,
                  view: activeCalendarView,
                })],
              };
            }}
            eventDurationEditable={canEditBoard}
            eventInteractive
            eventOverlap
            eventResizableFromStart
            eventResize={handleFullCalendarResize}
            eventResizeStart={() => {
              setIsResizeInProgress(true);
              setResizeError(null);
              setResizeStatus("Adjusting schedule.");
            }}
            eventResizeStop={() => {
              // A resize dropped without a change leaves no draft behind.
              if (!resizeDraftRef.current) {
                setIsResizeInProgress(false);
              }
            }}
            eventStartEditable={false}
            eventTimeFormat={{ hour: "numeric", minute: "2-digit", meridiem: "short" }}
            events={calendarEvents}
            expandRows
            firstDay={1}
            headerToolbar={false}
            height={calendarViewportHeight}
            initialDate={(requestedOutageView && !requestedInitialDate ? dayjs() : requestedInitialDate ?? dayjs()).toDate()}
            initialView={getFullCalendarViewName(initialView)}
            longPressDelay={500}
            navLinkDayClick={(date) => navigateToDay(dayjs(date))}
            navLinks
            nowIndicator
            plugins={fullCalendarPlugins}
            ref={calendarRef}
            scrollTime={defaultCalendarScrollTime}
            scrollTimeReset={false}
            select={handleCalendarSelect}
            selectAllow={(selectionInfo) => !selectionInfo.allDay}
            selectLongPressDelay={500}
            selectMinDistance={5}
            selectMirror
            selectable={activeCalendarView !== "month"}
            slotDuration="00:15:00"
            slotEventOverlap={false}
            slotLabelFormat={{ hour: "numeric", minute: "2-digit", omitZeroMinute: true, meridiem: "short" }}
            slotLabelInterval="01:00:00"
            slotLabelContent={(info) => {
              const time = info.time as unknown as { days?: number; milliseconds: number };
              const offset = (time.days ?? 0) * DAY_MS + time.milliseconds;
              // An overnight Day marks where the next day begins.
              return offset === DAY_MS ? "Midnight" : info.text;
            }}
            slotLaneClassNames={(info) => {
              const time = info.time as unknown as { days?: number; milliseconds: number } | undefined;
              if (!time) {
                return [];
              }
              const offset = (time.days ?? 0) * DAY_MS + time.milliseconds;
              return offset === DAY_MS
                ? ["calendar-slot--next-day", "calendar-slot--midnight"]
                : offset > DAY_MS
                  ? ["calendar-slot--next-day"]
                  : [];
            }}
            slotMaxTime={overnightDay?.slotMaxTime ?? "24:00:00"}
            slotMinTime="00:00:00"
            snapDuration="00:15:00"
            unselectAuto={false}
            views={{
              dayGridMonth: {
                dayHeaderFormat: { weekday: "short" },
              },
              timeGridDay: {
                dayHeaderFormat: { weekday: "long", month: "short", day: "numeric" },
              },
              timeGridWeek: {
                dayHeaderFormat: { weekday: "short", month: "short", day: "numeric" },
              },
            }}
          />
        </div>
        {isSidebarEntryFormOpen ? (
          <CalendarEntryForm
            boardBuckets={boardBuckets}
            canEdit={canEditBoard}
            deleteConfirmationOpen={isDeleteConfirmationOpen}
            draft={entryDraft}
            error={entryCreateError}
            intent={activeEntryFormIntent ?? "create"}
            isDeleting={isDeletingEntry}
            isDirty={isEntryFormDirty}
            isSaving={isCreatingEntry}
            mode="sidebar"
            onCancel={handleEntryFormCancel}
            onChange={(patch) => setEntryDraft((current) => ({ ...current, ...patch }))}
            onDeleteCancel={() => setIsDeleteConfirmationOpen(false)}
            onDeleteConfirm={() => void handleDeleteEntry()}
            onDeleteRequest={() => setIsDeleteConfirmationOpen(true)}
            onModeChange={() => setIsEntryFormExpanded(true)}
            onReset={handleResetEntryDraft}
            onSubmit={() => void (activeEntryFormIntent === "edit" ? handleUpdateEntry() : handleCreateEntry())}
          />
        ) : shouldRenderCalendarInspector ? (
          <CalendarInspector
            key={filteredSelectedEvent ? String(filteredSelectedEvent.id) : "calendar-inspector-empty"}
            boardBuckets={boardBuckets}
            boardId={boardContext.activeBoardId}
            canClearSelection={Boolean(selectedEvent)}
            canEditBoard={canEditBoard}
            conversionError={conversionError}
            convertingEventId={convertingEventId}
            event={filteredSelectedEvent}
            hiddenEvent={hiddenSelectedEvent}
            inspectorRef={inspectorRef}
            onClearSelection={handleClearSelection}
            onConvert={handleConvert}
            onShowHiddenEvent={handleShowSelectedEvent}
          />
        ) : null}
      </div>
    </section>
  );
}
