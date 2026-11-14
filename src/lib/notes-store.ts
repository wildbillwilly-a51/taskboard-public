import "server-only";

import { loadFolioMetadataBatch } from "@/lib/folio-store-access";
import { assertNoteContentFormat } from "@/lib/notes-content-format";
import { mutationUUID,inMutationBatch,writeMutationAttachment,guardMutationAttachment,writeDurableAttachment } from "@/lib/taskboard-mutation-effects";

import { randomUUID } from "node:crypto";
import { NotesNotFoundError, WikiRuleError } from "@/lib/notes-errors";
export { NotesNotFoundError, NoteConflictError, WikiRuleError } from "@/lib/notes-errors";
export { withOwnedBoardNotes } from "@/lib/notes-store-context";
export { getNoteAttachmentDiskPath } from "@/lib/note-attachments-store";
import { requireActor, noteFileTransaction, withClient, withTransaction, withTransactionOnClient } from "@/lib/notes-store-context";
import { noteSelectSql, requireNote, resolveNotesBoard, getBoardAccess, getNoteRowAccess, requireOwnNotebook, requireBucketOnBoard, requireLinkableTask, requireReadableTask, loadNoteDetail, listNoteAttachmentRows, mapNoteSummary, countVisibleLinkedTasks, type DbNoteRow, type BoardAccessCache } from "@/lib/notes-store-access";
import { setPersonalNoteTags, setBoardNoteLabels, removeUnusedPersonalTags, changeNoteHome } from "@/lib/notes-home-store";
import { getNoteAttachmentDiskPath, removeNoteAttachmentFiles } from "@/lib/note-attachments-store";
import { saveNoteContent, snapshotWikiNote } from "@/lib/notes-content-store";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import {
  BoardAccessError,
  buildBoardAccessMetadata,
} from "@/lib/board-access";
import {
  buildNoteSearchQuery,
  getNoteDisplayTitle,
  emptyNoteContent,
  isUuid,
  maxNotebookDepth,
  normalizeNotebookTitle,
  normalizeNoteContent,
  normalizeNoteLabels,
  normalizeNoteTitle,
  noteTrashRetentionMs,
  type Notebook,
  type NoteHomeBoardOption,
  type NoteListFilters,
  type NoteSummary,
  type NoteTagSummary,
} from "@/lib/notes-model";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";
import {
  createRootTaskOnBoard,
  listAccessibleBoardsWithClient,
  maxTaskAttachmentSizeBytes,
  type TaskAttachmentUploadInput,
} from "@/lib/taskboard-store";

async function purgeExpiredNotes(client: PoolClient) {
  const expired = await client.query<{ id: string }>(
    `
      SELECT id
      FROM notes
      WHERE deleted_at IS NOT NULL AND purge_after_at IS NOT NULL AND purge_after_at <= NOW()
      ORDER BY id
      LIMIT 200
      FOR UPDATE SKIP LOCKED
    `,
  );

  if (expired.rows.length === 0) {
    return [];
  }

  return permanentlyDeleteNoteRows(client, expired.rows.map((row) => row.id));
}

async function permanentlyDeleteNoteRows(client: PoolClient, noteIds: string[]) {
  // The caller owns the transaction. Lock and recheck before collecting any
  // filenames, including when this is an explicit permanent deletion.
  const locked = await client.query<{ id: string }>(
    `SELECT id FROM notes WHERE id = ANY($1::uuid[]) AND deleted_at IS NOT NULL ORDER BY id FOR UPDATE`,
    [noteIds],
  );
  const deletedIds = locked.rows.map((row) => row.id);
  const files = await client.query<{ stored_name: string }>(
    `SELECT stored_name FROM note_attachments WHERE note_id = ANY($1::uuid[])`,
    [deletedIds],
  );
  await client.query(`DELETE FROM notes WHERE id = ANY($1::uuid[]) AND deleted_at IS NOT NULL`, [deletedIds]);
  return files.rows.map((row) => row.stored_name);
}

// ---------------------------------------------------------------------------
// Notes

