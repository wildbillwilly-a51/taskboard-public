import assert from "node:assert/strict";
import test from "node:test";
import { Pool } from "pg";
import { fixture,enabled,code,content } from "./helpers/wiki-db";
import { transaction,waitUntilBlocked } from "./helpers/wiki-concurrency-worker";
import { requireNote } from "@/lib/notes-store-access";
import { createWikiSpace,createWikiPage,updateWikiSpace,getWikiSpace,restoreWikiVersion,listWikiVersions,copyWikiPageToPersonal,getWikiPage } from "@/lib/wiki-store";
import { updateNote,updateNoteInTransaction,trashNoteInTransaction,trashNote,getNote,uploadNoteAttachments,deleteNoteAttachment,deleteNotePermanently } from "@/lib/notes-store";
import { withTransactionOnClient,noteFileTransaction } from "@/lib/notes-store-context";
import { writeDurableAttachment } from "@/lib/taskboard-mutation-effects";
import { getNoteAttachmentDiskPath } from "@/lib/note-attachments-store";
import { rebuildNoteLinks } from "@/lib/notes-content-store";
import { randomUUID } from "node:crypto";
import { access,unlink } from "node:fs/promises";

test("controlled lock interleavings and bounded small-pool operations",{skip:!enabled,timeout:120000},async t=>{
  const f=await fixture(),{pool,users:u,board,board2}=f;
  const controls=new Pool({connectionString:process.env.DATABASE_URL,max:3});
  try {
    const s=await createWikiSpace(u.owner,{boardId:board,title:"Races"});
    const p=await createWikiPage(u.editor,s.id,{title:"A"}),b=await createWikiPage(u.editor,s.id,{title:"B"});
    await t.test("archive wins before save checks active state",async()=>{
      const holder=await controls.connect();try {
        await transaction(holder);await holder.query("UPDATE wiki_spaces SET archived_at=clock_timestamp() WHERE id=$1",[s.id]);
        const save=assert.rejects(updateNote(u.editor,p.id,{title:"Rejected",expectedVersion:1}),code("wiki_read_only"));
        await waitUntilBlocked(controls,holder,"wiki_spaces");await holder.query("COMMIT");await save;
        assert.equal((await getNote(u.viewer,p.id)).title,"A");
      }finally{await holder.query("ROLLBACK");holder.release();}
      await updateWikiSpace(u.owner,s.id,{archived:false});
    });
    await t.test("save commits before waiting archive; exclusive home change waits for trash",async()=>{
      const holder=await controls.connect();try {
        await transaction(holder);await updateNoteInTransaction(holder,u.editor,p.id,{title:"Committed first",expectedVersion:1});
        const archive=updateWikiSpace(u.owner,s.id,{archived:true});await waitUntilBlocked(controls,holder,"wiki_spaces");
        await holder.query("COMMIT");await archive;assert.equal((await getNote(u.viewer,p.id)).title,"Committed first");
      }finally{await holder.query("ROLLBACK");holder.release();}
      await updateWikiSpace(u.owner,s.id,{archived:false});
      const trashHolder=await controls.connect();try{
        await transaction(trashHolder);await trashNoteInTransaction(trashHolder,u.editor,b.id);
        const home=assert.rejects(updateWikiSpace(u.owner,s.id,{homeNoteId:b.id}));await waitUntilBlocked(controls,trashHolder,"notes");
        await trashHolder.query("COMMIT");await home;assert.equal((await getWikiSpace(u.viewer,{spaceId:s.id})).homeNoteId,null);
      }finally{await trashHolder.query("ROLLBACK");trashHolder.release();}
    });
    await t.test("removal wins against page creation",async()=>{
      const empty=await createWikiSpace(u.owner,{boardId:board2,title:"Empty"}),holder=await controls.connect();
      try{
        await transaction(holder);await holder.query("DELETE FROM wiki_spaces WHERE id=$1",[empty.id]);
        const create=assert.rejects(createWikiPage(u.editor,empty.id),code("wiki_not_found"));await waitUntilBlocked(controls,holder,"wiki_spaces");
        await holder.query("COMMIT");await create;
      }finally{await holder.query("ROLLBACK");holder.release();}
    });
    await t.test("reciprocal link saves avoid source/target deadlock; timestamp follows lock wait",async()=>{
      const other=await createWikiPage(u.editor,s.id,{title:"Other"}),a=await controls.connect(),z=await controls.connect();
      const linked=(id:string)=>({...content("Linked"),blocks:[{type:"paragraph",content:[{type:"link",href:`/notes?note=${id}`,content:[{type:"text",text:"Page"}]}]}]});
      try{
        await transaction(a);await transaction(z);
        await a.query("SELECT id FROM notes WHERE id=$1 FOR NO KEY UPDATE",[p.id]);await z.query("SELECT id FROM notes WHERE id=$1 FOR NO KEY UPDATE",[other.id]);
        await Promise.all([updateNoteInTransaction(a,u.editor,p.id,{content:linked(other.id),expectedVersion:2}),updateNoteInTransaction(z,u.editor,other.id,{content:linked(p.id),expectedVersion:1})]);
        await Promise.all([a.query("COMMIT"),z.query("COMMIT")]);
        assert.equal((await pool.query("SELECT count(*)::int n FROM note_links WHERE source_note_id=ANY($1::uuid[])",[[p.id,other.id]])).rows[0].n,2);
        await transaction(a);await a.query("SELECT id FROM notes WHERE id=$1 FOR NO KEY UPDATE",[p.id]);
        await transaction(z);await z.query("SELECT NOW()");
        await updateNoteInTransaction(a,u.editor,p.id,{title:"Before waiter",expectedVersion:3});
        const before=(await a.query("SELECT saved_at FROM note_versions WHERE note_id=$1 ORDER BY version_number DESC LIMIT 1",[p.id])).rows[0].saved_at;
        const waiting=updateNoteInTransaction(z,u.owner,p.id,{title:"After wait",expectedVersion:4});await waitUntilBlocked(controls,a,"notes");
        await a.query("COMMIT");await waiting;await z.query("COMMIT");
        const after=(await pool.query("SELECT saved_at FROM note_versions WHERE note_id=$1 ORDER BY version_number DESC LIMIT 1",[p.id])).rows[0].saved_at;
        assert.ok(after>=before);
      }finally{await a.query("ROLLBACK");await z.query("ROLLBACK");a.release();z.release();}
    });
    await t.test("saving a link can finish while target trash waits on its space",async()=>{
      const target=await createWikiPage(u.editor,s.id),a=await controls.connect(),z=await controls.connect();
      try{
        await transaction(a);await requireNote(a,u.editor,p.id,"edit",new Map(),{lock:true});
        await transaction(z);const trash=trashNoteInTransaction(z,u.editor,target.id);await waitUntilBlocked(controls,a,"wiki_spaces");
        await updateNoteInTransaction(a,u.editor,p.id,{content:{...content("Target"),blocks:[{type:"paragraph",content:[{type:"link",href:`/notes?note=${target.id}`,content:[]}]}]},expectedVersion:5});
        await a.query("COMMIT");await trash;await z.query("COMMIT");
      }finally{await a.query("ROLLBACK");await z.query("ROLLBACK");a.release();z.release();}
    });
    await t.test("restore serializes with physical file deletion",async()=>{
      const [file]=await uploadNoteAttachments(u.editor,p.id,[{originalName:"race.txt",mimeType:"text/plain",sizeBytes:1,buffer:Buffer.from("x")}]);
      const version=(await listWikiVersions(u.viewer,p.id)).versions[0].id;
      await deleteNoteAttachment(u.editor,p.id,file.id);
      const holder=await controls.connect();try{
        await transaction(holder);await requireNote(holder,u.owner,p.id,"edit",new Map(),{lock:true});await holder.query("DELETE FROM note_attachments WHERE id=$1",[file.id]);
        const restore=restoreWikiVersion(u.editor,p.id,version,{expectedVersion:6});await waitUntilBlocked(controls,holder,"notes");
        await holder.query("COMMIT");const restored=await restore;assert.equal(restored.attachments.some(x=>x.id===file.id),false);
      }finally{await holder.query("ROLLBACK");holder.release();}
    });
    await t.test("target deletion while link locking waits drops the target",async()=>{
      const target=await createWikiPage(u.editor,s.id),holder=await controls.connect(),saver=await controls.connect();
      try{
        await transaction(holder);await holder.query("SELECT id FROM notes WHERE id=$1 FOR UPDATE",[target.id]);
        await transaction(saver);await requireNote(saver,u.editor,p.id,"edit",new Map(),{lock:true});
        const save=rebuildNoteLinks(saver,u.editor,p.id,[{type:"paragraph",content:[{type:"link",href:`/notes?note=${target.id}`,content:[]}]}],"http://localhost:3000");
        await waitUntilBlocked(controls,holder,"FOR KEY SHARE");
        await holder.query("DELETE FROM notes WHERE id=$1",[target.id]);await holder.query("COMMIT");
        await save;await saver.query("COMMIT");
        assert.equal((await pool.query("SELECT 1 FROM note_links WHERE source_note_id=$1 AND target_note_id=$2",[p.id,target.id])).rowCount,0);
      }finally{await holder.query("ROLLBACK");await saver.query("ROLLBACK");holder.release();saver.release();}
    });
    await t.test("copy's source SHARE lock holds off trash until independent files commit",async()=>{
      const source=await createWikiPage(u.editor,s.id);
      await uploadNoteAttachments(u.editor,source.id,[{originalName:"independent.txt",mimeType:"text/plain",buffer:Buffer.from("x"),sizeBytes:1}]);
      const client=await pool.connect(),original=client.query,connect=pool.connect;
      let resume!:()=>void,entered!:()=>void;
      const gate=new Promise<void>(resolve=>{resume=resolve;}),locked=new Promise<void>(resolve=>{entered=resolve;});
      client.query=(async function(sql:unknown,values?:unknown[]){
        const result=await (original as (sql:string,values?:unknown[])=>Promise<unknown>).call(client,sql as string,values);
        if(typeof sql==="string" && sql.includes("FOR SHARE") && sql.includes("FROM notes")){entered();await gate;}
        return result;
      }) as typeof client.query;
      // Give only the first public workflow this pre-acquired instrumented client.
      let supplied=false;
      pool.connect=(function(...args:unknown[]){if(!supplied){supplied=true;return Promise.resolve(client);}return (connect as (...args:unknown[])=>unknown).apply(pool,args);}) as typeof pool.connect;
      try{
        const copy=copyWikiPageToPersonal(u.viewer,source.id,{expectedVersion:1});await locked;
        const trash=trashNote(u.editor,source.id);await waitUntilBlocked(controls,client,"notes");resume();
        const copied=await copy;await trash;await deleteNotePermanently(u.owner,source.id);
        assert.equal((await getNote(u.viewer,copied.id)).attachments.length,1);
      }finally{resume();pool.connect=connect;client.query=original;}
    });
    await t.test("copy waits against purge and never creates a partial personal page",async()=>{
      const source=await createWikiPage(u.editor,s.id),holder=await controls.connect();await trashNote(u.editor,source.id);
      try{
        await transaction(holder);await holder.query("SELECT id FROM notes WHERE id=$1 FOR UPDATE",[source.id]);await holder.query("DELETE FROM notes WHERE id=$1",[source.id]);
        const copy=assert.rejects(copyWikiPageToPersonal(u.viewer,source.id,{expectedVersion:1}));await waitUntilBlocked(controls,holder,"notes");
        await holder.query("COMMIT");await copy;await assert.rejects(getWikiPage(u.viewer,source.id));
      }finally{await holder.query("ROLLBACK");holder.release();}
    });
    await t.test("failed transactions remove new bytes; uncertain COMMIT retains possibly committed bytes",async()=>{
      for(const uncertain of [false,true]) {
        const client=await controls.connect(),key=`personal:${u.owner.id}/${p.id}/${randomUUID()}`,disk=getNoteAttachmentDiskPath(key),original=client.query;
        try {
          if(uncertain)client.query=(async function(sql:unknown,...args:unknown[]){if(sql==="COMMIT"){await (original as (sql:string,values?:unknown[])=>Promise<unknown>).call(client,"COMMIT");throw new Error("uncertain commit");}return (original as (sql:string,values?:unknown[])=>Promise<unknown>).call(client,sql as string,args[0] as unknown[]|undefined);}) as typeof client.query;
          await assert.rejects(withTransactionOnClient(client,async()=>{
            noteFileTransaction.getStore()!.created.push(key);await writeDurableAttachment(disk,Buffer.from("x"));
            if(!uncertain)throw new Error("rollback");
          }));
          if(uncertain)await access(disk);else await assert.rejects(access(disk));
        }finally{client.query=original;await unlink(disk).catch(()=>{});client.release();}
      }
      const client=await controls.connect(),key=`personal:${u.owner.id}/${p.id}/${randomUUID()}`,disk=getNoteAttachmentDiskPath(key);
      try{
        await assert.rejects(withTransactionOnClient(client,async()=>{
          noteFileTransaction.getStore()!.created.push(key);await writeDurableAttachment(disk,Buffer.from("x"));throw new Error("original rollback");
        },async()=>{throw new Error("additional cleanup failed");}));
        await assert.rejects(access(disk),"owned file cleanup still runs after an additional cleanup hook fails");
      }finally{client.release();await unlink(disk).catch(()=>{});}
    });
    await t.test("parallel reads and saves finish with pool max two and acquisition is bounded",async()=>{
      assert.equal(pool.options.max,2);
      const pages=await Promise.all(Array.from({length:6},()=>createWikiPage(u.editor,s.id)));
      await Promise.all(pages.flatMap(page=>[getWikiPage(u.viewer,page.id),updateNote(u.editor,page.id,{title:"Parallel",expectedVersion:1})]));
      const held=await Promise.all([pool.connect(),pool.connect()]);
      try{await assert.rejects(getWikiPage(u.viewer,p.id),/timeout|exceeded/i);}finally{held.forEach(c=>c.release());}
      assert.equal(pool.waitingCount,0);
    });
    await trashNote(u.editor,b.id).catch(()=>{});await deleteNotePermanently(u.owner,b.id);
  } finally{await controls.end();await f.cleanup();}
});
