"use client";
import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { WorkBreakdown } from "./task-work-breakdown";
import { PublicTaskFiles } from "./public-task-files";
import { SafeLinkifiedText } from "./safe-linkified-text";
import type { Task, TaskNote } from "@/lib/taskboard-data";
import type { PublicTaskWorkspace, SharedWorkChange } from "@/lib/public-task-share-model";

const button = "work-button";
const textOf = (change: SharedWorkChange) => "body" in change ? change.body : "title" in change ? change.title : change.type === "subtask.update" ? change.patch.title || "" : "label" in change ? change.label || "" : "";

export function useSharedTaskEditing(token: string, data: PublicTaskWorkspace | null, setData: Dispatch<SetStateAction<PublicTaskWorkspace | null>>, setMessage: Dispatch<SetStateAction<string>>) {
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [unsavedText, setUnsavedText] = useState("");
  const latest = useRef(data), pauseRef = useRef(false), epoch = useRef(0), drafts = useRef(new Set<string>());
  const pending = useRef(0), tail = useRef(Promise.resolve()), revisions = useRef(new Map<string, string>()), retries = useRef(new Map<string, string>());
  useEffect(() => { latest.current = data; }, [data]);
  const updatePause = useCallback((focus?: boolean) => {
    const active = document.activeElement;
    const textFocus = focus ?? ((active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) && !!active.closest("[data-shared-work-editor]"));
    pauseRef.current = !!pending.current || textFocus || !!drafts.current.size;
  }, []);
  const setFocus = useCallback((value: boolean) => { updatePause(value); }, [updatePause]);
  const setDraft = useCallback((key: string, value: boolean) => { if (value) drafts.current.add(key); else drafts.current.delete(key); updatePause(); }, [updatePause]);
  const unavailable = useCallback(() => { latest.current = null; setData(null); setMessage("This shared workspace is unavailable."); }, [setData, setMessage]);
  const mutate = useCallback((change: SharedWorkChange): Promise<boolean> => {
    const base = latest.current?.sharing?.editRevision;
    if (!base) return Promise.resolve(false);
    const key = JSON.stringify(change), mutationId = retries.current.get(key) || crypto.randomUUID();
    retries.current.set(key, mutationId);
    pending.current++; epoch.current++; updatePause(); setBusy(true);
    const job = async () => {
      try {
        let editRevision = base;
        const visited = new Set<string>();
        while (revisions.current.has(editRevision) && !visited.has(editRevision)) { visited.add(editRevision); editRevision = revisions.current.get(editRevision)!; }
        const response = await fetch(`/share/task/${encodeURIComponent(token)}/changes`, { method: "POST", credentials: "omit", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mutationId, editRevision, change }) });
        if (response.status === 404) { unavailable(); return false; }
        const result: PublicTaskWorkspace & { error?: string } = await response.json();
        if (!response.ok) throw new Error(result.error || "Unable to save work.");
        if (result.appliedEditRevision === result.sharing?.editRevision) revisions.current.set(editRevision, result.appliedEditRevision!);
        latest.current = result; setData(result); retries.current.delete(key); setError(""); setUnsavedText("");
        return true;
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Unable to save work. Try again.");
        setUnsavedText(previous => textOf(change) || previous);
        return false;
      } finally {
        pending.current--; updatePause();
        if (!pending.current) { setBusy(false); revisions.current.clear(); }
      }
    };
    const operation = tail.current.then(job, job);
    tail.current = operation.then(() => {}, () => {});
    return operation;
  }, [setData, token, unavailable, updatePause]);
  const loadLatest = useCallback(async () => {
    const refreshEpoch = ++epoch.current;
    try {
      const response = await fetch(`/share/task/${encodeURIComponent(token)}/data`, { credentials: "omit", cache: "no-store" });
      if (response.status === 404) { unavailable(); return; }
      if (!response.ok) throw new Error("Unable to load the latest work.");
      const result: PublicTaskWorkspace = await response.json();
      if (epoch.current !== refreshEpoch) return;
      latest.current = result; setData(result); revisions.current.clear(); setError("");
    } catch (reason) { if (epoch.current === refreshEpoch) setError(reason instanceof Error ? reason.message : "Unable to load work."); }
  }, [setData, token, unavailable]);
  return { mutate, busy, error, unsavedText, loadLatest, pauseRef, epoch, setFocus, setDraft };
}
type Editing = ReturnType<typeof useSharedTaskEditing>;

