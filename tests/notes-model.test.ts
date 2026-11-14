import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { buildBoardAccessMetadata } from "@/lib/board-access";
import {
  buildNoteSearchQuery,
  clampNoteListLimit,
  clampNoteListOffset,
  getBlocksPlainText,
  getNoteDisplayTitle,
  getNoteSnippet,
  isUuid,
  maxNoteLabelsPerNote,
  normalizeNoteContent,
  normalizeNoteLabels,
  normalizeNotebookTitle,
  normalizeNoteTitle,
  resolveNoteAccess,
} from "@/lib/notes-model";
import { buildNotesHref } from "@/lib/notes-client";
import { notesSchemaStatements } from "@/lib/notes-schema";

const ownerId = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const boardId = "33333333-3333-4333-8333-333333333333";

function boardAccess(level: "none" | "viewer" | "editor" | "owner" | "admin", id = boardId) {
  return buildBoardAccessMetadata({ boardId: id, level, source: level === "none" ? null : "board_member" });
}

test("personal notes belong to their owner alone, even for admins", () => {
  assert.deepEqual(
    resolveNoteAccess({ userId: ownerId, ownerUserId: ownerId, boardId: null, boardAccess: null }),
    { canRead: true, canEdit: true },
  );
  assert.deepEqual(
    resolveNoteAccess({ userId: otherId, ownerUserId: ownerId, boardId: null, boardAccess: boardAccess("admin") }),
    { canRead: false, canEdit: false },
  );
  assert.deepEqual(
    resolveNoteAccess({ userId: ownerId, userIsDisabled: true, ownerUserId: ownerId, boardId: null, boardAccess: null }),
    { canRead: false, canEdit: false },
  );
  assert.deepEqual(
    resolveNoteAccess({ userId: undefined, ownerUserId: ownerId, boardId: null, boardAccess: null }),
    { canRead: false, canEdit: false },
  );
});

test("board notes follow board access: viewers read, editors and above edit", () => {
  const cases = [
    ["none", false, false],
    ["viewer", true, false],
    ["editor", true, true],
    ["owner", true, true],
    ["admin", true, true],
  ] as const;

  for (const [level, canRead, canEdit] of cases) {
    assert.deepEqual(
      resolveNoteAccess({ userId: otherId, ownerUserId: ownerId, boardId, boardAccess: boardAccess(level) }),
      { canRead, canEdit },
      level,
    );
  }

  // The author of a board note gets nothing beyond the board's own access.
  assert.deepEqual(
    resolveNoteAccess({ userId: ownerId, ownerUserId: ownerId, boardId, boardAccess: null }),
    { canRead: false, canEdit: false },
  );
  // Access metadata for another board never applies.
  assert.deepEqual(
    resolveNoteAccess({
      userId: otherId,
      ownerUserId: ownerId,
      boardId,
      boardAccess: boardAccess("owner", "44444444-4444-4444-8444-444444444444"),
    }),
    { canRead: false, canEdit: false },
  );
});

test("titles, notebook names, and labels are normalized and bounded", () => {
  assert.equal(normalizeNoteTitle(undefined), "");
  assert.equal(normalizeNoteTitle("  Weekly   plan \n"), "Weekly plan");
  assert.throws(() => normalizeNoteTitle(42), /must be text/);
  assert.throws(() => normalizeNoteTitle("x".repeat(301)), /300 characters/);

  assert.equal(normalizeNotebookTitle(" Work  notes "), "Work notes");
  assert.throws(() => normalizeNotebookTitle("   "), /required/);

  assert.deepEqual(normalizeNoteLabels([" Vendor ", "vendor", "", "Q4  plan"]), ["Vendor", "Q4 plan"]);
  assert.deepEqual(normalizeNoteLabels(undefined), []);
  assert.throws(() => normalizeNoteLabels("vendor"), /must be a list/);
  assert.throws(
    () => normalizeNoteLabels(Array.from({ length: maxNoteLabelsPerNote + 1 }, (_, index) => `label ${index}`)),
    /at most/,
  );
});

