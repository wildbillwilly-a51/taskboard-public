import "server-only";
import { folioFeatureProjection } from './folio-feature-projection';
import {discoveryAccessSql} from './folio-discovery-store';
import { withNoteBlockIds } from "@/lib/note-outline";
import { createHash, randomUUID } from "node:crypto";
import {
  stableHistoryValue,
  type FolioVersionDetail,
} from "./folio-history-model";
import type { PoolClient } from "pg";
import {
  requireActor,
  withClient,
  withTransaction,
  type Actor,
} from "@/lib/notes-store-context";
import {
  getBoardAccess,
  getNoteRowsAccess,
  loadNoteDetail,
  mapNoteSummary,
  noteSelectSql,
  requireNote,
  requireLinkableTask,
  type DbNoteRow,
} from "@/lib/notes-store-access";
import {
  snapshotWikiNote,
  assertExpectedNoteVersion,
  saveNoteContent,
  rebuildFolioNoteLinks,
  trustedWikiOrigin,
} from "@/lib/notes-content-store";
import { assertNoteContentFormat } from "@/lib/notes-content-format";
import {
  emptyNoteContent,
  isUuid,
  normalizeNoteContent,
  normalizeNoteTitle,
  type NoteContentInput,
} from "@/lib/notes-model";
import { NotesNotFoundError, WikiRuleError } from "@/lib/notes-errors";
import {
  listAccessibleBoardsWithClient,
  restoreArchiveItem,
  stableUuid,
} from "@/lib/taskboard-store";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";
import {
  folioDocumentAccessSql,
  folioActiveConnectionsCte,
  loadFolioMetadataBatch,
  requireFolioSpace,
  visibleFolioSpaces,
} from "@/lib/folio-store-access";
import {
  maxFolioSpaceDepth,
  maxFolioSpaceSelection,
  normalizeFolioSpaceTitle,
  type FolioSpace,
  type FolioListing,
  type FolioSpaceKind,
  type FolioView,
} from "@/lib/folio-model";
import { getNoteAttachmentDiskPath } from "@/lib/note-attachments-store";
import { unlink } from "node:fs/promises";
import { access as diskAccess } from "node:fs/promises";
import {
  defaultFolioPageState,
  normalizeFolioPageState,
  type FolioPageState,
} from "@/lib/folio-model";
import {
  ensureLegacyNotebookSpaces,
  ensurePersonalFolioRoot,
} from "@/lib/folio-legacy-store";

const invalid = (message: string) =>
  new WikiRuleError("invalid_folio_request", message, 400);
const reader = (client: PoolClient, actor: Actor) => {
  const cache = new Map();
  return async (id: string) =>
    Boolean((await getBoardAccess(client, actor, id, cache))?.canRead);
};
const uuid = (id: string) => {
  if (!isUuid(id)) throw invalid("A valid resource ID is required.");
};

export async function ensureFolioTaskSpace(
  client: PoolClient,
  actor: Actor,
  taskId: string,
) {
  const task = await requireLinkableTask(client, actor, taskId, new Map());
  const source = (
    await client.query<{ title: string }>(
      "SELECT title FROM tasks WHERE id=$1 FOR KEY SHARE",
      [task.id],
    )
  ).rows[0];
  const board = (
    await client.query<{ title: string }>(
      "SELECT title FROM boards WHERE id=$1 FOR KEY SHARE",
      [task.board_id],
    )
  ).rows[0];
  let boardSpaceId = stableUuid(`folio:board:${task.board_id}`);
  const id = stableUuid(`folio:task:${task.id}`);
  await client.query(
    `INSERT INTO folio_spaces(id,kind,title,board_id,created_by_user_id) VALUES($1,'board',$2,$3,$4) ON CONFLICT DO NOTHING`,
    [boardSpaceId, board.title.slice(0, 120), task.board_id, actor.id],
  );
  boardSpaceId = (
    await client.query<{ id: string }>(
      "SELECT id FROM folio_spaces WHERE board_id=$1",
      [task.board_id],
    )
  ).rows[0].id;
  await client.query(
    `INSERT INTO folio_spaces(id,kind,title,parent_id,task_id,created_by_user_id) VALUES($1,'task',$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING`,
    [id, source.title.slice(0, 120), boardSpaceId, task.id, actor.id],
  );
  return id;
}
export async function getFolioTaskTarget(
  user: TaskboardUserIdentity,
  taskId: string,
) {
  uuid(taskId);
  const actor = requireActor(user);
  return withTransaction(async (client) => ({
    id: await ensureFolioTaskSpace(client, actor, taskId),
  }));
}

