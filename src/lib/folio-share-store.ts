import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { getPool } from "./db";
import {
  requireActor,
  withTransaction,
  withTransactionOnClient,
  noteFileTransaction,
} from "./notes-store-context";
import {
  requireNote,
  noteSelectSql,
  type DbNoteRow,
} from "./notes-store-access";
import {
  saveNoteContent,
  snapshotWikiNote,
  assertExpectedNoteVersion,
} from "./notes-content-store";
import {
  encryptShareToken,
  recoverShareToken,
  shareLinkRecoveryAvailable,
} from "./task-share-link-crypto";
import {
  getNoteAttachmentDiskPath,
  currentNoteAttachments,
} from "./note-attachments-store";
import { writeDurableAttachment } from "./taskboard-mutation-effects";
import { isUuid, normalizeNoteContent } from "./notes-model";
import { assertNoteContentFormat } from "./notes-content-format";
import {
  WikiRuleError,
  NotesNotFoundError,
  NoteConflictError,
} from "./notes-errors";
import type { TaskboardUserIdentity } from "./taskboard-request";
import type { FolioShareMode, FolioShareLink } from "./folio-features-model";
import type { PublicFolioSave, SharedFolioNote } from "./folio-share-model";
const hash = (v: string) => createHash("sha256").update(v).digest("hex");
type Share = {
  id: string;
  note_id: string;
  mode: FolioShareMode;
  token_hash: string;
  token_ciphertext: string;
  revoked_at: Date | null;
};
const unavailable = () =>
  new NotesNotFoundError("This shared note is unavailable.");
