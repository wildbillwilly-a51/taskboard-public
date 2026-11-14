import assert from "node:assert/strict";
import test from "node:test";

import {
  getCalendarFocusDate,
  getCalendarFocusDateTime,
  normalizeCalendarTimeSelection,
  normalizeCalendarTaskDate,
} from "../src/lib/calendar-date-utils";

test("calendar time selection preserves a dragged multi-slot range", () => {
  const start = new Date("2026-07-24T15:00:00.000Z");
  const end = new Date("2026-07-24T16:30:00.000Z");

  assert.deepEqual(normalizeCalendarTimeSelection(start, end), { start, end });
});

test("calendar time selection enforces a 15-minute minimum", () => {
  const start = new Date("2026-07-24T15:00:00.000Z");

  assert.deepEqual(normalizeCalendarTimeSelection(start, null), {
    start,
    end: new Date("2026-07-24T15:15:00.000Z"),
  });
  assert.deepEqual(
    normalizeCalendarTimeSelection(start, new Date("2026-07-24T15:05:00.000Z")),
    {
      start,
      end: new Date("2026-07-24T15:15:00.000Z"),
    },
  );
});

test("calendar time selection rejects an invalid start", () => {
  assert.equal(normalizeCalendarTimeSelection(null, new Date()), null);
  assert.equal(normalizeCalendarTimeSelection(new Date("invalid"), new Date()), null);
});

test("calendar focus date accepts date-only strings without timezone conversion", () => {
  assert.equal(getCalendarFocusDate("2026-07-24"), "2026-07-24");
  assert.equal(getCalendarFocusDate(" 2026-07-24 "), "2026-07-24");
});

test("calendar focus date accepts Date values", () => {
  assert.equal(getCalendarFocusDate(new Date(2026, 6, 24, 9, 30)), "2026-07-24");
});

test("calendar focus date ignores nullish and empty values", () => {
  assert.equal(getCalendarFocusDate(null), null);
  assert.equal(getCalendarFocusDate(undefined), null);
  assert.equal(getCalendarFocusDate(""), null);
  assert.equal(getCalendarFocusDate("   "), null);
});

test("calendar focus date ignores invalid or unexpected values", () => {
  assert.equal(getCalendarFocusDate("not-a-date"), null);
  assert.equal(getCalendarFocusDate(new Date("not-a-date")), null);
  assert.equal(getCalendarFocusDate(12345), null);
  assert.equal(getCalendarFocusDate({ value: "2026-07-24" }), null);
});

test("calendar task date normalization handles string and Date values", () => {
  assert.equal(normalizeCalendarTaskDate("2026-07-24"), "2026-07-24");
  assert.equal(normalizeCalendarTaskDate(" 2026-07-24T15:30:00.000Z "), "2026-07-24T15:30:00.000Z");
  assert.equal(
    normalizeCalendarTaskDate("Fri Jul 24 2026 10:30:00 GMT-0500 (Central Daylight Time)"),
    "Fri Jul 24 2026 10:30:00 GMT-0500 (Central Daylight Time)",
  );
  assert.equal(
    normalizeCalendarTaskDate(new Date("2026-07-24T15:30:00.000Z")),
    "2026-07-24T15:30:00.000Z",
  );
});

test("calendar focus date-time emits a URL-safe ISO value without changing event storage", () => {
  assert.equal(getCalendarFocusDateTime("2026-07-24"), "2026-07-24");
  assert.equal(
    getCalendarFocusDateTime("Fri Jul 24 2026 10:30:00 GMT-0500 (Central Daylight Time)"),
    "2026-07-24T15:30:00.000Z",
  );
});

test("calendar task date normalization rejects unsafe values quietly", () => {
  assert.equal(normalizeCalendarTaskDate(null), undefined);
  assert.equal(normalizeCalendarTaskDate(undefined), undefined);
  assert.equal(normalizeCalendarTaskDate(""), undefined);
  assert.equal(normalizeCalendarTaskDate("not-a-date"), undefined);
  assert.equal(normalizeCalendarTaskDate(new Date("not-a-date")), undefined);
  assert.equal(normalizeCalendarTaskDate(12345), undefined);
});
