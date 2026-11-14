import assert from "node:assert/strict";
import test from "node:test";
import { calendarEventMatchesMode } from "../src/lib/calendar-event-visibility";

test("Outages switches exclusively between complete outage hierarchies and ordinary calendar items", () => {
  const outages = [
    { kind: "taskboard-task", workItemType: "maintenance_outage" },
    { kind: "taskboard-task", workItemType: "task", outageTaskId: "outage", windowRole: "window" },
    { kind: "taskboard-task", workItemType: "task", outageTaskId: "outage", windowRole: "work" },
  ];
  const ordinary = [
    { kind: "taskboard-task", workItemType: "task" },
    { kind: "calendar-entry" },
    { kind: "imported-source" },
    { kind: "sample-source" },
    { kind: "converted-task" },
  ];
  for (const item of [...outages, ...ordinary]) {
    const belongsToOutage = outages.includes(item as typeof outages[number]);
    assert.equal(calendarEventMatchesMode(item, true), belongsToOutage);
    assert.equal(calendarEventMatchesMode(item, false), !belongsToOutage);
  }
});
