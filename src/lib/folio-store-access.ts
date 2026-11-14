import "server-only";
import type { PoolClient } from "pg";
import type { Actor } from "@/lib/notes-store-context";
import { NotesNotFoundError } from "@/lib/notes-errors";
import { isUuid } from "@/lib/notes-model";
import {
  deriveFolioPlacement,
  folioSpacePath,
  defaultFolioPageState,
  type FolioSpace,
  type FolioSpaceKind,
  type FolioNoteMetadata,
} from "@/lib/folio-model";

export type FolioBoardReader = (boardId: string) => Promise<boolean>;
export type FolioSpaceRow = {
  id: string;
  kind: FolioSpaceKind;
  title: string;
  owner_user_id: string | null;
  parent_id: string | null;
  board_id: string | null;
  task_id: string | null;
  is_root: boolean;
  inactive: boolean;
  page_note_id: string | null;
  target_board_id: string | null;
  target_deleted?: boolean;
  legacy_notebook_id?: string | null;
  target_board_type?: "personal" | "team" | null;
  target_board_title?: string;
  target_board_owner_user_id?: string | null;
  target_board_owner_name?: string | null;
  target_board_team_name?: string | null;
};
export const folioSpaceSelect = `SELECT s.*, l.inactive, t.board_id AS target_board_id, t.deleted_at IS NOT NULL AS target_deleted,
  CASE WHEN s.kind='board' THEN b.title WHEN s.kind='task' THEN t.title ELSE s.title END AS title,
  n.id AS page_note_id, b.board_type AS target_board_type, b.title AS target_board_title,
  b.owner_user_id AS target_board_owner_user_id,
  board_owner.display_name AS target_board_owner_name,
  board_team.name AS target_board_team_name
  FROM folio_spaces s
  JOIN folio_space_lifecycle l ON l.id=s.id
  LEFT JOIN tasks t ON t.id=s.task_id
  LEFT JOIN boards b ON b.id=COALESCE(s.board_id,t.board_id)
  LEFT JOIN users board_owner ON board_owner.id=b.owner_user_id
  LEFT JOIN teams board_team ON board_team.id=b.owner_team_id
  LEFT JOIN notes n ON n.folio_page_space_id=s.id`;

// Use only internal aliases and bound actor parameters. This is independent of
// board membership and of the connection metadata projected to the viewer.
// A listing needs this relation for access and placement. Materialize it once
// per statement so each predicate does not expand its recursive lifecycle view.
export const folioActiveConnectionsCte = `active_folio_connections AS MATERIALIZED (
  SELECT note_id,space_id,kind,owner_user_id FROM folio_active_connections)`;
export function folioDocumentAccessSql(alias: string, actorParameter: string, connections = "folio_active_connections") {
  // Lists use uncorrelated membership sets, allowing one hashed lookup per
  // candidate instead of an estimated scan of the materialized relation for
  // every note. note_id is NOT NULL in the native connection schema.
  if (connections === "active_folio_connections") return `(${alias}.owner_user_id=${actorParameter}
    OR ${alias}.id NOT IN(SELECT ac.note_id FROM ${connections} ac)
    OR ${alias}.id IN(SELECT ac.note_id FROM ${connections} ac WHERE ac.kind<>'personal'))`;
  return `(${alias}.owner_user_id=${actorParameter}
    OR NOT EXISTS(SELECT 1 FROM ${connections} ac WHERE ac.note_id=${alias}.id)
    OR EXISTS(SELECT 1 FROM ${connections} ac WHERE ac.note_id=${alias}.id AND ac.kind<>'personal'))`;
}

export async function canSeeFolioSpace(
  row: FolioSpaceRow,
  actor: Actor,
  canReadBoard: FolioBoardReader,
) {
  if (row.target_deleted) return false;
  if (row.kind === "personal") return row.owner_user_id === actor.id;
  if (row.kind === "shared") return true;
  const boardId = row.kind === "board" ? row.board_id : row.target_board_id;
  return Boolean(boardId && (await canReadBoard(boardId)));
}

