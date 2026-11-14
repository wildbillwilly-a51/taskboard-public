import "server-only";
import type { PoolClient } from "pg";
import { assertBoardAccess, BoardAccessError, buildBoardAccessMetadata, resolveEffectiveBoardAccess, type BoardAccessMetadata } from "@/lib/board-access";
import { NotesNotFoundError, WikiRuleError } from "@/lib/notes-errors";
import { ownedBoardNotes, toIso, type Actor } from "@/lib/notes-store-context";
import { getNoteDisplayTitle, getNoteSnippet, isUuid, resolveNoteAccess, type NoteAccess, type NoteAttachment, type NoteDetail, type NoteLinkedTask, type NoteSummary } from "@/lib/notes-model";
import { getBoardRowById } from "@/lib/taskboard-store";
import type { TaskStatus } from "@/lib/taskboard-data";
import { SubtaskRuleError } from "@/lib/subtask-rule";
import { currentAttachmentPredicate, currentNoteAttachments } from "@/lib/note-attachments-store";
import { buildWikiPageHref } from "@/lib/wiki-model";
import { folioNoteAccess, folioNoteAccessBatch, loadFolioMetadata } from "@/lib/folio-store-access";
import type { FolioPageState } from "@/lib/folio-model";
import { folioFeatureProjection } from './folio-feature-projection';
export type BoardAccessCache = Map<string, BoardAccessMetadata | null>;

export type DbNoteRow = {
  folio_kind?: "document" | "space_page" | null;
  folio_page_space_id?: string | null;
  folio_page_state?: FolioPageState;
  id: string;
  owner_user_id: string;
  board_id: string | null;
  bucket_id: string | null;
  notebook_id: string | null;
  title: string;
  content_text: string;
  content_version: number;
  pinned_at: Date | null;
  archived_at: Date | null;
  deleted_at: Date | null;
  purge_after_at: Date | null;
  created_at: Date;
  updated_at: Date;
  board_title: string | null;
  bucket_title: string | null;
  owner_display_name: string | null;
  updated_by_display_name: string | null;
  labels: string[];
  attachment_count: number;
  wiki_space_id: string | null;
  content_format_version: number;
  space_slug: string | null;
  space_title: string | null;
  space_archived_at: Date | null;
};

export const noteSelectSql = `
  SELECT
    notes.id,
    notes.folio_kind, notes.folio_page_space_id, notes.folio_page_state,
    notes.wiki_space_id, notes.content_format_version,
    wiki_spaces.slug AS space_slug, wiki_spaces.title AS space_title, wiki_spaces.archived_at AS space_archived_at,
    notes.owner_user_id,
    notes.board_id,
    notes.bucket_id,
    notes.notebook_id,
    notes.title,
    notes.content_text,
    notes.content_version,
    notes.pinned_at,
    notes.archived_at,
    notes.deleted_at,
    notes.purge_after_at,
    notes.created_at,
    notes.updated_at,
    boards.title AS board_title,
    buckets.title AS bucket_title,
    owners.display_name AS owner_display_name,
    coalesce(updaters.display_name,CASE WHEN notes.updated_via_share_id IS NOT NULL THEN 'Shared-link editor' END) AS updated_by_display_name,
    CASE
      WHEN notes.folio_kind IS NOT NULL THEN COALESCE((SELECT array_agg(k.name ORDER BY lower(k.name)) FROM folio_keywords k WHERE k.note_id=notes.id),ARRAY[]::text[])
      WHEN notes.board_id IS NULL THEN COALESCE((
        SELECT array_agg(note_tags.name ORDER BY LOWER(note_tags.name))
        FROM note_tag_links
        INNER JOIN note_tags ON note_tags.id = note_tag_links.tag_id
        WHERE note_tag_links.note_id = notes.id
      ), ARRAY[]::text[])
      ELSE COALESCE((
        SELECT array_agg(labels.name ORDER BY LOWER(labels.name))
        FROM note_labels
        INNER JOIN labels ON labels.id = note_labels.label_id
        WHERE note_labels.note_id = notes.id
      ), ARRAY[]::text[])
    END AS labels,
    (
      SELECT COUNT(*)::int
      FROM note_attachments
      WHERE note_attachments.note_id = notes.id AND ${currentAttachmentPredicate("note_attachments")}
    ) AS attachment_count
  FROM notes
  LEFT JOIN wiki_spaces ON wiki_spaces.id = notes.wiki_space_id
  LEFT JOIN boards ON boards.id = notes.board_id
  LEFT JOIN buckets ON buckets.id = notes.bucket_id
  LEFT JOIN users owners ON owners.id = notes.owner_user_id
  LEFT JOIN users updaters ON updaters.id = notes.updated_by_user_id
`;

