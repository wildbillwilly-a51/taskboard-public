import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { BoardAccessError } from "@/lib/board-access";
import { getPool } from "@/lib/db";
import {
  createRootTask,
  ensureDatabaseReady,
  getBoardRevisionForUser,
  getOrCreateUserRecord,
  loadPreferredTaskboardState,
  loadTaskboardState,
  updateTask,
} from "@/lib/taskboard-store";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";

const enabled = process.env.BOARD_REVISIONS_DB_TEST === "1";

function identity(label: string): TaskboardUserIdentity {
  const suffix = `${label}-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
  return {
    authMode: "authelia",
    authProvider: "authelia",
    email: `${suffix}@example.test`,
    displayName: `Revision ${suffix}`,
    role: "standard",
    isDisabled: false,
  };
}

// Open pages reload when a board's revision moves, so it must move for every
// real change by any writer, and stay put when nothing changed.
test("board revisions follow real changes from any writer", { skip: !enabled }, async () => {
  await ensureDatabaseReady();
  const pool = getPool();
  assert.ok(pool, "DATABASE_URL is required.");

  const withId = async (user: TaskboardUserIdentity) => {
    const client = await pool.connect();
    try {
      return { ...user, id: await getOrCreateUserRecord(client, user) };
    } finally {
      client.release();
    }
  };
  const ownerWithId = await withId(identity("owner"));
  const ownerState = await loadPreferredTaskboardState(ownerWithId);
  const otherState = await loadPreferredTaskboardState(await withId(identity("other")));
  assert.equal(ownerState.persistenceEnabled, true);
  const boardId = ownerState.board.id;
  const otherBoardId = otherState.board.id;
  assert.notEqual(boardId, otherBoardId);
  const current = async (id = boardId) =>
    Number((await pool.query<{ revision: string | null }>(
      `SELECT (SELECT revision FROM board_revisions WHERE board_id = $1)::text AS revision`,
      [id],
    )).rows[0].revision ?? 0);

  // Loading reports the revision it read, and loading again (with the
  // loader's housekeeping writes) does not move it: no reload loop.
  const bucketId = ownerState.board.buckets[0].id;
  const taskId = await createRootTask(ownerWithId, { bucketId, title: "Revision probe" }, { boardId });
  assert.ok(taskId);
  const afterCreate = await current();
  assert.ok(afterCreate > 0, "creating a task bumps the board");
  const loaded = await loadTaskboardState(ownerWithId, { boardId });
  assert.equal(loaded.board.revision, await current());
  const settled = await current();
  await loadTaskboardState(ownerWithId, { boardId });
  await loadTaskboardState(ownerWithId, { boardId });
  assert.equal(await current(), settled, "loading the board twice changes nothing");
  assert.equal(await getBoardRevisionForUser(ownerWithId, boardId), settled);

  // Ordinary edits bump; a statement that matches no rows does not.
  await updateTask(ownerWithId, taskId, { status: "active" }, { boardId });
  const afterEdit = await current();
  assert.ok(afterEdit > settled);
  await pool.query(`UPDATE tasks SET title = 'nothing' WHERE id = $1`, [randomUUID()]);
  assert.equal(await current(), afterEdit, "zero-row statements do not bump");

  // Child rows reached through their task bump the task's board.
  await pool.query(
    `INSERT INTO checklist_items (id, task_id, label, is_done, sort_order) VALUES ($1, $2, 'probe item', FALSE, 1)`,
    [randomUUID(), taskId],
  );
  const afterChecklist = await current();
  assert.ok(afterChecklist > afterEdit);

  // A move between boards bumps both sides, and only the boards involved.
  const otherBefore = await current(otherBoardId);
  await pool.query(
    `UPDATE tasks SET board_id = $2, bucket_id = (SELECT id FROM buckets WHERE board_id = $2 ORDER BY sort_order LIMIT 1) WHERE id = $1`,
    [taskId, otherBoardId],
  );
  assert.ok(await current() > afterChecklist);
  assert.ok(await current(otherBoardId) > otherBefore);
  const afterMove = await current();

  // A writer with only narrow grants can still
  // write and bumps the revision without any grant on the revision tables.
  const role = `tb_revision_probe_${randomUUID().replaceAll("-", "").slice(0, 12)}`;
  await pool.query(`CREATE ROLE ${role} NOLOGIN NOINHERIT`);
  try {
    await pool.query(`GRANT USAGE ON SCHEMA public TO ${role}`);
    await pool.query(`GRANT SELECT, UPDATE ON tasks TO ${role}`);
    const beforeRestricted = await current(otherBoardId);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${role}`);
      await client.query(`UPDATE tasks SET title = 'restricted writer' WHERE id = $1`, [taskId]);
      await client.query("COMMIT");
      assert.ok(await current(otherBoardId) > beforeRestricted, "a restricted writer bumps the board");

      await client.query("BEGIN");
      await client.query(`SET LOCAL ROLE ${role}`);
      await assert.rejects(
        client.query(`SELECT queue_board_revisions(ARRAY[$1::uuid])`, [boardId]),
        /permission denied/,
        "nobody calls the revision functions directly",
      );
      await client.query("ROLLBACK");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } finally {
    await pool.query(`DROP OWNED BY ${role}`);
    await pool.query(`DROP ROLE ${role}`);
  }

  // Cascade deletes of a task and its children succeed and bump its board.
  const beforeDelete = await current(otherBoardId);
  await pool.query(`DELETE FROM tasks WHERE id = $1`, [taskId]);
  assert.ok(await current(otherBoardId) > beforeDelete);
  assert.ok(afterMove > 0);

  // The check endpoint applies the same read access as loading the board.
  await assert.rejects(getBoardRevisionForUser(ownerWithId, otherBoardId), BoardAccessError);
});