export function mapFolioSpace(row: FolioSpaceRow): FolioSpace {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    parentId: row.parent_id,
    ownerUserId: row.owner_user_id,
    boardId: row.kind === "task" ? row.target_board_id : row.board_id,
    taskId: row.task_id,
    root: row.is_root,
    archived: row.inactive,
    pageNoteId: row.page_note_id,
    legacyNotebookId: row.legacy_notebook_id,
    canDelete: !row.is_root && (row.kind === "personal" || row.kind === "shared"),
    ...((row.kind === "board" || row.kind === "task") && row.target_board_type ? {
      boardType: row.target_board_type,
      boardTitle: row.target_board_title,
      boardOwnerUserId: row.target_board_owner_user_id,
      boardOwnerDisplayName: row.target_board_owner_name,
      boardOwnerTeamName: row.target_board_team_name,
    } : {}),
    canManage:
      !row.inactive &&
      !row.legacy_notebook_id &&
      (row.kind === "personal" || row.kind === "shared"),
  };
}

export async function visibleFolioSpaces(
  client: PoolClient,
  actor: Actor,
  canReadBoard: FolioBoardReader,
) {
  const rows = (
    await client.query<FolioSpaceRow>(
      `${folioSpaceSelect}
    WHERE s.owner_user_id IS NULL OR s.owner_user_id=$1 ORDER BY lower(s.title),s.id`,
      [actor.id],
    )
  ).rows;
  const visible: FolioSpace[] = [];
  for (const row of rows)
    if (await canSeeFolioSpace(row, actor, canReadBoard))
      visible.push(mapFolioSpace(row));
  return visible;
}

export async function requireFolioSpace(
  client: PoolClient,
  actor: Actor,
  id: string,
  canReadBoard: FolioBoardReader,
) {
  if (!isUuid(id)) throw new NotesNotFoundError("Space not found.");
  const row = (
    await client.query<FolioSpaceRow>(`${folioSpaceSelect} WHERE s.id=$1`, [id])
  ).rows[0];
  if (!row || !(await canSeeFolioSpace(row, actor, canReadBoard)))
    throw new NotesNotFoundError("Space not found.");
  return row;
}

export async function folioNoteAccess(
  client: PoolClient,
  actor: Actor,
  row: {
    id: string;
    owner_user_id: string;
    folio_kind?: string | null;
    folio_page_space_id?: string | null;
  },
  canReadBoard: FolioBoardReader,
) {
  if (actor.isDisabled) return { canRead: false, canEdit: false };
  if (row.folio_kind === "space_page") {
    if (!row.folio_page_space_id) return { canRead: false, canEdit: false };
    const space = (
      await client.query<FolioSpaceRow>(`${folioSpaceSelect} WHERE s.id=$1`, [
        row.folio_page_space_id,
      ])
    ).rows[0];
    const canRead = Boolean(
      space && (await canSeeFolioSpace(space, actor, canReadBoard)),
    );
    return { canRead, canEdit: canRead && Boolean(space && !space.inactive) };
  }
  const allowed =
    (
      await client.query<{ allowed: boolean }>(
        `SELECT ${folioDocumentAccessSql("n", "$2")} AS allowed
    FROM notes n WHERE n.id=$1 AND n.folio_kind='document'`,
        [row.id, actor.id],
      )
    ).rows[0]?.allowed === true;
  return { canRead: allowed, canEdit: allowed };
}

