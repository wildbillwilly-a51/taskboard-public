import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { mapCalendarEntriesToCalendarEvents } from "@/lib/calendar-entry-events";
import type { CalendarEntry } from "@/lib/taskboard-data";

const calendarInnerSource = readFileSync("src/components/calendar-proof-inner.tsx", "utf8");

test("calendar entry initiation supports snapped Day and Week range selection", () => {
  assert.match(calendarInnerSource, /select=\{handleCalendarSelect\}/);
  assert.match(calendarInnerSource, /selectMinDistance=\{5\}/);
  assert.match(calendarInnerSource, /selectMirror/);
  assert.match(calendarInnerSource, /selectable=\{activeCalendarView !== "month"\}/);
  assert.match(calendarInnerSource, /normalizeCalendarTimeSelection\(info\.start, info\.end\)/);
  assert.match(calendarInnerSource, /Clear selected calendar time/);
  assert.match(calendarInnerSource, /taskboard-calendar-proof__calendar--slot-selected/);
  assert.match(calendarInnerSource, /if \(!info\.event\.extendedProps\.taskboardEvent\)/);
  assert.match(calendarInnerSource, /return undefined;/);
});

function entry(overrides: Partial<CalendarEntry> = {}): CalendarEntry {
  return {
    id: "entry",
    boardId: "board",
    title: "Calendar hold",
    startAt: "2026-07-09T14:00:00.000Z",
    endAt: "2026-07-09T15:00:00.000Z",
    allDay: false,
    location: "Office",
    description: "Reserve time for planning.",
    color: "#14b8a6",
    updatedAt: "2026-07-09T13:00:00.000Z",
    ...overrides,
  };
}

test("maps native calendar entries to Taskboard calendar item events", () => {
  const events = mapCalendarEntriesToCalendarEvents([entry()]);

  assert.equal(events.length, 1);
  assert.equal(events[0].id, "calendar-entry-entry");
  assert.equal(events[0].title, "Calendar hold");
  assert.equal(events[0].start, "2026-07-09T14:00:00.000Z");
  assert.equal(events[0].end, "2026-07-09T15:00:00.000Z");
  assert.equal(events[0].location, "Office");
  assert.equal(events[0].color, "#14b8a6");
  assert.equal(events[0].data.kind, "calendar-entry");
  assert.equal(events[0].data.badge, "Calendar item");
  assert.equal(events[0].data.status, "Calendar item");
  assert.equal(events[0].data.source, "Taskboard Calendar");
  assert.equal(events[0].data.readOnly, false);
  assert.equal(events[0].data.calendarEntryId, "entry");
  assert.equal(events[0].data.boardId, "board");
  assert.equal(events[0].data.summary, "Reserve time for planning.");
});

test("preserves all-day calendar entry metadata", () => {
  const events = mapCalendarEntriesToCalendarEvents([
    entry({
      allDay: true,
      location: "",
      description: "",
    }),
  ]);

  assert.equal(events.length, 1);
  assert.equal(events[0].allDay, true);
  assert.equal(events[0].location, undefined);
  assert.equal(events[0].data.location, undefined);
  assert.equal(events[0].data.summary, undefined);
});

test("suppresses native calendar entries that were converted to linked tasks", () => {
  const events = mapCalendarEntriesToCalendarEvents([
    entry({ id: "unlinked" }),
    entry({ id: "linked", linkedTaskId: "task-linked" }),
  ]);

  assert.equal(events.length, 1);
  assert.equal(events[0].data.calendarEntryId, "unlinked");
});
