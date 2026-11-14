import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { ensureLabel } from "@/lib/taskboard-store";
import { type Actor } from "@/lib/notes-store-context";
import { requireOwnNotebook, resolveNotesBoard, requireBucketOnBoard, requireActiveWikiSpace, lockWikiSpaces, type DbNoteRow, type BoardAccessCache } from "@/lib/notes-store-access";
import { relocateNoteFiles } from "@/lib/note-attachments-store";
import { WikiRuleError } from "@/lib/notes-errors";
export async function setPersonalNoteTags(
  client: PoolClient,
  noteId: string,
  ownerUserId: string,
  names: string[],
) {
  await client.query(`DELETE FROM note_tag_links WHERE note_id = $1`, [noteId]);

  for (const name of names) {
    const tagResult = await client.query<{ id: string }>(
      `
        INSERT INTO note_tags (id, owner_user_id, name)
        VALUES ($1, $2, $3)
        ON CONFLICT (owner_user_id, LOWER(name)) DO UPDATE SET name = note_tags.name
        RETURNING id
      `,
      [randomUUID(), ownerUserId, name],
    );
    await client.query(
      `INSERT INTO note_tag_links (note_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [noteId, tagResult.rows[0].id],
    );
  }
}

export async function removeUnusedPersonalTags(client: PoolClient, ownerUserId: string) {
  await client.query(
    `
      DELETE FROM note_tags
      WHERE owner_user_id = $1
        AND NOT EXISTS (SELECT 1 FROM note_tag_links WHERE note_tag_links.tag_id = note_tags.id)
    `,
    [ownerUserId],
  );
}

export async function setBoardNoteLabels(client: PoolClient, noteId: string, boardId: string, names: string[]) {
  await client.query(`DELETE FROM note_labels WHERE note_id = $1`, [noteId]);

  for (const name of names) {
    const labelId = await ensureLabel(client, boardId, name);
    await client.query(
      `INSERT INTO note_labels (note_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [noteId, labelId],
    );
  }
}

export async function moveNote(
  client: PoolClient,
  actor: Actor,
  row: DbNoteRow,
  home: unknown,
  notebookIdInput: unknown,
  cache: BoardAccessCache,
) {
  if (row.wiki_space_id) throw new WikiRuleError("wiki_home_change_forbidden", "Use a wiki move for this page.", 409);
  if (!home || typeof home !== "object") {
    throw new Error("home must be { boardId, bucketId } or { boardId: null }.");
  }

  const target = home as { boardId?: unknown; bucketId?: unknown };
  const labels = row.labels ?? [];

  if (target.boardId === null || target.boardId === undefined) {
    if (target.bucketId !== undefined && target.bucketId !== null) {
      throw new Error("A bucket home needs its boardId.");
    }

    const notebookId =
      notebookIdInput === undefined || notebookIdInput === null
        ? null
        : (await requireOwnNotebook(client, actor, notebookIdInput)).id;

    // A board note moved to "personal" becomes the mover's own note.
    await relocateNoteFiles(client,row.id,row.board_id,null,actor.id);
    await client.query(
      `
        UPDATE notes
        SET owner_user_id = $2, board_id = NULL, bucket_id = NULL, notebook_id = $3
        WHERE id = $1
      `,
      [row.id, actor.id, notebookId],
    );

    if (row.board_id) {
      await client.query(`DELETE FROM note_labels WHERE note_id = $1`, [row.id]);
      await setPersonalNoteTags(client, row.id, actor.id, labels);
    }

    return { boardId: null, ownerUserId: actor.id };
  }

  if (typeof target.boardId !== "string") {
    throw new Error("boardId must be a valid UUID.");
  }

  if (notebookIdInput !== undefined && notebookIdInput !== null) {
    throw new Error("Board notes are organized by bucket, not notebook.");
  }

  const { board, boardAccess } = await resolveNotesBoard(client, actor, target.boardId, "edit");
  cache.set(board.id, boardAccess);
  const bucketId =
    target.bucketId === undefined || target.bucketId === null
      ? null
      : await requireBucketOnBoard(client, board.id, target.bucketId);

  await relocateNoteFiles(client,row.id,row.board_id,board.id,actor.id);
  await client.query(
    `UPDATE notes SET board_id = $2, bucket_id = $3, notebook_id = NULL WHERE id = $1`,
    [row.id, board.id, bucketId],
  );

  if (row.board_id !== board.id) {
    // Labels and tags carry over by name into the new board's labels.
    await client.query(`DELETE FROM note_tag_links WHERE note_id = $1`, [row.id]);
    await setBoardNoteLabels(client, row.id, board.id, labels);

    if (!row.board_id) {
      await removeUnusedPersonalTags(client, row.owner_user_id);
    }
  }

  return { boardId: board.id, ownerUserId: row.owner_user_id };
}


export type NoteHomeTarget =
  | {kind:"ordinary";home:unknown;notebookId?:unknown}
  | {kind:"wiki";spaceId:string;promotion?:boolean}
  | {kind:"personal";createId:string};
// All home transitions, including independent copy identity creation, live here.
export async function changeNoteHome(client:PoolClient,actor:Actor,row:DbNoteRow,target:NoteHomeTarget,cache:BoardAccessCache) {
  if (target.kind === "personal") {
    await client.query(`INSERT INTO notes(id,owner_user_id,title,created_by_user_id,updated_by_user_id) VALUES($1,$2,'',$2,$2)`,[target.createId,actor.id]);
    return {boardId:null,ownerUserId:actor.id};
  }
  if(target.kind === "ordinary") return moveNote(client,actor,row,target.home,target.notebookId,cache);
  target = { ...target, spaceId: target.spaceId.toLowerCase() };
  // Source note was locked first. Never upgrade a SHARE lock held by this path.
  await lockWikiSpaces(client,[...new Set([row.wiki_space_id,target.spaceId].filter((id):id is string=>!!id))],"update");
  const destination=await requireActiveWikiSpace(client,actor,target.spaceId,"update");
  if(row.wiki_space_id) await requireActiveWikiSpace(client,actor,row.wiki_space_id,"update");
  if(target.promotion && (row.wiki_space_id || row.board_id!==destination.board_id || row.archived_at || row.deleted_at))
    throw new WikiRuleError("invalid_wiki_request","Only a live ordinary note in this board can be added.",400);
  if(row.wiki_space_id && row.wiki_space_id!==target.spaceId) {
    // Both sorted space locks and authorization checks precede association locks.
    await client.query("DELETE FROM wiki_page_topics WHERE note_id=$1",[row.id]);
    await client.query("UPDATE wiki_spaces SET home_note_id=NULL,updated_at=clock_timestamp() WHERE id=$1 AND home_note_id=$2",[row.wiki_space_id,row.id]);
  }
  await relocateNoteFiles(client,row.id,row.board_id,destination.board_id,row.owner_user_id);
  await client.query("UPDATE notes SET wiki_space_id=$2,board_id=$3,bucket_id=NULL,notebook_id=NULL,updated_by_user_id=$4,updated_at=clock_timestamp() WHERE id=$1",[row.id,target.spaceId,destination.board_id,actor.id]);
  if(row.board_id!==destination.board_id) {
    await client.query("DELETE FROM note_tag_links WHERE note_id=$1",[row.id]);
    await setBoardNoteLabels(client,row.id,destination.board_id,row.labels);
  }
  return {boardId:destination.board_id,ownerUserId:row.owner_user_id};
}
