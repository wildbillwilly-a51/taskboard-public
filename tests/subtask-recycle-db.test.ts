import { isLocalVisualDatabase } from "./helpers/visual-database";
import assert from "node:assert/strict";
import test, { after } from "node:test";
import { getPool } from "../src/lib/db";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import {
  addChecklistItem,
  archiveTask,
  createBucket,
  createRootTask,
  deleteBucket,
  createSubtask,
  deleteTask,
  ensureSchemaAndSeed,
  getRecycleBinItems,
  permanentlyDeleteRecycleBinItem,
  restoreArchiveItem,
  restoreRecycleBinItem,
  updateTask,
} from "../src/lib/taskboard-store";
import type { TaskboardUserIdentity } from "../src/lib/taskboard-request";

after(async () => { await getPool()?.end(); });

// Exercise the actual frozen repair under test. Replaying the entire old
// bootstrap against a current schema would also recreate pre-rule subtask
// primary notes, which the current rule correctly refuses.
async function applyHistoricalRepairFixture(kind: "parent-completion" | "recycle-groups") {
  const text = await readFile("src/lib/schema-baseline.ts", "utf8");
  const source = ts.createSourceFile("schema-baseline.ts", text, ts.ScriptTarget.Latest, true);
  const client = await getPool()!.connect();
  try {
    if (kind === "parent-completion") {
      const repair = source.statements.find((node): node is ts.FunctionDeclaration =>
        ts.isFunctionDeclaration(node) && node.name?.text === "repairParentCompletion");
      const key = source.statements.find((node) => ts.isVariableStatement(node) &&
        node.declarationList.declarations.some((declaration) => declaration.name.getText(source) === "parentCompletionRepairKey"));
      assert.ok(repair && key);
      const { outputText } = ts.transpileModule(`${key.getText(source)}\n${repair.getText(source)}`, {
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
      });
      await new Function("client", `${outputText}\nreturn repairParentCompletion(client);`)(client);
    } else {
      let sql: string | undefined;
      const visit = (node: ts.Node) => {
        if (ts.isNoSubstitutionTemplateLiteral(node) && node.text.includes("UPDATE tasks SET recycle_group_id = tree.group_id")) sql = node.text;
        ts.forEachChild(node, visit);
      };
      visit(source);
      assert.ok(sql);
      await client.query(sql);
    }
  } finally { client.release(); }
}

