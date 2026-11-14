import assert from "node:assert/strict";
import test from "node:test";
import { noteSections, parsePersonalFolds, personalFoldKey, movesDraftFolds } from "../src/lib/note-sections";
const h = (id: string, level: number, children: unknown[] = []) => ({ id, type: "heading", props: { level }, content: id, children });
const p = (id: string, children: unknown[] = []) => ({ id, type: "paragraph", content: id, children });

test("sections stop at equal/higher sibling headings and retain skipped levels", () => {
  const sections = noteSections([h("a", 1), p("body"), h("b", 4), p("detail"), h("c", 2), p("end"), h("next", 1)]);
  assert.deepEqual(sections.map(s => [s.id, s.members]), [["a", ["body", "b", "detail", "c", "end"]], ["b", ["detail"]], ["c", ["end"]], ["next", []]]);
});
test("nested heading boundaries never close the outer sibling scope", () => {
  const input = [h("outer", 2, [h("nested", 1), p("child")]), p("list", [h("inside", 1), p("inside-body")]), p("after"), h("stop", 2)];
  const before = JSON.stringify(input);
  const sections = noteSections(input);
  assert.deepEqual(sections[0].members, ["nested", "child", "list", "inside", "inside-body", "after"]);
  assert.deepEqual(sections.find(s => s.id === "nested")?.members, ["child"]);
  assert.deepEqual(sections.find(s => s.id === "inside")?.members, ["inside-body"]);
  assert.equal(JSON.stringify(input), before);
});
test("built-in toggles keep their own control and still delimit sibling sections", () => {
  const toggle = { ...h("toggle", 1, [p("toggle-child")]), props: {level: 1, isToggleable: true} };
  const sections = noteSections([h("first", 1), p("one"), toggle, p("unowned"), h("last", 2), p("two")]);
  assert.deepEqual(sections.map(s => [s.id, s.members]), [["first", ["one"]], ["last", ["two"]]]);
});
test("semantic ancestors reveal a nested destination independently of its label", () => {
  const blocks = [h("a", 1), h("b", 3), p("target"), h("c", 1)];
  const reveal = (id: string) => noteSections(blocks).filter(s => s.id === id || s.members.includes(id)).map(s => s.id);
  assert.deepEqual(reveal("target"), ["a", "b"]);
  assert.deepEqual(reveal("b"), ["a", "b"]);
  assert.deepEqual(reveal("c"), ["c"]);
});
test("personal preferences are namespaced, bounded and tolerate malformed storage", () => {
  assert.notEqual(personalFoldKey("alice", "note"), personalFoldKey("bob", "note"));
  assert.notEqual(personalFoldKey("alice", "note"), personalFoldKey("alice", "other"));
  assert.deepEqual([...parsePersonalFolds('[null,42,"", "good", "good"]')], ["good"]);
  assert.equal(parsePersonalFolds("broken").size, 0);
  assert.equal(parsePersonalFolds(JSON.stringify(Array.from({length: 700}, (_, n) => String(n)))).size, 500);
});

test("only a same-viewer draft-to-saved transition migrates personal folds", () => {
  assert.equal(movesDraftFolds("alice", "new-note-draft:1", "alice", "saved"), true);
  assert.equal(movesDraftFolds("alice", "new-note-draft:1", "bob", "saved"), false);
  assert.equal(movesDraftFolds("alice", "saved", "alice", "other"), false);
  assert.equal(movesDraftFolds("alice", "new-note-draft:1", "alice", "new-note-draft:2"), false);
});
