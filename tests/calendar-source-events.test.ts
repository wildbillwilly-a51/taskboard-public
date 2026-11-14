import assert from "node:assert/strict";
import test from "node:test";

import {
  mapImportedCalendarSourceEvents,
  suppressTaskEventsLinkedToImportedSources,
  type ImportedCalendarSourceRow,
} from "@/lib/calendar-source-events";
import type { TaskboardCalendarTaskEvent } from "@/lib/calendar-task-events";

function row(overrides: Partial<ImportedCalendarSourceRow>): ImportedCalendarSourceRow {
  return {
    id: "event",
    provider: "ics",
    externalEventId: "external-event",
    title: "Imported event",
    startsAt: "2026-07-08T15:00:00.000Z",
    endsAt: "2026-07-08T16:30:00.000Z",
    location: "Conference room",
    syncStatus: "active",
    linkedTaskId: "task-imported",
    linkedTaskIsReadOnlyImport: true,
    isRecurring: false,
    ...overrides,
  };
}

function taskEvent(taskId: string): TaskboardCalendarTaskEvent {
  return {
    id: `taskboard-${taskId}`,
    title: "Task",
    start: "2026-07-08T15:00:00.000Z",
    end: "2026-07-08T16:00:00.000Z",
    color: "#0f766e",
    backgroundColor: "rgba(15, 118, 110, 0.18)",
    data: {
      kind: "taskboard-task",
      source: "Taskboard",
      sourceType: "task",
      status: "Read-only imported Taskboard task",
      badge: "Taskboard task",
      owner: "Taskboard",
      readOnly: true,
      taskEditable: false,
      linkedTaskId: taskId,
      tone: "task",
      taskId,
      boardId: "board",
      taskStatus: "waiting",
      taskIcon: "calendar",
      bucketId: "bucket",
      bucketTitle: "Calendar Imports",
      bucketColor: "#64748b",
      labels: ["Imported"],
    },
  };
}

test("maps active ICS rows to read-only source calendar events", () => {
  const events = mapImportedCalendarSourceEvents([row({ isRecurring: true })]);

  assert.equal(events.length, 1);
  assert.equal(events[0].id, "source-ics-event");
  assert.equal(events[0].title, "Imported event");
  assert.equal(events[0].start, "2026-07-08T15:00:00.000Z");
  assert.equal(events[0].end, "2026-07-08T16:30:00.000Z");
  assert.equal(events[0].location, "Conference room");
  assert.equal(events[0].data.kind, "imported-source");
  assert.equal(events[0].data.badge, "ICS");
  assert.equal(events[0].data.status, "ICS");
  assert.equal(events[0].data.source, "ICS");
  assert.equal(events[0].data.providerLabel, "ICS");
  assert.equal(events[0].data.owner, "ICS");
  assert.equal(events[0].data.syncStatus, "active");
  assert.equal(events[0].data.importedEventId, "event");
  assert.equal(events[0].data.sourceEventId, "external-event");
  assert.equal(events[0].data.linkedTaskId, "task-imported");
  assert.equal(events[0].data.hasRecurrence, true);
});

test("hides stale imports so removed sources no longer occupy the calendar", () => {
  const events = mapImportedCalendarSourceEvents([
    row({
      provider: "ics",
      externalEventId: "ics-uid",
      syncStatus: "stale",
      isRecurring: false,
    }),
  ]);

  assert.equal(events.length, 0);
});

test("hides deleted rows and rows without usable start dates", () => {
  const events = mapImportedCalendarSourceEvents([
    row({ id: "deleted", syncStatus: "deleted" }),
    row({ id: "missing-start", startsAt: null }),
    row({ id: "invalid-start", startsAt: "not-a-date" }),
  ]);

  assert.equal(events.length, 0);
});

test("falls back to a one-hour end when imported end is missing", () => {
  const events = mapImportedCalendarSourceEvents([
    row({
      startsAt: "2026-07-08T15:00:00.000Z",
      endsAt: null,
    }),
  ]);

  assert.equal(events.length, 1);
  assert.equal(Date.parse(events[0].end) - Date.parse(events[0].start), 60 * 60 * 1000);
});

test("uses stored calendar fallback metadata for manual or unknown providers", () => {
  const events = mapImportedCalendarSourceEvents([
    row({
      provider: "manual",
      externalEventId: null,
      linkedTaskId: null,
    }),
  ]);

  assert.equal(events.length, 1);
  assert.equal(events[0].data.badge, "Calendar");
  assert.equal(events[0].data.providerLabel, "Calendar");
  assert.equal(events[0].data.sourceEventId, undefined);
  assert.equal(events[0].data.linkedTaskId, undefined);
  assert.equal(events[0].data.suppressLinkedTaskEvent, false);
  assert.equal("rawPayload" in events[0].data, false);
});

test("keeps active source rows linked to editable Taskboard tasks", () => {
  const events = mapImportedCalendarSourceEvents([
    row({
      linkedTaskId: "converted-task",
      linkedTaskIsReadOnlyImport: false,
    }),
  ]);

  assert.equal(events.length, 1);
  assert.equal(events[0].data.linkedTaskId, "converted-task");
  assert.equal(events[0].data.suppressLinkedTaskEvent, true);
});

test("suppresses duplicate read-only imported task events when source rows render", () => {
  const sourceEvents = mapImportedCalendarSourceEvents([row({ linkedTaskId: "task-imported" })]);
  const taskEvents = [taskEvent("task-imported"), taskEvent("task-native")];

  const filtered = suppressTaskEventsLinkedToImportedSources(taskEvents, sourceEvents);

  assert.deepEqual(filtered.map((event) => event.data.taskId), ["task-native"]);
});