export async function listNotes(user: TaskboardUserIdentity, filters: NoteListFilters) {
  const actor = requireActor(user);

  return withClient(async (client) => {
    // Purge commits before unlinking; subsequent listing uses the same client.
    await removeNoteAttachmentFiles(await withTransactionOnClient(client, purgeExpiredNotes));
    const cache: BoardAccessCache = new Map();
    const params: unknown[] = [];
    const param = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const where: string[] = ["notes.folio_kind IS NULL"];

    if (filters.scope === "personal") {
      where.push(`notes.board_id IS NULL AND notes.owner_user_id = ${param(actor.id)}`);

      if (filters.notebookId === "inbox") {
        where.push(`notes.notebook_id IS NULL`);
      } else if (filters.notebookId) {
        await requireOwnNotebook(client, actor, filters.notebookId);
        where.push(`notes.notebook_id = ${param(filters.notebookId)}`);
      }
    } else if (filters.scope === "board") {
      if (!filters.boardId) {
        throw new Error("boardId is required.");
      }

      const { boardAccess } = await resolveNotesBoard(client, actor, filters.boardId, "read");
      cache.set(boardAccess.boardId, boardAccess);
      where.push(`notes.board_id = ${param(boardAccess.boardId)}`);

      if (filters.bucketId === "none") {
        where.push(`notes.bucket_id IS NULL`);
      } else if (filters.bucketId) {
        await requireBucketOnBoard(client, boardAccess.boardId, filters.bucketId);
        where.push(`notes.bucket_id = ${param(filters.bucketId)}`);
      }
    } else {
      const { boards } = await listAccessibleBoardsWithClient(client, actor);
      const boardIds: string[] = [];

      for (const board of boards) {
        cache.set(
          board.boardId,
          buildBoardAccessMetadata({ boardId: board.boardId, level: board.accessLevel, source: board.source }),
        );
        boardIds.push(board.boardId);
      }

      where.push(
        `((notes.board_id IS NULL AND notes.owner_user_id = ${param(actor.id)}) OR notes.board_id = ANY(${param(boardIds)}::uuid[]))`,
      );
    }

    if (filters.wikiSpaceId !== undefined) {
      if(!isUuid(filters.wikiSpaceId))throw new WikiRuleError("invalid_wiki_request","Invalid wikiSpaceId.",400);
      const space=(await client.query<{board_id:string}>("SELECT board_id FROM wiki_spaces WHERE id=$1",[filters.wikiSpaceId])).rows[0];
      if(!space || !(await getBoardAccess(client,actor,space.board_id,cache))?.canRead)throw new WikiRuleError("wiki_not_found","Space not found.",404);
      if(filters.scope === "personal" || (filters.boardId && filters.boardId !== space.board_id))throw new WikiRuleError("invalid_wiki_request","Incompatible wiki filters.",400);
      where.push(`notes.wiki_space_id = ${param(filters.wikiSpaceId)}`);
    }
    if (filters.label) {
      const label = param(filters.label);
      where.push(`(
        EXISTS (
          SELECT 1 FROM note_tag_links
          INNER JOIN note_tags ON note_tags.id = note_tag_links.tag_id
          WHERE note_tag_links.note_id = notes.id AND LOWER(note_tags.name) = LOWER(${label})
        )
        OR EXISTS (
          SELECT 1 FROM note_labels
          INNER JOIN labels ON labels.id = note_labels.label_id
          WHERE note_labels.note_id = notes.id AND LOWER(labels.name) = LOWER(${label})
        )
      )`);
    }

    if (filters.status === "trash") {
      where.push(`notes.deleted_at IS NOT NULL`);
    } else {
      where.push(`notes.deleted_at IS NULL`);
      where.push(filters.status === "archived" ? `notes.archived_at IS NOT NULL` : `notes.archived_at IS NULL`);
    }

    if (filters.pinnedOnly) {
      where.push(`notes.pinned_at IS NOT NULL`);
    }

    const searchQuery = buildNoteSearchQuery(filters.query);

    if (searchQuery) {
      where.push(`notes.search_vector @@ to_tsquery('simple', ${param(searchQuery)})`);
    }

    const orderBy =
      filters.status === "trash"
        ? `notes.deleted_at DESC, notes.id ASC`
        : `(notes.pinned_at IS NULL) ASC, notes.updated_at DESC, notes.id ASC`;
    const result = await client.query<DbNoteRow>(
      `${noteSelectSql}
       WHERE ${where.join(" AND ")}
       ORDER BY ${orderBy}
       LIMIT ${param(filters.limit)} OFFSET ${param(filters.offset)}`,
      params,
    );
    const linkCounts = await countVisibleLinkedTasks(client, actor, result.rows.map((row) => row.id), cache);
    const notes: NoteSummary[] = [];

    for (const row of result.rows) {
      const access = await getNoteRowAccess(client, actor, row, cache);

      if (access.canRead) {
        notes.push(mapNoteSummary(row, access, linkCounts.get(row.id) ?? 0));
      }
    }

    return notes;
  });
}

export async function getNote(user: TaskboardUserIdentity, noteId: string) {
  const actor = requireActor(user);
  return withClient((client) => loadNoteDetail(client, actor, noteId, new Map()));
}

export type CreateNoteInput = {
  title?: unknown;
  content?: unknown;
  boardId?: unknown;
  bucketId?: unknown;
  notebookId?: unknown;
  labels?: unknown;
  linkTaskId?: unknown;
};

export async function createNote(user: TaskboardUserIdentity, input: CreateNoteInput) { return withTransaction(client=>createNoteInTransaction(client,user,input)); }

