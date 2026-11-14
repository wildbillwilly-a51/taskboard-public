import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {writeFile} from "node:fs/promises";
import {performance} from "node:perf_hooks";
import test from "node:test";
import {getPool} from "../src/lib/db";
import {getNoteRowAccess, getNoteRowsAccess, loadNoteRow, type DbNoteRow} from "../src/lib/notes-store-access";
import {folioNoteAccessBatch} from "../src/lib/folio-store-access";
import {listFolioNotes, getFolioLibrary, getFolioSpacePage} from "../src/lib/folio-store";
import {discoverFolio} from "../src/lib/folio-discovery-store";
import {withOwnedBoardNotes, type Actor} from "../src/lib/notes-store-context";
import {isLocalVisualDatabase} from "./helpers/visual-database";

test("Folio listing batches access without changing privacy, and browses a full-wiki-sized fixture", {
  skip: process.env.FOLIO_LISTING_DB_TEST !== "1", timeout: 120000,
}, async () => {
  assert.ok(isLocalVisualDatabase(new URL(process.env.DATABASE_URL!)));
  const pool=getPool()!;
  const actor=(role:"standard"|"admin"):Actor=>({id:randomUUID(),email:`${randomUUID()}@example.invalid`,displayName:"Synthetic listing check",role,authMode:"password"});
  const owner=actor("standard"), other=actor("standard"), admin=actor("admin");
  const actors=[owner,other,admin], spaces=Array.from({length:459},()=>randomUUID());
  const ids=Array.from({length:3246},()=>randomUUID());
  const shared=randomUUID(), board=randomUUID(), task=randomUUID(), taskSpace=randomUUID(), archived=randomUUID();
  const timings:number[]=[];
  try {
    for(const a of actors) await pool.query("INSERT INTO users(id,email,display_name,role) VALUES($1,$2,$3,$4)",[a.id,a.email,a.displayName,a.role]);
    const root=(await getFolioLibrary(owner)).rootSpaceId, otherRoot=(await getFolioLibrary(other)).rootSpaceId;
    // Seven descendants plus Personal root exercise the maximum eight levels.
    for(let i=0;i<7;i++) await pool.query("INSERT INTO folio_spaces(id,kind,title,owner_user_id,parent_id) VALUES($1,'personal',$2,$3,$4)",[spaces[i],`Synthetic depth ${i}`,owner.id,i?spaces[i-1]:root]);
    await pool.query(`INSERT INTO folio_spaces(id,kind,title,owner_user_id,parent_id)
      SELECT id,'personal','Synthetic folder '||ord,$2,$3 FROM unnest($1::uuid[]) WITH ORDINALITY x(id,ord)`,[spaces.slice(7),owner.id,root]);
    await pool.query("INSERT INTO folio_spaces(id,kind,title) VALUES($1,'shared','Synthetic shared')",[shared]);
    await pool.query("INSERT INTO folio_spaces(id,kind,title,archived_at) VALUES($1,'shared','Synthetic inactive',now())",[archived]);
    await pool.query("INSERT INTO boards(id,title,owner_user_id,board_type) VALUES($1,'Synthetic hidden board',$2,'personal')",[board,owner.id]);
    await pool.query("INSERT INTO tasks(id,board_id,title,status,sort_order) VALUES($1,$2,'Synthetic hidden task','todo',1)",[task,board]);
    await pool.query("INSERT INTO folio_spaces(id,kind,title,task_id) VALUES($1,'task','Synthetic hidden task',$2)",[taskSpace,task]);
    const body="Synthetic capacity content. ".repeat(170);
    await pool.query(`INSERT INTO notes(id,owner_user_id,folio_kind,title,content_format_version,content_text,content_markdown,content_json)
      SELECT id,$2,'document','Synthetic capacity document '||ord,2,$3,$3,
      jsonb_build_array(jsonb_build_object('id',id::text,'type','paragraph','content',jsonb_build_array(jsonb_build_object('type','text','text',$3::text,'styles','{}'::jsonb)),'children','[]'::jsonb))
      FROM unnest($1::uuid[]) WITH ORDINALITY x(id,ord)`,[ids,owner.id,body]);
    await pool.query(`INSERT INTO folio_connections(note_id,space_id)
      SELECT * FROM unnest($1::uuid[],$2::uuid[])`,[ids,ids.map((_,i)=>i<450?spaces[6]:spaces[7+(i%452)])]);
    // Change only synthetic placements to cover private, public, mixed, hidden
    // board, no connection and inactive-only states used by the native rules.
    for(const i of [501,502,503,504]) await pool.query("DELETE FROM folio_connections WHERE note_id=$1",[ids[i]]);
    for(const [i,space] of [[501,shared],[502,taskSpace],[504,archived],[505,shared]] as const)
      await pool.query("INSERT INTO folio_connections(note_id,space_id) VALUES($1,$2)",[ids[i],space]);
    const otherId=randomUUID();
    await pool.query("INSERT INTO notes(id,owner_user_id,folio_kind,title,content_format_version) VALUES($1,$2,'document','Synthetic other private',2)",[otherId,other.id]);
    await pool.query("INSERT INTO folio_connections(note_id,space_id) VALUES($1,$2)",[otherId,otherRoot]);
    const ownPage=await getFolioSpacePage(owner,spaces[6]), sharedPage=await getFolioSpacePage(owner,shared), hiddenPage=await getFolioSpacePage(owner,taskSpace);
    const client=await pool.connect();
    try {
      const rows:DbNoteRow[]=[];
      for(const id of [...ids.slice(500,506),otherId,ownPage.id,sharedPage.id,hiddenPage.id]) rows.push((await loadNoteRow(client,id))!);
      for(const viewer of [...actors,{...owner,isDisabled:true}]){
        const batched=await getNoteRowsAccess(client,viewer,rows,new Map());
        for(const row of rows) assert.deepEqual(batched.get(row.id),await getNoteRowAccess(client,viewer,row,new Map()));
      }
      const outsider=await getNoteRowsAccess(client,other,rows,new Map());
      assert.equal(outsider.get(ids[500])!.canRead,false);
      assert.equal(outsider.get(ids[501])!.canRead,true);
      assert.equal(outsider.get(ids[502])!.canRead,true,"a hidden board connection keeps the independent document public");
      assert.equal(outsider.get(hiddenPage.id)!.canRead,false);
      assert.equal(outsider.get(ids[503])!.canRead,true);
      assert.equal(outsider.get(ids[504])!.canRead,true);
      assert.equal(outsider.get(ids[505])!.canRead,true);
      const scoped=await withOwnedBoardNotes(board,owner.id,()=>getNoteRowsAccess(client,owner,rows,new Map()));
      assert.ok([...scoped.values()].every(a=>!a.canRead&&!a.canEdit));
      const documents=(await client.query<Pick<DbNoteRow,"id"|"owner_user_id"|"folio_kind"|"folio_page_space_id">>(
        "SELECT id,owner_user_id,folio_kind,folio_page_space_id FROM notes WHERE id=ANY($1::uuid[])",[ids.slice(0,100)],
      )).rows;
      let queryCount=0;
      const original=client.query;
      client.query=new Proxy(original,{apply(target,thisArg,args){queryCount++;return Reflect.apply(target,thisArg,args);}});
      try {await folioNoteAccessBatch(client,owner,documents,async()=>false);} finally {client.query=original;}
      assert.equal(queryCount,1,"100 document permissions must use one SQL statement");
      await client.query("UPDATE boards SET archived_at=now() WHERE id=$1",[board]);
      const inactive=(await getNoteRowsAccess(client,owner,[rows.find(r=>r.id===hiddenPage.id)!],new Map())).get(hiddenPage.id)!;
      assert.equal(inactive.canRead,true);assert.equal(inactive.canEdit,false);
      await client.query("UPDATE boards SET archived_at=NULL WHERE id=$1",[board]);
    } finally {client.release();}
    const seen=new Set<string>();
    for(let offset=0;offset<450;offset+=100){
      const start=performance.now(), r=await listFolioNotes(owner,{view:{kind:"space",spaceId:spaces[6]},offset});
      timings.push(performance.now()-start);
      assert.equal(r.notes.length,Math.min(100,450-offset));assert.equal(r.hasMore,offset<400);
      for(const n of r.notes){assert.equal(seen.has(n.id),false);seen.add(n.id);}
    }
    assert.equal(seen.size,450);
    const scopedSearch=await discoverFolio(owner,{spaceId:spaces[6],q:"Synthetic capacity document"});
    assert.equal(scopedSearch.notes.length,40);
    assert.ok(scopedSearch.notes.every(note=>seen.has(note.id)));
    const search=await discoverFolio(other,{q:"Synthetic capacity document"});
    const hits=new Set(search.notes.map(n=>n.id));
    assert.equal(hits.has(ids[500]),false);assert.ok(hits.has(ids[501]));assert.ok(hits.has(ids[502]));
    assert.ok(Math.max(...timings)<2000,`Wide-branch list exceeded the 2s regression budget: ${Math.max(...timings).toFixed(0)}ms`);
    const evidence={syntheticDocuments:ids.length,syntheticSpaces:spaces.length,logicalTextBytes:Buffer.byteLength(body)*ids.length,depthIncludingRoot:8,branchRows:seen.size,pageMs:timings,permissionQueriesFor100:1,privacyParity:true};
    if(process.env.FOLIO_LISTING_REPORT)await writeFile(process.env.FOLIO_LISTING_REPORT,JSON.stringify(evidence,null,2));
    console.log(JSON.stringify(evidence));
  } finally {
    // Only new random fixture principals are eligible for cleanup. The imported
    // corpus and other local databases are never reset or truncated.
    await pool.query("DELETE FROM notes WHERE owner_user_id=ANY($1::uuid[]) OR folio_page_space_id=ANY($2::uuid[])",[actors.map(a=>a.id),[shared,taskSpace,archived]]);
    await pool.query("DELETE FROM folio_spaces WHERE owner_user_id=ANY($1::uuid[]) OR id=ANY($2::uuid[])",[actors.map(a=>a.id),[shared,taskSpace,archived]]);
    await pool.query("DELETE FROM boards WHERE id=$1",[board]);
    await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])",[actors.map(a=>a.id)]);
    await pool.end();
  }
});
