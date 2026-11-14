import assert from "node:assert/strict";
import { test } from "node:test";
import { noteDraftStore as drafts, NoteDraftBarrierError, startNewNote } from "../src/components/notes/use-note-drafts";
import { fixtureNote, ids } from "./fixtures/wiki-ui/state";

function browser() { Object.defineProperty(globalThis, "window", { configurable: true, value: { setTimeout, clearTimeout, addEventListener: () => {} } }); }
function response(note = fixtureNote()) { return new Response(JSON.stringify({ ok: true, note }), { status: 200, headers: { "Content-Type": "application/json" } }); }

test("exclusive actions flush the shared save queue, use the acknowledged version and block edits until install", async () => {
  browser(); drafts.forget(ids.note); drafts.register(fixtureNote());
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const oldFetch = globalThis.fetch; const bodies: unknown[] = [];
  globalThis.fetch = async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); await gate; return response({ ...fixtureNote(), contentVersion: 2 }); };
  try {
    drafts.edit(ids.note, 1, { title: "Unsaved title" });
    const saving = drafts.saveNote(ids.note);
    let called = false;
    const action = drafts.runExclusive(ids.note, async version => {
      called = true; assert.equal(version, 2); assert.equal(drafts.isBlocked(ids.note), true);
      drafts.install({ ...fixtureNote(), title: "Restored", contentVersion: 3 });
    });
    drafts.edit(ids.note, 1, { title: "Must be blocked" });
    assert.equal(called, false); release(); await saving; await action;
    assert.deepEqual(bodies, [{ title: "Unsaved title", expectedVersion: 1 }]);
    assert.equal(drafts.statusOf(ids.note), "idle"); assert.equal(drafts.isBlocked(ids.note), false);
    drafts.edit(ids.note, 1, { title: "After restore" }); await drafts.saveNote(ids.note);
    assert.equal((bodies[1] as { expectedVersion: number }).expectedVersion, 3);
  } finally { globalThis.fetch = oldFetch; drafts.forget(ids.note); }
});
test("a failed in-flight save stops the barrier without retrying or losing text", async () => {
  browser(); drafts.forget(ids.note); drafts.register(fixtureNote());
  const oldFetch = globalThis.fetch; let calls = 0, called = false;
  globalThis.fetch = async () => { calls++; return new Response(JSON.stringify({ error: "Offline" }), { status: 503 }); };
  try {
    drafts.edit(ids.note, 1, { title: "Keep this" }); const saving = drafts.saveNote(ids.note);
    await assert.rejects(drafts.runExclusive(ids.note, async () => { called = true; }), NoteDraftBarrierError); await saving;
    assert.equal(calls, 1); assert.equal(called, false); assert.equal(drafts.latestOf(ids.note).title, "Keep this");
  } finally { globalThis.fetch = oldFetch; drafts.forget(ids.note); }
});
test("upload metadata never rebases a pending draft over another author's content", async () => {
  browser(); drafts.forget(ids.note); drafts.register(fixtureNote());
  const oldFetch = globalThis.fetch; let sent: { expectedVersion: number } | undefined;
  globalThis.fetch = async (_url, init) => { sent = JSON.parse(String(init?.body)); return new Response(JSON.stringify({ error: "Changed", code: "note_conflict", currentVersion: 2 }), { status: 409 }); };
  try {
    drafts.edit(ids.note, 1, { title: "My local text" });
    const merged = drafts.register({ ...fixtureNote(), contentVersion: 2 });
    assert.equal(merged?.title, "My local text");
    assert.equal(await drafts.saveNote(ids.note), false); assert.equal(sent?.expectedVersion, 1);
    let ran = false; await assert.rejects(drafts.runExclusive(ids.note, async () => { ran = true; }), NoteDraftBarrierError);
    assert.equal(ran, false); assert.equal(drafts.statusOf(ids.note), "conflict");
  } finally { globalThis.fetch = oldFetch; drafts.forget(ids.note); }
});
test("wiki creation stays untouched until typing, creates once, preserves newer typed fields", async () => {
  browser(); const oldFetch = globalThis.fetch; const calls: string[] = [];
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  globalThis.fetch = async (url) => { calls.push(String(url)); if (String(url).includes("/spaces/")) await gate; return response(); };
  try {
    const id = startNewNote({ kind: "wiki", spaceId: ids.space }); assert.equal(calls.length, 0);
    drafts.editNewNote(id, { title: "First" }); drafts.editNewNote(id, { title: "Newest" });
    const creating = drafts.createNewNote(id); assert.equal(calls.length, 1); release(); await creating; await drafts.saveNote(ids.note);
    assert.equal(calls.filter(url => url.includes("/spaces/")).length, 1); assert.match(calls[0], /\/api\/wiki\/spaces\/.*\/pages$/);
  } finally { globalThis.fetch = oldFetch; drafts.forget(ids.note); }
});
test("revocation stops queued writes and retains local recovery text", async () => {
  browser(); drafts.forget(ids.note); drafts.register(fixtureNote()); drafts.edit(ids.note, 1, { title: "Recovery" }); drafts.suspend(ids.note);
  assert.equal(await drafts.saveNote(ids.note), false); assert.equal(drafts.latestOf(ids.note).title, "Recovery");
  drafts.suspend(ids.note, false); drafts.forget(ids.note);
});
test("server rendering never retains browser drafts or permissions across requests", () => {
  drafts.forget(ids.note);
  Reflect.deleteProperty(globalThis, "window");
  assert.equal(drafts.register(fixtureNote("archived")), null);
  assert.equal(drafts.isBlocked(ids.note), false);
  browser(); drafts.register(fixtureNote("manager"));
  assert.equal(drafts.isBlocked(ids.note), false); drafts.forget(ids.note);
});
test("a fresh editable detail resumes an idle page after unarchive", () => {
  browser(); drafts.forget(ids.note); drafts.register(fixtureNote("archived"));
  assert.equal(drafts.isBlocked(ids.note), true);
  drafts.register(fixtureNote("manager")); assert.equal(drafts.isBlocked(ids.note), false);
  drafts.forget(ids.note);
});