test("note content must be a block list within the size limit", () => {
  const content = normalizeNoteContent({ blocks: [{ type: "paragraph" }], markdown: "Hi", text: "Hi" });
  assert.deepEqual(content.blocks, [{ type: "paragraph" }]);
  assert.equal(content.markdown, "Hi");
  assert.deepEqual(normalizeNoteContent({ blocks: [] }), { blocks: [], markdown: "", text: "" });

  assert.throws(() => normalizeNoteContent(null), /required/);
  assert.throws(() => normalizeNoteContent({ blocks: "text" }), /list of blocks/);
  assert.throws(() => normalizeNoteContent({ blocks: [], text: 5 }), /must be text/);
  assert.throws(
    () => normalizeNoteContent({ blocks: [{ text: "x".repeat(1024 * 1024) }] }),
    /too large/,
  );
});

test("search text becomes a safe prefix query", () => {
  assert.equal(buildNoteSearchQuery("Vendor  contract"), "vendor:* & contract:*");
  assert.equal(buildNoteSearchQuery("it's (Q4) & | ! :*"), "it:* & s:* & q4:*");
  assert.equal(buildNoteSearchQuery("Ärger über"), "ärger:* & über:*");
  assert.equal(buildNoteSearchQuery("  "), null);
  assert.equal(buildNoteSearchQuery(null), null);
});

test("untitled notes show their first line, and snippets skip it", () => {
  assert.equal(getNoteDisplayTitle("Plan", "Body"), "Plan");
  assert.equal(getNoteDisplayTitle("", "\n  Call the vendor  \nThen email"), "Call the vendor");
  assert.equal(getNoteDisplayTitle("", ""), "Untitled note");
  assert.equal(getNoteSnippet("", "Call the vendor\nThen   email them"), "Then email them");
  assert.equal(getNoteSnippet("Plan", "Call the vendor\nThen email"), "Call the vendor Then email");
});

test("editor blocks become plain text for search and titles", () => {
  const blocks = [
    { type: "heading", content: [{ type: "text", text: "Kickoff", styles: {} }], children: [] },
    {
      type: "paragraph",
      content: [
        { type: "text", text: "Call ", styles: {} },
        { type: "link", href: "https://example.invalid", content: [{ type: "text", text: "the vendor", styles: {} }] },
      ],
      children: [{ type: "checkListItem", content: [{ type: "text", text: "Send quote", styles: {} }], children: [] }],
    },
    {
      type: "table",
      content: {
        type: "tableContent",
        rows: [{ cells: [[{ type: "text", text: "Q4", styles: {} }], [{ type: "text", text: "Budget", styles: {} }]] }],
      },
      children: [],
    },
    { type: "image", props: { url: "/x" }, children: [] },
  ];

  assert.equal(getBlocksPlainText(blocks), "Kickoff\nCall the vendor\nSend quote\nQ4 Budget");
  assert.equal(getBlocksPlainText("not blocks"), "");
  assert.equal(getBlocksPlainText([null, 3, { content: "plain" }]), "plain");
});

test("Notes links carry the note, board, bucket, and new-note request", () => {
  assert.equal(buildNotesHref({}), "/folio");
  assert.equal(buildNotesHref({ noteId: ownerId }), `/folio?note=${ownerId}`);
  assert.equal(
    buildNotesHref({ boardId, bucketId: otherId, createNew: true }),
    `/folio?boardId=${boardId}&bucketId=${otherId}&new=1`,
  );
});

test("list paging and ids are validated", () => {
  assert.equal(clampNoteListLimit(null), 100);
  assert.equal(clampNoteListLimit("20"), 20);
  assert.equal(clampNoteListLimit("9999"), 500);
  assert.equal(clampNoteListOffset("-4"), 0);
  assert.equal(clampNoteListOffset("40"), 40);
  assert.equal(isUuid(ownerId), true);
  assert.equal(isUuid("not-a-uuid"), false);
  assert.equal(isUuid(undefined), false);
});

test("the base schema carries every notes table and index", () => {
  const schemaSql = readFileSync(path.join(process.cwd(), "db", "baseline", "schema.sql"), "utf8");

  for (const statement of notesSchemaStatements) {
    const name = statement.match(/(?:TABLE|INDEX) IF NOT EXISTS (\w+)/)?.[1];
    assert.ok(name, statement);
    assert.match(schemaSql, new RegExp(`IF NOT EXISTS ${name}\\b`), `schema.sql is missing ${name}`);
  }
});
