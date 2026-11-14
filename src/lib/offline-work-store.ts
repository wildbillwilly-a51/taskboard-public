import "server-only";

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { BoardAccessError } from "@/lib/board-access";
import { isUuid } from "@/lib/notes-model";
import { WikiRuleError } from "@/lib/notes-errors";
import { withClient, withTransaction, type Actor } from "@/lib/notes-store-context";
import { getOrCreateUserRecord, lockTaskTree, updateNativeCalendarEntryInTransaction, updateTaskInTransaction } from "@/lib/taskboard-store";
import {
  offlineTaskStatuses, type OfflineEvent, type OfflineTask, type OfflineWorkPatch,
  type OfflineWorkSave, type OfflineWorkSaveResult, type OfflineWorkSnapshot,
} from "@/lib/offline-work-model";

const taskScope = "t.deleted_at IS NULL AND t.archived_at IS NULL AND NOT t.is_read_only_import AND t.work_item_type='task'";
const eventScope = "e.deleted_at IS NULL AND e.linked_task_id IS NULL";
const ownBoard = "b.owner_user_id=$1 AND b.board_type='personal'";
const versionOf = (alias: "t" | "e") => `to_char(${alias}.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
const invalid = (message: string) => new WikiRuleError("invalid_save", message, 400);

export async function readOfflineWork(actor: Actor): Promise<OfflineWorkSnapshot> {
  return withClient(async (client) => {
    const { rows: tasks } = await client.query<Omit<OfflineTask,"kind"|"dueAt"> & { dueAt: Date | null }>(`
      SELECT t.id,t.title,t.status,t.due_at AS "dueAt",t.parent_task_id IS NOT NULL AS subtask,
             b.title AS "boardTitle",bucket.title AS bucket,${versionOf("t")} AS version
      FROM tasks t JOIN boards b ON b.id=t.board_id LEFT JOIN buckets bucket ON bucket.id=t.bucket_id
      WHERE ${ownBoard} AND ${taskScope}
      ORDER BY b.title,bucket.sort_order,t.sort_order,t.id
    `, [actor.id]);
    const { rows: events } = await client.query<Omit<OfflineEvent,"kind"|"startAt"|"endAt"> & { startAt: Date; endAt: Date }>(`
      SELECT e.id,e.title,e.starts_at AS "startAt",e.ends_at AS "endAt",e.all_day AS "allDay",
             b.title AS "boardTitle",${versionOf("e")} AS version
      FROM calendar_entries e JOIN boards b ON b.id=e.board_id
      WHERE ${ownBoard} AND ${eventScope}
      ORDER BY e.starts_at,e.id
    `, [actor.id]);
    return {
      ownerId: actor.id,
      items: [
        ...tasks.map((task) => ({ ...task, kind: "task" as const, dueAt: task.dueAt?.toISOString() ?? null })),
        ...events.map((event) => ({
          ...event, kind: "event" as const, startAt: event.startAt.toISOString(), endAt: event.endAt.toISOString(),
        })),
      ],
    };
  });
}

function timestamp(value: unknown): string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) throw invalid("Enter a valid date and time.");
  return new Date(value).toISOString();
}

export function parseOfflineWorkSave(body: Record<string, unknown>): OfflineWorkSave {
  const { operationId, itemId, kind, version, patch } = body;
  if (typeof operationId !== "string" || !isUuid(operationId) || typeof itemId !== "string" || !isUuid(itemId)
    || (kind !== "task" && kind !== "event")
    || typeof version !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(version)
    || !patch || typeof patch !== "object" || Array.isArray(patch)) throw invalid("Invalid offline edit.");
  const input = patch as Record<string, unknown>;
  const fields = kind === "task" ? ["title", "status", "dueAt"] : ["title", "startAt", "endAt"];
  if (!Object.keys(input).length || Object.keys(input).some((key) => !fields.includes(key)))
    throw invalid("Choose an editable field.");
  const edit: OfflineWorkPatch = {};
  if ("title" in input) {
    if (typeof input.title !== "string" || !input.title.trim() || input.title.length > 500)
      throw invalid("Enter a title of 500 characters or fewer.");
    edit.title = input.title.trim();
  }
  if ("status" in input) {
    if (typeof input.status !== "string" || !Object.hasOwn(offlineTaskStatuses,input.status))
      throw invalid("Choose a valid task status.");
    edit.status = input.status as OfflineWorkPatch["status"];
  }
  if ("dueAt" in input) edit.dueAt = input.dueAt === null ? null : timestamp(input.dueAt);
  if ("startAt" in input) edit.startAt = timestamp(input.startAt);
  if ("endAt" in input) edit.endAt = timestamp(input.endAt);
  return { operationId, itemId, kind, version, patch: edit };
}

type Board = { id: string; board_type: "personal"; owner_user_id: string };

async function updateWork(client: PoolClient, actor: Actor, save: OfflineWorkSave): Promise<OfflineWorkSaveResult> {
  const { kind, itemId, patch } = save;
  const table = kind === "task" ? "tasks" : "calendar_entries";
  const alias = kind === "task" ? "t" : "e";
  const scope = kind === "task" ? taskScope : eventScope;
  const params = [actor.id,itemId];
  // Use the same lock order as the online writers (user, tree, item).
  await getOrCreateUserRecord(client, actor);
  const { rows: [board] } = await client.query<Board>(`
    SELECT b.id,b.board_type,b.owner_user_id FROM ${table} ${alias}
    JOIN boards b ON b.id=${alias}.board_id
    WHERE ${ownBoard} AND ${alias}.id=$2 AND ${scope} FOR SHARE OF b
  `, params);
  if (!board) return { kind: "conflict", reason: "unavailable" };
  if (kind === "task" && patch.status !== undefined) await lockTaskTree(client, board.id, itemId);
  const { rows: [row] } = await client.query<{
    version: string; updated_at: Date; title: string; starts_at: Date; ends_at: Date;
    all_day: boolean; location: string; description: string; color: string;
  }>(`
    SELECT ${alias}.*,${versionOf(alias)} AS version FROM ${table} ${alias}
    WHERE ${alias}.board_id=$1 AND ${alias}.id=$2 AND ${scope} FOR UPDATE
  `, [board.id,itemId]);
  if (!row) return { kind: "conflict", reason: "unavailable" };
  if (row.version !== save.version) return { kind: "conflict", reason: "changed" };
  if (kind === "task") {
    await updateTaskInTransaction(client, actor, board, itemId, patch);
  } else {
    await updateNativeCalendarEntryInTransaction(client, actor, board, itemId, {
      expectedUpdatedAt: row.updated_at.toISOString(), title: patch.title ?? row.title,
      startAt: patch.startAt ?? row.starts_at.toISOString(), endAt: patch.endAt ?? row.ends_at.toISOString(),
      allDay: row.all_day, location: row.location, description: row.description, color: row.color,
    });
  }
  const { rows: [saved] } = await client.query<{ version: string }>(
    `SELECT ${versionOf(alias)} AS version FROM ${table} ${alias} WHERE ${alias}.id=$1`, [itemId],
  );
  return { kind: "saved", version: saved.version };
}

export async function saveOfflineWork(actor: Actor, save: OfflineWorkSave): Promise<OfflineWorkSaveResult> {
  try {
    return await withTransaction(async (client) => {
      const key = [actor.id,save.operationId];
      const digest = createHash("sha256").update(JSON.stringify(save)).digest("hex");
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`offline-work:${key.join(":")}`]);
      const { rows: [receipt] } = await client.query<{ fingerprint: string; version: string }>(
        "SELECT fingerprint,version FROM offline_work_receipts WHERE owner_user_id=$1 AND operation_id=$2",key,
      );
      if (receipt) {
        if (receipt.fingerprint !== digest) throw invalid("This offline edit ID is already in use.");
        return { kind: "saved", version: receipt.version };
      }
      const result = await updateWork(client,actor,save);
      if (result.kind === "saved") await client.query(
        "INSERT INTO offline_work_receipts(owner_user_id,operation_id,fingerprint,version) VALUES($1,$2,$3,$4)",
        [...key,digest,result.version],
      );
      return result;
    });
  } catch (error) {
    if (error instanceof BoardAccessError && error.status === 404) return { kind: "conflict", reason: "unavailable" };
    throw error;
  }
}
