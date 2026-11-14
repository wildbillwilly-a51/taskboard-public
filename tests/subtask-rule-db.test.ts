import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { getPool } from "@/lib/db";
import {
  createRootTask,
  createSubtask,
  createSubtaskOnBoard,
  reconcileSharedAncestors,
  setSharedSubtaskCompletion,
} from "@/lib/taskboard-store";
import { simplifySubtasks, simpleSubtasksRepairKey } from "./fixtures/legacy-subtask-cleanup";
import { findSubtaskRuleViolations, SUBTASK_RULE_CONSTRAINT } from "@/lib/subtask-rule";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";

// The subtask rule (see subtask-rule.ts) holds in the database for every
// writer, and the one-time clean-up brings old rows to it without losing
// anything a person wrote. Run against the isolated taskboard_visual_test DB.
const enabled = process.env.SUBTASK_RULE_DB_TEST === "1";

async function setUp() {
  const pool = getPool();
  assert.ok(pool, "DATABASE_URL is required.");
  const actor = (await pool.query<{ id: string; email: string; display_name: string; username: string | null; role: "admin" | "standard"; bucket_id: string; board_id: string }>(`
    SELECT users.id, users.email, users.display_name, users.username, users.role, buckets.id AS bucket_id, boards.id AS board_id
    FROM users
    JOIN boards ON boards.owner_user_id = users.id AND boards.board_type = 'personal'
    JOIN buckets ON buckets.board_id = boards.id
    WHERE users.is_disabled = FALSE
    ORDER BY users.created_at, buckets.sort_order LIMIT 1`)).rows[0];
  assert.ok(actor, "A user with a personal board and bucket is required.");
  const identity: TaskboardUserIdentity = {
    id: actor.id, authMode: "authelia", authProvider: "authelia", email: actor.email, displayName: actor.display_name,
    ...(actor.username ? { username: actor.username } : {}), role: actor.role, isDisabled: false,
  };
  const created: string[] = [];
  const root = async (title: string) => {
    const id = await createRootTask(identity, { bucketId: actor.bucket_id, title });
    assert.ok(id);
    created.push(id);
    return id;
  };
  const cleanUp = () => pool.query(`DELETE FROM tasks WHERE id = ANY($1::uuid[])`, [created]);
  return { pool, actor, identity, root, cleanUp };
}

