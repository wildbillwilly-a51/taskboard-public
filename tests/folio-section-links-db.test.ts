import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getPool } from "../src/lib/db";
import { ensureDatabaseReady } from "../src/lib/taskboard-store";
import { createFolioNote, folioHistory, getFolioHistoryVersion, restoreFolioVersion } from "../src/lib/folio-store";
import { getNote, updateNote } from "../src/lib/notes-store";
import { noteOutline, sectionHref } from "../src/lib/note-outline";
import { isLocalVisualDatabase } from "./helpers/visual-database";

test("section identities survive actual Folio saves, reorder, rename and history restoration", { skip: process.env.FOLIO_DB_TEST !== "1", timeout: 60000 }, async () => {
  assert.ok(isLocalVisualDatabase(new URL(process.env.DATABASE_URL!)));
  await ensureDatabaseReady();
  const pool = getPool()!;
  const actor = { id: randomUUID(), email: `sections-${randomUUID()}@example.invalid`, displayName: "Section fixture", authMode: "authelia" as const };
  try {
    await pool.query("INSERT INTO users(id,email,display_name) VALUES($1,$2,$3)", [actor.id, actor.email, actor.displayName]);
    const raw = [{ type: "heading", props: { level: 1 }, content: "First" }, { type: "heading", props: { level: 2 }, content: "Duplicate label" }, { type: "heading", props: { level: 2 }, content: "Duplicate label" }];
    let doc = await createFolioNote(actor, { title: "Sections", content: { formatVersion: 2, blocks: raw, markdown: "# Exact original Markdown\n", text: "" } });
    const ids = noteOutline(doc.content).map(h => h.id);
    assert.equal(new Set(ids).size, 3);
    assert.ok(ids.every(Boolean));
    assert.equal(doc.contentMarkdown, "# Exact original Markdown\n");
    assert.deepEqual(noteOutline((await getNote(actor, doc.id)).content).map(h => h.id), ids);
    const original = (await folioHistory(actor, doc.id)).versions[0];
    const snapshot = await getFolioHistoryVersion(actor, doc.id, original.id);
    const blocks = structuredClone(doc.content) as Record<string, unknown>[];
    blocks[0].content = "Renamed first";
    blocks.reverse();
    doc = await updateNote(actor, doc.id, { expectedVersion: doc.contentVersion, content: { formatVersion: 2, blocks, markdown: "Updated", text: "" } });
    assert.deepEqual(noteOutline(doc.content).map(h => h.id), [...ids].reverse());
    assert.equal(sectionHref(doc.id, noteOutline(doc.content).at(-1)!.id), sectionHref(doc.id, ids[0]));
    doc = await restoreFolioVersion(actor, doc.id, snapshot.id, doc.contentVersion, snapshot.token);
    assert.deepEqual(noteOutline(doc.content).map(h => h.id), ids);
    assert.equal(noteOutline(doc.content)[0].text, "First");
    assert.equal(doc.contentMarkdown, "# Exact original Markdown\n");
    // A replacement supplied without identity becomes a new section. Its label
    // never reattaches the old destination or collides with another heading.
    doc = await updateNote(actor, doc.id, { expectedVersion: doc.contentVersion, content: { formatVersion: 2, blocks: [raw[0]], markdown: "# First", text: "" } });
    assert.notEqual(noteOutline(doc.content)[0].id, ids[0]);
    assert.deepEqual(raw[0], { type: "heading", props: { level: 1 }, content: "First" });
  } finally {
    await pool.query("DELETE FROM notes WHERE owner_user_id=$1", [actor.id]);
    await pool.query("DELETE FROM users WHERE id=$1", [actor.id]);
    await pool.end();
  }
});
