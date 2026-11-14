import type { NoteAttachment, NoteContentInput } from "./notes-model";
export type SharedFolioNote = {
  id: string;
  title: string;
  content: unknown[];
  contentMarkdown: string;
  contentFormatVersion: number;
  contentVersion: number;
  attachments: NoteAttachment[];
  mode: "read" | "write";
  updatedAt: string;
};
export type PublicFolioSave = {
  mutationId: string;
  expectedVersion: number;
  title: string;
  content: NoteContentInput;
};
export const noteShareHeaders = {
  "Cache-Control": "private, no-store, max-age=0",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "X-Content-Type-Options": "nosniff",
};
export function sharedNoteFileUrl(token: string, id: string, preview = false) {
  return `/share/note/${encodeURIComponent(token)}/files/${id}${preview ? "?preview=1" : ""}`;
}
export function canonicalNoteFileUrl(noteId: string, fileId: string) {
  return `/api/notes/${noteId}/attachments/${fileId}?disposition=inline`;
}
