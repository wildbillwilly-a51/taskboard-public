import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import test from "node:test";

import { BoardAccessError } from "@/lib/board-access";
import { getPool } from "@/lib/db";
import {
  convertNoteToTask,
  createNote,
  createNotebook,
  deleteNotebook,
  deleteNotePermanently,
  getBoardNoteCounts,
  getNote,
  getNoteAttachmentDiskPath,
  linkNoteToTask,
  listBoardLabels,
  listNoteHomeOptions,
  listNotebooks,
  listNotes,
  listNoteTags,
  listTaskLinkedNotes,
  NoteConflictError,
  NotesNotFoundError,
  restoreNote,
  trashNote,
  unlinkNoteFromTask,
  updateNote,
  updateNotebook,
  uploadNoteAttachments,
} from "@/lib/notes-store";
import type { NoteListFilters } from "@/lib/notes-model";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";
import { createRootTask, ensureDatabaseReady, getBoardStateFromDatabase } from "@/lib/taskboard-store";

const enabled = process.env.NOTES_DB_TEST === "1";

function identity(suffix: string, role: "standard" | "admin" = "standard"): TaskboardUserIdentity {
  return {
    id: randomUUID(),
    authMode: "authelia",
    authProvider: "authelia",
    email: `notes-${suffix}@example.invalid`,
    username: `notes-${suffix}`,
    displayName: `Notes ${suffix}`,
    role,
    isDisabled: false,
  };
}

function list(user: TaskboardUserIdentity, filters: Partial<NoteListFilters>) {
  return listNotes(user, { scope: "all", status: "active", limit: 100, offset: 0, ...filters });
}

function blocks(text: string) {
  return {
    blocks: [{ type: "paragraph", content: [{ type: "text", text }] }],
    markdown: text,
    text,
  };
}

const notFound = (error: unknown) => error instanceof NotesNotFoundError;
const forbidden = (error: unknown) => error instanceof BoardAccessError && error.status === 403;

