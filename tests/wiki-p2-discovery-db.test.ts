import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { fixture, enabled, content, code } from "./helpers/wiki-db";
import { createWikiSpace, createWikiPage, updateWikiSpace, moveWikiPage } from "@/lib/wiki-store";
import { createWikiTopic, setWikiPageTopics } from "@/lib/wiki-topics-store";
import { resolveWikiMentions, searchWikiPages, listWikiBacklinks } from "@/lib/wiki-discovery-store";
import { createNote, trashNote, updateNote } from "@/lib/notes-store";

test("permission-filtered discovery, weighted search, safe snippets and scale plans", { skip: !enabled, timeout: 120000 }, async t => {
  const f = await fixture(), { pool, users: u } = f;
  try {
    const a = await createWikiSpace(u.owner, { boardId: f.board, title: "Discovery" }), b = await createWikiSpace(u.owner, { boardId: f.board2, title: "Restricted" });
    await pool.query("DELETE FROM board_members WHERE board_id=$1 AND user_id=$2", [f.board2, u.viewer.id]);
    const title = await createWikiPage(u.editor, a.id, { title: "Needle", content: content("plain body") });
    const body = await createWikiPage(u.editor, a.id, { title: "Body only", content: content('needle <script>alert("visible text")</script> WIKISTARTcollisionX <b>needle</b>') });
    const hidden = await createWikiPage(u.editor, b.id, { title: "Needle secret" });
    const personal = await createNote(u.owner, { title: "Needle personal" });
    const trashed = await createWikiPage(u.editor, a.id, { title: "Needle trash" }); await trashNote(u.editor, trashed.id);
    await t.test("ranking, prefix, punctuation, pagination and hidden targets", async () => {
      const result = await searchWikiPages(u.viewer, { q: "nee", limit: 1 });
      assert.equal(result.pages[0].id, title.id); assert.equal(result.hasMore, true);
      const next = await searchWikiPages(u.viewer, { q: "needle", limit: 1, offset: 1 });
      assert.equal(next.pages[0].id, body.id); assert.equal(next.hasMore, false);
      assert.ok(next.pages[0].snippet.some(p => p.match && /needle/i.test(p.text)));
      // Headline may end its excerpt at the last matching word, but tags inside
      // that excerpt remain literal text rather than being stripped or rendered.
      assert.match(next.pages[0].snippet.map(p=>p.text).join(""), /<script>.*<\/script>.*<b>needle/);
      assert.ok(next.pages[0].snippet.every(p => typeof p.text === "string" && typeof p.match === "boolean"));
      assert.deepEqual((await searchWikiPages(u.outsider, { q: "needle" })).pages, []);
      const recent = await searchWikiPages(u.viewer, { q: "!!!" }); assert.equal(recent.pages.length, 2);
      assert.equal((await searchWikiPages(u.viewer, { q: "" })).pages.length, 2);
      await assert.rejects(searchWikiPages(u.viewer, { q: "x".repeat(201) }), code("invalid_wiki_request"));
      await assert.rejects(searchWikiPages(u.viewer, { q: "", spaceId: b.id }), code("wiki_not_found"));
      await assert.rejects(searchWikiPages(u.viewer, { q: "", topicId: randomUUID() }), code("invalid_wiki_request"));
      const all = await resolveWikiMentions(u.viewer, { noteIds: [hidden.id, personal.id, trashed.id, randomUUID()] });
      assert.equal(all.length, 4); assert.ok(all.every(r => Object.keys(r).sort().join() === "noteId,state" && r.state === "restricted"));
    });
    await t.test("topic descendants dedupe and deterministic ties", async () => {
      const root = await createWikiTopic(u.owner, a.id, { title: "Root", expectedTopicsVersion: 1 });
      const child = await createWikiTopic(u.owner, a.id, { title: "Child", parentTopicId: root.topic.id, expectedTopicsVersion: 2 });
      await setWikiPageTopics(u.editor, title.id, { sourceSpaceId: a.id, expectedTopicIds: [], topicIds: [root.topic.id, child.topic.id] });
      await setWikiPageTopics(u.editor, body.id, { sourceSpaceId: a.id, expectedTopicIds: [], topicIds: [child.topic.id] });
      assert.equal((await searchWikiPages(u.viewer, { q: "needle", spaceId: a.id, topicId: root.topic.id })).pages.length, 2);
      assert.equal((await searchWikiPages(u.viewer, { q: "needle", spaceId: a.id, topicId: root.topic.id, includeDescendants: false })).pages.length, 1);
      await pool.query("UPDATE notes SET updated_at='2026-01-01' WHERE id=ANY($1::uuid[])", [[title.id, body.id]]);
      assert.deepEqual((await searchWikiPages(u.viewer, { q: "" })).pages.map(p => p.id), [title.id, body.id].sort());
    });
    await t.test("nested mentions plus URLs dedupe, current names/moves and viewer-filtered backlinks", async () => {
      const mention = { type: "pageMention", props: { noteId: title.id } };
      const blocks = [{ type: "table", content: { type: "tableContent", rows: [{ cells: [[mention], { type: "tableCell", content: [mention] }] }] }, children: [{ type: "paragraph", content: [{ type: "link", href: `/notes?note=${title.id}`, content: [] }] }] }];
      await updateNote(u.editor, body.id, { content: { formatVersion: 2, blocks, markdown: `[Wiki page](/wiki/_/${title.id})`, text: "FORGED SECRET" }, expectedVersion: 1 });
      await updateNote(u.editor, hidden.id, { content: { formatVersion: 2, blocks, markdown: "", text: "" }, expectedVersion: 1 });
      await updateNote(u.editor, title.id, { content: { formatVersion: 2, blocks, markdown: "", text: "" }, expectedVersion: 1 });
      assert.equal((await pool.query("SELECT 1 FROM note_links WHERE source_note_id=$1 AND target_note_id=$2", [body.id, title.id])).rowCount, 1);
      assert.equal((await pool.query("SELECT content_text FROM notes WHERE id=$1", [body.id])).rows[0].content_text, "");
      assert.deepEqual((await listWikiBacklinks(u.viewer, title.id, { limit: 1 })).pages.map(p => p.id), [body.id]);
      assert.equal((await listWikiBacklinks(u.viewer, title.id, { limit: 1 })).hasMore, false);
      assert.equal((await listWikiBacklinks(u.editor, title.id)).pages.length, 2);
      await updateNote(u.editor, title.id, { title: "Renamed", expectedVersion: 2 });
      let resolution = (await resolveWikiMentions(u.viewer, { noteIds: [title.id] }))[0]; assert.equal(resolution.state, "readable"); if (resolution.state === "readable") assert.equal(resolution.title, "Renamed");
      await moveWikiPage(u.editor, title.id, { sourceSpaceId: a.id, spaceId: b.id, expectedVersion: 3 });
      assert.equal((await resolveWikiMentions(u.viewer, { noteIds: [title.id] }))[0].state, "restricted");
      await updateWikiSpace(u.owner, b.id, { archived: true });
      resolution = (await resolveWikiMentions(u.editor, { noteIds: [title.id] }))[0]; if (resolution.state === "readable") assert.equal(resolution.archived, true); else assert.fail("Archived readable target must resolve");
      assert.equal((await searchWikiPages(u.editor, { q: "Renamed" })).pages.length, 0);
      assert.equal((await searchWikiPages(u.editor, { q: "Renamed", spaceId:b.id })).pages.length, 1);
      assert.equal((await searchWikiPages(u.editor, { q: "Renamed", includeArchivedSpaces: true })).pages.length, 1);
    });
    await t.test("snippet fragments use readable separators",async()=>{
      await createWikiPage(u.editor,a.id,{title:"Fragments",content:content(`fragmentneedle ${"first ".repeat(60)}fragmentneedle ${"second ".repeat(60)}`)});
      const result=await searchWikiPages(u.viewer,{q:"fragmentneedle"});
      assert.equal(result.pages.length,1);assert.match(result.pages[0].snippet.map(p=>p.text).join(""),/ … /);
    });
    await t.test("eight-token query and scale uses weighted GIN index", async () => {
      await createWikiPage(u.editor, a.id, { title: "one two three four five six seven eight" });
      assert.equal((await searchWikiPages(u.viewer, { q: "one two three four five six seven eight absent" })).pages.length, 1);
      const started = performance.now();
      await pool.query(`INSERT INTO notes(id,owner_user_id,board_id,wiki_space_id,title,content_text,content_format_version)
        SELECT gen_random_uuid(),$1,$2,$3,'Scale '||g,CASE WHEN g=777 THEN 'selectiveterm' ELSE repeat('ordinary words ',30) END,2 FROM generate_series(1,12000) g`, [u.owner.id, f.board, a.id]);
      await pool.query("ANALYZE notes");
      const plan = (await pool.query("EXPLAIN (ANALYZE,BUFFERS,FORMAT JSON) SELECT id FROM notes WHERE search_vector @@ to_tsquery('simple','selectiveterm:*') AND wiki_space_id=$1 ORDER BY ts_rank(search_vector,to_tsquery('simple','selectiveterm:*')) DESC,updated_at DESC,id LIMIT 31", [a.id])).rows[0]["QUERY PLAN"];
      assert.match(JSON.stringify(plan), /notes_search_idx/);
      assert.equal((await searchWikiPages(u.viewer, { q: "selectiveterm" })).pages.length, 1);
      console.log(JSON.stringify({ scaleRows: 12000, fixtureAndQueryMs: performance.now() - started, relationBytes: (await pool.query("SELECT pg_total_relation_size('notes')::text bytes")).rows[0].bytes, plan }));
    });
  } finally { await f.cleanup(); }
});
