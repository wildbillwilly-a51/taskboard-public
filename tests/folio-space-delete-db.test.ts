import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import test from "node:test";
import { getPool } from "../src/lib/db";
import { createNotebook, createNote, createNoteInTransaction, deleteNotebook, getNote, updateNote, updateNoteInTransaction, updateNotebook, uploadNoteAttachments, getNoteAttachmentDownload, getNoteAttachmentDiskPath, NotesNotFoundError } from "../src/lib/notes-store";
import { browseFolioTasks, changeFolioConnection, createFolioNote, createFolioSpace, getFolioLibrary, getFolioSpacePage, manageFolioSpace } from "../src/lib/folio-store";
import { WikiRuleError } from "../src/lib/notes-errors";
import type { Actor } from "../src/lib/notes-store-context";
import { isLocalVisualDatabase } from "./helpers/visual-database";

test("deleting legacy and Folio spaces preserves documents, privacy and promoted children", {skip:process.env.FOLIO_DB_TEST!=="1",timeout:60_000}, async()=>{
  assert.ok(isLocalVisualDatabase(new URL(process.env.DATABASE_URL!)));
  const pool=getPool()!;
  const actor=(role:"standard"|"admin"):Actor=>{const id=randomUUID();return{id,email:`${id}@example.invalid`,displayName:id,role,authMode:"authelia",authProvider:"authelia"};};
  const owner=actor("standard"),admin=actor("admin"),ids=[owner.id,admin.id],shared:string[]=[],stored:string[]=[];
  try {
    for(const u of [owner,admin])await pool.query("INSERT INTO users(id,email,display_name,role) VALUES($1,$2,$3,$4)",[u.id,u.email,u.displayName,u.role]);
    const oldParent=await createNotebook(owner,{title:"Original parent"}),destination=await createNotebook(owner,{title:"Current parent"});
    const folder=await createNotebook(owner,{title:"Delete this notebook",parentNotebookId:oldParent.id});
    const child=await createNotebook(owner,{title:"Keep child",parentNotebookId:folder.id});
    const grandchild=await createNotebook(owner,{title:"Keep grandchild",parentNotebookId:child.id});
    const legacy=await createNote(owner,{title:"Keep original note",notebookId:folder.id,content:{blocks:[{type:"paragraph",content:[{type:"text",text:"Original private content"}]}],markdown:"Original private content",text:"Original private content"}});
    const bytes=Buffer.from("private space deletion fixture");
    const files=await uploadNoteAttachments(owner,legacy.id,[{originalName:"private-fixture.txt",mimeType:"text/plain",sizeBytes:bytes.length,buffer:bytes}]);
    stored.push(...(await pool.query("SELECT stored_name FROM note_attachments WHERE note_id=$1",[legacy.id])).rows.map((r:{stored_name:string})=>r.stored_name));
    const library=await getFolioLibrary(owner),target=library.spaces.find(s=>s.legacyNotebookId===folder.id)!,childSpace=library.spaces.find(s=>s.legacyNotebookId===child.id)!,destinationSpace=library.spaces.find(s=>s.legacyNotebookId===destination.id)!;
    assert.equal(target.canManage,false);assert.equal(target.canDelete,true);
    assert.equal(library.spaces.find(s=>s.id===library.rootSpaceId)?.canDelete,false);
    const folioChild=await createFolioSpace(owner,{title:"Folio child",parentId:target.id,personal:true});
    const connected=await createFolioNote(owner);await changeFolioConnection(owner,connected.id,folioChild.id,true);
    const onlyParent=await createFolioNote(owner);await changeFolioConnection(owner,onlyParent.id,target.id,true);
    const page=await getFolioSpacePage(owner,target.id);
    await assert.rejects(manageFolioSpace(admin,target.id,{remove:true}),e=>e instanceof NotesNotFoundError);
    await assert.rejects(manageFolioSpace(owner,library.rootSpaceId,{remove:true}),/permanent/);
    await assert.rejects(manageFolioSpace(owner,target.id,{title:"Forbidden rename"}),/inherited notebook/);
    // Deliberately leave the compatibility projection stale after a Notes move.
    await updateNotebook(owner,folder.id,{parentNotebookId:destination.id});
    assert.notEqual((await pool.query("SELECT parent_id FROM folio_spaces WHERE id=$1",[target.id])).rows[0].parent_id,destinationSpace.id);
    await manageFolioSpace(owner,target.id,{remove:true});
    const refreshed=await getFolioLibrary(owner);
    assert.equal(refreshed.spaces.some(s=>s.id===target.id),false,"deleted notebook must not resurrect on browse");
    assert.equal(refreshed.spaces.find(s=>s.id===childSpace.id)?.parentId,destinationSpace.id);
    assert.equal(refreshed.spaces.find(s=>s.id===folioChild.id)?.parentId,destinationSpace.id);
    assert.equal((await pool.query("SELECT parent_notebook_id FROM note_notebooks WHERE id=$1",[child.id])).rows[0].parent_notebook_id,destination.id);
    assert.equal((await pool.query("SELECT parent_notebook_id FROM note_notebooks WHERE id=$1",[grandchild.id])).rows[0].parent_notebook_id,child.id);
    const kept=await getNote(owner,legacy.id);assert.equal(kept.contentMarkdown,legacy.contentMarkdown);assert.equal(kept.ownerUserId,owner.id);assert.equal(kept.notebookId,destination.id);
    assert.deepEqual((await getNoteAttachmentDownload(owner,legacy.id,files[0].id)).content,bytes);
    await assert.rejects(getNote(admin,legacy.id),e=>e instanceof NotesNotFoundError);
    await assert.rejects(getNoteAttachmentDownload(admin,legacy.id,files[0].id),e=>e instanceof NotesNotFoundError);
    assert.equal((await getNote(owner,connected.id)).folio?.connections[0].id,folioChild.id);
    assert.equal((await getNote(admin,onlyParent.id)).folio?.unconnected,true);
    await assert.rejects(getNote(owner,page.id),e=>e instanceof NotesNotFoundError);

    const parent=await createFolioSpace(owner,{title:"Shared parent",parentId:null,personal:false});shared.push(parent.id);
    const sharedChild=await createFolioSpace(owner,{title:"Shared child",parentId:parent.id,personal:false});shared.push(sharedChild.id);
    const other=await createFolioSpace(owner,{title:"Other placement",parentId:null,personal:false});shared.push(other.id);
    const document=await createFolioNote(owner);await changeFolioConnection(owner,document.id,parent.id,true);await changeFolioConnection(owner,document.id,other.id,true);
    await manageFolioSpace(admin,parent.id,{remove:true});
    assert.deepEqual((await getNote(owner,document.id)).folio?.connections.map(s=>s.id),[other.id]);
    assert.equal((await getFolioLibrary(owner)).spaces.find(s=>s.id===sharedChild.id)?.parentId,null);
    await manageFolioSpace(owner,other.id,{archived:true});
    const archived=(await getFolioLibrary(owner)).spaces.find(s=>s.id===other.id)!;assert.equal(archived.canManage,false);assert.equal(archived.canDelete,true);
    await manageFolioSpace(owner,other.id,{remove:true});assert.equal((await getNote(owner,document.id)).folio?.unconnected,true);

    const board=randomUUID(),task=randomUUID();await pool.query("INSERT INTO boards(id,title,board_type,owner_user_id) VALUES($1,'Protected board','personal',$2)",[board,owner.id]);await pool.query("INSERT INTO tasks(id,board_id,title,status,sort_order) VALUES($1,$2,'Protected task','todo',1)",[task,board]);
    const tasks=await browseFolioTasks(owner,board),boardSpace=(await getFolioLibrary(owner)).spaces.find(s=>s.kind==='board'&&s.boardId===board)!;
    for(const s of [boardSpace,tasks.spaces[0]]){assert.equal(s.canDelete,false);await assert.rejects(manageFolioSpace(owner,s.id,{remove:true}),/Manage this task or board/);}

    // Emulate an older Notes delete winning while Folio waits for the source row.
    const raceNotebook=await createNotebook(owner,{title:"Concurrent notebook"});
    const raceNote=await createNote(owner,{title:"Race note survives",notebookId:raceNotebook.id});
    const raceSpace=(await getFolioLibrary(owner)).spaces.find(s=>s.legacyNotebookId===raceNotebook.id)!;
    const blocker=await pool.connect();
    try {
      await blocker.query("BEGIN");await blocker.query("SELECT id FROM note_notebooks WHERE id=$1 FOR UPDATE",[raceNotebook.id]);
      const deletion=manageFolioSpace(owner,raceSpace.id,{remove:true}).then(()=>null,e=>e);
      let waiting=false;for(let n=0;n<250;n++){
        waiting=Boolean((await pool.query("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE '%FOR NO KEY UPDATE%') AS waiting")).rows[0].waiting);
        if(waiting)break;await new Promise(r=>setTimeout(r,20));
      }
      assert.ok(waiting,"Folio reached the guarded source-row lock");
      await blocker.query("UPDATE notes SET notebook_id=NULL WHERE notebook_id=$1",[raceNotebook.id]);await blocker.query("DELETE FROM note_notebooks WHERE id=$1",[raceNotebook.id]);await blocker.query("COMMIT");
      const conflict=await deletion;assert.ok(conflict instanceof WikiRuleError&&conflict.status===409&&conflict.code==='folio_space_changed');
      assert.equal((await getNote(owner,raceNote.id)).notebookId,null);await assert.rejects(getNote(admin,raceNote.id),e=>e instanceof NotesNotFoundError);
      assert.equal((await getFolioLibrary(owner)).spaces.find(s=>s.id===raceSpace.id)?.legacyNotebookId,null);
      await manageFolioSpace(owner,raceSpace.id,{remove:true});assert.equal((await getFolioLibrary(owner)).spaces.some(s=>s.id===raceSpace.id),false);
    } finally {await blocker.query("ROLLBACK");blocker.release();}

    const waitForBlocked = async (holder:number,minimum=1) => {
      for(let n=0;n<250;n++){
        const rows=(await pool.query("SELECT pid FROM pg_stat_activity WHERE $1=ANY(pg_blocking_pids(pid))",[holder])).rows;
        if(rows.length>=minimum)return rows[0].pid as number;
        await new Promise(r=>setTimeout(r,20));
      }
      throw new Error("Expected membership/deletion lock did not occur");
    };
    for(const folio of [true,false]) {
      const notebook=await createNotebook(owner,{title:`Late join ${folio}`,parentNotebookId:destination.id});
      const existing=await createNote(owner,{title:`Existing ${folio}`,notebookId:notebook.id});
      const mover=await createNote(owner,{title:`Mover ${folio}`,notebookId:oldParent.id});
      const space=(await getFolioLibrary(owner)).spaces.find(s=>s.legacyNotebookId===notebook.id)!;
      const spacePage=await getFolioSpacePage(owner,space.id),holder=await pool.connect();
      try {
        await holder.query("BEGIN");const holderPid=(await holder.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
        await holder.query("SELECT id FROM notes WHERE id=$1 FOR UPDATE",[folio?spacePage.id:existing.id]);
        const removing=(folio?manageFolioSpace(owner,space.id,{remove:true}):deleteNotebook(owner,notebook.id)).then(()=>null,e=>e);
        const removerPid=await waitForBlocked(holderPid);
        const lateTitle=`Late create ${randomUUID()}`;
        const creating=createNote(owner,{title:lateTitle,notebookId:notebook.id}).then(()=>null,e=>e);
        const moving=updateNote(owner,mover.id,{notebookId:notebook.id}).then(()=>null,e=>e);
        await waitForBlocked(removerPid,2);
        assert.equal((await pool.query("SELECT count(*)::int AS count FROM notes WHERE title=$1",[lateTitle])).rows[0].count,0);
        assert.equal((await pool.query("SELECT notebook_id FROM notes WHERE id=$1",[mover.id])).rows[0].notebook_id,oldParent.id);
        await holder.query("COMMIT");
        const [removeError,createError,moveError]=await Promise.all([removing,creating,moving]);
        assert.equal(removeError,null);assert.ok(createError instanceof NotesNotFoundError);assert.ok(moveError instanceof NotesNotFoundError);
        assert.equal((await getNote(owner,existing.id)).notebookId,destination.id);
        assert.equal((await getNote(owner,mover.id)).notebookId,oldParent.id);
      } finally {await holder.query("ROLLBACK");holder.release();}
    }
    // A membership operation which wins first is included in reparenting.
    const notebook=await createNotebook(owner,{title:"Membership wins",parentNotebookId:destination.id});
    const space=(await getFolioLibrary(owner)).spaces.find(s=>s.legacyNotebookId===notebook.id)!;
    const mover=await createNote(owner,{title:"Winning mover",notebookId:oldParent.id}),creator=await pool.connect();
    try {
      await creator.query("BEGIN");const holderPid=(await creator.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
      const created=await createNoteInTransaction(creator,owner,{title:"Winning new note",notebookId:notebook.id});
      await updateNoteInTransaction(creator,owner,mover.id,{notebookId:notebook.id});
      const removing=manageFolioSpace(owner,space.id,{remove:true}).then(()=>null,e=>e);
      await waitForBlocked(holderPid);await creator.query("COMMIT");assert.equal(await removing,null);
      for(const noteId of [created.id,mover.id])assert.equal((await getNote(owner,noteId)).notebookId,destination.id);
    } finally {await creator.query("ROLLBACK");creator.release();}
  } finally {
    for(const name of stored)await unlink(getNoteAttachmentDiskPath(name)).catch(e=>{if(e.code!=="ENOENT")throw e;});
    await pool.query("DELETE FROM folio_spaces WHERE owner_user_id=ANY($1::uuid[]) OR created_by_user_id=ANY($1::uuid[]) OR id=ANY($2::uuid[])",[ids,shared]);
    await pool.query("DELETE FROM notes WHERE owner_user_id=ANY($1::uuid[])",[ids]);await pool.query("DELETE FROM note_notebooks WHERE owner_user_id=ANY($1::uuid[])",[ids]);await pool.query("DELETE FROM boards WHERE owner_user_id=ANY($1::uuid[])",[ids]);await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])",[ids]);await pool.end();
  }
});
