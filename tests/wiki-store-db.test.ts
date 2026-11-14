import assert from "node:assert/strict";
import test from "node:test";
import { fixture, enabled, content, code } from "./helpers/wiki-db";
import { createWikiSpace,createWikiPage,listWikiSpaces,getWikiSpace,getWikiPage,listWikiPages,updateWikiSpace,removeWikiSpace,promoteNoteToWiki,moveWikiPage } from "@/lib/wiki-store";
import { createNote,updateNote,trashNote,restoreNote,deleteNotePermanently,withOwnedBoardNotes, getNote,
  uploadNoteAttachments,deleteNoteAttachment,linkNoteToTask,unlinkNoteFromTask,convertNoteToTask,updateNoteInTransaction } from "@/lib/notes-store";
import { NoteConflictError } from "@/lib/notes-errors";

test("wiki permissions, home transitions, archived Notes cores and team-only boundary",{skip:!enabled},async()=>{
  const f=await fixture(),{pool,users:u,board,board2,personal}=f;
  const lifecycle=process.env.TASKBOARD_TEAM_LIFECYCLE_MANAGERS;
  process.env.TASKBOARD_TEAM_LIFECYCLE_MANAGERS="enabled";
  try {
    for(const who of [u.owner,u.admin])await assert.rejects(createWikiSpace(who,{boardId:personal,title:"No"}),code("wiki_team_board_required"));
    const s=await createWikiSpace(u.owner,{boardId:board,title:"Run book"}),s2=await createWikiSpace(u.manager,{boardId:board2,title:"Run book"});
    assert.equal(s2.slug,"run-book-2");
    await assert.rejects(createWikiSpace(u.owner,{boardId:board,title:"Duplicate"}),code("wiki_space_exists"));
    assert.equal((await getWikiSpace(u.viewer,{slug:s.slug})).id,s.id);
    assert.equal((await listWikiSpaces(u.outsider)).length,0);
    await assert.rejects(getWikiSpace(u.outsider,{spaceId:s.id}),code("wiki_not_found"));
    await assert.rejects(createWikiPage(u.viewer,s.id),code("wiki_read_only"));
    const p=await createWikiPage(u.editor,s.id,{title:"Find me",content:content("Needle")});
    const routePage=await createWikiPage(u.editor,s2.id);
    const routeSaved=await updateNote(u.editor,routePage.id,{
      title:"Route autosave",content:undefined,expectedVersion:1,pinned:undefined,
      archived:undefined,notebookId:undefined,labels:undefined,home:undefined,
    });
    assert.equal(routeSaved.contentVersion,2);assert.equal(routeSaved.title,"Route autosave");
    await assert.rejects(updateNote(u.editor,routePage.id,{title:"Forged",expectedVersion:2,origin:"https://foreign.test"} as never),code("invalid_wiki_request"));
    await assert.rejects(promoteNoteToWiki(u.editor,p.id,null as never),code("invalid_wiki_request"));
    await assert.rejects(moveWikiPage(u.editor,p.id,null as never),code("invalid_wiki_request"));
    assert.equal(p.ownerUserId,u.editor.id);assert.equal(p.wiki.canManage,false);assert.equal(p.contentVersion,1);
    assert.equal((await getWikiPage(u.admin,p.id)).wiki.canManage,true);
    await assert.rejects(getWikiPage(u.disabled,p.id));
    await assert.rejects(getWikiPage(u.outsider,p.id));
    const before=await getNote(u.editor,p.id);
    for(const input of [{home:null},{notebookId:null},{home:{boardId:null},title:"forbidden",expectedVersion:1}])
      await assert.rejects(updateNote(u.editor,p.id,input),code("wiki_home_change_forbidden"));
    assert.equal((await getNote(u.editor,p.id)).contentVersion,before.contentVersion);
    for(const who of [u.viewer,u.editor])await assert.rejects(updateWikiSpace(who,s.id,{title:"No"}),code("wiki_read_only"));
    await updateWikiSpace(u.owner,s.id,{homeNoteId:p.id});
    await updateWikiSpace(u.owner,s.id,{title:"Renamed",description:undefined,archived:undefined,homeNoteId:undefined});
    assert.equal((await getWikiSpace(u.viewer,{spaceId:s.id})).homeNoteId,p.id,"adapter's absent optional fields do not clear home");
    await moveWikiPage(u.editor,p.id,{spaceId:s.id,sourceSpaceId:s.id,expectedVersion:1});
    assert.equal((await getWikiSpace(u.viewer,{spaceId:s.id})).homeNoteId,p.id,"same-space move preserves home");
    await assert.rejects(removeWikiSpace(u.owner,s.id),code("wiki_space_not_empty"));
    await assert.rejects(moveWikiPage(u.editor,p.id,{spaceId:s2.id,sourceSpaceId:s.id,expectedVersion:9}),NoteConflictError);
    const moved=await moveWikiPage(u.editor,p.id,{spaceId:s2.id,sourceSpaceId:s.id,expectedVersion:1});
    assert.equal(moved.ownerUserId,p.ownerUserId);assert.equal(moved.contentVersion,1);assert.equal(moved.wiki.spaceId,s2.id);
    assert.equal((await getWikiSpace(u.viewer,{spaceId:s.id})).homeNoteId,null);
    await assert.rejects(moveWikiPage(u.editor,p.id,{spaceId:s.id,sourceSpaceId:s.id,expectedVersion:1}),code("wiki_home_conflict"));
    const n=await createNote(u.editor,{boardId:board,title:"Promote",content:content("Stored")});
    const promoted=await promoteNoteToWiki(u.editor,n.id,{spaceId:s.id,expectedVersion:1});assert.equal(promoted.contentVersion,2);
    await assert.rejects(withOwnedBoardNotes(personal,u.owner.id,()=>getNote(u.owner,n.id)));
    assert.equal((await listWikiPages(u.viewer,{q:"Stored",limit:1})).pages[0].id,n.id);
    await updateWikiSpace(u.owner,s.id,{homeNoteId:n.id});await trashNote(u.editor,n.id);
    await assert.rejects(updateWikiSpace(u.owner,s.id,{homeNoteId:n.id}),code("invalid_wiki_request"));
    assert.equal((await getWikiSpace(u.viewer,{spaceId:s.id})).homeNoteId,null);
    await assert.rejects(deleteNotePermanently(u.editor,n.id),code("wiki_read_only"));
    await restoreNote(u.editor,n.id);assert.equal((await getWikiSpace(u.viewer,{spaceId:s.id})).homeNoteId,null);
    await updateWikiSpace(u.owner,s.id,{archived:true});
    assert.equal((await getNote(u.editor,n.id)).canEdit,false);
    assert.equal((await listWikiSpaces(u.viewer)).some(x=>x.id===s.id),false);
    const attachment={originalName:"x.txt",mimeType:"text/plain",buffer:Buffer.from("x"),sizeBytes:1};
    const writes=[()=>updateNote(u.editor,n.id,{title:"No",expectedVersion:2}),()=>trashNote(u.editor,n.id),()=>uploadNoteAttachments(u.owner,n.id,[attachment]),
      ()=>deleteNoteAttachment(u.owner,n.id,n.id),()=>linkNoteToTask(u.owner,n.id,n.id),()=>unlinkNoteFromTask(u.owner,n.id,n.id),()=>convertNoteToTask(u.owner,n.id,{} as never)];
    for(const write of writes)await assert.rejects(write(),code("wiki_read_only"));
    const client=await pool.connect();try{await client.query("BEGIN");await assert.rejects(updateNoteInTransaction(client,u.owner,n.id,{pinned:true}),code("wiki_read_only"));await client.query("ROLLBACK");}finally{client.release();}
    await assert.rejects(updateWikiSpace(u.owner,s.id,{archived:false,title:"mixed"}),code("wiki_read_only"));
    await updateWikiSpace(u.owner,s.id,{title:undefined,description:undefined,archived:false,homeNoteId:undefined});await trashNote(u.editor,n.id);
    await updateWikiSpace(u.owner,s.id,{archived:true});
    await assert.rejects(restoreNote(u.owner,n.id),code("wiki_read_only"));await assert.rejects(deleteNotePermanently(u.owner,n.id),code("wiki_read_only"));
    await updateWikiSpace(u.owner,s.id,{archived:false});await deleteNotePermanently(u.owner,n.id);await removeWikiSpace(u.owner,s.id);
  } finally {
    if(lifecycle===undefined)delete process.env.TASKBOARD_TEAM_LIFECYCLE_MANAGERS;else process.env.TASKBOARD_TEAM_LIFECYCLE_MANAGERS=lifecycle;
    await f.cleanup();
  }
});
