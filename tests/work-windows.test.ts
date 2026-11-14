import assert from "node:assert/strict";
import test from "node:test";

import {
  formatHours,
  formatItemSpan,
  getItemSpan,
  getUnionMs,
  getWindowFill,
  isOutsideWindow,
} from "../src/lib/work-windows";

const tz = "America/Chicago";
// Tue Dec 8, 2026, 8:00 PM CST is 02:00 UTC on Dec 9.
const window = { startAt: "2026-12-09T02:00:00.000Z", endAt: "2026-12-09T11:00:00.000Z" };

test("a window's fill counts parallel work once and ignores untimed children", () => {
  const children = [
    { startAt: "2026-12-09T02:30:00.000Z", endAt: "2026-12-09T04:30:00.000Z" },
    { startAt: "2026-12-09T04:30:00.000Z", endAt: "2026-12-09T06:30:00.000Z" },
    { startAt: "2026-12-09T04:30:00.000Z", endAt: "2026-12-09T05:30:00.000Z" },
    { startAt: "2026-12-09T06:30:00.000Z", endAt: "2026-12-09T07:30:00.000Z" },
    { startAt: null, endAt: null },
  ];

  assert.deepEqual(getWindowFill(window, children), { totalHours: 9, scheduledHours: 5 });
  assert.equal(getWindowFill({ startAt: null, endAt: null }, children), null);
});

test("only the part of a child inside the window counts toward its fill", () => {
  const spill = [{ startAt: "2026-12-09T10:00:00.000Z", endAt: "2026-12-09T13:00:00.000Z" }];
  assert.deepEqual(getWindowFill(window, spill), { totalHours: 9, scheduledHours: 1 });
  assert.equal(isOutsideWindow(window, spill[0]), true);
  assert.equal(isOutsideWindow(window, { startAt: "2026-12-09T03:00:00.000Z", endAt: "2026-12-09T04:00:00.000Z" }), false);
});

test("all-day spans run to the end of their last day", () => {
  const span = getItemSpan({ startAt: "2026-12-07T06:00:00.000Z", endAt: "2026-12-10T06:00:00.000Z", allDay: true });
  assert.ok(span);
  assert.equal((span.end - span.start) / 3_600_000, 96);
  assert.equal(getItemSpan({ startAt: "2026-12-09T02:00:00.000Z", endAt: null }), null);
  assert.equal(getUnionMs([]), 0);
});

test("spans read in plain words, overnight windows included", () => {
  assert.equal(formatItemSpan(window, { timeZone: tz }), "Tue Dec 8 · 8:00 PM → 5:00 AM");
  assert.equal(
    formatItemSpan({ startAt: "2026-12-09T02:30:00.000Z", endAt: "2026-12-09T04:30:00.000Z" }, { timeZone: tz, includeDay: false }),
    "8:30 PM → 10:30 PM",
  );
  assert.equal(
    formatItemSpan({ startAt: "2026-12-07T06:00:00.000Z", endAt: "2026-12-10T06:00:00.000Z", allDay: true }, { timeZone: tz }),
    "Mon Dec 7 → Thu Dec 10",
  );
  assert.equal(
    formatItemSpan({ startAt: "2026-12-07T06:00:00.000Z", endAt: "2026-12-07T06:00:00.000Z", allDay: true }, { timeZone: tz }),
    "Mon Dec 7 · all day",
  );
  assert.equal(formatHours(5), "5");
  assert.equal(formatHours(5.5), "5.5");
});
