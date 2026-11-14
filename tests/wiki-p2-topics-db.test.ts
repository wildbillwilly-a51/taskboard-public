import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { fixture, enabled, content, code } from "./helpers/wiki-db";
import * as topics from "@/lib/wiki-topics-store";
import { createWikiSpace, createWikiPage, updateWikiSpace, moveWikiPage, copyWikiPageToPersonal, listWikiPages, listWikiVersions, restoreWikiVersion } from "@/lib/wiki-store";
import { getNote, updateNote, trashNote, restoreNote, uploadNoteAttachments, getNoteAttachmentDiskPath } from "@/lib/notes-store";
import { unlink } from "node:fs/promises";

test("topics, permissions, lifecycle, bounds and atomic move cleanup", { skip: !enabled, timeout: 60000 }, async t => {
  const f = await fixture(), { pool, users: u } = f;
  try {
    const a = await createWikiSpace(u.owner, { boardId: f.board, title: "Topics" }), b = await createWikiSpace(u.owner, { boardId: f.board2, title: "Other" });
    let version = 1;
    const create = async (title: string, parentTopicId: string | null = null) => { const r = await topics.createWikiTopic(u.manager, a.id, { title, parentTopicId, expectedTopicsVersion: version }); version = r.topicsVersion; return r.topic; };
    const p = await createWikiPage(u.editor, a.id, { title: "Page", content: content("body") });
    await t.test("empty, roles, names, parent and subtree depth", async () => {
      assert.deepEqual(await topics.listWikiTopics(u.viewer, a.id), { topics: [], topicsVersion: 1 });
      for (const actor of [u.viewer, u.editor]) await assert.rejects(topics.createWikiTopic(actor, a.id, { title: "Forbidden", expectedTopicsVersion: 1 }), code("wiki_read_only"));
      await assert.rejects(topics.listWikiTopics(u.outsider, a.id), code("wiki_not_found"));
      await assert.rejects(topics.listWikiTopics(u.disabled, a.id));
      const root = await create("Root"), child = await create("Child", root.id), deep = await create("Deep", child.id), leaf = await create("Leaf", deep.id);
      await assert.rejects(create("root"), code("wiki_topic_name_exists"));
      await assert.rejects(create("CHILD", root.id), code("wiki_topic_name_exists"));
      await assert.rejects(create("Too deep", leaf.id), code("invalid_wiki_request"));
      const foreign = await topics.createWikiTopic(u.owner, b.id, { title: "Foreign", expectedTopicsVersion: 1 });
      await assert.rejects(create("Foreign parent", foreign.topic.id), code("invalid_wiki_request"));
      await assert.rejects(topics.updateWikiTopic(u.owner, a.id, root.id, { parentTopicId: leaf.id, expectedTopicsVersion: version }), code("invalid_wiki_request"));
      const extra = await create("Extra");
      await assert.rejects(topics.updateWikiTopic(u.owner, a.id, root.id, { parentTopicId: extra.id, expectedTopicsVersion: version }), code("invalid_wiki_request"));
      await assert.rejects(topics.deleteWikiTopic(u.owner, a.id, root.id, { expectedTopicsVersion: version }), code("wiki_topic_has_children"));
      assert.equal((await topics.updateWikiTopic(u.owner, a.id, root.id, { title: "Root", expectedTopicsVersion: version })).topicsVersion, version);
      await assert.rejects(topics.updateWikiTopic(u.owner, a.id, root.id, { title: "Other", expectedTopicsVersion: 1 }), code("wiki_topics_conflict"));
    });
    const tree = await topics.listWikiTopics(u.viewer, a.id), root = tree.topics.find(t => t.title === "Root")!, leaf = tree.topics.find(t => t.title === "Leaf")!;
    await t.test("assignments independent of body version/history; descendant browse and foreign rejection", async () => {
      await assert.rejects(topics.setWikiPageTopics(u.viewer, p.id, { sourceSpaceId: a.id, expectedTopicIds: [], topicIds: [root.id] }), code("wiki_read_only"));
      const foreign = (await topics.listWikiTopics(u.owner, b.id)).topics[0];
      await assert.rejects(topics.setWikiPageTopics(u.editor, p.id, { sourceSpaceId: a.id, expectedTopicIds: [], topicIds: [root.id, foreign.id] }), code("invalid_wiki_request"));
      await topics.setWikiPageTopics(u.editor, p.id, { sourceSpaceId: a.id, expectedTopicIds: [], topicIds: [root.id, leaf.id, root.id.toUpperCase()] });
      assert.equal((await getNote(u.editor, p.id)).contentVersion, 1);
      assert.equal((await listWikiVersions(u.viewer, p.id)).versions.length, 1);
      await assert.rejects(topics.setWikiPageTopics(u.editor, p.id, { sourceSpaceId: a.id, expectedTopicIds: [], topicIds: [] }), code("wiki_topics_conflict"));
      assert.equal((await listWikiPages(u.viewer, { spaceId: a.id, topicId: root.id })).pages.length, 1);
      assert.equal((await listWikiPages(u.viewer, { spaceId: a.id, topicId: leaf.id, includeDescendants: false })).pages.length, 1);
      await updateNote(u.editor, p.id, { content: content("new body"), expectedVersion: 1 });
      const start = (await listWikiVersions(u.viewer, p.id)).versions.at(-1)!;
      await restoreWikiVersion(u.editor, p.id, start.id, { expectedVersion: 2 });
      assert.equal((await topics.getWikiPageTopics(u.viewer, p.id)).topics.length, 2);
    });
    await t.test("trash counts, restore, same-space move, copy and delete leave content history alone", async () => {
      await trashNote(u.editor, p.id);
      const counts = (await topics.listWikiTopics(u.owner, a.id)).topics.find(t => t.id === root.id)!;
      assert.equal(counts.pageCount, 0); assert.equal(counts.assignedPageCount, 1);
      await restoreNote(u.editor, p.id);
      await updateWikiSpace(u.owner,a.id,{homeNoteId:p.id});
      await moveWikiPage(u.editor, p.id, { spaceId: a.id.toUpperCase(), sourceSpaceId: a.id.toUpperCase(), expectedVersion: 3 });
      assert.equal((await topics.getWikiPageTopics(u.viewer, p.id)).topics.length, 2);
      assert.equal((await pool.query("SELECT home_note_id FROM wiki_spaces WHERE id=$1",[a.id])).rows[0].home_note_id,p.id);
      const copy = await copyWikiPageToPersonal(u.viewer, p.id, { expectedVersion: 3 });
      assert.equal((await pool.query("SELECT 1 FROM wiki_page_topics WHERE note_id=$1", [copy.id])).rowCount, 0);
      const before = await listWikiVersions(u.viewer, p.id);
      version = (await topics.deleteWikiTopic(u.owner, a.id, leaf.id, { expectedTopicsVersion: version })).topicsVersion;
      assert.equal((await topics.getWikiPageTopics(u.viewer, p.id)).topics.length, 1);
      assert.deepEqual(await listWikiVersions(u.viewer, p.id), before);
    });
    await t.test("file failure rolls back topic/home cleanup, then successful move clears both", async () => {
      await updateWikiSpace(u.owner, a.id, { homeNoteId: p.id });
      const [file] = await uploadNoteAttachments(u.editor, p.id, [{ originalName: "proof.txt", mimeType: "text/plain", sizeBytes: 1, buffer: Buffer.from("x") }]);
      const stored = (await pool.query("SELECT stored_name FROM note_attachments WHERE id=$1", [file.id])).rows[0].stored_name;
      await unlink(getNoteAttachmentDiskPath(stored));
      await assert.rejects(moveWikiPage(u.editor, p.id, { spaceId: b.id, sourceSpaceId: a.id, expectedVersion: 3 }), code("note_attachment_unavailable"));
      assert.equal((await topics.getWikiPageTopics(u.viewer, p.id)).topics.length, 1);
      assert.equal((await pool.query("SELECT home_note_id FROM wiki_spaces WHERE id=$1", [a.id])).rows[0].home_note_id, p.id);
      await pool.query("UPDATE note_attachments SET removed_at=clock_timestamp() WHERE id=$1", [file.id]);
      await moveWikiPage(u.editor, p.id, { spaceId: b.id, sourceSpaceId: a.id, expectedVersion: 3 });
      assert.deepEqual((await topics.getWikiPageTopics(u.viewer, p.id)).topics, []);
      assert.equal((await pool.query("SELECT home_note_id FROM wiki_spaces WHERE id=$1", [a.id])).rows[0].home_note_id, null);
      await assert.rejects(topics.setWikiPageTopics(u.editor, p.id, { sourceSpaceId: a.id, expectedTopicIds: [], topicIds: [] }), code("wiki_home_conflict"));
    });
    await t.test("midpoint precision rebalances, archive denies mutations, bounds stay explicit", async () => {
      const roots = (await topics.listWikiTopics(u.owner, a.id)).topics.filter(t => !t.parentTopicId);
      await pool.query("UPDATE wiki_topics SET sort_order=CASE WHEN id=$1 THEN 1 ELSE 1.0000000001 END WHERE id=ANY($2::uuid[])", [roots[0].id, roots.map(t => t.id)]);
      const r = await topics.createWikiTopic(u.owner, a.id, { title: "Between", beforeTopicId: roots[1].id, expectedTopicsVersion: version }); version = r.topicsVersion;
      const ordered = (await topics.listWikiTopics(u.owner, a.id)).topics.filter(t => !t.parentTopicId);
      assert.equal(ordered.findIndex(t => t.id === r.topic.id), 1);
      await updateWikiSpace(u.owner, a.id, { archived: true });
      await assert.rejects(create("Blocked"), code("wiki_read_only"));
      await updateWikiSpace(u.owner, a.id, { archived: false });
      await assert.rejects(topics.setWikiPageTopics(u.editor, p.id, { sourceSpaceId: b.id, expectedTopicIds: [], topicIds: Array(101).fill(randomUUID()) }), code("invalid_wiki_request"));
      const count = (await topics.listWikiTopics(u.owner, a.id)).topics.length;
      await pool.query("INSERT INTO wiki_topics(id,space_id,title,sort_order) SELECT gen_random_uuid(),$1,'Bulk '||g,g*1024 FROM generate_series(1,$2::int) g", [a.id, 1000 - count]);
      await assert.rejects(create("Over limit"), code("invalid_wiki_request"));
      const hundred=(await topics.listWikiTopics(u.owner,a.id)).topics.slice(0,100).map(t=>t.id),boundary=await createWikiPage(u.editor,a.id);
      assert.equal((await topics.setWikiPageTopics(u.editor,boundary.id,{sourceSpaceId:a.id,expectedTopicIds:[],topicIds:hundred})).topics.length,100);
    });
  } finally { await f.cleanup(); }
});
