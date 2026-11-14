import type { Task, TaskStatus } from "@/lib/taskboard-data";
export type TaskShareMode = "view" | "edit_work";
export type TaskShareLink = {
    id?: string;
    exists: boolean;
    active: boolean;
    expired: boolean;
    createdAt?: string;
    expiresAt: string | null;
    disabled?: boolean;
    unavailable?: boolean;
    url?: string;
    retrieval?: "legacy" | "unavailable";
};
// A subtask is done or not done (see subtask-rule.ts).
export type SharedWorkPatch = { title?: string; status?: Extract<TaskStatus, "todo" | "done">; startAt?: string | null; endAt?: string | null; allDay?: boolean };
export type SharedWorkChange =
    | { type: "subtask.update"; taskId: string; patch: SharedWorkPatch }
    | { type: "subtask.add"; parentTaskId: string; title: string }
    | { type: "subtask.move"; taskId: string; parentTaskId: string; targetIndex: number }
    | { type: "checklist.add"; label: string }
    | { type: "checklist.update"; itemId: string; label?: string; done?: boolean }
    | { type: "checklist.remove"; itemId: string }
    | { type: "note.add"; body: string }
    | { type: "note.update"; noteId: string; body: string }
    | { type: "note.remove"; noteId: string };
export type SharedWorkRequest = { mutationId: string; editRevision: string; change: SharedWorkChange };
export type SharedNote = {
    id: string;
    title: string;
    version: number;
    content: unknown[];
    attachments: SharedFile[];
};
export type SharedFile = {
    id: string;
    name: string;
    sizeBytes: number;
    kind: "task" | "note";
    preview: "image" | "pdf" | "none";
};
export type PublicTaskWorkspace = {
    task: Task;
    notes: SharedNote[];
    files: SharedFile[];
    timeZone: string;
    bucketTitle?: string;
    revision: string;
    appliedEditRevision?: string;
    sharing?: { mode: TaskShareMode; expiresAt: string | null; editRevision?: string; editableNoteIds?: string[] };
};
export type TaskShareManagement = {
    allowed: boolean;
    active: boolean;
    createdAt?: string;
    noteTitles: string[];
    excludedNoteTitles: string[];
    fileCount: number;
    url?: string;
    editingEnabled?: boolean;
    links?: Record<TaskShareMode, TaskShareLink>;
    changedMode?: TaskShareMode;
    canGenerateLinks?: boolean;
};
export const publicShareHeaders = {
    "Cache-Control": "private, no-store, max-age=0",
    "Referrer-Policy": "no-referrer",
    "X-Robots-Tag": "noindex, nofollow, noarchive",
    "X-Content-Type-Options": "nosniff",
};
export function isPublicTaskSharePath(path: string) {
    return /^\/share\/task\/[A-Za-z0-9_-]{43}(?:\/(?:data|changes|people|files\/(?:task|note)\/[0-9a-f-]{36}))?\/?$/.test(path);
}
export function sharedFileHref(token: string, file: Pick<SharedFile, "id" | "kind">, inline = false) {
    return `/share/task/${encodeURIComponent(token)}/files/${file.kind}/${file.id}${inline ? "?inline=1" : ""}`;
}
