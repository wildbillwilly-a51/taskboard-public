"use client";
import { WikiButton, WikiTextarea } from "./wiki-controls";
import { wikiLabels } from "@/lib/wiki-labels";
import dynamic from "next/dynamic";
import Link from "next/link";
import { ArrowLeft, Copy, Download, FolderInput, History, Home, ListTodo, RotateCcw, Trash2 } from "lucide-react";
import { wikiSpaceStyle } from "./wiki-appearance";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import type { NoteDetail } from "@/lib/notes-model";
import type { WikiPageDetail, WikiVersionDetail } from "@/lib/wiki-model";
import { useNoteDrafts, noteDraftStore } from "@/components/notes/use-note-drafts";
import { canApplyLiveLoad, liveWriteGeneration } from "@/components/use-live-board-revision";
import { deleteNoteAttachmentRequest, deleteNoteForeverRequest, getNoteAttachmentUrl, isNoteUnavailableError, NoteSaveConflictError, restoreNoteRequest, trashNoteRequest, uploadNoteAttachmentRequest } from "@/lib/notes-client";
import { fetchWikiPage, restoreWikiVersionRequest, updateWikiSpaceRequest } from "@/lib/wiki-client";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { WikiReader } from "./wiki-reader";
import { WikiHistory } from "./wiki-history";
import { WikiFiles } from "./wiki-files";
import { useWikiPageActions } from "./wiki-notes-actions";
import { useWikiRefresh } from "./wiki-live";
import { wikiViewQuery } from "./wiki-routing";
import { selectUploadedNoteFile } from "./wiki-attachments";
import { WikiTitle } from "./wiki-title";
import { WikiPageTopicsControl } from "./wiki-topics";
import { WikiBacklinks } from "./wiki-discovery";
import { WikiActionMenu } from "./wiki-action-menu";
import type { WikiMenuAction } from "./wiki-item-menu";
import { isWikiDocumentSupported, useWikiFormatInventory } from "./wiki-format";
const NoteEditor = dynamic(() => import("./wiki-editor"), { ssr: false, loading: () => <p role="status">Loading editor…</p> });

