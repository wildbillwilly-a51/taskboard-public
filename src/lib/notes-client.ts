// Browser-side calls to the Notes API.

import { trackBoardWrite } from "@/components/use-live-board-revision";
import type {
  Notebook,
  NoteAttachment,
  NoteContentInput,
  NoteDetail,
  NoteHomeBoardOption,
  NoteListStatus,
  NoteSummary,
  NoteTagSummary,
} from "@/lib/notes-model";

export class NoteSaveConflictError extends Error {
  currentVersion: number;

  constructor(message: string, currentVersion: number) {
    super(message);
    this.name = "NoteSaveConflictError";
    this.currentVersion = currentVersion;
  }
}

// A failed Notes request, with its HTTP status.
export class NoteRequestError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "NoteRequestError";
    this.status = status;
  }
}

// The note is gone or no longer open to the viewer, as opposed to a failure
// worth trying again.
export function isNoteUnavailableError(error: unknown) {
  return error instanceof NoteRequestError && (error.status === 403 || error.status === 404);
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  // Changes are tracked, so a live reload never lands on top of one.
  const send = fetch(url, {
    ...init,
    headers:
      init?.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json", ...init.headers }
        : init?.headers,
  });
  const response = await (init?.method && init.method !== "GET" ? trackBoardWrite(send) : send);
  type Payload = { error?: string; code?: string; currentVersion?: number } & T;
  let payload: Payload;

  try {
    payload = (await response.json()) as Payload;
  } catch (error) {
    // An unreadable error body still reports the status below; an unreadable
    // success (including a request cancelled mid-read) must not pass as data.
    if (response.ok) {
      throw error;
    }

    payload = {} as Payload;
  }

  if (!response.ok) {
    if (response.status === 409 && payload.code === "note_conflict") {
      throw new NoteSaveConflictError(payload.error ?? "This note changed.", payload.currentVersion ?? 0);
    }

    throw new NoteRequestError(payload.error || `Request failed (${response.status}).`, response.status);
  }

  return payload;
}

function json(method: string, body: unknown): RequestInit {
  return { method, body: JSON.stringify(body) };
}

export type NoteListQuery = {
  wikiSpaceId?: string;
  scope: "personal" | "board" | "all";
  status?: NoteListStatus;
  boardId?: string;
  bucketId?: string;
  notebookId?: string;
  label?: string;
  q?: string;
  pinned?: boolean;
  limit?: number;
};

export async function fetchNotes(query: NoteListQuery, signal?: AbortSignal) {
  const params = new URLSearchParams({ scope: query.scope, status: query.status ?? "active" });

  for (const key of ["boardId", "bucketId", "notebookId", "label", "q", "wikiSpaceId"] as const) {
    const value = query[key];

    if (value) {
      params.set(key, value);
    }
  }

  if (query.pinned) {
    params.set("pinned", "1");
  }

  if (query.limit) {
    params.set("limit", String(query.limit));
  }

  return (await request<{ notes: NoteSummary[] }>(`/api/notes?${params}`, { signal })).notes;
}

export async function fetchNote(noteId: string, signal?: AbortSignal) {
  return (await request<{ note: NoteDetail }>(`/api/notes/${noteId}`, { signal, cache: "no-store" })).note;
}

export type CreateNoteRequest = {
  title?: string;
  content?: NoteContentInput;
  boardId?: string | null;
  bucketId?: string | null;
  notebookId?: string | null;
  labels?: string[];
  linkTaskId?: string;
};

export async function createNoteRequest(body: CreateNoteRequest) {
  return (await request<{ note: NoteDetail }>("/api/notes", json("POST", body))).note;
}

export type UpdateNoteRequest = {
  folioPageState?: import("@/lib/folio-model").FolioPageState;
  title?: string;
  content?: NoteContentInput;
  expectedVersion?: number;
  pinned?: boolean;
  archived?: boolean;
  notebookId?: string | null;
  labels?: string[];
  home?: { boardId: string | null; bucketId?: string | null };
};

export async function updateNoteRequest(
  noteId: string,
  body: UpdateNoteRequest,
  options: { keepalive?: boolean } = {},
) {
  return (
    await request<{ note: NoteDetail }>(`/api/notes/${noteId}`, {
      ...json("PATCH", body),
      keepalive: options.keepalive,
    })
  ).note;
}

export async function trashNoteRequest(noteId: string) {
  await request(`/api/notes/${noteId}`, { method: "DELETE" });
}