export async function resolveNotesBoard(
  client: PoolClient,
  actor: Actor,
  boardId: unknown,
  required: "read" | "edit",
) {
  if (!isUuid(boardId)) {
    throw new BoardAccessError("invalid_board_id", "boardId must be a valid UUID.", 400);
  }

  const board = await getBoardRowById(client, boardId);

  if (!board) {
    throw new BoardAccessError("board_not_found", "Board not found.", 404);
  }

  const owned=ownedBoardNotes.getStore();
  if(owned && (boardId!==owned.boardId || board.owner_user_id!==owned.userId || board.board_type!=="personal"))throw new NotesNotFoundError();
  const boardAccess = owned ? buildBoardAccessMetadata({boardId:board.id,level:"owner",source:"owner"}) : await resolveEffectiveBoardAccess(client, actor, board);
  assertBoardAccess(boardAccess, required);
  return { board, boardAccess };
}

// Board access for a board, or null when the user has none. Cached per call so
// lists and link filtering check each board once.
export async function getBoardAccess(
  client: PoolClient,
  actor: Actor,
  boardId: string,
  cache: BoardAccessCache,
) {
  const owned=ownedBoardNotes.getStore();
  if(owned && boardId!==owned.boardId)return null;
  if (cache.has(boardId)) {
    return cache.get(boardId) ?? null;
  }

  let access: BoardAccessMetadata | null = null;

  try {
    access = (await resolveNotesBoard(client, actor, boardId, "read")).boardAccess;
  } catch (error) {
    if (!(error instanceof BoardAccessError)) {
      throw error;
    }
  }

  cache.set(boardId, access);
  return access;
}

export async function getNoteRowAccess(
  client: PoolClient,
  actor: Actor,
  row: Pick<DbNoteRow, "id" | "owner_user_id" | "board_id" | "space_archived_at" | "folio_kind" | "folio_page_space_id">,
  cache: BoardAccessCache,
): Promise<NoteAccess & {canManage?: boolean}> {
  if (row.folio_kind) {
    if (ownedBoardNotes.getStore()) return { canRead: false, canEdit: false, canManage: false };
    const access = await folioNoteAccess(client, actor, row,
      async id => Boolean((await getBoardAccess(client, actor, id, cache))?.canRead));
    return { ...access, canManage: access.canEdit };
  }
  const boardAccess = row.board_id ? await getBoardAccess(client, actor, row.board_id, cache) : null;

  const access = resolveNoteAccess({
    userId: actor.id,
    userIsDisabled: actor.isDisabled,
    ownerUserId: row.owner_user_id,
    boardId: row.board_id,
    boardAccess,
  });
  return { ...access, canManage: boardAccess?.canManage ?? false, canEdit: access.canEdit && !row.space_archived_at };
}

export async function loadNoteRow(client: PoolClient, noteId: string) {
  const result = await client.query<DbNoteRow>(`${noteSelectSql} WHERE notes.id = $1`, [noteId]);
  return result.rows[0] ?? null;
}

// Preserve the single-note rules while keeping list access reads bounded by
// note kinds/boards rather than issuing one recursive query per document.
export async function getNoteRowsAccess(
  client: PoolClient,
  actor: Actor,
  rows: Parameters<typeof getNoteRowAccess>[2][],
  cache: BoardAccessCache,
) {
  const result = new Map<string, NoteAccess & {canManage?: boolean}>();
  const folio = ownedBoardNotes.getStore() ? new Map<string, {canRead: boolean; canEdit: boolean}>() : await folioNoteAccessBatch(
    client, actor, rows.filter(row => row.folio_kind),
    async id => Boolean((await getBoardAccess(client, actor, id, cache))?.canRead),
  );
  for (const row of rows) {
    if (row.folio_kind) {
      const access = folio.get(row.id) ?? {canRead: false, canEdit: false};
      result.set(row.id, {...access, canManage: access.canEdit});
    } else result.set(row.id, await getNoteRowAccess(client, actor, row, cache));
  }
  return result;
}

