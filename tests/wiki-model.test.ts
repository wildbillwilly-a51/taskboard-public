import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { NoteConflictError, NotesNotFoundError, WikiRuleError } from "@/lib/notes-errors";
import { buildWikiPageHref, canCoalesceWikiVersion, extractWikiLinkTargets, normalizeWikiDescription,
  normalizeWikiSlug, normalizeWikiSpaceTitle, parseWikiPageId, resolveWikiCapabilities } from "@/lib/wiki-model";

const id = "11111111-1111-4111-8111-111111111111";
test("slug normalization, UUID prefix parsing and canonical paths", () => {
  assert.equal(normalizeWikiSlug(" Café / RUN Book "), "cafe-run-book");
  assert.equal(normalizeWikiSlug("--"), "space");
  assert.equal(normalizeWikiSlug("x".repeat(100)).length, 80);
  assert.equal(buildWikiPageHref("handbook", id, ""), `/wiki/handbook/${id}-page`);
  assert.equal(parseWikiPageId(`${id}-many-hyphens`), id);
  assert.equal(parseWikiPageId(`${id}bad`), null);
  assert.equal(parseWikiPageId("bad"), null);
  assert.equal(normalizeWikiSpaceTitle(" Hello "), "Hello");
  assert.throws(() => normalizeWikiSpaceTitle(" "), WikiRuleError);
  assert.throws(() => normalizeWikiDescription("x".repeat(2001)), WikiRuleError);
});
test("coalescing has strict gap/cap boundaries and rejects backwards clocks and file operations", () => {
  const latest = { kind: "edit" as const, authorUserId: id, startedAt: "2026-01-01T00:00:00Z", savedAt: "2026-01-01T00:50:00Z" };
  const input = { kind: "edit" as const, authorUserId: id, savedAt: "2026-01-01T00:59:59Z" };
  assert.equal(canCoalesceWikiVersion(latest, input), true);
  assert.equal(canCoalesceWikiVersion(latest, { ...input, savedAt: "2026-01-01T01:00:00Z" }), false);
  assert.equal(canCoalesceWikiVersion({ ...latest, startedAt: latest.savedAt }, { ...input, savedAt: "2026-01-01T01:00:00Z" }), false);
  assert.equal(canCoalesceWikiVersion(latest, { ...input, savedAt: "2026-01-01T00:49:00Z" }), false);
  for (const kind of ["start", "restore", "import"] as const) assert.equal(canCoalesceWikiVersion({ ...latest, kind }, input), false);
  assert.equal(canCoalesceWikiVersion(latest, { ...input, authorUserId: "other" }), false);
  assert.equal(canCoalesceWikiVersion(latest, { ...input, fileCheckpoint: true }), false);
});
test("nested/table links are local, valid and deduplicated", () => {
  const doc = [{ content: { rows: [{ cells: [[{ href: `/wiki/a/${id}-title?view=history#x` }, { url: `/notes?note=${id}` }]] }] } },
    { children: [{ props: { url: `https://taskboard.example/wiki/a/${id}-title` } }] },
    { href: `https://foreign.example/notes?note=${id}` }, { href: `//foreign.example/notes?note=${id}` },
    { href: "javascript:alert(1)" }, { text: `/notes?note=${id}` }];
  assert.deepEqual(extractWikiLinkTargets(doc, "https://taskboard.example"), [id]);
  assert.deepEqual(extractWikiLinkTargets([{ url: `https://foreign.example/notes?note=${id}` }], "https://taskboard.example"), []);
});
test("archive and manager lifecycle capabilities use board rights", () => {
  assert.deepEqual(resolveWikiCapabilities({ canRead: true, canEdit: true, canManage: false }, false, true),
    { canRead: true, canEdit: true, canManage: false, canDeletePermanently: false });
  assert.equal(resolveWikiCapabilities({ canRead: true, canEdit: true, canManage: true }, true, true).canEdit, false);
  assert.equal(resolveWikiCapabilities({ canRead: true, canEdit: true, canManage: true }, false, true).canDeletePermanently, true);
});
test("shared errors preserve payloads and legacy facade reexports their identities", () => {
  assert.equal(new NoteConflictError(4).currentVersion, 4);
  assert.equal(new NotesNotFoundError().status, 404);
  assert.equal(new WikiRuleError("wiki_read_only", "Read only.", 403).code, "wiki_read_only");
  const facade = readFileSync("src/lib/notes-store.ts", "utf8");
  assert.match(facade, /export \{ NotesNotFoundError, NoteConflictError, WikiRuleError \} from "@\/lib\/notes-errors"/);
  assert.doesNotMatch(facade, /export class NoteConflictError/);
});
