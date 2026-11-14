import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getPool } from "../src/lib/db";
import { ensureDatabaseReady } from "../src/lib/taskboard-store";
import {
  createFolioNote,
  getFolioLibrary,
  changeFolioConnection,
  folioHistory,
  getFolioHistoryVersion,
  restoreFolioVersion,
  drainFolioFileCleanup,
} from "../src/lib/folio-store";
import {
  getNote,
  updateNote,
  uploadNoteAttachments,
  deleteNoteAttachment,
  getNoteAttachmentDownload,
  trashNote,
  restoreNote,
} from "../src/lib/notes-store";
import type { Actor } from "../src/lib/notes-store-context";
import { isLocalVisualDatabase } from "./helpers/visual-database";

test(
  "Folio history authorizes current access, rejects a changed preview snapshot and pages through concurrent new revisions",
  { skip: process.env.FOLIO_DB_TEST !== "1", timeout: 60000 },
  async () => {
    assert.ok(isLocalVisualDatabase(new URL(process.env.DATABASE_URL!)));
    await ensureDatabaseReady();
    const pool = getPool()!;
    const actors: Actor[] = Array.from({ length: 2 }, () => ({
        id: randomUUID(),
        email: `history-${randomUUID()}@example.invalid`,
        displayName: "History fixture",
        authMode: "authelia",
      })),
      [owner, other] = actors,
      ids = actors.map((a) => a.id);
    try {
      for (const a of actors)
        await pool.query(
          "INSERT INTO users(id,email,display_name) VALUES($1,$2,$3)",
          [a.id, a.email, a.displayName],
        );
      const doc = await createFolioNote(owner, { title: "Original" }),
        initial = (await folioHistory(owner, doc.id)).versions[0];
      assert.equal(
        (await getFolioHistoryVersion(other, doc.id, initial.id)).title,
        "Original",
        "zero connections means shared",
      );
      const root = (await getFolioLibrary(owner)).rootSpaceId;
      await changeFolioConnection(owner, doc.id, root, true);
      await assert.rejects(getFolioHistoryVersion(other, doc.id, initial.id), {
        name: "NotesNotFoundError",
      });
      await assert.rejects(folioHistory(other, doc.id), {
        name: "NotesNotFoundError",
      });
      let saved = await updateNote(owner, doc.id, {
        expectedVersion: doc.contentVersion,
        title: "First edit",
      });
      const edit = (await folioHistory(owner, doc.id)).versions[0],
        preview = await getFolioHistoryVersion(owner, doc.id, edit.id);
      saved = await updateNote(owner, doc.id, {
        expectedVersion: saved.contentVersion,
        title: "Second edit",
      });
      const later = await getFolioHistoryVersion(owner, doc.id, edit.id);
      assert.equal(
        later.id,
        preview.id,
        "same-author autosaves can update a revision in place",
      );
      assert.notEqual(later.token, preview.token);
      await assert.rejects(
        restoreFolioVersion(
          owner,
          doc.id,
          edit.id,
          saved.contentVersion,
          preview.token,
        ),
        { code: "folio_history_changed" },
      );
      assert.equal((await getNote(owner, doc.id)).title, "Second edit");
      const snapshot = (
        await pool.query("SELECT * FROM note_versions WHERE id=$1", [edit.id])
      ).rows[0];
      // All mutable/restorable fields participate, not only the title and save time.
      const changes: [string, unknown][] = [
        [
          "content_json",
          [
            {
              type: "paragraph",
              content: [{ type: "text", text: "Different blocks" }],
            },
          ],
        ],
        ["content_markdown", "Different markdown"],
        ["content_format_version", 1],
        ["attachment_ids", [randomUUID()]],
        [
          "folio_page_state",
          {
            bannerAttachmentId: null,
            notesListVisible: false,
            notesListPosition: "after",
          },
        ],
        ["author_user_id", other.id],
        ["saved_at", new Date(Date.now() + 1000)],
      ];
      for (const [field, value] of changes) {
        const val =
          field === "content_json" || field === "folio_page_state"
            ? JSON.stringify(value)
            : value;
        await pool.query(`UPDATE note_versions SET ${field}=$2 WHERE id=$1`, [
          edit.id,
          val,
        ]);
        assert.notEqual(
          (await getFolioHistoryVersion(owner, doc.id, edit.id)).token,
          later.token,
          field,
        );
        await assert.rejects(
          restoreFolioVersion(
            owner,
            doc.id,
            edit.id,
            saved.contentVersion,
            later.token,
          ),
          { code: "folio_history_changed" },
        );
        const original = snapshot[field];
        await pool.query(`UPDATE note_versions SET ${field}=$2 WHERE id=$1`, [
          edit.id,
          field === "content_json" || field === "folio_page_state"
            ? JSON.stringify(original)
            : original,
        ]);
      }
      const initialPreview = await getFolioHistoryVersion(
        owner,
        doc.id,
        initial.id,
      );
      const restored = await restoreFolioVersion(
        owner,
        doc.id,
        initial.id,
        saved.contentVersion,
        initialPreview.token,
      );
      assert.equal(restored.title, "Original");
      assert.equal(restored.folio?.connections[0].id, root);
      assert.equal(
        (await folioHistory(owner, doc.id)).versions[0].kind,
        "restore",
      );
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF1cAAAAASUVORK5CYII=",
        "base64",
      );
      const [file] = await uploadNoteAttachments(owner, doc.id, [
        {
          originalName: "history.png",
          mimeType: "image/png",
          sizeBytes: png.length,
          buffer: png,
        },
      ]);
      const fileVersion = (await folioHistory(owner, doc.id)).versions[0];
      await deleteNoteAttachment(owner, doc.id, file.id);
      let historic = await getFolioHistoryVersion(
        owner,
        doc.id,
        fileVersion.id,
      );
      assert.equal(historic.attachments[0].removed, true);
      assert.equal(historic.attachments[0].available, true);
      assert.equal(
        (
          await getNoteAttachmentDownload(owner, doc.id, file.id)
        ).content.compare(png),
        0,
      );
      await trashNote(owner, doc.id);
      historic = await getFolioHistoryVersion(owner, doc.id, fileVersion.id);
      assert.equal(
        historic.attachments[0].available,
        false,
        "history agrees with Trash download policy",
      );
      assert(historic.unavailableAttachmentIds.includes(file.id));
      await restoreNote(owner, doc.id);
      await deleteNoteAttachment(owner, doc.id, file.id, { permanent: true });
      historic = await getFolioHistoryVersion(owner, doc.id, fileVersion.id);
      assert(historic.unavailableAttachmentIds.includes(file.id));
      assert.equal(historic.attachments.length, 0);
      await assert.rejects(
        getFolioHistoryVersion(owner, doc.id, randomUUID()),
        { name: "NotesNotFoundError" },
      );
      const many = await createFolioNote(owner);
      await pool.query(
        "INSERT INTO note_versions(id,note_id,version_number,kind,title,content_json,content_markdown,content_format_version,author_user_id,started_at,saved_at) SELECT gen_random_uuid(),$1,n,'edit','History '||n,'[]'::jsonb,'',2,$2,clock_timestamp(),clock_timestamp() FROM generate_series(2,70) n",
        [many.id, owner.id],
      );
      const first = await folioHistory(owner, many.id);
      assert.equal(first.versions.length, 50);
      assert.equal(first.nextBeforeVersion, 21);
      await pool.query(
        "INSERT INTO note_versions(id,note_id,version_number,kind,title,content_json,content_markdown,content_format_version,author_user_id,started_at,saved_at) VALUES(gen_random_uuid(),$1,71,'edit','Concurrent','[]'::jsonb,'',2,$2,clock_timestamp(),clock_timestamp())",
        [many.id, owner.id],
      );
      const second = await folioHistory(
        owner,
        many.id,
        0,
        first.nextBeforeVersion!,
      );
      assert.deepEqual(
        second.versions.map((v) => v.version),
        Array.from({ length: 20 }, (_, i) => 20 - i),
      );
      assert.equal(second.hasMore, false);
      assert.equal(
        new Set([...first.versions, ...second.versions].map((v) => v.id)).size,
        70,
      );
      await assert.rejects(folioHistory(owner, many.id, 1, 21));
    } finally {
      await pool.query(
        "DELETE FROM notes WHERE owner_user_id=ANY($1::uuid[])",
        [ids],
      );
      await pool.query(
        "DELETE FROM folio_spaces WHERE owner_user_id=ANY($1::uuid[]) OR created_by_user_id=ANY($1::uuid[])",
        [ids],
      );
      await pool.query(
        "DELETE FROM boards WHERE owner_user_id=ANY($1::uuid[])",
        [ids],
      );
      await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [ids]);
      await drainFolioFileCleanup();
      await pool.end();
    }
  },
);
