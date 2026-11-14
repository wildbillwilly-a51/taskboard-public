import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getEffectiveCalendarTaskResizeRange,
  getCalendarResizeEdges,
  isTimedCalendarResizeRange,
  resizeCalendarRangeByKeyboard,
  resizeCalendarRangeToDateSpan,
} from "@/lib/calendar-resize";

const taskScheduleRouteSource = readFileSync(
  "src/app/api/calendar/tasks/[taskId]/schedule/route.ts",
  "utf8",
);
const entryScheduleRouteSource = readFileSync(
  "src/app/api/calendar/entries/[entryId]/schedule/route.ts",
  "utf8",
);
const taskboardStoreSource = readFileSync("src/lib/taskboard-store.ts", "utf8");
const calendarInnerSource = readFileSync("src/components/calendar-proof-inner.tsx", "utf8");
const globalStylesSource = readFileSync("src/app/globals.css", "utf8");

const baseRange = {
  startAt: "2026-07-13T09:00:00.000Z",
  endAt: "2026-07-13T10:00:00.000Z",
};

test("only complete timed ranges of at least 15 minutes are resizeable", () => {
  assert.equal(isTimedCalendarResizeRange(baseRange), true);
  assert.equal(
    isTimedCalendarResizeRange({ ...baseRange, startAt: "2026-07-13" }),
    false,
  );
  assert.equal(
    isTimedCalendarResizeRange({ ...baseRange, endAt: "2026-07-13T09:15:00.000Z" }),
    true,
  );
  assert.equal(
    isTimedCalendarResizeRange({ ...baseRange, endAt: "2026-07-13T09:14:00.000Z" }),
    false,
  );
  assert.equal(
    isTimedCalendarResizeRange({ ...baseRange, endAt: "2026-07-13T08:00:00.000Z" }),
    false,
  );
});

test("timed tasks with one stored date use the displayed one-hour resize range", () => {
  assert.deepEqual(
    getEffectiveCalendarTaskResizeRange({ startAt: baseRange.startAt }),
    baseRange,
  );
  assert.deepEqual(
    getEffectiveCalendarTaskResizeRange({ endAt: baseRange.startAt }),
    baseRange,
  );
  assert.deepEqual(
    getEffectiveCalendarTaskResizeRange({ dueAt: baseRange.startAt }),
    baseRange,
  );
  assert.equal(
    getEffectiveCalendarTaskResizeRange({ startAt: "2026-07-13", allDay: true }),
    null,
  );
});

test("FullCalendar Date values normalize before a pointer resize is committed", () => {
  assert.deepEqual(
    getEffectiveCalendarTaskResizeRange({ startAt: new Date(baseRange.startAt) }),
    baseRange,
  );
  assert.deepEqual(
    getEffectiveCalendarTaskResizeRange({
      startAt: new Date(baseRange.startAt),
      endAt: new Date(baseRange.endAt),
    }),
    baseRange,
  );
});

test("calendar views expose only the edge controls they can represent", () => {
  assert.deepEqual(getCalendarResizeEdges("month"), ["start-date", "end-date"]);
  assert.deepEqual(getCalendarResizeEdges("week"), [
    "start-time",
    "end-time",
    "start-date",
    "end-date",
  ]);
  assert.deepEqual(getCalendarResizeEdges("day"), ["start-time", "end-time"]);
});

test("keyboard time resize uses 15-minute steps and enforces minimum duration", () => {
  assert.deepEqual(resizeCalendarRangeByKeyboard(baseRange, "start-time", 1), {
    startAt: "2026-07-13T09:15:00.000Z",
    endAt: baseRange.endAt,
  });
  assert.deepEqual(resizeCalendarRangeByKeyboard(baseRange, "end-time", 1), {
    startAt: baseRange.startAt,
    endAt: "2026-07-13T10:15:00.000Z",
  });
  assert.equal(
    resizeCalendarRangeByKeyboard(
      { ...baseRange, endAt: "2026-07-13T09:15:00.000Z" },
      "start-time",
      1,
    ),
    null,
  );
});

test("keyboard date resize moves one local day while preserving local clock time", () => {
  const movedStart = resizeCalendarRangeByKeyboard(baseRange, "start-date", -1);
  const movedEnd = resizeCalendarRangeByKeyboard(baseRange, "end-date", 1);
  assert.ok(movedStart);
  assert.ok(movedEnd);

  const originalStart = new Date(baseRange.startAt);
  const nextStart = new Date(movedStart.startAt);
  assert.equal(nextStart.getDate(), originalStart.getDate() - 1);
  assert.equal(nextStart.getHours(), originalStart.getHours());
  assert.equal(nextStart.getMinutes(), originalStart.getMinutes());

  const originalEnd = new Date(baseRange.endAt);
  const nextEnd = new Date(movedEnd.endAt);
  assert.equal(nextEnd.getDate(), originalEnd.getDate() + 1);
  assert.equal(nextEnd.getHours(), originalEnd.getHours());
  assert.equal(nextEnd.getMinutes(), originalEnd.getMinutes());
});