// Mutating a note always locks it first. Connection changes are deltas, so no
// caller can accidentally overwrite another viewer's invisible placements.
export async function changeFolioConnection(
  user: TaskboardUserIdentity,
  noteId: string,
  spaceId: string,
  add: boolean,
) {
  uuid(noteId);
  uuid(spaceId);
  const actor = requireActor(user);
  return withTransaction(async (client) => {
    const { row } = await requireNote(
      client,
      actor,
      noteId,
      "edit",
      new Map(),
      { lock: true },
    );
    if (row.folio_kind !== "document") throw new NotesNotFoundError();
    const space = await requireFolioSpace(
      client,
      actor,
      spaceId,
      reader(client, actor),
    );
    if (space.kind === "personal" && row.owner_user_id !== actor.id)
      throw invalid(
        "Use Favorites to keep a shortcut to another person's note.",
      );
    if (add && space.inactive) throw invalid("Choose an active space.");
    if (add)
      await client.query(
        `INSERT INTO folio_connections(note_id,space_id,created_by_user_id)
      VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
        [noteId, spaceId, actor.id],
      );
    else
      await client.query(
        "DELETE FROM folio_connections WHERE note_id=$1 AND space_id=$2",
        [noteId, spaceId],
      );
    await client.query(
      "UPDATE notes SET updated_at=clock_timestamp(),updated_by_user_id=$2 WHERE id=$1",
      [noteId, actor.id],
    );
    // Removing the final public connection can revoke the editor's own access.
    // Return only a revocation signal rather than fetching a now-inaccessible body.
    try {
      return {
        note: await loadNoteDetail(client, actor, noteId, new Map()),
        unavailable: false,
      };
    } catch (error) {
      if (error instanceof NotesNotFoundError)
        return { note: null, unavailable: true };
      throw error;
    }
  });
}

export async function setFolioFavorite(
  user: TaskboardUserIdentity,
  noteId: string,
  favorite: boolean,
) {
  uuid(noteId);
  const actor = requireActor(user);
  return withTransaction(async (client) => {
    const { row } = await requireNote(
      client,
      actor,
      noteId,
      "read",
      new Map(),
      { readLock: true, lock: true },
    );
    if (row.folio_kind === "space_page") throw new NotesNotFoundError();
    if (favorite)
      await client.query(
        "INSERT INTO folio_favorites(user_id,note_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [actor.id, noteId],
      );
    else
      await client.query(
        "DELETE FROM folio_favorites WHERE user_id=$1 AND note_id=$2",
        [actor.id, noteId],
      );
    return loadNoteDetail(client, actor, noteId, new Map());
  });
}

export async function createFolioNote(
  user: TaskboardUserIdentity,
  input: { title?: unknown; content?: unknown } = {},
) {
  if (Object.keys(input).some((k) => !["title", "content"].includes(k)))
    throw invalid(
      "New notes start in Unconnected. Add connections explicitly after creation.",
    );
  const actor = requireActor(user),
    title = normalizeNoteTitle(input.title);
  const content =
    input.content === undefined
      ? { ...emptyNoteContent, formatVersion: 2 }
      : normalizeNoteContent(input.content);
  return withTransaction(async (client) => {
    const id = await insertFolioDocument(client, actor, title, content);
    return loadNoteDetail(client, actor, id, new Map());
  });
}

export async function insertFolioDocument(
  client: PoolClient,
  actor: Actor,
  title: string,
  content: NoteContentInput,
  personalSpaceId?: string,
) {
  if (content.formatVersion !== 2)
    throw invalid("A supported content format is required.");
  assertNoteContentFormat(content.blocks, 2);
  const id = randomUUID();
  await client.query(
    `INSERT INTO notes(id,owner_user_id,folio_kind,title,content_json,content_markdown,content_text,
      content_format_version,created_by_user_id,updated_by_user_id) VALUES($1,$2,'document',$3,$4::jsonb,$5,$6,2,$2,$2)`,
    [
      id,
      actor.id,
      title,
      JSON.stringify(normalizeNoteContent({ ...content, blocks: withNoteBlockIds(content.blocks, randomUUID) }).blocks),
      content.markdown,
      content.text,
    ],
  );
  if (personalSpaceId) {
    await client.query(
      "INSERT INTO folio_connections(note_id,space_id,created_by_user_id) VALUES ($1,$2,$3)",
      [id, personalSpaceId, actor.id],
    );
  }
  await snapshotWikiNote(client, actor, id, "start");
  await rebuildFolioNoteLinks(client, id, content.blocks, trustedWikiOrigin());
  return id;
}

type FolioSpaceChange = {
  title?: unknown;
  parentId?: string | null;
  archived?: boolean;
  remove?: boolean;
  share?: boolean;
};

export function manageFolioSpace(user: TaskboardUserIdentity, id: string, input: FolioSpaceChange) {
  return manageFolioSpaces(user, [id], input);
}

export async function manageFolioSpaces(
  user: TaskboardUserIdentity,
  ids: string[],
  input: FolioSpaceChange,
) {
  if (!ids.length || ids.length > maxFolioSpaceSelection)
    throw invalid(`Select between 1 and ${maxFolioSpaceSelection} spaces.`);
  const selectedIds = new Set(ids.map(id => {
    uuid(id);
    return id.toLowerCase();
  }));
  const actor = requireActor(user);
  await withTransaction(async (client) => {
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('folio-hierarchy',0))",
    );
    const all = await visibleFolioSpaces(client, actor, reader(client, actor));
    const byId = new Map(all.map(space => [space.id, space]));
    const selected = Array.from(selectedIds, id => {
      const space = byId.get(id);
      if (!space) throw new NotesNotFoundError("Space not found.");
      if (space.kind === "board" || space.kind === "task")
        throw invalid("Manage this task or board in its workspace.");
      if (space.root)
        throw invalid("Your Personal root is permanent. Create or manage a subspace.");
      if (space.legacyNotebookId && (!input.remove || selectedIds.size > 1)) throw invalid(
        "This inherited notebook keeps its existing organization. Create a Folio subspace or connect its notes to another space.",
      );
      if (space.kind === "personal" && input.archived !== undefined)
        throw invalid("Personal spaces stay active. Archive individual notes instead.");
      return space;
    });
    const [space] = selected;
    if (space.legacyNotebookId) {
      const notebook = (await client.query<{id:string;parent_notebook_id:string|null}>(
        "SELECT id,parent_notebook_id FROM note_notebooks WHERE id=$1 AND owner_user_id=$2 FOR NO KEY UPDATE",
        [space.legacyNotebookId,actor.id],
      )).rows[0];
      if (!notebook) throw new WikiRuleError("folio_space_changed",
        "This space changed. Reload Folio and try deleting it again.",409);
      // Notes may have moved this notebook since its Folio projection was read.
      // Synchronize before the delete trigger promotes surviving Folio children.
      await ensureLegacyNotebookSpaces(client,actor);
      await client.query("UPDATE note_notebooks SET parent_notebook_id=$2,updated_at=now() WHERE parent_notebook_id=$1",
        [notebook.id,notebook.parent_notebook_id]);
      await client.query("UPDATE notes SET notebook_id=$2 WHERE notebook_id=$1",
        [notebook.id,notebook.parent_notebook_id]);
      await client.query("DELETE FROM folio_spaces WHERE id=$1",[space.id]);
      // Removing the source prevents the compatibility projection reappearing.
      // Original notes stay Personal; adopting them into Folio remains explicit.
      await client.query("DELETE FROM note_notebooks WHERE id=$1 AND owner_user_id=$2",[notebook.id,actor.id]);
      return;
    }
    if (input.remove) {
      await client.query("DELETE FROM folio_spaces WHERE id=ANY($1::uuid[])", [[...selectedIds]]);
      return;
    }
    // A selected child moves or archives with its selected ancestor.
    const roots = selected.filter(item => {
      for (let ancestor = item.parentId; ancestor; ancestor = byId.get(ancestor)?.parentId ?? null)
        if (selectedIds.has(ancestor)) return false;
      return true;
    });
    const rootIds = roots.map(root => root.id);
    if (selected.length > 1 && input.archived === true && input.parentId === undefined && input.title === undefined) {
      if (selected.some(item => item.archived)) throw invalid("Choose active spaces to archive.");
      await client.query(
        "UPDATE folio_spaces SET archived_at=now(),updated_at=clock_timestamp() WHERE id=ANY($1::uuid[])",
        [rootIds],
      );
      return;
    }
    if (selected.length > 1 && (input.parentId === undefined || input.title !== undefined || input.archived !== undefined))
      throw invalid("Choose one batch action.");
    const parentId = input.parentId === undefined ? space.parentId : input.parentId?.toLowerCase() ?? null;
    const parent = parentId ? byId.get(parentId) : undefined;
    const kind = parent?.kind ?? "shared";
    if ((parentId && (!parent || parent.archived)) || (kind !== "personal" && kind !== "shared"))
      throw invalid("Choose an active Personal or Folio location.");
    if (kind === "personal" && selected.some(item => item.kind !== "personal"))
      throw invalid("Choose a Folio location for shared spaces.");
    if (input.parentId !== undefined && selected.some(item => item.archived))
      throw invalid("Restore archived spaces before moving them.");
    const sharing = kind === "shared" && selected.some(item => item.kind === "personal");
    if (sharing && (input.parentId === undefined || !input.share))
      throw invalid("Moving Personal spaces to Folio makes their contents available to everyone with Taskboard access. Confirm the Folio destination.");

    const ancestors = new Set<string>();
    for (let ancestor = parent; ancestor; ancestor = ancestor.parentId ? byId.get(ancestor.parentId) : undefined) {
      if (selectedIds.has(ancestor.id) || ancestors.has(ancestor.id))
        throw invalid("A space cannot move inside itself.");
      ancestors.add(ancestor.id);
    }
    const children = new Map<string, FolioSpace[]>();
    for (const item of all) {
      if (!item.parentId) continue;
      const siblings = children.get(item.parentId) ?? [];
      siblings.push(item);
      children.set(item.parentId, siblings);
    }
    const sharedIds: string[] = [];
    const visit = (item: FolioSpace, depth: number, share: boolean) => {
      if (depth > maxFolioSpaceDepth)
        throw invalid("This move would nest spaces too deeply.");
      if (share) {
        if (item.kind !== "personal" || item.ownerUserId !== actor.id || item.legacyNotebookId || item.root)
          throw invalid("An inherited or managed subspace prevents this branch from moving to Folio.");
        sharedIds.push(item.id);
      }
      for (const child of children.get(item.id) ?? []) visit(child, depth + 1, share);
    };
    for (const root of roots) visit(root, ancestors.size + 1, kind === "shared" && root.kind === "personal");

    const title = input.title === undefined ? null : normalizeFolioSpaceTitle(input.title);
    if (
      (
        await client.query(
          `SELECT 1 FROM folio_spaces
          WHERE id=ANY($1::uuid[]) OR (
            parent_id IS NOT DISTINCT FROM $2::uuid AND kind=$3 AND owner_user_id IS NOT DISTINCT FROM $4::uuid
          )
          GROUP BY lower(CASE WHEN id=ANY($1::uuid[]) THEN COALESCE($5::text,title) ELSE title END)
          HAVING count(*)>1 AND bool_or(id=ANY($1::uuid[]))`,
          [rootIds, parentId, kind, kind === "personal" ? actor.id : null, title],
        )
      ).rowCount
    )
      throw invalid("That name already exists under this parent.");
    await client.query(
      `UPDATE folio_spaces SET
        title=CASE WHEN id=ANY($1::uuid[]) THEN COALESCE($2::text,title) ELSE title END,
        parent_id=CASE WHEN id=ANY($1::uuid[]) THEN $3::uuid ELSE parent_id END,
        kind=CASE WHEN id=ANY($4::uuid[]) THEN 'shared' ELSE kind END,
        owner_user_id=CASE WHEN id=ANY($4::uuid[]) THEN NULL ELSE owner_user_id END,
        archived_at=CASE WHEN $5::boolean IS NULL THEN archived_at WHEN $5 THEN now() ELSE NULL END,
        updated_at=clock_timestamp()
      WHERE id=ANY($1::uuid[]) OR id=ANY($4::uuid[])`,
      [rootIds, title, parentId, sharedIds, input.archived ?? null],
    );
  });
  if (input.remove) await drainFolioFileCleanup().catch((error) =>
    console.error(
      "Folio file cleanup will retry",
      error instanceof Error ? error.name : "error",
    ),
  );
}

export async function getFolioRevision(user: TaskboardUserIdentity) {
  requireActor(user);
  return withClient(
    async (client) =>
      (
        await client.query<{ revision: string }>(
          "SELECT revision::text FROM note_revisions WHERE scope_kind='folio' AND scope_id='00000000-0000-4000-8000-000000000014'",
        )
      ).rows[0]?.revision ?? "0",
  );
}

export async function restoreFolioTaskSpace(
  user: TaskboardUserIdentity,
  id: string,
) {
  const actor = requireActor(user);
  const space = await withClient((client) =>
    requireFolioSpace(client, actor, id, reader(client, actor)),
  );
  if (space.kind !== "task" || !space.task_id || !space.target_board_id)
    throw new NotesNotFoundError("Task space not found.");
  // Reuse the real task lifecycle authorization and restore the source ID.
  await restoreArchiveItem(user, space.task_id, {
    boardId: space.target_board_id,
  });
}

async function ensureRoot(client: PoolClient, actor: Actor) {
  return ensurePersonalFolioRoot(client, actor.id);
}

async function ensureBoardSpaces(client: PoolClient, actor: Actor) {
  const { boards } = await listAccessibleBoardsWithClient(client, actor);
  // Key-share source rows before inserting FK-backed spaces; a concurrent source
  // deletion either finishes first or waits, never leaves a dangling target.
  const rows = boards.length
    ? (
        await client.query<{ id: string; title: string }>(
          "SELECT id,title FROM boards WHERE id=ANY($1::uuid[]) ORDER BY id FOR KEY SHARE",
          [boards.map((b) => b.boardId)],
        )
      ).rows
    : [];
  for (const board of rows)
    await client.query(
      `INSERT INTO folio_spaces(id,kind,title,board_id,created_by_user_id)
    VALUES($1,'board',$2,$3,$4) ON CONFLICT DO NOTHING`,
      [
        stableUuid(`folio:board:${board.id}`),
        board.title.slice(0, 120) || "Board",
        board.id,
        actor.id,
      ],
    );
}

export async function getFolioLibrary(user: TaskboardUserIdentity) {
  const actor = requireActor(user);
  // The durable outbox also covers pages removed by board/task FK cascades.
  await drainFolioFileCleanup().catch((error) =>
    console.error(
      "Folio file cleanup will retry",
      error instanceof Error ? error.name : "error",
    ),
  );
  return withTransaction(async (client) => {
    const rootSpaceId = await ensureLegacyNotebookSpaces(client, actor);
    await ensureBoardSpaces(client, actor);
    return {
      rootSpaceId,
      spaces: await visibleFolioSpaces(client, actor, reader(client, actor)),
    };
  });
}

// Board children are loaded on expansion/search, not as a giant all-task menu.
export async function browseFolioTasks(
  user: TaskboardUserIdentity,
  boardId: string,
  query = "",
  offset = 0,
) {
  uuid(boardId);
  const actor = requireActor(user);
  if (!Number.isSafeInteger(offset) || offset < 0 || query.length > 300)
    throw invalid("Invalid task search.");
  return withTransaction(async (client) => {
    const canRead = reader(client, actor);
    if (!(await canRead(boardId)))
      throw new NotesNotFoundError("Board not found.");
    await ensureBoardSpaces(client, actor);
    const tasks = (
      await client.query<{ id: string; title: string }>(
        `SELECT id,title FROM tasks
      WHERE board_id=$1 AND parent_task_id IS NULL AND deleted_at IS NULL AND archived_at IS NULL
      AND ($2='' OR title ILIKE '%' || $2 || '%') ORDER BY lower(title),id LIMIT 101 OFFSET $3 FOR KEY SHARE`,
        [boardId, query, offset],
      )
    ).rows;
    const parent = (
      await client.query<{ id: string }>(
        "SELECT id FROM folio_spaces WHERE board_id=$1",
        [boardId],
      )
    ).rows[0].id;
    for (const task of tasks.slice(0, 100))
      await client.query(
        `INSERT INTO folio_spaces(id,kind,title,parent_id,task_id,created_by_user_id)
      VALUES($1,'task',$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
        [
          stableUuid(`folio:task:${task.id}`),
          task.title.slice(0, 120) || "Task",
          parent,
          task.id,
          actor.id,
        ],
      );
    const ids = new Set(
      tasks.slice(0, 100).map((t) => stableUuid(`folio:task:${t.id}`)),
    );
    return {
      spaces: (await visibleFolioSpaces(client, actor, canRead)).filter((s) =>
        ids.has(s.id),
      ),
      hasMore: tasks.length > 100,
    };
  });
}

export async function getFolioSpacePage(
  user: TaskboardUserIdentity,
  spaceId: string,
) {
  return withTransaction(client => getFolioSpacePageInTransaction(client, user, spaceId));
}

// Caller owns the transaction; validation and access match the native action.
export async function getFolioSpacePageInTransaction(
  client: PoolClient,
  user: TaskboardUserIdentity,
  spaceId: string,
) {
  uuid(spaceId);
  const actor = requireActor(user);
  const space = await requireFolioSpace(
    client,
    actor,
    spaceId,
    reader(client, actor),
  );
  const id = stableUuid(`folio:page:${spaceId}`);
  const inserted = await client.query(
    `INSERT INTO notes(id,owner_user_id,folio_kind,folio_page_space_id,title,content_format_version,
    created_by_user_id,updated_by_user_id) VALUES($1,$2,'space_page',$3,$4,2,$2,$2) ON CONFLICT(folio_page_space_id) DO NOTHING RETURNING id`,
    [id, space.owner_user_id ?? actor.id, spaceId, space.title],
  );
  if (inserted.rowCount) await snapshotWikiNote(client, actor, id, "start");
  const page = (
    await client.query<{ id: string }>(
      "SELECT id FROM notes WHERE folio_page_space_id=$1",
      [spaceId],
    )
  ).rows[0];
  return loadNoteDetail(client, actor, page.id, new Map());
}

export async function searchFolioTargets(
  user: TaskboardUserIdentity,
  query: string,
  offset = 0,
) {
  const actor = requireActor(user);
  if (
    !query.trim() ||
    query.length > 300 ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    throw invalid("Invalid connection search.");
  return withTransaction(async (client) => {
    await ensureLegacyNotebookSpaces(client, actor);
    await ensureBoardSpaces(client, actor);
    const visible = await visibleFolioSpaces(
      client,
      actor,
      reader(client, actor),
    );
    const basic = visible.filter(
      (s) =>
        !s.archived &&
        s.kind !== "task" &&
        s.title.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
    );
    const picked = basic.slice(offset, offset + 100),
      take = 100 - picked.length;
    const boards = visible.filter((s) => s.kind === "board" && !s.archived),
      parents = new Map(boards.map((s) => [s.boardId, s.id]));
    const tasks = (
      await client.query<{ id: string; title: string; board_id: string }>(
        `SELECT id,title,board_id FROM tasks WHERE board_id=ANY($1::uuid[])
      AND parent_task_id IS NULL AND archived_at IS NULL AND deleted_at IS NULL AND title ILIKE '%' || $2 || '%'
      ORDER BY lower(title),id LIMIT $3 OFFSET $4 FOR KEY SHARE`,
        [
          boards.map((s) => s.boardId),
          query,
          take + 1,
          Math.max(0, offset - basic.length),
        ],
      )
    ).rows;
    const selected = tasks.slice(0, take);
    if (selected.length)
      await client.query(
        `INSERT INTO folio_spaces(id,kind,title,parent_id,task_id,created_by_user_id)
      SELECT x.id,'task',x.title,x.parent_id,x.task_id,$5 FROM unnest($1::uuid[],$2::text[],$3::uuid[],$4::uuid[]) AS x(id,title,parent_id,task_id) ON CONFLICT DO NOTHING`,
        [
          selected.map((t) => stableUuid(`folio:task:${t.id}`)),
          selected.map((t) => t.title.slice(0, 120)),
          selected.map((t) => parents.get(t.board_id)),
          selected.map((t) => t.id),
          actor.id,
        ],
      );
    const ids = new Set(selected.map((t) => stableUuid(`folio:task:${t.id}`)));
    return {
      spaces: [
        ...picked,
        ...(
          await visibleFolioSpaces(client, actor, reader(client, actor))
        ).filter((s) => ids.has(s.id)),
      ],
      hasMore: basic.length > offset + 100 || tasks.length > take,
    };
  });
}

export async function listFolioNotes(
  user: TaskboardUserIdentity,
  input: { view: FolioView; query?: string; offset?: number; limit?: number },
) {
  const actor = requireActor(user),
    limit = input.limit ?? 100,
    offset = input.offset ?? 0;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 100 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    (input.query?.length ?? 0) > 300
  )
    throw invalid("Invalid note listing.");
  return withClient(async (client) => {
    const params: unknown[] = [actor.id];
    const bind = (value: unknown) => {
      params.push(value);
      return `$${params.length}`;
    };
    const accessible = await listAccessibleBoardsWithClient(client, actor);
    const boards = bind(accessible.boards.map((b) => b.boardId));
    const where = [
      input.view.kind==='search'?discoveryAccessSql('$1',boards,"active_folio_connections"):`((notes.folio_kind='document' AND ${folioDocumentAccessSql("notes", "$1", "active_folio_connections")})
      OR (notes.folio_kind IS NULL AND ((notes.board_id IS NULL AND notes.owner_user_id=$1) OR notes.board_id=ANY(${boards}::uuid[]))))`,
    ];
    where.push(
      input.view.kind === "trash"
        ? "notes.deleted_at IS NOT NULL"
        : "notes.deleted_at IS NULL",
    );
    if (input.view.kind !== "trash")
      where.push(
        input.view.kind === "archive"
          ? "notes.archived_at IS NOT NULL"
          : "notes.archived_at IS NULL",
      );
    if (input.view.kind === "favorites")
      where.push(
        "EXISTS(SELECT 1 FROM folio_favorites f WHERE f.note_id=notes.id AND f.user_id=$1)",
      );
    if (input.view.kind === "unconnected")
      where.push(
        "notes.folio_kind='document' AND notes.id NOT IN(SELECT c.note_id FROM active_folio_connections c)",
      );
    if (input.view.kind === "space") {
      uuid(input.view.spaceId);
      const space = await requireFolioSpace(
        client,
        actor,
        input.view.spaceId,
        reader(client, actor),
      );
      if (space.inactive)
        return { notes: [], hasMore: false, offset } satisfies FolioListing;
      const id = bind(space.id);
      let legacy = "FALSE";
      if (space.kind === "personal")
        legacy = `notes.board_id IS NULL AND notes.owner_user_id=$1 AND (${space.is_root ? "TRUE" : `notes.notebook_id IN (WITH RECURSIVE tree AS (SELECT id,legacy_notebook_id FROM folio_spaces WHERE id=${id} UNION SELECT s.id,s.legacy_notebook_id FROM folio_spaces s JOIN tree p ON s.parent_id=p.id) SELECT legacy_notebook_id FROM tree)`})`;
      if (space.kind === "board")
        legacy = `notes.board_id=${bind(space.board_id)} OR EXISTS(SELECT 1 FROM note_task_links l JOIN tasks t ON t.id=l.task_id WHERE l.note_id=notes.id AND t.board_id=$${params.length} AND t.deleted_at IS NULL)`;
      if (space.kind === "task")
        legacy = `EXISTS(SELECT 1 FROM note_task_links l WHERE l.note_id=notes.id AND l.task_id=${bind(space.task_id)})`;
      where.push(`(notes.id IN(SELECT ac.note_id FROM active_folio_connections ac WHERE ac.space_id IN (
        WITH RECURSIVE tree AS (SELECT id FROM folio_spaces WHERE id=${id}
          UNION SELECT s.id FROM folio_spaces s JOIN tree p ON s.parent_id=p.id) SELECT id FROM tree)) OR (notes.folio_kind IS NULL AND (${legacy})))`);
    }
    let relevance='';
    if (input.query?.trim()) {
      const term=bind(input.query.trim());
      where.push(`(notes.title ILIKE '%' || ${term} || '%' OR notes.content_text ILIKE '%' || ${term} || '%' OR notes.search_vector @@ websearch_to_tsquery('simple',${term}))`);
      relevance=`(CASE WHEN lower(notes.title)=lower(${term}) THEN 100 WHEN notes.title ILIKE '%'||${term}||'%' THEN 20 ELSE 0 END + ts_rank(notes.search_vector,websearch_to_tsquery('simple',${term}))) DESC,`;
    }
    const rows = (
      await client.query<DbNoteRow>(
        `WITH ${folioActiveConnectionsCte} ${noteSelectSql} WHERE ${where.join(" AND ")}
      ORDER BY ${relevance} notes.updated_at DESC,notes.id LIMIT ${bind(limit + 1)} OFFSET ${bind(offset)}`,
        params,
      )
    ).rows;
    const selected = rows.slice(0, limit);
    const metadata = await loadFolioMetadataBatch(
      client,
      actor,
      selected.filter((r) => Boolean(r.folio_kind)),
      reader(client, actor),
    );
    const favorites = new Set(
      (
        await client.query<{ note_id: string }>(
          "SELECT note_id FROM folio_favorites WHERE user_id=$1 AND note_id=ANY($2::uuid[])",
          [actor.id, selected.map((r) => r.id)],
        )
      ).rows.map((r) => r.note_id),
    );
    const notes = [];
    const accessByNote = await getNoteRowsAccess(client, actor, selected, new Map());
    for (const row of selected) {
      const access = accessByNote.get(row.id)!;
      if (!access.canRead) continue;
      notes.push({
        ...mapNoteSummary(row, access, 0),
        ...(metadata.has(row.id)
          ? { folio: metadata.get(row.id) }
          : {
              legacy: {
                kind: row.wiki_space_id
                  ? ("wiki" as const)
                  : row.board_id
                    ? ("board" as const)
                    : ("personal" as const),
                placement: row.board_title ?? "Personal",
                canAdopt: access.canEdit,
                favorite: favorites.has(row.id),
              },
            }),
        pinned: favorites.has(row.id),
      });
    }
    const projectedFeatures=await folioFeatureProjection(client,notes.map(n=>n.id));
    return {
      notes:notes.map(n=>({...n,features:projectedFeatures.get(n.id)})),
      hasMore: rows.length > limit,
      offset,
    } satisfies FolioListing;
  });
}

export async function createFolioSpace(
  user: TaskboardUserIdentity,
  input: { title: unknown; parentId: string | null; personal: boolean },
) {
  return withTransaction(client => createFolioSpaceInTransaction(client, user, input));
}

// Caller owns the transaction; validation and access match the native action.
export async function createFolioSpaceInTransaction(
  client: PoolClient,
  user: TaskboardUserIdentity,
  input: { title: unknown; parentId: string | null; personal: boolean },
) {
  const actor = requireActor(user),
    title = normalizeFolioSpaceTitle(input.title);
  if (input.parentId !== null) uuid(input.parentId);
  // Serialize hierarchy edits. Content edits never acquire this lock.
  await client.query(
    "SELECT pg_advisory_xact_lock(hashtextextended('folio-hierarchy',0))",
  );
  let parentId = input.parentId;
  if (input.personal && !parentId) parentId = await ensureRoot(client, actor);
  const kind: FolioSpaceKind = input.personal ? "personal" : "shared";
  if (parentId) {
    const parent = await requireFolioSpace(
      client,
      actor,
      parentId,
      reader(client, actor),
    );
    if (parent.kind !== kind || parent.inactive)
      throw invalid("Choose an active parent in the same library.");
    const depth = (
      await client.query<{ depth: number }>(
        `WITH RECURSIVE parents AS (
      SELECT id,parent_id,1 AS depth FROM folio_spaces WHERE id=$1
      UNION ALL SELECT s.id,s.parent_id,p.depth+1 FROM folio_spaces s JOIN parents p ON s.id=p.parent_id
      WHERE p.depth <= $2) SELECT max(depth)::int AS depth FROM parents`,
        [parentId, maxFolioSpaceDepth],
      )
    ).rows[0].depth;
    if (depth >= maxFolioSpaceDepth)
      throw invalid(
        `Spaces can nest at most ${maxFolioSpaceDepth} levels deep.`,
      );
  }
  if (
    (
      await client.query(
        `SELECT 1 FROM folio_spaces WHERE parent_id IS NOT DISTINCT FROM $1::uuid AND kind=$2
    AND owner_user_id IS NOT DISTINCT FROM $3::uuid AND lower(title)=lower($4)`,
        [parentId, kind, input.personal ? actor.id : null, title],
      )
    ).rowCount
  )
    throw invalid("That name already exists under this parent.");
  const id = randomUUID();
  await client.query(
    `INSERT INTO folio_spaces(id,kind,title,parent_id,owner_user_id,created_by_user_id)
    VALUES($1,$2,$3,$4,$5,$6)`,
    [id, kind, title, parentId, input.personal ? actor.id : null, actor.id],
  );
  return { id };
}

export async function drainFolioFileCleanup() {
  return withClient(async (client) => {
    const rows = (
      await client.query<{ stored_name: string }>(
        "SELECT stored_name FROM folio_file_cleanup ORDER BY queued_at LIMIT 100",
      )
    ).rows;
    for (const row of rows) {
      try {
        await unlink(getNoteAttachmentDiskPath(row.stored_name));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      await client.query(
        "DELETE FROM folio_file_cleanup WHERE stored_name=$1",
        [row.stored_name],
      );
    }
  });
}

type FolioVersionRow = {
  id: string;
  note_id: string;
  version_number: number;
  kind: string;
  title: string;
  content_json: unknown[];
  content_markdown: string;
  content_format_version: number;
  attachment_ids: string[];
  author_display_name: string | null;
  author_user_id: string | null;
  saved_at: Date;
  folio_page_state: FolioPageState;
};
export async function folioHistory(
  user: TaskboardUserIdentity,
  noteId: string,
  offset = 0,
  beforeVersion?: number,
) {
  uuid(noteId);
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw invalid("Invalid history offset.");
  if (
    beforeVersion !== undefined &&
    (!Number.isSafeInteger(beforeVersion) || beforeVersion < 1 || offset !== 0)
  )
    throw invalid("Invalid history cursor.");
  const actor = requireActor(user);
  return withClient(async (client) => {
    await requireNote(client, actor, noteId, "read", new Map(), {
      allowDeleted: true,
    });
    const rows = (
      await client.query<FolioVersionRow>(
        `SELECT v.*,coalesce(u.display_name,CASE WHEN v.author_share_id IS NOT NULL THEN 'Shared-link editor' END) AS author_display_name FROM note_versions v
      LEFT JOIN users u ON u.id=v.author_user_id WHERE v.note_id=$1 AND ($3::int IS NULL OR version_number<$3) ORDER BY version_number DESC LIMIT 51 OFFSET $2`,
        [noteId, offset, beforeVersion ?? null],
      )
    ).rows;
    return {
      versions: rows.slice(0, 50).map((v) => ({
        id: v.id,
        version: v.version_number,
        title: v.title,
        author: v.author_display_name,
        savedAt: v.saved_at.toISOString(),
        kind: v.kind,
      })),
      hasMore: rows.length > 50,
      nextBeforeVersion: rows.length > 50 ? rows[49].version_number : null,
    };
  });
}
function folioSnapshotToken(v: FolioVersionRow) {
  return createHash("sha256")
    .update(
      stableHistoryValue({
        id: v.id,
        noteId: v.note_id,
        title: v.title,
        content: v.content_json,
        markdown: v.content_markdown,
        format: v.content_format_version,
        files: v.attachment_ids,
        pageState: v.folio_page_state,
        author: v.author_user_id,
        savedAt: v.saved_at.toISOString(),
      }),
    )
    .digest("hex");
}
export async function getFolioHistoryVersion(
  user: TaskboardUserIdentity,
  noteId: string,
  versionId: string,
): Promise<FolioVersionDetail> {
  uuid(noteId);
  uuid(versionId);
  const actor = requireActor(user);
  return withTransaction(async (client) => {
    // Current full-set note authorization precedes all historical body/file reads.
    const { row: note } = await requireNote(
      client,
      actor,
      noteId,
      "read",
      new Map(),
      { allowDeleted: true, lock: true, readLock: true },
    );
    const v = (
      await client.query<FolioVersionRow>(
        "SELECT v.*,coalesce(u.display_name,CASE WHEN v.author_share_id IS NOT NULL THEN 'Shared-link editor' END) AS author_display_name FROM note_versions v LEFT JOIN users u ON u.id=v.author_user_id WHERE v.note_id=$1 AND v.id=$2",
        [noteId, versionId],
      )
    ).rows[0];
    if (!v) throw new NotesNotFoundError("Version not found.");
    const files = (
      await client.query<{
        id: string;
        original_name: string;
        mime_type: string;
        size_bytes: string;
        stored_name: string;
        removed_at: Date | null;
      }>(
        "SELECT id,original_name,mime_type,size_bytes,stored_name,removed_at FROM note_attachments WHERE note_id=$1 AND id=ANY($2::uuid[]) ORDER BY created_at,id",
        [noteId, v.attachment_ids],
      )
    ).rows;
    const readableFiles = !(note.deleted_at && !note.wiki_space_id);
    const attachments = await Promise.all(
      files.map(async (f) => ({
        id: f.id,
        name: f.original_name,
        mimeType: f.mime_type,
        sizeBytes: Number(f.size_bytes),
        removed: Boolean(f.removed_at),
        available:
          readableFiles &&
          (await diskAccess(getNoteAttachmentDiskPath(f.stored_name)).then(
            () => true,
            () => false,
          )),
      })),
    );
    return {
      id: v.id,
      version: v.version_number,
      title: v.title,
      author: v.author_display_name,
      savedAt: v.saved_at.toISOString(),
      kind: v.kind,
      content: v.content_json,
      markdown: v.content_markdown,
      format: v.content_format_version,
      attachments,
      unavailableAttachmentIds: v.attachment_ids.filter(
        (id) => !attachments.some((f) => f.id === id && f.available),
      ),
      pageState:
        note.folio_kind === "space_page"
          ? normalizeFolioPageState(v.folio_page_state ?? defaultFolioPageState)
          : null,
      token: folioSnapshotToken(v),
    };
  });
}
export async function restoreFolioVersion(
  user: TaskboardUserIdentity,
  noteId: string,
  versionId: string,
  expectedVersion: number,
  expectedSnapshotToken?: string,
) {
  uuid(noteId);
  uuid(versionId);
  if (
    expectedSnapshotToken !== undefined &&
    !/^[a-f0-9]{64}$/.test(expectedSnapshotToken)
  )
    throw invalid("Invalid history snapshot.");
  const actor = requireActor(user);
  return withTransaction(async (client) => {
    const { row } = await requireNote(
      client,
      actor,
      noteId,
      "edit",
      new Map(),
      { lock: true },
    );
    assertExpectedNoteVersion(expectedVersion, row.content_version);
    const v = (
      await client.query<FolioVersionRow>(
        "SELECT * FROM note_versions WHERE id=$1 AND note_id=$2",
        [versionId, noteId],
      )
    ).rows[0];
    if (!v) throw new NotesNotFoundError("Version not found.");
    if (
      expectedSnapshotToken !== undefined &&
      folioSnapshotToken(v) !== expectedSnapshotToken
    )
      throw new WikiRuleError(
        "folio_history_changed",
        "This revision changed while you were reviewing it. Refresh history before restoring.",
        409,
      );
    assertNoteContentFormat(v.content_json, v.content_format_version);
    const format = row.folio_kind || row.wiki_space_id ? 2 : 1;
    assertNoteContentFormat(v.content_json, format);
    const files = (
      await client.query<{ id: string; stored_name: string }>(
        "SELECT id,stored_name FROM note_attachments WHERE note_id=$1 AND id=ANY($2::uuid[]) ORDER BY id FOR UPDATE",
        [noteId, v.attachment_ids],
      )
    ).rows;
    const available = new Set<string>();
    for (const f of files)
      if (
        await diskAccess(getNoteAttachmentDiskPath(f.stored_name)).then(
          () => true,
          () => false,
        )
      ) {
        available.add(f.id);
        await client.query(
          "UPDATE note_attachments SET removed_at=NULL WHERE id=$1",
          [f.id],
        );
      }
    const state = normalizeFolioPageState(
      v.folio_page_state ?? defaultFolioPageState,
    );
    if (state.bannerAttachmentId && !available.has(state.bannerAttachmentId))
      state.bannerAttachmentId = null;
    await saveNoteContent(client, actor, row, {
      title: v.title,
      content: {
        blocks: v.content_json,
        markdown: v.content_markdown,
        text: "",
        formatVersion: format,
      },
      expectedVersion,
      kind: "restore",
      ...(row.folio_kind === "space_page" ? { folioPageState: state } : {}),
    });
    return loadNoteDetail(client, actor, noteId, new Map());
  });
}
