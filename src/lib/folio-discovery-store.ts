import "server-only";
import type { TaskboardUserIdentity } from "./taskboard-request";
import {
  requireActor,
  withClient,
  withTransaction,
} from "./notes-store-context";
import {
  requireNote,
  getNoteRowAccess,
  getNoteRowsAccess,
  noteSelectSql,
  type DbNoteRow,
} from "./notes-store-access";
import { listAccessibleBoardsWithClient } from "./taskboard-store";
import {
  folioDocumentAccessSql,
  folioActiveConnectionsCte,
  requireFolioSpace,
} from "./folio-store-access";
import { getBoardAccess } from "./notes-store-access";
import {
  buildNoteSearchQuery,
  getNoteDisplayTitle,
  isUuid,
} from "./notes-model";
import { WikiRuleError } from "./notes-errors";
import { folioFeatureProjection } from "./folio-feature-projection";
import type { FolioDiscoveryInput, FolioHit } from "./folio-features-model";
import {
  normalizeWikiIdSet,
  type WikiMentionResolution,
} from "./wiki-discovery-model";
import { FOLIO_REVISION_SCOPE } from "./folio-model";

export async function resolveFolioMentions(
  user: TaskboardUserIdentity,
  input: { noteIds: string[] },
): Promise<WikiMentionResolution[]> {
  const actor = requireActor(user),
    ids = normalizeWikiIdSet(input.noteIds);
  return withClient(async (client) => {
    const rows = (
      await client.query<DbNoteRow>(
        `${noteSelectSql} WHERE notes.id=ANY($1::uuid[]) AND notes.deleted_at IS NULL`,
        [ids],
      )
    ).rows;
    const found = new Map<string, WikiMentionResolution>(),
      cache = new Map();
    for (const row of rows) {
      const access = await getNoteRowAccess(client, actor, row, cache);
      if (!access.canRead) continue;
      found.set(row.id, {
        noteId: row.id,
        state: "readable",
        title: getNoteDisplayTitle(row.title, row.content_text),
        href: `/folio?note=${row.id}`,
        spaceId: FOLIO_REVISION_SCOPE,
        spaceTitle: "Folio",
        archived: Boolean(
          row.archived_at ||
          row.space_archived_at ||
          (row.folio_kind === "space_page" && !access.canEdit),
        ),
      });
    }
    return ids.map(
      (noteId) => found.get(noteId) ?? { noteId, state: "restricted" },
    );
  });
}
export const invalidFeature = (message = "Invalid Folio request.") =>
  new WikiRuleError("invalid_folio_feature", message, 400);
