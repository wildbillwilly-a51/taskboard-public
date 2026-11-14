import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getBlocksPlainText, normalizeNoteContent, normalizeNoteTitle } from "@/lib/notes-model";
import { NoteConflictError, WikiRuleError } from "@/lib/notes-errors";
import type { Actor } from "@/lib/notes-store-context";
import { getBoardAccess, type DbNoteRow } from "@/lib/notes-store-access";
import { canCoalesceWikiVersion, extractWikiLinkTargets, type WikiVersionKind, type WikiVersionSummary } from "@/lib/wiki-model";
import { currentNoteAttachments } from "@/lib/note-attachments-store";
import { assertNoteContentFormat } from "@/lib/notes-content-format";
import { normalizeFolioPageState } from "@/lib/folio-model";
import { withNoteBlockIds } from "@/lib/note-outline";

export function trustedWikiOrigin() {
  const host = process.env.TASKBOARD_HOST;
  return process.env.TASKBOARD_PUBLIC_ORIGIN ?? (host ? `https://${host}` : "http://localhost:3000");
}
export function assertExpectedNoteVersion(expected: unknown, current: number) {
  if (typeof expected !== "number" || !Number.isSafeInteger(expected) || expected < 1)
    throw new WikiRuleError("invalid_wiki_request", "A positive expectedVersion is required.", 400);
  if (expected !== current) throw new NoteConflictError(current);
}
export function assertWikiFormat(format: number, blocks: unknown = []) {
  assertNoteContentFormat(blocks, format);
}

// Caller already owns the note and space locks; never owns a transaction/client.
export type ContentActor=Actor|{id:null;shareId:string};
export async function saveNoteContent(client: PoolClient, actor: ContentActor, row: DbNoteRow,
  input: {title?: unknown; content?: unknown; folioPageState?: unknown; expectedVersion?: unknown; kind?: WikiVersionKind; origin?: string}) {
  assertExpectedNoteVersion(input.expectedVersion,row.content_version);
  if(row.wiki_space_id || row.folio_kind) {
    const stored = (await client.query<{content_json:unknown[]}>("SELECT content_json FROM notes WHERE id=$1",[row.id])).rows[0];
    assertWikiFormat(row.content_format_version, stored.content_json);
  }
  const assignments = ["content_version=content_version+1"];
  const params: unknown[] = [row.id];
  if(input.title !== undefined) {
    params.push(normalizeNoteTitle(input.title)); assignments.push(`title=$${params.length}`);
  }
  if(input.content !== undefined) {
    let content=normalizeNoteContent(input.content);
    if (row.wiki_space_id && content.formatVersion !== 2) throw new WikiRuleError("wiki_format_unsupported", "Reload this page before saving its body.", 409);
    assertNoteContentFormat(content.blocks, content.formatVersion ?? 1);
    if (!row.wiki_space_id && !row.folio_kind) assertNoteContentFormat(content.blocks, 1);
    else if (row.wiki_space_id) assignments.push("content_format_version=2");
    if (row.folio_kind && content.formatVersion !== row.content_format_version && !(row.content_format_version===2&&content.formatVersion===1))
      throw new WikiRuleError("note_format_unsupported", "Reload this note before saving its body.", 409);
    if(row.folio_kind&&row.content_format_version===2)assertNoteContentFormat(content.blocks,2);
    if (row.folio_kind) content = normalizeNoteContent({ ...content, blocks: withNoteBlockIds(content.blocks, randomUUID) });
    params.push(JSON.stringify(content.blocks),content.markdown,row.wiki_space_id ? getBlocksPlainText(content.blocks) : content.text);
    assignments.push(`content_json=$${params.length-2}::jsonb`,`content_markdown=$${params.length-1}`,`content_text=$${params.length}`);
  }
  if (input.folioPageState !== undefined) {
    if (row.folio_kind !== "space_page") throw new WikiRuleError("invalid_folio_request", "Only space pages have page settings.", 400);
    const state = normalizeFolioPageState(input.folioPageState);
    if (state.bannerAttachmentId) {
      const file = (await client.query<{ mime_type: string }>(
        "SELECT mime_type FROM note_attachments WHERE id=$1 AND note_id=$2 AND removed_at IS NULL", [state.bannerAttachmentId, row.id])).rows[0];
      if (!file || !["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"].includes(file.mime_type))
        throw new WikiRuleError("invalid_folio_request", "Choose an image uploaded to this space page.", 400);
    }
    params.push(JSON.stringify(state)); assignments.push(`folio_page_state=$${params.length}::jsonb`);
  }
  if(row.wiki_space_id || row.folio_kind) {
    params.push(actor.id); assignments.push(`updated_by_user_id=$${params.length}`,"updated_at=clock_timestamp()");
    params.push('shareId' in actor?actor.shareId:null);assignments.push(`updated_via_share_id=$${params.length}`);
  }
  await client.query(`UPDATE notes SET ${assignments.join(",")} WHERE id=$1`,params);
  if(row.wiki_space_id || row.folio_kind) {
    // Promotion/title-only saves also recompute from stored blocks.
    const stored=(await client.query<{content_json:unknown[]}>("SELECT content_json FROM notes WHERE id=$1",[row.id])).rows[0];
    await client.query("UPDATE notes SET content_text=$2 WHERE id=$1",[row.id,getBlocksPlainText(stored.content_json)]);
    await snapshotWikiNote(client,actor,row.id,input.kind ?? "edit");
    if (row.wiki_space_id && actor.id) await rebuildNoteLinks(client,actor as Actor,row.id,stored.content_json,input.origin ?? trustedWikiOrigin());
    if (row.folio_kind) await rebuildFolioNoteLinks(client,row.id,stored.content_json,input.origin ?? trustedWikiOrigin());
  }
}

