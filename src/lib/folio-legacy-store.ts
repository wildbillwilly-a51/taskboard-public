import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { stableUuid } from "./taskboard-store";
import {
  requireActor,
  withTransaction,
  type Actor,
} from "./notes-store-context";
import {
  getBoardAccess,
  requireNote,
  loadNoteDetail,
} from "./notes-store-access";
import {
  assertExpectedNoteVersion,
  snapshotWikiNote,
} from "./notes-content-store";
import { assertNoteContentFormat } from "./notes-content-format";
import { requireFolioSpace } from "./folio-store-access";
import { WikiRuleError } from "./notes-errors";
import type { TaskboardUserIdentity } from "./taskboard-request";
export async function ensurePersonalFolioRoot(
  client: PoolClient,
  ownerId: string,
) {
  const id = stableUuid(`folio:personal:${ownerId}`);
  await client.query(
    `INSERT INTO folio_spaces(id,kind,title,owner_user_id,is_root,created_by_user_id)
    SELECT $1,'personal',left(coalesce(nullif(btrim(display_name),''),'Personal'),120),id,true,id FROM users WHERE id=$2 ON CONFLICT DO NOTHING`,
    [id, ownerId],
  );
  return id;
}
export async function ensureLegacyNotebookSpaces(
  client: PoolClient,
  actor: Actor,
) {
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('folio-hierarchy',0))");
  const root = await ensurePersonalFolioRoot(client, actor.id);
  const notebooks = (
    await client.query<{
      id: string;
      title: string;
      parent_notebook_id: string | null;
    }>(
      "SELECT id,title,parent_notebook_id FROM note_notebooks WHERE owner_user_id=$1 ORDER BY id",
      [actor.id],
    )
  ).rows;
  const ids = new Set(notebooks.map((n) => n.id));
  for (const n of notebooks)
    await client.query(
      `INSERT INTO folio_spaces(id,kind,title,parent_id,owner_user_id,legacy_notebook_id,created_by_user_id)
    VALUES($1,'personal',$2,$3,$4,$5,$4) ON CONFLICT(id) DO UPDATE
    SET title=EXCLUDED.title,parent_id=EXCLUDED.parent_id,updated_at=clock_timestamp()
    WHERE folio_spaces.legacy_notebook_id=EXCLUDED.legacy_notebook_id
      AND folio_spaces.owner_user_id=EXCLUDED.owner_user_id
      AND (folio_spaces.title IS DISTINCT FROM EXCLUDED.title OR folio_spaces.parent_id IS DISTINCT FROM EXCLUDED.parent_id)`,
      [
        stableUuid(`folio:notebook:${n.id}`),
        n.title,
        n.parent_notebook_id && ids.has(n.parent_notebook_id)
          ? stableUuid(`folio:notebook:${n.parent_notebook_id}`)
          : root,
        actor.id,
        n.id,
      ],
    );
  return root;
}
// No eager content migration: legacy homes retain their original access. The
// explicit, version-checked adoption is the one boundary into Folio sharing.
export async function adoptLegacyFolioNote(
  user: TaskboardUserIdentity,
  noteId: string,
  spaceId: string,
  expectedVersion: number,
) {
  const actor = requireActor(user);
  return withTransaction(async (client) => {
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended('folio-hierarchy',0))");
    const cache = new Map();
    const { row } = await requireNote(client, actor, noteId, "edit", cache, {
      lock: true,
    });
    if (row.folio_kind)
      throw new WikiRuleError(
        "invalid_folio_request",
        "This note already uses Folio connections. Reload it.",
        409,
      );
    assertExpectedNoteVersion(expectedVersion, row.content_version);
    const target = await requireFolioSpace(client, actor, spaceId, async (id) =>
      Boolean((await getBoardAccess(client, actor, id, cache))?.canRead),
    );
    if (
      target.inactive ||
      (target.kind === "personal" && target.owner_user_id !== row.owner_user_id)
    )
      throw new WikiRuleError(
        "invalid_folio_request",
        "Choose an active shared destination or the note owner’s Personal space.",
        400,
      );
    const content = (
      await client.query<{ content_json: unknown[]; content_markdown: string }>(
        "SELECT content_json,content_markdown FROM notes WHERE id=$1",
        [noteId],
      )
    ).rows[0];
    assertNoteContentFormat(content.content_json, row.content_format_version);
    // Format 2 is the established lossless superset of format 1.
    assertNoteContentFormat(content.content_json, 2);
    const files = (
      await client.query<{ id: string }>(
        "SELECT id FROM note_attachments WHERE note_id=$1 AND removed_at IS NULL ORDER BY id",
        [noteId],
      )
    ).rows.map((f) => f.id);
    await client.query(
      `INSERT INTO note_versions(id,note_id,version_number,kind,title,content_json,content_markdown,content_format_version,attachment_ids,author_user_id,started_at,saved_at)
      SELECT $1,$2,coalesce(max(version_number),0)+1,'start',$3,$4::jsonb,$5,$6,$7,$8,now(),now() FROM note_versions WHERE note_id=$2`,
      [
        randomUUID(),
        noteId,
        row.title,
        JSON.stringify(content.content_json),
        content.content_markdown,
        row.content_format_version,
        files,
        actor.id,
      ],
    );
    let inherited: string;
    if (row.board_id) {
      await client.query(
        `INSERT INTO folio_spaces(id,kind,title,board_id,created_by_user_id) VALUES($1,'board',$2,$3,$4) ON CONFLICT DO NOTHING`,
        [
          stableUuid(`folio:board:${row.board_id}`),
          (row.board_title || "Board").slice(0, 120),
          row.board_id,
          actor.id,
        ],
      );
      inherited = (
        await client.query<{ id: string }>(
          "SELECT id FROM folio_spaces WHERE board_id=$1",
          [row.board_id],
        )
      ).rows[0].id;
    } else {
      await ensureLegacyNotebookSpaces(client, actor);
      inherited = row.notebook_id
        ? stableUuid(`folio:notebook:${row.notebook_id}`)
        : await ensurePersonalFolioRoot(client, row.owner_user_id);
    }
    await client.query(
      "UPDATE wiki_spaces SET home_note_id=NULL WHERE home_note_id=$1",
      [noteId],
    );
    await client.query("DELETE FROM wiki_page_topics WHERE note_id=$1", [
      noteId,
    ]);
    await client.query("DELETE FROM note_labels WHERE note_id=$1", [noteId]);
    await client.query("DELETE FROM note_tag_links WHERE note_id=$1", [noteId]);
    await client.query(
      `UPDATE notes SET folio_kind='document',board_id=NULL,bucket_id=NULL,notebook_id=NULL,wiki_space_id=NULL,pinned_at=NULL,
      content_format_version=2,content_version=content_version+1,updated_at=clock_timestamp(),updated_by_user_id=$2 WHERE id=$1`,
      [noteId, actor.id],
    );
    for (const name of row.labels)
      await client.query(
        "INSERT INTO folio_keywords(note_id,name) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [noteId, name],
      );
    for (const id of new Set([inherited, spaceId]))
      await client.query(
        "INSERT INTO folio_connections(note_id,space_id,created_by_user_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",
        [noteId, id, actor.id],
      );
    // Existing stored_name namespaces and task references are preserved. File
    // authorization follows requireNote; new uploads use the neutral namespace.
    await snapshotWikiNote(client, actor, noteId, "start");
    return loadNoteDetail(client, actor, noteId, cache);
  });
}
