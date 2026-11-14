import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { randomUUID } from "node:crypto";
import { fixture, enabled } from "./helpers/wiki-db";
import { createWikiSpace, createWikiPage } from "@/lib/wiki-store";
import { AUTH_COOKIE_NAME, createSessionCookieValue } from "@/lib/auth";
import * as tree from "@/app/api/wiki/spaces/[spaceId]/topics/route";
import * as topic from "@/app/api/wiki/spaces/[spaceId]/topics/[topicId]/route";
import * as assignment from "@/app/api/wiki/pages/[noteId]/topics/route";
import * as resolver from "@/app/api/wiki/mentions/resolve/route";
import * as search from "@/app/api/wiki/search/route";
import * as backlinks from "@/app/api/wiki/pages/[noteId]/backlinks/route";
import * as notes from "@/app/api/notes/route";
import * as note from "@/app/api/notes/[noteId]/route";
import { verifyDiscoveryHttp } from "./helpers/wiki-p2-server-http";
test("real routes, stores, auth identities and Notes/Linked notes format boundary", { skip: !enabled, timeout: 60000 }, async () => {
  const f = await fixture(), { users: u } = f;
  const req = (actor: keyof typeof u | null, method = "GET", body?: unknown, query = "", cookie?: string) => new NextRequest(`http://localhost/api/wiki${query}`, { method,
    headers: { ...(actor ? { "Remote-Email": u[actor].email, "Remote-Name": u[actor].displayName, "Remote-User": u[actor].username! } : {}), ...(cookie ? { Cookie: `${AUTH_COOKIE_NAME}=${cookie}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const check = async (response: Response, status = 200) => { assert.equal(response.status, status, await response.clone().text()); assert.equal(response.headers.get("cache-control"), "private, no-store"); return response.json(); };
  try {
    const s = await createWikiSpace(u.owner, { boardId: f.board, title: "API phase 2" }), p = await createWikiPage(u.editor, s.id);
    const sc = { params: Promise.resolve({ spaceId: s.id }) }, nc = { params: Promise.resolve({ noteId: p.id }) };
    assert.deepEqual((await check(await tree.GET(req("viewer"), sc))).topics, []);
    const created = await check(await tree.POST(req("manager", "POST", { title: "Root", expectedTopicsVersion: 1 }), sc), 201);
    const tc = { params: Promise.resolve({ spaceId: s.id, topicId: created.topic.id }) };
    await check(await topic.PATCH(req("manager", "PATCH", { title: "Renamed", expectedTopicsVersion: 2 }), tc));
    await check(await assignment.PUT(req("editor", "PUT", { sourceSpaceId: s.id, expectedTopicIds: [], topicIds: [created.topic.id] }), nc));
    assert.equal((await check(await assignment.GET(req("viewer"), nc))).topics[0].title, "Renamed");
    assert.equal((await check(await search.GET(req("viewer", "GET", undefined, `?spaceId=${s.id}&topicId=${created.topic.id}`)))).pages.length, 1);
    const body = { blocks: [{ type: "paragraph", content: [{ type: "pageMention", props: { noteId: p.id } }] }], markdown: `[Wiki page](/wiki/_/${p.id})`, text: "" };
    assert.equal((await check(await note.PATCH(req("editor", "PATCH", { content: body, expectedVersion: 1 }), nc), 409)).code, "wiki_format_unsupported");
    // Linked notes uses exactly the same Notes endpoint, with the same format assertion.
    await check(await note.PATCH(req("editor", "PATCH", { content: { ...body, formatVersion: 2 }, expectedVersion: 1 }), nc));
    assert.equal((await check(await backlinks.GET(req("viewer"), nc))).pages.length, 0, "self link omitted");
    const results = await check(await resolver.POST(req("viewer", "POST", { noteIds: [p.id, randomUUID()] })));
    assert.equal(results.mentions.filter((m: { state: string }) => m.state === "readable").length, 1);
    await check(await topic.DELETE(req("owner", "DELETE", { expectedTopicsVersion: 3 }), tc));
    assert.deepEqual((await check(await assignment.GET(req("viewer"), nc))).topics, []);
    await check(await tree.POST(req("viewer", "POST", { title: "No", expectedTopicsVersion: 4 }), sc), 403);
    await check(await tree.GET(req("outsider"), sc), 404);
    assert.equal((await check(await search.GET(req(null)), 401)).code, "authentication_required");
    assert.equal((await check(await search.GET(req("disabled")), 403)).code, "account_disabled");
    const cookie = await createSessionCookieValue({ userId: u.disabled.id, reservedAdmin: false, authProvider: "authelia" });
    assert.equal((await check(await search.GET(req(null, "GET", undefined, "", cookie)), 403)).code, "account_disabled");
    await check(await search.GET(req("viewer","GET",undefined,"",cookie)));
    assert.deepEqual((await check(await search.GET(req("outsider","GET",undefined,"",cookie)))).pages,[]);
    assert.equal((await check(await search.GET(req("disabled","GET",undefined,"",cookie)),403)).code,"account_disabled");
    for (const response of [await notes.GET(req(null)), await notes.POST(req(null, "POST", {})), await note.GET(req(null), nc), await note.PATCH(req(null, "PATCH", {}), nc), await note.DELETE(req(null, "DELETE"), nc)]) {
      assert.equal((await check(response, 401)).code, "authentication_required");
    }
    if(process.env.WIKI_P2_HTTP_TEST==="1")await verifyDiscoveryHttp(u,s.id);
  } finally { await f.cleanup(); }
});
