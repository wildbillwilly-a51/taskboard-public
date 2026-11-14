import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { mkdtemp,writeFile,rm } from "node:fs/promises";
import path from "node:path";

import { Pool } from "pg";
import { fixture,enabled,content } from "./helpers/wiki-db";
import { initializeSchema,loadRecordedMigrations,readSchemaStatus } from "@/lib/schema-migrations";
import { applyFrozenBaseline } from "@/lib/schema-baseline";
import { createWikiSpace,createWikiPage,updateWikiSpace,removeWikiSpace,promoteNoteToWiki } from "@/lib/wiki-store";
import { createNote,updateNote,trashNote,listNotes,uploadNoteAttachments,getNoteAttachmentDiskPath } from "@/lib/notes-store";
import { access } from "node:fs/promises";
import { visualDatabaseName } from "./helpers/visual-database";

test("populated Phase 0 upgrades without changing notes/files/old trigger identities; direct SQL and live scope invariants",{skip:!enabled,timeout:60000},async()=>{
  const f=await fixture(),{pool,users:u,board,board2,personal}=f;
  const name=`${visualDatabaseName()}_upgrade_${randomUUID().slice(0,8)}`,url=new URL(process.env.DATABASE_URL!);url.pathname=`/${name}`;
  const directory=await mkdtemp(path.join((process.env.WIKI_P2_SANDBOX_ROOT ?? process.cwd()),"tb-wiki-p1-migrations-"));let upgrade:Pool|undefined;
  try {
    await pool.query(`CREATE DATABASE ${name}`);upgrade=new Pool({connectionString:url.toString(),max:2});
    const migrations=await loadRecordedMigrations();
    for(const migration of migrations.filter(m=>m.id.slice(0,4)<="0006"))await writeFile(path.join(directory,`${migration.id}.sql`),migration.sql);
    await initializeSchema({pool:upgrade,directory,baseline:applyFrozenBaseline,seed:async()=>{}});
    const owner=randomUUID(),b=randomUUID(),n=randomUUID(),file=randomUUID();
    await upgrade.query("INSERT INTO users(id,email,display_name) VALUES($1,'upgrade@example.invalid','Upgrade');",[owner]);
    await upgrade.query("INSERT INTO boards(id,owner_user_id,title) VALUES($1,$2,'Upgrade')",[b,owner]);
    await upgrade.query("INSERT INTO notes(id,owner_user_id,board_id,title,content_json) VALUES($1,$2,$3,'Keep','[]')",[n,owner,b]);
    await upgrade.query("INSERT INTO note_attachments(id,note_id,original_name,stored_name,mime_type,size_bytes) VALUES($1,$2,'Keep.txt',$3,'text/plain',5)",[file,n,`${n}/${file}`]);
    const triggers=(await upgrade.query("SELECT oid,tgname,tgrelid FROM pg_trigger WHERE NOT tgisinternal ORDER BY oid")).rows;
    const before=(await upgrade.query("SELECT id,title,content_json,content_version FROM notes WHERE id=$1",[n])).rows;
    // Two initializers race on the real shipped tail and converge.
    const other=new Pool({connectionString:url.toString(),max:1});
    try {await Promise.all([initializeSchema({pool:upgrade,baseline:async()=>assert.fail("must adopt"),seed:async()=>{}}),initializeSchema({pool:other,baseline:async()=>assert.fail("must adopt"),seed:async()=>{}})]);}finally{await other.end();}
    assert.deepEqual((await upgrade.query("SELECT id,title,content_json,content_version FROM notes WHERE id=$1",[n])).rows,before);
    assert.equal((await upgrade.query("SELECT removed_at FROM note_attachments WHERE id=$1",[file])).rows[0].removed_at,null);
    assert.equal((await upgrade.query("SELECT count(*)::int n FROM note_versions")).rows[0].n,0);
    assert.deepEqual((await upgrade.query("SELECT oid,tgname,tgrelid FROM pg_trigger WHERE NOT tgisinternal AND tgrelid<>'wiki_spaces'::regclass AND tgname<>'wiki_board_delete_restrict' ORDER BY oid")).rows,triggers);
    assert.equal((await readSchemaStatus(upgrade)).schemaReady, true);
    await initializeSchema({pool:upgrade,baseline:applyFrozenBaseline,seed:async()=>{}});
    const s=await createWikiSpace(u.owner,{boardId:board,title:"Integrity"});const p=await createWikiPage(u.editor,s.id,{content:content("Keep")});
    const bucket=(await pool.query("INSERT INTO buckets(id,board_id,title,sort_order) VALUES(gen_random_uuid(),$1,'Bucket',1000) RETURNING id",[board])).rows[0].id;
    await assert.rejects(pool.query("UPDATE notes SET board_id=$2 WHERE id=$1",[p.id,board2]),{code:"23503"});
    await assert.rejects(pool.query("UPDATE notes SET bucket_id=$2 WHERE id=$1",[p.id,bucket]),{code:"23514"});
    await assert.rejects(pool.query("DELETE FROM users WHERE id=$1",[u.editor.id]),{code:"23503"});
    const ordinary=await createNote(u.editor,{boardId:board,title:"Fallback"});
    await assert.rejects(pool.query("DELETE FROM boards WHERE id=$1",[board]),{code:"23503"});
    assert.equal((await pool.query("SELECT board_id FROM notes WHERE id=$1",[ordinary.id])).rows[0].board_id,board,"whole board delete rolls back fallback");
    const boardToken=(await pool.query("SELECT revision FROM board_revisions WHERE board_id=$1",[board])).rows[0].revision;
    const token=async()=> (await pool.query("SELECT revision FROM note_revisions WHERE scope_kind='board' AND scope_id=$1",[board])).rows[0].revision;
    let notesToken=await token();await updateNote(u.editor,p.id,{title:"New",expectedVersion:1});
    assert.notEqual(await token(),notesToken);assert.equal((await pool.query("SELECT revision FROM board_revisions WHERE board_id=$1",[board])).rows[0].revision,boardToken);
    notesToken=await token();await updateWikiSpace(u.owner,s.id,{description:"New description"});assert.notEqual(await token(),notesToken);
    const legacy = await createNote(u.owner, {boardId: personal});
    const [a] = await uploadNoteAttachments(u.owner, legacy.id, [{originalName: "receipt.txt", mimeType: "text/plain", sizeBytes: 5, buffer: Buffer.from("proof")}]);
    await updateNote(u.owner, legacy.id, {home: {boardId: board}});
    await promoteNoteToWiki(u.owner, legacy.id, {spaceId: s.id, expectedVersion: 1});
    const stored=(await pool.query("SELECT stored_name FROM note_attachments WHERE id=$1",[a.id])).rows[0].stored_name;
    await trashNote(u.editor,legacy.id);await pool.query("UPDATE notes SET purge_after_at=NOW()-INTERVAL '1 day' WHERE id=$1",[legacy.id]);
    await updateWikiSpace(u.owner,s.id,{archived:true});
    await listNotes(u.viewer,{scope:"all",status:"trash",limit:100,offset:0});
    assert.equal((await pool.query("SELECT 1 FROM notes WHERE id=$1",[legacy.id])).rowCount,0);await assert.rejects(access(getNoteAttachmentDiskPath(stored)));
    await updateWikiSpace(u.owner,s.id,{archived:false});await pool.query("DELETE FROM notes WHERE wiki_space_id=$1",[s.id]);
    notesToken=await token();await removeWikiSpace(u.owner,s.id);assert.notEqual(await token(),notesToken);
  }finally{
    // Both owning pools have ended. Let PostgreSQL wait for their socket close
    // rather than sending administrative termination errors during teardown.
    await upgrade?.end();await pool.query(`DROP DATABASE IF EXISTS ${name}`);
    assert.ok(path.resolve(directory).startsWith(path.resolve((process.env.WIKI_P2_SANDBOX_ROOT ?? process.cwd()))+path.sep));await rm(directory,{recursive:true,force:true});await f.cleanup();
  }
});
