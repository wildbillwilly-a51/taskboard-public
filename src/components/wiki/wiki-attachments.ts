import type { NoteAttachment } from "@/lib/notes-model";

// Upload returns the complete current list, not just the uploaded row. Identify
// the new file without fetching or registering a title/body content version.
export function selectUploadedNoteFile(previous: NoteAttachment[], current: NoteAttachment[], file: { name: string; size: number }) {
  const known = new Set(previous.map(item => item.id));
  const added = current.filter(item => !known.has(item.id));
  return added.slice().reverse().find(item => item.originalName === file.name && item.sizeBytes === file.size) ?? added[added.length - 1];
}
