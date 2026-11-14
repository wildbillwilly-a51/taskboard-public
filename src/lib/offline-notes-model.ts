import type { NoteContentInput } from "@/lib/notes-model";

export type OfflineNoteBody = { title: string; content: NoteContentInput };

export type OfflineNote = OfflineNoteBody & { id: string; version: number };

export type OfflineSave = OfflineNoteBody & {
  operationId: string;
  noteId: string | null;
  expectedVersion: number | null;
};

export type OfflineSnapshot = { ownerId: string; notes: OfflineNote[] };

export const offlineNotesPath = "/offline-notes/personal";
export const offlineNotesApi = "/api/offline-notes";
export const offlineNotesWorkerPath = "/offline-notes/personal-sw.js";
export const offlineNotesSignInPath = `${offlineNotesPath}?sign-in=1`;
export const offlineNotesCache = "taskboard-offline-personal-notes-v1";
