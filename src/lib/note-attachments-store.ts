import "server-only";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { mutationAttachmentPath, inMutationBatch, writeDurableAttachment } from "@/lib/taskboard-mutation-effects";
import { noteFileTransaction } from "@/lib/notes-store-context";
import { BoardAccessError } from "@/lib/board-access";
import { isUuid } from "@/lib/notes-model";
import { randomUUID } from "node:crypto";
import { WikiRuleError } from "@/lib/notes-errors";
export function getNoteAttachmentDiskPath(storedName: string) {
  const root = process.env.TASKBOARD_NOTE_ATTACHMENTS_ROOT
    ? path.resolve(process.env.TASKBOARD_NOTE_ATTACHMENTS_ROOT)
    : path.join(process.cwd(), "uploads", "note-attachments");
  if (storedName.startsWith("folio:")) {
    const key = storedName.slice(6);
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/i.test(key)) throw new Error("Attachment not found.");
    return path.join(root, ".folio", key);
  }
  if(storedName.startsWith("task:"))return mutationAttachmentPath(storedName.slice(5));
  if(storedName.startsWith("personal:")) {
    const key=storedName.slice(9);
    if(!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/i.test(key))throw new Error("Attachment not found.");
    return path.join(root,".personal",key);
  }
  if(!/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/i.test(storedName))throw new Error("Attachment not found.");
  const [noteId, attachmentId] = storedName.split("/");

  if (!isUuid(noteId) || !isUuid(attachmentId)) {
    throw new Error("Attachment not found.");
  }

  return path.join(root,noteId,attachmentId);
}

export async function removeNoteAttachmentFiles(storedNames: string[]) {
  await Promise.all(
    Array.from(new Set(storedNames)).map(async (storedName) => {
      try {
        await unlink(getNoteAttachmentDiskPath(storedName));
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
          console.error("Failed to delete note attachment file.", { storedName, error });
        }
      }
    }),
  );
}

export async function relocateNoteFiles(client:PoolClient,noteId:string,from:string|null,to:string|null,ownerId:string) {
  if(from===to)return;
  const files=noteFileTransaction.getStore();
  if(!files || inMutationBatch())throw new Error("Moving a Note between board scopes requires its native file transaction.");
  const attachments=(await client.query<{id:string;stored_name:string;removed_at:Date|null}>("SELECT id,stored_name,removed_at FROM note_attachments WHERE note_id=$1 ORDER BY id FOR UPDATE",[noteId])).rows;
  for(const attachment of attachments) {
    const next=to ? `task:${to}/${noteId}/${attachment.id}` : `personal:${ownerId}/${noteId}/${attachment.id}`;
    if(next===attachment.stored_name)continue;
    const bytes=await readFile(getNoteAttachmentDiskPath(attachment.stored_name)).catch(e=>{
      if(e.code==="ENOENT" && attachment.removed_at)return null;
      if(e.code==="ENOENT")throw new BoardAccessError("note_attachment_unavailable","An attachment file is missing. Restore or remove it before moving this Note.",409);
      throw e;
    });
    const target=getNoteAttachmentDiskPath(next);
    if(bytes){ files.created.push(next); await writeDurableAttachment(target,bytes); }
    await client.query("UPDATE note_attachments SET stored_name=$2 WHERE id=$1 AND note_id=$3",[attachment.id,next,noteId]);
    files.removed.push(attachment.stored_name);
  }
}


export type NoteFileRow = { id:string;note_id:string;original_name:string;stored_name:string;mime_type:string;size_bytes:number|string;created_at:Date;removed_at:Date|null };
// The single policy for all current-file readers and counts. Alias is internal SQL.
export function currentAttachmentPredicate(alias="note_attachments") { return `${alias}.removed_at IS NULL`; }
export async function currentNoteAttachments(client:PoolClient, input:{noteIds:string[];attachmentId?:string}):Promise<NoteFileRow[]> {
  return (await client.query<NoteFileRow>(`SELECT * FROM note_attachments WHERE note_id=ANY($1::uuid[]) AND ${currentAttachmentPredicate()} ${input.attachmentId ? "AND id=$2" : ""} ORDER BY created_at,id`, input.attachmentId ? [input.noteIds,input.attachmentId] : [input.noteIds])).rows;
}

export async function copyNoteFiles(client:PoolClient,actorId:string,sourceId:string,noteId:string) {
  const mapping=new Map<string,string>();
  const state=noteFileTransaction.getStore();
  if(!state || inMutationBatch())throw new Error("Copy requires a native file transaction.");
  for(const file of await currentNoteAttachments(client,{noteIds:[sourceId]})) {
    const bytes=await readFile(getNoteAttachmentDiskPath(file.stored_name)).catch(error=>{
      if(error.code==="ENOENT")throw new WikiRuleError("note_attachment_unavailable","A current attachment is missing. Recover or remove it before copying.",409);
      throw error;
    });
    const id=randomUUID(),stored=`personal:${actorId}/${noteId}/${id}`;
    state.created.push(stored);
    await writeDurableAttachment(getNoteAttachmentDiskPath(stored),bytes);
    await client.query(`INSERT INTO note_attachments(id,note_id,uploaded_by_user_id,original_name,stored_name,mime_type,size_bytes)
      VALUES($1,$2,$3,$4,$5,$6,$7)`,[id,noteId,actorId,file.original_name,stored,file.mime_type,file.size_bytes]);
    mapping.set(file.id,id);
  }
  return mapping;
}