// Deleted subtasks go to the Recycle Bin as their own items: Undo and Restore
// bring back exactly what one delete removed, in place, and parent
// completion follows deletes and restores without completing recurring tasks.
test("subtask deletes are recoverable, independent, and keep completion in step", {
  skip: process.env.SUBTASK_RECYCLE_DB_TEST !== "1",
}, async () => {
  const pool = getPool();
  assert.ok(pool);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(isLocalVisualDatabase(url), "Use only the isolated visual-test database.");
  const result = await pool.query(`
    SELECT users.id, users.email, users.display_name, users.role, buckets.id AS bucket_id
    FROM users JOIN boards ON boards.owner_user_id = users.id AND boards.board_type = 'personal'
    JOIN buckets ON buckets.board_id = boards.id WHERE users.is_disabled = FALSE
    ORDER BY users.created_at, buckets.sort_order LIMIT 1
  `);
  const actor = result.rows[0];
  assert.ok(actor, "A fixture user and personal board are required.");
  await ensureSchemaAndSeed();
  const identity: TaskboardUserIdentity = {
    id: actor.id, email: actor.email, displayName: actor.display_name, role: actor.role,
    authMode: "authelia", authProvider: "authelia", isDisabled: false,
  };
  const roots: string[] = [];
  const root = async (title: string) => {
    const id = await createRootTask(identity, { bucketId: actor.bucket_id, title });
    assert.ok(id); roots.push(id); return id;
  };
  const child = async (parentTaskId: string, title: string) => {
    const id = await createSubtask(identity, { parentTaskId, title });
    assert.ok(id); return id;
  };
  const row = async (id: string) => (await pool.query<{ status: string; deleted_at: Date | null; archived_at: Date | null; parent_task_id: string | null; sort_order: string; recycle_group_id: string | null }>(
    "SELECT status, deleted_at, archived_at, parent_task_id, sort_order, recycle_group_id FROM tasks WHERE id = $1", [id])).rows[0];
  const binItem = async (id: string) => (await getRecycleBinItems(identity)).find(item => item.id === id);

  try {
    // A subtask with work under it is kept, listed, and restored in place.
    const outage = await root("Recycle regression outage");
    const prep = await child(outage, "Prep");
    const windowTask = await child(outage, "Window");
    const drain = await child(windowTask, "Drain");
    const backup = await child(windowTask, "Backup");
    const verify = await child(outage, "Verify");
    const windowOrder = (await row(windowTask)).sort_order;
    await deleteTask(identity, windowTask);
    for (const id of [windowTask, drain, backup]) assert.ok((await row(id)).deleted_at, "The subtask and its work are kept as deleted.");
    assert.equal((await row(drain)).recycle_group_id, (await row(windowTask)).recycle_group_id);
    const listed = await binItem(windowTask);
    assert.ok(listed, "A deleted subtask is a Recycle Bin item.");
    assert.equal(listed.parentTitle, "Recycle regression outage");
    assert.equal(listed.subtaskCount, 2);
    assert.equal(await binItem(drain), undefined, "Work deleted with its parent is not a separate item.");
    await restoreRecycleBinItem(identity, windowTask);
    for (const id of [windowTask, drain, backup]) assert.equal((await row(id)).deleted_at, null);
    assert.equal((await row(windowTask)).parent_task_id, outage);
    assert.equal((await row(windowTask)).sort_order, windowOrder, "It returns to its old place among its siblings.");
    assert.equal((await row(windowTask)).recycle_group_id, null);

    // Earlier deletes stay deleted when a later delete is restored.
    await deleteTask(identity, drain);
    await deleteTask(identity, windowTask);
    assert.ok(await binItem(drain), "An earlier delete under a later one is still its own item.");
    await restoreRecycleBinItem(identity, windowTask);
    assert.ok((await row(drain)).deleted_at, "Restoring the later delete leaves the earlier one deleted.");
    await restoreRecycleBinItem(identity, drain);
    assert.equal((await row(drain)).deleted_at, null);

    // The same holds through a top-level delete and restore.
    await deleteTask(identity, verify);
    await deleteTask(identity, outage);
    await restoreRecycleBinItem(identity, outage);
    assert.equal((await row(prep)).deleted_at, null);
    assert.ok((await row(verify)).deleted_at, "A subtask deleted before its task stays deleted after the task returns.");

    // A subtask cannot come back under a deleted parent.
    await deleteTask(identity, outage);
    await assert.rejects(restoreRecycleBinItem(identity, verify), /Restore "Recycle regression outage" first/);
    await restoreRecycleBinItem(identity, outage);
    await restoreRecycleBinItem(identity, verify);

    // Completion follows deletes and restores.
    const parent = await root("Recycle roll-up");
    const finished = await child(parent, "Finished");
    const open = await child(parent, "Open");
    await updateTask(identity, finished, { status: "done" });
    await deleteTask(identity, open);
    assert.equal((await row(parent)).status, "done", "Deleting the last open work finishes the parent.");
    await restoreRecycleBinItem(identity, open);
    assert.equal((await row(parent)).status, "todo", "Restoring open work reopens it.");

    // A recurring task is never completed, archived, or advanced by a delete.
    const recurring = await root("Recycle recurring");
    const recurringDone = await child(recurring, "Done part");
    const recurringOpen = await child(recurring, "Open part");
    await updateTask(identity, recurring, { dueAt: "2026-12-01T17:00:00.000Z", recurrence: { frequency: "daily", interval: 1, mode: "on_schedule" } });
    await updateTask(identity, recurringDone, { status: "done" });
    await deleteTask(identity, recurringOpen);
    const held = await row(recurring);
    assert.equal(held.status, "todo");
    assert.equal(held.archived_at, null);
    const series = await pool.query("SELECT id FROM tasks WHERE recurrence_series_id = (SELECT recurrence_series_id FROM tasks WHERE id = $1) AND parent_task_id IS NULL", [recurring]);
    assert.ok(series.rows.length <= 1, "No next occurrence was created.");

    // Archive and restore leave an earlier subtask delete alone.
    const archived = await root("Recycle archive");
    const keep = await child(archived, "Keep");
    const gone = await child(archived, "Gone");
    await deleteTask(identity, gone);
    await archiveTask(identity, archived);
    assert.equal((await row(gone)).archived_at, null);
    await restoreArchiveItem(identity, archived);
    assert.equal((await row(keep)).archived_at, null);
    assert.ok((await row(gone)).deleted_at);

    // Deleted work refuses new children and checklist items.
    await assert.rejects(createSubtask(identity, { parentTaskId: gone, title: "Late" }));
    await assert.rejects(addChecklistItem(identity, { taskId: gone, label: "Late" }));

    // Permanent delete and purge remove items, including ones already
    // removed with an older item that contained them.
    await permanentlyDeleteRecycleBinItem(identity, gone);
    assert.equal(await row(gone), undefined);
    const purged = await root("Recycle purge");
    const purgedChild = await child(purged, "Purged child");
    await deleteTask(identity, purgedChild);
    await deleteTask(identity, purged);
    await pool.query("UPDATE tasks SET purge_after_at = NOW() - INTERVAL '1 minute' WHERE id = ANY($1::uuid[])", [[purged, purgedChild]]);
    await getRecycleBinItems(identity);
    assert.equal(await row(purged), undefined);
    assert.equal(await row(purgedChild), undefined);
  } finally {
    await pool.query("DELETE FROM tasks WHERE id = ANY($1::uuid[])", [roots]);
  }
});

