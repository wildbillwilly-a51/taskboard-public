import assert from "node:assert/strict";
import test from "node:test";
import {
  QUARTER_HOUR_TIMES,
  formatTimeText,
  nearestQuarterHourIndex,
  parseTimeText,
} from "../src/lib/time-text";

test("parseTimeText reads typed times", () => {
  assert.equal(parseTimeText("8p"), "20:00");
  assert.equal(parseTimeText("8:30 pm"), "20:30");
  assert.equal(parseTimeText("830p"), "20:30");
  assert.equal(parseTimeText("8 a.m."), "08:00");
  assert.equal(parseTimeText("12am"), "00:00");
  assert.equal(parseTimeText("12pm"), "12:00");
  assert.equal(parseTimeText("20:30"), "20:30");
  assert.equal(parseTimeText("2030"), "20:30");
  assert.equal(parseTimeText("8"), "08:00");
  assert.equal(parseTimeText("noon"), "12:00");
  assert.equal(parseTimeText("midnight"), "00:00");
});

test("parseTimeText rejects what is not a time", () => {
  for (const text of ["", "abc", "25:00", "13pm", "8:75", "0am"]) {
    assert.equal(parseTimeText(text), null, text);
  }
});

test("formatTimeText shows 12-hour times", () => {
  assert.equal(formatTimeText("20:30"), "8:30 PM");
  assert.equal(formatTimeText("00:15"), "12:15 AM");
  assert.equal(formatTimeText("12:00"), "12:00 PM");
  assert.equal(formatTimeText("bad"), "");
});

test("the time list has every quarter hour and opens at the value", () => {
  assert.equal(QUARTER_HOUR_TIMES.length, 96);
  assert.equal(QUARTER_HOUR_TIMES[81], "20:15");
  assert.equal(nearestQuarterHourIndex("20:20"), 81);
  assert.equal(nearestQuarterHourIndex(""), -1);
});