test("the database refuses subtask detail from any writer, and still allows revoking a share", { skip: !enabled }, async () => {
  const { pool, actor, identity, root, cleanUp } = await setUp();
  try {
    const taskId = await root(`Rule task ${randomUUID()}`);
    const subtaskId = await createSubtask(identity, { parentTaskId: taskId, title: "Step" });
    assert.ok(subtaskId);
    const refused = /Subtasks only have|tasks_subtask_simple_check/;
    await assert.rejects(pool.query(`UPDATE tasks SET status = 'waiting' WHERE id = $1`, [subtaskId]), refused);
    await assert.rejects(pool.query(`UPDATE tasks SET summary = 'x' WHERE id = $1`, [subtaskId]), refused);
    await assert.rejects(pool.query(`UPDATE tasks SET color = '#ff0000' WHERE id = $1`, [subtaskId]), refused);
    await pool.query(`UPDATE tasks SET color = NULL, icon = NULL WHERE id = $1`, [subtaskId]);
    await pool.query(`UPDATE tasks SET color = '#64748b', icon = 'layers' WHERE id = $1`, [subtaskId]);
    await assert.rejects(pool.query(
      `INSERT INTO task_notes (id, board_id, task_id, body, note_type) VALUES ($1, $2, $3, 'x', 'working')`,
      [randomUUID(), actor.board_id, subtaskId]), refused);
    await assert.rejects(pool.query(
      `INSERT INTO checklist_items (id, task_id, label, is_done, sort_order) VALUES ($1, $2, 'x', FALSE, 1000)`,
      [randomUUID(), subtaskId]), refused);
    const labelId = (await pool.query<{ id: string }>(
      `INSERT INTO labels (id, board_id, name) VALUES ($1, $2, $3) RETURNING id`, [randomUUID(), actor.board_id, `rule-${randomUUID()}`])).rows[0].id;
    await assert.rejects(pool.query(`INSERT INTO task_labels (task_id, label_id) VALUES ($1, $2)`, [subtaskId, labelId]), refused);
    await pool.query(`DELETE FROM labels WHERE id = $1`, [labelId]);
    // A note already on the task cannot be moved onto the subtask either.
    const noteId = randomUUID();
    await pool.query(`INSERT INTO task_notes (id, board_id, task_id, body, note_type) VALUES ($1, $2, $3, 'on the task', 'working')`,
      [noteId, actor.board_id, taskId]);
    await assert.rejects(pool.query(`UPDATE task_notes SET task_id = $2 WHERE id = $1`, [noteId, subtaskId]), refused);
    await assert.rejects(pool.query(
      `INSERT INTO task_public_shares (id, task_id, board_id, created_by_user_id, token_hash) VALUES ($1, $2, $3, $4, $5)`,
      [randomUUID(), subtaskId, actor.board_id, actor.id, randomUUID()]), refused);

    // A share made on a task that later became work inside another task can
    // still be revoked.
    const otherId = await root(`Rule shared ${randomUUID()}`);
    const shareId = randomUUID();
    await pool.query(`INSERT INTO task_public_shares (id, task_id, board_id, created_by_user_id, token_hash) VALUES ($1, $2, $3, $4, $5)`,
      [shareId, otherId, actor.board_id, actor.id, randomUUID()]);
    await pool.query(`UPDATE tasks SET status = 'todo', summary = '', color = '#64748b', icon = 'layers' WHERE id = $1`, [otherId]);
    await pool.query(`ALTER TABLE task_public_shares DISABLE TRIGGER task_public_shares_subtask_rule`);
    await pool.query(`ALTER TABLE tasks DISABLE TRIGGER tasks_subtask_rule`);
    try {
      await pool.query(`UPDATE tasks SET parent_task_id = $2 WHERE id = $1`, [otherId, taskId]);
    } finally {
      await pool.query(`ALTER TABLE tasks ENABLE TRIGGER tasks_subtask_rule`);
      await pool.query(`ALTER TABLE task_public_shares ENABLE TRIGGER task_public_shares_subtask_rule`);
    }
    await pool.query(`UPDATE task_public_shares SET revoked_at = NOW(), revoked_reason = 'test' WHERE id = $1`, [shareId]);
    await assert.rejects(pool.query(`UPDATE task_public_shares SET revoked_at = NULL WHERE id = $1`, [shareId]), refused,
      "A revoked share on a subtask cannot come back.");
  } finally {
    await cleanUp();
  }
});

test("a task with detail cannot become a subtask, even while its note is still being saved", { skip: !enabled }, async () => {
  const { pool, actor, root, cleanUp } = await setUp();
  const saving = await pool.connect();
  try {
    const parentId = await root(`Rule parent ${randomUUID()}`);
    const plainId = await root(`Rule plain ${randomUUID()}`);
    await pool.query(`UPDATE tasks SET status = 'todo', summary = '', color = '#64748b', icon = 'layers' WHERE id = $1`, [plainId]);
    await pool.query(`DELETE FROM task_notes WHERE task_id = $1`, [plainId]);

    // A note is being added to the task in one transaction ...
    await saving.query("BEGIN");
    await saving.query(`INSERT INTO task_notes (id, board_id, task_id, body, note_type) VALUES ($1, $2, $3, 'racing', 'working')`,
      [randomUUID(), actor.board_id, plainId]);
    // ... while another makes the task work inside a different one. It waits
    // for the note, then sees it and refuses.
    const nesting = pool.query(`UPDATE tasks SET parent_task_id = $2 WHERE id = $1`, [plainId, parentId]);
    await new Promise((resolve) => setTimeout(resolve, 300));
    await saving.query("COMMIT");
    await assert.rejects(nesting, /Subtasks only have/);
  } finally {
    saving.release();
    await cleanUp();
  }
});

