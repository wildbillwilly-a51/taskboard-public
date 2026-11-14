import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { TaskboardUserIdentity } from "./taskboard-request";
import { requireActor, withTransaction } from "./notes-store-context";
import {
  requireNote,
  getBoardAccess,
  loadNoteDetail,
} from "./notes-store-access";
import {
  normalizeNoteContent,
  normalizeNoteTitle,
  isUuid,
} from "./notes-model";
import { assertNoteContentFormat } from "./notes-content-format";
import { requireFolioSpace } from "./folio-store-access";
import {
  snapshotWikiNote,
  rebuildFolioNoteLinks,
  trustedWikiOrigin,
} from "./notes-content-store";
import { copyNoteFiles, rewriteCopiedContent } from "./note-attachments-store";
import { withNoteBlockIds } from "./note-outline";
import { invalidFeature } from "./folio-discovery-store";
export async function createTemplateNote(
  user: TaskboardUserIdentity,
  input: Record<string, unknown>,
) {
  return withTransaction(client => createTemplateNoteInTransaction(client, user, input));
}

// Caller owns a native file transaction; keeps creation and destination atomic.
export async function createTemplateNoteInTransaction(
  client: PoolClient, user: TaskboardUserIdentity, input: Record<string, unknown>,
) {
  const actor = requireActor(user);
  if (
    Object.keys(input).some(
      (k) => !["title", "content", "destination", "sourceId"].includes(k),
    )
  )
    throw invalidFeature();
  const destination = input.destination;
  if (destination !== undefined && destination !== null && !isUuid(destination))
    throw invalidFeature();
  if (destination) {
    const s = await requireFolioSpace(
      client,
      actor,
      destination as string,
      async (id) =>
        !!(await getBoardAccess(client, actor, id, new Map()))?.canRead,
    );
    if (s.inactive) throw invalidFeature("Choose an active destination.");
  }
  let title = normalizeNoteTitle(input.title),
    content =
      input.content === undefined
        ? normalizeNoteContent({ blocks: [], formatVersion: 2 })
        : normalizeNoteContent(input.content);
  let sourceId: string | null = null;
  if (input.sourceId !== undefined) {
    if (!isUuid(input.sourceId)) throw invalidFeature();
    sourceId = input.sourceId;
    const { row } = await requireNote(
      client,
      actor,
      sourceId,
      "read",
      new Map(),
      { readLock: true },
    );
    if (
      !row.folio_kind ||
      !(
        await client.query(
          "SELECT 1 FROM folio_note_features WHERE note_id=$1 AND is_template",
          [row.id],
        )
      ).rowCount
    )
      throw invalidFeature("This template is unavailable.");
    const source = (
      await client.query<{
        content_json: unknown[];
        content_markdown: string;
        content_text: string;
      }>(
        "SELECT content_json,content_markdown,content_text FROM notes WHERE id=$1",
        [row.id],
      )
    ).rows[0];
    content = {
      blocks: source.content_json,
      markdown: source.content_markdown,
      text: source.content_text,
      formatVersion: 2,
    };
    if (!title) title = row.title;
  }
  if (content.formatVersion !== 2) throw invalidFeature();
  assertNoteContentFormat(content.blocks, 2);
  const id = randomUUID();
  await client.query(
    `INSERT INTO notes(id,owner_user_id,folio_kind,title,content_json,content_markdown,content_text,content_format_version,created_by_user_id,updated_by_user_id) VALUES($1,$2,'document',$3,$4::jsonb,$5,$6,2,$2,$2)`,
    [
      id,
      actor.id,
      title,
      JSON.stringify(withNoteBlockIds(content.blocks, randomUUID)),
      content.markdown,
      content.text,
    ],
  );
  if (sourceId) {
    const mapping = await copyNoteFiles(client, actor.id, sourceId, id);
    const rewritten = rewriteCopiedContent(
      content.blocks,
      content.markdown,
      sourceId,
      id,
      mapping,
      trustedWikiOrigin(),
    );
    await client.query(
      "UPDATE notes SET content_json=$2::jsonb,content_markdown=$3 WHERE id=$1",
      [
        id,
        JSON.stringify(withNoteBlockIds(rewritten.blocks, randomUUID)),
        rewritten.markdown,
      ],
    );
  }
  if (destination)
    await client.query(
      "INSERT INTO folio_connections(note_id,space_id,created_by_user_id) VALUES($1,$2,$3)",
      [id, destination, actor.id],
    );
  await snapshotWikiNote(client, actor, id, "start");
  const detail = await loadNoteDetail(client, actor, id, new Map());
  await rebuildFolioNoteLinks(
    client,
    id,
    detail.content,
    trustedWikiOrigin(),
  );
  return detail;
}
