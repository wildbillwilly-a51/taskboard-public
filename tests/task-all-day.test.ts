import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getRememberedTaskScheduleTimes,
  getTaskScheduleForAllDayToggle,
} from "../src/lib/task-schedule";

test("task all-day intent is persisted through the existing task update route", () => {
  const migration = readFileSync("db/baseline/schema.sql", "utf8");
  const routeSource = readFileSync("src/app/api/tasks/[taskId]/route.ts", "utf8");
  const storeSource = readFileSync("src/lib/taskboard-store.ts", "utf8");

  assert.match(migration, /all_day BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(routeSource, /allDay\?: boolean/);
  assert.match(routeSource, /typeof body\.allDay === "boolean"/);
  assert.match(storeSource, /updates\.push\(`all_day = \$\$\{values\.length\}`\)/);
  assert.match(storeSource, /tasks\.all_day/);
  assert.match(storeSource, /allDay: row\.all_day/);
});

test("sidebar and expanded task workspace share the all-day scheduling control", () => {
  const taskboardSource = readFileSync("src/components/taskboard.tsx", "utf8");

  assert.match(taskboardSource, /function TaskScheduleFields/);
  assert.match(taskboardSource, /data-testid=\{`\$\{testIdPrefix\}-all-day`\}/);
  assert.match(taskboardSource, /testIdPrefix="task-inspector"/);
  assert.match(taskboardSource, /testIdPrefix="task-workspace"/);
  assert.match(taskboardSource, /!allDay \? \(/);
  assert.match(taskboardSource, />\s*All day\s*</);
  assert.match(taskboardSource, /const rememberedTimedValuesRef = useRef/);
  assert.match(taskboardSource, /rememberedTimedValuesRef\.current\.startTime/);
  assert.match(taskboardSource, /rememberedTimedValuesRef\.current\.endTime/);
  assert.match(taskboardSource, /getTaskScheduleForAllDayToggle/);
  assert.doesNotMatch(taskboardSource, /task-overview-end-controls/);
});

test("all-day toggles restore remembered start and end times for the editing session", () => {
  const timedSchedule = {
    startAt: "2026-07-14T08:15",
    endAt: "2026-07-14T17:45",
  };
  const rememberedTimes = getRememberedTaskScheduleTimes(
    timedSchedule.startAt,
    timedSchedule.endAt,
  );
  const allDaySchedule = getTaskScheduleForAllDayToggle({
    ...timedSchedule,
    nextAllDay: true,
    rememberedTimes,
  });

  assert.deepEqual(allDaySchedule, {
    startAt: "2026-07-14T00:00",
    endAt: "2026-07-14T00:00",
  });
  assert.deepEqual(
    getTaskScheduleForAllDayToggle({
      startAt: "2026-07-15T00:00",
      endAt: "2026-07-16T00:00",
      nextAllDay: false,
      rememberedTimes,
    }),
    {
      startAt: "2026-07-15T08:15",
      endAt: "2026-07-16T17:45",
    },
  );
});

test("all-day toggles preserve missing ends and default persisted all-day tasks to midnight", () => {
  const rememberedTimes = getRememberedTaskScheduleTimes("2026-07-14T08:15", "");

  assert.deepEqual(
    getTaskScheduleForAllDayToggle({
      startAt: "2026-07-14T00:00",
      endAt: "",
      nextAllDay: false,
      rememberedTimes,
    }),
    {
      startAt: "2026-07-14T08:15",
      endAt: "",
    },
  );
  assert.deepEqual(
    getTaskScheduleForAllDayToggle({
      startAt: "2026-07-14T00:00",
      endAt: "2026-07-15T00:00",
      nextAllDay: false,
      rememberedTimes: { startTime: "", endTime: "" },
    }),
    {
      startAt: "2026-07-14T00:00",
      endAt: "2026-07-15T00:00",
    },
  );
});

test("recurring task materialization retains all-day intent", () => {
  const storeSource = readFileSync("src/lib/taskboard-store.ts", "utf8");

  assert.match(storeSource, /child\.all_day/);
  assert.match(storeSource, /row\.all_day/);
  assert.match(storeSource, /INSERT INTO tasks \([\s\S]*?all_day,[\s\S]*?recurrence_rule/);
});
