import assert from "node:assert/strict";
import test from "node:test";

import { formatWindowFillSummary, mapBoardTasksToCalendarEvents } from "@/lib/calendar-task-events";
import type { Board, Task } from "@/lib/taskboard-data";

function task(overrides: Partial<Task>): Task {
  return {
    id: "task",
    title: "Task",
    summary: "",
    status: "active",
    color: "#0f766e",
    icon: "calendar",
    labels: [],
    notes: [],
    checklist: [],
    attachments: [],
    subtasks: [],
    ...overrides,
  };
}

function board(tasks: Task[]): Board {
  return {
    id: "board",
    title: "Board",
    description: "",
    views: [],
    buckets: [
      {
        id: "bucket",
        title: "Today",
        color: "#d97706",
        icon: "sun",
        collapsed: false,
        tasks,
      },
    ],
  };
}

test("maps start and end tasks to calendar events with due as separate metadata", () => {
  const events = mapBoardTasksToCalendarEvents(
    board([
      task({
        id: "scheduled",
        title: "Scheduled task",
        startAt: "2026-07-08T09:00:00",
        endAt: "2026-07-08T11:30:00",
        dueAt: "2026-07-10T17:00:00",
        labels: ["Calendar"],
      }),
    ]),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].id, "taskboard-scheduled");
  assert.equal(events[0].start, "2026-07-08T09:00:00");
  assert.equal(events[0].end, "2026-07-08T11:30:00");
  assert.equal(events[0].data.status, "Taskboard task");
  assert.equal(events[0].data.badge, "Taskboard task");
  assert.equal(events[0].data.readOnly, false);
  assert.equal(events[0].data.taskEditable, true);
  assert.equal(events[0].data.boardId, "board");
  assert.equal(events[0].data.taskStartAt, "2026-07-08T09:00:00");
  assert.equal(events[0].data.taskEndAt, "2026-07-08T11:30:00");
  assert.equal(events[0].data.taskDueAt, "2026-07-10T17:00:00");
  assert.equal(events[0].data.bucketTitle, "Today");
  assert.equal(events[0].data.bucketColor, "#d97706");
  assert.deepEqual(events[0].data.labels, ["Calendar"]);
});

test("maps scheduled maintenance outages as task-backed outage events", () => {
  const events = mapBoardTasksToCalendarEvents(
    board([
      task({
        id: "outage",
        title: "Quarterly shutdown",
        workItemType: "maintenance_outage",
        maintenanceOutage: {
          locationId: "location",
          locationName: "North plant",
          owner: "Operations",
          attendees: ["Maintenance", "Safety"],
        },
        startAt: "2026-07-15T08:00:00",
        endAt: "2026-07-15T12:00:00",
      }),
    ]),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].data.badge, "Maintenance outage");
  assert.equal(events[0].data.status, "Maintenance outage");
  assert.equal(events[0].data.owner, "Operations");
  assert.equal(events[0].data.workItemType, "maintenance_outage");
  assert.equal(events[0].data.outageLocation, "North plant");
  assert.equal(events[0].data.taskEditable, true);
});

test("maps persisted all-day task timestamps with an exclusive calendar end", () => {
  const events = mapBoardTasksToCalendarEvents(
    board([
      task({
        id: "all-day-outage",
        title: "Plant shutdown",
        workItemType: "maintenance_outage",
        allDay: true,
        startAt: "2026-07-15T05:00:00.000Z",
        endAt: "2026-07-16T05:00:00.000Z",
      }),
    ]),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].allDay, true);
  assert.equal(events[0].start, "2026-07-15T05:00:00.000Z");
  assert.equal(events[0].end, "2026-07-17T05:00:00.000Z");
  assert.equal(events[0].data.taskStartAt, "2026-07-15T05:00:00.000Z");
  assert.equal(events[0].data.taskEndAt, "2026-07-16T05:00:00.000Z");
});

