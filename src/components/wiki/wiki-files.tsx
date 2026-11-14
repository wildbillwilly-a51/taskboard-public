"use client";
import { Paperclip, Plus } from "lucide-react";
import { WikiButton } from "./wiki-controls";
import type { NoteAttachment } from "@/lib/notes-model";
import { useConfirm } from "@/components/ui/confirm-dialog";
export function WikiFiles({ noteId, files, canEdit, canManage, busy, onUpload, onRemove }: { noteId: string; files: NoteAttachment[]; canEdit: boolean; canManage: boolean; busy: boolean; onUpload: (file: File) => void; onRemove: (id: string, permanent: boolean) => void }) {
  const { confirm, dialog } = useConfirm();
  return <section className="wiki-files" aria-label="Current files"><h2><Paperclip aria-hidden="true" />Files</h2>{!files.length ? <p className="wiki-muted">No current files.</p> : null}<ul>{files.map(file => <li key={file.id}><a href={`/api/notes/${noteId}/attachments/${file.id}`} download={file.originalName}>{file.originalName}</a><small>{Math.max(1, Math.ceil(file.sizeBytes / 1024))} KB</small>{canEdit ? <WikiButton disabled={busy} onClick={() => onRemove(file.id, false)}>Remove</WikiButton> : null}{canManage ? <WikiButton disabled={busy} onClick={async () => { if (await confirm({ title: "Delete file permanently?", body: `“${file.originalName}” will also be unavailable in old versions. This cannot be undone.`, confirmLabel: "Delete permanently", tone: "danger" })) onRemove(file.id, true); }}>Delete permanently</WikiButton> : null}</li>)}</ul>{canEdit ? <label className="wiki-upload ui-button ui-button-surface"><Plus aria-hidden="true" />Add file<input type="file" disabled={busy} onChange={event => { const file = event.currentTarget.files?.[0]; event.currentTarget.value = ""; if (file) onUpload(file); }} /></label> : null}{dialog}</section>;
}