export function discoveryAccessSql(actor: string, boards: string, connections = "folio_active_connections") {
  return `((notes.folio_kind='document' AND ${folioDocumentAccessSql("notes", actor, connections)}) OR
 (notes.folio_kind='space_page' AND notes.folio_page_space_id IN(SELECT fs.id FROM folio_spaces fs JOIN folio_space_lifecycle fl ON fl.id=fs.id
 LEFT JOIN tasks ft ON ft.id=fs.task_id WHERE NOT fl.inactive AND
 ((fs.kind='personal' AND fs.owner_user_id=${actor}) OR fs.kind='shared' OR (fs.kind='board' AND fs.board_id=ANY(${boards}::uuid[])) OR (fs.kind='task' AND ft.board_id=ANY(${boards}::uuid[]) AND ft.deleted_at IS NULL)))) OR
 (notes.folio_kind IS NULL AND ((notes.board_id IS NULL AND notes.owner_user_id=${actor}) OR notes.board_id=ANY(${boards}::uuid[]))))`;
}
export async function discoverFolio(
  user: TaskboardUserIdentity,
  input: FolioDiscoveryInput = {},
) {
  const actor = requireActor(user),
    q = (input.q ?? "").trim(),
    offset = input.offset ?? 0;
  if (
    q.length > 200 ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 10000
  )
    throw invalidFeature();
  for (const id of [input.spaceId, input.backlinkTo])
    if (id !== undefined && !isUuid(id)) throw invalidFeature();
  return withClient(async (client) => {
    const boards = (
      await listAccessibleBoardsWithClient(client, actor)
    ).boards.map((b) => b.boardId);
    if (input.backlinkTo)
      await requireNote(client, actor, input.backlinkTo, "read", new Map());
    if (input.spaceId)
      await requireFolioSpace(
        client,
        actor,
        input.spaceId,
        async (id) =>
          !!(await getBoardAccess(client, actor, id, new Map()))?.canRead,
      );
    const params: unknown[] = [actor.id, boards],
      bind = (v: unknown) => {
        params.push(v);
        return `$${params.length}`;
      };
    const where = [
      discoveryAccessSql("$1", "$2", "active_folio_connections"),
      "notes.deleted_at IS NULL",
      "notes.archived_at IS NULL",
    ];
    let rank = "";
    if (q) {
      const text = bind(q),
        query = buildNoteSearchQuery(q);
      const term = query ? bind(query) : null;
      where.push(
        input.titleOnly
          ? `notes.title ILIKE '%'||${text}||'%'`
          : `(notes.title ILIKE '%'||${text}||'%' OR notes.content_text ILIKE '%'||${text}||'%' ${term ? `OR notes.search_vector @@ to_tsquery('simple',${term})` : ""})`,
      );
      rank = `(CASE WHEN lower(notes.title)=lower(${text}) THEN 100 WHEN notes.title ILIKE '%'||${text}||'%' THEN 20 ELSE 0 END${term ? ` + ts_rank(notes.search_vector,to_tsquery('simple',${term}))` : ""}) DESC,`;
    }
    if (input.spaceId)
      where.push(
        `(notes.folio_page_space_id=${bind(input.spaceId)} OR notes.id IN(SELECT c.note_id FROM active_folio_connections c WHERE c.space_id IN(WITH RECURSIVE tree AS(SELECT id FROM folio_spaces WHERE id=$${params.length} UNION SELECT s.id FROM folio_spaces s JOIN tree t ON s.parent_id=t.id) SELECT id FROM tree)))`,
      );
    if (input.keyword)
      where.push(
        `EXISTS(SELECT 1 FROM folio_keywords k WHERE k.note_id=notes.id AND k.name ILIKE '%'||${bind(input.keyword.slice(0, 60))}||'%')`,
      );
    if (input.by)
      where.push(
        `EXISTS(SELECT 1 FROM users u WHERE u.display_name ILIKE '%'||${bind(input.by.slice(0, 100))}||'%' AND (u.id=notes.owner_user_id OR EXISTS(SELECT 1 FROM note_versions v WHERE v.note_id=notes.id AND v.author_user_id=u.id)))`,
      );
    for (const [value, op] of [
      [input.before, "<"],
      [input.after, ">="],
    ] as const)
      if (value) {
        if (
          !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
          !Number.isFinite(Date.parse(value))
        )
          throw invalidFeature("Choose a valid date.");
        where.push(`notes.updated_at ${op} ${bind(value)}::date`);
      }
    if (input.due)
      where.push(
        `EXISTS(SELECT 1 FROM folio_note_features f WHERE f.note_id=notes.id AND f.review_due<=CURRENT_DATE AND (f.maintainer_user_id=$1 OR f.maintainer_user_id IS NULL AND notes.owner_user_id=$1))`,
      );
    if (input.templates)
      where.push(
        "EXISTS(SELECT 1 FROM folio_note_features f WHERE f.note_id=notes.id AND f.is_template)",
      );
    if (input.recent)
      where.push(
        "EXISTS(SELECT 1 FROM folio_recent_views r WHERE r.note_id=notes.id AND r.user_id=$1)",
      );
    if (input.backlinkTo)
      where.push(
        `notes.id<>${bind(input.backlinkTo)} AND EXISTS(SELECT 1 FROM note_links l WHERE l.source_note_id=notes.id AND l.target_note_id=$${params.length})`,
      );
    const order =
      input.sort === "title"
        ? "lower(notes.title),"
        : input.sort === "created"
          ? "notes.created_at DESC,"
          : input.sort === "recent" || input.recent
            ? "(SELECT viewed_at FROM folio_recent_views r WHERE r.user_id=$1 AND r.note_id=notes.id) DESC NULLS LAST,"
            : "";
    const rows = (
      await client.query<DbNoteRow>(
        `WITH ${folioActiveConnectionsCte} ${noteSelectSql} WHERE ${where.join(" AND ")} ORDER BY ${rank}${order}notes.updated_at DESC,notes.id LIMIT 41 OFFSET ${bind(offset)}`,
        params,
      )
    ).rows;
    const allowed: DbNoteRow[] = [];
    const cache = new Map();
    const accessByNote = await getNoteRowsAccess(client, actor, rows, cache);
    for (const row of rows)
      if (accessByNote.get(row.id)!.canRead)
        allowed.push(row);
    const selected = allowed.slice(0, 40),
      features = await folioFeatureProjection(
        client,
        selected.map((r) => r.id),
      );
    return {
      notes: selected.map(
        (r) =>
          ({
            id: r.id,
            title: getNoteDisplayTitle(r.title, r.content_text),
            snippet: r.content_text.replace(/\s+/g, " ").slice(0, 200),
            updatedAt: r.updated_at.toISOString(),
            pageSpaceId: r.folio_page_space_id ?? null,
            features: features.get(r.id)!,
          }) satisfies FolioHit,
      ),
      hasMore: allowed.length > 40,
    };
  });
}
export async function readFolioFeatures(
  user: TaskboardUserIdentity,
  noteId: string,
) {
  const actor = requireActor(user);
  return withClient(async (client) => {
    const { row } = await requireNote(client, actor, noteId, "read", new Map());
    return {
      features: (await folioFeatureProjection(client, [row.id])).get(row.id),
      canShare: row.owner_user_id === actor.id,
    };
  });
}
export async function readFolioPreview(
  user: TaskboardUserIdentity,
  noteId: string,
) {
  const actor = requireActor(user);
  return withClient(async (client) => {
    const { row } = await requireNote(client, actor, noteId, "read", new Map());
    return {
      title: getNoteDisplayTitle(row.title, row.content_text),
      snippet: row.content_text.replace(/\s+/g, " ").slice(0, 240),
      updatedAt: row.updated_at.toISOString(),
    };
  });
}
export async function recordFolioView(
  user: TaskboardUserIdentity,
  noteId: string,
) {
  const actor = requireActor(user);
  return withTransaction(async (client) => {
    await requireNote(client, actor, noteId, "read", new Map());
    await client.query(
      "INSERT INTO folio_recent_views(user_id,note_id) VALUES($1,$2) ON CONFLICT(user_id,note_id) DO UPDATE SET viewed_at=clock_timestamp()",
      [actor.id, noteId],
    );
    await client.query(
      "DELETE FROM folio_recent_views WHERE user_id=$1 AND note_id NOT IN(SELECT note_id FROM folio_recent_views WHERE user_id=$1 ORDER BY viewed_at DESC LIMIT 100)",
      [actor.id],
    );
  });
}
export async function setFolioFeatures(
  user: TaskboardUserIdentity,
  noteId: string,
  input: Record<string, unknown>,
) {
  const actor = requireActor(user);
  if (
    Object.keys(input).some(
      (k) =>
        !["maintainerId", "reviewDue", "reviewed", "isTemplate"].includes(k),
    )
  )
    throw invalidFeature();
  if (
    input.maintainerId !== undefined &&
    input.maintainerId !== null &&
    !isUuid(input.maintainerId)
  )
    throw invalidFeature();
  if (
    input.reviewDue !== undefined &&
    input.reviewDue !== null &&
    (typeof input.reviewDue !== "string" ||
      !/^\d{4}-\d{2}-\d{2}$/.test(input.reviewDue) ||
      !Number.isFinite(Date.parse(input.reviewDue)))
  )
    throw invalidFeature("Choose a valid review date.");
  for (const k of ["reviewed", "isTemplate"])
    if (input[k] !== undefined && typeof input[k] !== "boolean")
      throw invalidFeature();
  return withTransaction(async (client) => {
    const { row } = await requireNote(
      client,
      actor,
      noteId,
      "edit",
      new Map(),
      { lock: true },
    );
    if (
      input.maintainerId &&
      !(
        await client.query(
          "SELECT 1 FROM users WHERE id=$1 AND NOT is_disabled",
          [input.maintainerId],
        )
      ).rowCount
    )
      throw invalidFeature("Choose an active maintainer.");
    await client.query(
      "INSERT INTO folio_note_features(note_id) VALUES($1) ON CONFLICT DO NOTHING",
      [row.id],
    );
    const params: unknown[] = [row.id],
      sets: string[] = [];
    for (const [key, column] of [
      ["maintainerId", "maintainer_user_id"],
      ["reviewDue", "review_due"],
      ["isTemplate", "is_template"],
    ])
      if (input[key] !== undefined) {
        params.push(input[key]);
        sets.push(`${column}=$${params.length}`);
      }
    if (input.reviewed) {
      params.push(actor.id);
      sets.push(
        `reviewed_at=clock_timestamp(),reviewed_by_user_id=$${params.length}`,
      );
    }
    if (sets.length)
      await client.query(
        `UPDATE folio_note_features SET ${sets.join(",")} WHERE note_id=$1`,
        params,
      );
    await client.query(
      "SELECT queue_note_revisions(ARRAY['folio']::text[],ARRAY['00000000-0000-4000-8000-000000000014']::uuid[])",
    );
    return {
      features: (await folioFeatureProjection(client, [row.id])).get(row.id),
    };
  });
}
