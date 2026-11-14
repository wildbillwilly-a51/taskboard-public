import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { getPool } from "@/lib/db";
import { ensureDatabaseReady } from "@/lib/taskboard-store";

const enabled = process.env.NOTES_DB_TEST === "1";

test("notes keep their owner when a user is disabled and refuse direct owner deletion", { skip: !enabled }, async () => {
  const pool = getPool();
  assert.ok(pool, "DATABASE_URL is required.");
  await ensureDatabaseReady();

  const owner = randomUUID();
  const boardOwner = randomUUID();
  const board = randomUUID();
  const personalNote = randomUUID();
  const boardNote = randomUUID();
  try {
    await pool.query(`INSERT INTO users(id,email,display_name,role,auth_provider) VALUES
      ($1,'owner-fk-owner@example.invalid','Owner FK owner','standard','authelia'),
      ($2,'owner-fk-board@example.invalid','Owner FK board','standard','authelia')`, [owner, boardOwner]);
    await pool.query(`INSERT INTO boards(id,owner_user_id,title,personal_visibility) VALUES($1,$2,'Owner FK board','private')`, [board, boardOwner]);
    await pool.query(`INSERT INTO notes(id,owner_user_id,title,content_json) VALUES
      ($1,$2,'Personal','[]'),($3,$2,'Board','[]')`, [personalNote, owner, boardNote]);
    await pool.query(`UPDATE notes SET board_id=$1 WHERE id=$2`, [board, boardNote]);

    await assert.rejects(pool.query(`DELETE FROM users WHERE id=$1`, [owner]), { code: "23503" });
    await pool.query(`DELETE FROM boards WHERE id=$1`, [board]);
    await assert.rejects(pool.query(`DELETE FROM users WHERE id=$1`, [owner]), { code: "23503" });
    await pool.query(`UPDATE users SET is_disabled=TRUE WHERE id=$1`, [owner]);
    assert.equal((await pool.query(`SELECT is_disabled FROM users WHERE id=$1`, [owner])).rows[0]?.is_disabled, true);
    assert.equal((await pool.query(`SELECT count(*)::int AS count FROM notes WHERE owner_user_id=$1`, [owner])).rows[0]?.count, 2);

    await pool.query(`DELETE FROM notes WHERE owner_user_id=$1`, [owner]);
    await pool.query(`DELETE FROM users WHERE id=$1`, [owner]);
    assert.equal((await pool.query(`SELECT 1 FROM users WHERE id=$1`, [owner])).rowCount, 0);
  } finally {
    await pool.query(`DELETE FROM notes WHERE owner_user_id = ANY($1::uuid[])`, [[owner, boardOwner]]);
    await pool.query(`DELETE FROM boards WHERE id=$1`, [board]);
    await pool.query(`DELETE FROM users WHERE id = ANY($1::uuid[])`, [[owner, boardOwner]]);
    await pool.end();
  }
});