export function WikiPageWorkspace({ initialNote, initialHistory = false, initialVersionId }: { initialNote: WikiPageDetail; initialMode?: "read" | "edit"; initialHistory?: boolean; initialVersionId?: string }) {
  const inventory = useWikiFormatInventory();
  const router = useRouter(), query = useSearchParams();
  const [note, setNote] = useState(initialNote);
  const [local, setLocal] = useState(() => { const fields = noteDraftStore.register(initialNote); return { title: fields?.title ?? initialNote.title, content: fields?.content?.blocks ?? initialNote.content }; });
  const [generation, setGeneration] = useState(0), [busy, setBusy] = useState(false), [error, setError] = useState(""), [unavailable, setUnavailable] = useState(false);
  const [recovery, setRecovery] = useState(false);
  const { confirm, dialog } = useConfirm();
  const history = query ? query.get("view") === "history" : initialHistory;
  const versionId = query?.get("version") ?? initialVersionId;
  const drafts = useNoteDrafts({ onCreated: () => {}, onSaved: saved => {
    if (saved.id !== note.id) return;
    setRecovery(false);
    setNote(current => ({ ...current, ...saved, canEdit: current.canEdit && saved.canEdit, wiki: { ...(saved.wiki ?? current.wiki), spaceArchived: current.wiki.spaceArchived || Boolean(saved.wiki?.spaceArchived) } }));
  } });
  const status = drafts.statusOf(note.id);
  const canMutate = note.canEdit && !note.wiki.spaceArchived && !unavailable && isWikiDocumentSupported(note.content, note.contentFormatVersion, inventory);
  const editable = canMutate && !note.deletedAt && !busy && !drafts.isBlocked(note.id);
  const view = (next: "read" | "edit" | "history", version?: string) => {
    const params = new URLSearchParams();
    if (next === "history") { params.set("view", "history"); if (version) params.set("version", version); }
    router.replace(note.wiki.canonicalHref + (params.size ? `?${params}` : ""), { scroll: false });
  };
  const install = (detail: NoteDetail) => {
    if (!detail.wiki) throw new Error("Expected a wiki page.");
    drafts.install(detail);
    setNote(detail as WikiPageDetail); setLocal({ title: detail.title, content: detail.content }); setGeneration(value => value + 1);
  };
  const run = async (action: (version: number) => Promise<void>, readOnly = false) => {
    setBusy(true); setError("");
    try { await drafts.runExclusive(note.id, action, { readOnly }); }
    catch (reason) { setError(reason instanceof NoteSaveConflictError ? "This page changed elsewhere. Your text is kept. Reload the current page or preview history before restoring again." : reason instanceof Error ? reason.message : "Unable to complete action."); }
    finally { setBusy(false); }
  };
  useWikiRefresh(async () => {
    const write = liveWriteGeneration();
    let fresh: WikiPageDetail;
    try { fresh = await fetchWikiPage(note.id); }
    catch (reason) { if (isNoteUnavailableError(reason)) { drafts.suspend(note.id); setUnavailable(true); setRecovery(!drafts.isIdle(note.id)); return true; } throw reason; }
    setUnavailable(false);
    // Access always advances, including recovery from archive/revocation. Local
    // text keeps its original expectedVersion until an explicit successful save.
    setNote(current => ({ ...current, canEdit: fresh.canEdit, wiki: fresh.wiki, deletedAt: fresh.deletedAt }));
    const accessWritable = fresh.canEdit && !fresh.wiki.spaceArchived;
    // A refresh can start before the lazy schema resolves. That closure cannot
    // certify the format, but it must still apply an authoritative revocation.
    // Retry with the current inventory instead of recording a lasting denial.
    if (!inventory) {
      if (!accessWritable) drafts.suspend(note.id);
      return false;
    }
    const writable = accessWritable && isWikiDocumentSupported(fresh.content, fresh.contentFormatVersion, inventory);
    drafts.suspend(note.id, !writable);
    if (!drafts.isIdle(note.id)) { if (!writable) setRecovery(true); return true; }
    if (!canApplyLiveLoad(write) || busy) return false;
    drafts.register(fresh);
    setNote(fresh); setLocal({ title: fresh.title, content: fresh.content });
    if (fresh.contentVersion !== note.contentVersion) setGeneration(value => value + 1);
    if (fresh.wiki.canonicalHref !== window.location.pathname) {
      const href = fresh.wiki.canonicalHref + wikiViewQuery(Object.fromEntries(query?.entries() ?? []));
      // A same-space rename has already been authorized and loaded. Update its
      // address without remounting an open metadata form or losing its focus.
      if (fresh.wiki.spaceId === note.wiki.spaceId) window.history.replaceState(null, "", href);
      else router.replace(href, { scroll: false });
    }
    return true;
  });
  const reload = async () => {
    if (!(await confirm({ title: "Reload the current page?", body: "This discards this tab’s unsaved edits for this page.", confirmLabel: "Reload page", focusCancel: true }))) return;
    setBusy(true);
    try { const fresh = await fetchWikiPage(note.id); drafts.forget(note.id); drafts.suspend(note.id, false); drafts.register(fresh); setNote(fresh); setLocal({ title: fresh.title, content: fresh.content }); setGeneration(value => value + 1); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to reload."); }
    finally { setBusy(false); }
  };
  const uploadInline = async (file: File) => {
    if (!editable) throw new Error("This page is read only.");
    const attachments = await uploadNoteAttachmentRequest(note.id, file);
    const added = selectUploadedNoteFile(note.attachments, attachments, file);
    if (!added) throw new Error("Upload returned no file.");
    // No body/version fetch or register: another author's edit must conflict.
    setNote(current => ({ ...current, attachments }));
    return getNoteAttachmentUrl(note.id, added.id);
  };
  const restoreVersion = async (version: WikiVersionDetail) => {
    if (!(await confirm({ title: `Restore version ${version.versionNumber}?`, body: "Your pending edits are saved first. This creates a new version; newer current files are retained.", confirmLabel: "Restore version", focusCancel: true }))) return;
    await run(async expected => { const restored = await restoreWikiVersionRequest(note.id, version.id, expected); install(restored); view("read"); });
  };
  const actions = useWikiPageActions({ note, onBusy: setBusy, onChanged: detail => { if (detail.wiki) { setNote(detail as WikiPageDetail); setLocal({ title: detail.title, content: detail.content }); setGeneration(value => value + 1); } } });
  const menuActions: WikiMenuAction[] = [
    { label: "History", icon: <History aria-hidden="true" />, run: () => view("history"), focus: "handoff" },
    ...(!note.deletedAt ? [{ label: "Copy to my notes", icon: <Copy aria-hidden="true" />, disabled: busy, run: () => void actions.copy(), focus: "handoff" as const }] : []),
    ...(canMutate && !note.deletedAt ? [{ label: "Move to space…", icon: <FolderInput aria-hidden="true" />, disabled: busy, run: () => void actions.pick() }] : []),
    ...(canMutate && note.deletedAt ? [
      { label: "Restore from trash", icon: <RotateCcw aria-hidden="true" />, disabled: busy, run: () => void run(async () => install(await restoreNoteRequest(note.id))) },
      ...(note.wiki.canDeletePermanently ? [{ label: "Delete permanently", icon: <Trash2 aria-hidden="true" />, danger: true, disabled: busy, run: () => { void (async () => {
        if (await confirm({ title: "Delete page permanently?", body: "All versions and files will be deleted. This cannot be undone.", confirmLabel: "Delete permanently", tone: "danger" })) void run(async () => { await deleteNoteForeverRequest(note.id); drafts.forget(note.id); router.push(`/wiki/${note.wiki.spaceSlug}`); });
      })(); } }] : []),
    ] : []),
    ...(canMutate && !note.deletedAt ? [
      { label: "Move to trash", icon: <Trash2 aria-hidden="true" />, disabled: busy, danger: true, separator: true, run: () => { void (async () => {
        if (await confirm({ title: "Move page to trash?", body: "It can be restored for 30 days. Its home page assignment is cleared.", confirmLabel: "Move to trash", tone: "danger" })) void run(async () => { await trashNoteRequest(note.id); drafts.forget(note.id); router.push(`/wiki/${note.wiki.spaceSlug}?status=trash`); });
      })(); } },
      ...(note.wiki.canManage ? [{ label: "Set as space home", icon: <Home aria-hidden="true" />, disabled: busy, run: () => void run(async () => { await updateWikiSpaceRequest(note.wiki.spaceId, { homeNoteId: note.id }); router.refresh(); }) }] : []),
    ] : []),
    { label: "Export Markdown", icon: <Download aria-hidden="true" />, disabled: busy, separator: true, run: () => void run(async () => {
      const latest = drafts.latestOf(note.id);
      const markdown = `# ${latest.title ?? note.title}\n\n${latest.content?.markdown ?? note.contentMarkdown}`;
      const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown" }));
      const link = document.createElement("a"); link.href = url; link.download = "wiki-page.md"; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, true) },
  ];
  if (unavailable) return <section className="wiki-container"><h1>Page unavailable</h1><p>Your access changed. Editing has stopped.</p>{!drafts.isIdle(note.id) ? <label>Unsaved local text<WikiTextarea readOnly value={`${drafts.latestOf(note.id).title ?? ""}\n${drafts.latestOf(note.id).content?.markdown ?? ""}`} /></label> : null}<Link href="/wiki">{wikiLabels.back}</Link></section>;
  return <article className="wiki-container wiki-page" style={wikiSpaceStyle(note.wiki.spaceId, note.wiki.spaceArchived)}><Link className="wiki-breadcrumb" href={`/wiki/${note.wiki.spaceSlug}`}><ArrowLeft aria-hidden="true" />{note.wiki.spaceTitle}</Link><header className="wiki-heading"><WikiActionMenu actions={menuActions}><div>{note.home.kind === "board" && note.home.boardTitle !== note.wiki.spaceTitle ? <p className="wiki-eyebrow">{note.home.boardTitle}</p> : null}{canMutate && !note.deletedAt && !history ? <WikiTitle value={local.title} disabled={!editable} onChange={title => { setLocal(current => ({ ...current, title })); drafts.edit(note.id, note.contentVersion, { title }); }} /> : <h1>{local.title || note.displayTitle}</h1>}<p className="wiki-muted wiki-attribution">Updated by {note.updatedByDisplayName || "Former user"} · <time dateTime={note.updatedAt} title={note.updatedAt}><UpdatedTime date={note.updatedAt} /></time></p></div></WikiActionMenu></header>
    <WikiPageTopicsControl key={`${note.id}:${note.wiki.spaceId}`} noteId={note.id} spaceId={note.wiki.spaceId} spaceSlug={note.wiki.spaceSlug} canEdit={canMutate && !note.deletedAt} canManage={note.wiki.canManage} />
    {note.wiki.spaceArchived ? <p className="wiki-banner">Archived space · Read only</p> : !note.canEdit ? <p className="wiki-banner">Read only</p> : null}{note.deletedAt ? <p className="wiki-banner">In trash. Scheduled for permanent deletion {note.purgeAfterAt?.slice(0, 10)}. Restore the page to edit it.</p> : null}
    <div className="wiki-save-status" data-save-state={status} role="status">{status === "pending" ? "Unsaved edits" : status === "saving" ? "Saving…" : status === "error" ? "Save failed — your text is kept" : status === "conflict" ? "Conflicting edits — your text is kept" : "Saved"}</div>
    {recovery ? <div className="wiki-banner" role="status">Your unsaved edits are retained. {canMutate ? <WikiButton disabled={busy} onClick={() => void drafts.saveNote(note.id)}>Save pending edits</WikiButton> : <span>Editing is paused until this page is writable again.</span>}</div> : null}
    {status === "conflict" || status === "error" || error || actions.error ? <div className="wiki-banner" role="alert">{error || actions.error || "Your edits have not been saved."}<div className="wiki-actions"><WikiButton disabled={busy} onClick={() => void reload()}>Reload current page</WikiButton><WikiButton disabled={busy} onClick={() => view("history")}>Preview history</WikiButton>{status === "error" && canMutate ? <WikiButton onClick={() => void drafts.saveNote(note.id)}>Retry save</WikiButton> : null}</div></div> : null}
    {history ? <WikiHistory key={`${note.id}:${generation}`} noteId={note.id} spaceId={note.wiki.spaceId} versionId={versionId} canRestore={canMutate && !note.deletedAt} busy={busy} onSelect={id => view("history", id)} onRestore={version => void restoreVersion(version)} onClose={() => view("read")} /> : (canMutate || (initialNote.canEdit && !initialNote.wiki.spaceArchived && isWikiDocumentSupported(note.content, note.contentFormatVersion, inventory))) && !note.deletedAt ? <section className="wiki-edit" aria-label="Edit page"><NoteEditor key={`${note.id}:${generation}`} initialBlocks={local.content} contentFormatVersion={note.contentFormatVersion} wikiContext={{ spaceId: note.wiki.spaceId, noteId: note.id }} editable={editable} onChange={content => { if (!editable || drafts.isBlocked(note.id)) return; setLocal(current => ({ ...current, content: content.blocks })); drafts.edit(note.id, note.contentVersion, { content: { ...content, formatVersion: 2 } }); }} uploadFile={editable ? uploadInline : undefined} /></section> : <WikiReader content={local.content} format={note.contentFormatVersion} wikiContext={{ spaceId: note.wiki.spaceId, noteId: note.id }} />}
    {actions.controls}
    <WikiFiles noteId={note.id} files={note.attachments} canEdit={editable} canManage={canMutate && note.wiki.canManage && !note.deletedAt} busy={busy} onUpload={file => void run(async () => { const files = await uploadNoteAttachmentRequest(note.id, file); setNote(current => ({ ...current, attachments: files })); })} onRemove={(id, permanent) => void run(async () => { await deleteNoteAttachmentRequest(note.id, id, { permanent }); setNote(current => ({ ...current, attachments: current.attachments.filter(file => file.id !== id) })); })} />
    <WikiBacklinks key={note.id} noteId={note.id} /><section className="wiki-task-links"><h2><ListTodo aria-hidden="true" />Linked tasks</h2>{!note.linkedTasks.length ? <p className="wiki-muted">No linked tasks. Use Notes to manage task links.</p> : <ul>{note.linkedTasks.map(task => <li key={task.id}><Link href={`/?boardId=${task.boardId}&taskId=${task.id}`}>{task.title} · {task.boardTitle}</Link></li>)}</ul>}<Link href={`/notes?note=${note.id}`}>Open Notes details</Link></section>{dialog}</article>;
}

function UpdatedTime({ date }: { date: string }) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { const first = setTimeout(() => setNow(Date.now()), 0); const timer = setInterval(() => setNow(Date.now()), 60_000); return () => { clearTimeout(first); clearInterval(timer); }; }, []);
  if (now === null) return date.slice(0, 10);
  const minutes = Math.max(0, Math.floor((now - new Date(date).getTime()) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)} hr ago`;
  const days = Math.floor(minutes / 1440); return `${days} ${days === 1 ? "day" : "days"} ago`;
}