// Revisions are taken at commit, so they follow commit order, and a writer
// holds no revision lock while it goes on to lock other rows.
test("board revisions follow commit order and add no lock waits", { skip: !enabled }, async () => {
  await ensureDatabaseReady();
  const pool = getPool();
  assert.ok(pool, "DATABASE_URL is required.");
  const client = await pool.connect();
  let user: TaskboardUserIdentity;
  try {
    const base = identity("order");
    user = { ...base, id: await getOrCreateUserRecord(client, base) };
  } finally {
    client.release();
  }
  const state = await loadPreferredTaskboardState(user);
  const boardId = state.board.id;
  const bucketId = state.board.buckets[0].id;
  const taskA = await createRootTask(user, { bucketId, title: "Order A" }, { boardId });
  const taskB = await createRootTask(user, { bucketId, title: "Order B" }, { boardId });
  assert.ok(taskA && taskB);
  const current = async () =>
    Number((await pool.query<{ revision: string }>(
      `SELECT revision::text AS revision FROM board_revisions WHERE board_id = $1`,
      [boardId],
    )).rows[0].revision);

  const first = await pool.connect();
  const second = await pool.connect();
  try {
    // The first writer starts, the second commits first; the first writer's
    // later commit must still end with the higher revision, or pages that saw
    // the second commit would miss the first.
    await first.query("BEGIN");
    await first.query(`UPDATE tasks SET title = 'Order A1' WHERE id = $1`, [taskA]);
    await second.query("BEGIN");
    const secondUpdate = second.query(`UPDATE tasks SET title = 'Order B1' WHERE id = $1`, [taskB]);
    // The second writer does not wait for the first: no revision lock is held
    // before commit.
    const outcome = await Promise.race([
      secondUpdate.then(() => "done"),
      new Promise((resolve) => setTimeout(() => resolve("blocked"), 2_000)),
    ]);
    assert.equal(outcome, "done", "an open writer on the same board does not block another");
    await second.query("COMMIT");
    const afterSecond = await current();
    await first.query("COMMIT");
    assert.ok(await current() > afterSecond, "the later commit has the higher revision");

    // The cross-row case from review: each writer holds one task and then
    // wants the other's. Without a revision lock this is an ordinary wait,
    // resolved when the other commits, not a deadlock.
    await first.query("BEGIN");
    await first.query(`UPDATE tasks SET title = 'Order A2' WHERE id = $1`, [taskA]);
    await second.query("BEGIN");
    await second.query(`UPDATE tasks SET title = 'Order B2' WHERE id = $1`, [taskB]);
    const firstWaits = first.query(`UPDATE tasks SET title = 'Order B3' WHERE id = $1`, [taskB]);
    await second.query("COMMIT");
    await firstWaits;
    await first.query("COMMIT");
  } catch (error) {
    await first.query("ROLLBACK").catch(() => {});
    await second.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    first.release();
    second.release();
  }
  // Savepoints, used by transactions: a change rolled back to
  // its savepoint bumps nothing; a released one bumps at commit.
  const writer = await pool.connect();
  try {
    const beforeRollback = await current();
    await writer.query("BEGIN");
    await writer.query("SAVEPOINT change");
    await writer.query(`UPDATE tasks SET title = 'Rolled back' WHERE id = $1`, [taskA]);
    await writer.query("ROLLBACK TO SAVEPOINT change");
    await writer.query("COMMIT");
    assert.equal(await current(), beforeRollback, "a change rolled back to its savepoint bumps nothing");

    await writer.query("BEGIN");
    await writer.query("SAVEPOINT change");
    await writer.query(`UPDATE tasks SET title = 'Released' WHERE id = $1`, [taskA]);
    await writer.query("RELEASE SAVEPOINT change");
    await writer.query("COMMIT");
    assert.ok(await current() > beforeRollback, "a released change bumps at commit");

    // A board changed and then deleted in the same transaction commits
    // cleanly and leaves no revision behind.
    const doomedClient = await pool.connect();
    let doomedBoardId: string;
    try {
      const base = identity("doomed");
      const doomedUser = { ...base, id: await getOrCreateUserRecord(doomedClient, base) };
      doomedBoardId = (await loadPreferredTaskboardState(doomedUser)).board.id;
    } finally {
      doomedClient.release();
    }
    await writer.query("BEGIN");
    await writer.query(`UPDATE boards SET title = 'Doomed' WHERE id = $1`, [doomedBoardId]);
    await writer.query(`UPDATE users SET last_selected_board_id = NULL WHERE last_selected_board_id = $1`, [doomedBoardId]);
    await writer.query(`DELETE FROM boards WHERE id = $1`, [doomedBoardId]);
    await writer.query("COMMIT");
    assert.equal(
      (await pool.query(`SELECT 1 FROM board_revisions WHERE board_id = $1`, [doomedBoardId])).rowCount,
      0,
      "a deleted board keeps no revision",
    );
  } catch (error) {
    await writer.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    writer.release();
  }

  assert.equal(
    Number((await pool.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM board_revision_pending`)).rows[0].count),
    0,
    "nothing is left queued after commit",
  );
});