// Caller owns the transaction. Native UI and confirmed board batches share this core.
export async function createNoteInTransaction(client:PoolClient,user: TaskboardUserIdentity,input: CreateNoteInput) {
  const actor = requireActor(user);
  if(!input || typeof input!=="object" || Array.isArray(input) || Object.keys(input).some(key=>!["title","content","boardId","bucketId","notebookId","labels","linkTaskId"].includes(key)))
    throw new WikiRuleError("invalid_wiki_request","Unknown note control field.",400);
  const title = normalizeNoteTitle(input.title);
  const content = input.content === undefined ? emptyNoteContent : normalizeNoteContent(input.content);
  assertNoteContentFormat(content.blocks, content.formatVersion ?? 1);
  assertNoteContentFormat(content.blocks, 1);
  const labels = normalizeNoteLabels(input.labels);

  // Notebook membership joins serialize with folder deletion before any note
  // row is locked. Otherwise a late FK insert can bypass bulk reparenting.
  if (input.notebookId != null && input.boardId == null)
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('folio-hierarchy',0))");

    const cache: BoardAccessCache = new Map();
    let boardId: string | null = null;
    let bucketId: string | null = null;
    let notebookId: string | null = null;

    if (input.boardId !== undefined && input.boardId !== null) {
      if (typeof input.boardId !== "string") {
        throw new Error("boardId must be a valid UUID.");
      }

      const { board } = await resolveNotesBoard(client, actor, input.boardId, "edit");
      boardId = board.id;

      if (input.bucketId !== undefined && input.bucketId !== null) {
        bucketId = await requireBucketOnBoard(client, board.id, input.bucketId);
      }
    } else if (input.bucketId !== undefined && input.bucketId !== null) {
      throw new Error("A bucket home needs its boardId.");
    } else if (input.notebookId !== undefined && input.notebookId !== null) {
      notebookId = (await requireOwnNotebook(client, actor, input.notebookId)).id;
    }

    const noteId = mutationUUID();
    await client.query(
      `
        INSERT INTO notes (
          id, owner_user_id, board_id, bucket_id, notebook_id, title,
          content_json, content_markdown, content_text, created_by_user_id, updated_by_user_id
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $2, $2)
      `,
      [
        noteId,
        actor.id,
        boardId,
        bucketId,
        notebookId,
        title,
        JSON.stringify(content.blocks),
        content.markdown,
        content.text,
      ],
    );

    if (boardId) {
      await setBoardNoteLabels(client, noteId, boardId, labels);
    } else {
      await setPersonalNoteTags(client, noteId, actor.id, labels);
    }

    if (input.linkTaskId !== undefined && input.linkTaskId !== null) {
      const task = await requireLinkableTask(client, actor, input.linkTaskId, cache);
      await client.query(
        `INSERT INTO note_task_links (note_id, task_id, created_by_user_id) VALUES ($1, $2, $3)`,
        [noteId, task.id, actor.id],
      );
    }

    return loadNoteDetail(client, actor, noteId, cache);

}

export type UpdateNoteInput = {
  folioPageState?: unknown;
  title?: unknown;
  content?: unknown;
  expectedVersion?: unknown;
  pinned?: unknown;
  archived?: unknown;
  notebookId?: unknown;
  labels?: unknown;
  // Moves the note: { boardId: null } makes it the mover's personal note;
  // { boardId, bucketId? } puts it on a board.
  home?: unknown;
};

export async function updateNote(user: TaskboardUserIdentity, noteId: string, input: UpdateNoteInput) { return withTransaction(client=>updateNoteInTransaction(client,user,noteId,input)); }

// Caller owns the transaction. Native UI and confirmed board batches share this core.
export async function updateNoteInTransaction(client:PoolClient,user: TaskboardUserIdentity,noteId: string,input: UpdateNoteInput) {
  const actor = requireActor(user);

  if (input?.notebookId != null)
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('folio-hierarchy',0))");

    const cache: BoardAccessCache = new Map();
    const { row } = await requireNote(client, actor, noteId, "edit", cache, { lock: true });
    // Legacy caller-client adapters retain their plain-text source alongside
    // normalized content. Only content controls the stored document.
    if(!input || typeof input!=="object" || Array.isArray(input) || Object.keys(input).some(key=>!["title","content","text","expectedVersion","pinned","archived","notebookId","labels","home","folioPageState"].includes(key)))
      throw new WikiRuleError("invalid_wiki_request","Unknown note control field.",400);
    // Route adapters materialize absent fields as undefined. JSON null/no-op
    // values are still supplied changes and must be refused on wiki pages.
    if(row.wiki_space_id && (input.home !== undefined || input.notebookId !== undefined))
      throw new WikiRuleError("wiki_home_change_forbidden","Use a wiki move for this page.",409);
    if (row.folio_kind && (input.home !== undefined || input.notebookId !== undefined || input.pinned !== undefined))
      throw new WikiRuleError("folio_connections_required", "Use Folio connections and Favorites for this note.", 409);
    if (row.folio_kind === "space_page" && input.archived !== undefined)
      throw new WikiRuleError("folio_space_action_required", "Archive the space instead of its page.", 409);
    let boardId = row.board_id;
    let ownerUserId = row.owner_user_id;
    let touched = false;

    if (input.home !== undefined) {
      const moved = await changeNoteHome(client, actor, row, {kind: "ordinary", home: input.home, notebookId: input.notebookId}, cache);
      boardId = moved.boardId;
      ownerUserId = moved.ownerUserId;
      touched = true;
    } else if (input.notebookId !== undefined) {
      if (boardId) {
        throw new Error("Board notes are organized by bucket, not notebook.");
      }

      const notebookId =
        input.notebookId === null ? null : (await requireOwnNotebook(client, actor, input.notebookId)).id;
      await client.query(`UPDATE notes SET notebook_id = $2 WHERE id = $1`, [row.id, notebookId]);
    }

    if (input.title !== undefined || input.content !== undefined || input.folioPageState !== undefined) {
      await saveNoteContent(client, actor, row, {title:input.title,content:input.content,folioPageState:input.folioPageState,expectedVersion:input.expectedVersion});
      touched = true;
    }

    if (input.labels !== undefined) {
      const labels = normalizeNoteLabels(input.labels);

      if(row.folio_kind) {
        await client.query("DELETE FROM folio_keywords WHERE note_id=$1",[row.id]);
        for(const name of labels)await client.query("INSERT INTO folio_keywords(note_id,name) VALUES($1,$2) ON CONFLICT DO NOTHING",[row.id,name]);
      } else if (boardId) {
        await setBoardNoteLabels(client, row.id, boardId, labels);
      } else {
        await setPersonalNoteTags(client, row.id, ownerUserId, labels);
        await removeUnusedPersonalTags(client, ownerUserId);
      }

      touched = true;
    }

    if (input.pinned !== undefined) {
      if (typeof input.pinned !== "boolean") {
        throw new Error("pinned must be true or false.");
      }

      await client.query(
        `UPDATE notes SET pinned_at = CASE WHEN $2 THEN COALESCE(pinned_at, NOW()) ELSE NULL END WHERE id = $1`,
        [row.id, input.pinned],
      );
    }

    if (input.archived !== undefined) {
      if (typeof input.archived !== "boolean") {
        throw new Error("archived must be true or false.");
      }

      await client.query(
        `UPDATE notes SET archived_at = CASE WHEN $2 THEN COALESCE(archived_at, NOW()) ELSE NULL END WHERE id = $1`,
        [row.id, input.archived],
      );
    }

    if (touched) {
      await client.query(
        `UPDATE notes SET updated_at = NOW(), updated_by_user_id = $2 WHERE id = $1`,
        [row.id, actor.id],
      );
      if(row.wiki_space_id || row.folio_kind)await client.query("UPDATE notes SET updated_at=clock_timestamp() WHERE id=$1",[row.id]);
    }

    return loadNoteDetail(client, actor, row.id, cache);

}

