import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { createSubtaskOnBoard, moveSubtaskInTransaction, reconcileSharedAncestors, setSharedSubtaskCompletion } from "./taskboard-store";
import { admitPublicTaskEdit, getPublicTaskWorkspace, projectPublicTaskWorkspace, withPublicTaskEdit, TaskShareUnavailable, type PublicTaskShare } from "./public-task-share-store";
import { getPublicWorkRevision, lockSharedWork } from "./public-task-work-revision";
import { SharedWorkError, parseSharedWorkRequest } from "./public-task-work-request";
import type { SharedWorkChange, SharedWorkPatch } from "./public-task-share-model";
import { reservePublicTaskWriter } from "./public-task-write-limit";

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(",")}}`;
  return JSON.stringify(value);
}
const digest = (value: unknown) => createHash("sha256").update(canonical(value)).digest("hex");
async function nestingDepth(client: PoolClient, share: PublicTaskShare, id: string) {
  const result = await client.query<{ depth: number }>(`WITH RECURSIVE parents AS (
    SELECT id,parent_task_id,0 depth,ARRAY[id] path FROM tasks WHERE id=$1 AND board_id=$2
    UNION ALL SELECT t.id,t.parent_task_id,p.depth+1,p.path||t.id FROM tasks t JOIN parents p ON t.id=p.parent_task_id
    WHERE p.id<>$3 AND p.depth<33 AND t.board_id=$2 AND NOT t.id=ANY(p.path)
  ) SELECT depth FROM parents WHERE id=$3`, [id, share.board_id, share.task_id]);
  if (!result.rows.length) throw new SharedWorkError("Choose a parent inside this workspace.");
  return result.rows[0].depth;
}

async function requireNativeSubtask(client: PoolClient, share: PublicTaskShare, ids: Set<string>, id: string, allowRoot = false) {
  if (!ids.has(id) || !allowRoot && id === share.task_id) throw new SharedWorkError("This task is outside the editable work.", 403);
  const row = (await client.query<{ id: string; start_at: string | Date | null; end_at: string | Date | null }>(`SELECT id,start_at,end_at FROM tasks t
    WHERE id=$1 AND board_id=$2 AND deleted_at IS NULL AND archived_at IS NULL AND NOT is_read_only_import AND COALESCE(source_type,'native')='native'
    AND NOT EXISTS(SELECT 1 FROM imported_events e WHERE e.task_id=t.id AND e.sync_status='active')`, [id, share.board_id])).rows[0];
  if (!row) throw new SharedWorkError("This work item is controlled by its owner.", 403);
  return row;
}

async function updateSubtask(client: PoolClient, share: PublicTaskShare, ids: Set<string>, id: string, patch: SharedWorkPatch) {
  const current = await requireNativeSubtask(client, share, ids, id);
  const start = patch.startAt === undefined ? current.start_at : patch.startAt;
  const end = patch.endAt === undefined ? current.end_at : patch.endAt;
  if (start && end && new Date(end) < new Date(start)) throw new SharedWorkError("End time must follow start time.");
  const fields = { title: "title", startAt: "start_at", endAt: "end_at", allDay: "all_day" } as const;
  const values: unknown[] = [], assignments: string[] = [];
  for (const key of Object.keys(fields) as (keyof typeof fields)[]) if (key in patch) {
    values.push(patch[key]); assignments.push(`${fields[key]}=$${values.length}`);
  }
  if (assignments.length) {
    values.push(id, share.board_id);
    await client.query(`UPDATE tasks SET ${assignments.join(",")},updated_at=NOW() WHERE id=$${values.length - 1} AND board_id=$${values.length}`, values);
  }
  // Ticking work ticks everything inside it and keeps its parents in step,
  // as signed-in edits do; the shared task's own status stays the owner's.
  if (patch.status) await setSharedSubtaskCompletion(client, share.board_id, id, patch.status === "done", share.task_id);
}

async function applyChange(client: PoolClient, share: PublicTaskShare, ids: Set<string>, change: SharedWorkChange) {
  const root = share.task_id;
  switch (change.type) {
    case "subtask.update": await updateSubtask(client, share, ids, change.taskId, change.patch); return change.taskId;
    case "subtask.add":
      await requireNativeSubtask(client, share, ids, change.parentTaskId, true);
      if (ids.size >= 5000) throw new SharedWorkError("This workspace has reached its work-item limit.");
      if (await nestingDepth(client, share, change.parentTaskId) >= 32) throw new SharedWorkError("Choose a parent with fewer nesting levels.");
      {
        const created = await createSubtaskOnBoard(client, { id: share.board_id }, { parentTaskId: change.parentTaskId, title: change.title });
        // New work under finished work reopens it.
        await reconcileSharedAncestors(client, share.board_id, change.parentTaskId, root);
        return created;
      }
    case "subtask.move":
      await requireNativeSubtask(client, share, ids, change.taskId);
      await requireNativeSubtask(client, share, ids, change.parentTaskId, true);
      {
        const oldParentId = (await client.query<{ parent_task_id: string | null }>("SELECT parent_task_id FROM tasks WHERE id=$1 AND board_id=$2", [change.taskId, share.board_id])).rows[0]?.parent_task_id ?? null;
        const height = Number((await client.query(`WITH RECURSIVE descendants AS (
          SELECT id,0 depth,ARRAY[id] path FROM tasks WHERE id=$1
          UNION ALL SELECT t.id,d.depth+1,d.path||t.id FROM tasks t JOIN descendants d ON t.parent_task_id=d.id
          WHERE t.board_id=$2 AND NOT t.id=ANY(d.path) AND d.depth<33 AND t.deleted_at IS NULL AND t.archived_at IS NULL
        ) SELECT max(depth) height FROM descendants`, [change.taskId, share.board_id])).rows[0].height);
        if (await nestingDepth(client, share, change.parentTaskId) + height + 1 > 32) throw new SharedWorkError("Choose a parent with fewer nesting levels.");
        try { await moveSubtaskInTransaction(client, { id: share.board_id }, change); }
        catch (error) { if (error instanceof Error && error.message === "A subtask cannot be moved inside itself.") throw new SharedWorkError(error.message); throw error; }
        await reconcileSharedAncestors(client, share.board_id, change.parentTaskId, root);
        await reconcileSharedAncestors(client, share.board_id, oldParentId, root);
      }
      return change.taskId;
    case "checklist.add": {
      const count = Number((await client.query("SELECT count(*) n FROM checklist_items WHERE task_id=$1", [root])).rows[0].n);
      if (count >= 1000) throw new SharedWorkError("This checklist has reached its item limit.");
      const id = randomUUID();
      await client.query("INSERT INTO checklist_items(id,task_id,label,is_done,sort_order) SELECT $1,$2,$3,FALSE,COALESCE(MAX(sort_order),0)+1000 FROM checklist_items WHERE task_id=$2", [id, root, change.label]);
      return id;
    }
    case "checklist.update": {
      const result = await client.query("UPDATE checklist_items SET label=COALESCE($3,label),is_done=COALESCE($4,is_done) WHERE id=$1 AND task_id=$2", [change.itemId, root, change.label ?? null, change.done ?? null]);
      if (!result.rowCount) throw new SharedWorkError("Checklist item is unavailable.", 403);
      return change.itemId;
    }
    case "checklist.remove": {
      const result = await client.query("DELETE FROM checklist_items WHERE id=$1 AND task_id=$2", [change.itemId, root]);
      if (!result.rowCount) throw new SharedWorkError("Checklist item is unavailable.", 403);
      return change.itemId;
    }
    case "note.add": {
      const count = Number((await client.query("SELECT count(*) n FROM task_notes WHERE task_id=$1 AND note_type='working' AND deleted_at IS NULL", [root])).rows[0].n);
      if (count >= 1000) throw new SharedWorkError("This task has reached its working-note limit.");
      const id = randomUUID();
      await client.query("INSERT INTO task_notes(id,board_id,task_id,body,note_type,created_via_share_id) VALUES($1,$2,$3,$4,'working',$5)", [id, share.board_id, root, change.body, share.id]);
      return id;
    }
    case "note.update":
    case "note.remove": {
      const row = (await client.query<{ body: string; has_files: boolean }>(`SELECT body,EXISTS(SELECT 1 FROM task_attachments a WHERE a.note_id=n.id) has_files FROM task_notes n
        WHERE id=$1 AND task_id=$2 AND board_id=$3 AND note_type='working' AND deleted_at IS NULL`, [change.noteId, root, share.board_id])).rows[0];
      if (!row) throw new SharedWorkError("Working note is unavailable.", 403);
      if (Buffer.byteLength(row.body) > 65536) throw new SharedWorkError("The owner can edit this large note in Taskboard.");
      if (change.type === "note.remove") {
        if (row.has_files) throw new SharedWorkError("The owner can remove this note in Taskboard.");
        await client.query("UPDATE task_notes SET deleted_at=NOW(),deleted_by_user_id=NULL,deleted_via_share_id=$2 WHERE id=$1", [change.noteId, share.id]);
      } else {
        await client.query("UPDATE task_notes SET body=$2,updated_at=NOW(),updated_by_user_id=NULL,updated_via_share_id=$3 WHERE id=$1", [change.noteId, change.body, share.id]);
      }
      return change.noteId;
    }
  }
}

export async function applyPublicTaskWorkChange(token: string, origin: string, input: unknown) {
  const request = parseSharedWorkRequest(input);
  const release = reservePublicTaskWriter();
  try {
    if (!await admitPublicTaskEdit(token)) throw new SharedWorkError("This link has reached its editing rate limit. Try again later.", 429);
    const appliedEditRevision = await withPublicTaskEdit(token, async (client, share) => {
      const hash = digest(request.change);
      const receipt = (await client.query<{ request_hash: string; edit_revision_after: string }>("SELECT request_hash,edit_revision_after FROM task_share_work_changes WHERE share_id=$1 AND mutation_id=$2", [share.id, request.mutationId])).rows[0];
      if (receipt) {
        if (receipt.request_hash !== hash) throw new SharedWorkError("This save identifier was already used for a different change.", 409);
        return receipt.edit_revision_after;
      }
      const ids = await lockSharedWork(client, share.task_id, share.board_id);
      if (await getPublicWorkRevision(client, share.task_id, share.board_id) !== request.editRevision) throw new SharedWorkError("Work changed since you opened it. Load the latest work before saving again.", 409);
      if (request.change.type === "note.update" || request.change.type === "note.remove") {
        const snapshot = await projectPublicTaskWorkspace(client, share, token, origin);
        if (!snapshot.sharing?.editableNoteIds?.includes(request.change.noteId)) throw new SharedWorkError("The owner can edit this note in Taskboard.");
      }
      const resource = await applyChange(client, share, ids, request.change);
      // Metadata only: no URL tokens, claimed person identity or copied note text.
      const after = await getPublicWorkRevision(client, share.task_id, share.board_id);
      await client.query("INSERT INTO task_share_work_changes(id,share_id,mutation_id,request_hash,action,resource_id,details,edit_revision_after) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8)", [randomUUID(), share.id, request.mutationId, hash, request.change.type, resource, JSON.stringify({ editRevision: request.editRevision }), after]);
      try { await projectPublicTaskWorkspace(client, share, token, origin); }
      catch (error) { if (error instanceof TaskShareUnavailable) throw new SharedWorkError("This workspace has reached its public size limit."); throw error; }
      const valid = (await client.query("SELECT id FROM task_public_shares WHERE id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>clock_timestamp())", [share.id])).rowCount;
      if (!valid) throw new TaskShareUnavailable();
      return after;
    });
    // Use the ordinary hard-gated reader after commit; a revoked/expired token
    // must clear the editor even if its preceding save committed successfully.
    return { ...await getPublicTaskWorkspace(token, origin), appliedEditRevision };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && ["40001", "40P01"].includes(String(error.code))) throw new SharedWorkError("Work changed while saving. Load the latest work and try again.", 409);
    throw error;
  } finally { release(); }
}
