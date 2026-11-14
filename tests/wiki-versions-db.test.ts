import assert from "node:assert/strict";
import test from "node:test";
import { fixture, enabled, content, code } from "./helpers/wiki-db";
import { createWikiSpace,createWikiPage,listWikiVersions,getWikiVersion,restoreWikiVersion } from "@/lib/wiki-store";
import { updateNote,getNote,createNote } from "@/lib/notes-store";
import { NoteConflictError } from "@/lib/notes-errors";
import { snapshotWikiNote } from "@/lib/notes-content-store";

test("full snapshots, coalescing, authors, restore conflicts, server text and link rebuild",{skip:!enabled},async()=>{
  const f=await fixture(),{pool,users:u,board}=f;
  try {
    const space=await createWikiSpace(u.owner,{boardId:board,title:"History"});
    const p=await createWikiPage(u.editor,space.id),target=await createWikiPage(u.owner,space.id,{title:"Target"});
    let versions=(await listWikiVersions(u.viewer,p.id)).versions;assert.equal(versions.length,1);assert.equal(versions[0].kind,"start");
    const start=versions[0].id;
    const saved=await updateNote(u.editor,p.id,{title:"First",content:{...content("Actual searchable text"),text:"FORGED",blocks:[...content("Actual searchable text").blocks,{type:"paragraph",content:[{type:"link",href:`/wiki/history/${target.id}-wrong`,content:[{type:"text",text:"linked"}]}]}]},expectedVersion:1});
    assert.match((await pool.query("SELECT content_text FROM notes WHERE id=$1",[p.id])).rows[0].content_text,/Actual searchable/);
    assert.doesNotMatch((await pool.query("SELECT content_text FROM notes WHERE id=$1",[p.id])).rows[0].content_text,/FORGED/);
    assert.equal((await pool.query("SELECT target_note_id FROM note_links WHERE source_note_id=$1",[p.id])).rows[0].target_note_id,target.id);
    await updateNote(u.editor,p.id,{title:"Title only",expectedVersion:saved.contentVersion});
    versions=(await listWikiVersions(u.viewer,p.id)).versions;assert.equal(versions.length,2);
    assert.match((await getWikiVersion(u.viewer,p.id,versions[0].id)).contentMarkdown,/Actual/);
    assert.equal((await getWikiVersion(u.viewer,p.id,start)).title,"");
    await updateNote(u.owner,p.id,{title:"Second author",expectedVersion:3});
    assert.equal((await listWikiVersions(u.viewer,p.id)).versions.length,3);
    const snapshot=await getWikiVersion(u.owner,p.id,start);
    await assert.rejects(restoreWikiVersion(u.owner,p.id,start,{expectedVersion:1}),NoteConflictError);
    assert.equal((await getNote(u.owner,p.id)).contentVersion,4);
    const restored=await restoreWikiVersion(u.owner,p.id,start,{expectedVersion:4});
    assert.equal(restored.contentVersion,5);assert.equal(restored.title,snapshot.title);
    assert.equal((await listWikiVersions(u.viewer,p.id)).versions[0].kind,"restore");
    assert.equal((await pool.query("SELECT 1 FROM note_links WHERE source_note_id=$1",[p.id])).rowCount,0);
    await assert.rejects(getWikiVersion(u.viewer,target.id,start),code("wiki_not_found"));
    const client=await pool.connect();try {
      await client.query("BEGIN");await client.query("SELECT id FROM notes WHERE id=$1 FOR NO KEY UPDATE",[p.id]);
      await snapshotWikiNote(client,u.owner,p.id,"import");await client.query("COMMIT");
    } finally{client.release();}
    assert.equal((await listWikiVersions(u.viewer,p.id)).versions[0].kind,"import");
    await pool.query("UPDATE notes SET content_format_version=3 WHERE id=$1",[p.id]);
    await assert.rejects(updateNote(u.owner,p.id,{title:"No loss",expectedVersion:5}),code("wiki_format_unsupported"));
    assert.equal((await getNote(u.owner,p.id)).title,"");
    await pool.query("UPDATE notes SET content_format_version=2 WHERE id=$1",[p.id]);
    const ordinary=await createNote(u.owner,{content:content("Ordinary")});
    await updateNote(u.owner,ordinary.id,{pinned:true});await updateNote(u.owner,ordinary.id,{title:"Ordinary",expectedVersion:1});
    assert.equal((await pool.query("SELECT 1 FROM note_versions WHERE note_id=$1",[ordinary.id])).rowCount,0);
    assert.equal((await getNote(u.owner,ordinary.id)).contentVersion,2);
  } finally {await f.cleanup();}
});
