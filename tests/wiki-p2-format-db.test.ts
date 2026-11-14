import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { Pool } from "pg";
import { fixture, enabled, content, code } from "./helpers/wiki-db";
import { initializeSchema, loadRecordedMigrations } from "@/lib/schema-migrations";
import { applyFrozenBaseline } from "@/lib/schema-baseline";
import { createWikiSpace, createWikiPage, promoteNoteToWiki, copyWikiPageToPersonal, listWikiVersions, restoreWikiVersion } from "@/lib/wiki-store";
import { createNote, getNote, updateNote, trashNote, deleteNotePermanently, withOwnedBoardNotes } from "@/lib/notes-store";
import { assertNoteContentFormat } from "@/lib/notes-content-format";
import { getBlocksPlainText } from "@/lib/notes-model";

test("format boundary, mention persistence, ordinary compatibility and populated 0009 conversion", { skip: !enabled, timeout: 120000 }, async t => {
  const f = await fixture(), { users: u, pool } = f;
  try {
    const s = await createWikiSpace(u.owner, { boardId: f.board, title: "Formats" });
    const target = await createWikiPage(u.owner, s.id, { title: "Never cached title" });
    const mention = { type: "pageMention", props: { noteId: target.id } };
    const blocks = [{ type: "paragraph", content: [mention] }];
    const body = { formatVersion: 2, blocks, markdown: `[Wiki page](/wiki/_/${target.id})`, text: "forged title" };
    await t.test("wiki body assertion, title-only, ordinary mentions and copy projection", async () => {
      const p = await createWikiPage(u.editor, s.id, { content: body });
      assert.equal(p.contentFormatVersion, 2); assert.deepEqual(p.content, blocks);
      await assert.rejects(createWikiPage(u.editor, s.id, { content: { ...body, formatVersion: undefined } }), code("wiki_format_unsupported"));
      await assert.rejects(updateNote(u.editor, p.id, { content: { ...body, formatVersion: undefined }, expectedVersion: 1 }), code("wiki_format_unsupported"));
      await assert.rejects(updateNote(u.editor, p.id, { content: { ...body, formatVersion: 3 }, expectedVersion: 1 }), code("wiki_format_unsupported"));
      await updateNote(u.editor, p.id, { title: "Title only", expectedVersion: 1 });
      assert.deepEqual((await getNote(u.viewer, p.id)).content, blocks);
      const start = (await listWikiVersions(u.viewer, p.id)).versions.at(-1)!;
      await updateNote(u.editor, p.id, { content: content("replacement"), expectedVersion: 2 });
      const restored = await restoreWikiVersion(u.editor, p.id, start.id, { expectedVersion: 3 });
      assert.equal(restored.contentFormatVersion, 2); assert.deepEqual(restored.content, blocks);
      assert.equal((await pool.query("SELECT content_text FROM notes WHERE id=$1", [p.id])).rows[0].content_text, "");
      const copy = await copyWikiPageToPersonal(u.viewer, p.id, { expectedVersion: 4 });
      assert.equal(copy.contentFormatVersion, 1); assertNoteContentFormat(copy.content, 1);
      assert.match(JSON.stringify(copy.content), /Wiki page/); assert.doesNotMatch(JSON.stringify(copy.content), /Never cached|pageMention/);
      await trashNote(u.editor, p.id); await deleteNotePermanently(u.owner, p.id);
      assert.deepEqual((await getNote(u.viewer, copy.id)).content, copy.content);
      await assert.rejects(createNote(u.owner, { content: body }), code("wiki_format_unsupported"));
      const ordinary = await createNote(u.editor, { boardId: f.board, content: content("default body") });
      assert.equal(ordinary.contentFormatVersion, 1);
      await updateNote(u.editor, ordinary.id, { content: { blocks: [], markdown: "", text: "" }, expectedVersion: 1 });
      assert.equal((await promoteNoteToWiki(u.editor, ordinary.id, { spaceId: s.id, expectedVersion: 2 })).contentFormatVersion, 2);
      assert.equal(getBlocksPlainText([{ type: "paragraph", content: [{ ...mention, text: "stolen", content: [{ text: "cached" }] }] }]), "");
    });
    await t.test("malformed stored v1 and unknown formats refuse without rewriting content/history", async () => {
      const p = await createWikiPage(u.owner, s.id);
      await pool.query("UPDATE notes SET content_json=$2::jsonb,content_format_version=1 WHERE id=$1", [p.id, JSON.stringify(blocks)]);
      await assert.rejects(updateNote(u.owner, p.id, { title: "No", expectedVersion: 1 }), code("wiki_format_unsupported"));
      await assert.rejects(copyWikiPageToPersonal(u.owner, p.id, { expectedVersion: 1 }), code("wiki_format_unsupported"));
      const version = (await listWikiVersions(u.owner, p.id)).versions[0];
      await pool.query("UPDATE note_versions SET content_format_version=3 WHERE id=$1", [version.id]);
      await assert.rejects(restoreWikiVersion(u.owner, p.id, version.id, { expectedVersion: 1 }), code("wiki_format_unsupported"));
      assert.deepEqual((await getNote(u.owner, p.id)).content, blocks);
      assert.equal((await getNote(u.owner, p.id)).contentVersion, 1);
    });
    await t.test("valid legacy v1 bodies upgrade atomically, connector owned-board scope cannot reach team wiki",async()=>{
      const p=await createWikiPage(u.owner,s.id);
      await pool.query("UPDATE notes SET content_format_version=1 WHERE id=$1",[p.id]);
      const saved=await updateNote(u.owner,p.id,{content:body,expectedVersion:1});
      assert.equal(saved.contentFormatVersion,2);assert.deepEqual(saved.content,blocks);
      await assert.rejects(withOwnedBoardNotes(f.personal,u.owner.id,()=>updateNote(u.owner,p.id,{content:{blocks:[],markdown:"",text:""},expectedVersion:2})));
      await assert.rejects(withOwnedBoardNotes(f.board,u.owner.id,()=>updateNote(u.owner,p.id,{content:{blocks:[],markdown:"",text:""},expectedVersion:2})));
      assert.equal((await getNote(u.owner,p.id)).contentVersion,2);
    });
    await t.test("0009 upgrade preserves row bytes/values, converts nested history and reports exceptions", async () => {
      const name = `taskboard_visual_test_wiki_p2_server_upgrade_${randomUUID().slice(0, 8)}`, url = new URL(process.env.DATABASE_URL!); url.pathname = `/${name}`;
      const directory = await mkdtemp(path.join(process.env.WIKI_P2_SANDBOX_ROOT!, "format-migrations-"));
      await pool.query(`CREATE DATABASE ${name}`); const upgrade = new Pool({ connectionString: url.toString(), max: 2 });
      try {
        const migrations = await loadRecordedMigrations();
        for (const migration of migrations.filter(m => m.id.slice(0, 4) <= "0009")) await writeFile(path.join(directory, `${migration.id}.sql`), migration.sql);
        await initializeSchema({ pool: upgrade, directory, baseline: applyFrozenBaseline, seed: async () => {} });
        const owner = randomUUID(), board = randomUUID(), space = randomUUID();
        await upgrade.query("INSERT INTO users(id,email,display_name) VALUES($1,'format@example.invalid','Format')", [owner]);
        const team = randomUUID();
        await upgrade.query("INSERT INTO teams(id,name) VALUES($1,'Format')", [team]);
        await upgrade.query("INSERT INTO boards(id,title,board_type,owner_team_id,created_by_user_id,team_member_default_access) VALUES($1,'Format','team',$2,$3,'viewer')", [board,team,owner]);
        await upgrade.query("INSERT INTO wiki_spaces(id,board_id,slug,title,archived_at) VALUES($1,$2,'format','Format',NOW())", [space, board]);
        const defaults = [{ type: "codeBlock", props: { language: "typescript" }, content: [{ type: "text", text: "const x = 1", styles: {} }] }, { type: "unknownLegacy", props: { preserve: true }, children: [{ type: "table", content: { type: "tableContent", rows: [{ cells: [[{ type: "text", text: "cell", styles: {} }]] }] } }] }];
        const ids = Array.from({ length: 5 }, () => randomUUID());
        for (const [index, id] of ids.entries()) {
          const json = index === 2 ? [{ type: "table", content: { type: "tableContent", rows: [{ cells: [[mention]] }] } }] : defaults;
          await upgrade.query("INSERT INTO notes(id,owner_user_id,board_id,wiki_space_id,title,content_json,content_markdown,content_text,content_format_version,deleted_at) VALUES($1,$2,$3,$4,'Preserve',$5::jsonb,'exact markdown','exact text',$6,$7)", [id, owner, index === 0 ? null : board, index === 0 ? null : space, JSON.stringify(json), index === 3 ? 3 : 1, index === 4 ? new Date() : null]);
          if (index) await upgrade.query("INSERT INTO note_versions(id,note_id,version_number,kind,title,content_json,content_markdown,content_format_version,attachment_ids,started_at,saved_at) VALUES($1,$2,1,'start','History',$3::jsonb,'exact history',$4,$5,NOW(),NOW())", [randomUUID(), id, JSON.stringify(json), index === 3 ? 3 : 1, [randomUUID()]]);
        }
        const before = (await upgrade.query("SELECT to_jsonb(n)-'search_vector'-'content_format_version' value FROM notes n ORDER BY id")).rows;
        const history = (await upgrade.query("SELECT to_jsonb(v)-'content_format_version' value FROM note_versions v ORDER BY id")).rows;
        await upgrade.query("INSERT INTO notes(id,owner_user_id,title,content_text) SELECT gen_random_uuid(),$1,'Scale old '||g,repeat('preserved body ',40) FROM generate_series(1,12000) g",[owner]);
        const scaleBefore=(await upgrade.query("SELECT count(*)::int n,md5(string_agg((to_jsonb(n)-'search_vector')::text,'' ORDER BY id)) digest FROM notes n WHERE wiki_space_id IS NULL")).rows[0];
        const bytesBefore=(await upgrade.query("SELECT pg_total_relation_size('notes')::text bytes")).rows[0].bytes;
        const revisionsBefore = (await upgrade.query("SELECT * FROM note_revisions ORDER BY scope_kind,scope_id")).rows;
        const sequenceBefore = (await upgrade.query("SELECT last_value,is_called FROM board_revision_seq")).rows;
        const triggerBefore = (await upgrade.query("SELECT tgenabled,pg_get_triggerdef(oid) definition FROM pg_trigger WHERE tgrelid='notes'::regclass AND tgname='note_revision_update'")).rows;
        const started = performance.now();
        await initializeSchema({ pool: upgrade, baseline: applyFrozenBaseline, seed: async () => {} });
        const durationMs = performance.now() - started;
        assert.deepEqual((await upgrade.query("SELECT * FROM note_revisions ORDER BY scope_kind,scope_id")).rows, revisionsBefore, "format conversion is not a user edit");
        assert.deepEqual((await upgrade.query("SELECT last_value,is_called FROM board_revision_seq")).rows, sequenceBefore, "format conversion preserves the revision sequence");
        assert.deepEqual((await upgrade.query("SELECT tgenabled,pg_get_triggerdef(oid) definition FROM pg_trigger WHERE tgrelid='notes'::regclass AND tgname='note_revision_update'")).rows, triggerBefore);
        assert.deepEqual((await upgrade.query("SELECT to_jsonb(n)-'search_vector'-'content_format_version' value FROM notes n WHERE id=ANY($1::uuid[]) ORDER BY id",[ids])).rows, before);
        assert.deepEqual((await upgrade.query("SELECT count(*)::int n,md5(string_agg((to_jsonb(n)-'search_vector')::text,'' ORDER BY id)) digest FROM notes n WHERE wiki_space_id IS NULL")).rows[0],scaleBefore);
        assert.deepEqual((await upgrade.query("SELECT to_jsonb(v)-'content_format_version' value FROM note_versions v ORDER BY id")).rows, history);
        for (const [i, id] of ids.entries()) assert.equal((await upgrade.query("SELECT content_format_version FROM notes WHERE id=$1", [id])).rows[0].content_format_version, [1, 2, 1, 3, 2][i]);
        const audit = (await upgrade.query("SELECT id,content_format_version FROM notes WHERE wiki_space_id IS NOT NULL AND (content_format_version NOT IN (1,2) OR (content_format_version=1 AND jsonb_path_exists(content_json,'$.** ? (@.type == \"pageMention\")'))) ORDER BY id")).rows;
        assert.equal(audit.length, 2);
        console.log(JSON.stringify({ migrationFrom: "0009", migrationTo: "0012", durationMs, relationBytesBefore:bytesBefore,relationBytesAfter:(await upgrade.query("SELECT pg_total_relation_size('notes')::text bytes")).rows[0].bytes,exceptionalSyntheticRows: audit, preservedOrdinaryRows: scaleBefore.n, preservedHistoryRows: history.length }));
        await initializeSchema({ pool: upgrade, baseline: applyFrozenBaseline, seed: async () => {} });
        await upgrade.query("UPDATE notes SET title='Real edit after conversion' WHERE id=$1", [ids[1]]);
        assert.notDeepEqual((await upgrade.query("SELECT last_value,is_called FROM board_revision_seq")).rows, sequenceBefore, "normal writes still publish revisions after migration");
      } finally { await upgrade.end(); await pool.query(`DROP DATABASE ${name} WITH (FORCE)`); await rm(directory, { recursive: true, force: true }); }
    });
  } finally { await f.cleanup(); }
});
