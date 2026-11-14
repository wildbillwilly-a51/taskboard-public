import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { createServer } from "node:http";
import { once } from "node:events";
import { NodeNextRequest } from "next/dist/server/base-http/node";
import { NextRequestAdapter } from "next/dist/server/web/spec-extension/adapters/next-request";
import { BoardAccessError } from "@/lib/board-access";
import { NoteConflictError, NotesNotFoundError, WikiRuleError, type WikiRuleCode } from "@/lib/notes-errors";
import { createWikiApiHandlers, type WikiRouteContext } from "@/lib/wiki-api-handlers";
import { maxNotesRequestBodyBytes, wikiRouteErrorResponse } from "@/lib/wiki-route";
import { assertNotesRequestFields, notesRouteErrorResponse, permanentNoteDeleteOption } from "@/lib/notes-route";
import { fakeIdentity, fakePage, ids, WikiApiStub, type FakeRole } from "./helpers/wiki-api-stub";

export function request(method = "GET", body?: unknown, query = "") {
  return new NextRequest(`http://127.0.0.1:3232/api/wiki${query}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body), headers: { "content-type": "application/json" } }) });
}
function setup(role: FakeRole = "manager") {
  const store = new WikiApiStub();
  const handlers = createWikiApiHandlers({ store, requireUser: async () => fakeIdentity(role), isDatabaseConfigured: () => true });
  return { store, handlers };
}
const context = (params: Awaited<WikiRouteContext["params"]> = {}) => ({ params: Promise.resolve(params) });
const pageContext = () => context({ noteId: ids.note });
const versionContext = () => context({ noteId: ids.note, versionId: ids.version });
async function check(response: Response, status = 200, code?: string) {
  assert.equal(response.status, status, await response.clone().text());
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  const body = await response.json();
  if (code) assert.equal(body.code, code); else if (status < 400) assert.equal(body.ok, true);
  return body;
}

test("static wiki routes accept Next's context with absent params", async () => {
  const { handlers } = setup();
  // Static routes receive this runtime shape from the Next Node adapter.
  const staticContext = { params: undefined } as unknown as WikiRouteContext;
  await check(await handlers.listSpaces(request(), staticContext));
  await check(await handlers.listPages(request(), staticContext));
  await check(await handlers.createSpace(request("POST", { boardId: ids.task, title: "Static context" }), staticContext), 201);
});

test("all 15 HTTP operations return their exact envelopes, status and pagination", async () => {
  const { handlers: h, store } = setup();
  assert.ok((await check(await h.listSpaces(request()))).spaces.length);
  const created = await check(await h.createSpace(request("POST", { boardId: ids.task, title: " New space ", description: "Desc", slug: "New SPACE" })), 201);
  assert.equal(created.space.slug, "new-space"); assert.equal(created.space.title, "New space");
  assert.equal((await check(await h.getSpace(request(), context({ spaceId: ids.space })))).space.id, ids.space);
  assert.equal((await check(await h.updateSpace(request("PATCH", { title: "Renamed", homeNoteId: null }), context({ spaceId: ids.space })))).space.title, "Renamed");
  assert.equal((await check(await h.listPages(request("GET", undefined, "?q=Welcome&status=active&limit=1&offset=0")))).limit, 1);
  assert.equal((await check(await h.listSpacePages(request(), context({ spaceId: ids.space })))).pages[0].id, ids.note);
  const page = await check(await h.createPage(request("POST", { title: "Draft", content: { blocks: [], markdown: "", text: "" } }), context({ spaceId: ids.space })), 201);
  assert.equal(page.note.contentVersion, 1);
  assert.equal((await check(await h.getPage(request(), pageContext()))).note.wiki.spaceId, ids.space);
  assert.equal((await check(await h.listVersions(request("GET", undefined, "?limit=1&offset=0"), pageContext()))).versions[0].kind, "start");
  assert.equal((await check(await h.getVersion(request(), versionContext()))).version.contentMarkdown, "Hello");
  const copy = await check(await h.copyPage(request("POST", { expectedVersion: 1 }), pageContext()), 201);
  assert.equal(copy.note.wiki, undefined); assert.equal(copy.note.home.kind, "personal"); assert.notEqual(copy.note.id, ids.note);
  await check(await h.movePage(request("POST", { spaceId: ids.otherSpace, sourceSpaceId: ids.space, expectedVersion: 1 }), pageContext()));
  assert.equal(store.notes.get(ids.note)!.contentVersion, 1);
  const ordinary = fakePage(ids.task); delete (ordinary as { wiki?: unknown }).wiki;
  store.notes.set(ordinary.id, ordinary);
  assert.equal((await check(await h.addPage(request("POST", { spaceId: ids.space, expectedVersion: 1 }), context({ noteId: ids.task })))).note.contentVersion, 2);
  assert.equal((await check(await h.restoreVersion(request("POST", { expectedVersion: 1 }), versionContext()))).note.contentVersion, 2);
  assert.deepEqual(await check(await h.removeSpace(request("DELETE"), context({ spaceId: created.space.id }))), { ok: true });
});

test("bad body shapes, unknown/immutable fields, invalid ids and versions never dispatch", async t => {
  const invalidBodies: unknown[] = [null, [], "text", {}, { expectedVersion: "1" }, { expectedVersion: null }, { expectedVersion: 0 }, { expectedVersion: -1 }, { expectedVersion: 1.1 }, { expectedVersion: Number.MAX_SAFE_INTEGER + 1 }, { expectedVersion: 1, kind: "restore" }];
  for (const body of invalidBodies) await t.test(JSON.stringify(body), async () => {
    const { handlers, store } = setup();
    await check(await handlers.copyPage(request("POST", body), pageContext()), 400, "invalid_wiki_request"); assert.equal(store.calls.length, 0);
  });
  const { handlers: h, store } = setup();
  await check(await h.getPage(request(), context({ noteId: "not-a-uuid" })), 400, "invalid_wiki_request");
  await check(await h.getVersion(request(), context({ noteId: ids.note, versionId: "bad" })), 400, "invalid_wiki_request");
  await check(await h.addPage(request("POST", { spaceId: "bad", expectedVersion: 1 }), pageContext()), 400, "invalid_wiki_request");
  await check(await h.movePage(request("POST", { spaceId: ids.space, expectedVersion: 1 }), pageContext()), 400, "invalid_wiki_request");
  await check(await h.createSpace(request("POST", { boardId: ids.board, title: "" })), 400, "invalid_wiki_request");
  await check(await h.createSpace(request("POST", { boardId: ids.board, title: "a".repeat(121) })), 400, "invalid_wiki_request");
  await check(await h.createSpace(request("POST", { boardId: ids.board, title: "Valid", description: "a".repeat(2001) })), 400, "invalid_wiki_request");
  await check(await h.createSpace(request("POST", { boardId: ids.board, title: "Valid", slug: "!!!" })), 400, "invalid_wiki_request");
  for (const body of [{ slug: "change" }, { boardId: ids.board }, { archived: "true" }, { homeNoteId: "bad" }, {}]) await check(await h.updateSpace(request("PATCH", body), context({ spaceId: ids.space })), 400, "invalid_wiki_request");
  for (const body of [{ title: null }, { title: "a".repeat(301) }, { content: [] }, { content: { blocks: [] } }, { content: { blocks: [], markdown: null, text: "" } }, { content: { blocks: [], markdown: "", text: "", kind: "import" } }, { contentFormatVersion: 2 }, { wikiSpaceId: ids.space }]) await check(await h.createPage(request("POST", body), context({ spaceId: ids.space })), 400, "invalid_wiki_request");
  await check(await h.removeSpace(request("DELETE", {}), context({ spaceId: ids.space })), 400, "invalid_wiki_request");
  const broken = new NextRequest("http://127.0.0.1:3232", { method: "POST", body: "{broken" });
  await check(await h.copyPage(broken, pageContext()), 400, "invalid_wiki_request");
  assert.equal(store.calls.length, 0);
});

test("body limits apply both with Content-Length and chunked input", async () => {
  const { handlers, store } = setup();
  const oversized = new NextRequest("http://127.0.0.1:3232", { method: "POST", headers: { "content-length": String(maxNotesRequestBodyBytes + 1) }, body: "{}" });
  await check(await handlers.copyPage(oversized, pageContext()), 400, "invalid_wiki_request");
  const chunked = new NextRequest("http://127.0.0.1:3232", { method: "POST", body: new Uint8Array(maxNotesRequestBodyBytes + 1) });
  await check(await handlers.copyPage(chunked, pageContext()), 400, "invalid_wiki_request");
  const semantic = request("POST", { content: { blocks: [], markdown: "a".repeat(1048577), text: "" } });
  await check(await handlers.createPage(semantic, context({ spaceId: ids.space })), 400, "invalid_wiki_request");
  assert.equal(store.calls.length, 0);
});

test("space DELETE accepts an empty Node request stream and rejects actual body bytes", async () => {
  const { handlers, store } = setup();
  const server = createServer(async (incoming, outgoing) => {
    try {
      const adapted = NextRequestAdapter.fromNodeNextRequest(new NodeNextRequest(incoming), new AbortController().signal);
      assert.notEqual(adapted.body, null, "Exercise the actual installed Node adapter, not a null-body synthetic request.");
      const response = await handlers.removeSpace(adapted, context({ spaceId: ids.otherSpace }));
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      outgoing.end(await response.text());
    } catch (error) { outgoing.statusCode = 500; outgoing.end(String(error)); }
  });
  server.listen(0, "127.0.0.1"); await once(server, "listening");
  try {
    const address = server.address(); assert.ok(address && typeof address !== "string");
    const url = `http://127.0.0.1:${address.port}/api/wiki/spaces/${ids.otherSpace}`;
    await check(await fetch(url, { method: "DELETE" }));
    assert.equal(store.calls.length, 1);
    store.calls = [];
    await check(await fetch(url, { method: "DELETE", body: "{}" }), 400, "invalid_wiki_request");
    assert.equal(store.calls.length, 0);
    store.spaces.set(ids.otherSpace, { ...store.spaces.get(ids.space)!, id: ids.otherSpace });
    const empty = new NextRequest(url, { method: "DELETE", body: new Uint8Array(0) });
    await check(await handlers.removeSpace(empty, context({ spaceId: ids.otherSpace })));
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});

