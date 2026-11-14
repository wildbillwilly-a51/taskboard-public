import "server-only";

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { NoteConflictError, WikiRuleError } from "@/lib/notes-errors";
import { isUuid, normalizeNoteContent, normalizeNoteTitle, type NoteContentInput } from "@/lib/notes-model";
import { updateNoteInTransaction } from "@/lib/notes-store";
import { withClient, withTransaction, type Actor } from "@/lib/notes-store-context";
import { folioActiveConnectionsCte } from "@/lib/folio-store-access";
import { ensurePersonalFolioRoot } from "@/lib/folio-legacy-store";
import { insertFolioDocument } from "@/lib/folio-store";
import { assertNoteContentFormat } from "@/lib/notes-content-format";
import type { OfflineNote, OfflineSave, OfflineSnapshot } from "@/lib/offline-notes-model";

const personalNoteScope = `
  notes.owner_user_id = $1 AND notes.board_id IS NULL AND notes.wiki_space_id IS NULL
  AND notes.archived_at IS NULL AND notes.deleted_at IS NULL
  AND (
    (notes.folio_kind IS NULL AND notes.content_format_version = 1
      AND NOT EXISTS (SELECT 1 FROM note_task_links link WHERE link.note_id = notes.id))
    OR (
      notes.folio_kind = 'document' AND notes.content_format_version IN (1, 2)
      AND notes.id IN (
        SELECT note_id FROM active_folio_connections WHERE kind = 'personal' AND owner_user_id = $1
      )
      AND notes.id NOT IN (
        SELECT connection.note_id FROM folio_connections connection
        JOIN folio_spaces space ON space.id = connection.space_id
        WHERE space.kind <> 'personal' OR space.owner_user_id IS DISTINCT FROM $1
      )
    )
  )
`;

export async function readOfflineNotes(actor: Actor): Promise<OfflineSnapshot> {
  return withClient(async (client) => {
    const { rows } = await client.query<{
      id: string; version: number; title: string; format: number;
      blocks: unknown[]; markdown: string; text: string;
    }>(`
      WITH ${folioActiveConnectionsCte}
      SELECT id, title, content_version AS version, content_format_version AS format,
             content_json AS blocks, content_markdown AS markdown, content_text AS text
      FROM notes WHERE ${personalNoteScope}
      ORDER BY updated_at DESC, id
    `, [actor.id]);
    const notes: OfflineNote[] = rows.map(({ id, version, title, format, blocks, markdown, text }) => ({
      id, version, title, content: { formatVersion: format, blocks, markdown, text },
    }));
    return { ownerId: actor.id, notes };
  });
}

export function parseOfflineSave(body: Record<string, unknown>): OfflineSave {
  const { operationId, noteId, expectedVersion } = body;
  if (typeof operationId !== "string" || !isUuid(operationId)
    || (noteId !== null && (typeof noteId !== "string" || !isUuid(noteId)))
    || (noteId === null ? expectedVersion !== null
      : typeof expectedVersion !== "number" || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) {
    throw new WikiRuleError("invalid_save", "Invalid offline save identity or version.", 400);
  }
  const content: NoteContentInput = normalizeNoteContent(body.content);
  assertNoteContentFormat(content.blocks, content.formatVersion ?? 1);
  return { operationId, noteId, expectedVersion: expectedVersion as number | null, title: normalizeNoteTitle(body.title), content };
}

type SaveResult =
  | { kind: "saved"; noteId: string; version: number }
  | { kind: "conflict"; reason: "changed" | "unavailable" };

async function applySave(client: PoolClient, actor: Actor, save: OfflineSave): Promise<SaveResult> {
  const digest = createHash("sha256").update(JSON.stringify(save)).digest("hex");
  // A receipt and its write commit together, so a lost response can be
  // retried safely. Serialize simultaneous retries of the same operation.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [`offline-note:${actor.id}:${save.operationId}`]);
  const { rows: [receipt] } = await client.query<{ fingerprint: string; note_id: string; version: number }>(
    "SELECT fingerprint, note_id, version FROM offline_note_receipts WHERE owner_user_id = $1 AND operation_id = $2",
    [actor.id, save.operationId],
  );
  if (receipt) {
    if (receipt.fingerprint !== digest)
      throw new WikiRuleError("mutation_conflict", "This offline save ID is already in use.", 409);
    return { kind: "saved", noteId: receipt.note_id, version: receipt.version };
  }

  // Scope changes take the hierarchy lock or the note lock. Check eligibility
  // in a fresh statement after taking both, before any content write.
  await client.query("SELECT pg_advisory_xact_lock(hashtextextended('folio-hierarchy',0))");
  let noteId: string;
  let version: number;
  if (save.noteId) {
    const locked = await client.query(
      "SELECT id FROM notes WHERE id = $2 AND owner_user_id = $1 FOR NO KEY UPDATE",
      [actor.id, save.noteId],
    );
    if (!locked.rowCount) return { kind: "conflict", reason: "unavailable" };
    const { rowCount } = await client.query(
      `WITH ${folioActiveConnectionsCte}
       SELECT id FROM notes WHERE ${personalNoteScope} AND id = $2`,
      [actor.id, save.noteId],
    );
    if (!rowCount) return { kind: "conflict", reason: "unavailable" };
    const note = await updateNoteInTransaction(client, actor, save.noteId, {
      title: save.title, content: save.content, expectedVersion: save.expectedVersion,
    });
    noteId = note.id;
    version = note.contentVersion;
  } else {
    const root = await ensurePersonalFolioRoot(client, actor.id);
    noteId = await insertFolioDocument(client, actor, save.title, { ...save.content, formatVersion: 2 }, root);
    version = 1;
  }
  await client.query(
    `INSERT INTO offline_note_receipts (owner_user_id, operation_id, fingerprint, note_id, version)
     VALUES ($1, $2, $3, $4, $5)`,
    [actor.id, save.operationId, digest, noteId, version],
  );
  return { kind: "saved", noteId, version };
}

export async function saveOfflineNote(actor: Actor, save: OfflineSave): Promise<SaveResult> {
  try {
    return await withTransaction((client) => applySave(client, actor, save));
  } catch (error) {
    if (error instanceof NoteConflictError) return { kind: "conflict", reason: "changed" };
    throw error;
  }
}
