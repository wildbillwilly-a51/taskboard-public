import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { ensureBoardRevisionSchema } from "@/lib/board-revision-schema";
import { getPool } from "@/lib/db";
import {
  createRootTask,
  ensureDatabaseReady,
  getOrCreateUserRecord,
  loadPreferredTaskboardState,
} from "@/lib/taskboard-store";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";

const enabled = process.env.BOARD_REVISIONS_DB_TEST === "1";

function identity(label: string): TaskboardUserIdentity {
  const suffix = `${label}-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
  return {
    authMode: "authelia",
    authProvider: "authelia",
    email: `${suffix}@example.test`,
    displayName: `Note revision ${suffix}`,
    role: "standard",
    isDisabled: false,
  };
}

async function setup() {
  await ensureDatabaseReady();
  const pool = getPool();
  assert.ok(pool, "DATABASE_URL is required.");
  const client = await pool.connect();
  let user: TaskboardUserIdentity & { id: string };
  try {
    const base = identity("notes");
    user = { ...base, id: await getOrCreateUserRecord(client, base) };
  } finally {
    client.release();
  }
  const state = await loadPreferredTaskboardState(user);
  const boardId = state.board.id;
  const bucketId = state.board.buckets[0].id;
  const revision = async (kind: "user" | "board", id: string) =>
    Number((await pool.query<{ revision: string | null }>(
      `SELECT (SELECT revision FROM note_revisions WHERE scope_kind = $1 AND scope_id = $2)::text AS revision`,
      [kind, id],
    )).rows[0].revision ?? 0);
  const boardRevision = async () =>
    Number((await pool.query<{ revision: string | null }>(
      `SELECT (SELECT revision FROM board_revisions WHERE board_id = $1)::text AS revision`,
      [boardId],
    )).rows[0].revision ?? 0);
  return { pool, user, boardId, bucketId, revision, boardRevision };
}

// Notes pages reload when a note scope's revision moves: a person's personal
// notes, or a board's notes. Board notes must not move the board's own
// revision, so typing in one does not reload that board's pages.
test("note revisions follow note changes in their scope", { skip: !enabled }, async () => {
  const { pool, user, boardId, bucketId, revision, boardRevision } = await setup();
  const personal = () => revision("user", user.id);
  const boardNotes = () => revision("board", boardId);

  const noteId = randomUUID();
  await pool.query(`INSERT INTO notes (id, owner_user_id, title) VALUES ($1, $2, 'Personal probe')`, [noteId, user.id]);
  const afterCreate = await personal();
  assert.ok(afterCreate > 0, "a personal note bumps its owner's scope");

  const boardBefore = await boardRevision();
  const boardNotesBefore = await boardNotes();
  await pool.query(`UPDATE notes SET title = 'Personal probe 2', content_version = content_version + 1 WHERE id = $1`, [noteId]);
  assert.ok(await personal() > afterCreate);
  assert.equal(await boardNotes(), boardNotesBefore, "a personal note leaves board notes alone");

  // Moving it to the board bumps both scopes; the board's own revision stays.
  const beforeMove = await personal();
  await pool.query(`UPDATE notes SET board_id = $2, bucket_id = $3 WHERE id = $1`, [noteId, boardId, bucketId]);
  assert.ok(await personal() > beforeMove, "the scope it left");
  assert.ok(await boardNotes() > boardNotesBefore, "the scope it joined");
  assert.equal(await boardRevision(), boardBefore, "board notes do not reload board pages");

  // Rows of a note bump the note's scope.
  const taskId = await createRootTask(user, { bucketId, title: "Linked task" }, { boardId });
  assert.ok(taskId);
  let before = await boardNotes();
  await pool.query(`INSERT INTO note_task_links (note_id, task_id) VALUES ($1, $2)`, [noteId, taskId]);
  assert.ok(await boardNotes() > before, "a task link");
  const labelId = randomUUID();
  await pool.query(`INSERT INTO labels (id, board_id, name) VALUES ($1, $2, 'note label')`, [labelId, boardId]);
  before = await boardNotes();
  await pool.query(`INSERT INTO note_labels (note_id, label_id) VALUES ($1, $2)`, [noteId, labelId]);
  assert.ok(await boardNotes() > before, "a board label");
  before = await boardNotes();
  await pool.query(
    `INSERT INTO note_attachments (id, note_id, original_name, stored_name, size_bytes) VALUES ($1, $2, 'a.txt', $3, 1)`,
    [randomUUID(), noteId, `probe-${randomUUID()}`],
  );
  assert.ok(await boardNotes() > before, "an attachment");

  // Notebooks and tags are the owner's.
  before = await personal();
  const notebookId = randomUUID();
  await pool.query(
    `INSERT INTO note_notebooks (id, owner_user_id, title, sort_order) VALUES ($1, $2, 'Probe book', 1)`,
    [notebookId, user.id],
  );
  assert.ok(await personal() > before, "a notebook");
  before = await personal();
  const tagId = randomUUID();
  await pool.query(`INSERT INTO note_tags (id, owner_user_id, name) VALUES ($1, $2, $3)`, [tagId, user.id, `tag-${randomUUID().slice(0, 8)}`]);
  assert.ok(await personal() > before, "a tag");
  before = await boardNotes();
  await pool.query(`INSERT INTO note_tag_links (note_id, tag_id) VALUES ($1, $2)`, [noteId, tagId]);
  assert.ok(await boardNotes() > before, "a tag on a board note bumps the note's scope");

  // Zero-row statements bump nothing.
  const settled = [await personal(), await boardNotes()];
  await pool.query(`UPDATE notes SET title = 'nobody' WHERE id = $1`, [randomUUID()]);
  await pool.query(`DELETE FROM note_task_links WHERE note_id = $1`, [randomUUID()]);
  assert.deepEqual([await personal(), await boardNotes()], settled, "zero-row statements do not bump");

  // A restricted writer bumps notes without any grant on
  // the revision tables, and cannot call the queue directly.
  const role = `tb_note_revision_probe_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await pool.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT`);
  try {
    await pool.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await pool.query(`GRANT SELECT, UPDATE ON notes TO ${role}`);
    const client = await pool.connect();
    try {
      before = await boardNotes();
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${role}`);
      await client.query(`UPDATE notes SET title = 'restricted writer', content_version = content_version + 1 WHERE id = $1`, [noteId]);
      await client.query("COMMIT");
      assert.ok(await boardNotes() > before, "a restricted writer bumps the note's scope");
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${role}`);
      await assert.rejects(
        client.query(`SELECT queue_note_revisions(ARRAY['user'], ARRAY[$1::uuid])`, [user.id]),
        /permission denied/,
      );
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.query(`DROP OWNED BY ${role}`);
    await pool.query(`DROP ROLE ${role}`);
  }

  // Deleting the note cascades its rows and bumps its scope once more.
  before = await boardNotes();
  await pool.query(`DELETE FROM notes WHERE id = $1`, [noteId]);
  assert.ok(await boardNotes() > before);
  assert.equal(
    Number((await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM note_revision_pending`)).rows[0].count),
    0,
    "nothing is left queued after commit",
  );
});