test("strict query parsing preserves space scope, archive meanings and pagination", async () => {
  const { handlers: h, store } = setup();
  for (const q of ["?limit=0", "?limit=501", "?limit=1x", "?limit=1.5", "?offset=-1", "?offset=100001", "?status=deleted", "?includeArchivedSpaces=true", "?spaceId=bad", "?limit=1&limit=2", "?extra=1"]) await check(await h.listPages(request("GET", undefined, q)), 400, "invalid_wiki_request");
  await check(await h.listVersions(request("GET", undefined, "?limit=101"), pageContext()), 400, "invalid_wiki_request");
  await check(await h.listSpacePages(request("GET", undefined, `?spaceId=${ids.otherSpace}`), context({ spaceId: ids.space })), 400, "invalid_wiki_request");
  await check(await h.listSpacePages(request("GET", undefined, "?includeArchivedSpaces=1"), context({ spaceId: ids.space })), 400, "invalid_wiki_request");
  await check(await h.listSpaces(request("GET", undefined, "?includeArchived=0")), 400, "invalid_wiki_request");
  assert.equal(store.calls.length, 0);
  await check(await h.listPages(request("GET", undefined, `?spaceId=${ids.space}&status=archived&includeArchivedSpaces=1&limit=500&offset=2&q=term`)));
  assert.deepEqual(store.calls[0].args[0], { spaceId: ids.space, status: "archived", includeArchivedSpaces: true, limit: 500, offset: 2, q: "term" });
});

