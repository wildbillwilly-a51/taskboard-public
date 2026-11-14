"use client";

import { Download, Paperclip, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";
import type { NoteAttachment } from "@/lib/notes-model";
import {FolioFilePreview} from './folio-file-preview';
import s from './folio-features.module.css';

export function MobileNoteAttachments({ noteId, attachments, canEdit, onUpload, onUploadMany, onRemove }: {
  noteId: string;
  attachments: NoteAttachment[];
  canEdit: boolean;
  onUpload: (file: File) => Promise<string>;
  onUploadMany?: (files: File[]) => Promise<void>;
  onRemove: (id: string) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview,setPreview]=useState<NoteAttachment|null>(null);
  const { confirm, dialog } = useConfirm();
  const run = async (action: () => Promise<unknown>) => {
    setBusy(true); setError("");
    try { await action(); } catch (error) { setError(error instanceof Error ? error.message : "Unable to update attachments."); }
    finally { setBusy(false); }
  };
  const upload=(files:File[])=>run(async()=>{if(files.length>10||files.reduce((n,f)=>n+f.size,0)>50*1024*1024)throw Error('Choose up to 10 files, totaling no more than 50 MB.');if(onUploadMany)await onUploadMany(files);else for(const f of files)await onUpload(f);});
  return <div className={s.files} onDragOver={e=>{if(canEdit&&!busy&&e.dataTransfer.types.includes('Files'))e.preventDefault();}} onDrop={e=>{if(canEdit&&!busy&&e.dataTransfer.files.length){e.preventDefault();e.stopPropagation();void upload([...e.dataTransfer.files]);}}}>
    {!attachments.length ? <p className="notes-meta-empty">No attachments</p> : null}
    {attachments.map(file => <div className="notes-mobile-attachment" key={file.id}>
      <a href={`/api/notes/${noteId}/attachments/${file.id}`} download={file.originalName} aria-label={`Download ${file.originalName}`}><Download aria-hidden="true" /><span>{file.originalName}<small>{Math.max(1, Math.ceil(file.sizeBytes / 1024))} KB</small></span></a>
      <button type="button" className="ui-button" onClick={()=>setPreview(file)} aria-label={`Preview ${file.originalName}`}>Preview</button>
      {canEdit ? <button type="button" className="notes-icon-button" disabled={busy} aria-label={`Remove ${file.originalName}`} onClick={async () => {
        if (await confirm({ title: "Remove attachment?", body: `Remove “${file.originalName}” from this note? Any embedded copy will no longer load.`, confirmLabel: "Remove attachment", tone: "danger" })) await run(() => onRemove(file.id));
      }}><Trash2 aria-hidden="true" /></button> : null}
    </div>)}
    {canEdit ? <>
      <input ref={inputRef} type="file" multiple aria-label="Upload attachment" hidden disabled={busy} onChange={event => {
        const files = [...(event.currentTarget.files??[])]; event.currentTarget.value = "";
        if (files.length) void upload(files);
      }} />
      <button type="button" className="ui-button" disabled={busy} onClick={() => inputRef.current?.click()}><Paperclip aria-hidden="true" />{busy ? "Uploading…" : "Attach files"}</button><small className={s.muted}>Or drop files here · 25 MB per file</small>
    </> : null}
    {error ? <p className="notes-error" role="alert">{error}</p> : null}
    {dialog}
    {preview?<FolioFilePreview name={preview.originalName} baseUrl={`/api/notes/${noteId}/attachments/${preview.id}/preview`} downloadUrl={`/api/notes/${noteId}/attachments/${preview.id}`} onClose={()=>setPreview(null)}/>:null}
  </div>;
}