test("shared-link completion keeps parents in step and leaves the shared task to its owner", { skip: !enabled }, async () => {
  const { pool, actor, identity, root, cleanUp } = await setUp();
  const client = await pool.connect();
  try {
    const taskId = await root(`Shared completion ${randomUUID()}`);
    const windowId = await createSubtask(identity, { parentTaskId: taskId, title: "Window" });
    const first = await createSubtask(identity, { parentTaskId: windowId!, title: "First" });
    const second = await createSubtask(identity, { parentTaskId: windowId!, title: "Second" });
    const status = async (id: string) => (await pool.query<{ status: string }>(`SELECT status FROM tasks WHERE id = $1`, [id])).rows[0].status;

    await client.query("BEGIN");
    await setSharedSubtaskCompletion(client, actor.board_id, first!, true, taskId);
    await setSharedSubtaskCompletion(client, actor.board_id, second!, true, taskId);
    await client.query("COMMIT");
    assert.equal(await status(windowId!), "done", "Finishing the last work finishes its window.");
    assert.equal(await status(taskId), "todo", "The shared task's status stays its owner's.");

    await client.query("BEGIN");
    await createSubtaskOnBoard(client, { id: actor.board_id }, { parentTaskId: windowId!, title: "Late addition" });
    await reconcileSharedAncestors(client, actor.board_id, windowId!, taskId);
    await client.query("COMMIT");
    assert.equal(await status(windowId!), "todo", "New work reopens finished work.");

    // Saving To do on a window that is not done leaves its finished work alone.
    await client.query("BEGIN");
    await setSharedSubtaskCompletion(client, actor.board_id, windowId!, false, taskId);
    await client.query("COMMIT");
    assert.equal(await status(first!), "done");

    await client.query("BEGIN");
    await setSharedSubtaskCompletion(client, actor.board_id, windowId!, true, taskId);
    await client.query("COMMIT");
    const inside = (await pool.query<{ status: string }>(`SELECT status FROM tasks WHERE parent_task_id = $1`, [windowId])).rows;
    assert.ok(inside.every((row) => row.status === "done"), "Ticking a window ticks everything inside it.");
  } finally {
    client.release();
    await cleanUp();
  }
});