test("stateful conflicts do not change current body, history or page home", async () => {
  const { handlers: h, store } = setup(); store.notes.get(ids.note)!.contentVersion = 3;
  for (const fn of [() => h.copyPage(request("POST", { expectedVersion: 1 }), pageContext()), () => h.restoreVersion(request("POST", { expectedVersion: 1 }), versionContext()), () => h.movePage(request("POST", { expectedVersion: 1, spaceId: ids.otherSpace, sourceSpaceId: ids.space }), pageContext())]) {
    const result = await check(await fn(), 409, "note_conflict"); assert.equal(result.currentVersion, 3);
  }
  assert.equal(store.versions.get(ids.note)!.length, 1); assert.equal(store.notes.get(ids.note)!.wiki!.spaceId, ids.space);
  await check(await h.movePage(request("POST", { expectedVersion: 3, spaceId: ids.otherSpace, sourceSpaceId: ids.otherSpace }), pageContext()), 409, "wiki_home_conflict");
  await check(await h.getVersion(request(), context({ noteId: ids.note, versionId: ids.task })), 404, "wiki_not_found");
  store.notes.set(ids.task, fakePage(ids.task));
  await check(await h.getVersion(request(), context({ noteId: ids.task, versionId: ids.version })), 404, "wiki_not_found");
});

