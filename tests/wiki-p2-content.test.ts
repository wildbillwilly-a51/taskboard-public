import assert from "node:assert/strict";
import test from "node:test";
import { assertNoteContentFormat, extractPageMentionIds, projectPageMentionsToLinks } from "../src/lib/notes-content-format";
import { getBlocksPlainText } from "../src/lib/notes-model";
import { defaults, mention, mentionDocument, mentionId } from "./fixtures/wiki-p2-editor/documents";

// Native ESM import: the pinned BlockNote CJS entry is incompatible with its
// ESM Tiptap dependencies under node/tsx. Browser tests exercise our real schema.
async function inventory() {
  const { defaultBlockSpecs, defaultInlineContentSpecs, defaultStyleSpecs } = await import("@blocknote/core");
  return { blockTypes: Object.keys(defaultBlockSpecs), inlineContentTypes: [...Object.keys(defaultInlineContentSpecs), "pageMention"], styleTypes: Object.keys(defaultStyleSpecs) };
}
test("v1 defaults and v2 identity conversion retain nested, table, file and language fields", async () => {
  const notesEditorInventory = await inventory();
  const original = structuredClone(defaults);
  assertNoteContentFormat(defaults, 1, notesEditorInventory); assertNoteContentFormat(defaults, 2, notesEditorInventory);
  assert.deepEqual(projectPageMentionsToLinks(defaults), original);
  assert.deepEqual(defaults, original);
  assert.ok(notesEditorInventory.blockTypes.includes("codeBlock"));
});
test("schema guard refuses future formats, unknown blocks/inline/styles and malformed mentions", async () => {
  const schema = await inventory();
  const canRenderNoteContent = (blocks: unknown, version: number) => { try { assertNoteContentFormat(blocks, version, schema); return true; } catch { return false; } };
  assert.equal(canRenderNoteContent(defaults, 3), false);
  assert.equal(canRenderNoteContent([{ type: "futureBlock" }], 2), false);
  assert.equal(canRenderNoteContent([{ type: "paragraph", content: [{ type: "unknown" }] }], 2), false);
  assert.equal(canRenderNoteContent([{ type: "paragraph", content: [{ type: "text", text: "x", styles: { futureStyle: true } }] }], 2), false);
  assert.equal(canRenderNoteContent(mentionDocument, 1), false);
  for (const bad of [{ ...mention, text: "Secret" }, { ...mention, props: { noteId: mentionId, title: "Secret" } }, { ...mention, props: { noteId: "bad" } }]) {
    assert.equal(canRenderNoteContent([{ type: "paragraph", content: [bad] }], 2), false);
  }
});
test("projection preserves ID-only atoms and produces stable title-free links", () => {
  const original = structuredClone(mentionDocument);
  const projected = projectPageMentionsToLinks(mentionDocument);
  assert.deepEqual((projected[0] as typeof mentionDocument[0]).content[1], { type: "link", href: `/wiki/_/${mentionId}`, content: [{ type: "text", text: "Wiki page", styles: {} }] });
  assert.equal(getBlocksPlainText(mentionDocument), "See  here");
  assert.deepEqual(mentionDocument, original);
});
test("nested/table mentions deduplicate and ordinary-note projection passes format 1", async () => {
  const notesEditorInventory = await inventory();
  const blocks = [{ type: "paragraph", content: [mention], children: [{ type: "table", content: { type: "tableContent", rows: [{ cells: [[mention], { type: "tableCell", content: [mention] }] }] } }] }];
  assert.deepEqual(extractPageMentionIds(blocks), [mentionId]);
  assertNoteContentFormat(blocks, 2, notesEditorInventory);
  const projected = projectPageMentionsToLinks(blocks);
  assertNoteContentFormat(projected, 1, notesEditorInventory);
  assert.equal(JSON.stringify(projected).includes("pageMention"), false);
});