function ChecklistRow({ item, editing }: { item: Task["checklist"][number]; editing: Editing }) {
  const [draft, setDraft] = useState<string | null>(null);
  const setDraftActivity = editing.setDraft;
  useEffect(() => {
    setDraftActivity(`checklist:${item.id}`, draft !== null);
    return () => setDraftActivity(`checklist:${item.id}`, false);
  }, [draft, item.id, setDraftActivity]);
  const save = async () => {
    if (draft === null) return;
    if (draft.trim() === item.label || await editing.mutate({ type: "checklist.update", itemId: item.id, label: draft })) setDraft(null);
  };
  return <div className="flex flex-wrap items-center gap-2 ed-body">
    <span className="work-checklist-target"><input type="checkbox" className="work-checklist-toggle" aria-label={`Complete ${item.label}`} checked={item.done} onChange={() => void editing.mutate({ type: "checklist.update", itemId: item.id, done: !item.done })}/></span>
    {draft === null ? <button type="button" className={`min-w-0 flex-1 text-left ${item.done ? "line-through work-muted" : ""}`} onClick={() => setDraft(item.label)}>{item.label}</button> : <><input className="work-input min-w-0 flex-1" aria-label="Checklist text" autoFocus value={draft} onChange={event => setDraft(event.target.value)} onBlur={() => void save()} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); void save(); } if (event.key === "Escape") { event.stopPropagation(); setDraft(null); } }}/><button type="button" className={button} onPointerDown={event => event.preventDefault()} onClick={() => setDraft(null)}>Cancel</button></>}
    <button type="button" className={button} aria-label={`Remove checklist item ${item.label}`} onClick={() => void editing.mutate({ type: "checklist.remove", itemId: item.id })}>Remove</button>
  </div>;
}

export function SharedWorkSection({ task, timeZone, editing, peopleEndpoint }: { task: Task; timeZone: string; editing: Editing; peopleEndpoint: string }) {
  const [label, setLabel] = useState("");
  const setDraft = editing.setDraft;
  const add = async () => { if (label.trim() && await editing.mutate({ type: "checklist.add", label })) { setLabel(""); editing.setDraft("checklist", false); } };
  useEffect(() => () => setDraft("checklist", false), [setDraft]);
  return <fieldset data-shared-work-editor disabled={editing.busy} className="m-0 min-w-0 border-0 p-0" onFocusCapture={event => editing.setFocus(event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) editing.setFocus(false); }}>
    <WorkBreakdown task={task} canEdit timeZone={timeZone} peopleEndpoint={peopleEndpoint} onSaveTask={(taskId, patch) => editing.mutate({ type: "subtask.update", taskId, patch })} onAddSubtask={(parentTaskId, title) => editing.mutate({ type: "subtask.add", parentTaskId, title })} onMoveSubtask={move => editing.mutate({ type: "subtask.move", ...move })}
      checklistDetail={`${task.checklist.filter(item => item.done).length} of ${task.checklist.length} done`}
      checklist={<div className="grid gap-2">{task.checklist.map(item => <ChecklistRow key={item.id} item={item} editing={editing}/>)}<form className="flex gap-2" onSubmit={event => { event.preventDefault(); void add(); }}><input className="work-input min-w-0 flex-1" aria-label="Add checklist item" value={label} onChange={event => { setLabel(event.target.value); editing.setDraft("checklist", !!event.target.value); }}/><button type="submit" className={button} disabled={!label.trim()}>Add</button></form></div>}/>
  </fieldset>;
}