test("an old body load cannot clear explicit revocation; regrant restarts pending autosave", async () => {
  browser(); drafts.forget(ids.note); drafts.register(fixtureNote());
  drafts.suspend(ids.note); drafts.register({ ...fixtureNote(), contentVersion: 2 });
  assert.equal(drafts.isBlocked(ids.note), true);
  drafts.suspend(ids.note, false); drafts.edit(ids.note, 2, { title: "Resume this draft" }); drafts.suspend(ids.note);
  const oldFetch = globalThis.fetch;
  const bodies: unknown[] = [];
  globalThis.fetch = async (_url, init) => { bodies.push(JSON.parse(String(init?.body))); return response({ ...fixtureNote(), contentVersion: 3 }); };
  try {
    drafts.suspend(ids.note, false);
    await new Promise(resolve => setTimeout(resolve, 950));
    assert.deepEqual(bodies, [{ title: "Resume this draft", expectedVersion: 2 }]);
    assert.equal(drafts.statusOf(ids.note), "saved");
  } finally { drafts.forget(ids.note); globalThis.fetch = oldFetch; }
});

test("format 2 body survives conflict recovery and retries with its original assertion", async () => {
  browser(); drafts.forget(ids.note); drafts.register({ ...fixtureNote(), contentFormatVersion: 2 });
  const content = { blocks: [{ type: "paragraph", content: [{ type: "pageMention", props: { noteId: ids.note } }] }], markdown: `[Wiki page](/wiki/_/${ids.note})`, text: "", formatVersion: 2 };
  const oldFetch = globalThis.fetch; const bodies: Array<{ content: unknown; expectedVersion: number }> = [];
  globalThis.fetch = async (_url, init) => {
    bodies.push(JSON.parse(String(init?.body)));
    return bodies.length === 1 ? new Response(JSON.stringify({ error: "Changed", code: "note_conflict", currentVersion: 2 }), { status: 409 }) : response({ ...fixtureNote(), contentFormatVersion: 2, contentVersion: 3 });
  };
  try {
    drafts.edit(ids.note, 1, { content });
    assert.equal(await drafts.saveNote(ids.note), false);
    assert.deepEqual(drafts.latestOf(ids.note).content, content);
    await drafts.keepMine(ids.note);
    assert.deepEqual(bodies, [{ content, expectedVersion: 1 }, { content, expectedVersion: 2 }]);
  } finally { globalThis.fetch = oldFetch; drafts.forget(ids.note); }
});