test("keeps title-only unscheduled maintenance outages off the calendar", () => {
  const events = mapBoardTasksToCalendarEvents(
    board([
      task({
        id: "unscheduled-outage",
        title: "Potential shutdown",
        allDay: true,
        workItemType: "maintenance_outage",
        maintenanceOutage: { owner: "", attendees: [] },
      }),
    ]),
  );

  assert.deepEqual(events, []);
});

test("maps start-only date-only tasks as all-day task events", () => {
  const events = mapBoardTasksToCalendarEvents(
    board([
      task({
        id: "start-only",
        title: "Start only",
        startAt: "2026-07-08",
      }),
    ]),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].start, "2026-07-08");
  assert.equal(events[0].end, "2026-07-09");
  assert.equal(events[0].allDay, true);
  assert.equal(events[0].data.taskStartAt, "2026-07-08");
  assert.equal(events[0].data.taskDueAt, undefined);
});

test("maps due-only dated tasks as legacy one-hour task calendar events", () => {
  const events = mapBoardTasksToCalendarEvents(
    board([
      task({
        id: "due",
        title: "Due task",
        dueAt: "2026-07-08T14:00:00",
      }),
    ]),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].id, "taskboard-due");
  assert.equal(events[0].start, "2026-07-08T14:00:00");
  assert.equal(Date.parse(events[0].end) - Date.parse(events[0].start), 60 * 60 * 1000);
  assert.equal(events[0].allDay, undefined);
  assert.equal(events[0].data.taskStartAt, undefined);
  assert.equal(events[0].data.taskDueAt, "2026-07-08T14:00:00");
});

test("keeps invalid or same-day all-day ranges conservative", () => {
  const events = mapBoardTasksToCalendarEvents(
    board([
      task({
        id: "same-day",
        title: "Same day",
        startAt: "2026-07-08",
        endAt: "2026-07-08",
      }),
      task({
        id: "reversed",
        title: "Reversed",
        startAt: "2026-07-10T15:00:00",
        endAt: "2026-07-10T09:00:00",
      }),
    ]),
  );

  assert.equal(events.length, 2);
  assert.equal(events[0].start, "2026-07-08");
  assert.equal(events[0].end, "2026-07-09");
  assert.equal(events[0].allDay, true);
  assert.equal(events[1].start, "2026-07-10T15:00:00");
  assert.equal(Date.parse(events[1].end) - Date.parse(events[1].start), 60 * 60 * 1000);
  assert.equal(events[1].allDay, undefined);
});

test("skips tasks without usable dates and includes nested dated tasks", () => {
  const events = mapBoardTasksToCalendarEvents(
    board([
      task({
        id: "parent",
        title: "Parent",
        subtasks: [
          task({
            id: "child",
            title: "Child",
            dueAt: "2026-07-09",
          }),
        ],
      }),
      task({
        id: "invalid",
        title: "Invalid",
        dueAt: "not-a-date",
      }),
    ]),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].id, "taskboard-child");
  assert.equal(events[0].allDay, true);
  assert.equal(events[0].end, "2026-07-10");
  assert.equal(events[0].data.parentTaskTitle, "Parent");
});

test("preserves imported task metadata without making it a sample source event", () => {
  const events = mapBoardTasksToCalendarEvents(
    board([
      task({
        id: "imported",
        title: "Imported task",
        dueAt: "2026-07-10T10:00:00",
        importedFrom: {
          source: "ics",
          readOnly: true,
          convertToTask: true,
          providerLabel: "ICS",
        },
      }),
    ]),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].data.kind, "taskboard-task");
  assert.equal(events[0].data.readOnly, true);
  assert.equal(events[0].data.status, "ICS");
  assert.equal(events[0].data.badge, "ICS");
  assert.equal(events[0].data.taskEditable, false);
  assert.equal(events[0].data.source, "ICS");
  assert.equal(events[0].data.importedFrom?.providerLabel, "ICS");
});

