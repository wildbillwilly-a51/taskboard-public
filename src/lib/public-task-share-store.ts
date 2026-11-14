import { currentNoteAttachments } from "@/lib/note-attachments-store";
import "server-only";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { open } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { getPool } from "@/lib/db";
import { ensureDatabaseReady } from "@/lib/taskboard-store";
import {getNoteAttachmentDiskPath} from "@/lib/notes-store";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";
import type { Task, TaskNote } from "@/lib/taskboard-data";
import { isUuid } from "@/lib/uuid";
import { createPublicContentBudget, verifiedPreview } from "@/lib/public-task-share-content";
import { sharedFileHref, type PublicTaskWorkspace, type SharedFile, type SharedNote, type TaskShareManagement, type TaskShareMode, type TaskShareLink } from "@/lib/public-task-share-model";
import { getPublicWorkRevision } from "./public-task-work-revision";
import { encryptShareToken, recoverShareToken, shareLinkRecoveryAvailable } from "./task-share-link-crypto";
type Stamp = string | Date | null;
export type PublicTaskShare = {
    id: string;
    task_id: string;
    board_id: string;
    created_by_user_id: string;
    time_zone: string;
    created_at: Stamp;
    access_mode: TaskShareMode;
    expires_at: Stamp;
};
type Share = PublicTaskShare & { token_hash: string; token_ciphertext?: string | null; revoked_at?: Stamp; revoked_reason?: string | null };
type TaskRow = {
    id: string;
    parent_task_id: string | null;
    title: string;
    summary: string;
    next_action: string;
    status: Task["status"];
    color: string;
    icon: Task["icon"];
    start_at: Stamp;
    end_at: Stamp;
    due_at: Stamp;
    all_day: boolean;
    work_item_type: Task["workItemType"];
    is_read_only_import: boolean;
    archived_at: Stamp;
    deleted_at: Stamp;
    board_id: string;
    sort_order: string;
    recurrence_rule: Task["recurrence"];
    reminder_offset_minutes: number | null;
    overdue_reminder_enabled: boolean;
};
type FileRow = {
    id: string;
    task_id?: string;
    note_id: string | null;
    original_name: string;
    display_name?: string;
    stored_name: string;
    mime_type: string;
    size_bytes: string | number;
    created_at: Stamp;
};
type NoteRow = {
    id: string;
    title: string;
    board_id: string | null;
    owner_user_id: string;
    content_json: unknown;
    content_version: number;
    archived_at: Stamp;
};
const iso = (value: Stamp) => value ? new Date(value).toISOString() : undefined;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
let publicReads = 0;
export class TaskShareUnavailable extends Error {
    constructor() { super("This shared workspace is unavailable."); }
}
export function publicTaskSharingEnabled() { return process.env.TASKBOARD_PUBLIC_SHARES_ENABLED === "true"; }
export function publicTaskEditingEnabled() { return process.env.TASKBOARD_PUBLIC_TASK_EDITS_ENABLED === "true"; }
// Publication intentionally does not inherit global-admin or explicit board-owner grants.
async function mayPublish(client: PoolClient, userId: string, boardId: string) {
    const result = await client.query<{
        allowed: boolean;
    }>(`
    SELECT EXISTS (
      SELECT 1 FROM boards b JOIN users u ON u.id = $1 AND NOT u.is_disabled
      LEFT JOIN teams t ON t.id = b.owner_team_id
      LEFT JOIN team_members tm ON tm.team_id = t.id AND tm.user_id = u.id
      WHERE b.id = $2 AND (
        (COALESCE(b.board_type, 'personal') = 'personal' AND b.owner_user_id = u.id)
        OR (b.board_type = 'team' AND t.archived_at IS NULL AND tm.role = 'manager')
      )
    ) AS allowed`, [userId, boardId]);
    return result.rows[0]?.allowed === true;
}
async function clientFor<T>(readOnly: boolean, callback: (client: PoolClient) => Promise<T>) {
    if (readOnly && publicReads >= 4)
        throw new Error("Public reader is busy.");
    const pool = getPool();
    if (!pool)
        throw new TaskShareUnavailable();
    if (readOnly)
        publicReads++;
    let client: PoolClient;
    try {
        client = await pool.connect();
    }
    catch (error) {
        if (readOnly)
            publicReads--;
        throw error;
    }
    try {
        await client.query(readOnly ? "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY" : "BEGIN ISOLATION LEVEL READ COMMITTED");
        await client.query("SET LOCAL statement_timeout = '5s'");
        const result = await callback(client);
        await client.query("COMMIT");
        return result;
    }
    catch (error) {
        await client.query("ROLLBACK");
        throw error;
    }
    finally {
        client.release();
        if (readOnly)
            publicReads--;
    }
}
async function readShare(client: PoolClient, token: string): Promise<Share> {
    if (!publicTaskSharingEnabled() || !/^[A-Za-z0-9_-]{43}$/.test(token))
        throw new TaskShareUnavailable();
    const result = await client.query<Share>(`
    SELECT s.id, s.task_id, s.board_id, s.created_by_user_id, s.time_zone, s.created_at,
      COALESCE(to_jsonb(s)->>'access_mode','view') AS access_mode,
      NULLIF(to_jsonb(s)->>'expires_at','')::timestamptz AS expires_at
    FROM task_public_shares s JOIN tasks t ON t.id = s.task_id
    WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND t.board_id = s.board_id
      AND t.deleted_at IS NULL AND t.archived_at IS NULL AND NOT t.is_read_only_import
      AND COALESCE(t.source_type, 'native') = 'native'
      AND (NULLIF(to_jsonb(s)->>'expires_at','') IS NULL OR (to_jsonb(s)->>'expires_at')::timestamptz > clock_timestamp())`, [hash(token)]);
    const share = result.rows[0];
    if (!share || share.access_mode === "edit_work" && !publicTaskEditingEnabled() || !await mayPublish(client, share.created_by_user_id, share.board_id) || !await activeLineage(client, share.task_id, share.board_id))
        throw new TaskShareUnavailable();
    return share;
}
const lineageSql = `WITH RECURSIVE lineage AS (
  SELECT id,parent_task_id,board_id,deleted_at,archived_at,ARRAY[id] AS ancestry FROM tasks WHERE id=$1
  UNION ALL
  SELECT p.id,p.parent_task_id,p.board_id,p.deleted_at,p.archived_at,l.ancestry||p.id
    FROM tasks p JOIN lineage l ON p.id=l.parent_task_id WHERE NOT p.id=ANY(l.ancestry)
)`;
async function activeLineage(client: PoolClient, taskId: string, boardId: string, lock = false) {
    if (lock)
        await client.query(`${lineageSql} SELECT t.id FROM tasks t WHERE t.id IN (SELECT id FROM lineage) ORDER BY t.id FOR SHARE`, [taskId]);
    const result = await client.query<{
        allowed: boolean;
    }>(`${lineageSql}
    SELECT COALESCE(bool_and(board_id=$2 AND deleted_at IS NULL AND archived_at IS NULL
      AND (parent_task_id IS NULL OR NOT parent_task_id=ANY(ancestry))),FALSE) AS allowed FROM lineage`, [taskId, boardId]);
    return result.rows[0]?.allowed === true;
}
async function noteInventory(client: PoolClient, rootId: string, publisher: string) {
    // Inventory raw links first. The authenticated list intentionally filters private notes.
    const result = await client.query<NoteRow>(`
    SELECT n.id,n.title,n.board_id,n.owner_user_id,n.content_version,n.archived_at
    FROM note_task_links l JOIN notes n ON n.id = l.note_id
    WHERE l.task_id = $1 AND n.deleted_at IS NULL AND n.folio_kind IS NULL ORDER BY l.created_at,n.id`, [rootId]);
    const eligible: NoteRow[] = [], excludedTitles: string[] = [];
    const boardAccess = new Map<string, boolean>();
    for (const note of result.rows) {
        if (note.board_id && !boardAccess.has(note.board_id))
            boardAccess.set(note.board_id, await mayPublish(client, publisher, note.board_id));
        if (!note.archived_at && (note.board_id ? boardAccess.get(note.board_id) : note.owner_user_id === publisher))
            eligible.push(note);
        // Do not disclose the existence/title of somebody else's personal notes.
        else if (!note.board_id && note.owner_user_id === publisher || note.board_id && boardAccess.get(note.board_id))
            excludedTitles.push(note.title || "Untitled note");
    }
    return { eligible, excludedTitles };
}
function mapFile(row: FileRow, kind: SharedFile["kind"]): SharedFile {
    return { id: row.id, name: row.display_name || row.original_name, sizeBytes: Number(row.size_bytes), kind, preview: verifiedPreview(row.mime_type) };
}
async function rootFiles(client: PoolClient, taskId: string) {
    return (await client.query<FileRow>(`
    SELECT a.* FROM task_attachments a JOIN tasks t ON t.id = a.task_id AND t.board_id = a.board_id
    LEFT JOIN task_notes n ON n.id = a.note_id AND n.task_id = a.task_id
    WHERE a.task_id = $1 AND (a.note_id IS NULL OR n.deleted_at IS NULL AND n.id IS NOT NULL)
    ORDER BY a.created_at,a.id`, [taskId])).rows;
}
async function workspace(client: PoolClient, share: PublicTaskShare, token: string, origin: string): Promise<PublicTaskWorkspace> {
    const contentBudget = createPublicContentBudget();
    const taskRows = (await client.query<TaskRow>(`
    WITH RECURSIVE tree AS (
      SELECT t.id, ARRAY[t.id] AS ancestry FROM tasks t WHERE t.id = $1 AND t.board_id = $2 AND t.deleted_at IS NULL AND t.archived_at IS NULL
      UNION ALL
      SELECT c.id, tree.ancestry || c.id FROM tasks c JOIN tree ON c.parent_task_id = tree.id
      WHERE c.board_id = $2 AND c.deleted_at IS NULL AND c.archived_at IS NULL AND NOT c.id = ANY(tree.ancestry)
    ) SELECT t.id,t.parent_task_id,t.title,
      CASE WHEN t.id=$1 AND octet_length(t.summary)<=262144 THEN t.summary ELSE NULL END AS summary,
      CASE WHEN t.id=$1 AND octet_length(t.next_action)<=262144 THEN t.next_action ELSE NULL END AS next_action,
      t.status,t.color,t.icon,t.start_at,t.end_at,t.due_at,t.all_day,t.work_item_type,t.is_read_only_import,
      t.archived_at,t.deleted_at,t.board_id,t.sort_order,t.recurrence_rule,t.reminder_offset_minutes,t.overdue_reminder_enabled
      FROM tree JOIN tasks t ON t.id=tree.id ORDER BY t.sort_order,t.id LIMIT 5001`, [share.task_id, share.board_id])).rows;
    if (!taskRows.length || taskRows.length > 5000 || taskRows.some(t => t.is_read_only_import))
        throw new TaskShareUnavailable();
    const map = new Map<string, Task>();
    for (const row of taskRows) {
        const root = row.id === share.task_id;
        map.set(row.id, { id: row.id, title: row.title, summary: root ? contentBudget.text(row.summary) : "", status: row.status,
            color: row.color || "#64748b", icon: row.icon || "flag", startAt: iso(row.start_at), endAt: iso(row.end_at), dueAt: iso(row.due_at), allDay: row.all_day,
            ...(root ? { nextAction: contentBudget.text(row.next_action), workItemType: row.work_item_type, recurrence: row.recurrence_rule || undefined,
                reminderConfig: { reminderOffsetMinutes: row.reminder_offset_minutes, overdueReminderEnabled: row.overdue_reminder_enabled } } : {}),
            labels: [], notes: [], checklist: [], attachments: [], subtasks: [] });
    }
    for (const row of taskRows)
        if (row.id !== share.task_id && row.parent_task_id)
            map.get(row.parent_task_id)?.subtasks.push(map.get(row.id)!);
    const task = map.get(share.task_id)!;
    const checklist = await client.query<{
        id: string;
        label: string;
        is_done: boolean;
    }>("SELECT id,label,is_done FROM checklist_items WHERE task_id = $1 ORDER BY sort_order,id", [task.id]);
    task.checklist = checklist.rows.map(row => ({ id: row.id, label: row.label, done: row.is_done }));
    const taskFiles = await rootFiles(client, task.id);
    task.attachments = taskFiles.map(row => ({ id: row.id, originalName: row.original_name, displayName: row.display_name || row.original_name, mimeType: row.mime_type, sizeBytes: Number(row.size_bytes), createdAt: iso(row.created_at)!, previewKind: verifiedPreview(row.mime_type), ...(row.note_id ? { noteId: row.note_id } : {}) }));
    const editableNoteIds: string[] = [];
    const workNotes = await client.query<{
        id: string;
        body: string;
        note_type: string;
        created_at: Stamp;
        updated_at: Stamp;
        author: string;
        editor: string;
    }>(`
    SELECT n.id,CASE WHEN octet_length(n.body)<=262144 THEN n.body ELSE NULL END AS body,
      n.note_type,n.created_at,n.updated_at,
      COALESCE(u.display_name,CASE WHEN to_jsonb(n)->>'created_via_share_id' IS NOT NULL THEN 'Shared link editor' END) AS author,
      COALESCE(e.display_name,CASE WHEN to_jsonb(n)->>'updated_via_share_id' IS NOT NULL THEN 'Shared link editor' END) AS editor
    FROM task_notes n LEFT JOIN users u ON u.id=n.created_by_user_id LEFT JOIN users e ON e.id=n.updated_by_user_id
    WHERE n.task_id=$1 AND n.board_id=$2 AND n.deleted_at IS NULL ORDER BY n.created_at,n.id`, [task.id, share.board_id]);
    for (const row of workNotes.rows) {
        const note: TaskNote = { id: row.id, body: contentBudget.text(row.body), createdAt: iso(row.created_at)!, updatedAt: iso(row.updated_at), authorName: row.author || "Unknown", editorName: row.editor || undefined, attachments: task.attachments.filter(f => f.noteId === row.id) };
        if (row.note_type === "working" && typeof row.body === "string" && note.body === row.body && Buffer.byteLength(row.body) <= 65536) editableNoteIds.push(row.id);
        if (row.note_type === "primary")
            task.primaryNote = note;
        else
            task.notes.push(note);
    }
    task.labels = (await client.query<{
        name: string;
    }>("SELECT l.name FROM task_labels tl JOIN labels l ON l.id=tl.label_id WHERE tl.task_id=$1 ORDER BY l.name", [task.id])).rows.map(r => r.name);
    if (task.workItemType === "maintenance_outage") {
        const outage = (await client.query<{
            owner_name: string;
            attendees: string[];
            location_name: string;
        }>("SELECT o.owner_name,o.attendees,l.name AS location_name FROM maintenance_outages o LEFT JOIN maintenance_locations l ON l.id=o.location_id WHERE o.task_id=$1 AND o.board_id=$2", [task.id, share.board_id])).rows[0];
        if (outage)
            task.maintenanceOutage = { owner: outage.owner_name, attendees: outage.attendees, locationName: outage.location_name };
    }
    const inventory = await noteInventory(client, task.id, share.created_by_user_id);
    const noteIds = inventory.eligible.map(n => n.id);
    const noteFiles = noteIds.length ? await currentNoteAttachments(client, {noteIds}) : [];
    // Cap document scalars in PostgreSQL before parsing JSON in the public process.
    const contentRows = noteIds.length ? (await client.query<{
        id: string;
        content_json: unknown;
    }>(`
    SELECT id,CASE WHEN octet_length(content_json::text)>262144 THEN NULL ELSE content_json END AS content_json
      FROM notes WHERE id=ANY($1::uuid[])`, [noteIds])).rows : [];
    const noteContents = new Map(contentRows.map(n => [n.id, n.content_json]));
    const files = taskFiles.map(f => mapFile(f, "task"));
    const ownedUrls = new Map<string, string>();
    for (const f of taskFiles)
        ownedUrls.set(`/api/tasks/${task.id}/attachments/${f.id}`, sharedFileHref(token, { kind: "task", id: f.id }, true));
    for (const f of noteFiles)
        ownedUrls.set(`/api/notes/${f.note_id}/attachments/${f.id}`, sharedFileHref(token, { kind: "note", id: f.id }, true));
    const notes: SharedNote[] = inventory.eligible.map(n => {
        const content = contentBudget.document(noteContents.get(n.id), (raw, media) => {
            try {
                const url = new URL(raw, origin);
                if (!["http:", "https:"].includes(url.protocol) || url.username || url.password)
                    return null;
                if (url.origin === origin)
                    return ownedUrls.get(url.pathname) || null;
                return media ? null : url.href;
            }
            catch {
                return null;
            }
        });
        return { id: n.id, title: n.title || "Untitled note", version: n.content_version,
            attachments: noteFiles.filter(f => f.note_id === n.id).map(f => mapFile(f, "note")), content };
    });
    const bucket = (await client.query<{
        title: string;
    }>("SELECT b.title FROM tasks t JOIN buckets b ON b.id=t.bucket_id AND b.board_id=t.board_id WHERE t.id=$1", [task.id])).rows[0];
    const sharing = { mode: share.access_mode, expiresAt: iso(share.expires_at) || null,
        ...(share.access_mode === "edit_work" ? { editRevision: await getPublicWorkRevision(client, task.id, share.board_id), editableNoteIds } : {}) };
    const data = { task, notes, files, timeZone: share.time_zone, bucketTitle: bucket?.title, sharing };
    const json = JSON.stringify(data);
    if (Buffer.byteLength(json) > 5 * 1024 * 1024)
        throw new TaskShareUnavailable();
    return { ...data, revision: hash(json) };
}
export async function getPublicTaskWorkspace(token: string, origin: string) {
    if (!publicTaskSharingEnabled())
        throw new TaskShareUnavailable();
    // Do not run migrations, create a user or seed a board on anonymous reads.
    return clientFor(true, async (client) => workspace(client, await readShare(client, token), token, origin));
}
export async function withPublicTaskRead<T>(token: string, action: (client: PoolClient, share: PublicTaskShare) => Promise<T>) {
    return clientFor(true, async client => action(client, await readShare(client, token)));
}
export async function projectPublicTaskWorkspace(client: PoolClient, share: PublicTaskShare, token: string, origin: string) {
    return workspace(client, share, token, origin);
}
// Commit admission separately so rejected/stale saves consume the same budget
// as successful writes, before taking any task or working-note locks.
export async function admitPublicTaskEdit(token: string) {
    if (!publicTaskEditingEnabled()) throw new TaskShareUnavailable();
    return clientFor(false, async client => {
        const share = await readShare(client, token);
        if (share.access_mode !== "edit_work") throw new TaskShareUnavailable();
        const result = await client.query(`INSERT INTO task_share_work_limits AS limits
          (share_id,minute_started_at,minute_count,hour_started_at,hour_count)
          VALUES($1,clock_timestamp(),1,clock_timestamp(),1)
          ON CONFLICT(share_id) DO UPDATE SET
            minute_started_at=CASE WHEN limits.minute_started_at<=clock_timestamp()-interval '1 minute' THEN EXCLUDED.minute_started_at ELSE limits.minute_started_at END,
            minute_count=CASE WHEN limits.minute_started_at<=clock_timestamp()-interval '1 minute' THEN 1 ELSE limits.minute_count+1 END,
            hour_started_at=CASE WHEN limits.hour_started_at<=clock_timestamp()-interval '1 hour' THEN EXCLUDED.hour_started_at ELSE limits.hour_started_at END,
            hour_count=CASE WHEN limits.hour_started_at<=clock_timestamp()-interval '1 hour' THEN 1 ELSE limits.hour_count+1 END
          WHERE (limits.minute_count<120 OR limits.minute_started_at<=clock_timestamp()-interval '1 minute')
            AND (limits.hour_count<1000 OR limits.hour_started_at<=clock_timestamp()-interval '1 hour')
          RETURNING share_id`, [share.id]);
        return result.rowCount === 1;
    });
}
export async function withPublicTaskEdit<T>(token: string, action: (client: PoolClient, share: PublicTaskShare) => Promise<T>) {
    if (!publicTaskEditingEnabled()) throw new TaskShareUnavailable();
    return clientFor(false, async client => {
        const initial = await readShare(client, token);
        if (initial.access_mode !== "edit_work") throw new TaskShareUnavailable();
        await client.query("SELECT id FROM users WHERE id=$1 FOR SHARE", [initial.created_by_user_id]);
        await client.query("SELECT id FROM boards WHERE id=$1 FOR SHARE", [initial.board_id]);
        await client.query("SELECT t.id FROM teams t JOIN boards b ON b.owner_team_id=t.id WHERE b.id=$1 FOR SHARE OF t", [initial.board_id]);
        await client.query("SELECT m.user_id FROM team_members m JOIN boards b ON b.owner_team_id=m.team_id WHERE b.id=$1 AND m.user_id=$2 FOR SHARE OF m", [initial.board_id, initial.created_by_user_id]);
        await client.query("SELECT id FROM tasks WHERE id=$1 FOR UPDATE", [initial.task_id]);
        await activeLineage(client, initial.task_id, initial.board_id, true);
        await client.query("SELECT id FROM task_public_shares WHERE id=$1 FOR UPDATE", [initial.id]);
        const share = await readShare(client, token);
        if (share.access_mode !== "edit_work") throw new TaskShareUnavailable();
        return action(client, share);
    });
}
export class TaskShareConflict extends Error {
    constructor() { super("This link changed in another window. Review the latest link and try again."); }
}
export async function manageTaskShare(user: TaskboardUserIdentity, taskId: string, action: "status" | "create" | "replace" | "disable" | "update", timeZone = "UTC", settings: { mode?: TaskShareMode; expiresAt?: string | null; expectedShareId?: string | null } = {}): Promise<TaskShareManagement> {
    if (!publicTaskSharingEnabled() || !user.id || !isUuid(taskId)) throw new TaskShareUnavailable();
    const mode = settings.mode ?? "view";
    if (!["view", "edit_work"].includes(mode) || mode === "edit_work" && !publicTaskEditingEnabled()) throw new TaskShareUnavailable();
    await ensureDatabaseReady();
    new Intl.DateTimeFormat("en", { timeZone });
    if (settings.expiresAt !== undefined && settings.expiresAt !== null && (!Number.isFinite(Date.parse(settings.expiresAt)) || Date.parse(settings.expiresAt) <= Date.now())) throw new Error("Choose an expiry in the future.");
    return clientFor(false, async client => {
        const root = (await client.query<TaskRow & { source_type: string | null }>("SELECT * FROM tasks WHERE id=$1 FOR UPDATE", [taskId])).rows[0];
        // Share the task, not a subtask: its work, notes and files live there.
        if (!root || root.parent_task_id || root.is_read_only_import || root.source_type && root.source_type !== "native" || !await mayPublish(client, user.id!, root.board_id) || !await activeLineage(client, taskId, root.board_id, action !== "status"))
            return { allowed: false, active: false, noteTitles: [], excludedNoteTitles: [], fileCount: 0 };
        const rows = (await client.query<Share>(`SELECT * FROM task_public_shares WHERE id IN (
          SELECT DISTINCT ON (access_mode) id FROM task_public_shares WHERE task_id=$1
          ORDER BY access_mode,(revoked_at IS NULL) DESC,created_at DESC,id DESC
        ) ORDER BY access_mode FOR UPDATE`, [taskId])).rows;
        const publisherAllowed = new Map<string, boolean>();
        for (const row of rows) publisherAllowed.set(row.id, await mayPublish(client, row.created_by_user_id, row.board_id));
        const state = (which: TaskShareMode): TaskShareLink => {
            const row = rows.find(r => r.access_mode === which);
            const expired = !!row?.expires_at && new Date(row.expires_at).getTime() <= Date.now();
            const exists = !!row && !row.revoked_at;
            const unavailable = exists && (!publisherAllowed.get(row.id) || which === "edit_work" && !publicTaskEditingEnabled());
            const token = row && exists && !unavailable ? recoverShareToken(row.token_ciphertext, { id: row.id, taskId, mode: which, tokenHash: row.token_hash }) : null;
            return { id: exists ? row.id : undefined, exists, active: exists && !expired && !unavailable, expired: exists && expired,
                disabled: !!row?.revoked_at, unavailable, createdAt: iso(row?.created_at || null), expiresAt: iso(row?.expires_at || null) || null,
                ...(token ? { url: `/share/task/${token}` } : exists && !unavailable ? { retrieval: row.token_ciphertext ? "unavailable" : "legacy" } : {}) };
        };
        const inventory = await noteInventory(client, taskId, user.id!);
        const links = { view: state("view"), edit_work: state("edit_work") };
        const result: TaskShareManagement = { allowed: true, active: links.view.active, createdAt: links.view.createdAt,
            editingEnabled: publicTaskEditingEnabled(), canGenerateLinks: shareLinkRecoveryAvailable(), links, noteTitles: inventory.eligible.map(n => n.title || "Untitled note"), excludedNoteTitles: inventory.excludedTitles, fileCount: (await rootFiles(client, taskId)).length };
        if (action === "status") return result;
        const current = rows.find(r => r.access_mode === mode && !r.revoked_at);
        if (settings.expectedShareId !== undefined && settings.expectedShareId !== (current?.id ?? null)) throw new TaskShareConflict();
        let expiresAt = settings.expiresAt === undefined ? current ? iso(current.expires_at) || null : mode === "edit_work" ? new Date(Date.now() + 7 * 86400000).toISOString() : null : settings.expiresAt;
        if (action === "update") {
            if (!current || settings.expiresAt === undefined) throw new Error("Choose link settings to save.");
            await client.query("UPDATE task_public_shares SET expires_at=$2,time_zone=$3 WHERE id=$1 AND revoked_at IS NULL", [current.id, expiresAt, timeZone]);
        } else {
            if (action === "disable" || action === "replace") await client.query("UPDATE task_public_shares SET revoked_at=NOW(),revoked_reason=$3 WHERE task_id=$1 AND access_mode=$2 AND revoked_at IS NULL", [taskId, mode, action]);
            if (action !== "disable") {
                if (current && action === "create") throw new Error("A link already exists. Replace it to get a new link.");
                if (expiresAt && Date.parse(expiresAt) <= Date.now()) throw new Error("Choose an expiry in the future.");
                const token = randomBytes(32).toString("base64url"), id = randomUUID();
                const ciphertext = encryptShareToken(token, { id, taskId, mode, tokenHash: hash(token) });
                await client.query("INSERT INTO task_public_shares(id,task_id,board_id,created_by_user_id,token_hash,time_zone,access_mode,expires_at,token_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [id, taskId, root.board_id, user.id, hash(token), timeZone, mode, expiresAt, ciphertext]);
                links[mode] = { id, exists: true, active: true, expired: false, createdAt: new Date().toISOString(), expiresAt, url: `/share/task/${token}` };
                result.url = `/share/task/${token}`;
            }
        }
        expiresAt = action === "disable" ? null : expiresAt;
        if (action === "disable") links[mode] = { exists: false, active: false, expired: false, disabled: true, expiresAt: null };
        else if (action === "update") links[mode] = { ...links[mode], active: !links[mode].unavailable, expired: false, expiresAt };
        return { ...result, links, active: links.view.active, createdAt: links.view.createdAt, changedMode: mode };
    });
}
export async function getPublicTaskFile(token: string, kind: string, attachmentId: string) {
    if (!publicTaskSharingEnabled() || !isUuid(attachmentId) || !["task", "note"].includes(kind))
        throw new TaskShareUnavailable();
    const descriptor = await clientFor(true, async (client) => {
        const share = await readShare(client, token);
        let file: FileRow | undefined;
        if (kind === "task")
            file = (await rootFiles(client, share.task_id)).find(f => f.id === attachmentId);
        else {
            const notes = (await noteInventory(client, share.task_id, share.created_by_user_id)).eligible.map(n => n.id);
            file = (await currentNoteAttachments(client, {noteIds:notes,attachmentId}))[0];
        }
        if (!file)
            throw new TaskShareUnavailable();
        const storageRoot = path.resolve(process.cwd(), "uploads", kind === "task" || file.stored_name.startsWith("task:") ? "task-attachments" : "note-attachments");
        const diskPath = kind==="task" ? path.resolve(storageRoot,file.stored_name) : getNoteAttachmentDiskPath(file.stored_name);
        if (!diskPath.startsWith(storageRoot + path.sep))
            throw new TaskShareUnavailable();
        return { name: file.display_name || file.original_name, mime: file.mime_type, diskPath };
    });
    // Release the DB transaction and reader slot before any file I/O or download.
    const handle = await open(descriptor.diskPath, "r");
    try {
        const sizeBytes = (await handle.stat()).size;
        if (sizeBytes > 50 * 1024 * 1024)
            throw new TaskShareUnavailable();
        const signature = Buffer.alloc(16);
        const { bytesRead } = await handle.read(signature, 0, 16, 0);
        return { ...descriptor, sizeBytes, preview: verifiedPreview(descriptor.mime, signature.subarray(0, bytesRead)) };
    }
    finally {
        await handle.close();
    }
}