export async function trashNote(user: TaskboardUserIdentity, noteId: string) { return withTransaction(client=>trashNoteInTransaction(client,user,noteId)); }

// Caller owns the transaction. Native UI and confirmed board batches share this core.
export async function trashNoteInTransaction(client:PoolClient,user: TaskboardUserIdentity,noteId: string) {
  const actor = requireActor(user);


    const { row } = await requireNote(client, actor, noteId, "edit", new Map(), { lock: true, spaceLock: "update" });
    if (row.folio_kind === "space_page")
      throw new WikiRuleError("folio_space_action_required", "Delete the space instead of its page.", 409);
    if(row.wiki_space_id) await client.query("UPDATE wiki_spaces SET home_note_id=NULL,updated_at=clock_timestamp() WHERE id=$1 AND home_note_id=$2",[row.wiki_space_id,row.id]);
    await client.query(
      `
        UPDATE notes
        SET deleted_at = NOW(), purge_after_at = NOW() + ($2::bigint * INTERVAL '1 millisecond'), deleted_by_user_id = $3
        WHERE id = $1
      `,
      [row.id, noteTrashRetentionMs, actor.id],
    );

}

export async function restoreNote(user: TaskboardUserIdentity, noteId: string) { return withTransaction(client=>restoreNoteInTransaction(client,user,noteId)); }

// Caller owns the transaction. Native UI and confirmed board batches share this core.
export async function restoreNoteInTransaction(client:PoolClient,user: TaskboardUserIdentity,noteId: string) {
  const actor = requireActor(user);


    const cache: BoardAccessCache = new Map();
    const { row, access } = await requireNote(client, actor, noteId, "edit", cache, {
      allowDeleted: true,
      lock: true,
    });

    if (!access.canEdit) {
      throw new BoardAccessError("board_access_denied", "You can read this note but not change it.", 403);
    }

    if (!row.deleted_at) {
      throw new Error("This note is not in the trash.");
    }

    await client.query(
      `UPDATE notes SET deleted_at = NULL, purge_after_at = NULL, deleted_by_user_id = NULL WHERE id = $1`,
      [row.id],
    );

    return loadNoteDetail(client, actor, row.id, cache);

}

export async function deleteNotePermanently(user: TaskboardUserIdentity, noteId: string) {
  const actor = requireActor(user);
  const storedNames = await withTransaction(async (client) => {
    const { row, access } = await requireNote(client, actor, noteId, "edit", new Map(), {
      allowDeleted: true,
      lock: true, deleting: true,
    });

    if (!access.canEdit) {
      throw new BoardAccessError("board_access_denied", "You can read this note but not change it.", 403);
    }

    if(row.wiki_space_id && !access.canManage) throw new WikiRuleError("wiki_read_only","Only space managers can delete pages permanently.",403);
    if (!row.deleted_at) {
      throw new Error("Move the note to the trash before deleting it permanently.");
    }

    return permanentlyDeleteNoteRows(client, [row.id]);
  });

  await removeNoteAttachmentFiles(storedNames);
}

// ---------------------------------------------------------------------------
// Task links

export async function linkNoteToTask(user: TaskboardUserIdentity, noteId: string, taskId: unknown) { return withTransaction(client=>linkNoteToTaskInTransaction(client,user,noteId,taskId)); }

// Caller owns the transaction. Native UI and confirmed board batches share this core.
export async function linkNoteToTaskInTransaction(client:PoolClient,user: TaskboardUserIdentity,noteId: string,taskId: unknown) {
  const actor = requireActor(user);


    const cache: BoardAccessCache = new Map();
    const { row } = await requireNote(client, actor, noteId, "edit", cache, { lock: true });
    const task = await requireLinkableTask(client, actor, taskId, cache);
    await client.query(
      `
        INSERT INTO note_task_links (note_id, task_id, created_by_user_id)
        VALUES ($1, $2, $3)
        ON CONFLICT DO NOTHING
      `,
      [row.id, task.id, actor.id],
    );

    return loadNoteDetail(client, actor, row.id, cache);

}

export async function unlinkNoteFromTask(user: TaskboardUserIdentity, noteId: string, taskId: string) { return withTransaction(client=>unlinkNoteFromTaskInTransaction(client,user,noteId,taskId)); }