test("viewer/archived mutations refuse; archived readers can copy and read unavailable history", async () => {
  const { handlers: h, store } = setup("viewer");
  await check(await h.createPage(request("POST", {}), context({ spaceId: ids.space })), 403, "wiki_read_only");
  await check(await h.restoreVersion(request("POST", { expectedVersion: 1 }), versionContext()), 403, "wiki_read_only");
  await check(await h.getPage(request(), pageContext()));
  store.spaces.get(ids.space)!.archivedAt = "2026-11-03T12:00:00.000Z";
  assert.equal((await check(await h.getPage(request(), pageContext()))).note.canEdit, false);
  await check(await h.copyPage(request("POST", { expectedVersion: 1 }), pageContext()), 201);
  const version = store.versions.get(ids.note)![0]; version.attachments[0].available = false; version.unavailableAttachmentIds.push(ids.task);
  const detail = await check(await h.getVersion(request(), versionContext()));
  assert.equal(detail.version.attachments[0].available, false); assert.deepEqual(detail.version.unavailableAttachmentIds, [ids.task]);
  const manager = createWikiApiHandlers({ store, requireUser: async () => fakeIdentity(), isDatabaseConfigured: () => true });
  await check(await manager.updateSpace(request("PATCH", { title: "Forbidden", archived: false }), context({ spaceId: ids.space })), 403, "wiki_read_only");
  await check(await manager.updateSpace(request("PATCH", { archived: false }), context({ spaceId: ids.space })));
});

test("unreadable and missing resources share the same concealed 404 envelope", async () => {
  const { handlers: h } = setup("outsider");
  const a = await check(await h.getPage(request(), pageContext()), 404, "wiki_not_found");
  const b = await check(await setup().handlers.getPage(request(), context({ noteId: ids.task })), 404, "wiki_not_found");
  assert.deepEqual(a, b); assert.ok(!JSON.stringify(a).includes("Private"));
});