test("the one-time parent completion repair fixes stale parents once and keeps old values", {
  skip: process.env.SUBTASK_RECYCLE_DB_TEST !== "1",
}, async () => {
  const pool = getPool();
  assert.ok(pool);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(isLocalVisualDatabase(url), "Use only the isolated visual-test database.");
  const { rows: [actor] } = await pool.query(`
    SELECT users.id, users.email, users.display_name, users.role, buckets.id AS bucket_id
    FROM users JOIN boards ON boards.owner_user_id = users.id AND boards.board_type = 'personal'
    JOIN buckets ON buckets.board_id = boards.id WHERE users.is_disabled = FALSE
    ORDER BY users.created_at, buckets.sort_order LIMIT 1
  `);
  const identity: TaskboardUserIdentity = {
    id: actor.id, email: actor.email, displayName: actor.display_name, role: actor.role,
    authMode: "authelia", authProvider: "authelia", isDisabled: false,
  };
  const roots: string[] = [];
  try {
    const stale = await createRootTask(identity, { bucketId: actor.bucket_id, title: "Repair stale" });
    const branch = await createSubtask(identity, { parentTaskId: stale!, title: "Repair branch" });
    const leaf = await createSubtask(identity, { parentTaskId: branch!, title: "Repair leaf" });
    const recurring = await createRootTask(identity, { bucketId: actor.bucket_id, title: "Repair recurring" });
    const recurringLeaf = await createSubtask(identity, { parentTaskId: recurring!, title: "Repair recurring leaf" });
    roots.push(stale!, recurring!);
    // Leaves finished directly in the database, as before roll-up existed.
    await pool.query("UPDATE tasks SET status = 'done', completed_at = NOW() WHERE id = ANY($1::uuid[])", [[leaf, recurringLeaf]]);
    await pool.query("UPDATE tasks SET recurrence_rule = '{\"frequency\":\"daily\",\"interval\":1,\"mode\":\"on_schedule\"}'::jsonb WHERE id = $1", [recurring]);
    await pool.query("DELETE FROM taskboard_data_repairs WHERE key = 'parent-completion-2026-11'");
    await applyHistoricalRepairFixture("parent-completion");
    const status = async (id: string) => (await pool.query("SELECT status FROM tasks WHERE id = $1", [id])).rows[0].status;
    assert.equal(await status(branch!), "done", "The deepest parent is repaired first.");
    assert.equal(await status(stale!), "done", "Its parent then sees it finished.");
    assert.equal(await status(recurring!), "todo", "Recurring top-level tasks are left alone.");
    const record = (await pool.query("SELECT details FROM taskboard_data_repairs WHERE key = 'parent-completion-2026-11'")).rows[0];
    const changed = record.details.changed as Array<{ id: string; oldStatus: string }>;
    assert.ok(changed.some(entry => entry.id === stale && entry.oldStatus === "todo"), "Old values are kept.");

    // A second start does not run it again.
    await pool.query("UPDATE tasks SET status = 'todo', completed_at = NULL WHERE id = $1", [stale]);
    await ensureSchemaAndSeed();
    assert.equal(await status(stale!), "todo");
  } finally {
    await pool.query("DELETE FROM tasks WHERE id = ANY($1::uuid[])", [roots]);
  }
});