test(
  "notes follow personal ownership and board access, keep links private, and survive deletions",
  { skip: !enabled, concurrency: false },
  async () => {
    const pool = getPool();
    assert.ok(pool, "DATABASE_URL is required.");
    await ensureDatabaseReady();

    const suffix = `${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
    const owner = identity(`${suffix}-owner`);
    const editor = identity(`${suffix}-editor`);
    const viewer = identity(`${suffix}-viewer`);
    const outsider = identity(`${suffix}-outsider`);
    const admin = identity(`${suffix}-admin`, "admin");
    const everyone = [owner, editor, viewer, outsider, admin];

    try {
      for (const user of everyone) {
        await pool.query(
          `INSERT INTO users (id, email, username, display_name, role, auth_provider) VALUES ($1, $2, $3, $4, $5, 'authelia')`,
          [user.id, user.email, user.username, user.displayName, user.role],
        );
      }

      // Each user's personal board is created on first load.
      await getBoardStateFromDatabase(owner);
      await getBoardStateFromDatabase(outsider);
      const boardId = (
        await pool.query<{ id: string }>(
          `SELECT id FROM boards WHERE owner_user_id = $1 AND board_type = 'personal' LIMIT 1`,
          [owner.id],
        )
      ).rows[0]?.id;
      const outsiderBoardId = (
        await pool.query<{ id: string }>(
          `SELECT id FROM boards WHERE owner_user_id = $1 AND board_type = 'personal' LIMIT 1`,
          [outsider.id],
        )
      ).rows[0]?.id;
      assert.ok(boardId && outsiderBoardId);
      const buckets = (
        await pool.query<{ id: string }>(`SELECT id FROM buckets WHERE board_id = $1 ORDER BY sort_order ASC`, [boardId])
      ).rows.map((row) => row.id);
      const outsiderBucketId = (
        await pool.query<{ id: string }>(`SELECT id FROM buckets WHERE board_id = $1 ORDER BY sort_order ASC LIMIT 1`, [
          outsiderBoardId,
        ])
      ).rows[0]?.id;
      assert.ok(buckets.length >= 2 && outsiderBucketId, "Seeded boards should have buckets.");
      const [bucketA, bucketB] = buckets;

      // Explicit sharing: editor and viewer on the owner's board.
      await pool.query(
        `INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, 'editor'), ($1, $3, 'viewer')`,
        [boardId, editor.id, viewer.id],
      );

      // Notes receives the existing bucket colours through its permissioned
      // homes response, including nulls, without exposing another board.
      await pool.query(`UPDATE buckets SET color = '#d97706' WHERE id = $1`, [bucketA]);
      await pool.query(`UPDATE buckets SET color = NULL WHERE id = $1`, [bucketB]);
      const homes = await listNoteHomeOptions(viewer);
      const sharedHome = homes.find(home => home.boardId === boardId);
      assert.equal(sharedHome?.canEdit, false);
      assert.equal(sharedHome?.buckets.find(bucket => bucket.id === bucketA)?.color, "#d97706");
      assert.equal(sharedHome?.buckets.find(bucket => bucket.id === bucketB)?.color, null);
      assert.equal(homes.some(home => home.boardId === outsiderBoardId), false);

      // --- Personal notes are private, even from admins.
      const personal = await createNote(owner, {
        title: "  Vendor   call ",
        content: blocks("Ask about renewal pricing"),
        labels: ["Vendor", "vendor", "Q4"],
      });
      assert.equal(personal.title, "Vendor call");
      assert.deepEqual(personal.home, { kind: "personal" });
      assert.deepEqual(personal.labels, ["Q4", "Vendor"]);
      assert.equal(personal.canEdit, true);
      assert.equal(personal.contentVersion, 1);

      for (const user of [editor, viewer, outsider, admin]) {
        await assert.rejects(getNote(user, personal.id), notFound, user.displayName);
      }

      // --- Board notes follow board access.
      const boardNote = await createNote(owner, {
        title: "Kickoff notes",
        content: blocks("Agenda and decisions"),
        boardId,
        bucketId: bucketA,
        labels: ["Vendor"],
      });
      assert.equal(boardNote.home.kind, "board");
      assert.equal((await getNote(viewer, boardNote.id)).canEdit, false);
      assert.equal((await getNote(editor, boardNote.id)).canEdit, true);
      await assert.rejects(getNote(admin, boardNote.id), notFound);
      await assert.rejects(getNote(outsider, boardNote.id), notFound);
      await assert.rejects(updateNote(viewer, boardNote.id, { pinned: true }), forbidden);
      await assert.rejects(createNote(viewer, { title: "No", boardId }), forbidden);
      await assert.rejects(
        createNote(editor, { title: "Wrong bucket", boardId, bucketId: outsiderBucketId }),
        /Bucket not found/,
      );

      // --- Version checks stop silent overwrites.
      const edited = await updateNote(editor, boardNote.id, {
        title: "Kickoff notes (edited)",
        content: blocks("Agenda, decisions, and owners"),
        expectedVersion: 1,
      });
      assert.equal(edited.contentVersion, 2);
      assert.equal(edited.updatedByDisplayName, editor.displayName);
      await assert.rejects(
        updateNote(owner, boardNote.id, { title: "Stale", expectedVersion: 1 }),
        (error: unknown) => error instanceof NoteConflictError && error.currentVersion === 2,
      );
      await assert.rejects(updateNote(owner, boardNote.id, { title: "No version" }), /expectedVersion/);

      // --- Lists, search, and labels.
      const ownerAll = await list(owner, {});
      assert.ok(ownerAll.some((note) => note.id === personal.id));
      assert.ok(ownerAll.some((note) => note.id === boardNote.id));
      const viewerAll = await list(viewer, {});
      assert.ok(viewerAll.some((note) => note.id === boardNote.id));
      assert.ok(!viewerAll.some((note) => note.id === personal.id));
      assert.deepEqual(
        (await list(owner, { scope: "personal" })).map((note) => note.id),
        [personal.id],
      );
      assert.deepEqual(
        (await list(viewer, { scope: "board", boardId, bucketId: bucketA })).map((note) => note.id),
        [boardNote.id],
      );
      await assert.rejects(list(outsider, { scope: "board", boardId }), forbidden);
      assert.deepEqual((await list(owner, { query: "renew" })).map((note) => note.id), [personal.id]);
      assert.deepEqual((await list(owner, { query: "owners kickoff" })).map((note) => note.id), [boardNote.id]);
      assert.equal((await list(owner, { label: "vendor" })).length, 2);
      assert.ok((await listBoardLabels(viewer, boardId)).includes("Vendor"));
      assert.deepEqual(
        (await listNoteTags(owner)).map((tag) => tag.name),
        ["Q4", "Vendor"],
      );

      // --- Links never reveal what the viewer cannot read.
      const taskId = await createRootTask(owner, { bucketId: bucketA, title: "Renew vendor contract" }, { boardId });
      assert.ok(taskId);
      await linkNoteToTask(owner, personal.id, taskId);
      const linkedBoardNote = await linkNoteToTask(editor, boardNote.id, taskId);
      assert.deepEqual(linkedBoardNote.linkedTasks.map((task) => task.id), [taskId]);
      assert.deepEqual(
        (await listTaskLinkedNotes(viewer, taskId)).map((note) => note.id),
        [boardNote.id],
      );
      assert.deepEqual(
        new Set((await listTaskLinkedNotes(owner, taskId)).map((note) => note.id)),
        new Set([personal.id, boardNote.id]),
      );
      await assert.rejects(listTaskLinkedNotes(outsider, taskId), notFound);
      await assert.rejects(linkNoteToTask(viewer, boardNote.id, taskId), forbidden);
      const outsiderTaskId = await createRootTask(
        outsider,
        { bucketId: outsiderBucketId, title: "Outsider task" },
        { boardId: outsiderBoardId },
      );
      assert.ok(outsiderTaskId);
      await assert.rejects(linkNoteToTask(editor, boardNote.id, outsiderTaskId), notFound);
      // A private note's link to a task on someone else's board stays invisible to them.
      await pool.query(`INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, 'viewer')`, [
        outsiderBoardId,
        owner.id,
      ]);
      const crossLinked = await linkNoteToTask(owner, personal.id, outsiderTaskId);
      assert.equal(crossLinked.linkedTasks.length, 2);
      assert.deepEqual(await listTaskLinkedNotes(outsider, outsiderTaskId), []);
      const unlinked = await unlinkNoteFromTask(owner, personal.id, outsiderTaskId);
      assert.ok(unlinked);
      assert.equal(unlinked.linkedTasks.length, 1);

      // --- Convert to task keeps the note and links it.
      const converted = await convertNoteToTask(editor, boardNote.id, {});
      assert.equal(converted.boardId, boardId);
      const convertedTask = await pool.query<{ title: string; bucket_id: string }>(
        `SELECT title, bucket_id FROM tasks WHERE id = $1`,
        [converted.taskId],
      );
      assert.equal(convertedTask.rows[0]?.title, "Kickoff notes (edited)");
      assert.equal(convertedTask.rows[0]?.bucket_id, bucketA);
      assert.ok(converted.note.linkedTasks.some((task) => task.id === converted.taskId));
      await assert.rejects(convertNoteToTask(owner, personal.id, {}), /Choose a bucket/);
      const personalConverted = await convertNoteToTask(owner, personal.id, { bucketId: bucketB, title: "Call vendor" });
      assert.equal(personalConverted.boardId, boardId);
      assert.equal(personalConverted.note.home.kind, "personal");

      // --- Boards with seed-style ids (deterministic, not RFC variant) still work.
      const seedStyleBoardId = `5eed0000-0000-2000-c000-${randomUUID().slice(-12)}`;
      const seedStyleBucketId = randomUUID();
      await pool.query(
        `
          INSERT INTO boards (id, owner_user_id, board_type, personal_visibility, title, created_by_user_id, updated_by_user_id)
          VALUES ($1, $2, 'personal', 'private', 'Seed-style board', $2, $2)
        `,
        [seedStyleBoardId, owner.id],
      );
      await pool.query(`INSERT INTO board_members (board_id, user_id, role) VALUES ($1, $2, 'owner')`, [
        seedStyleBoardId,
        owner.id,
      ]);
      await pool.query(`INSERT INTO buckets (id, board_id, title, sort_order) VALUES ($1, $2, 'Inbox', 1000)`, [
        seedStyleBucketId,
        seedStyleBoardId,
      ]);
      const seedStyleNote = await createNote(owner, {
        title: "On a seeded board",
        boardId: seedStyleBoardId,
        bucketId: seedStyleBucketId,
      });
      assert.equal(seedStyleNote.home.kind, "board");
      const seedStyleTask = await convertNoteToTask(owner, seedStyleNote.id, {});
      assert.equal(seedStyleTask.boardId, seedStyleBoardId);
      assert.deepEqual(
        (await list(owner, { scope: "board", boardId: seedStyleBoardId })).map((note) => note.id),
        [seedStyleNote.id],
      );
      await assert.rejects(getNote(editor, seedStyleNote.id), notFound);

      // --- Moving changes who can see the note; labels and tags carry over.
      const movedToBoard = await updateNote(owner, personal.id, { home: { boardId, bucketId: bucketB } });
      assert.equal(movedToBoard.home.kind, "board");
      assert.deepEqual(movedToBoard.labels, ["Q4", "Vendor"]);
      assert.equal((await getNote(viewer, personal.id)).canEdit, false);
      assert.deepEqual(await listNoteTags(owner), []);
      await assert.rejects(
        updateNote(editor, personal.id, { home: { boardId: outsiderBoardId } }),
        forbidden,
      );

      const movedToEditor = await updateNote(editor, boardNote.id, { home: { boardId: null } });
      assert.equal(movedToEditor.home.kind, "personal");
      assert.equal(movedToEditor.ownerUserId, editor.id);
      assert.deepEqual(movedToEditor.labels, ["Vendor"]);
      await assert.rejects(getNote(viewer, boardNote.id), notFound);
      await assert.rejects(getNote(owner, boardNote.id), notFound);

      // --- Nested notebooks; deleting one keeps its notes.
      const work = await createNotebook(owner, { title: "Work" });
      const projects = await createNotebook(owner, { title: "Projects", parentNotebookId: work.id });
      await assert.rejects(updateNotebook(owner, work.id, { parentNotebookId: projects.id }), /inside itself/);
      await assert.rejects(createNotebook(editor, { title: "Nope", parentNotebookId: work.id }), notFound);
      const filed = await createNote(owner, { title: "Roadmap", notebookId: projects.id });
      assert.equal(filed.notebookId, projects.id);
      assert.deepEqual(
        (await list(owner, { scope: "personal", notebookId: projects.id })).map((note) => note.id),
        [filed.id],
      );
      await deleteNotebook(owner, projects.id);
      assert.equal((await getNote(owner, filed.id)).notebookId, work.id);
      const notebooks = await listNotebooks(owner);
      assert.deepEqual(notebooks.notebooks.map((notebook) => notebook.title), ["Work"]);
      assert.equal(notebooks.notebooks[0]?.noteCount, 1);

      // --- Trash, restore, and purge (including attachment files).
      const attachments = await uploadNoteAttachments(owner, filed.id, [
        { originalName: "../../plan.txt", mimeType: "text/plain", sizeBytes: 5, buffer: new TextEncoder().encode("hello") },
      ]);
      assert.equal(attachments[0]?.originalName, "plan.txt");
      const storedName = (
        await pool.query<{ stored_name: string }>(`SELECT stored_name FROM note_attachments WHERE id = $1`, [
          attachments[0]?.id,
        ])
      ).rows[0]?.stored_name;
      assert.ok(storedName);
      const diskPath = getNoteAttachmentDiskPath(storedName);
      await access(diskPath);

      await assert.rejects(deleteNotePermanently(owner, filed.id), /trash before/);
      await trashNote(owner, filed.id);
      assert.ok(!(await list(owner, { scope: "personal" })).some((note) => note.id === filed.id));
      assert.deepEqual(
        (await list(owner, { scope: "personal", status: "trash" })).map((note) => note.id),
        [filed.id],
      );
      // A trashed note keeps reporting edit permission so Restore is offered.
      const trashed = await getNote(owner, filed.id);
      assert.ok(trashed.deletedAt);
      assert.equal(trashed.canEdit, true);
      await assert.rejects(updateNote(owner, filed.id, { pinned: true }), notFound);
      assert.equal((await restoreNote(owner, filed.id)).deletedAt, null);
      await trashNote(owner, filed.id);
      await pool.query(`UPDATE notes SET purge_after_at = NOW() - INTERVAL '1 minute' WHERE id = $1`, [filed.id]);
      await list(owner, { scope: "personal" });
      assert.equal((await pool.query(`SELECT 1 FROM notes WHERE id = $1`, [filed.id])).rowCount, 0);
      await assert.rejects(access(diskPath));

      // --- Archive and pin.
      const pinned = await updateNote(owner, personal.id, { pinned: true });
      assert.equal(pinned.pinned, true);
      assert.equal((await list(owner, { scope: "board", boardId }))[0]?.id, personal.id);
      await updateNote(owner, personal.id, { archived: true });
      assert.ok(!(await list(owner, { scope: "board", boardId })).some((note) => note.id === personal.id));
      assert.deepEqual(
        (await list(owner, { scope: "board", boardId, status: "archived" })).map((note) => note.id),
        [personal.id],
      );
      await updateNote(owner, personal.id, { archived: false });

      // --- Counts.
      const counts = await getBoardNoteCounts(viewer, boardId);
      assert.equal(counts.buckets[bucketB], 1);

      // --- Deleting a bucket moves its notes up to the board.
      await pool.query(`UPDATE tasks SET bucket_id = NULL WHERE bucket_id = $1`, [bucketB]);
      await pool.query(`DELETE FROM buckets WHERE id = $1`, [bucketB]);
      const afterBucket = await getNote(viewer, personal.id);
      assert.deepEqual(
        afterBucket.home.kind === "board" ? [afterBucket.home.boardId, afterBucket.home.bucketId] : null,
        [boardId, null],
      );

      // --- Deleting a board returns its notes to their owners as personal notes.
      await pool.query(`DELETE FROM boards WHERE id = $1`, [boardId]);
      const returned = await getNote(owner, personal.id);
      assert.deepEqual(returned.home, { kind: "personal" });
      assert.equal(returned.notebookId, null);
      await assert.rejects(getNote(viewer, personal.id), notFound);
      await assert.rejects(getNote(admin, personal.id), notFound);
    } finally {
      const ids = everyone.map((user) => user.id);
      await pool.query(`DELETE FROM notes WHERE owner_user_id = ANY($1::uuid[])`, [ids]);
      await pool.query(`DELETE FROM boards WHERE owner_user_id = ANY($1::uuid[])`, [ids]);
      await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [ids]);
      await pool.end();
    }
  },
);
