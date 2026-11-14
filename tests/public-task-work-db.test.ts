import { isLocalVisualDatabase } from "./helpers/visual-database";
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { getPool } from "../src/lib/db";
import { ensureDatabaseReady, updateTaskNote, getBoardStateFromDatabase } from "../src/lib/taskboard-store";
import { getPublicTaskWorkspace, manageTaskShare, getPublicTaskFile } from "../src/lib/public-task-share-store";
import { applyPublicTaskWorkChange } from "../src/lib/public-task-work-store";
import type { SharedWorkChange, PublicTaskWorkspace } from "../src/lib/public-task-share-model";
import type { TaskboardUserIdentity } from "../src/lib/taskboard-request";

test("shared work enforces scope, separate links, expiry, safe authorship, conflicts and replay receipts", { skip: process.env.TASKBOARD_PUBLIC_WORK_DB_TEST !== "1", timeout: 120000 }, async () => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.ok(isLocalVisualDatabase(url), "Use only the isolated visual-test database.");
  process.env.TASKBOARD_PUBLIC_SHARES_ENABLED = "true";
  process.env.TASKBOARD_PUBLIC_TASK_EDITS_ENABLED = "true";
  await ensureDatabaseReady();
  const pool = getPool()!, origin = "https://taskboard.test";
  const [owner, board, root, child, other, primary, working, foreignNote, check, foreignCheck, linked] = Array.from({ length: 11 }, () => randomUUID());
  const user: TaskboardUserIdentity = { id: owner, authMode: "authelia", email: `${owner}@example.test`, displayName: "Publisher", role: "standard" };
  const token = (url: string) => url.split("/").at(-1)!;
  let edit = "", view = "";
  const read = () => getPublicTaskWorkspace(edit, origin);
  const submit = async (change: SharedWorkChange, snapshot?: PublicTaskWorkspace, mutationId = randomUUID()) => {
    const current = snapshot || await read();
    return applyPublicTaskWorkChange(edit, origin, { mutationId, editRevision: current.sharing!.editRevision!, change });
  };
  try {
    await pool.query("INSERT INTO users(id,email,display_name) VALUES($1,$2,'Publisher')", [owner, user.email]);
    await pool.query("INSERT INTO boards(id,owner_user_id,title,personal_visibility) VALUES($1,$2,'Shared work test','private')", [board, owner]);
    await pool.query("INSERT INTO tasks(id,board_id,parent_task_id,title,status,sort_order) VALUES($1,$2,NULL,'Root','todo',1000),($3,$2,$1,'Child','todo',1000),($4,$2,NULL,'Other private task','todo',2000)", [root, board, child, other]);
    await pool.query("INSERT INTO task_notes(id,board_id,task_id,body,note_type,created_by_user_id) VALUES($1,$2,$3,'Primary','primary',$4),($5,$2,$3,'Working','working',$4),($6,$2,$7,'Foreign','working',$4)", [primary, board, root, owner, working, foreignNote, other]);
    await pool.query("INSERT INTO checklist_items(id,task_id,label,is_done,sort_order) VALUES($1,$2,'Check',false,1000),($3,$4,'Foreign check',false,1000)", [check, root, foreignCheck, other]);
    await pool.query("INSERT INTO notes(id,board_id,owner_user_id,title,content_json) VALUES($1,$2,$3,'Linked','[]')", [linked, board, owner]);
    await pool.query("INSERT INTO note_task_links(note_id,task_id,created_by_user_id) VALUES($1,$2,$3)", [linked, root, owner]);
    const usersBefore = Number((await pool.query("SELECT count(*) n FROM users")).rows[0].n);
    view = token((await manageTaskShare(user, root, "create")).url!);
    edit = token((await manageTaskShare(user, root, "create", "America/Chicago", { mode: "edit_work" })).url!);
    assert.notEqual(edit, view);
    let data = await read();
    assert.equal(data.sharing?.mode, "edit_work");
    assert.ok(Date.parse(data.sharing!.expiresAt!) > Date.now() + 6 * 86400000);
    const status = await manageTaskShare(user, root, "status");
    assert.equal(status.links?.view.active, true); assert.equal(status.links?.edit_work.active, true);
    await assert.rejects(applyPublicTaskWorkChange(view, origin, { mutationId: randomUUID(), editRevision: data.sharing!.editRevision!, change: { type: "note.add", body: "Denied" } }));
    for (const change of [
      { type: "subtask.update", taskId: root, patch: { title: "Denied" } },
      { type: "subtask.update", taskId: other, patch: { title: "Denied" } },
      { type: "subtask.add", parentTaskId: other, title: "Denied" },
      { type: "subtask.move", taskId: child, parentTaskId: other, targetIndex: 0 },
      { type: "checklist.remove", itemId: foreignCheck },
      { type: "note.update", noteId: primary, body: "Denied" },
      { type: "note.update", noteId: foreignNote, body: "Denied" },
      { type: "note.update", noteId: linked, body: "Denied" },
    ] as SharedWorkChange[]) await assert.rejects(submit(change));
    await assert.rejects(applyPublicTaskWorkChange(edit, origin, { mutationId: randomUUID(), editRevision: data.sharing!.editRevision!, change: { type: "subtask.update", taskId: child, patch: { summary: "Denied" } } }));
    data = await submit({ type: "subtask.update", taskId: child, patch: { title: "Updated", status: "done", startAt: "2026-12-08T02:00:00Z", endAt: "2026-12-08T11:00:00Z" } });
    assert.equal(data.task.subtasks[0].title, "Updated"); assert.equal(data.task.subtasks[0].status, "done");
    assert.ok((await pool.query("SELECT completed_at FROM tasks WHERE id=$1", [child])).rows[0].completed_at);
    const stale = data;
    await pool.query("UPDATE notes SET content_version=content_version+1,content_json='[{\"type\":\"paragraph\"}]' WHERE id=$1", [linked]);
    assert.equal((await read()).sharing!.editRevision, stale.sharing!.editRevision);
    data = await submit({ type: "checklist.update", itemId: check, done: true }, stale);
    assert.equal(data.task.checklist[0].done, true);
    await assert.rejects(submit({ type: "checklist.update", itemId: check, done: false }, stale));
    data = await submit({ type: "subtask.add", parentTaskId: child, title: "Nested" });
    const nested = data.task.subtasks[0].subtasks[0].id;
    await assert.rejects(submit({ type: "subtask.move", taskId: child, parentTaskId: nested, targetIndex: 0 }));
    data = await submit({ type: "subtask.move", taskId: nested, parentTaskId: root, targetIndex: 0 });
    assert.equal(data.task.subtasks[0].id, nested);
    const mutationId = randomUUID(), beforeNote = data;
    const add: SharedWorkChange = { type: "note.add", body: "Shared note" };
    data = await submit(add, beforeNote, mutationId);
    await submit(add, beforeNote, mutationId);
    assert.equal((await read()).task.notes.filter(note => note.body === "Shared note").length, 1);
    await assert.rejects(submit({ type: "note.add", body: "Different" }, beforeNote, mutationId));
    const guest = data.task.notes.find(note => note.body === "Shared note")!;
    assert.equal(guest.authorName, "Shared link editor");
    const created = (await pool.query("SELECT created_by_user_id,created_via_share_id FROM task_notes WHERE id=$1", [guest.id])).rows[0];
    assert.equal(created.created_by_user_id, null); assert.ok(created.created_via_share_id);
    await submit({ type: "note.update", noteId: guest.id, body: "Shared changed" });
    await updateTaskNote(user, root, guest.id, "Publisher changed", { boardId: board });
    const normal = (await pool.query("SELECT updated_by_user_id,updated_via_share_id FROM task_notes WHERE id=$1", [guest.id])).rows[0];
    assert.equal(normal.updated_by_user_id, owner); assert.equal(normal.updated_via_share_id, null);
    assert.ok(await getBoardStateFromDatabase(user, { boardId: board }));
    const attachment = randomUUID();
    await pool.query("INSERT INTO task_attachments(id,task_id,board_id,note_id,uploaded_by_user_id,original_name,display_name,stored_name,size_bytes) VALUES($1,$2,$3,$4,$5,'example.txt','example.txt',$6,1)", [attachment, root, board, guest.id, owner, `${attachment}.txt`]);
    await assert.rejects(submit({ type: "note.remove", noteId: guest.id }), /owner can remove/);
    await pool.query("DELETE FROM task_attachments WHERE id=$1", [attachment]);
    await submit({ type: "note.remove", noteId: guest.id });
    const removed = (await pool.query("SELECT deleted_at,deleted_by_user_id,deleted_via_share_id,body FROM task_notes WHERE id=$1", [guest.id])).rows[0];
    assert.ok(removed.deleted_at); assert.equal(removed.deleted_by_user_id, null); assert.ok(removed.deleted_via_share_id);
    assert.equal(removed.body, "Publisher changed", "Removing a working note retains its text.");
    assert.ok(!(await read()).task.notes.some(note => note.id === guest.id));
    data = await submit({ type: "checklist.add", label: "Guest check" });
    const addedCheck = data.task.checklist.find(item => item.label === "Guest check")!;
    await submit({ type: "checklist.update", itemId: addedCheck.id, label: "Renamed check" });
    await submit({ type: "checklist.remove", itemId: addedCheck.id });
    assert.ok(!(await read()).task.checklist.some(item => item.id === addedCheck.id));
    // Imported work is never a subtask (see subtask-rule.ts).
    await assert.rejects(pool.query("UPDATE tasks SET is_read_only_import=true WHERE id=$1", [child]), /tasks_subtask_simple_check/);
    await assert.rejects(submit({ type: "subtask.update", taskId: child, patch: { status: "waiting" as "done" } }), /either done or not done/);
    const staleNote = await read();
    const blocker = await pool.connect();
    try {
      await blocker.query("BEGIN");
      await blocker.query("UPDATE task_notes SET body='Concurrent owner edit',updated_at=NOW() WHERE id=$1", [working]);
      const pending = submit({ type: "note.update", noteId: working, body: "Must not overwrite" }, staleNote).then(() => false, () => true);
      await delay(80); await blocker.query("COMMIT");
      assert.equal(await pending, true);
      assert.equal((await pool.query("SELECT body FROM task_notes WHERE id=$1", [working])).rows[0].body, "Concurrent owner edit");
    } finally { await blocker.query("ROLLBACK"); blocker.release(); }
    await pool.query("UPDATE task_notes SET body=$2 WHERE id=$1", [working, "x".repeat(70000)]);
    data = await read(); assert.ok(!data.sharing!.editableNoteIds!.includes(working));
    await assert.rejects(submit({ type: "note.update", noteId: working, body: "Cannot replace oversized text" }));
    const shareId = (await pool.query("SELECT id FROM task_public_shares WHERE token_hash=encode(sha256($1::bytea),'hex')", [Buffer.from(edit)])).rows[0].id;
    await pool.query("UPDATE task_share_work_limits SET minute_count=119,hour_count=119,minute_started_at=clock_timestamp(),hour_started_at=clock_timestamp() WHERE share_id=$1", [shareId]);
    const quotaSnapshot = await read();
    await assert.rejects(submit({ type: "note.add", body: "Stale attempt counts too" }, { ...quotaSnapshot, sharing: { ...quotaSnapshot.sharing!, editRevision: "a".repeat(64) } }), (error: unknown) => !!error && typeof error === "object" && "status" in error && error.status === 409);
    await assert.rejects(submit({ type: "note.add", body: "Rate limited" }), (error: unknown) => !!error && typeof error === "object" && "status" in error && error.status === 429);
    await pool.query("UPDATE task_share_work_limits SET minute_started_at=clock_timestamp()-interval '2 minutes' WHERE share_id=$1", [shareId]);
    await submit({ type: "note.add", body: "Minute window resets" });
    await pool.query("UPDATE task_share_work_limits SET hour_count=1000 WHERE share_id=$1", [shareId]);
    await assert.rejects(submit({ type: "note.add", body: "Hourly rate limited" }), (error: unknown) => !!error && typeof error === "object" && "status" in error && error.status === 429);
    await pool.query("UPDATE task_share_work_limits SET hour_started_at=clock_timestamp()-interval '2 hours' WHERE share_id=$1", [shareId]);
    await submit({ type: "note.add", body: "Hour window resets" });
    await pool.query("UPDATE task_public_shares SET expires_at=NOW()-interval '1 second' WHERE token_hash=encode(sha256($1::bytea),'hex')", [Buffer.from(edit)]);
    await assert.rejects(read()); await assert.rejects(getPublicTaskFile(edit, "task", randomUUID()));
    assert.equal((await getPublicTaskWorkspace(view, origin)).task.id, root);
    await manageTaskShare(user, root, "update", "America/Chicago", { mode: "edit_work", expiresAt: null });
    assert.equal((await read()).sharing!.expiresAt, null);
    const replacement = token((await manageTaskShare(user, root, "replace", "UTC", { mode: "edit_work", expiresAt: null })).url!);
    await assert.rejects(read()); edit = replacement;
    assert.equal((await getPublicTaskWorkspace(view, origin)).task.id, root);
    await pool.query("UPDATE users SET is_disabled=true WHERE id=$1", [owner]); await assert.rejects(read());
    await pool.query("UPDATE users SET is_disabled=false WHERE id=$1", [owner]);
    process.env.TASKBOARD_PUBLIC_TASK_EDITS_ENABLED = "false";
    await assert.rejects(read()); assert.equal((await getPublicTaskWorkspace(view, origin)).task.id, root);
    process.env.TASKBOARD_PUBLIC_TASK_EDITS_ENABLED = "true";
    await manageTaskShare(user, root, "disable", "UTC", { mode: "edit_work" }); await assert.rejects(read());
    assert.equal((await getPublicTaskWorkspace(view, origin)).task.id, root);
    assert.equal(Number((await pool.query("SELECT count(*) n FROM users")).rows[0].n), usersBefore);
  } finally {
    await pool.query("DELETE FROM notes WHERE id=$1", [linked]);
    await pool.query("DELETE FROM boards WHERE id=$1", [board]); await pool.query("DELETE FROM users WHERE id=$1", [owner]);
    await pool.end();
  }
});
