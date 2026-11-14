import assert from "node:assert/strict";
import test from "node:test";
import { buildNotesBucketContexts, findNotesBucketContext, noteBucketContext } from "@/lib/notes-bucket-context";
import type { NoteHomeBoardOption } from "@/lib/notes-model";

const board = (boardId: string, color?: string | null): NoteHomeBoardOption => ({
  boardId, title: `Board ${boardId}`, canEdit: true, isPersonalBoard: false,
  buckets: [{ id: "bucket", title: "Operations", color }],
});

test("Notes identity uses the accessible board and bucket together", () => {
  const contexts = buildNotesBucketContexts([board("one", "#d97706"), board("two", "#0f766e")]);
  assert.equal(findNotesBucketContext(contexts, "one", "bucket")?.color, "#d97706");
  assert.equal(findNotesBucketContext(contexts, "two", "bucket")?.color, "#0f766e");
  assert.equal(findNotesBucketContext(contexts, "hidden", "bucket"), undefined);
  assert.equal(findNotesBucketContext(contexts, "one", "missing"), undefined);
  assert.equal(findNotesBucketContext(contexts, "one", null), undefined);
  assert.equal(findNotesBucketContext(contexts, "one", "none"), undefined);
});

test("identified buckets use Board's fallback for missing or invalid colors", () => {
  for (const color of [null, undefined, "", "red", "#abc", "#123456; color:red"]) {
    const contexts = buildNotesBucketContexts([board("one", color)]);
    assert.equal(findNotesBucketContext(contexts, "one", "bucket")?.color, "#64748b");
  }
  const contexts = buildNotesBucketContexts([board("one", "#AA77CC")]);
  assert.equal(findNotesBucketContext(contexts, "one", "bucket")?.color, "#AA77CC");
});

test("note color follows its current home; personal, board-level and Wiki stay neutral", () => {
  const contexts = buildNotesBucketContexts([board("one", "#d97706"), board("two", "#0f766e")]);
  const home = { kind: "board" as const, boardId: "one", boardTitle: "Board one", bucketId: "bucket", bucketTitle: "Operations" };
  assert.equal(noteBucketContext(contexts, { home })?.color, "#d97706");
  assert.equal(noteBucketContext(contexts, { home: { ...home, boardId: "two" } })?.color, "#0f766e");
  assert.equal(noteBucketContext(contexts, { home: { kind: "personal" } }), undefined);
  assert.equal(noteBucketContext(contexts, { home: { ...home, bucketId: null } }), undefined);
  assert.equal(noteBucketContext(contexts, { home: { ...home, boardId: "hidden" } }), undefined);
  assert.equal(noteBucketContext(contexts, { home, wiki: {} }), undefined);

  const refreshed = buildNotesBucketContexts([board("one", "#8b5cf6")]);
  assert.equal(noteBucketContext(refreshed, { home })?.color, "#8b5cf6");
});
