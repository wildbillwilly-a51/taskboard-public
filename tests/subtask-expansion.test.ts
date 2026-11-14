import assert from "node:assert/strict";
import test from "node:test";
import { isSubtaskExpanded, parseSubtaskExpansion, subtaskExpansionKey } from "../src/components/subtask-expansion-prefs";

test("desktop defaults open only first-tier branches; phones default closed at every depth", () => {
  for (let depth = 0; depth < 5; depth += 1) {
    assert.equal(isSubtaskExpanded({}, "branch", depth, false), depth === 0);
    assert.equal(isSubtaskExpanded({}, "branch", depth, true), false);
  }
});

test("explicit choices override defaults and follow a branch when its depth changes", () => {
  const overrides = parseSubtaskExpansion(JSON.stringify({ version: 1, overrides: { closed: false, opened: true } }));
  for (let depth = 0; depth < 4; depth += 1) {
    assert.equal(isSubtaskExpanded(overrides, "closed", depth, false), false);
    assert.equal(isSubtaskExpanded(overrides, "opened", depth, false), true);
    assert.equal(isSubtaskExpanded(overrides, "new", depth, false), depth === 0);
  }
});

test("malformed and unsupported saved preferences fall back to defaults", () => {
  for (const raw of [null, "", "{", "null", "[]", "{}", '{"version":2,"overrides":{"branch":true}}', '{"version":1,"overrides":[]}', '{"version":1,"overrides":true}']) {
    assert.deepEqual(parseSubtaskExpansion(raw), {});
  }
  assert.deepEqual(parseSubtaskExpansion('{"version":1,"overrides":{"a":true,"b":false,"c":"false","d":0,"e":null}}'), { a: true, b: false });
  assert.equal(isSubtaskExpanded({}, "toString", 1, false), false);
});

test("preferences are isolated by viewer, task, and public share namespace", () => {
  const keys = [subtaskExpansionKey("root", "alice"), subtaskExpansionKey("root", "bob"), subtaskExpansionKey("other", "alice"), subtaskExpansionKey("root"), subtaskExpansionKey("other")];
  assert.equal(new Set(keys).size, keys.length);
  assert.notEqual(subtaskExpansionKey("a:b", "c"), subtaskExpansionKey("b", "c:a"));
});
