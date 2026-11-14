import assert from "node:assert/strict";
import test from "node:test";
import type { ComponentProps } from "react";
import type NoteEditor from "@/components/notes/note-editor";
import type PublicNoteBody from "@/components/public-note-body";
import { assertNoteContentFormat, extractPageMentionIds, isCanonicalPageMention, projectPageMentionsToLinks } from "@/lib/notes-content-format";
import { normalizeNoteContent } from "@/lib/notes-model";
import { canonicalWikiId, normalizeWikiIdSet, normalizeWikiPagination, normalizeWikiTopicMutation, normalizeWikiTopicTitle } from "@/lib/wiki-discovery-model";
import { WikiRuleError } from "@/lib/notes-errors";
import { createWikiTopicRequest, fetchWikiTopics, resolveWikiMentionsRequest, searchWikiPagesRequest, setWikiPageTopicsRequest } from "@/lib/wiki-discovery-client";
import { WikiRequestError, fetchWikiPages } from "@/lib/wiki-client";

const id = "aaaaaaaa-1111-4111-8111-111111111111";
const mention = { type: "pageMention", props: { noteId: id } };
// These compile against the actual components, not replacement props.
const editorProps: ComponentProps<typeof NoteEditor> = { initialBlocks: [], editable: true, onChange() {}, contentFormatVersion: 2, wikiContext: { spaceId: id, noteId: id } };
const readerProps: ComponentProps<typeof PublicNoteBody> = { content: [], contentFormatVersion: 2, wikiContext: { spaceId: id } };
void editorProps; void readerProps;
test("canonical IDs, bounded sets, topic title/version and pagination", () => {
  assert.equal(canonicalWikiId(id.toUpperCase()), id);
  assert.deepEqual(normalizeWikiIdSet([id.toUpperCase(), id]), [id]);
  for (const input of [["invalid"], Array(101).fill(id)]) assert.throws(() => normalizeWikiIdSet(input), WikiRuleError);
  assert.equal(normalizeWikiTopicTitle("  One \n two  "), "One two");
  for (const title of [" ", "x".repeat(121), null]) assert.throws(() => normalizeWikiTopicTitle(title), WikiRuleError);
  assert.throws(() => normalizeWikiTopicMutation({ expectedTopicsVersion: 1 }), WikiRuleError);
  assert.throws(() => normalizeWikiTopicMutation({ expectedTopicsVersion: 0, title: "A" }), WikiRuleError);
  assert.deepEqual(normalizeWikiPagination({}), { limit: 30, offset: 0 });
  assert.throws(() => normalizeWikiPagination({ limit: 101 }), WikiRuleError);
});
test("format assertion survives normalization and ordinary omitted version remains omitted", () => {
  assert.equal(normalizeNoteContent({ blocks: [], formatVersion: 2 }).formatVersion, 2);
  assert.equal(Object.hasOwn(normalizeNoteContent({ blocks: [] }), "formatVersion"), false);
  for (const version of ["2", 0, 1.5, null]) assert.throws(() => normalizeNoteContent({ blocks: [], formatVersion: version }));
});
test("v1 defaults are lossless; v2 nested/table mentions project without mutation", () => {
  const defaults = [{ type: "paragraph", content: [{ type: "text", text: "hello", styles: { bold: true } }], props: { unknownLegacyField: 42 } }];
  const before = JSON.stringify(defaults);
  assertNoteContentFormat(defaults, 1);
  assert.equal(JSON.stringify(defaults), before);
  const doc = [{ type: "paragraph", content: [mention], children: [{ type: "table", content: { type: "tableContent", rows: [{ cells: [[mention], { type: "tableCell", content: [mention] }] }] } }] }];
  assertNoteContentFormat(doc, 2);
  assert.deepEqual(extractPageMentionIds(doc), [id]);
  const projected = projectPageMentionsToLinks(doc);
  assert.equal(JSON.stringify(projected).includes("pageMention"), false);
  assert.equal(JSON.stringify(projected).includes(`/wiki/_/${id}`), true);
  assert.equal((doc[0].content[0]).type, "pageMention");
  assertNoteContentFormat(projected, 1);
});
test("unknown versions, malformed mentions and illegal placement refuse safely", () => {
  for (const version of [0, 3, NaN]) assert.throws(() => assertNoteContentFormat([], version), WikiRuleError);
  for (const bad of [{ ...mention, text: "Secret" }, { ...mention, props: { noteId: id, title: "Secret" } }, { ...mention, props: { noteId: "bad" } }]) {
    assert.equal(isCanonicalPageMention(bad), false);
    assert.throws(() => assertNoteContentFormat([{ type: "paragraph", content: [bad] }], 2), WikiRuleError);
  }
  for (const doc of [[mention], [{ type: "paragraph", props: { mention } }], [{ type: "paragraph", content: [{ type: "link", content: [mention] }] }]]) assert.throws(() => assertNoteContentFormat(doc, 2), WikiRuleError);
  assert.throws(() => assertNoteContentFormat([{ type: "paragraph", content: [mention] }], 1), WikiRuleError);
});
test("editor-supplied inventory rejects unknown types without a duplicate server inventory", () => {
  const doc = [{ type: "futureBlock", content: [] }];
  assertNoteContentFormat(doc, 2);
  assert.throws(() => assertNoteContentFormat(doc, 2, { blockTypes: ["paragraph"], inlineContentTypes: ["text", "link", "pageMention"] }), WikiRuleError);
  assert.throws(() => assertNoteContentFormat([{type:"paragraph",content:[{type:"link",href:"/",content:[{type:"futureInline"}]}]}],2,{blockTypes:["paragraph"],inlineContentTypes:["text","link","pageMention"]}),WikiRuleError);
});
test("real client wire envelopes, signals, flags, mutation bodies and error identity", async () => {
  const original = globalThis.fetch;
  const signal = new AbortController().signal;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  let payload: object = { ok: true, topics: [], topicsVersion: 1 };
  let status = 200;
  globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return Response.json(payload, { status }); };
  try {
    assert.deepEqual(await fetchWikiTopics(id, signal), { topics: [], topicsVersion: 1 });
    assert.equal(calls[0].init?.signal, signal);
    assert.equal(calls[0].init?.cache, "no-store");
    const input = { title: "Guides", expectedTopicsVersion: 1 };
    await createWikiTopicRequest(id, input);
    assert.equal(calls.at(-1)?.init?.method, "POST");
    assert.deepEqual(JSON.parse(String(calls.at(-1)?.init?.body)), input);
    await setWikiPageTopicsRequest(id, { sourceSpaceId: id, expectedTopicIds: [], topicIds: [id] });
    assert.equal(calls.at(-1)?.init?.method, "PUT");
    payload = { ok: true, mentions: [{ noteId: id, state: "restricted" }] };
    assert.deepEqual(await resolveWikiMentionsRequest({ noteIds: [id] }, signal), [{ noteId: id, state: "restricted" }]);
    payload = { ok: true, pages: [], limit: 30, offset: 0, hasMore: false };
    await searchWikiPagesRequest({ q: "one & two", includeArchivedSpaces: false, includeDescendants: false });
    assert.equal(calls.at(-1)?.url, "/api/wiki/search?q=one+%26+two&includeDescendants=0");
    await fetchWikiPages({includeArchivedSpaces:false,includeDescendants:false});
    assert.equal(calls.at(-1)?.url,"/api/wiki/pages?includeDescendants=0");
    status = 409; payload = { error: "Refresh topics.", code: "wiki_topics_conflict" };
    await assert.rejects(fetchWikiTopics(id), (error: unknown) => error instanceof WikiRequestError && error.code === "wiki_topics_conflict" && error.status === 409);
  } finally { globalThis.fetch = original; }
});
