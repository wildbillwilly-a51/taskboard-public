"use client";
/* eslint-disable @next/next/no-img-element -- Share-scoped media retains authorization. */
import { useState } from "react";
import { Download, FileText, X } from "lucide-react";
import { sharedFileHref, type SharedFile } from "@/lib/public-task-share-model";
const button = "work-button inline-flex items-center gap-1";
export function PublicTaskFiles({ files, token }: {
    files: SharedFile[];
    token: string;
}) {
    const [preview, setPreview] = useState<string | null>(null);
    const file = files.find(f => f.id === preview);
    return <div className="grid min-w-0 gap-1.5">
    {files.length ? files.map(f => <div key={f.id} className="taskboard-subtle-surface rounded-[12px] border px-2.5 py-2">
      <div className="flex min-w-0 flex-wrap items-center gap-2"><FileText size={14}/><span className="min-w-0 flex-1 break-words ed-strong">{f.name}</span><span className="work-muted">{Math.ceil(f.sizeBytes / 1024)} KB</span>
        {f.preview !== "none" ? <button className={button} type="button" onClick={() => setPreview(preview === f.id ? null : f.id)}>Preview</button> : null}
        <a className={button} href={sharedFileHref(token, f)} rel="noreferrer"><Download size={12}/>Download</a>
      </div>
    </div>) : <p className="work-muted">No files attached.</p>}
    {file ? <section className="taskboard-subtle-surface rounded-[12px] border p-2" aria-label={`Preview ${file.name}`}>
      <div className="mb-2 flex justify-between gap-2"><span className="ed-strong">{file.name}</span><button type="button" className={button} onClick={() => setPreview(null)} aria-label="Close file preview"><X size={14}/>Close</button></div>
      {file.preview === "image" ? <img src={sharedFileHref(token, file, true)} alt={file.name} className="max-h-[65vh] w-full object-contain"/> : <iframe title={file.name} src={sharedFileHref(token, file, true)} referrerPolicy="no-referrer" allow="camera 'none'; microphone 'none'; geolocation 'none'" className="h-[65vh] w-full rounded border"/>}
    </section> : null}
  </div>;
}
