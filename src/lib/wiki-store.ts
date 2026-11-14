import "server-only";
import { randomUUID } from "node:crypto";
import { assertNoteContentFormat, projectPageMentionsToLinks } from "@/lib/notes-content-format";
import { topicFilterIds } from "@/lib/wiki-topics-store";
import { access as diskAccess } from "node:fs/promises";
import type { PoolClient } from "pg";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";
import { requireActor, withClient, withTransaction, toIso, type Actor } from "@/lib/notes-store-context";
import { getBoardAccess, resolveNotesBoard, requireNote, loadNoteDetail, noteSelectSql, mapNoteSummary,
  getNoteRowAccess, countVisibleLinkedTasks, requireActiveWikiSpace, type DbNoteRow } from "@/lib/notes-store-access";
import { changeNoteHome } from "@/lib/notes-home-store";
import { assertExpectedNoteVersion, assertWikiFormat, saveNoteContent, snapshotWikiNote, rebuildNoteLinks, trustedWikiOrigin } from "@/lib/notes-content-store";
import { getNoteAttachmentDiskPath, copyNoteFiles, rewriteCopiedContent, type NoteFileRow } from "@/lib/note-attachments-store";
import { listAccessibleBoardsWithClient } from "@/lib/taskboard-store";
import { buildNoteSearchQuery, emptyNoteContent, getBlocksPlainText, isUuid, normalizeNoteContent, normalizeNoteTitle } from "@/lib/notes-model";
import { WikiRuleError } from "@/lib/notes-errors";
import { normalizeWikiSlug, normalizeWikiSpaceTitle, normalizeWikiDescription,
  type WikiSpaceSummary, type WikiPageDetail, type WikiPageListInput, type WikiPageList,
  type CreateWikiSpaceInput, type UpdateWikiSpaceInput, type CreateWikiPageInput,
  type WikiVersionKind, type WikiVersionSummary, type WikiVersionDetail, type WikiVersionList } from "@/lib/wiki-model";

const notFound = () => new WikiRuleError("wiki_not_found", "Wiki resource not found.", 404);
const invalid = (message="Invalid wiki request.") => new WikiRuleError("invalid_wiki_request", message, 400);
const readOnly = () => new WikiRuleError("wiki_read_only", "This space is read-only.", 403);
function uuid(value:unknown):asserts value is string { if(!isUuid(value))throw invalid("A valid UUID is required."); }
function fields(input:object,allowed:string[]) { if(!input || typeof input!=="object" || Array.isArray(input) || Object.keys(input).some(k=>!allowed.includes(k)))throw invalid(); }
type SpaceRow={id:string;board_id:string;board_title:string;slug:string;title:string;description:string;home_note_id:string|null;archived_at:Date|null;created_at:Date;updated_at:Date;page_count:number;trash_count:number};
const spaceSelect=`SELECT s.*, b.title AS board_title,
  (SELECT count(*)::int FROM notes n WHERE n.wiki_space_id=s.id AND n.deleted_at IS NULL) AS page_count,
  (SELECT count(*)::int FROM notes n WHERE n.wiki_space_id=s.id AND n.deleted_at IS NOT NULL) AS trash_count
  FROM wiki_spaces s JOIN boards b ON b.id=s.board_id`;
