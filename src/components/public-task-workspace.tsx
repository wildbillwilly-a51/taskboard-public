"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { TaskWorkspaceLayout, useTaskWorkspace } from "@/components/task-workspace-layout";
import { WorkBreakdown } from "@/components/task-work-breakdown";
import { SafeLinkifiedText } from "@/components/safe-linkified-text";
import { formatItemSpan } from "@/lib/work-windows";
import { type PublicTaskWorkspace, type SharedNote } from "@/lib/public-task-share-model";
import "./public-task-workspace.css";
import { SharedWorkSection, SharedWorkingNotes, useSharedTaskEditing } from "./shared-task-work-editor";
const PublicNoteBody = dynamic(() => import("@/components/public-note-body"), { ssr: false, loading: () => <p className="work-muted">Loading note…</p> });
import { PublicTaskFiles as FileList } from "./public-task-files";
const noop = () => { };
const button = "work-button inline-flex items-center gap-1";
function SharedNotes({ notes, token }: {
    notes: SharedNote[];
    token: string;
}) {
    const { setNotesCount } = useTaskWorkspace();
    const [selected, setSelected] = useState<string | null>(null);
    useEffect(() => setNotesCount(notes.length), [notes.length, setNotesCount]);
    const note = notes.find(n => n.id === selected) || notes[0];
    return <section className="task-embedded-notes" data-testid="public-linked-notes">
    <div className="task-note-tools"><select aria-label="Choose linked note" value={note?.id || ""} onChange={e => setSelected(e.target.value)} disabled={!notes.length}>
      {!notes.length ? <option value="">No shared notes</option> : notes.map(n => <option key={n.id} value={n.id}>{n.title}</option>)}
    </select></div>
    {note ? <div className="task-note-document"><h2 className="task-note-title ed-title">{note.title}</h2><PublicNoteBody key={note.id} content={note.content}/>{note.attachments.length ? <FileList files={note.attachments} token={token}/> : null}</div> : <p className="work-muted">No linked notes are included in this share.</p>}
  </section>;
}
export function PublicTaskWorkspaceView({ token }: {
    token: string;
}) {
    const [data, setData] = useState<PublicTaskWorkspace | null>(null);
    const [message, setMessage] = useState("Loading shared workspace…");
    const [expandedNotes, setExpandedNotes] = useState<Record<string, boolean>>({});
    const editing = useSharedTaskEditing(token, data, setData, setMessage);
    const { pauseRef, epoch } = editing;
    const refreshNow = useRef<() => void>(() => {});
    useEffect(() => {
        let disposed = false, unavailable = false, inFlight = false, generation = 0;
        let controller: AbortController | null = null, etag = "", failures = 0, nextAttempt = 0;
        const refresh = async () => {
            if (disposed || unavailable || inFlight || document.visibilityState === "hidden" || Date.now() < nextAttempt)
                return;
            inFlight = true;
            const attempt = ++generation;
            const editEpoch = epoch.current;
            controller = new AbortController();
            try {
                const response = await fetch(`/share/task/${encodeURIComponent(token)}/data`, { signal: controller.signal, credentials: "omit", cache: "no-store", headers: etag ? { "If-None-Match": etag } : {} });
                if (disposed || attempt !== generation)
                    return;
                if (response.status === 404) {
                    unavailable = true;
                    etag = "";
                    setData(null);
                    setMessage("This shared workspace is unavailable.");
                    return;
                }
                if (epoch.current !== editEpoch) return;
                if (response.status === 304) {
                    setMessage("");
                    failures = 0;
                    return;
                }
                if (!response.ok)
                    throw new Error("Request failed");
                const latest: PublicTaskWorkspace = await response.json();
                if (disposed || attempt !== generation || unavailable || epoch.current !== editEpoch || pauseRef.current)
                    return;
                etag = response.headers.get("etag") || "";
                setData(current => current?.revision === latest.revision ? current : latest);
                setMessage("");
                failures = 0;
            }
            catch (error) {
                if (!disposed && !(error instanceof Error && error.name === "AbortError")) {
                    setMessage("Updates are temporarily unavailable. Retrying…");
                    nextAttempt = Date.now() + Math.min(120000, 30000 * ++failures);
                }
            }
            finally {
                inFlight = false;
            }
        };
        void refresh();
        // Matches the ~10 s live-update target of the signed-in board views.
        const interval = setInterval(() => void refresh(), 10000);
        const resume = () => { nextAttempt = 0; void refresh(); };
        refreshNow.current = resume;
        window.addEventListener("focus", resume);
        document.addEventListener("visibilitychange", resume);
        return () => { disposed = true; ++generation; controller?.abort(); clearInterval(interval); window.removeEventListener("focus", resume); document.removeEventListener("visibilitychange", resume); };
    }, [token, pauseRef, epoch]);
    useEffect(() => {
        const expiry = data?.sharing?.expiresAt;
        if (!expiry) return;
        let timer: ReturnType<typeof setTimeout>;
        const check = () => {
            const remaining = Date.parse(expiry) - Date.now();
            if (remaining <= 0) { refreshNow.current(); return; }
            timer = setTimeout(check, Math.min(remaining, 2147483647));
        };
        check();
        return () => clearTimeout(timer);
    }, [data?.sharing?.expiresAt]);
    const task = data?.task;
    if (!data || !task)
        return <main className="taskboard-shell public-task-workspace public-share-state" role="status">{message}</main>;
    const canEditWork = data.sharing?.mode === "edit_work";
    const date = (value: string | undefined) => value ? new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: data.timeZone }).format(new Date(value)) : "Not set";
    return <main className="taskboard-shell public-task-workspace" data-editor-scale="true" data-testid="public-task-workspace">
    <div className="taskboard-task-workspace-panel panel-surface panel-strong relative flex h-full min-h-0 flex-col overflow-hidden rounded-[8px] border">
      <div className="task-editor-root flex h-full min-h-0 flex-col" data-editor-mode="expanded" data-testid="task-editor-expanded">
        <header className="task-workspace-header border-b border-border/70"><div className="workspace-header-row">
          <div className="workspace-title-field"><h1 className="workspace-title-text ed-title">{task.title}</h1></div>
          <div className="workspace-seg workspace-status-seg" role="group" aria-label="Task status">{(["active", "todo", "waiting", "done"] as const).map(status => <button key={status} type="button" disabled data-status={status} aria-pressed={task.status === status}><span className="workspace-status-dot"/>{status === "todo" ? "Todo" : status[0].toUpperCase() + status.slice(1)}</button>)}</div>
          <span className="workspace-status-select" role="status">{task.status === "todo" ? "Todo" : task.status[0].toUpperCase() + task.status.slice(1)}</span>
          <div className="workspace-chips">
            {data.bucketTitle ? <span className="workspace-chip">{data.bucketTitle}</span> : null}
            <span className="workspace-chip tabular-nums" data-testid="task-workspace-date-chip">{task.startAt && task.endAt ? `${formatItemSpan(task, { timeZone: data.timeZone })} · ` : ""}{data.timeZone}</span>
            <span className="workspace-chip" data-tone="muted">{canEditWork ? "Can edit Work" : "Read only"}</span>
          </div>
        </div>{message ? <p className="work-muted" role="status">{message}</p> : null}{canEditWork ? <div className="px-2 py-1 ed-body"><p className="work-muted">Work edits are recorded as Shared link editor. People reports show the name you choose.</p>{editing.busy ? <p role="status">Saving…</p> : null}{editing.error ? <div role="alert" className="ui-danger-banner mt-1 rounded border p-2"><p>{editing.error}</p><button type="button" className="work-button mt-1" disabled={editing.busy} onClick={() => void editing.loadLatest()}>Load latest work</button></div> : null}{editing.unsavedText ? <label className="mt-1 block work-muted">Unsaved text<textarea readOnly className="work-input mt-1 max-h-[100px] w-full" value={editing.unsavedText}/></label> : null}</div> : null}</header>
        <div className="task-workspace-body min-h-0 flex flex-1 flex-col overflow-hidden">
          <TaskWorkspaceLayout work={canEditWork ? <SharedWorkSection task={task} timeZone={data.timeZone} editing={editing} peopleEndpoint={`/share/task/${encodeURIComponent(token)}/people`}/> : <WorkBreakdown task={task} peopleEndpoint={`/share/task/${encodeURIComponent(token)}/people`} canEdit={false} timeZone={data.timeZone} onSaveTask={noop} onDeleteTask={noop} onAddSubtask={noop} checklistDetail={task.checklist.length ? `${task.checklist.filter(i => i.done).length} of ${task.checklist.length} done` : "None yet"} checklist={task.checklist.length ? <div className="space-y-1">{task.checklist.map(item => <div className="flex items-center gap-1" key={item.id}>
              <span className="work-checklist-target"><span role="checkbox" aria-checked={item.done} aria-disabled="true" aria-label={item.label} className={`work-checklist-toggle flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border ${item.done ? "border-emerald-600 bg-emerald-600 text-white" : "border-border text-transparent"}`}>{item.done ? <Check size={10}/> : null}</span></span>
              <span className={`min-w-0 flex-1 text-left ed-body ${item.done ? "text-muted line-through" : "text-foreground"}`}>{item.label}</span>
            </div>)}</div> : <p className="work-muted">No checklist items yet.</p>}/>} workingNotes={canEditWork ? <SharedWorkingNotes data={data} token={token} editing={editing}/> : <section className="task-working-notes-canvas min-h-0" data-testid="public-working-notes"><h2 className="work-section-label mb-2">Working notes</h2><div className="task-working-notes-stream pretty-scrollbar"><div className="space-y-2">
              {task.notes.map(note => <article key={note.id} className="rounded-[10px] border border-border/70 px-2.5 py-2.5"><div className="mb-2"><p className="ed-strong">{note.authorName}</p><p className="work-muted">{date(note.createdAt)}{note.updatedAt ? ` · Edited ${date(note.updatedAt)}` : ""}</p></div>
                <p className={`whitespace-pre-wrap pr-1 ed-body ${expandedNotes[note.id] ? "" : "max-h-[400px] overflow-y-auto"}`}><SafeLinkifiedText text={note.body}/></p>
                {note.body.length > 500 ? <button type="button" className={button} aria-expanded={!!expandedNotes[note.id]} onClick={() => setExpandedNotes(current => ({ ...current, [note.id]: !current[note.id] }))}><ChevronDown size={12}/>{expandedNotes[note.id] ? "Collapse" : "Expand"}</button> : null}
                {note.attachments.length ? <div className="mt-2"><FileList token={token} files={data.files.filter(f => note.attachments.some(a => a.id === f.id))}/></div> : null}
              </article>)}{!task.notes.length ? <p className="work-muted">No working notes yet.</p> : null}
            </div></div></section>} notes={<SharedNotes notes={data.notes} token={token}/>} files={<section className="grid min-w-0 gap-1.5"><h2 className="work-section-label">Files</h2><FileList files={data.files} token={token}/></section>} details={<div className="grid gap-3 ed-body"><section><h2 className="work-section-label mb-1">Description</h2><p className="whitespace-pre-wrap"><SafeLinkifiedText text={task.primaryNote?.body || task.summary || "No description."}/></p></section>
              {data.bucketTitle ? <section><h2 className="work-section-label">Bucket</h2><p>{data.bucketTitle}</p></section> : null}
              <section><h2 className="work-section-label mb-1">Schedule</h2><p>Start: {date(task.startAt)}</p><p>End: {date(task.endAt)}</p>{task.allDay ? <p>All day</p> : null}<p>Due: {date(task.dueAt)}</p></section>
              {task.recurrence ? <section><h2 className="work-section-label">Recurrence</h2><p>Every {task.recurrence.interval} {task.recurrence.frequency}</p></section> : null}
              {task.nextAction ? <section><h2 className="work-section-label">Next action</h2><p className="whitespace-pre-wrap"><SafeLinkifiedText text={task.nextAction}/></p></section> : null}
              {task.reminderConfig ? <section><h2 className="work-section-label">Reminders</h2><p>{task.reminderConfig.reminderOffsetMinutes === null ? "No scheduled reminder" : `${task.reminderConfig.reminderOffsetMinutes} minutes before start`}</p>{task.reminderConfig.overdueReminderEnabled ? <p>Overdue reminder enabled</p> : null}</section> : null}
              {task.maintenanceOutage ? <section><h2 className="work-section-label">Outage</h2><p>Location: {task.maintenanceOutage.locationName || "None"}</p><p>Owner: {task.maintenanceOutage.owner || "Not set"}</p><p>Attendees: {task.maintenanceOutage.attendees.join(", ") || "None"}</p></section> : null}
              {task.labels.length ? <section><h2 className="work-section-label">Labels</h2><p>{task.labels.join(", ")}</p></section> : null}
            </div>} notesCount={task.notes.length} filesCount={data.files.length}/>
        </div>
      </div>
    </div>
  </main>;
}