test("tasks deleted before recycle groups existed are grouped by the historical baseline and restore whole", {
  skip: process.env.SUBTASK_RECYCLE_DB_TEST !== "1",
}, async () => {
  const pool = getPool();
  assert.ok(pool);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(isLocalVisualDatabase(url), "Use only the isolated visual-test database.");
  const { rows: [actor] } = await pool.query(`
    SELECT users.id, users.email, users.display_name, users.role, buckets.id AS bucket_id
    FROM users JOIN boards ON boards.owner_user_id = users.id AND boards.board_type = 'personal'
    JOIN buckets ON buckets.board_id = boards.id WHERE users.is_disabled = FALSE
    ORDER BY users.created_at, buckets.sort_order LIMIT 1
  `);
  const identity: TaskboardUserIdentity = {
    id: actor.id, email: actor.email, displayName: actor.display_name, role: actor.role,
    authMode: "authelia", authProvider: "authelia", isDisabled: false,
  };
  const legacy = await createRootTask(identity, { bucketId: actor.bucket_id, title: "Legacy recycled" });
  const legacyChild = await createSubtask(identity, { parentTaskId: legacy!, title: "Legacy child" });
  try {
    // The old recycle: the whole tree shares one deleted_at and has no group.
    await pool.query(`
      UPDATE tasks SET deleted_at = '2026-10-20T12:00:00Z', purge_after_at = NOW() + INTERVAL '10 days',
        bucket_id = NULL, recycle_original_bucket_id = $3, recycle_group_id = NULL
      WHERE id = ANY($1::uuid[]) AND board_id = (SELECT board_id FROM tasks WHERE id = $2)
    `, [[legacy, legacyChild], legacy, actor.bucket_id]);
    await applyHistoricalRepairFixture("recycle-groups");
    const groups = await pool.query("SELECT DISTINCT recycle_group_id FROM tasks WHERE id = ANY($1::uuid[])", [[legacy, legacyChild]]);
    assert.equal(groups.rows.length, 1);
    assert.ok(groups.rows[0].recycle_group_id, "The legacy delete becomes one group.");
    const item = (await getRecycleBinItems(identity)).find(entry => entry.id === legacy);
    assert.equal(item?.subtaskCount, 1);
    await restoreRecycleBinItem(identity, legacy!);
    const restored = await pool.query("SELECT id, deleted_at, bucket_id FROM tasks WHERE id = ANY($1::uuid[])", [[legacy, legacyChild]]);
    for (const row of restored.rows) {
      assert.equal(row.deleted_at, null);
      assert.equal(row.bucket_id, actor.bucket_id);
    }
  } finally {
    await pool.query("DELETE FROM tasks WHERE id = $1", [legacy]);
  }
});

test("stale requests cannot change deleted work, and bucket deletes keep earlier subtask deletes", {
  skip: process.env.SUBTASK_RECYCLE_DB_TEST !== "1",
}, async () => {
  const pool = getPool();
  assert.ok(pool);
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(isLocalVisualDatabase(url), "Use only the isolated visual-test database.");
  const { rows: [actor] } = await pool.query(`
    SELECT users.id, users.email, users.display_name, users.role, buckets.id AS bucket_id, boards.id AS board_id
    FROM users JOIN boards ON boards.owner_user_id = users.id AND boards.board_type = 'personal'
    JOIN buckets ON buckets.board_id = boards.id WHERE users.is_disabled = FALSE
    ORDER BY users.created_at, buckets.sort_order LIMIT 1
  `);
  const identity: TaskboardUserIdentity = {
    id: actor.id, email: actor.email, displayName: actor.display_name, role: actor.role,
    authMode: "authelia", authProvider: "authelia", isDisabled: false,
  };
  const roots: string[] = [];
  const bucketTitle = `Recycle bucket ${Date.now()}`;
  try {
    const task = await createRootTask(identity, { bucketId: actor.bucket_id, title: "Stale request target" });
    roots.push(task!);
    const sub = await createSubtask(identity, { parentTaskId: task!, title: "Stale sub" });
    await deleteTask(identity, sub!);
    await assert.rejects(archiveTask(identity, sub!), /Task not found/, "A deleted subtask id does not archive its live task.");
    assert.equal((await pool.query("SELECT archived_at FROM tasks WHERE id = $1", [task])).rows[0].archived_at, null);
    await assert.rejects(updateTask(identity, sub!, { title: "Changed after delete" }), /Task not found/);
    await restoreRecycleBinItem(identity, sub!);
    await updateTask(identity, sub!, { title: "Changed after restore" });

    // A bucket delete recycles each task as its own delete; a subtask deleted
    // before it stays deleted when that task comes back.
    await createBucket(identity, { title: bucketTitle });
    const bucketId = (await pool.query("SELECT id FROM buckets WHERE board_id = $1 AND title = $2", [actor.board_id, bucketTitle])).rows[0].id;
    const inBucket = await createRootTask(identity, { bucketId, title: "Bucket task" });
    roots.push(inBucket!);
    const earlier = await createSubtask(identity, { parentTaskId: inBucket!, title: "Deleted earlier" });
    const kept = await createSubtask(identity, { parentTaskId: inBucket!, title: "Kept" });
    await deleteTask(identity, earlier!);
    await deleteBucket(identity, bucketId);
    await restoreRecycleBinItem(identity, inBucket!);
    const state = await pool.query("SELECT id, deleted_at FROM tasks WHERE id = ANY($1::uuid[])", [[earlier, kept]]);
    const byId = new Map(state.rows.map(row => [row.id, row.deleted_at]));
    assert.equal(byId.get(kept), null);
    assert.ok(byId.get(earlier), "The earlier subtask delete is still its own item.");
  } finally {
    await pool.query("DELETE FROM tasks WHERE id = ANY($1::uuid[])", [roots]);
    await pool.query("DELETE FROM buckets WHERE board_id = $1 AND title = $2", [actor.board_id, bucketTitle]);
  }
});
