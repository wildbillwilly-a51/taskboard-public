"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import {useRouter} from 'next/navigation';
import { Link2, Plus, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { canApplyLiveLoad, liveWriteGeneration, useLiveNotesToken, useLiveRefresh } from "@/components/use-live-board-revision";
import { useTaskWorkspace } from "@/components/task-workspace-layout";
import { usePopoverOutsideDismiss } from "@/components/use-modal-outside-dismiss";
import {
  buildNotesHref, fetchNote, fetchTaskLinkedNotes, getNoteAttachmentUrl, isNoteUnavailableError,
  linkNoteTaskRequest, unlinkNoteTaskRequest, uploadNoteAttachmentRequest,
} from "@/lib/notes-client";
import { getBlocksPlainText, maxNoteTitleLength, type NoteContentInput, type NoteDetail, type NoteSummary } from "@/lib/notes-model";
import { selectUploadedNoteFile } from "@/components/wiki/wiki-attachments";
import { isNewNoteDraftId, useNoteDrafts } from "./use-note-drafts";
import { useNoteFormatSupport, useWikiNoteAccess } from "./page-mention-access";
import { fetchFolioNotes, folioRequest } from "@/lib/folio-client";

const NoteEditor = dynamic(() => import("./note-editor"), { ssr: false, loading: () => <p className="work-muted">Loading editor…</p> });
type Props = { taskId: string; boardId: string; bucketId: string | null; canEdit: boolean; enabled: boolean };
const emptyContent: NoteContentInput = { blocks: [], markdown: "", text: "",formatVersion:2 };
const homeLabel = (note: NoteSummary) => note.folio ? note.folio.audience==='personal'?'Personal · Only you':'Shared · Folio' : note.home.kind === "personal" ? "Personal · Only you" : [note.home.boardTitle, note.home.bucketTitle].filter(Boolean).join(" · ");

export function TaskLinkedNotes(props: Props) {
  return props.enabled ? <TaskNotesEditor key={props.taskId} {...props} /> : null;
}

function TaskNotesEditor({ taskId, boardId, canEdit }: Props) {
  const router=useRouter();
  const { active, setNotesCount, beforeLeaveNotes } = useTaskWorkspace();
  const [notes, setNotes] = useState<NoteSummary[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const loadedRef = useRef<string | null>(null);
  const [detail, setDetail] = useState<NoteDetail | null>(null);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState<NoteContentInput>(emptyContent);
  const [editorKey, setEditorKey] = useState(0);
  const [focusRequest, setFocusRequest] = useState(0);
  const titleRef = useRef<HTMLTextAreaElement>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [listReload, setListReload] = useState(0);
  const [picking, setPicking] = useState(false);
  const [query, setQuery] = useState("");
  const [candidates, setCandidates] = useState<NoteSummary[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const pickerButtonRef = useRef<HTMLButtonElement>(null);
  const closePicker = useCallback(() => {
    if (busy) return;
    setPicking(false);
    pickerButtonRef.current?.focus();
  }, [busy]);
  usePopoverOutsideDismiss(pickerRef, pickerButtonRef, closePicker, picking);
  const [phone, setPhone] = useState(false);
  const [formatting, setFormatting] = useState(false);
  const choose = (id: string | null) => { selectedRef.current = id; setSelected(id); };
  const upsert = (saved: NoteDetail | NoteSummary) => setNotes(current => [saved, ...(current ?? []).filter(note => note.id !== saved.id)]);
  const drafts = useNoteDrafts({
    onSaved: saved => {
      setNotes(current => current?.map(note => note.id === saved.id ? { ...note, title: saved.title, displayTitle: saved.displayTitle, snippet: saved.snippet, updatedAt: saved.updatedAt } : note) ?? null);
      setDetail(current => current?.id === saved.id ? { ...current, contentVersion: saved.contentVersion, updatedAt: saved.updatedAt } : current);
    },
    onCreated: (draftId, created) => {
      if (!created.linkedTasks.some(task => task.id === taskId)&&selectedRef.current!==draftId) return;
      if(created.linkedTasks.some(task=>task.id===taskId))upsert(created);
      if (selectedRef.current === draftId) {
        loadedRef.current = created.id;
        choose(created.id);
        setDetail(created);
        // Keep the mounted editor and its current text/cursor during creation.
      }
    },
  });
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => setPhone(media.matches);
    update();media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    fetchTaskLinkedNotes(taskId, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setNotes(result);
      if (!selectedRef.current) choose(result[0]?.id ?? null);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load linked notes."); });
    return () => { controller.abort(); const id = selectedRef.current; if (isNewNoteDraftId(id)) drafts.releaseNewNote(id); };
  }, [taskId, drafts, listReload]);
  useEffect(() => { setNotesCount(notes?.length ?? 0); }, [notes, setNotesCount]);
  // Notes changed elsewhere: reload the linked list, and the open note when
  // nothing is typed, sending or in conflict for it. Its text is replaced only
  // when its version moved; other changes (links, labels) are merged in. The
  // list is loaded here rather than by re-running the list effect, whose
  // cleanup lets go of an open new note.
  const detailRef = useRef(detail);
  useEffect(() => { detailRef.current = detail; }, [detail]);
  const liveNotesToken = useLiveNotesToken();
  useWikiNoteAccess(detail?.wiki ? detail.id : undefined, access => {
    setDetail(current => current && current.id === detail?.id ? { ...current, canEdit: access.canEdit, deletedAt: access.deletedAt, wiki: access.wiki ?? current.wiki } : current);
  });
  useLiveRefresh(liveNotesToken, useCallback(async (isCurrent: () => boolean) => {
    const id = selectedRef.current;
    const generation = liveWriteGeneration();
    const open = id && !isNewNoteDraftId(id) && loadedRef.current === id ? id : null;
    if (open && !drafts.isIdle(open)) return false;
    const [linked, opened] = await Promise.all([
      fetchTaskLinkedNotes(taskId),
      open ? fetchNote(open).then(note => ({ note }), (failure: unknown) => ({ failure })) : Promise.resolve(null),
    ]);
    if (!isCurrent() || !canApplyLiveLoad(generation) || (open && (selectedRef.current !== open || loadedRef.current !== open || !drafts.isIdle(open)))) return false;
    setNotes(linked);
    if (!open || !opened) return true;
    if ("failure" in opened) {
      // Gone or no longer shared: say so. Anything else is tried again.
      if (!isNoteUnavailableError(opened.failure)) throw opened.failure;
      setError(opened.failure instanceof Error ? opened.failure.message : "Unable to open the note.");
      return true;
    }
    const note = opened.note;
    if (note.contentVersion > (detailRef.current?.contentVersion ?? 0)) {
      drafts.register(note);
      setDetail(note);setTitle(note.title);
      setContent({ blocks: note.content, markdown: note.contentMarkdown, text: getBlocksPlainText(note.content) });
      setEditorKey(key => key + 1);
    } else {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { content: _content, contentMarkdown: _markdown, ...metadata } = note;
      setDetail(current => (current && current.id === open ? { ...current, ...metadata } : current));
    }
    return true;
  }, [drafts, taskId]));
  useEffect(() => {
    if (active !== "notes" || !selected || isNewNoteDraftId(selected) || loadedRef.current === selected) return;
    let cancelled = false;
    setLoading(true);setError("");
    fetchNote(selected).then(note => {
      if (cancelled || selectedRef.current !== note.id) return;
      const local = drafts.register(note);
      loadedRef.current = note.id;
      setDetail(note);setTitle(local?.title ?? note.title);
      setContent(local?.content ?? { blocks: note.content, markdown: note.contentMarkdown, text: getBlocksPlainText(note.content) });
      setEditorKey(key => key + 1);
    }).catch(reason => { if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to open the note."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [active, selected, reload, drafts]);
  useEffect(() => {
    const field = titleRef.current;if (!field || active !== "notes") return;
    const resize = () => { field.style.height = "auto";field.style.height = `${field.scrollHeight + 2}px`; };
    resize();const observer = new ResizeObserver(resize);observer.observe(field);
    return () => observer.disconnect();
  }, [title, active, selected]);
  useEffect(() => beforeLeaveNotes(() => {
    if (!isNewNoteDraftId(selected)) return;
    drafts.leaveNewNote(selected);
    if (!title && !content.text && drafts.newNoteStatus(selected) === "idle") {
      choose(notes?.[0]?.id ?? null);loadedRef.current = null;setDetail(null);
    }
  }), [beforeLeaveNotes, selected, title, content.text, notes, drafts]);
  useEffect(() => {
    if (!picking) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      fetchFolioNotes({kind:'search'},query.trim(),0,controller.signal).then(result => {
        if (!controller.signal.aborted) setCandidates(result.notes.filter(note => note.canEdit));
      }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to search notes."); })
        .finally(() => { if (!controller.signal.aborted) setSearching(false); });
    }, 200);
    return () => { window.clearTimeout(timer);controller.abort(); };
  }, [picking, query]);
  const leaveCurrent = () => { if (isNewNoteDraftId(selected)) drafts.leaveNewNote(selected); else if (selected) void drafts.saveNote(selected); };
  const selectNote = (id: string) => { if (selected === id) return;leaveCurrent();choose(id);setDetail(null);setFormatting(false);setError(""); };
  const newNote = () => {
    if (!canEdit) return;
    leaveCurrent();router.push(buildNotesHref({createNew:true,boardId,linkTaskId:taskId}));
  };
  const edit = (fields: { title?: string; content?: NoteContentInput }) => {
    const id = selectedRef.current;if (!id) return;
    if (isNewNoteDraftId(id)) drafts.editNewNote(id, fields);
    else if (detail?.id === id && detail.canEdit) drafts.edit(id, detail.contentVersion, fields);
  };
  const attach = async (id: string) => {
    setBusy(true);setError("");
    try {
      const candidate=candidates.find(n=>n.id===id)??detail;
      const target=(await folioRequest<{id:string}>({action:'taskTarget',taskId})).id;
      const linked=candidate?.folio?(await folioRequest<{note:NoteDetail}>({}, {action:'connect',noteId:id,spaceId:target,add:true})).note:await linkNoteTaskRequest(id,taskId);
      upsert(linked);selectNote(linked.id);setDetail(linked);setPicking(false);setQuery("");
    }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to attach the note."); }
    finally { setBusy(false); }
  };
  const unlink = async (reference=false) => {
    if (!detail || !canEdit || !detail.canEdit) return;
    setBusy(true);setError("");
    try {
      if (!(await drafts.saveNote(detail.id))) { setError("Save or resolve this note’s edits before removing its link.");return; }
      const connection=detail.folio?.connections.find(c=>c.taskId===taskId);
      if(connection&&!reference)await folioRequest({}, {action:'connect',noteId:detail.id,spaceId:connection.id,add:false});
      else await unlinkNoteTaskRequest(detail.id, taskId);
      const remaining = await fetchTaskLinkedNotes(taskId);
      setNotes(remaining);choose(remaining[0]?.id ?? null);setDetail(null);loadedRef.current = null;
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to remove the link."); }
    finally { setBusy(false); }
  };
  const retry = () => { if (isNewNoteDraftId(selected)) void drafts.createNewNote(selected);else if (selected) void drafts.saveNote(selected); };
  const reloadNote = () => { if (!selected || isNewNoteDraftId(selected)) return;drafts.forget(selected);loadedRef.current = null;setReload(value => value + 1); };
  const uploadFile = async (file: File) => {
    let id = selectedRef.current;
    if (isNewNoteDraftId(id)) id = (await drafts.createNewNote(id))?.id ?? null;
    if (!id) throw new Error("Save the note before adding a file.");
    const previous = detailRef.current?.id === id ? detailRef.current.attachments : [];
    const attachments = await uploadNoteAttachmentRequest(id, file);
    const attachment = selectUploadedNoteFile(previous, attachments, file);
    setDetail(current => current?.id === id ? { ...current, attachments } : current);
    if (!attachment) throw new Error("The file could not be attached.");
    return getNoteAttachmentUrl(id, attachment.id);
  };
  const draft = isNewNoteDraftId(selected);
  const supportedFormat = useNoteFormatSupport(content.blocks, detail?.contentFormatVersion ?? 1);
  const editable = supportedFormat && (draft ? canEdit : Boolean(detail?.canEdit && !detail.deletedAt && !detail.wiki?.spaceArchived && !drafts.isBlocked(detail.id)));
  const status = draft ? drafts.newNoteStatus(selected) : drafts.statusOf(selected);
  const loaded = Boolean(selected && (draft || detail?.id === selected));
  const saveLabel = status === "pending" ? "Unsaved edits" : status === "saving" ? "Saving…" : status === "error" ? "Save failed" : status === "conflict" ? "Conflicting edits" : draft ? "New draft" : "Saved";
  const options = (notes ?? []).filter(note => !note.deletedAt);
  const choices = candidates.filter(note => !options.some(linked => linked.id === note.id));
  const changeTitle = (event: FormEvent<HTMLTextAreaElement>) => { const value = event.currentTarget.value.replace(/\r?\n/g, " ");setTitle(value);edit({ title: value }); };
  return <section className="task-embedded-notes" data-testid="task-linked-notes">
    <div className="task-note-tools">
      <select aria-label="Choose linked note" value={phone ? "" : draft ? "draft" : selected ?? ""} onChange={event => { if (event.target.value && event.target.value !== "draft") selectNote(event.target.value); }} disabled={!notes || busy}>
        {phone || !selected ? <option value="">{notes === null ? "Loading notes…" : draft ? "New draft" : `${notes.length} linked notes`}</option> : null}
        {draft && !phone ? <option value="draft">New draft</option> : null}
        {options.map(note => <option key={note.id} value={note.id}>{note.displayTitle}</option>)}
      </select>
      {canEdit ? <button type="button" onClick={newNote} disabled={notes === null || busy} aria-label="New Folio note"><Plus aria-hidden="true" /><span>New note</span></button> : null}
      <button ref={pickerButtonRef} type="button" aria-label="Attach existing note" aria-expanded={picking} onClick={() => { if (picking) closePicker(); else setPicking(true);setError(""); }} disabled={!notes || busy}><Link2 aria-hidden="true" /><span>Attach existing</span></button>
      {phone && loaded && editable ? <button type="button" aria-label="Toggle note formatting" aria-expanded={formatting} onClick={() => setFormatting(value => !value)}>Aa</button> : null}
    </div>
    {error ? <div className="notes-error" role="alert">{error}{!loaded ? <button type="button" onClick={() => { setError("");if (notes === null) setListReload(value => value + 1);else setReload(value => value + 1); }}>Retry loading</button> : null}</div> : null}
    {picking ? <div ref={pickerRef} className="task-note-picker" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation();closePicker(); } }}>
      <div><span>Attach an existing note</span><button type="button" aria-label="Close note picker" disabled={busy} onClick={closePicker}><X aria-hidden="true" /></button></div>
      <input autoFocus aria-label="Search notes to link" placeholder="Search your notes…" value={query} onChange={event => setQuery(event.target.value)} />
      {searching ? <p className="work-muted">Searching…</p> : choices.length ? choices.slice(0, 8).map(note => <button type="button" key={note.id} disabled={busy} onClick={() => void attach(note.id)}><span>{note.displayTitle}<small>{homeLabel(note)}</small></span><span>Attach</span></button>) : <p className="work-muted">No matching notes.</p>}
    </div> : null}
    {!selected && notes !== null ? <p className="work-empty">No notes linked to this task. Create a note or attach an existing note above.</p> : null}
    {options.length || selected || draft ? <div className="task-note-grid">
      <aside className="task-note-list" aria-label="Linked notes">
        {options.map(note => <button key={note.id} type="button" aria-pressed={selected === note.id} onClick={() => selectNote(note.id)}>{note.displayTitle}<small>{homeLabel(note)}</small></button>)}
      </aside>
      <div className="task-note-editor">
        {loading ? <p className="work-muted" role="status">Loading note…</p> : null}
        {loaded ? <>
          <textarea ref={titleRef} aria-label="Note title" className="task-note-title ed-title" rows={1} placeholder="Untitled note" maxLength={maxNoteTitleLength} value={title} disabled={!editable} onChange={changeTitle}
            onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault();setFocusRequest(value => value + 1); } }} />
          <div className="task-note-info"><span>{detail ? homeLabel(detail) : "New note on this task’s board"}</span><span role="status">{editable ? saveLabel : "Read only"}</span></div>
          {status === "error" ? <div className="notes-error" role="alert">Your edits are retained. <button type="button" onClick={retry}>Retry save</button></div> : null}
          {status === "conflict" ? <div className="notes-error" role="alert">This note changed elsewhere. Your edits are retained. <button type="button" onClick={reloadNote}>Reload theirs</button><button type="button" onClick={() => selected && void drafts.keepMine(selected)}>Keep mine</button></div> : null}
          <NoteEditor key={editorKey} initialBlocks={content.blocks} editable={editable} onChange={next => { setContent(next);edit({ content: next }); }}
            contentFormatVersion={detail?.contentFormatVersion ?? (draft?2:1)} authenticatedMentions={Boolean(detail?.folio)} wikiContext={detail?.wiki ? { spaceId: detail.wiki.spaceId, noteId: detail.id } : undefined}
            uploadFile={editable ? uploadFile : undefined} focusRequest={focusRequest} mobile={phone} mobileFormatting={formatting} onCloseMobileFormatting={() => setFormatting(false)} />
          {!draft && detail ? <footer className="task-note-footer">
            <Link href={buildNotesHref({noteId:detail.id})} onClick={leaveCurrent}>Open in Folio ↗</Link>
            {canEdit&&detail.canEdit&&!detail.wiki?.spaceArchived?<>
              {detail.folio?.connections.some(c=>c.taskId===taskId)?<button type="button" disabled={busy} onClick={()=>void unlink()}>Disconnect task</button>:detail.folio?<button type="button" disabled={busy} onClick={()=>void attach(detail.id)}>Connect to this task</button>:null}
              {detail.taskReferenceIds?.includes(taskId)?<button type="button" disabled={busy} onClick={()=>void unlink(true)}>Remove reference</button>:null}
            </>:null}
          </footer> : null}
        </> : null}
      </div>
    </div> : null}
  </section>;
}