// Board and note bumps share one flush that locks board rows before note rows,
// so transactions touching a task and a note in opposite orders only wait for
// each other at commit, never deadlock.
test("board and note revisions commit in one lock order", { skip: !enabled }, async () => {
  const { pool, user, boardId, bucketId, revision, boardRevision } = await setup();
  const taskId = await createRootTask(user, { bucketId, title: "Order task" }, { boardId });
  assert.ok(taskId);
  const noteA = randomUUID();
  const noteB = randomUUID();
  await pool.query(
    `INSERT INTO notes (id, owner_user_id, board_id, bucket_id, title) VALUES ($1, $3, $4, $5, 'A'), ($2, $3, $4, $5, 'B')`,
    [noteA, noteB, user.id, boardId, bucketId],
  );
  const taskB = await createRootTask(user, { bucketId, title: "Order task B" }, { boardId });
  assert.ok(taskB);

  for (let round = 0; round < 5; round += 1) {
    const first = await pool.connect();
    const second = await pool.connect();
    try {
      // First touches task then note; second touches note then task, on
      // different rows, so only the revision rows are shared.
      await first.query("BEGIN");
      await second.query("BEGIN");
      await first.query(`UPDATE tasks SET title = $2 WHERE id = $1`, [taskId, `T${round}`]);
      await second.query(`UPDATE notes SET title = $2 WHERE id = $1`, [noteB, `B${round}`]);
      await first.query(`UPDATE notes SET title = $2 WHERE id = $1`, [noteA, `A${round}`]);
      await second.query(`UPDATE tasks SET title = $2 WHERE id = $1`, [taskB, `U${round}`]);
      const boardBefore = await boardRevision();
      const notesBefore = await revision("board", boardId);
      await Promise.all([first.query("COMMIT"), second.query("COMMIT")]);
      assert.ok(await boardRevision() > boardBefore);
      assert.ok(await revision("board", boardId) > notesBefore);
    } catch (error) {
      await first.query("ROLLBACK").catch(() => {});
      await second.query("ROLLBACK").catch(() => {});
      throw error;
    } finally {
      first.release();
      second.release();
    }
  }
});

