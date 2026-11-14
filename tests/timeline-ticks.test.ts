import assert from "node:assert/strict";
import test from "node:test";
import { selectTimelineTicks } from "../src/lib/timeline-ticks";

test("a translated end label displaces the overlapping penultimate date", () => {
  assert.deepEqual(selectTimelineTicks([
    { left: 28, right: 68 }, { left: 93, right: 129 },
    { left: 158, right: 199 }, { left: 224, right: 265 },
    { left: 247, right: 279 },
  ], 8), [0, 1, 2, 4]);
});

test("wide axes retain every date while larger text thins without collisions", () => {
  const wide = [0, 100, 200, 300].map(left => ({ left, right: left + 45 }));
  assert.deepEqual(selectTimelineTicks(wide, 8), [0, 1, 2, 3]);
  const large = [0, 65, 130, 195].map(left => ({ left, right: left + 70 }));
  assert.deepEqual(selectTimelineTicks(large, 8), [0, 3]);
});

test("an axis too narrow for both endpoints still exposes one readable date", () => {
  assert.deepEqual(selectTimelineTicks([{ left: 0, right: 60 }, { left: 30, right: 85 }], 8), [0]);
  assert.deepEqual(selectTimelineTicks([], 8), []);
});
