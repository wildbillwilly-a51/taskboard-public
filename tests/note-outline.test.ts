import assert from "node:assert/strict";
import test from "node:test";
import { copyNoteBlockIds, noteOutline, sectionFromHash, sectionHref, withNoteBlockIds } from "../src/lib/note-outline";
const h = (id: string, level: number, content: unknown, children: unknown[] = []) => ({ id, type: "heading", props: { level }, content, children });

test("outline follows document order, skipped levels, child blocks and inline labels", () => {
  const blocks = [h("a", 2, "Overview"), h("b", 5, [{ type: "text", text: "Use " }, { type: "link", content: [{ type: "text", text: "links" }] }]),
    { id: "list", type: "bulletListItem", content: "Not a section", children: [h("c", 6, "Deep")] }, h("d", 1, "Overview")];
  assert.deepEqual(noteOutline(blocks).map(x => [x.id, x.text, x.depth, x.ancestors]), [
    ["a", "Overview", 0, []], ["b", "Use links", 1, []], ["c", "Deep", 2, ["list"]], ["d", "Overview", 0, []],
  ]);
});

test("empty headings remain navigable while editing and are omitted while reading", () => {
  const blocks = [h("blank", 1, "  "), h("child", 3, "Child"), h("literal", 1, "Untitled section"), h("next", 2, "Next")];
  assert.deepEqual(noteOutline(blocks, true).map(x => [x.text, x.depth]), [["Untitled section", 0], ["Child", 1], ["Untitled section", 0], ["Next", 1]]);
  assert.equal(noteOutline(blocks).length, 3);
  assert.equal(noteOutline(blocks)[0].depth, 0);
  assert.equal(noteOutline(blocks)[2].depth, 1);
});

test("normalization preserves unique IDs, reserves later IDs, fixes duplicates recursively without mutation", () => {
  const blocks = [h("a", 1, "First", [h("a", 2, "Duplicate")]), { type: "paragraph", content: [] }, h("later", 1, "Last")];
  const original = JSON.stringify(blocks);
  const ids = ["later", "new-1", "new-2"];
  const fixed = withNoteBlockIds(blocks, () => ids.shift()!);
  assert.equal(JSON.stringify(blocks), original);
  assert.deepEqual(noteOutline(fixed).map(x => x.id), ["a", "new-1", "later"]);
  assert.deepEqual(withNoteBlockIds(fixed, () => { throw new Error("IDs must survive saves/restores"); }), fixed);
});

test("links preserve identity across rename/reorder and reject malformed fragments", () => {
  const before = h("persistent / id", 2, "Old title");
  const after = { ...before, content: "New title", props: { level: 1 } };
  const href = sectionHref("note", noteOutline([before])[0].id);
  assert.equal(href, sectionHref("note", noteOutline([h("other", 1, "New title"), after])[1].id));
  assert.equal(sectionFromHash(href.slice(href.indexOf("#"))), before.id);
  for (const hash of ["#wrong", "#section=", "#section=%zz", "#section=%00", `#section=${"a".repeat(201)}`]) assert.equal(sectionFromHash(hash), null);
});

test("read-mode normalization copies only IDs and refuses a different document", () => {
  const stored = [{ type: "heading", props: { level: 2 }, content: "Legacy", children: [{ type: "image", props: { url: "original" } }] }];
  const runtime = [{ id: "assigned", type: "heading", props: { level: 2, textColor: "default" }, content: [{ type: "text", text: "Legacy" }], children: [{ id: "image", type: "image", props: { url: "original", name: "" }, children: [] }] }];
  assert.deepEqual(copyNoteBlockIds(stored, runtime), [{ ...stored[0], id: "assigned", children: [{ ...stored[0].children[0], id: "image" }] }]);
  assert.throws(() => copyNoteBlockIds(stored, []));
  assert.throws(() => copyNoteBlockIds(stored, [{ ...runtime[0], content: "Changed elsewhere" }]));
  assert.equal("id" in stored[0], false);
});