test("all typed error codes, board mappings, transient failures and unexpected failures serialize safely", async () => {
  const codes: Array<[WikiRuleCode, number]> = [["invalid_wiki_request",400],["wiki_team_board_required",400],["wiki_read_only",403],["wiki_not_found",404],["wiki_home_conflict",409],["wiki_home_change_forbidden",409],["wiki_space_exists",409],["wiki_slug_exists",409],["wiki_space_not_empty",409],["wiki_format_unsupported",409],["note_attachment_unavailable",409],["wiki_temporarily_unavailable",503]];
  for (const [code, status] of codes) await check(wikiRouteErrorResponse(new WikiRuleError(code, "Safe domain message", status)), status, code);
  await check(wikiRouteErrorResponse(new BoardAccessError("board_not_found", "Restricted board", 404)), 404, "wiki_not_found");
  await check(wikiRouteErrorResponse(new BoardAccessError("board_access_denied", "No edit", 403)), 403, "wiki_read_only");
  await check(wikiRouteErrorResponse(new BoardAccessError("note_attachment_unavailable", "Disk path", 409)), 409, "note_attachment_unavailable");
  await check(wikiRouteErrorResponse(new NotesNotFoundError("Restricted title")), 404, "wiki_not_found");
  assert.equal((await check(wikiRouteErrorResponse(new NoteConflictError(8)), 409, "note_conflict")).currentVersion, 8);
  for (const code of ["08006", "40001", "40P01", "53300", "55P03", "57014", "57P01", "ECONNREFUSED", "ETIMEDOUT"]) {
    const result = await check(wikiRouteErrorResponse(Object.assign(new Error("postgres://secret@db/private"), { code })), 503, "wiki_temporarily_unavailable");
    assert.ok(!JSON.stringify(result).includes("secret"));
  }
  await check(wikiRouteErrorResponse(new Error("timeout exceeded when trying to connect")), 503, "wiki_temporarily_unavailable");
  const result = await check(wikiRouteErrorResponse(new Error("postgres://secret@db/private")), 500);
  assert.ok(!JSON.stringify(result).includes("secret"));
  const { store } = setup(); const h = createWikiApiHandlers({ store, requireUser: async () => { throw new Error("Private auth failure"); }, isDatabaseConfigured: () => true });
  await check(await h.listSpaces(request()), 500); assert.equal(store.calls.length, 0);
  await check(await createWikiApiHandlers({ store, requireUser: async () => { throw Error("must not run"); }, isDatabaseConfigured: () => false }).listSpaces(request()), 503, "wiki_temporarily_unavailable");
});

test("Notes aliases are rejected, legal home fields survive, permanent flags are explicit", async () => {
  for (const key of ["wikiSpaceId", "wiki_space_id", "board_id", "ownerUserId", "owner_user_id", "kind", "content_version", "contentFormatVersion"]) {
    assert.throws(() => assertNotesRequestFields({ title: "Keep", [key]: null }, ["title", "home", "notebookId"]), WikiRuleError);
  }
  assert.doesNotThrow(() => assertNotesRequestFields({ title: "Keep", home: null, notebookId: null }, ["title", "home", "notebookId"]));
  assert.equal(permanentNoteDeleteOption(new URLSearchParams()), false);
  assert.equal(permanentNoteDeleteOption(new URLSearchParams("permanent=1")), true);
  for (const value of ["permanent=", "permanent=0", "permanent=true", "permanent=1&permanent=1"]) assert.throws(() => permanentNoteDeleteOption(new URLSearchParams(value)), WikiRuleError);
  assert.deepEqual(await notesRouteErrorResponse(new NotesNotFoundError("Note not found."), "fallback").json(), { error: "Note not found." });
  assert.deepEqual(await notesRouteErrorResponse(new NoteConflictError(4), "fallback").json(), { error: "This note changed since you opened it.", code: "note_conflict", currentVersion: 4 });
  const mapped = notesRouteErrorResponse(new WikiRuleError("wiki_home_change_forbidden", "Cannot move", 409), "fallback");
  assert.equal(mapped.status, 409); assert.equal((await mapped.json()).code, "wiki_home_change_forbidden");
  const constraint = Object.assign(new Error("SQL text must be concealed"), { severity: "ERROR", code: "23514", constraint: "taskboard_subtask_owns_nothing" });
  const subtask = notesRouteErrorResponse(constraint, "fallback");
  assert.equal(subtask.status, 400); assert.equal((await subtask.json()).code, "subtask_rule");
  const sql = notesRouteErrorResponse(Object.assign(new Error("secret SQL"), { severity: "ERROR", code: "23505" }), "Unable to save note.");
  assert.equal(sql.status, 500); assert.deepEqual(await sql.json(), { error: "Unable to save note." });
  const transient = notesRouteErrorResponse(Object.assign(new Error("secret connection string"), { code: "ECONNREFUSED" }), "fallback");
  assert.equal(transient.status, 503); assert.ok(!(await transient.json()).error.includes("Wiki"));
});