test("month date projection preserves clock times and uses an exclusive end date", () => {
  const projectedStart = new Date(2026, 6, 14);
  const projectedEndExclusive = new Date(2026, 6, 16);
  const moved = resizeCalendarRangeToDateSpan(
    baseRange,
    projectedStart.toISOString(),
    projectedEndExclusive.toISOString(),
  );
  assert.ok(moved);

  const movedStart = new Date(moved.startAt);
  const movedEnd = new Date(moved.endAt);
  assert.equal(movedStart.getDate(), 14);
  assert.equal(movedEnd.getDate(), 15);
  assert.equal(movedStart.getHours(), new Date(baseRange.startAt).getHours());
  assert.equal(movedEnd.getHours(), new Date(baseRange.endAt).getHours());
});

test("native and keyboard resize affordances keep separate start and end controls", () => {
  assert.match(globalStylesSource, /fc-timegrid-event \.fc-event-resizer-start/);
  assert.match(globalStylesSource, /fc-timegrid-event \.fc-event-resizer-end/);
  assert.match(globalStylesSource, /\.fc-event-resizer \{\s*display: block;\s*opacity: 0\.72;/);
  assert.match(globalStylesSource, /fc-timegrid-event \.fc-event-resizer-start,[\s\S]*?cursor: ns-resize;[\s\S]*?height: 0\.72rem;/);
  assert.match(globalStylesSource, /fc-daygrid-event \.fc-event-resizer-start,[\s\S]*?cursor: ew-resize;[\s\S]*?width: 0\.7rem;/);
  assert.doesNotMatch(globalStylesSource, /\.fc-event-resizer \{[^}]*opacity: 0;/);
  assert.match(globalStylesSource, /calendar-proof-event__resize-handle--start-time:focus-visible/);
  assert.match(globalStylesSource, /calendar-proof-event__resize-handle--end-time:focus-visible/);
});

test("schedule routes require authenticated board context and expected original values", () => {
  for (const source of [taskScheduleRouteSource, entryScheduleRouteSource]) {
    assert.match(source, /export async function PATCH/);
    assert.match(source, /requireTaskboardUserFromHeaders/);
    assert.match(source, /getBoardContextFromRequest/);
    assert.match(source, /expectedStartAt/);
    assert.match(source, /expectedEndAt/);
  }
  assert.match(taskScheduleRouteSource, /scope !== "single" && body\.scope !== "series"/);
  assert.match(entryScheduleRouteSource, /updateNativeCalendarEntrySchedule/);
});

test("store schedule updates preserve data boundaries and use stale-write guards", () => {
  assert.match(taskboardStoreSource, /export async function updateCalendarTaskSchedule/);
  assert.match(taskboardStoreSource, /export async function updateNativeCalendarEntrySchedule/);
  assert.match(taskboardStoreSource, /resolveBoardContext\(client, user, options, "edit"\)/);
  assert.match(taskboardStoreSource, /FOR UPDATE/);
  assert.match(taskboardStoreSource, /calendar_schedule_conflict/);
  assert.match(taskboardStoreSource, /is_read_only_import/);
  assert.match(taskboardStoreSource, /entry\.all_day/);
  assert.match(taskboardStoreSource, /minimumCalendarResizeDurationMs/);
});

test("series resize targets selected and future active roots without changing recurrence metadata", () => {
  assert.match(taskboardStoreSource, /recurrence_series_id = \$2/);
  assert.match(taskboardStoreSource, /parent_task_id IS NULL/);
  assert.match(taskboardStoreSource, /status <> 'done'/);
  assert.match(taskboardStoreSource, /due_at >= \$4/);
  assert.doesNotMatch(
    taskboardStoreSource.slice(
      taskboardStoreSource.indexOf("export async function updateCalendarTaskSchedule"),
      taskboardStoreSource.indexOf("export async function updateNativeCalendarEntrySchedule"),
    ),
    /SET[\s\S]{0,120}(due_at|recurrence_series_id)\s*=/,
  );
});

test("calendar uses native resize without enabling event movement and keeps keyboard and scope UI", () => {
  assert.match(calendarInnerSource, /from "@fullcalendar\/react"/);
  assert.match(calendarInnerSource, /interactionPlugin/);
  assert.match(calendarInnerSource, /eventStartEditable=\{false\}/);
  assert.match(calendarInnerSource, /eventResizableFromStart/);
  assert.match(calendarInnerSource, /eventDurationEditable=\{canEditBoard\}/);
  assert.match(calendarInnerSource, /eventResize=\{handleFullCalendarResize\}/);
  assert.match(calendarInnerSource, /activeCalendarView === "month" \|\| event\.allDay/);
  assert.match(calendarInnerSource, /dateProjection/);
  assert.match(calendarInnerSource, /display: "block"/);
  assert.match(calendarInnerSource, /info\.revert\(\)/);
  assert.doesNotMatch(calendarInnerSource, /setPointerCapture|\.droppable-cell|disableDragAndDrop/);
  assert.match(calendarInnerSource, /addEventListener\("keydown"/);
  assert.match(calendarInnerSource, /domNodes: \[createCalendarEventCardNode/);
  assert.match(calendarInnerSource, /resizeCalendarRangeByKeyboard/);
  assert.match(calendarInnerSource, /This task/);
  assert.match(calendarInnerSource, /Series/);
  assert.match(calendarInnerSource, /\/api\/calendar\/tasks\/\$\{encodeURIComponent/);
  assert.match(calendarInnerSource, /\/api\/calendar\/entries\/\$\{encodeURIComponent/);
  // After saving, the calendar asks the shell to reload its live data.
  assert.match(calendarInnerSource, /onCalendarDataChanged\?\.\(\)/);
  assert.match(calendarInnerSource, /canEditBoard/);
  assert.match(calendarInnerSource, /data\.taskEditable && !data\.importedFrom\?\.readOnly/);
});

test("timed task projections and persistence share the effective resize range", () => {
  assert.match(calendarInnerSource, /getEffectiveCalendarTaskResizeRange\(\{/);
  assert.match(taskboardStoreSource, /const currentRange = getEffectiveCalendarTaskResizeRange\(\{/);
  assert.match(taskboardStoreSource, /calendarScheduleValuesMatch\(currentRange\.startAt, expected\.startAt\)/);
  assert.doesNotMatch(taskboardStoreSource, /Only timed tasks with stored start and end values can be resized/);
});

test("resize grips exclude all-day items and maintenance outages only from editable task and entry kinds", () => {
  const eligibilityStart = calendarInnerSource.indexOf("function canResizeCalendarEvent");
  const eligibilityEnd = calendarInnerSource.indexOf("function getFullCalendarViewName", eligibilityStart);
  const eligibilitySource = calendarInnerSource.slice(eligibilityStart, eligibilityEnd);

  assert.match(eligibilitySource, /!canEditBoard \|\| event\.allDay/);
  assert.match(eligibilitySource, /data\.workItemType === "maintenance_outage"/);
  assert.match(eligibilitySource, /data\.kind === "calendar-entry"/);
  assert.match(eligibilitySource, /data\.kind === "taskboard-task"/);
});

test("native resize commits only FullCalendar's completed range and retains rollback", () => {
  const resizeStart = calendarInnerSource.indexOf("function handleFullCalendarResize");
  const resizeEnd = calendarInnerSource.indexOf("function handleResizeKeyDown", resizeStart);
  assert.notEqual(resizeStart, -1);
  assert.notEqual(resizeEnd, -1);

  const resizeSource = calendarInnerSource.slice(resizeStart, resizeEnd);
  assert.match(resizeSource, /info\.event\.start\?\.toISOString\(\)/);
  assert.match(resizeSource, /info\.event\.end\?\.toISOString\(\)/);
  assert.match(resizeSource, /resizeCalendarRangeToDateSpan/);
  assert.match(resizeSource, /isTimedCalendarResizeRange\(proposed\)/);
  assert.match(resizeSource, /revert: info\.revert/);
  assert.match(resizeSource, /requestCalendarResizeCommit\(draft\)/);
  assert.doesNotMatch(resizeSource, /onSidebarTaskSelect/);
  assert.doesNotMatch(resizeSource, /pointermove|elementsFromPoint|setPointerCapture/);
});

test("resize handles do not trigger calendar event selection or open the task sidebar", () => {
  assert.match(calendarInnerSource, /isCalendarResizeHandleInteraction\(info\.jsEvent\)/);
  assert.match(calendarInnerSource, /target\.matches\("\.fc-event-resizer"\)/);
  assert.match(calendarInnerSource, /target\.hasAttribute\("data-calendar-resize-edge"\)/);
  assert.match(calendarInnerSource, /updateSelectedEventRangeIfCurrent\(draft\.event, draft\.proposed\)/);
});