// Caller owns the transaction. Native UI and confirmed board batches share this core.
export async function unlinkNoteFromTaskInTransaction(client:PoolClient,user: TaskboardUserIdentity,noteId: string,taskId: string) {
  const actor = requireActor(user);


    const cache: BoardAccessCache = new Map();
    const { row } = await requireNote(client, actor, noteId, "edit", cache, { lock: true });

    if (isUuid(taskId)) {
      await client.query(`DELETE FROM note_task_links WHERE note_id = $1 AND task_id = $2`, [row.id, taskId]);
    }

    return loadNoteDetail(client, actor, row.id, cache);

}

// Notes linked to a task that the viewer can read. Notes the viewer cannot see
// are left out without a trace.
export async function listTaskLinkedNotes(user: TaskboardUserIdentity, taskId: string) {
  const actor = requireActor(user);

  return withClient(async (client) => {
    const cache: BoardAccessCache = new Map();
    await requireReadableTask(client, actor, taskId, cache);
    const result = await client.query<DbNoteRow>(
      `${noteSelectSql}
       WHERE notes.deleted_at IS NULL AND notes.archived_at IS NULL AND (
         EXISTS(SELECT 1 FROM note_task_links l WHERE l.note_id=notes.id AND l.task_id=$1)
         OR EXISTS(SELECT 1 FROM folio_active_connections c JOIN folio_spaces s ON s.id=c.space_id WHERE c.note_id=notes.id AND s.task_id=$1))
       ORDER BY notes.updated_at DESC, notes.id ASC`,
      [taskId],
    );
    const linkCounts = await countVisibleLinkedTasks(client, actor, result.rows.map((row) => row.id), cache);
    const notes: NoteSummary[] = [];
    const folio=await loadFolioMetadataBatch(client,actor,result.rows.filter(r=>Boolean(r.folio_kind)),async id=>Boolean((await getBoardAccess(client,actor,id,cache))?.canRead));

    for (const row of result.rows) {
      const access = await getNoteRowAccess(client, actor, row, cache);

      if (access.canRead) {
        notes.push({...mapNoteSummary(row, access, linkCounts.get(row.id) ?? 0),...(folio.has(row.id)?{folio:folio.get(row.id),pinned:folio.get(row.id)!.favorite}:{})});
      }
    }

    return notes;
  });
}

export type ConvertNoteToTaskInput = {
  boardId?: unknown;
  bucketId?: unknown;
  title?: unknown;
  timeZone?: unknown;
};

// Creates a task from a note and links them; the note stays as it is.
export async function convertNoteToTask(
  user: TaskboardUserIdentity,
  noteId: string,
  input: ConvertNoteToTaskInput,
) { return withTransaction(client=>convertNoteToTaskInTransaction(client,user,noteId,input)); }

// Caller owns the transaction. Native UI and confirmed board batches share this core.
export async function convertNoteToTaskInTransaction(client:PoolClient,user: TaskboardUserIdentity,noteId: string,input: ConvertNoteToTaskInput) {
  const actor = requireActor(user);


    const cache: BoardAccessCache = new Map();
    const { row } = await requireNote(client, actor, noteId, "edit", cache, { lock: true });
    const requestedBucketId = input.bucketId ?? row.bucket_id;
    let boardId = input.boardId ?? (input.bucketId === undefined ? row.board_id : null);

    if (!requestedBucketId) {
      throw new Error("Choose a bucket for the new task.");
    }

    if (!isUuid(requestedBucketId)) {
      throw new Error("Bucket not found.");
    }

    const bucketId: string = requestedBucketId;

    if (!boardId) {
      const bucketResult = await client.query<{ board_id: string }>(
        `SELECT board_id FROM buckets WHERE id = $1 LIMIT 1`,
        [bucketId],
      );
      boardId = bucketResult.rows[0]?.board_id ?? null;

      if (!boardId) {
        throw new Error("Bucket not found.");
      }
    }

    const requestedTitle = typeof input.title === "string" ? input.title.replace(/\s+/g, " ").trim() : "";
    const title = (requestedTitle || getNoteDisplayTitle(row.title, row.content_text)).slice(0, 300);
    const { board } = await resolveNotesBoard(client, actor, boardId, "edit");
    const taskId = await createRootTaskOnBoard(client, actor, board, {
      bucketId,
      title,
      timeZone: typeof input.timeZone === "string" ? input.timeZone.slice(0, 64) : undefined,
    });
    await client.query(
      `INSERT INTO note_task_links (note_id, task_id, created_by_user_id) VALUES ($1, $2, $3)`,
      [row.id, taskId, actor.id],
    );

    return {
      taskId,
      boardId: board.id,
      note: await loadNoteDetail(client, actor, row.id, cache),
    };

}

// ---------------------------------------------------------------------------
// Notebooks and tags (personal notes)

export async function listNotebooks(user: TaskboardUserIdentity) {
  const actor = requireActor(user);

  return withClient(async (client) => {
    const result = await client.query<{
      id: string;
      title: string;
      parent_notebook_id: string | null;
      sort_order: string;
      note_count: number;
    }>(
      `
        SELECT
          note_notebooks.id,
          note_notebooks.title,
          note_notebooks.parent_notebook_id,
          note_notebooks.sort_order::text AS sort_order,
          (
            SELECT COUNT(*)::int
            FROM notes
            WHERE notes.notebook_id = note_notebooks.id
              AND notes.board_id IS NULL
              AND notes.deleted_at IS NULL
              AND notes.archived_at IS NULL
          ) AS note_count
        FROM note_notebooks
        WHERE note_notebooks.owner_user_id = $1
        ORDER BY note_notebooks.sort_order ASC, LOWER(note_notebooks.title) ASC, note_notebooks.id ASC
      `,
      [actor.id],
    );
    const inboxResult = await client.query<{ count: number }>(
      `
        SELECT COUNT(*)::int AS count
        FROM notes
        WHERE owner_user_id = $1 AND board_id IS NULL AND notebook_id IS NULL
          AND deleted_at IS NULL AND archived_at IS NULL
      `,
      [actor.id],
    );
    const notebooks: Notebook[] = result.rows.map((row) => ({
      id: row.id,
      title: row.title,
      parentNotebookId: row.parent_notebook_id,
      sortOrder: Number(row.sort_order),
      noteCount: row.note_count,
    }));

    return { notebooks, inboxCount: inboxResult.rows[0]?.count ?? 0 };
  });
}