// Loads a note the actor may use. A note the actor cannot read is reported as
// not found, so its existence is never revealed.
export async function requireNote(
  client: PoolClient,
  actor: Actor,
  noteId: string,
  level: "read" | "edit",
  cache: BoardAccessCache,
  options: { allowDeleted?: boolean; lock?: boolean; spaceLock?: "share" | "update"; deleting?: boolean; readLock?: boolean; skipSpaceLock?: boolean } = {},
) {
  if (!isUuid(noteId)) {
    throw new NotesNotFoundError();
  }

  if (options.lock) {
    await client.query(`SELECT id FROM notes WHERE id = $1 FOR ${options.deleting ? "UPDATE" : options.readLock ? "SHARE" : "NO KEY UPDATE"}`, [noteId]);
  }

  let row = await loadNoteRow(client, noteId);
  if(ownedBoardNotes.getStore() && row?.board_id!==ownedBoardNotes.getStore()!.boardId)throw new NotesNotFoundError();

  if (!row || (row.deleted_at && !options.allowDeleted)) {
    throw new NotesNotFoundError();
  }

  if (row.wiki_space_id && options.lock && !options.readLock && !options.skipSpaceLock) {
    await lockWikiSpaces(client, [row.wiki_space_id], options.spaceLock ?? "share");
    row = (await loadNoteRow(client, noteId))!;
  }
  const access = await getNoteRowAccess(client, actor, row, cache);

  if (!access.canRead) {
    throw new NotesNotFoundError();
  }

  if (level === "edit" && row.wiki_space_id && !access.canEdit)
    throw new WikiRuleError("wiki_read_only", "This wiki page is read-only.", 403);
  if (level === "edit" && !access.canEdit) {
    throw new BoardAccessError("board_access_denied", "You can read this note but not change it.", 403);
  }

  return { row, access };
}

export async function requireReadableTask(
  client: PoolClient,
  actor: Actor,
  taskId: unknown,
  cache: BoardAccessCache,
) {
  if (!isUuid(taskId)) {
    throw new NotesNotFoundError("Task not found.");
  }

  const result = await client.query<{ id: string; board_id: string; parent_task_id: string | null }>(
    `SELECT id, board_id, parent_task_id FROM tasks WHERE id = $1 AND deleted_at IS NULL LIMIT 1`,
    [taskId],
  );
  const task = result.rows[0];

  if (!task || !(await getBoardAccess(client, actor, task.board_id, cache))?.canRead) {
    throw new NotesNotFoundError("Task not found.");
  }

  return task;
}

// Notes link to a task, never a subtask (see subtask-rule.ts).
export async function requireLinkableTask(client: PoolClient, actor: Actor, taskId: unknown, cache: BoardAccessCache) {
  const task = await requireReadableTask(client, actor, taskId, cache);
  if (task.parent_task_id) throw new SubtaskRuleError();
  return task;
}

export async function requireBucketOnBoard(client: PoolClient, boardId: string, bucketId: unknown) {
  if (!isUuid(bucketId)) {
    throw new Error("Bucket not found.");
  }

  const result = await client.query<{ id: string }>(
    `SELECT id FROM buckets WHERE id = $1 AND board_id = $2 LIMIT 1`,
    [bucketId, boardId],
  );

  if (!result.rows[0]) {
    throw new Error("Bucket not found.");
  }

  return bucketId;
}

export async function requireOwnNotebook(client: PoolClient, actor: Actor, notebookId: unknown) {
  if (!isUuid(notebookId)) {
    throw new NotesNotFoundError("Notebook not found.");
  }

  const result = await client.query<{ id: string; parent_notebook_id: string | null }>(
    `SELECT id, parent_notebook_id FROM note_notebooks WHERE id = $1 AND owner_user_id = $2 LIMIT 1`,
    [notebookId, actor.id],
  );

  if (!result.rows[0]) {
    throw new NotesNotFoundError("Notebook not found.");
  }

  return result.rows[0];
}