// Upgrading from Phase 1 (trigger on flush_board_revisions) points the board
// trigger at the shared flush; an older app version reinstalling its own
// trigger still bumps boards, and notes keep flushing.
test("revision flush triggers survive upgrade and an older runner", { skip: !enabled }, async () => {
  const { pool, user, boardId, bucketId, revision, boardRevision } = await setup();
  const flushOf = async (table: string) =>
    (await pool.query<{ proname: string }>(
      `SELECT p.proname FROM pg_trigger t JOIN pg_proc p ON p.oid = t.tgfoid WHERE t.tgrelid = $1::regclass AND NOT t.tgisinternal AND t.tgname LIKE '%_flush'`,
      [table],
    )).rows.map((row) => row.proname);

  // What an older runner does.
  const olderRunner = async () => {
    await pool.query(`DROP TRIGGER IF EXISTS board_revision_flush ON board_revision_pending`);
    await pool.query(`CREATE CONSTRAINT TRIGGER board_revision_flush AFTER INSERT ON board_revision_pending
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION flush_board_revisions()`);
  };
  try {
    await olderRunner();
    assert.deepEqual(await flushOf("board_revision_pending"), ["flush_board_revisions"]);
    const taskId = await createRootTask(user, { bucketId, title: "Older runner" }, { boardId });
    assert.ok(taskId);
    const noteId = randomUUID();
    const notesBefore = await revision("user", user.id);
    const boardBefore = await boardRevision();
    const client = await pool.connect();
    try {
      // A transaction with both kinds under the older board trigger.
      await client.query("BEGIN");
      await client.query(`UPDATE tasks SET title = 'Older runner 2' WHERE id = $1`, [taskId]);
      await client.query(`INSERT INTO notes (id, owner_user_id, title) VALUES ($1, $2, 'Older runner note')`, [noteId, user.id]);
      await client.query("COMMIT");
    } finally {
      client.release();
    }
    assert.ok(await boardRevision() > boardBefore, "boards still bump");
    assert.ok(await revision("user", user.id) > notesBefore, "notes still bump");

    // Exercise the historical baseline upgrade explicitly. Recorded startup
    // does not replay this helper after baseline adoption.
    const client2 = await pool.connect();
    try {
      await ensureBoardRevisionSchema(client2);
    } finally {
      client2.release();
    }
    assert.deepEqual(await flushOf("board_revision_pending"), ["flush_live_revisions"]);
    assert.deepEqual(await flushOf("note_revision_pending"), ["flush_live_revisions"]);
    const again = await boardRevision();
    await pool.query(`UPDATE tasks SET title = 'After upgrade' WHERE id = $1`, [taskId]);
    assert.ok(await boardRevision() > again);
  } finally {
    const client3 = await pool.connect();
    try {
      await ensureBoardRevisionSchema(client3);
    } finally {
      client3.release();
    }
  }
  for (const table of ["board_revision_pending", "note_revision_pending"]) {
    assert.equal(
      Number((await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM ${table}`)).rows[0].count),
      0,
      `${table} is empty after commit`,
    );
  }
});