async function getNotebookDepth(client: PoolClient, notebookId: string) {
  const result = await client.query<{ id: string }>(
    `
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_notebook_id, 1 AS depth FROM note_notebooks WHERE id = $1
        UNION ALL
        SELECT parent.id, parent.parent_notebook_id, ancestors.depth + 1
        FROM note_notebooks parent
        INNER JOIN ancestors ON parent.id = ancestors.parent_notebook_id
        WHERE ancestors.depth < 64
      )
      SELECT id FROM ancestors
    `,
    [notebookId],
  );
  return result.rows.map((row) => row.id);
}

async function getNotebookSubtreeHeight(client: PoolClient, notebookId: string) {
  const result = await client.query<{ height: number }>(
    `
      WITH RECURSIVE descendants AS (
        SELECT id, 1 AS height FROM note_notebooks WHERE id = $1
        UNION ALL
        SELECT child.id, descendants.height + 1
        FROM note_notebooks child
        INNER JOIN descendants ON child.parent_notebook_id = descendants.id
        WHERE descendants.height < 64
      )
      SELECT MAX(height)::int AS height FROM descendants
    `,
    [notebookId],
  );
  return result.rows[0]?.height ?? 1;
}

async function nextNotebookSortOrder(client: PoolClient, ownerUserId: string, parentNotebookId: string | null) {
  const result = await client.query<{ next_order: string }>(
    `
      SELECT (COALESCE(MAX(sort_order), 0) + 1000)::text AS next_order
      FROM note_notebooks
      WHERE owner_user_id = $1 AND parent_notebook_id IS NOT DISTINCT FROM $2
    `,
    [ownerUserId, parentNotebookId],
  );
  return Number(result.rows[0]?.next_order ?? "1000");
}

export async function createNotebook(
  user: TaskboardUserIdentity,
  input: { title?: unknown; parentNotebookId?: unknown },
) {
  const actor = requireActor(user);
  const title = normalizeNotebookTitle(input.title);

  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('folio-hierarchy',0))");
    let parentNotebookId: string | null = null;

    if (input.parentNotebookId !== undefined && input.parentNotebookId !== null) {
      parentNotebookId = (await requireOwnNotebook(client, actor, input.parentNotebookId)).id;

      if ((await getNotebookDepth(client, parentNotebookId)).length + 1 > maxNotebookDepth) {
        throw new Error(`Notebooks can nest at most ${maxNotebookDepth} levels deep.`);
      }
    }

    const notebookId = randomUUID();
    await client.query(
      `
        INSERT INTO note_notebooks (id, owner_user_id, parent_notebook_id, title, sort_order)
        VALUES ($1, $2, $3, $4, $5)
      `,
      [notebookId, actor.id, parentNotebookId, title, await nextNotebookSortOrder(client, actor.id, parentNotebookId)],
    );

    return { id: notebookId, title, parentNotebookId };
  });
}

export async function updateNotebook(
  user: TaskboardUserIdentity,
  notebookId: string,
  input: { title?: unknown; parentNotebookId?: unknown; sortOrder?: unknown },
) {
  const actor = requireActor(user);

  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('folio-hierarchy',0))");
    const notebook = await requireOwnNotebook(client, actor, notebookId);

    if (input.title !== undefined) {
      await client.query(
        `UPDATE note_notebooks SET title = $2, updated_at = NOW() WHERE id = $1`,
        [notebook.id, normalizeNotebookTitle(input.title)],
      );
    }

    if (input.parentNotebookId !== undefined) {
      const parentNotebookId =
        input.parentNotebookId === null
          ? null
          : (await requireOwnNotebook(client, actor, input.parentNotebookId)).id;

      if (parentNotebookId) {
        const ancestors = await getNotebookDepth(client, parentNotebookId);

        if (ancestors.includes(notebook.id)) {
          throw new Error("A notebook cannot be moved inside itself.");
        }

        if (ancestors.length + (await getNotebookSubtreeHeight(client, notebook.id)) > maxNotebookDepth) {
          throw new Error(`Notebooks can nest at most ${maxNotebookDepth} levels deep.`);
        }
      }

      await client.query(
        `UPDATE note_notebooks SET parent_notebook_id = $2, sort_order = $3, updated_at = NOW() WHERE id = $1`,
        [notebook.id, parentNotebookId, await nextNotebookSortOrder(client, actor.id, parentNotebookId)],
      );
    }

    if (input.sortOrder !== undefined) {
      if (typeof input.sortOrder !== "number" || !Number.isFinite(input.sortOrder)) {
        throw new Error("sortOrder must be a number.");
      }

      await client.query(
        `UPDATE note_notebooks SET sort_order = $2, updated_at = NOW() WHERE id = $1`,
        [notebook.id, input.sortOrder],
      );
    }
  });
}

