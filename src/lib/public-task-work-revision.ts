import "server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

export const sharedWorkScopeSql = `WITH RECURSIVE scope AS (
  SELECT id,ARRAY[id] path FROM tasks WHERE id=$1 AND board_id=$2 AND archived_at IS NULL AND deleted_at IS NULL
  UNION ALL SELECT t.id,s.path||t.id FROM tasks t JOIN scope s ON t.parent_task_id=s.id
    WHERE t.board_id=$2 AND t.archived_at IS NULL AND t.deleted_at IS NULL AND NOT t.id=ANY(s.path)
)`;

export async function lockSharedWork(client: PoolClient, rootId: string, boardId: string) {
  let previous = "";
  for (let pass = 0; pass < 5; pass++) {
    const result = await client.query<{ id: string }>(`${sharedWorkScopeSql}
      SELECT t.id FROM tasks t WHERE t.id IN (SELECT id FROM scope) ORDER BY t.id LIMIT 5001 FOR UPDATE`, [rootId, boardId]);
    if (result.rows.length > 5000) throw new Error("This workspace is too large to edit through a link.");
    const ids = result.rows.map(row => row.id);
    const current = ids.join(",");
    if (current === previous) {
      await client.query("SELECT id FROM checklist_items WHERE task_id=$1 ORDER BY id FOR UPDATE", [rootId]);
      await client.query("SELECT id FROM task_notes WHERE task_id=$1 AND note_type='working' AND deleted_at IS NULL ORDER BY id FOR UPDATE", [rootId]);
      return new Set(ids);
    }
    previous = current;
  }
  throw new Error("Work is changing. Refresh and try again.");
}

export async function getPublicWorkRevision(client: PoolClient, rootId: string, boardId: string) {
  const result = await client.query<{ value: unknown }>(`${sharedWorkScopeSql} SELECT jsonb_build_object(
    'tasks',(SELECT jsonb_agg(jsonb_build_array(t.id,t.parent_task_id,t.sort_order,t.title,t.status,t.start_at,t.end_at,t.all_day,t.is_read_only_import,t.source_type) ORDER BY t.id) FROM tasks t JOIN scope s ON s.id=t.id),
    'checklist',(SELECT jsonb_agg(jsonb_build_array(id,label,is_done,sort_order) ORDER BY id) FROM checklist_items WHERE task_id=$1),
    'notes',(SELECT jsonb_agg(jsonb_build_array(id,md5(body),updated_at) ORDER BY id) FROM task_notes WHERE task_id=$1 AND note_type='working' AND deleted_at IS NULL)
  ) value`, [rootId, boardId]);
  return createHash("sha256").update(JSON.stringify(result.rows[0].value)).digest("hex");
}
