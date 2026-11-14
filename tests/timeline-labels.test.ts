import assert from "node:assert/strict";
import test from "node:test";
import { getTimelineLabels } from "../src/lib/timeline-labels";

const timeZone = "America/Chicago";
test("overnight labels keep duration first and both endpoint dates in hover details", () => {
  const labels = getTimelineLabels({ startAt: "2026-12-09T02:00:00Z", endAt: "2026-12-09T11:00:00Z" }, timeZone)!;
  assert.deepEqual(labels.candidates, ["9h · 8:00 PM → 5:00 AM (+1d)", "9h · 8p → 5a (+1d)", "9h"]);
  assert.match(labels.details, /Start: Tue, Dec 8, 2026, 8:00 PM CST\nEnd: Wed, Dec 9, 2026, 5:00 AM CST\nDuration: 9h/);
});
test("durations reflect elapsed time across a clock change, and short tasks retain minutes", () => {
  const labels = getTimelineLabels({ startAt: "2026-11-01T05:00:00Z", endAt: "2026-11-01T08:00:00Z" }, timeZone)!;
  assert.equal(labels.duration, "3h");
  assert.match(labels.details, /12:00 AM CDT\nEnd: .*2:00 AM CST/);
  assert.equal(getTimelineLabels({ startAt: "2026-12-09T02:00:00Z", endAt: "2026-12-09T02:20:00Z" }, timeZone)?.duration, "20m");
});
test("all-day labels retain inclusive displayed dates and count the entire final day", () => {
  const labels = getTimelineLabels({ startAt: "2026-12-08T06:00:00Z", endAt: "2026-12-09T06:00:00Z", allDay: true }, timeZone)!;
  assert.equal(labels.candidates[0], "48h · Tue Dec 8 → Wed Dec 9");
  assert.match(labels.details, /End: Thu, Dec 10, 2026, 12:00 AM CST \(exclusive end of all-day range\)/);
  assert.equal(getTimelineLabels({ startAt: "2026-12-08T06:00:00Z", endAt: "2026-12-08T06:00:00Z", allDay: true }, timeZone)?.candidates[1], "24h · Tue · all day");
  assert.equal(getTimelineLabels({}, timeZone), null);
});