test("the one-time clean-up moves what people wrote to the task, clears the rest, and installs the rule", { skip: !enabled }, async () => {
  const { pool, actor, root, cleanUp } = await setUp();
  const client = await pool.connect();
  try {
    const weekId = await root(`Week ${randomUUID()}`);
    const sampleId = await root(`Sample ${randomUUID()}`);
    const authorId = actor.id;
    const hexion = randomUUID(), sampleChild = randomUUID(), empty = randomUUID();

    // Rows as they were before the rule.
    await client.query(`ALTER TABLE tasks DROP CONSTRAINT ${SUBTASK_RULE_CONSTRAINT}`);
    for (const table of ["task_notes", "checklist_items", "task_labels"]) await client.query(`ALTER TABLE ${table} DISABLE TRIGGER ${table}_subtask_rule`);
    try {
      await client.query(`INSERT INTO tasks (id, board_id, bucket_id, parent_task_id, title, summary, next_action, notes, status, color, icon, sort_order, source_type)
        VALUES ($1, $4, $5, $6, 'Vendor server deployment', 'Coordinate the vendor install', '', '', 'active', '#64748b', 'layers', 1000, 'native'),
               ($2, $4, $5, $7, 'Capture loose notes into actionable tasks', 'Turn notes and half-ideas into properly placed tasks.', '', '', 'active', '#f97316', 'calendar', 1000, 'native'),
               ($3, $4, $5, $6, 'Empty one', '', '', '', 'waiting', '#64748b', 'layers', 2000, 'native')`,
        [hexion, sampleChild, empty, actor.board_id, actor.bucket_id, weekId, sampleId]);
      await client.query(`INSERT INTO task_notes (id, board_id, task_id, body, note_type, created_by_user_id, created_at) VALUES
        ($1, $5, $6, 'Coordinate the vendor install', 'primary', $8, '2026-10-19T15:55:17Z'),
        ($2, $5, $6, 'Firewall and access are ready.', 'working', $8, '2026-10-28T00:31:40Z'),
        ($3, $5, $7, 'Turn notes and half-ideas into properly placed tasks.', 'primary', $8, NOW()),
        ($4, $5, $9, '', 'primary', $8, NOW())`,
        [randomUUID(), randomUUID(), randomUUID(), randomUUID(), actor.board_id, hexion, sampleChild, authorId, empty]);
      await client.query(`INSERT INTO checklist_items (id, task_id, label, is_done, sort_order) VALUES ($1, $3, 'Email notes inbox', TRUE, 1000), ($2, $3, 'Phone list', FALSE, 2000)`,
        [randomUUID(), randomUUID(), sampleChild]);
    } finally {
      for (const table of ["task_notes", "checklist_items", "task_labels"]) await client.query(`ALTER TABLE ${table} ENABLE TRIGGER ${table}_subtask_rule`);
    }
    await client.query(`DELETE FROM taskboard_data_repairs WHERE key = $1`, [simpleSubtasksRepairKey]);

    await simplifySubtasks(client);

    const notes = (await pool.query<{ task_id: string; note_type: string; body: string; created_by_user_id: string; created_at: Date }>(
      `SELECT task_id, note_type, body, created_by_user_id, created_at FROM task_notes WHERE task_id = $1 AND body LIKE 'From subtask%' ORDER BY created_at`, [weekId])).rows;
    assert.equal(notes.length, 2, "The description and the working note both move to the week.");
    assert.ok(notes.every((note) => note.note_type === "working" && note.created_by_user_id === authorId));
    assert.equal(notes[0].body, "From subtask 'Vendor server deployment':\n\nCoordinate the vendor install");
    assert.equal(notes[0].created_at.toISOString(), "2026-10-19T15:55:17.000Z", "Moved notes keep their time.");
    assert.equal((await pool.query(`SELECT 1 FROM task_notes WHERE body LIKE '%half-ideas%' AND task_id = ANY($1::uuid[])`, [[sampleId, sampleChild]])).rowCount, 0,
      "Sample text is cleared, not moved.");
    const checklist = (await pool.query<{ label: string }>(`SELECT label FROM checklist_items WHERE task_id = $1 ORDER BY sort_order`, [sampleId])).rows.map((row) => row.label);
    assert.deepEqual(checklist.slice(-2), ["Email notes inbox", "Phone list"], "Checklist items join the end of the task's checklist, in order.");
    const rows = (await pool.query<{ id: string; status: string; summary: string; color: string; icon: string }>(
      `SELECT id, status, summary, color, icon FROM tasks WHERE id = ANY($1::uuid[])`, [[hexion, sampleChild, empty]])).rows;
    assert.ok(rows.every((row) => row.status === "todo" && row.summary === "" && row.color === "#64748b" && row.icon === "layers"));
    assert.equal((await pool.query(`SELECT 1 FROM task_notes WHERE task_id = ANY($1::uuid[])`, [[hexion, sampleChild, empty]])).rowCount, 0);
    assert.deepEqual(await findSubtaskRuleViolations(client), {});
    assert.equal((await pool.query(`SELECT 1 FROM pg_constraint WHERE conname = $1`, [SUBTASK_RULE_CONSTRAINT])).rowCount, 1, "The rule is back in place.");
    assert.equal((await pool.query(`SELECT 1 FROM taskboard_data_repairs WHERE key = $1`, [simpleSubtasksRepairKey])).rowCount, 1);

    // Every later start runs it again: it changes nothing and keeps the rule.
    const notesBefore = (await pool.query(`SELECT count(*)::int n FROM task_notes`)).rows[0].n;
    await Promise.all([simplifySubtasks(client), (async () => {
      const other = await pool.connect();
      try { await simplifySubtasks(other); } finally { other.release(); }
    })()]);
    assert.equal((await pool.query(`SELECT count(*)::int n FROM task_notes`)).rows[0].n, notesBefore);
    assert.equal((await pool.query(`SELECT 1 FROM pg_constraint WHERE conname = $1`, [SUBTASK_RULE_CONSTRAINT])).rowCount, 1);
  } finally {
    const constraint = await pool.query(`SELECT 1 FROM pg_constraint WHERE conname = $1`, [SUBTASK_RULE_CONSTRAINT]);
    if (!constraint.rowCount) await simplifySubtasks(client).catch(() => undefined);
    client.release();
    await cleanUp();
  }
});