export function noteSharingEnabled() {
  return process.env.TASKBOARD_PUBLIC_SHARES_ENABLED === "true";
}
export async function manageFolioShares(
  user: TaskboardUserIdentity,
  noteId: string,
  action = "status",
  mode: FolioShareMode = "read",
) {
  const actor = requireActor(user);
  if (
    !["status", "create", "disable", "regenerate"].includes(action) ||
    !["read", "write"].includes(mode)
  )
    throw new WikiRuleError("invalid_share", "Invalid sharing action.", 400);
  return withTransaction(async (client) => {
    const { row } = await requireNote(
      client,
      actor,
      noteId,
      "read",
      new Map(),
      { lock: true },
    );
    if (
      row.owner_user_id !== actor.id ||
      row.folio_kind !== "document" ||
      row.deleted_at ||
      row.archived_at
    )
      throw unavailable();
    if (action !== "status" && !noteSharingEnabled())
      throw new WikiRuleError(
        "sharing_disabled",
        "Public sharing is unavailable.",
        503,
      );
    if (action === "disable" || action === "regenerate")
      await client.query(
        "UPDATE folio_note_shares SET revoked_at=clock_timestamp() WHERE note_id=$1 AND mode=$2 AND revoked_at IS NULL",
        [noteId, mode],
      );
    if (action === "create" || action === "regenerate") {
      if (!shareLinkRecoveryAvailable())
        throw new WikiRuleError(
          "share_key_missing",
          "Share link recovery is unavailable.",
          503,
        );
      const current = await client.query(
        "SELECT id FROM folio_note_shares WHERE note_id=$1 AND mode=$2 AND revoked_at IS NULL",
        [noteId, mode],
      );
      if (!current.rowCount) {
        const id = randomUUID(),
          token = randomBytes(32).toString("base64url"),
          tokenHash = hash(token),
          cipher = encryptShareToken(token, {
            id,
            taskId: noteId,
            mode: `folio:${mode}`,
            tokenHash,
          });
        await client.query(
          "INSERT INTO folio_note_shares(id,note_id,mode,token_hash,token_ciphertext,created_by_user_id) VALUES($1,$2,$3,$4,$5,$6)",
          [id, noteId, mode, tokenHash, cipher, actor.id],
        );
      }
    }
    const rows = (
      await client.query<Share>(
        "SELECT * FROM folio_note_shares WHERE note_id=$1 AND revoked_at IS NULL",
        [noteId],
      )
    ).rows;
    return {
      links: (["read", "write"] as const).map((mode) => {
        const r = rows.find((s) => s.mode === mode),
          token =
            r &&
            recoverShareToken(r.token_ciphertext, {
              id: r.id,
              taskId: noteId,
              mode: `folio:${mode}`,
              tokenHash: r.token_hash,
            });
        return {
          mode,
          active: !!token,
          ...(token ? { url: `/share/note/${token}` } : {}),
        } satisfies FolioShareLink;
      }),
    };
  });
}
// Public requests do not run migrations, create users, or synchronize identities.
let publicInFlight = 0;
async function publicClient<T>(action: (client: PoolClient) => Promise<T>) {
  const pool = getPool();
  if (!pool || !noteSharingEnabled()) throw unavailable();
  if (publicInFlight >= 4)
    throw new WikiRuleError(
      "share_rate",
      "Shared notes are busy. Please retry shortly.",
      503,
    );
  publicInFlight++;
  try {
    const client = await pool.connect();
    let discard = false;
    try {
      await client.query("SET statement_timeout='5s'");
      return await action(client);
    } finally {
      try {
        await client.query("RESET statement_timeout");
      } catch {
        discard = true;
      }
      client.release(discard);
    }
  } finally {
    publicInFlight--;
  }
}
async function findShare(client: PoolClient, token: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw unavailable();
  const s = (
    await client.query<Share>(
      "SELECT * FROM folio_note_shares WHERE token_hash=$1 AND revoked_at IS NULL",
      [hash(token)],
    )
  ).rows[0];
  if (!s) throw unavailable();
  return s;
}
async function sharedRow(client: PoolClient, share: Share, lock = false) {
  const row = (
    await client.query<DbNoteRow>(
      `${noteSelectSql} WHERE notes.id=$1 AND notes.folio_kind='document' AND notes.deleted_at IS NULL AND notes.archived_at IS NULL AND EXISTS(SELECT 1 FROM users WHERE id=notes.owner_user_id AND NOT is_disabled) ${lock ? "FOR UPDATE OF notes" : ""}`,
      [share.note_id],
    )
  ).rows[0];
  if (!row) throw unavailable();
  return row;
}
async function payload(client: PoolClient, s: Share): Promise<SharedFolioNote> {
  const n = await sharedRow(client, s),
    content = (
      await client.query<{ content_json: unknown[]; content_markdown: string }>(
        "SELECT content_json,content_markdown FROM notes WHERE id=$1",
        [n.id],
      )
    ).rows[0];
  assertNoteContentFormat(content.content_json, n.content_format_version);
  return {
    id: n.id,
    title: n.title,
    content: content.content_json,
    contentMarkdown: content.content_markdown,
    contentFormatVersion: n.content_format_version,
    contentVersion: n.content_version,
    updatedAt: n.updated_at.toISOString(),
    mode: s.mode,
    attachments: (
      await currentNoteAttachments(client, { noteIds: [n.id] })
    ).map((f) => ({
      id: f.id,
      originalName: f.original_name,
      mimeType: f.mime_type,
      sizeBytes: Number(f.size_bytes),
      createdAt: f.created_at.toISOString(),
    })),
  };
}
export async function readSharedFolio(token: string) {
  return publicClient(async (client) => {
    await client.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    try {
      const result = await payload(client, await findShare(client, token));
      await client.query("COMMIT");
      return result;
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  });
}
// Committed separately: failed/stale mutations still consume rate and byte budgets.
async function admit(token: string, bytes: number) {
  return publicClient(async (client) => {
    const s = await findShare(client, token);
    if (s.mode !== "write")
      throw new WikiRuleError(
        "share_read_only",
        "This link is read-only.",
        403,
      );
    if (bytes > 30 * 1024 * 1024)
      throw new WikiRuleError("share_size", "Request is too large.", 413);
    const r = await client.query(
      `INSERT INTO folio_share_admissions(share_id,minute,requests,bytes) VALUES($1,date_trunc('minute',clock_timestamp()),1,$2) ON CONFLICT(share_id,minute) DO UPDATE SET requests=folio_share_admissions.requests+1,bytes=folio_share_admissions.bytes+EXCLUDED.bytes RETURNING requests,bytes`,
      [s.id, bytes],
    );
    const used = r.rows[0];
    if (used.requests > 120 || Number(used.bytes) > 100 * 1024 * 1024)
      throw new WikiRuleError(
        "share_rate",
        "Please wait before making more changes.",
        429,
      );
    await client.query(
      "DELETE FROM folio_share_admissions WHERE share_id=$1 AND minute<clock_timestamp()-interval '1 day'",
      [s.id],
    );
    return s;
  });
}
type SharedUploadFile = { name: string; type: string; bytes: Uint8Array };
let uploadsInFlight = 0;
// Hold admission through multipart parsing and commit. Chunked requests reserve
// their entire allowed body before any bytes are read; only two can be buffered.
export async function withSharedFolioUpload<T>(
  token: string,
  reservedBytes: number,
  action: (
    upload: (
      file: SharedUploadFile,
      expectedVersion: number,
    ) => Promise<SharedFolioNote>,
  ) => Promise<T>,
) {
  if (
    !Number.isSafeInteger(reservedBytes) ||
    reservedBytes < 1 ||
    reservedBytes > 26 * 1024 * 1024
  )
    throw new WikiRuleError("share_size", "The upload is too large.", 413);
  if (uploadsInFlight >= 2)
    throw new WikiRuleError(
      "share_rate",
      "Uploads are busy. Please retry shortly.",
      503,
    );
  uploadsInFlight++;
  try {
    const admitted = await admit(token, reservedBytes);
    let used = false;
    return await action(async (file, expectedVersion) => {
      if (used || file.bytes.length > reservedBytes)
        throw new WikiRuleError("invalid_file", "Invalid upload.", 400);
      used = true;
      return performSharedUpload(token, file, expectedVersion, admitted);
    });
  } finally {
    uploadsInFlight--;
  }
}
async function mutate<T>(
  token: string,
  bytes: number,
  action: (client: PoolClient, s: Share, row: DbNoteRow) => Promise<T>,
  preAdmitted?: Share,
) {
  const admitted = preAdmitted ?? (await admit(token, bytes));
  return publicClient((client) =>
    withTransactionOnClient(client, async (client) => {
      const row = await sharedRow(client, admitted, true);
      const s = (
        await client.query<Share>(
          "SELECT * FROM folio_note_shares WHERE id=$1 FOR UPDATE",
          [admitted.id],
        )
      ).rows[0];
      if (
        !s ||
        s.revoked_at ||
        s.mode !== "write" ||
        s.note_id !== row.id ||
        s.token_hash !== hash(token)
      )
        throw unavailable();
      return action(client, s, row);
    }),
  );
}
function assertNoShareUrls(value: unknown) {
  if (Array.isArray(value)) value.forEach(assertNoShareUrls);
  else if (value && typeof value === "object")
    for (const [k, v] of Object.entries(value)) {
      if (
        (k === "url" || k === "href") &&
        typeof v === "string" &&
        /\/share\//i.test(v)
      )
        throw new WikiRuleError(
          "invalid_content",
          "Shared file addresses cannot be stored in the note.",
          400,
        );
      assertNoShareUrls(v);
    }
}
async function validatePublicContent(blocks: unknown[]) {
  const { defaultBlockSpecs, defaultInlineContentSpecs, defaultStyleSpecs } =
    await import("@blocknote/core");
  assertNoteContentFormat(blocks, 2, {
    blockTypes: Object.keys(defaultBlockSpecs),
    inlineContentTypes: [
      ...Object.keys(defaultInlineContentSpecs),
      "pageMention",
    ],
    styleTypes: Object.keys(defaultStyleSpecs),
  });
  const visit = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(visit);
    else if (v && typeof v === "object")
      for (const [k, item] of Object.entries(v)) {
        if (
          (k === "url" || k === "href") &&
          typeof item === "string" &&
          item &&
          !/^(?:https?:\/\/|mailto:|tel:|\/|#)/i.test(item)
        )
          throw new WikiRuleError(
            "invalid_content",
            "This document contains an unsupported link address.",
            400,
          );
        visit(item);
      }
  };
  visit(blocks);
}
export async function saveSharedFolio(token: string, b: PublicFolioSave) {
  if (
    !b ||
    Object.keys(b).some(
      (k) => !["mutationId", "expectedVersion", "title", "content"].includes(k),
    ) ||
    !isUuid(b.mutationId) ||
    typeof b.title !== "string"
  )
    throw new WikiRuleError("invalid_save", "Invalid shared note save.", 400);
  const requestHash = hash(JSON.stringify(b));
  const content = normalizeNoteContent(b.content);
  assertNoteContentFormat(content.blocks, 2);
  assertNoShareUrls(content.blocks);
  if (/\/share\/note\/[A-Za-z0-9_-]{43}/.test(content.markdown))
    throw new WikiRuleError(
      "invalid_content",
      "Shared addresses cannot be stored in Markdown.",
      400,
    );
  await validatePublicContent(content.blocks);
  return mutate(
    token,
    Buffer.byteLength(JSON.stringify(b)),
    async (client, s, row) => {
      const done = (
        await client.query<{ request_hash: string; result_version: number }>(
          "SELECT request_hash,result_version FROM folio_share_mutations WHERE share_id=$1 AND mutation_id=$2",
          [s.id, b.mutationId],
        )
      ).rows[0];
      if (done) {
        if (done.request_hash !== requestHash)
          throw new WikiRuleError(
            "mutation_conflict",
            "This save identifier was already used.",
            409,
          );
        if (done.result_version !== row.content_version)
          throw new NoteConflictError(row.content_version);
        return payload(client, s);
      }
      await saveNoteContent(client, { id: null, shareId: s.id }, row, {
        title: b.title,
        content,
        expectedVersion: b.expectedVersion,
      });
      const result = await payload(client, s);
      await client.query(
        "INSERT INTO folio_share_mutations(share_id,mutation_id,request_hash,result_version) VALUES($1,$2,$3,$4)",
        [s.id, b.mutationId, requestHash, result.contentVersion],
      );
      return result;
    },
  );
}
export async function uploadSharedFolioFile(
  token: string,
  file: SharedUploadFile,
  expectedVersion: number,
) {
  return performSharedUpload(token, file, expectedVersion);
}
async function performSharedUpload(
  token: string,
  file: SharedUploadFile,
  expectedVersion: number,
  admitted?: Share,
) {
  if (!file.bytes.length || file.bytes.length > 25 * 1024 * 1024)
    throw new WikiRuleError(
      "invalid_file",
      "Files must contain 1 byte to 25 MB.",
      400,
    );
  return mutate(
    token,
    file.bytes.length,
    async (client, s, row) => {
      assertExpectedNoteVersion(expectedVersion, row.content_version);
      const usage = (
        await client.query<{ n: string; bytes: string }>(
        "SELECT count(*) n,coalesce(sum(size_bytes),0) bytes FROM note_attachments WHERE note_id=$1",
          [row.id],
        )
      ).rows[0];
      if (
        Number(usage.n) >= 500 ||
        Number(usage.bytes) + file.bytes.length > 1024 ** 3
      )
        throw new WikiRuleError(
          "file_limit",
        "This note has reached its retained attachment limit.",
          400,
        );
      const id = randomUUID(),
        stored = `folio:${row.id}/${id}`;
      noteFileTransaction.getStore()!.created.push(stored);
      await writeDurableAttachment(
        getNoteAttachmentDiskPath(stored),
        file.bytes,
      );
      await client.query(
        "INSERT INTO note_attachments(id,note_id,uploaded_via_share_id,original_name,stored_name,mime_type,size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7)",
        [
          id,
          row.id,
          s.id,
          path.basename(file.name.replaceAll("\\", "/")).slice(0, 255) ||
            "attachment",
          stored,
          file.type || "application/octet-stream",
          file.bytes.length,
        ],
      );
      await snapshotWikiNote(
        client,
        { id: null, shareId: s.id },
        row.id,
        "edit",
        true,
      );
      return payload(client, s);
    },
    admitted,
  );
}
export async function removeSharedFolioFile(
  token: string,
  id: string,
  expectedVersion: number,
) {
  if (!isUuid(id)) throw unavailable();
  return mutate(token, 0, async (client, s, row) => {
    assertExpectedNoteVersion(expectedVersion, row.content_version);
    const result = await client.query(
      "UPDATE note_attachments SET removed_at=clock_timestamp() WHERE note_id=$1 AND id=$2 AND removed_at IS NULL RETURNING id",
      [row.id, id],
    );
    if (!result.rowCount) throw unavailable();
    await snapshotWikiNote(
      client,
      { id: null, shareId: s.id },
      row.id,
      "edit",
      true,
    );
    return payload(client, s);
  });
}
export async function readSharedFolioFile(token: string, id: string) {
  if (!isUuid(id)) throw unavailable();
  return publicClient(async (client) => {
    const s = await findShare(client, token);
    await sharedRow(client, s);
    const file = (
      await currentNoteAttachments(client, {
        noteIds: [s.note_id],
        attachmentId: id,
      })
    )[0];
    if (!file) throw unavailable();
    return {
      name: file.original_name,
      mime: file.mime_type,
      bytes: await readFile(getNoteAttachmentDiskPath(file.stored_name)),
    };
  });
}