// Parse known attachment routes. Queries/fragments survive only on copied files.
export function rewriteCopiedContent(blocks:unknown[],markdown:string,sourceId:string,noteId:string,mapping:Map<string,string>,origin:string) {
  const rewrite=(value:string):string|null=>{
    if(!value.startsWith("/") && !/^https?:\/\//i.test(value))return value;
    try {
      const url=new URL(value,origin);
      if(url.origin!==new URL(origin).origin)return value;
      const match=url.pathname.match(/^\/api\/notes\/([a-f0-9-]{36})\/attachments\/([a-f0-9-]{36})$/i);
      if(!match || match[1].toLowerCase()!==sourceId.toLowerCase())return value;
      const copied=mapping.get(match[2].toLowerCase());
      return copied?`/api/notes/${noteId}/attachments/${copied}${url.search}${url.hash}`:null;
    } catch {return value;}
  };
  const walk=(value:unknown):unknown=>{
    if(Array.isArray(value))return value.flatMap(entry=>{
      const node=entry as {type?:string;href?:string}|null;
      return node?.type==="link" && typeof node.href==="string" && rewrite(node.href)===null ? walk((entry as {content?:unknown}).content??[]) as unknown[] : [walk(entry)];
    });
    if(!value || typeof value!=="object")return value;
    const node=value as Record<string,unknown>;
    if(node.type==="link" && typeof node.href==="string" && rewrite(node.href)===null)return walk(node.content??[]);
    const props=node.props as Record<string,unknown>|undefined;
    if(props && typeof props.url==="string" && rewrite(props.url)===null)
      return { ...(typeof node.id==="string"?{id:node.id}:{}),type:"paragraph",props:{},content:[{type:"text",text:"File unavailable",styles:{}}],children:Array.isArray(node.children)?walk(node.children):[] };
    return Object.fromEntries(Object.entries(node).map(([key,child])=>[key,
      (key==="url"||key==="href") && typeof child==="string" ? rewrite(child)??"" : walk(child)]));
  };
  // Scan Markdown link/image destinations, respecting escapes, angle destinations
  // and balanced parentheses. Keep surrounding Markdown and unrelated URLs intact.
  let result="",cursor=0,index=0;
  let fence:{character:string;length:number}|null=null;
  const escaped=(at:number)=>{
    let slashes=0;for(let before=at-1;before>=0 && markdown[before]==="\\";before--)slashes++;
    return slashes%2===1;
  };
  while(index<markdown.length) {
    if(index===0 || markdown[index-1]==="\n") {
      const marker=markdown.slice(index).match(/^ {0,3}(`{3,}|~{3,})([^\n]*)/);
      if(marker) {
        if(!fence)fence={character:marker[1][0],length:marker[1].length};
        else if(marker[1][0]===fence.character && marker[1].length>=fence.length && !marker[2].trim())fence=null;
        index+=marker[0].length;continue;
      }
    }
    if(fence){index++;continue;}
    if(markdown[index]==="`" && !escaped(index)) {
      const delimiter=markdown.slice(index).match(/^`+/)![0];
      let closing=markdown.indexOf(delimiter,index+delimiter.length);
      while(closing>=0 && (markdown[closing-1]==="`" || markdown[closing+delimiter.length]==="`"))closing=markdown.indexOf(delimiter,closing+delimiter.length);
      index=closing>=0?closing+delimiter.length:index+delimiter.length;continue;
    }
    if(markdown[index]!=="[" || escaped(index)){index++;continue;}
    const start=index>0 && markdown[index-1]==="!" && !escaped(index-1)?index-1:index;
    let close=index+1,depth=1;
    for(;close<markdown.length;close++) {
      if(markdown[close]==="\\"){close++;continue;}
      if(markdown[close]==="[")depth++;
      if(markdown[close]==="]" && --depth===0)break;
    }
    if(markdown[close+1]!=="("){index++;continue;}
    let destStart=close+2;while(/\s/.test(markdown[destStart]??"") && destStart<markdown.length)destStart++;
    const angle=markdown[destStart]==="<";if(angle)destStart++;
    let end=destStart,parens=0;
    for(;end<markdown.length;end++) {
      const char=markdown[end];if(char==="\\"){end++;continue;}
      if(angle && char===">")break;
      if(!angle && ((char===")" && parens===0)||(/\s/.test(char)&&parens===0)))break;
      if(char==="(")parens++;if(char===")")parens--;
    }
    let linkEnd=end+(angle?1:0);
    // Optional quoted title is preserved; find the closing delimiter safely.
    let quote="";
    for(;linkEnd<markdown.length;linkEnd++) {
      const char=markdown[linkEnd];if(char==="\\"){linkEnd++;continue;}
      if(quote){if(char===quote)quote="";continue;}
      if(char==='"'||char==="'"){quote=char;continue;}
      if(char===")")break;
    }
    if(linkEnd>=markdown.length){index++;continue;}
    const raw=markdown.slice(destStart,end),decoded=raw.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\]\\^_`{|}~])/g,"$1");
    const next=rewrite(decoded);
    if(next!==decoded) {
      result+=markdown.slice(cursor,start);
      if(next===null) result+=start<index?"File unavailable":markdown.slice(index+1,close);
      else result+=markdown.slice(start,destStart)+next.replace(/[()]/g,"\\$&")+markdown.slice(end,linkEnd+1);
      cursor=linkEnd+1;
    }
    index=linkEnd+1;
  }
  return {blocks:walk(blocks) as unknown[],markdown:result+markdown.slice(cursor)};
}