export async function countVisibleLinkedTasks(
  client: PoolClient,
  actor: Actor,
  noteIds: string[],
  cache: BoardAccessCache,
) {
  const counts = new Map<string, number>();

  if (noteIds.length === 0) {
    return counts;
  }

  const result = await client.query<{ note_id: string; board_id: string }>(
    `
      SELECT note_task_links.note_id, tasks.board_id
      FROM (SELECT note_id,task_id FROM note_task_links WHERE note_id=ANY($1::uuid[])
        UNION SELECT c.note_id,s.task_id FROM folio_active_connections c JOIN folio_spaces s ON s.id=c.space_id
        WHERE c.note_id=ANY($1::uuid[]) AND s.task_id IS NOT NULL) AS note_task_links
      INNER JOIN tasks ON tasks.id = note_task_links.task_id
      WHERE note_task_links.note_id = ANY($1::uuid[]) AND tasks.deleted_at IS NULL
    `,
    [noteIds],
  );

  for (const row of result.rows) {
    if ((await getBoardAccess(client, actor, row.board_id, cache))?.canRead) {
      counts.set(row.note_id, (counts.get(row.note_id) ?? 0) + 1);
    }
  }

  return counts;
}

export function mapNoteSummary(row: DbNoteRow, access: NoteAccess & {canManage?: boolean}, linkedTaskCount: number): NoteSummary {
  return {
    id: row.id,
    title: row.title,
    displayTitle: getNoteDisplayTitle(row.title, row.content_text),
    snippet: getNoteSnippet(row.title, row.content_text),
    home: row.board_id
      ? {
          kind: "board",
          boardId: row.board_id,
          boardTitle: row.board_title ?? "",
          bucketId: row.bucket_id,
          bucketTitle: row.bucket_id ? row.bucket_title : null,
        }
      : { kind: "personal" },
    notebookId: row.board_id ? null : row.notebook_id,
    labels: row.labels ?? [],
    pinned: row.pinned_at !== null,
    archived: row.archived_at !== null,
    deletedAt: toIso(row.deleted_at),
    purgeAfterAt: toIso(row.purge_after_at),
    ownerUserId: row.owner_user_id,
    ownerDisplayName: row.owner_display_name,
    updatedByDisplayName: row.updated_by_display_name,
    createdAt: toIso(row.created_at) ?? "",
    updatedAt: toIso(row.updated_at) ?? "",
    // Permission only; a trashed note is read-only in the editor until restored.
    canEdit: access.canEdit,
    linkedTaskCount,
    attachmentCount: row.attachment_count,
    ...(row.wiki_space_id ? { wiki: {
      spaceId: row.wiki_space_id, spaceSlug: row.space_slug!, spaceTitle: row.space_title!,
      spaceArchived: !!row.space_archived_at,
      canonicalHref: buildWikiPageHref(row.space_slug!, row.id, getNoteDisplayTitle(row.title, row.content_text)),
      canManage: !!access.canManage,
      canDeletePermanently: !!access.canManage && !!row.deleted_at && !row.space_archived_at,
    } } : {}),
  };
}