function WorkingNote({ note, data, token, editing }: { note: TaskNote; data: PublicTaskWorkspace; token: string; editing: Editing }) {
  const [draft, setDraft] = useState<string | null>(null), [remove, setRemove] = useState(false), [expanded, setExpanded] = useState(false);
  const allowed = data.sharing?.editableNoteIds?.includes(note.id);
  const setDraftActivity = editing.setDraft;
  useEffect(() => () => setDraftActivity(`note:${note.id}`, false), [note.id, setDraftActivity]);
  const date = (value: string) => new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: data.timeZone }).format(new Date(value));
  const cancel = () => { setDraft(null); editing.setDraft(`note:${note.id}`, false); };
  const save = async () => { if (draft !== null && await editing.mutate({ type: "note.update", noteId: note.id, body: draft })) cancel(); };
  return <article className="rounded-[10px] border border-border/70 px-2.5 py-2.5">
    <div className="mb-2"><p className="ed-strong">{note.authorName}</p><p className="work-muted">{date(note.createdAt)}{note.updatedAt ? ` · Edited ${date(note.updatedAt)}${note.editorName ? ` by ${note.editorName}` : ""}` : ""}</p></div>
    {draft !== null ? <div className="grid gap-2"><textarea className="work-input min-h-[140px] w-full ed-body" aria-label="Edit working note" value={draft} onChange={event => setDraft(event.target.value)}/><details className="ed-body"><summary>Current saved note</summary><p className="whitespace-pre-wrap">{note.body}</p></details><div className="flex gap-2"><button type="button" className={button} onClick={() => void save()} disabled={!draft.trim()}>Save note</button><button type="button" className={button} onClick={cancel}>Cancel</button></div></div> : <><p className={`whitespace-pre-wrap ed-body ${expanded ? "" : "max-h-[400px] overflow-y-auto"}`}><SafeLinkifiedText text={note.body}/></p><div className="mt-2 flex flex-wrap gap-2">{allowed ? <button type="button" className={button} onClick={() => { setDraft(note.body); editing.setDraft(`note:${note.id}`, true); }}>Edit</button> : null}{allowed && !note.attachments.length ? <button type="button" className={button} onClick={() => setRemove(true)}>Remove</button> : null}{note.body.length > 500 ? <button type="button" className={button} onClick={() => setExpanded(current => !current)}>{expanded ? "Collapse" : "Expand"}</button> : null}</div></>}
    {remove ? <div className="mt-2 flex flex-wrap items-center gap-2 ed-body"><span>Remove this working note?</span><button type="button" className={button} onClick={() => void editing.mutate({ type: "note.remove", noteId: note.id })}>Confirm removal</button><button type="button" className={button} onClick={() => setRemove(false)}>Cancel</button></div> : null}
    {note.attachments.length ? <div className="mt-2"><PublicTaskFiles token={token} files={data.files.filter(file => note.attachments.some(attachment => attachment.id === file.id))}/></div> : null}
  </article>;
}

export function SharedWorkingNotes({ data, token, editing }: { data: PublicTaskWorkspace; token: string; editing: Editing }) {
  const [body, setBody] = useState("");
  const setDraft = editing.setDraft;
  useEffect(() => () => setDraft("new-note", false), [setDraft]);
  const post = async () => { if (body.trim() && await editing.mutate({ type: "note.add", body })) { setBody(""); setDraft("new-note", false); } };
  return <fieldset data-shared-work-editor disabled={editing.busy} className="task-working-notes-canvas m-0 min-h-0 min-w-0 border-0 p-0" onFocusCapture={event => editing.setFocus(event.target instanceof HTMLTextAreaElement)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) editing.setFocus(false); }}>
    <h2 className="work-section-label mb-2">Working notes</h2><form className="mb-3 grid gap-2" onSubmit={event => { event.preventDefault(); void post(); }}><label className="ed-strong" htmlFor="shared-working-note">Add working note</label><textarea id="shared-working-note" className="work-input min-h-[120px] w-full ed-body" value={body} onChange={event => { setBody(event.target.value); setDraft("new-note", !!event.target.value); }}/><button className={`${button} justify-self-start`} type="submit" disabled={!body.trim()}>Post note</button></form>
    <div className="task-working-notes-stream pretty-scrollbar"><div className="space-y-2">{data.task.notes.map(note => <WorkingNote key={note.id} note={note} data={data} token={token} editing={editing}/>)}{!data.task.notes.length ? <p className="work-muted">No working notes yet.</p> : null}</div></div>
  </fieldset>;
}
