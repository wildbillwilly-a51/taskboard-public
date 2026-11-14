import assert from "node:assert/strict";
import test from "node:test";
import dayjs from "dayjs";
import { calendarTimelineLayout, mobileCalendarWeek, occursOnCalendarDay } from "../src/lib/mobile-calendar-layout";

test("mobile agenda respects exclusive ends and repeats ongoing events", () => {
  const event = { start: "2026-10-19T22:00:00", end: "2026-10-21T00:00:00" };
  assert.equal(occursOnCalendarDay(event, dayjs("2026-10-18")), false);
  assert.equal(occursOnCalendarDay(event, dayjs("2026-10-19")), true);
  assert.equal(occursOnCalendarDay(event, dayjs("2026-10-20")), true);
  assert.equal(occursOnCalendarDay(event, dayjs("2026-10-21")), false);
  assert.equal(occursOnCalendarDay({ start: "2026-10-19", end: "2026-10-20", allDay: true }, dayjs("2026-10-20")), false);
  assert.equal(occursOnCalendarDay({ start: "2026-10-19T09:00", end: "2026-10-19T09:00" }, dayjs("2026-10-19")), true);
});

test("week overview starts Monday, including a Sunday selection", () => {
  assert.equal(mobileCalendarWeek(dayjs("2026-10-25")).format("YYYY-MM-DD"), "2026-10-19");
  assert.equal(mobileCalendarWeek(dayjs("2026-10-19")).format("YYYY-MM-DD"), "2026-10-19");
});

test("timeline gives overlapping events separate lanes and extends through late outages", () => {
  const events = [
    { start: "2026-10-19T09:00", end: "2026-10-19T10:00" },
    { start: "2026-10-19T09:30", end: "2026-10-19T11:00" },
    { start: "2026-10-19T18:00", end: "2026-10-19T23:00" },
  ];
  const layout = calendarTimelineLayout(events, dayjs("2026-10-19"));
  assert.deepEqual(layout.segments.map(({ lane, lanes }) => [lane, lanes]), [[0, 2], [1, 2], [0, 1]]);
  assert.equal(layout.lastHour, 23);
});

test("overnight timeline clips at each local midnight and keeps all-day items separate", () => {
  const events = [{ start: "2026-10-19T22:00", end: "2026-10-20T02:00" }, { start: "2026-10-20", end: "2026-10-21", allDay: true }];
  const layout = calendarTimelineLayout(events, dayjs("2026-10-20"));
  assert.equal(layout.segments.length, 1);
  assert.equal(layout.segments[0].from, 0);
  assert.equal(layout.segments[0].to, 120);
  assert.equal(layout.firstHour, 0);
});

test("short adjacent timeline events keep separate non-overlapping touch targets", () => {
  const layout = calendarTimelineLayout([{ start: "2026-10-19T09:00", end: "2026-10-19T09:15" }, { start: "2026-10-19T09:15", end: "2026-10-19T09:30" }], dayjs("2026-10-19"));
  assert.deepEqual(layout.segments.map(item => [item.lane, item.lanes]), [[0, 2], [1, 2]]);
  assert.equal(layout.segments[0].to - layout.segments[0].from, 15);
});