export async function loadNoteDetail(
  client: PoolClient,
  actor: Actor,
  noteId: string,
  cache: BoardAccessCache,
): Promise<NoteDetail> {
  const { row, access } = await requireNote(client, actor, noteId, "read", cache, { allowDeleted: true });
  const contentResult = await client.query<{ content_json: unknown; content_markdown: string }>(
    `SELECT content_json, content_markdown FROM notes WHERE id = $1`,
    [noteId],
  );
  const taskResult = await client.query<{
    id: string;
    title: string;
    status: TaskStatus;
    board_id: string;
    board_title: string;
    bucket_id: string | null;
    bucket_title: string | null;
    archived: boolean;
    is_reference:boolean;
  }>(
    `
      SELECT
        tasks.id,
        tasks.title,
        tasks.status,
        tasks.board_id,
        boards.title AS board_title,
        tasks.bucket_id,
        buckets.title AS bucket_title,
        tasks.archived_at IS NOT NULL AS archived
        ,EXISTS(SELECT 1 FROM note_task_links r WHERE r.note_id=$1 AND r.task_id=tasks.id) AS is_reference
      FROM (SELECT task_id,min(created_at) AS created_at FROM (
        SELECT task_id,created_at FROM note_task_links WHERE note_id=$1
        UNION ALL SELECT s.task_id,s.created_at FROM folio_active_connections c JOIN folio_spaces s ON s.id=c.space_id
        WHERE c.note_id=$1 AND s.task_id IS NOT NULL) links GROUP BY task_id) AS note_task_links
      INNER JOIN tasks ON tasks.id = note_task_links.task_id
      INNER JOIN boards ON boards.id = tasks.board_id
      LEFT JOIN buckets ON buckets.id = tasks.bucket_id
      WHERE tasks.deleted_at IS NULL
      ORDER BY note_task_links.created_at ASC, tasks.id ASC
    `,
    [noteId],
  );
  const linkedTasks: NoteLinkedTask[] = [];
  const taskReferenceIds:string[]=[];

  for (const task of taskResult.rows) {
    if ((await getBoardAccess(client, actor, task.board_id, cache))?.canRead) {
      if(task.is_reference)taskReferenceIds.push(task.id);
      linkedTasks.push({
        id: task.id,
        title: task.title,
        status: task.status,
        boardId: task.board_id,
        boardTitle: task.board_title,
        bucketId: task.bucket_id,
        bucketTitle: task.bucket_title,
        archived: task.archived,
      });
    }
  }

  const content = contentResult.rows[0]?.content_json;
  const folio = row.folio_kind ? await loadFolioMetadata(client, actor, row,
    async id => Boolean((await getBoardAccess(client, actor, id, cache))?.canRead)) : undefined;
  const legacyFavorite=!folio&&Boolean((await client.query("SELECT 1 FROM folio_favorites WHERE user_id=$1 AND note_id=$2",[actor.id,row.id])).rowCount);

  return {
    ...mapNoteSummary(row, access, linkedTasks.length),
    features: (await folioFeatureProjection(client,[row.id])).get(row.id),
    ...(!row.folio_kind?{legacy:{kind:row.wiki_space_id?'wiki' as const:row.board_id?'board' as const:'personal' as const,
      placement:row.board_id?[row.board_title,row.bucket_title].filter(Boolean).join(' / '):'Personal',canAdopt:access.canEdit&&!row.deleted_at&&!row.archived_at,favorite:legacyFavorite}}:{}),
    ...(folio ? { folio, pinned: folio.favorite } : {}),
    content: Array.isArray(content) ? content : [],
    contentMarkdown: contentResult.rows[0]?.content_markdown ?? "",
    contentVersion: row.content_version,
    contentFormatVersion: row.content_format_version,
    linkedTasks,
    taskReferenceIds,
    attachments: await listNoteAttachmentRows(client, noteId),
  };
}

export async function listNoteAttachmentRows(client: PoolClient, noteId: string): Promise<NoteAttachment[]> {
  return (await currentNoteAttachments(client, { noteIds: [noteId] })).map(row => ({
    id: row.id, originalName: row.original_name, mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes), createdAt: toIso(row.created_at)!,
  }));
}

// Note locks always precede space locks; take UPDATE immediately for home changes.
export async function lockWikiSpaces(client: PoolClient, ids: string[], mode: "share" | "update") {
  return (await client.query<{id:string;board_id:string;archived_at:Date|null}>(
    `SELECT id,board_id,archived_at FROM wiki_spaces WHERE id=ANY($1::uuid[]) ORDER BY id FOR ${mode === "share" ? "SHARE" : "UPDATE"}`, [ids])).rows;
}
export async function requireActiveWikiSpace(client: PoolClient, actor: Actor, spaceId: string, mode: "share" | "update" = "share") {
  if (!isUuid(spaceId)) throw new WikiRuleError("invalid_wiki_request", "Invalid space id.", 400);
  const space = (await lockWikiSpaces(client, [spaceId], mode))[0];
  if (!space || !(await getBoardAccess(client,actor,space.board_id,new Map()))?.canRead)
    throw new WikiRuleError("wiki_not_found", "Space not found.", 404);
  const access = await getBoardAccess(client,actor,space.board_id,new Map());
  if (space.archived_at || !access?.canEdit) throw new WikiRuleError("wiki_read_only", "This space is read-only.", 403);
  return space;
}