// Deleting a notebook keeps its notes and child notebooks: both move up to the
// deleted notebook's parent (or the Inbox and top level).
export async function deleteNotebook(user: TaskboardUserIdentity, notebookId: string) {
  const actor = requireActor(user);

  await withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('folio-hierarchy',0))");
    const notebook = await requireOwnNotebook(client, actor, notebookId);
    await client.query(
      `UPDATE note_notebooks SET parent_notebook_id = $2, updated_at = NOW() WHERE parent_notebook_id = $1`,
      [notebook.id, notebook.parent_notebook_id],
    );
    await client.query(`UPDATE notes SET notebook_id = $2 WHERE notebook_id = $1`, [
      notebook.id,
      notebook.parent_notebook_id,
    ]);
    await client.query(`DELETE FROM note_notebooks WHERE id = $1`, [notebook.id]);
  });
}

export async function listNoteTags(user: TaskboardUserIdentity): Promise<NoteTagSummary[]> {
  const actor = requireActor(user);

  return withClient(async (client) => {
    const result = await client.query<{ name: string; note_count: number }>(
      `
        SELECT
          note_tags.name,
          COUNT(notes.id)::int AS note_count
        FROM note_tags
        LEFT JOIN note_tag_links ON note_tag_links.tag_id = note_tags.id
        LEFT JOIN notes
          ON notes.id = note_tag_links.note_id
          AND notes.deleted_at IS NULL
          AND notes.archived_at IS NULL
        WHERE note_tags.owner_user_id = $1
        GROUP BY note_tags.id, note_tags.name
        ORDER BY LOWER(note_tags.name) ASC
      `,
      [actor.id],
    );

    return result.rows.map((row) => ({ name: row.name, noteCount: row.note_count }));
  });
}

// ---------------------------------------------------------------------------
// Board helpers

export async function listBoardLabels(user: TaskboardUserIdentity, boardId: string) {
  const actor = requireActor(user);

  return withClient(async (client) => {
    const { board } = await resolveNotesBoard(client, actor, boardId, "read");
    const result = await client.query<{ name: string }>(
      `SELECT name FROM labels WHERE board_id = $1 ORDER BY LOWER(name) ASC, name ASC`,
      [board.id],
    );
    const seen = new Set<string>();

    return result.rows
      .map((row) => row.name.trim())
      .filter((name) => {
        const key = name.toLowerCase();

        if (!name || seen.has(key)) {
          return false;
        }

        seen.add(key);
        return true;
      });
  });
}

// Boards the user can read, with their buckets, for the Notes home picker and
// sidebar. canEdit says whether notes can be created or moved there.
export async function listNoteHomeOptions(user: TaskboardUserIdentity): Promise<NoteHomeBoardOption[]> {
  const actor = requireActor(user);

  return withClient(async (client) => {
    const { boards } = await listAccessibleBoardsWithClient(client, actor);

    if (boards.length === 0) {
      return [];
    }

    const result = await client.query<{ id: string; board_id: string; title: string; color: string | null }>(
      `
        SELECT id, board_id, title, color
        FROM buckets
        WHERE board_id = ANY($1::uuid[])
        ORDER BY sort_order ASC, id ASC
      `,
      [boards.map((board) => board.boardId)],
    );
    const bucketsByBoard = new Map<string, NoteHomeBoardOption["buckets"]>();

    for (const row of result.rows) {
      const buckets = bucketsByBoard.get(row.board_id) ?? [];
      buckets.push({ id: row.id, title: row.title, color: row.color });
      bucketsByBoard.set(row.board_id, buckets);
    }

    return boards.map((board) => ({
      boardId: board.boardId,
      title: board.title,
      canEdit: board.canEdit,
      isPersonalBoard: board.isPersonalBoard,
      buckets: bucketsByBoard.get(board.boardId) ?? [],
    }));
  });
}

export async function getBoardNoteCounts(user: TaskboardUserIdentity, boardId: string) {
  const actor = requireActor(user);

  return withClient(async (client) => {
    const { board } = await resolveNotesBoard(client, actor, boardId, "read");
    const result = await client.query<{ bucket_id: string | null; count: number }>(
      `
        SELECT bucket_id, COUNT(*)::int AS count
        FROM notes
        WHERE board_id = $1 AND deleted_at IS NULL AND archived_at IS NULL
        GROUP BY bucket_id
      `,
      [board.id],
    );
    const buckets: Record<string, number> = {};
    let boardNotes = 0;

    for (const row of result.rows) {
      if (row.bucket_id) {
        buckets[row.bucket_id] = row.count;
      } else {
        boardNotes = row.count;
      }
    }

    return { boardId: board.id, boardNotes, buckets };
  });
}

// ---------------------------------------------------------------------------
// Attachments

export async function uploadNoteAttachments(user:TaskboardUserIdentity,noteId:string,files:TaskAttachmentUploadInput[]) {
 const written:string[]=[];
 return withTransaction(client=>uploadNoteAttachmentsInTransaction(client,user,noteId,files,written),()=>removeNoteAttachmentFiles(written));
}

