import assert from "node:assert/strict";
import test from "node:test";

import { getAgendaGroupLabel } from "../src/components/taskboard-date-format";

const now = new Date(2026, 9, 8, 14, 30); // Thu 8 Oct 2026, 2:30 PM local

test("agenda groups follow the viewer's local calendar days", () => {
  assert.equal(getAgendaGroupLabel(new Date(2026, 9, 7, 23, 59).getTime(), now), "Earlier");
  assert.equal(getAgendaGroupLabel(new Date(2026, 9, 8, 0, 0).getTime(), now), "Today");
  assert.equal(getAgendaGroupLabel(new Date(2026, 9, 8, 23, 59).getTime(), now), "Today");
  assert.equal(getAgendaGroupLabel(new Date(2026, 9, 9, 9, 0).getTime(), now), "Tomorrow");
  assert.equal(getAgendaGroupLabel(new Date(2026, 9, 10, 9, 0).getTime(), now), "Next 7 days");
  assert.equal(getAgendaGroupLabel(new Date(2026, 9, 14, 23, 59).getTime(), now), "Next 7 days");
  assert.equal(getAgendaGroupLabel(new Date(2026, 9, 15, 0, 0).getTime(), now), "Later");
});

test("items without a date land in their own group", () => {
  assert.equal(getAgendaGroupLabel(Number.POSITIVE_INFINITY, now), "No date");
  assert.equal(getAgendaGroupLabel(Number.NaN, now), "No date");
});

test("month and year boundaries roll over correctly", () => {
  const lastDayOfYear = new Date(2026, 11, 31, 20, 0);
  assert.equal(getAgendaGroupLabel(new Date(2027, 0, 1, 8, 0).getTime(), lastDayOfYear), "Tomorrow");
  assert.equal(getAgendaGroupLabel(new Date(2027, 0, 6, 8, 0).getTime(), lastDayOfYear), "Next 7 days");
  assert.equal(getAgendaGroupLabel(new Date(2027, 0, 7, 0, 0).getTime(), lastDayOfYear), "Later");
});
