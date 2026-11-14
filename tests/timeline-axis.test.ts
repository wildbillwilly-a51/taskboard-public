import assert from "node:assert/strict";
import test from "node:test";

import { getTimelineAxis } from "../src/lib/timeline-axis";

const iso = (at: number) => new Date(at).toISOString();
const span = (start: string, end: string) => ({ start: Date.parse(start), end: Date.parse(end) });
const describe = (axis: ReturnType<typeof getTimelineAxis>) => ({
  ticks: axis.ticks.map((tick) => `${iso(tick.at)} ${tick.label}`),
  nights: axis.nights.map((night) => `${iso(night.start)} → ${iso(night.end)}`),
});

// Runs `run` with the process (the "browser") in another time zone.
function inViewerZone<T>(viewerZone: string, run: () => T): T {
  const previous = process.env.TZ;
  process.env.TZ = viewerZone;
  try {
    return run();
  } finally {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  }
}

test("day ticks and nights follow the task's zone, not the viewer's", () => {
  // Mon Dec 7 00:00 CST → Thu Dec 10 00:00 CST.
  const range = span("2026-12-07T06:00:00Z", "2026-12-10T06:00:00Z");
  const expected = {
    ticks: [
      "2026-12-07T06:00:00.000Z 7 Mon",
      "2026-12-08T06:00:00.000Z 8 Tue",
      "2026-12-09T06:00:00.000Z 9 Wed",
    ],
    nights: [
      "2026-12-07T00:00:00.000Z → 2026-12-07T12:00:00.000Z",
      "2026-12-08T00:00:00.000Z → 2026-12-08T12:00:00.000Z",
      "2026-12-09T00:00:00.000Z → 2026-12-09T12:00:00.000Z",
      "2026-12-10T00:00:00.000Z → 2026-12-10T12:00:00.000Z",
    ],
  };
  for (const viewerZone of ["America/Chicago", "Asia/Tokyo", "Pacific/Honolulu", "UTC"]) {
    const axis = inViewerZone(viewerZone, () => {
      // Guard: the viewer's local midnight really differs from the task's for the foreign zones.
      if (viewerZone !== "America/Chicago") assert.notEqual(new Date(range.start).getHours(), 0);
      return getTimelineAxis(range, "America/Chicago");
    });
    assert.deepEqual(describe(axis), expected, `viewer in ${viewerZone}`);
  }
});

test("days and nights stay on the wall clock across the fall-back change", () => {
  // US DST ends 2026-11-01 at 02:00 in Chicago: Oct 31 00:00 CDT → Nov 3 00:00 CST.
  const axis = inViewerZone("Europe/London", () =>
    getTimelineAxis(span("2026-10-31T05:00:00Z", "2026-11-03T06:00:00Z"), "America/Chicago"),
  );
  assert.deepEqual(describe(axis), {
    ticks: [
      "2026-10-31T05:00:00.000Z 31 Sat",
      "2026-11-01T05:00:00.000Z 1 Sun",
      "2026-11-02T06:00:00.000Z 2 Mon",
    ],
    nights: [
      "2026-10-30T23:00:00.000Z → 2026-10-31T11:00:00.000Z",
      // The night the clocks go back runs 13 hours, 18:00 CDT to 06:00 CST.
      "2026-10-31T23:00:00.000Z → 2026-11-01T12:00:00.000Z",
      "2026-11-02T00:00:00.000Z → 2026-11-02T12:00:00.000Z",
      "2026-11-03T00:00:00.000Z → 2026-11-03T12:00:00.000Z",
    ],
  });
});

test("the spring-forward night is 11 hours and the next midnight is in daylight time", () => {
  // US DST starts 2026-03-08 at 02:00 in Chicago: Mar 7 00:00 CST → Mar 9 12:00 CDT.
  const axis = getTimelineAxis(span("2026-03-07T06:00:00Z", "2026-03-09T17:00:00Z"), "America/Chicago");
  assert.deepEqual(describe(axis).ticks, [
    "2026-03-07T06:00:00.000Z 7 Sat",
    "2026-03-08T06:00:00.000Z 8 Sun",
    "2026-03-09T05:00:00.000Z 9 Mon",
  ]);
  assert.deepEqual(describe(axis).nights.slice(1, 3), [
    "2026-03-08T00:00:00.000Z → 2026-03-08T11:00:00.000Z",
    "2026-03-08T23:00:00.000Z → 2026-03-09T11:00:00.000Z",
  ]);
});

test("nights that end before the range starts are left out", () => {
  // Starts Mon Dec 7 at 10:00 CST, after the Sunday night has ended.
  const axis = getTimelineAxis(span("2026-12-07T16:00:00Z", "2026-12-09T16:00:00Z"), "America/Chicago");
  assert.equal(describe(axis).nights[0], "2026-12-08T00:00:00.000Z → 2026-12-08T12:00:00.000Z");
  assert.deepEqual(describe(axis).ticks, ["2026-12-08T06:00:00.000Z 8 Tue", "2026-12-09T06:00:00.000Z 9 Wed"]);
});

test("hour ticks land on the task zone's hours, including half-hour offsets", () => {
  // 09:15 → 15:15 IST (UTC+5:30); a UTC viewer's top of the hour is 09:30 IST.
  const axis = inViewerZone("UTC", () =>
    getTimelineAxis(span("2026-12-08T03:45:00Z", "2026-12-08T09:45:00Z"), "Asia/Kolkata"),
  );
  assert.deepEqual(describe(axis), {
    ticks: [
      "2026-12-08T04:30:00.000Z 10 AM",
      "2026-12-08T05:30:00.000Z 11 AM",
      "2026-12-08T06:30:00.000Z 12 PM",
      "2026-12-08T07:30:00.000Z 1 PM",
      "2026-12-08T08:30:00.000Z 2 PM",
      "2026-12-08T09:30:00.000Z 3 PM",
    ],
    nights: [],
  });
});

test("long hour ranges step by two hours", () => {
  const axis = getTimelineAxis(span("2026-12-08T06:00:00Z", "2026-12-09T06:00:00Z"), "America/Chicago");
  assert.equal(axis.ticks.length, 13);
  assert.equal(axis.ticks[1].at - axis.ticks[0].at, 2 * 60 * 60 * 1000);
  assert.equal(axis.ticks[0].label, "12 AM");
});