export async function uploadNoteAttachmentsInTransaction(client:PoolClient,user:TaskboardUserIdentity,noteId:string,files:TaskAttachmentUploadInput[],written:string[]=[],limits?:{maxBytes:number}) {
 const maxBytes=limits?.maxBytes??maxTaskAttachmentSizeBytes;
 // Trusted offline imports can preserve original binaries up to 100 MiB. HTTP
 // callers keep their existing 25 MiB admission; this option is never request data.
 if(![maxTaskAttachmentSizeBytes,100*1024*1024].includes(maxBytes))throw new Error('Invalid attachment import limit.');
 const actor=requireActor(user);const {row}=await requireNote(client,actor,noteId,'edit',new Map(),{lock:true});
 if(!files.length)throw new Error('Select at least one file.');
 for(const file of files){
 const originalName=path.basename(file.originalName.replaceAll('\\','/').trim())||'attachment';
 if(file.sizeBytes<=0 || file.sizeBytes>maxBytes || file.sizeBytes!==file.buffer.byteLength)throw new Error(`Attachment must contain 1 byte to ${maxBytes/1024/1024} MB.`);
 const id=mutationUUID(),key=row.board_id ? row.board_id+'/'+row.id+'/'+id : row.id+'/'+id;
 const storedName=row.folio_kind ? 'folio:'+key : row.board_id ? 'task:'+key : `personal:${row.owner_user_id}/${key}`;
 written.push(storedName); noteFileTransaction.getStore()?.created.push(storedName);
 if(row.board_id)await writeMutationAttachment(Buffer.from(file.buffer),key,file.mutationSource ?? 'native:'+id);
 else {if(inMutationBatch())throw new Error('Notes outside this board are unavailable.');await writeDurableAttachment(getNoteAttachmentDiskPath(storedName),file.buffer);}
 await client.query('INSERT INTO note_attachments(id,note_id,uploaded_by_user_id,original_name,stored_name,mime_type,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,row.id,actor.id,originalName,storedName,file.mimeType||'application/octet-stream',file.sizeBytes]);
 }await snapshotWikiNote(client,actor,row.id,"edit",true); return listNoteAttachmentRows(client,row.id);
}

export async function getNoteAttachmentDownload(user: TaskboardUserIdentity, noteId: string, attachmentId: string) {
  const actor = requireActor(user);

  return withClient(async (client) => {
    const { row } = await requireNote(client, actor, noteId, "read", new Map(), {allowDeleted:true});
    if(row.deleted_at && !row.wiki_space_id)throw new NotesNotFoundError();
    const result = await client.query<{
      original_name: string;
      stored_name: string;
      mime_type: string;
      size_bytes: string | number;
    }>(
      `
        SELECT original_name, stored_name, mime_type, size_bytes
        FROM note_attachments
        WHERE id = $1 AND note_id = $2
        LIMIT 1
      `,
      [isUuid(attachmentId) ? attachmentId : null, row.id],
    );
    const attachment = result.rows[0];

    if (!attachment) {
      throw new NotesNotFoundError("Attachment not found.");
    }

    return {
      displayName: attachment.original_name,
      mimeType: attachment.mime_type || "application/octet-stream",
      sizeBytes: Number(attachment.size_bytes),
      content: await readFile(getNoteAttachmentDiskPath(attachment.stored_name)).catch(error=>{
        if((error as NodeJS.ErrnoException).code==="ENOENT")throw new NotesNotFoundError("Attachment not found.");
        throw error;
      }),
    };
  });
}

export async function deleteNoteAttachment(user:TaskboardUserIdentity,noteId:string,attachmentId:string,options:{permanent?:boolean}={}) {
 const stored=await withTransaction(client=>deleteNoteAttachmentInTransaction(client,user,noteId,attachmentId,options));
 if(stored && !inMutationBatch())await removeNoteAttachmentFiles([stored]);
}

export async function deleteNoteAttachmentInTransaction(client:PoolClient,user:TaskboardUserIdentity,noteId:string,attachmentId:string,options:{permanent?:boolean}={}) {
 if(!isUuid(attachmentId))throw new NotesNotFoundError("Attachment not found.");
 const actor=requireActor(user),{row,access}=await requireNote(client,actor,noteId,'edit',new Map(),{lock:true});
 const found=(await client.query<{stored_name:string;removed_at:Date|null}>('SELECT stored_name,removed_at FROM note_attachments WHERE id=$1 AND note_id=$2 FOR UPDATE',[attachmentId,row.id])).rows[0];
 if(!found)throw new NotesNotFoundError('Attachment not found.');
 if(row.folio_kind==='space_page'&&row.folio_page_state?.bannerAttachmentId===attachmentId) {
   await client.query(`UPDATE notes SET folio_page_state=jsonb_set(folio_page_state,'{bannerAttachmentId}','null'::jsonb),
     content_version=content_version+1,updated_at=clock_timestamp(),updated_by_user_id=$2 WHERE id=$1`,[row.id,actor.id]);
 }
 if(row.wiki_space_id || row.folio_kind) {
   if(options.permanent && !access.canManage)throw new WikiRuleError("wiki_read_only","Only space managers can delete files permanently.",403);
   if(!options.permanent) {
     if(found.removed_at)return null;
     await client.query("UPDATE note_attachments SET removed_at=clock_timestamp() WHERE id=$1",[attachmentId]);
     await snapshotWikiNote(client,actor,row.id,"edit",true); return null;
   }
 }
 await guardMutationAttachment(found.stored_name.startsWith('task:')?found.stored_name.slice(5):'note:'+found.stored_name);
 await client.query('DELETE FROM note_attachments WHERE id=$1 AND note_id=$2',[attachmentId,row.id]);
 if((row.wiki_space_id || row.folio_kind) && !found.removed_at) await snapshotWikiNote(client,actor,row.id,"edit",true);
 return found.stored_name;
}
