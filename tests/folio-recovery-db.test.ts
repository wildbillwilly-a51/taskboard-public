import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { getPool } from "../src/lib/db";
import { ensureDatabaseReady } from "../src/lib/taskboard-store";
import {
  createFolioNote,
  createFolioSpace,
  getFolioSpacePage,
  getFolioLibrary,
  changeFolioConnection,
  manageFolioSpace,
  folioHistory,
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
  "Folio concurrent edits, connection deltas and page/file recovery preserve independent note state",
  {
    skip: process.env.FOLIO_DB_TEST !== "1",
    timeout: 60000,
  },
  async () => {
    assert.ok(isLocalVisualDatabase(new URL(process.env.DATABASE_URL!)));
    await ensureDatabaseReady();
    const pool = getPool()!;
    const actors = Array.from(
        { length: 2 },
        (): Actor => ({
          id: randomUUID(),
          email: `folio-recovery-${randomUUID()}@example.invalid`,
          displayName: "Recovery fixture",
          authMode: "authelia",
        }),
      ),
      [owner, other] = actors,
      ids = actors.map((a) => a.id);
    try {
      for (const a of actors)
        await pool.query(
          "INSERT INTO users(id,email,display_name) VALUES($1,$2,$3)",
          [a.id, a.email, a.displayName],
        );
      const personal = (await getFolioLibrary(owner)).rootSpaceId;
      const first = await createFolioSpace(owner, {
        title: `Recovery ${owner.id}`,
        personal: false,
        parentId: null,
      });
      const second = await createFolioSpace(owner, {
        title: "Child",
        personal: false,
        parentId: first.id,
      });
      const doc = await createFolioNote(owner);
      assert.equal(doc.folio?.unconnected,true);
      await changeFolioConnection(owner,doc.id,personal,true);
      await changeFolioConnection(owner,doc.id,first.id,true);
      await Promise.all([
        changeFolioConnection(owner, doc.id, second.id, true),
        changeFolioConnection(other, doc.id, first.id, false),
      ]);
      assert.deepEqual(
        new Set(
          (await getNote(owner, doc.id)).folio?.connections.map((c) => c.id),
        ),
        new Set([personal, second.id]),
      );
      const results = await Promise.allSettled([
        updateNote(owner, doc.id, {
          title: "Owner wins or conflicts",
          expectedVersion: doc.contentVersion,
        }),
        updateNote(other, doc.id, {
          title: "Other wins or conflicts",
          expectedVersion: doc.contentVersion,
        }),
      ]);
      assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
      assert.equal(
        results.filter(
          (r) =>
            r.status === "rejected" && r.reason.name === "NoteConflictError",
        ).length,
        1,
      );
      await trashNote(owner, doc.id);
      await restoreNote(other, doc.id);
      assert.deepEqual(
        new Set(
          (await getNote(owner, doc.id)).folio?.connections.map((c) => c.id),
        ),
        new Set([personal, second.id]),
        "Trash restore keeps both visible and hidden placements",
      );
      const page = await getFolioSpacePage(owner, second.id);
      const png = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5+/S8AAAAASUVORK5CYII=",
        "base64",
      );
      const file = (
        await uploadNoteAttachments(other, page.id, [
          {
            originalName: "banner.png",
            mimeType: "image/png",
            sizeBytes: png.length,
            buffer: png,
          },
        ])
      )[0];
      const banner = await updateNote(other, page.id, {
        expectedVersion: page.contentVersion,
        title: "Customized child page",
        folioPageState: {
          bannerAttachmentId: file.id,
          notesListVisible: false,
          notesListPosition: "before",
        },
      });
      const version = (await folioHistory(owner, page.id)).versions[0];
      await deleteNoteAttachment(owner, page.id, file.id);
      let fresh = await getNote(owner, page.id);
      assert.equal(fresh.folio?.pageState.bannerAttachmentId, null);
      assert.equal(fresh.attachments.length, 0);
      assert.ok(
        fresh.contentVersion > banner.contentVersion,
        "banner removal participates in optimistic concurrency",
      );
      fresh = await restoreFolioVersion(
        other,
        page.id,
        version.id,
        fresh.contentVersion,
      );
      assert.equal(fresh.folio?.pageState.bannerAttachmentId, file.id);
      assert.equal(fresh.folio?.pageState.notesListVisible, false);
      assert.equal(
        (
          await getNoteAttachmentDownload(owner, page.id, file.id)
        ).content.compare(png),
        0,
        "history reactivates soft-removed banner bytes",
      );
      await manageFolioSpace(other, first.id, { remove: true });
      const promoted = (await getFolioLibrary(owner)).spaces.find(
        (s) => s.id === second.id,
      )!;
      assert.equal(promoted.parentId, null);
      assert.equal(
        (await getNote(owner, page.id)).title,
        "Customized child page",
      );
      assert.equal(
        (await getNote(owner, doc.id)).folio?.connections.some(
          (c) => c.id === second.id,
        ),
        true,
      );
      await manageFolioSpace(owner, second.id, { remove: true });
      await assert.rejects(getNote(owner, page.id), {
        name: "NotesNotFoundError",
      });
      await assert.rejects(
        getNote(other, doc.id),
        { name: "NotesNotFoundError" },
        "last public space removal leaves hidden Personal access intact",
      );
      assert.equal((await getNote(owner, doc.id)).folio?.audience, "personal");
      await changeFolioConnection(owner, doc.id, personal, false);
      assert.equal(
        (await getNote(other, doc.id)).folio?.unconnected,
        true,
        "removing the last Personal placement intentionally returns to public Unconnected",
      );
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