export async function deleteNoteForeverRequest(noteId: string) {
  await request(`/api/notes/${noteId}?permanent=1`, { method: "DELETE" });
}

export async function restoreNoteRequest(noteId: string) {
  return (await request<{ note: NoteDetail }>(`/api/notes/${noteId}/restore`, { method: "POST" })).note;
}

export async function linkNoteTaskRequest(noteId: string, taskId: string) {
  return (await request<{ note: NoteDetail }>(`/api/notes/${noteId}/links`, json("POST", { taskId }))).note;
}

export async function unlinkNoteTaskRequest(noteId: string, taskId: string) {
  return (await request<{ note: NoteDetail }>(`/api/notes/${noteId}/links/${taskId}`, { method: "DELETE" })).note;
}

export async function convertNoteToTaskRequest(
  noteId: string,
  body: { boardId?: string; bucketId?: string; timeZone?: string },
) {
  return request<{ taskId: string; boardId: string; note: NoteDetail }>(
    `/api/notes/${noteId}/convert-to-task`,
    json("POST", body),
  );
}

export async function uploadNoteAttachmentRequest(noteId: string, file: File) {
  return uploadNoteAttachmentsRequest(noteId,[file]);
}
export async function uploadNoteAttachmentsRequest(noteId:string,files:File[]) {
  const form = new FormData();
  for(const file of files)form.append("files", file);
  return (await request<{ attachments: NoteAttachment[] }>(`/api/notes/${noteId}/attachments`, {
    method: "POST",
    body: form,
  })).attachments;
}

export function getNoteAttachmentUrl(noteId: string, attachmentId: string) {
  return `/api/notes/${noteId}/attachments/${attachmentId}?disposition=inline`;
}

export async function deleteNoteAttachmentRequest(noteId: string, attachmentId: string, options: { permanent?: boolean } = {}) {
  await request(`/api/notes/${noteId}/attachments/${attachmentId}${options.permanent ? "?permanent=1" : ""}`, { method: "DELETE" });
}

export type NotebookListing = { notebooks: Notebook[]; inboxCount: number };

export async function fetchNoteHomes() {
  return (await request<{ homeOptions: NoteHomeBoardOption[] }>("/api/notes/homes")).homeOptions;
}

export async function fetchNotebooks() {
  return request<NotebookListing>("/api/notes/notebooks");
}

export async function createNotebookRequest(title: string, parentNotebookId: string | null) {
  return request<NotebookListing & { notebook: { id: string } }>(
    "/api/notes/notebooks",
    json("POST", { title, parentNotebookId }),
  );
}

export async function updateNotebookRequest(
  notebookId: string,
  body: { title?: string; parentNotebookId?: string | null },
) {
  return request<NotebookListing>(`/api/notes/notebooks/${notebookId}`, json("PATCH", body));
}

export async function deleteNotebookRequest(notebookId: string) {
  return request<NotebookListing>(`/api/notes/notebooks/${notebookId}`, { method: "DELETE" });
}

export async function fetchNoteTags() {
  return (await request<{ tags: NoteTagSummary[] }>("/api/notes/tags")).tags;
}

export async function fetchBoardNoteCounts(boardId: string, signal?: AbortSignal) {
  return request<{ boardNotes: number; buckets: Record<string, number> }>(
    `/api/notes/counts?boardId=${encodeURIComponent(boardId)}`,
    { signal },
  );
}

export async function fetchTaskLinkedNotes(taskId: string, signal?: AbortSignal) {
  return (await request<{ notes: NoteSummary[] }>(`/api/tasks/${taskId}/linked-notes`, { signal })).notes;
}

export async function fetchBoardLabels(boardId: string) {
  return (await request<{ labels: string[] }>(`/api/boards/${boardId}/labels`)).labels;
}

export function buildNotesHref(params: {
  noteId?: string;
  boardId?: string;
  bucketId?: string;
  createNew?: boolean;
  linkTaskId?: string;
}) {
  const search = new URLSearchParams();

  if (params.noteId) search.set("note", params.noteId);
  if (params.boardId) search.set("boardId", params.boardId);
  if (params.bucketId) search.set("bucketId", params.bucketId);
  if (params.createNew) search.set("new", "1");
  if (params.linkTaskId) search.set("linkTaskId", params.linkTaskId);

  const query = search.toString();
  return query ? `/folio?${query}` : "/folio";
}