export async function snapshotWikiNote(client:PoolClient,actor:ContentActor,noteId:string,kind:WikiVersionKind="edit",fileCheckpoint=false) {
  const row=(await client.query<{title:string;content_json:unknown;content_markdown:string;content_format_version:number;wiki_space_id:string|null;board_id:string;owner_user_id:string;folio_kind:string|null;folio_page_state:unknown}>(
    "SELECT title,content_json,content_markdown,content_format_version,wiki_space_id,board_id,owner_user_id,folio_kind,folio_page_state FROM notes WHERE id=$1",[noteId])).rows[0];
  if(!row || (!row.wiki_space_id && !row.folio_kind))return;
  assertWikiFormat(row.content_format_version, row.content_json);
  const savedAt=(await client.query<{at:Date}>("SELECT clock_timestamp() AS at")).rows[0].at.toISOString();
  const latest=(await client.query<{id:string;version_number:number;kind:WikiVersionKind;author_user_id:string|null;author_share_id:string|null;started_at:Date;saved_at:Date}>(
    "SELECT * FROM note_versions WHERE note_id=$1 ORDER BY version_number DESC LIMIT 1",[noteId])).rows[0];
  const decision:Pick<WikiVersionSummary,"kind"|"authorUserId"|"startedAt"|"savedAt">|null=latest ? {
    kind:latest.kind,authorUserId:latest.author_user_id,startedAt:latest.started_at.toISOString(),savedAt:latest.saved_at.toISOString()}:null;
  const attachmentIds=(await currentNoteAttachments(client,{noteIds:[noteId]})).map(file=>file.id);
  const shareId='shareId' in actor?actor.shareId:null;
  const values=[row.title,JSON.stringify(row.content_json),row.content_markdown,row.content_format_version,attachmentIds,actor.id,savedAt,
    row.folio_kind ? JSON.stringify(row.folio_page_state) : null,shareId];
  if((latest?.author_share_id??null)===shareId && canCoalesceWikiVersion(decision,{kind,authorUserId:actor.id,savedAt,fileCheckpoint})) {
    await client.query(`UPDATE note_versions SET title=$1,content_json=$2::jsonb,content_markdown=$3,content_format_version=$4,
      attachment_ids=$5,author_user_id=$6,saved_at=$7,folio_page_state=$8::jsonb,author_share_id=$9 WHERE id=$10`,[...values,latest.id]);
  } else {
    await client.query(`INSERT INTO note_versions(title,content_json,content_markdown,content_format_version,attachment_ids,author_user_id,saved_at,folio_page_state,author_share_id,
      started_at,id,note_id,version_number,kind) VALUES($1,$2::jsonb,$3,$4,$5,$6,$7,$8::jsonb,$9,$7,$10,$11,$12,$13)`,[...values,randomUUID(),noteId,(latest?.version_number??0)+1,kind]);
  }
  if(fileCheckpoint) await client.query("UPDATE notes SET updated_at=clock_timestamp(),updated_by_user_id=$2,updated_via_share_id=$3 WHERE id=$1",[noteId,actor.id,shareId]);
  // Also covers a history-only checkpoint which has no note update.
  await client.query("SELECT queue_note_revisions(ARRAY[$1]::text[],ARRAY[$2]::uuid[])",
    row.folio_kind ? ["user", row.owner_user_id] : ["board", row.board_id]);
}

export async function rebuildFolioNoteLinks(client:PoolClient,noteId:string,blocks:unknown,origin:string) {
 const ids=extractWikiLinkTargets(blocks,origin);await client.query('DELETE FROM note_links WHERE source_note_id=$1',[noteId]);
 if(ids.length)await client.query(`INSERT INTO note_links(source_note_id,target_note_id) SELECT $1,id FROM notes WHERE id=ANY($2::uuid[]) AND id<>$1 AND deleted_at IS NULL ON CONFLICT DO NOTHING`,[noteId,ids]);
}

export async function rebuildNoteLinks(client:PoolClient,actor:Actor,noteId:string,blocks:unknown,origin:string) {
  const ids=extractWikiLinkTargets(blocks,origin);
  const targets=ids.length ? (await client.query<{id:string;board_id:string}>(
    `SELECT id,board_id FROM notes WHERE id=ANY($1::uuid[]) AND wiki_space_id IS NOT NULL AND deleted_at IS NULL ORDER BY id FOR KEY SHARE`,[ids])).rows:[];
  await client.query("DELETE FROM note_links WHERE source_note_id=$1",[noteId]);
  const cache=new Map();
  for(const target of targets) if((await getBoardAccess(client,actor,target.board_id,cache))?.canRead)
    await client.query("INSERT INTO note_links(source_note_id,target_note_id) VALUES($1,$2) ON CONFLICT DO NOTHING",[noteId,target.id]);
}