async function spaceRow(client:PoolClient,actor:Actor,id:string,lock=false) {
  uuid(id);
  if(lock)await client.query("SELECT id FROM wiki_spaces WHERE id=$1 FOR UPDATE",[id]);
  const row=(await client.query<SpaceRow>(`${spaceSelect} WHERE s.id=$1`,[id])).rows[0];
  const boardAccess=row ? await getBoardAccess(client,actor,row.board_id,new Map()):null;
  if(!row || !boardAccess?.canRead)throw notFound();
  return {row,boardAccess};
}
async function spaceDto(client:PoolClient,actor:Actor,id:string):Promise<WikiSpaceSummary> {
  const {row,boardAccess}=await spaceRow(client,actor,id);
  return {id:row.id,boardId:row.board_id,boardTitle:row.board_title,slug:row.slug,title:row.title,description:row.description,
    homeNoteId:row.home_note_id,archivedAt:toIso(row.archived_at),createdAt:toIso(row.created_at)!,updatedAt:toIso(row.updated_at)!,
    canEdit:boardAccess.canEdit && !row.archived_at,canManage:boardAccess.canManage,pageCount:row.page_count,trashCount:row.trash_count};
}
async function wikiDetail(client:PoolClient,actor:Actor,id:string):Promise<WikiPageDetail> {
  const detail=await loadNoteDetail(client,actor,id,new Map());
  if(!detail.wiki)throw notFound();
  return detail as WikiPageDetail;
}
export async function listWikiSpaces(user:TaskboardUserIdentity,input:{includeArchived?:boolean}={}) {
  const actor=requireActor(user); fields(input,["includeArchived"]);
  if(input.includeArchived!==undefined && typeof input.includeArchived!=="boolean")throw invalid();
  return withClient(async client=>{
    const {boards}=await listAccessibleBoardsWithClient(client,actor);
    const rows=(await client.query<{id:string}>("SELECT id FROM wiki_spaces WHERE board_id=ANY($1::uuid[]) AND ($2 OR archived_at IS NULL) ORDER BY lower(title),id",[boards.map(b=>b.boardId),input.includeArchived??false])).rows;
    const spaces:WikiSpaceSummary[]=[];
    for(const row of rows)spaces.push(await spaceDto(client,actor,row.id));
    return spaces;
  });
}
export async function getWikiSpace(user:TaskboardUserIdentity,input:{spaceId?:string;slug?:string}) {
  const actor=requireActor(user);fields(input,["spaceId","slug"]);
  if((input.spaceId===undefined)===(input.slug===undefined))throw invalid();
  if(input.slug!==undefined && typeof input.slug!=="string")throw invalid();
  return withClient(async client=>{
    const id=input.spaceId ?? (await client.query<{id:string}>("SELECT id FROM wiki_spaces WHERE slug=$1",[input.slug])).rows[0]?.id;
    if(!id)throw notFound();return spaceDto(client,actor,id);
  });
}
export async function createWikiSpace(user:TaskboardUserIdentity,input:CreateWikiSpaceInput) {
  const actor=requireActor(user);fields(input,["boardId","title","description","slug"]);uuid(input.boardId);
  const title=normalizeWikiSpaceTitle(input.title),description=normalizeWikiDescription(input.description);
  if(input.slug!==undefined && (typeof input.slug!=="string" || !input.slug.trim()))throw invalid("Invalid space slug.");
  const base=normalizeWikiSlug(input.slug ?? title);
  return withTransaction(async client=>{
    const {board,boardAccess}=await resolveNotesBoard(client,actor,input.boardId,"read");
    if(!boardAccess.canManage)throw readOnly();
    if(board.board_type!=="team")throw new WikiRuleError("wiki_team_board_required","Choose a team board for this space.",400);
    const id=randomUUID();
    for(let suffix=1;suffix<=1000;suffix++) {
      const tail=suffix===1?"":`-${suffix}`,slug=base.slice(0,80-tail.length).replace(/-$/g,"")+tail;
      await client.query("SAVEPOINT wiki_slug");
      try { await client.query("INSERT INTO wiki_spaces(id,board_id,slug,title,description,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6)",[id,board.id,slug,title,description,actor.id]);
        await client.query("RELEASE SAVEPOINT wiki_slug");return spaceDto(client,actor,id);
      } catch(error) {
        await client.query("ROLLBACK TO SAVEPOINT wiki_slug");
        if((error as {code?:string}).code!=="23505")throw error;
        if((await client.query("SELECT 1 FROM wiki_spaces WHERE board_id=$1",[board.id])).rowCount)
          throw new WikiRuleError("wiki_space_exists","This board already has a space.",409);
        if(input.slug!==undefined)throw new WikiRuleError("wiki_slug_exists","This space address is already used.",409);
      }
    }
    throw new WikiRuleError("wiki_slug_exists","Choose a different space title.",409);
  });
}
export async function updateWikiSpace(user:TaskboardUserIdentity,spaceId:string,input:UpdateWikiSpaceInput) {
  const actor=requireActor(user);uuid(spaceId);fields(input,["title","description","archived","homeNoteId"]);
  input=Object.fromEntries(Object.entries(input).filter(([,value])=>value!==undefined));
  if(input.archived!==undefined && typeof input.archived!=="boolean")throw invalid();
  if(input.homeNoteId!==undefined && input.homeNoteId!==null)uuid(input.homeNoteId);
  return withTransaction(async client=>{
    // Proposed home note first; space administration never locks notes afterward.
    const home=input.homeNoteId ? (await requireNote(client,actor,input.homeNoteId,"read",new Map(),{lock:true,readLock:true,allowDeleted:true})).row:null;
    const {row,boardAccess}=await spaceRow(client,actor,spaceId,true);
    if(!boardAccess.canManage)throw readOnly();
    if(row.archived_at && !(input.archived===false && Object.keys(input).length===1))throw readOnly();
    if(home && (home.wiki_space_id!==spaceId || home.deleted_at))throw invalid("Home page must be a live page in this space.");
    const sets=["updated_at=clock_timestamp()"],params:unknown[]=[spaceId];
    const set=(column:string,value:unknown)=>{params.push(value);sets.push(`${column}=$${params.length}`);};
    if(input.title!==undefined)set("title",normalizeWikiSpaceTitle(input.title));
    if(input.description!==undefined)set("description",normalizeWikiDescription(input.description));
    if(input.archived!==undefined)set("archived_at",input.archived?new Date():null);
    if(Object.hasOwn(input,"homeNoteId"))set("home_note_id",input.homeNoteId);
    await client.query(`UPDATE wiki_spaces SET ${sets.join(",")} WHERE id=$1`,params);
    return spaceDto(client,actor,spaceId);
  });
}
export async function removeWikiSpace(user:TaskboardUserIdentity,spaceId:string) {
  const actor=requireActor(user);uuid(spaceId);
  return withTransaction(async client=>{
    const {row,boardAccess}=await spaceRow(client,actor,spaceId,true);
    if(!boardAccess.canManage || row.archived_at)throw readOnly();
    if((await client.query("SELECT 1 FROM notes WHERE wiki_space_id=$1 LIMIT 1",[spaceId])).rowCount)
      throw new WikiRuleError("wiki_space_not_empty","Remove every page, including trash, first.",409);
    await client.query("DELETE FROM wiki_spaces WHERE id=$1",[spaceId]);
  });
}
function pageBounds(input:{limit?:number;offset?:number},maximum:number) {
  const limit=input.limit??Math.min(100,maximum),offset=input.offset??0;
  if(!Number.isSafeInteger(limit)||limit<1||limit>maximum||!Number.isSafeInteger(offset)||offset<0||offset>100000)throw invalid("Invalid pagination.");
  return {limit,offset};
}
export async function listWikiPages(user:TaskboardUserIdentity,input:WikiPageListInput={}):Promise<WikiPageList> {
  const actor=requireActor(user);fields(input,["spaceId","q","status","limit","offset","includeArchivedSpaces","topicId","includeDescendants"]);
  if(input.spaceId!==undefined)uuid(input.spaceId);
  const {limit,offset}=pageBounds(input,500),status=input.status??"active";
  if(!["active","archived","trash"].includes(status) || (input.q!==undefined && typeof input.q!=="string") || (input.includeArchivedSpaces!==undefined && typeof input.includeArchivedSpaces!=="boolean"))throw invalid();
  return withClient(async client=>{
    let boards:string[];
    if(input.spaceId) {const {row}=await spaceRow(client,actor,input.spaceId); boards=[row.board_id];}
    else boards=(await listAccessibleBoardsWithClient(client,actor)).boards.map(b=>b.boardId);
    const where=["notes.wiki_space_id IS NOT NULL","notes.board_id=ANY($1::uuid[])"],params:unknown[]=[boards];
    const param=(value:unknown)=>{params.push(value);return `$${params.length}`;};
    const topics = await topicFilterIds(client,actor,input.spaceId,input.topicId,input.includeDescendants ?? true);
    if(topics)where.push(`EXISTS(SELECT 1 FROM wiki_page_topics pt WHERE pt.note_id=notes.id AND pt.topic_id=ANY(${param(topics)}::uuid[]))`);
    if(input.spaceId)where.push(`notes.wiki_space_id=${param(input.spaceId)}`);
    // Explicit archived-space navigation remains readable without a global toggle.
    else if(!input.includeArchivedSpaces)where.push("wiki_spaces.archived_at IS NULL");
    where.push(status==="trash"?"notes.deleted_at IS NOT NULL":`notes.deleted_at IS NULL AND notes.archived_at IS ${status==="archived"?"NOT ":""}NULL`);
    const q=buildNoteSearchQuery(input.q);if(q)where.push(`notes.search_vector @@ to_tsquery('simple',${param(q)})`);
    const rows=(await client.query<DbNoteRow>(`${noteSelectSql} WHERE ${where.join(" AND ")} ORDER BY notes.updated_at DESC,notes.id LIMIT ${param(limit+1)} OFFSET ${param(offset)}`,params)).rows;
    const cache=new Map(),counts=await countVisibleLinkedTasks(client,actor,rows.map(r=>r.id),cache),pages=[];
    for(const row of rows.slice(0,limit))pages.push(mapNoteSummary(row,await getNoteRowAccess(client,actor,row,cache),counts.get(row.id)??0) as WikiPageDetail);
    return {pages,limit,offset,hasMore:rows.length>limit};
  });
}
export async function getWikiPage(user:TaskboardUserIdentity,noteId:string) {
  const actor=requireActor(user);uuid(noteId);return withClient(client=>wikiDetail(client,actor,noteId));
}
export async function createWikiPage(user:TaskboardUserIdentity,spaceId:string,input:CreateWikiPageInput={}) {
  const actor=requireActor(user);uuid(spaceId);fields(input,["title","content"]);
  const title=normalizeNoteTitle(input.title),content=input.content===undefined?emptyNoteContent:normalizeNoteContent(input.content);
  return withTransaction(async client=>{
    const space=await requireActiveWikiSpace(client,actor,spaceId),id=randomUUID();
    if(input.content!==undefined && content.formatVersion!==2)throw new WikiRuleError("wiki_format_unsupported","Reload before creating a wiki page with content.",409);
    assertNoteContentFormat(content.blocks,2);
    await client.query(`INSERT INTO notes(id,owner_user_id,board_id,wiki_space_id,title,content_json,content_markdown,content_text,created_by_user_id,updated_by_user_id,content_format_version)
      VALUES($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$2,$2,2)`,[id,actor.id,space.board_id,spaceId,title,JSON.stringify(content.blocks),content.markdown,getBlocksPlainText(content.blocks)]);
    await snapshotWikiNote(client,actor,id,"start");await rebuildNoteLinks(client,actor,id,content.blocks,trustedWikiOrigin());
    return wikiDetail(client,actor,id);
  });
}
export async function promoteNoteToWiki(user:TaskboardUserIdentity,noteId:string,input:{spaceId:string;expectedVersion:number}) {
  const actor=requireActor(user);uuid(noteId);fields(input,["spaceId","expectedVersion"]);uuid(input.spaceId);
  return withTransaction(async client=>{
    const {row}=await requireNote(client,actor,noteId,"edit",new Map(),{lock:true,spaceLock:"update"});
    assertExpectedNoteVersion(input.expectedVersion,row.content_version);
    const stored=(await client.query<{content_json:unknown[]}>("SELECT content_json FROM notes WHERE id=$1",[noteId])).rows[0];
    assertWikiFormat(row.content_format_version,stored.content_json);
    await changeNoteHome(client,actor,row,{kind:"wiki",spaceId:input.spaceId,promotion:true},new Map());
    row.wiki_space_id=input.spaceId;
    await client.query("UPDATE notes SET content_format_version=2 WHERE id=$1",[noteId]);
    row.content_format_version=2;
    await saveNoteContent(client,actor,row,{expectedVersion:input.expectedVersion,kind:"start"});
    return wikiDetail(client,actor,noteId);
  });
}
export async function moveWikiPage(user:TaskboardUserIdentity,noteId:string,input:{spaceId:string;sourceSpaceId:string;expectedVersion:number}) {
  const actor=requireActor(user);uuid(noteId);fields(input,["spaceId","sourceSpaceId","expectedVersion"]);uuid(input.spaceId);uuid(input.sourceSpaceId);
  input={...input,spaceId:input.spaceId.toLowerCase(),sourceSpaceId:input.sourceSpaceId.toLowerCase()};
  return withTransaction(async client=>{
    // Lock source note alone, then both spaces in UUID order in changeNoteHome.
    const {row}=await requireNote(client,actor,noteId,"read",new Map(),{lock:true,skipSpaceLock:true});
    if(!row.wiki_space_id)throw notFound();
    if(row.wiki_space_id!==input.sourceSpaceId)throw new WikiRuleError("wiki_home_conflict","The page has moved to another space.",409);
    assertExpectedNoteVersion(input.expectedVersion,row.content_version);
    await changeNoteHome(client,actor,row,{kind:"wiki",spaceId:input.spaceId},new Map());
    return wikiDetail(client,actor,noteId);
  });
}
type VersionRow={id:string;note_id:string;version_number:number;kind:WikiVersionKind;title:string;content_json:unknown[];content_markdown:string;content_format_version:number;attachment_ids:string[];author_user_id:string|null;author_display_name:string|null;started_at:Date;saved_at:Date};
function versionSummary(row:VersionRow):WikiVersionSummary {
  return {id:row.id,versionNumber:row.version_number,kind:row.kind,title:row.title,authorUserId:row.author_user_id,authorDisplayName:row.author_display_name,startedAt:toIso(row.started_at)!,savedAt:toIso(row.saved_at)!};
}
async function versionRow(client:PoolClient,noteId:string,id:string) {
  uuid(id);const row=(await client.query<VersionRow>("SELECT v.*,u.display_name AS author_display_name FROM note_versions v LEFT JOIN users u ON u.id=v.author_user_id WHERE v.id=$1 AND v.note_id=$2",[id,noteId])).rows[0];
  if(!row)throw notFound();return row;
}
export async function listWikiVersions(user:TaskboardUserIdentity,noteId:string,input:{limit?:number;offset?:number}={}):Promise<WikiVersionList> {
  const actor=requireActor(user);uuid(noteId);fields(input,["limit","offset"]);const {limit,offset}=pageBounds(input,100);
  return withClient(async client=>{
    await wikiDetail(client,actor,noteId);
    const rows=(await client.query<VersionRow>("SELECT v.*,u.display_name AS author_display_name FROM note_versions v LEFT JOIN users u ON u.id=v.author_user_id WHERE v.note_id=$1 ORDER BY version_number DESC LIMIT $2 OFFSET $3",[noteId,limit+1,offset])).rows;
    return {versions:rows.slice(0,limit).map(versionSummary),limit,offset,hasMore:rows.length>limit};
  });
}
export async function getWikiVersion(user:TaskboardUserIdentity,noteId:string,versionId:string):Promise<WikiVersionDetail> {
  const actor=requireActor(user);uuid(noteId);uuid(versionId);
  return withClient(async client=>{
    await wikiDetail(client,actor,noteId);const row=await versionRow(client,noteId,versionId);
    const files=(await client.query<NoteFileRow>("SELECT * FROM note_attachments WHERE note_id=$1 AND id=ANY($2::uuid[]) ORDER BY created_at,id",[noteId,row.attachment_ids])).rows;
    const attachments=[];
    for(const file of files)attachments.push({id:file.id,originalName:file.original_name,mimeType:file.mime_type,sizeBytes:Number(file.size_bytes),createdAt:toIso(file.created_at)!,removed:!!file.removed_at,available:await diskAccess(getNoteAttachmentDiskPath(file.stored_name)).then(()=>true,()=>false)});
    return {...versionSummary(row),content:row.content_json,contentMarkdown:row.content_markdown,contentFormatVersion:row.content_format_version,attachments,unavailableAttachmentIds:row.attachment_ids.filter(id=>!files.some(f=>f.id===id))};
  });
}
export async function restoreWikiVersion(user:TaskboardUserIdentity,noteId:string,versionId:string,input:{expectedVersion:number}) {
  const actor=requireActor(user);uuid(noteId);uuid(versionId);fields(input,["expectedVersion"]);
  return withTransaction(async client=>{
    const {row}=await requireNote(client,actor,noteId,"edit",new Map(),{lock:true});if(!row.wiki_space_id)throw notFound();
    assertExpectedNoteVersion(input.expectedVersion,row.content_version);const version=await versionRow(client,noteId,versionId);assertWikiFormat(version.content_format_version,version.content_json);
    const files=(await client.query<NoteFileRow>("SELECT * FROM note_attachments WHERE note_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",[noteId,version.attachment_ids])).rows;
    for(const file of files) if(await diskAccess(getNoteAttachmentDiskPath(file.stored_name)).then(()=>true,()=>false))
      await client.query("UPDATE note_attachments SET removed_at=NULL WHERE id=$1",[file.id]);
    await saveNoteContent(client,actor,row,{title:version.title,content:{blocks:version.content_json,markdown:version.content_markdown,text:"",formatVersion:2},expectedVersion:input.expectedVersion,kind:"restore"});
    return wikiDetail(client,actor,noteId);
  });
}
export async function copyWikiPageToPersonal(user:TaskboardUserIdentity,noteId:string,input:{expectedVersion:number}) {
  const actor=requireActor(user);uuid(noteId);fields(input,["expectedVersion"]);
  return withTransaction(async client=>{
    const {row}=await requireNote(client,actor,noteId,"read",new Map(),{lock:true,readLock:true});
    if(!row.wiki_space_id)throw notFound();assertExpectedNoteVersion(input.expectedVersion,row.content_version);assertWikiFormat(row.content_format_version);
    const source=await wikiDetail(client,actor,noteId),id=randomUUID();
    assertWikiFormat(source.contentFormatVersion,source.content);
    await changeNoteHome(client,actor,row,{kind:"personal",createId:id},new Map());
    const files=await copyNoteFiles(client,actor.id,noteId,id);
    const content=rewriteCopiedContent(projectPageMentionsToLinks(source.content),source.contentMarkdown,noteId,id,files,trustedWikiOrigin());
    await client.query("UPDATE notes SET title=$2,content_json=$3::jsonb,content_markdown=$4,content_text=$5 WHERE id=$1",[id,source.title,JSON.stringify(content.blocks),content.markdown,getBlocksPlainText(content.blocks)]);
    return loadNoteDetail(client,actor,id,new Map());
  });
}