export async function folioNoteAccessBatch(
  client: PoolClient,
  actor: Actor,
  rows: Parameters<typeof folioNoteAccess>[2][],
  canReadBoard: FolioBoardReader,
) {
  const result = new Map<string, {canRead: boolean; canEdit: boolean}>();
  for (const row of rows) result.set(row.id, {canRead: false, canEdit: false});
  if (actor.isDisabled || !rows.length) return result;
  const documents = rows.filter(row => row.folio_kind === "document");
  if (documents.length) {
    const allowed = await client.query<{id: string; allowed: boolean}>(
      `WITH ${folioActiveConnectionsCte}
       SELECT n.id, ${folioDocumentAccessSql("n", "$2", "active_folio_connections")} AS allowed
       FROM notes n WHERE n.id=ANY($1::uuid[]) AND n.folio_kind='document'`,
      [documents.map(row => row.id), actor.id],
    );
    for (const row of allowed.rows) result.set(row.id, {canRead: row.allowed, canEdit: row.allowed});
  }
  const pages = rows.filter(row => row.folio_kind === "space_page" && row.folio_page_space_id);
  if (pages.length) {
    const spaces = (await client.query<FolioSpaceRow>(
      `${folioSpaceSelect} WHERE s.id=ANY($1::uuid[])`,
      [pages.map(row => row.folio_page_space_id)],
    )).rows;
    const byId = new Map(spaces.map(space => [space.id, space]));
    for (const page of pages) {
      const space = byId.get(page.folio_page_space_id!);
      const canRead = Boolean(space && await canSeeFolioSpace(space, actor, canReadBoard));
      result.set(page.id, {canRead, canEdit: canRead && !space!.inactive});
    }
  }
  return result;
}

type FolioMetadataRow = {
  id: string;
  folio_kind?: "document" | "space_page" | null;
  folio_page_space_id?: string | null;
  folio_page_state?: FolioNoteMetadata["pageState"];
};
export async function loadFolioMetadataBatch(
  client: PoolClient,
  actor: Actor,
  rows: FolioMetadataRow[],
  canReadBoard: FolioBoardReader,
) {
  const result = new Map<string, FolioNoteMetadata>();
  if (!rows.length) return result;
  const ids = rows.map((r) => r.id);
  // pg clients serialize requests; concurrent query() on the same client is
  // deprecated. Batch the rows, then issue the three bounded queries in order.
  const active = await client.query<{
    note_id: string;
    space_id: string;
    kind: FolioSpaceKind;
  }>(
    "SELECT note_id,space_id,kind FROM folio_active_connections WHERE note_id=ANY($1::uuid[])",
    [ids],
  );
  const favorites = await client.query<{ note_id: string }>(
    "SELECT note_id FROM folio_favorites WHERE user_id=$1 AND note_id=ANY($2::uuid[])",
    [actor.id, ids],
  );
  const visible = await visibleFolioSpaces(client, actor, canReadBoard);
  const favored = new Set(favorites.rows.map((f) => f.note_id));
  const connections = new Map<string, typeof active.rows>();
  for (const c of active.rows) {
    const list = connections.get(c.note_id) ?? [];
    list.push(c);
    connections.set(c.note_id, list);
  }
  for (const row of rows) {
    const allActive = connections.get(row.id) ?? [],
      activeIds = new Set(allActive.map((c) => c.space_id));
    const pageSpace = visible.find((s) => s.id === row.folio_page_space_id);
    result.set(row.id, {
      kind: row.folio_kind === "space_page" ? "space_page" : "document",
      ...(row.folio_kind === "space_page"
        ? {
            audience:
              pageSpace?.kind === "personal"
                ? ("personal" as const)
                : ("public" as const),
            unconnected: false,
          }
        : deriveFolioPlacement(allActive)),
      favorite: favored.has(row.id),
      connections: visible
        .filter((s) => activeIds.has(s.id))
        .map((s) => ({
          id: s.id,
          kind: s.kind,
          title: s.title,
          parentId: s.parentId,
          path: folioSpacePath(visible, s.id, actor.id),
          taskId: s.taskId,
          boardId: s.boardId,
          boardType: s.boardType,
          boardTitle: s.boardTitle,
          boardOwnerUserId: s.boardOwnerUserId,
          boardOwnerDisplayName: s.boardOwnerDisplayName,
          boardOwnerTeamName: s.boardOwnerTeamName,
        })),
      pageSpaceId: row.folio_page_space_id ?? null,
      pageState: row.folio_page_state ?? { ...defaultFolioPageState },
    });
  }
  return result;
}
export async function loadFolioMetadata(
  client: PoolClient,
  actor: Actor,
  row: FolioMetadataRow,
  canReadBoard: FolioBoardReader,
) {
  return (await loadFolioMetadataBatch(client, actor, [row], canReadBoard)).get(
    row.id,
  )!;
}
