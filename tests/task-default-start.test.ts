import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { getStartOfTodayInTimeZone } from "../src/lib/task-schedule";

test("start of today resolves local midnight in the viewer's time zone", () => {
  // 14:30 UTC on Oct 8 is 09:30 CDT, so today began at 05:00 UTC.
  assert.equal(
    getStartOfTodayInTimeZone(new Date("2026-10-08T14:30:00Z"), "America/Chicago"),
    "2026-10-08T05:00:00.000Z",
  );
  // 03:00 UTC on Oct 9 is still Oct 8 in Chicago.
  assert.equal(
    getStartOfTodayInTimeZone(new Date("2026-10-09T03:00:00Z"), "America/Chicago"),
    "2026-10-08T05:00:00.000Z",
  );
  assert.equal(
    getStartOfTodayInTimeZone(new Date("2026-10-08T14:30:00Z"), "UTC"),
    "2026-10-08T00:00:00.000Z",
  );
  // Ahead of UTC: 20:00 UTC on Oct 8 is already Oct 9 in Auckland (UTC+13).
  assert.equal(
    getStartOfTodayInTimeZone(new Date("2026-10-08T20:00:00Z"), "Pacific/Auckland"),
    "2026-10-08T11:00:00.000Z",
  );
});

test("start of today handles daylight-saving transition days", () => {
  // US DST starts 2026-03-08 at 02:00; midnight that day is still CST (UTC-6).
  assert.equal(
    getStartOfTodayInTimeZone(new Date("2026-03-08T18:00:00Z"), "America/Chicago"),
    "2026-03-08T06:00:00.000Z",
  );
  // US DST ends 2026-11-01 at 02:00; midnight that day is still CDT (UTC-5).
  assert.equal(
    getStartOfTodayInTimeZone(new Date("2026-11-01T18:00:00Z"), "America/Chicago"),
    "2026-11-01T05:00:00.000Z",
  );
});

test("start of today falls back to the runtime zone for missing or invalid zones", () => {
  const now = new Date("2026-10-08T14:30:00Z");
  const runtime = getStartOfTodayInTimeZone(now, Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.equal(getStartOfTodayInTimeZone(now, "Not/AZone"), runtime);
  assert.equal(getStartOfTodayInTimeZone(now, undefined), runtime);
});

test("undated quick-add tasks are created as all-day starts for today", () => {
  const storeSource = readFileSync("src/lib/taskboard-store.ts", "utf8");
  const routeSource = readFileSync("src/app/api/tasks/route.ts", "utf8");
  const boardSource = readFileSync("src/components/taskboard.tsx", "utf8");

  assert.match(storeSource, /getStartOfTodayInTimeZone\(mutationDate\(\), args\.timeZone\)/);
  assert.match(storeSource, /allDay: usesDefaultStart/);
  assert.doesNotMatch(storeSource, /"maintenance_outage" \? null : new Date\(\)\.toISOString\(\)/);
  assert.match(routeSource, /timeZone: typeof body\.timeZone === "string"/);
  assert.match(boardSource, /JSON\.stringify\(\{ bucketId, title, workItemType, timeZone: getViewerTimeZone\(\) \}\)/);
});
