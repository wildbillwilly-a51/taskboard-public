import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { createWikiDiscoveryApiHandlers } from "@/lib/wiki-discovery-api";
import type { WikiDiscoveryStore } from "@/lib/wiki-discovery-model";
import { WikiRuleError } from "@/lib/notes-errors";
import { TaskboardAuthenticationError } from "@/lib/taskboard-auth-errors";
import { notesRouteErrorResponse } from "@/lib/notes-route";
const id = "aaaaaaaa-1111-4111-8111-111111111111";
const actor = { id, email: "fixture@example.invalid", displayName: "Fixture", authMode: "authelia" as const };
const req = (method = "GET", body?: unknown, query = "") => new NextRequest(`http://localhost/api/wiki${query}`, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const ctx = { params: Promise.resolve({ spaceId: id, noteId: id, topicId: id }) };
function fixture() {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const tree = { topics: [], topicsVersion: 1 }, pages = { pages: [], limit: 30, offset: 0, hasMore: false };
  const store = new Proxy({}, { get: (_, name: string) => async (...args: unknown[]) => { calls.push({ name, args }); return name === "resolveWikiMentions" ? [] : name === "searchWikiPages" || name === "listWikiBacklinks" ? pages : name === "getWikiPageTopics" || name === "setWikiPageTopics" ? { spaceId: id, topics: [] } : name === "createWikiTopic" ? { topic: { id }, topicsVersion: 2 } : tree; } }) as WikiDiscoveryStore;
  return { calls, store, handlers: createWikiDiscoveryApiHandlers({ store, requireUser: async () => actor, isDatabaseConfigured: () => true }) };
}
test("all discovery operations preserve wire shape and canonicalized inputs", async () => {
  const { calls, handlers: h } = fixture();
  const responses = [await h.listTopics(req(), ctx), await h.createTopic(req("POST", { title: " A  topic ", expectedTopicsVersion: 1 }), ctx),
    await h.updateTopic(req("PATCH", { title: "Rename", expectedTopicsVersion: 2 }), ctx), await h.deleteTopic(req("DELETE", { expectedTopicsVersion: 2 }), ctx),
    await h.getPageTopics(req(), ctx), await h.setPageTopics(req("PUT", { sourceSpaceId: id, expectedTopicIds: [], topicIds: [id.toUpperCase(), id] }), ctx),
    await h.resolveMentions(req("POST", { noteIds: [id.toUpperCase(), id] })), await h.backlinks(req(), ctx), await h.search(req("GET", undefined, "?q=needle&includeDescendants=0"))];
  for (const [i, response] of responses.entries()) { assert.equal(response.status, i === 1 ? 201 : 200); assert.equal(response.headers.get("cache-control"), "private, no-store"); assert.equal((await response.json()).ok, true); }
  assert.equal(calls.length, 9); assert.equal((calls[1].args[2] as { title: string }).title, "A topic");
  assert.deepEqual((calls[5].args[2] as { topicIds: string[] }).topicIds, [id]); assert.deepEqual(calls[6].args[1], { noteIds: [id] });
  assert.deepEqual(calls[8].args[1], { q: "needle", limit: 30, offset: 0, includeDescendants: false, includeArchivedSpaces: false });
});
test("strict keys, repeated queries, bad IDs, booleans, bounds and JSON refuse before store dispatch", async () => {
  const { calls, handlers: h } = fixture();
  const requests = [
    () => h.createTopic(req("POST", { title: "", expectedTopicsVersion: 1 }), ctx),
    () => h.createTopic(req("POST", { title: "A", expectedTopicsVersion: 1, sortOrder: "1" }), ctx),
    () => h.updateTopic(req("PATCH", { expectedTopicsVersion: 1 }), ctx),
    () => h.deleteTopic(req("DELETE", { expectedTopicsVersion: "1" }), ctx),
    () => h.listTopics(req("GET", undefined, "?unknown=1"), ctx),
    () => h.setPageTopics(req("PUT", { sourceSpaceId: id, expectedTopicIds: [], topicIds: ["bad"] }), ctx),
    () => h.resolveMentions(req("POST", { noteIds: Array(101).fill(id) })),
    ...["?q=a&q=b", "?includeArchivedSpaces=0", "?includeDescendants=yes", "?limit=101", "?offset=100001", "?limit=1.2", `?topicId=${id}`, "?spaceId=bad", `?q=${"x".repeat(201)}`].map(q => () => h.search(req("GET", undefined, q))),
  ];
  for (const run of requests) { const response = await run(); assert.equal(response.status, 400); assert.equal((await response.json()).code, "invalid_wiki_request"); }
  assert.equal(calls.length, 0);
});
test("typed auth, conflicts, transient errors and unexpected failures stay private", async () => {
  const { store } = fixture();
  for (const [error, status, code] of [
    [new TaskboardAuthenticationError("authentication_required", "forwarded headers"), 401, "authentication_required"],
    [new TaskboardAuthenticationError("account_disabled", "Taskboard user is disabled."), 403, "account_disabled"],
    [new WikiRuleError("wiki_topics_conflict", "Refresh topics.", 409), 409, "wiki_topics_conflict"],
    [Object.assign(new Error("PRIVATE SQL"), { code: "40P01" }), 503, "wiki_temporarily_unavailable"],
    [Object.assign(new Error("PRIVATE SQL"), { code: "23505", constraint: "unexpected" }), 500, undefined],
  ] as const) {
    const h = createWikiDiscoveryApiHandlers({ store, requireUser: async () => { throw error; }, isDatabaseConfigured: () => true });
    const response = await h.search(req()); const body = await response.json();
    assert.equal(response.status, status); assert.equal(body.code, code); assert.doesNotMatch(JSON.stringify(body), /PRIVATE SQL|forwarded headers/);
    if (error instanceof TaskboardAuthenticationError) assert.equal(notesRouteErrorResponse(error, "Failed").status, status);
  }
});
