import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { setTimeout as delay } from "node:timers/promises";
import { fixture, enabled, content } from "./helpers/wiki-db";
import { transaction, waitUntilBlocked } from "./helpers/wiki-concurrency-worker";
import { createWikiSpace, createWikiPage, moveWikiPage } from "@/lib/wiki-store";
import { createWikiTopic, updateWikiTopic, deleteWikiTopic, getWikiPageTopics, listWikiTopics, setWikiPageTopics } from "@/lib/wiki-topics-store";
import { getNote, updateNote, updateNoteInTransaction, trashNote, deleteNotePermanently } from "@/lib/notes-store";
import { rebuildNoteLinks } from "@/lib/notes-content-store";
type Outcome = { ok: true; value: unknown } | { ok: false; code?: string };
const settled = (promise: Promise<unknown>): Promise<Outcome> => promise.then(value => ({ ok: true, value }), (error: { code?: string }) => ({ ok: false, code: error.code }));
test("held-lock Phase 2 races preserve topic/home/content/link invariants", { skip: !enabled, timeout: 120000 }, async t => {
  const f = await fixture(), { users: u, pool } = f, controls = new Pool({ connectionString: process.env.DATABASE_URL, max: 4 });
  try {
    const a = await createWikiSpace(u.owner, { boardId: f.board, title: "Race A" }), b = await createWikiSpace(u.owner, { boardId: f.board2, title: "Race B" });
    const topic = (await createWikiTopic(u.owner, a.id, { title: "Assigned", expectedTopicsVersion: 1 })).topic;
    const ordered = async (sql: string, values: unknown[], first: () => Promise<unknown>, second: () => Promise<unknown>) => {
      const holder = await controls.connect(); let one: Promise<Outcome> | undefined, two: Promise<Outcome> | undefined;
      try {
        await transaction(holder); await holder.query(sql, values);
        one = settled(first()); await waitUntilBlocked(controls, holder);
        two = settled(second()); await waitUntilBlocked(controls, holder);
        const deadline = Date.now()+3500;
        while (true) {
          const waiting = (await controls.query("SELECT count(*)::int n FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock'")).rows[0].n;
          if (waiting >= 2) break;
          assert.ok(Date.now()<deadline,"Both operations must reach an observed lock barrier before release"); await delay(15);
        }
        await holder.query("COMMIT");
        return await Promise.all([one, two]);
      } finally { await holder.query("ROLLBACK"); holder.release(); await Promise.all([one, two]); }
    };
    for (const assignmentFirst of [true, false]) await t.test(`assignment vs move, assignment first=${assignmentFirst}`, async () => {
      const p = await createWikiPage(u.editor, a.id);
      const assign = () => setWikiPageTopics(u.editor, p.id, { sourceSpaceId: a.id, expectedTopicIds: [], topicIds: [topic.id] });
      const move = () => moveWikiPage(u.editor, p.id, { sourceSpaceId: a.id, spaceId: b.id, expectedVersion: 1 });
      const result = await ordered("SELECT id FROM notes WHERE id=$1 FOR NO KEY UPDATE", [p.id], assignmentFirst ? assign : move, assignmentFirst ? move : assign);
      assert.equal(result[0].ok, true);
      assert.deepEqual(result[1].ok ? { ok: true } : result[1], assignmentFirst ? { ok: true } : { ok: false, code: "wiki_home_conflict" });
      assert.deepEqual((await getWikiPageTopics(u.viewer, p.id)).topics, []);
    });
    for (const deletionFirst of [true, false]) await t.test(`topic deletion vs assignment, deletion first=${deletionFirst}`, async () => {
      const version = (await listWikiTopics(u.owner, a.id)).topicsVersion;
      const fresh = await createWikiTopic(u.owner, a.id, { title: `Delete ${deletionFirst}`, expectedTopicsVersion: version });
      const p = await createWikiPage(u.editor, a.id);
      await setWikiPageTopics(u.editor, p.id, { sourceSpaceId: a.id, expectedTopicIds: [], topicIds: [fresh.topic.id] });
      const remove = () => deleteWikiTopic(u.owner, a.id, fresh.topic.id, { expectedTopicsVersion: fresh.topicsVersion });
      const assign = () => setWikiPageTopics(u.editor, p.id, { sourceSpaceId: a.id, expectedTopicIds: [fresh.topic.id], topicIds: [topic.id] });
      const result = await ordered("SELECT id FROM wiki_spaces WHERE id=$1 FOR UPDATE", [a.id], deletionFirst ? remove : assign, deletionFirst ? assign : remove);
      assert.equal(result[0].ok, true);
      assert.deepEqual(result[1].ok ? { ok: true } : result[1], deletionFirst ? { ok: false, code: "wiki_topics_conflict" } : { ok: true });
      assert.equal((await pool.query("SELECT 1 FROM wiki_page_topics WHERE topic_id=$1", [fresh.topic.id])).rowCount, 0);
    });
    for (const deletionFirst of [true, false]) await t.test(`move vs topic deletion, deletion first=${deletionFirst}`, async () => {
      const version = (await listWikiTopics(u.owner, a.id)).topicsVersion;
      const fresh = await createWikiTopic(u.owner, a.id, { title: `Move delete ${deletionFirst}`, expectedTopicsVersion: version });
      const p = await createWikiPage(u.editor, a.id);
      await setWikiPageTopics(u.editor, p.id, { sourceSpaceId: a.id, expectedTopicIds: [], topicIds: [fresh.topic.id] });
      const remove = () => deleteWikiTopic(u.owner, a.id, fresh.topic.id, { expectedTopicsVersion: fresh.topicsVersion });
      const move = () => moveWikiPage(u.editor, p.id, { sourceSpaceId: a.id, spaceId: b.id, expectedVersion: 1 });
      const result = await ordered("SELECT id FROM wiki_spaces WHERE id=$1 FOR UPDATE", [a.id], deletionFirst ? remove : move, deletionFirst ? move : remove);
      assert.ok(result.every(r => r.ok), JSON.stringify(result));
      assert.deepEqual((await getWikiPageTopics(u.viewer, p.id)).topics, []);
    });
    await t.test("competing reparent attempts cannot form a cycle", async () => {
      let v = (await listWikiTopics(u.owner, a.id)).topicsVersion;
      const x = await createWikiTopic(u.owner, a.id, { title: "X", expectedTopicsVersion: v }); v = x.topicsVersion;
      const y = await createWikiTopic(u.owner, a.id, { title: "Y", expectedTopicsVersion: v }); v = y.topicsVersion;
      const result = await ordered("SELECT id FROM wiki_spaces WHERE id=$1 FOR UPDATE", [a.id],
        () => updateWikiTopic(u.owner, a.id, x.topic.id, { parentTopicId: y.topic.id, expectedTopicsVersion: v }),
        () => updateWikiTopic(u.owner, a.id, y.topic.id, { parentTopicId: x.topic.id, expectedTopicsVersion: v }));
      assert.equal(result[0].ok, true); assert.deepEqual(result[1], { ok: false, code: "wiki_topics_conflict" });
    });
    await t.test("body save plus assignment retain both changes and one body increment", async () => {
      const p = await createWikiPage(u.editor, a.id);
      const result = await ordered("SELECT id FROM notes WHERE id=$1 FOR NO KEY UPDATE", [p.id],
        () => updateNote(u.editor, p.id, { content: content("saved"), expectedVersion: 1 }),
        () => setWikiPageTopics(u.editor, p.id, { sourceSpaceId: a.id, expectedTopicIds: [], topicIds: [topic.id] }));
      assert.ok(result.every(r => r.ok)); assert.equal((await getNote(u.viewer, p.id)).contentVersion, 2); assert.equal((await getWikiPageTopics(u.viewer, p.id)).topics.length, 1);
    });
    await t.test("opposite cross-space moves use sorted locks", async () => {
      const p = await createWikiPage(u.editor, a.id), q = await createWikiPage(u.editor, b.id);
      const result = await ordered("SELECT id FROM wiki_spaces WHERE id=ANY($1::uuid[]) ORDER BY id FOR UPDATE", [[a.id, b.id]],
        () => moveWikiPage(u.editor, p.id, { sourceSpaceId: a.id, spaceId: b.id, expectedVersion: 1 }),
        () => moveWikiPage(u.editor, q.id, { sourceSpaceId: b.id, spaceId: a.id, expectedVersion: 1 }));
      assert.ok(result.every(r => r.ok), JSON.stringify(result));
    });
    await t.test("topic deletion and purge have no note-after-space lock inversion", async () => {
      const version = (await listWikiTopics(u.owner, a.id)).topicsVersion;
      const fresh = await createWikiTopic(u.owner, a.id, { title: "Purge", expectedTopicsVersion: version }), p = await createWikiPage(u.editor, a.id);
      await setWikiPageTopics(u.editor, p.id, { sourceSpaceId: a.id, expectedTopicIds: [], topicIds: [fresh.topic.id] }); await trashNote(u.editor, p.id);
      const result = await ordered("SELECT * FROM wiki_page_topics WHERE note_id=$1 FOR UPDATE", [p.id],
        () => deleteWikiTopic(u.owner, a.id, fresh.topic.id, { expectedTopicsVersion: fresh.topicsVersion }), () => deleteNotePermanently(u.owner, p.id));
      assert.ok(result.every(r => r.ok), JSON.stringify(result));
    });
    await t.test("reciprocal mention saves and target purge retain compatible target locks", async () => {
      const p = await createWikiPage(u.editor, a.id), q = await createWikiPage(u.editor, a.id);
      const mention = (id: string) => ({ formatVersion: 2, blocks: [{ type: "paragraph", content: [{ type: "pageMention", props: { noteId: id } }] }], markdown: `[Wiki page](/wiki/_/${id})`, text: "" });
      const x = await controls.connect(), y = await controls.connect();
      try {
        await transaction(x); await transaction(y);
        await x.query("SELECT id FROM notes WHERE id=$1 FOR NO KEY UPDATE", [p.id]); await y.query("SELECT id FROM notes WHERE id=$1 FOR NO KEY UPDATE", [q.id]);
        await Promise.all([updateNoteInTransaction(x, u.editor, p.id, { content: mention(q.id), expectedVersion: 1 }), updateNoteInTransaction(y, u.editor, q.id, { content: mention(p.id), expectedVersion: 1 })]);
        await x.query("COMMIT"); await y.query("COMMIT");
        assert.equal((await pool.query("SELECT 1 FROM note_links WHERE source_note_id=ANY($1::uuid[])", [[p.id, q.id]])).rowCount, 2);
        await trashNote(u.editor, q.id);
        await transaction(x); await transaction(y);
        await x.query("SELECT id FROM notes WHERE id=$1 FOR UPDATE", [q.id]);
        // A direct delete held open makes the target disappear while the saver waits.
        await x.query("DELETE FROM notes WHERE id=$1", [q.id]);
        const save = settled(rebuildNoteLinks(y, u.editor, p.id, mention(q.id).blocks, "http://localhost:3000"));
        // Cascading deletion holds the old indexed reference until commit.
        await waitUntilBlocked(controls,x); await x.query("COMMIT");
        assert.equal((await save).ok, true); await y.query("COMMIT");
        assert.equal((await pool.query("SELECT 1 FROM note_links WHERE target_note_id=$1", [q.id])).rowCount, 0);
      } finally { await x.query("ROLLBACK"); await y.query("ROLLBACK"); x.release(); y.release(); }
    });
    await t.test("mention save commits while target trash waits for the held space",async()=>{
      const p=await createWikiPage(u.editor,a.id),q=await createWikiPage(u.editor,a.id),holder=await controls.connect();
      let trash:Promise<Outcome>|undefined;
      try {
        await transaction(holder);await holder.query("SELECT id FROM notes WHERE id=$1 FOR NO KEY UPDATE",[p.id]);
        await holder.query("SELECT id FROM wiki_spaces WHERE id=$1 FOR SHARE",[a.id]);
        trash=settled(trashNote(u.editor,q.id));await waitUntilBlocked(controls,holder);
        await updateNoteInTransaction(holder,u.editor,p.id,{content:{formatVersion:2,blocks:[{type:"paragraph",content:[{type:"pageMention",props:{noteId:q.id}}]}],markdown:`[Wiki page](/wiki/_/${q.id})`,text:""},expectedVersion:1});
        await holder.query("COMMIT");assert.equal((await trash).ok,true);
        assert.equal((await getNote(u.viewer,p.id)).contentVersion,2);
      }finally{await holder.query("ROLLBACK");holder.release();await trash;}
    });
    assert.equal((await pool.query("SELECT 1 FROM wiki_page_topics p JOIN notes n ON n.id=p.note_id JOIN wiki_topics t ON t.id=p.topic_id WHERE n.wiki_space_id<>t.space_id OR n.wiki_space_id IS NULL")).rowCount, 0);
  } finally { await controls.end(); await f.cleanup(); }
});