test("marks converted imported tasks as editable Taskboard tasks", () => {
  const events = mapBoardTasksToCalendarEvents(
    board([
      task({
        id: "converted",
        title: "Converted task",
        dueAt: "2026-07-10T10:00:00",
        importedFrom: {
          source: "ics",
          readOnly: false,
          convertToTask: true,
          providerLabel: "ICS",
          syncStatus: "active",
        },
      }),
    ]),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].data.kind, "taskboard-task");
  assert.equal(events[0].data.status, "Converted Taskboard task");
  assert.equal(events[0].data.badge, "Converted task");
  assert.equal(events[0].data.readOnly, false);
  assert.equal(events[0].data.taskEditable, true);
  assert.equal(events[0].data.importedFrom?.readOnly, false);
});

test("normalizes Date-valued task fields from persisted board data", () => {
  const events = mapBoardTasksToCalendarEvents(
    board([
      task({
        id: "persisted-date",
        title: "Persisted date task",
        dueAt: new Date("2026-07-11T16:00:00.000Z") as unknown as string,
      }),
    ]),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].start, "2026-07-11T16:00:00.000Z");
});

test("marks outage windows and their work for the Outages calendar", () => {
  const events = mapBoardTasksToCalendarEvents(
    board([
      task({
        id: "outage",
        title: "ELD Dec Outage",
        workItemType: "maintenance_outage",
        maintenanceOutage: { locationName: "ELD" } as Task["maintenanceOutage"],
        startAt: "2026-12-07",
        endAt: "2026-12-10",
        allDay: true,
        subtasks: [
          task({
            id: "window",
            title: "IT Networking window",
            startAt: "2026-12-08T20:00:00",
            endAt: "2026-12-09T05:00:00",
            subtasks: [
              task({ id: "core", title: "Core switch", startAt: "2026-12-08T20:00:00", endAt: "2026-12-08T23:00:00" }),
              task({ id: "wan", title: "WAN cutover", startAt: "2026-12-08T22:00:00", endAt: "2026-12-09T01:00:00" }),
              task({ id: "tbd", title: "Firmware" }),
            ],
          }),
          task({ id: "loose", title: "Rack walk", startAt: "2026-12-07T09:00:00", endAt: "2026-12-07T10:00:00" }),
        ],
      }),
      task({ id: "plain", title: "Dentist", startAt: "2026-12-08T09:00:00", endAt: "2026-12-08T10:00:00" }),
    ]),
  );
  const byId = Object.fromEntries(events.map((event) => [event.data.taskId, event.data]));

  assert.equal(byId.outage.outageTaskId, "outage");
  assert.equal(byId.outage.windowRole, undefined);
  assert.equal(byId.window.windowRole, "window");
  assert.equal(byId.window.outageLabel, "ELD");
  assert.equal(byId.window.badge, "ELD");
  assert.deepEqual(byId.window.windowFill, {
    totalHours: 9,
    scheduledHours: 5,
    scheduledCount: 2,
    unscheduledCount: 1,
  });
  assert.equal(byId.core.windowRole, "work");
  assert.equal(byId.core.windowTaskId, "window");
  assert.equal(byId.core.outageTaskId, "outage");
  assert.equal(byId.loose.windowRole, undefined);
  assert.equal(byId.loose.outageTaskId, "outage");
  assert.equal(byId.plain.outageTaskId, undefined);
  assert.equal(byId.plain.badge, "Taskboard task");
  assert.equal(byId.tbd, undefined);
});

test("summarizes how full a window is", () => {
  assert.equal(formatWindowFillSummary(undefined), "Nothing scheduled yet");
  assert.equal(
    formatWindowFillSummary({ totalHours: 9, scheduledHours: 5.5, scheduledCount: 3, unscheduledCount: 0 }),
    "3 scheduled · 5.5 of 9 h",
  );
  assert.equal(
    formatWindowFillSummary({ totalHours: 9, scheduledHours: 0, scheduledCount: 0, unscheduledCount: 2 }),
    "Nothing scheduled yet",
  );
});
