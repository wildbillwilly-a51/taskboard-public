"use client";

import { useState, type FormEvent, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import {
  resolveLocalWork, saveLocalWork, workKey,
  type LocalWorkItem, type OfflineWorkState,
} from "@/lib/offline-work-client";
import { offlineTaskStatuses, type OfflineWorkItem, type OfflineWorkPatch } from "@/lib/offline-work-model";
import styles from "./offline-notes.module.css";

function shown(item: LocalWorkItem): OfflineWorkItem {
  return { ...item.server,...item.draft?.patch };
}

function localTime(value: string | null) {
  if (!value) return "";
  const time = new Date(value);
  return new Date(time.getTime()-time.getTimezoneOffset()*60_000).toISOString().slice(0,16);
}

function subtitle(item: OfflineWorkItem) {
  if (item.kind === "event") {
    const date = new Date(item.startAt);
    return item.allDay ? date.toLocaleDateString() + " · All day" : date.toLocaleString();
  }
  return [item.bucket ?? item.boardTitle,offlineTaskStatuses[item.status],
    item.dueAt ? "Due " + new Date(item.dueAt).toLocaleString() : null].filter(Boolean).join(" · ");
}

function formPatch(form: HTMLFormElement, item: OfflineWorkItem): OfflineWorkPatch {
  const values = new FormData(form);
  const text = (name: string) => String(values.get(name) ?? "");
  const date = (name: string, original: string | null) => {
    const value = text(name);
    return value === localTime(original) ? original : value ? new Date(value).toISOString() : null;
  };
  const title = text("title").trim();
  if (!title) throw new Error("Enter a title.");
  const patch: OfflineWorkPatch = title === item.title ? {} : { title };
  if (item.kind === "task") {
    const status = text("status") as typeof item.status;
    if (status !== item.status) patch.status = status;
    if (!item.subtask) {
      const dueAt = date("dueAt",item.dueAt);
      if (dueAt !== item.dueAt) patch.dueAt = dueAt;
    }
  } else {
    const startAt = date("startAt",item.startAt);
    const endAt = date("endAt",item.endAt);
    if (!startAt || !endAt || Date.parse(endAt) <= Date.parse(startAt))
      throw new Error("The event end must be after the start.");
    if (startAt !== item.startAt) patch.startAt = startAt;
    if (endAt !== item.endAt) patch.endAt = endAt;
  }
  return patch;
}

export function OfflineWorkPanel({ mode, local, syncDisabled, onSync, onSaved, onEditing, children }: {
  mode: "task" | "event";
  local: OfflineWorkState | null;
  syncDisabled: boolean;
  onSync: () => void;
  onSaved: (state: OfflineWorkState | null) => void;
  onEditing: (editing: boolean) => void;
  children: ReactNode;
}) {
  const [saving,setSaving] = useState(false);
  const [editError,setEditError] = useState("");
  const [editing,setEditing] = useState<LocalWorkItem | null>(null);
  const [query,setQuery] = useState("");

  function edit(item: LocalWorkItem | null) {
    setEditError("");
    setEditing(item);
    onEditing(Boolean(item));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!local || !editing || saving) return;
    setSaving(true);
    try {
      const patch = formPatch(event.currentTarget,shown(editing));
      if (Object.keys(patch).length) onSaved(await saveLocalWork(local.ownerId,editing,patch));
      edit(null);
      onSync();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Could not save this edit.");
    } finally {
      setSaving(false);
    }
  }

  async function resolve(item: LocalWorkItem, apply: boolean) {
    if (!local || saving) return;
    setSaving(true);
    setEditError("");
    try {
      onSaved(await resolveLocalWork(local.ownerId,item,apply));
      edit(null);
      if (apply) onSync();
    } catch (error) {
      setEditError(error instanceof Error ? error.message : "Could not resolve this edit.");
    } finally {
      setSaving(false);
    }
  }

  const title = mode === "task" ? "Personal Board" : "Personal Calendar";
  const visible = (local?.items ?? []).filter((item) => item.server.kind === mode);
  const displayed = editing && shown(editing);
  const review = editing && local?.items.find((item) => workKey(item) === workKey(editing));
  const needle = query.trim().toLowerCase();

  return <section className={styles.workPanel} aria-label={title}>
    {children}
    <header className="notes-pane-header">
      <h1 className="notes-pane-title">{title}</h1>
      <button className="notes-icon-button" type="button" aria-label="Sync now" disabled={syncDisabled}
        onClick={onSync}><RefreshCw size={16} /></button>
    </header>
    {displayed ? editing?.conflict && review ? (
      <article className="calendar-entry-form calendar-entry-form--sidebar">
        <div className="calendar-entry-form__header"><h2>Review offline edit</h2></div>
        <p role="alert">{review.conflict}</p>
        <p>Your edit: {displayed.title} · {subtitle(displayed)}</p>
        {review.serverCopy ? <p>On the server: {review.serverCopy.title} · {subtitle(review.serverCopy)}</p> : null}
        <div className="calendar-entry-form__actions">
          <button className="calendar-entry-form__secondary" type="button" onClick={() => edit(null)}>Close</button>
          <button className="calendar-entry-form__secondary" type="button" disabled={saving} onClick={() => void resolve(review,false)}>
            {review.serverCopy ? "Use server version" : "Discard local edit"}
          </button>
          {review.serverCopy ? <button className="calendar-entry-form__primary" type="button" disabled={saving}
            onClick={() => void resolve(review,true)}>Apply my edit</button> : null}
        </div>
        {editError ? <p className="calendar-entry-form__error" role="alert">{editError}</p> : null}
      </article>
    ) : <form key={displayed.id} className="calendar-entry-form calendar-entry-form--sidebar" onSubmit={save}>
      <div className="calendar-entry-form__header"><h2>{displayed.kind === "task" ? "Edit task" : "Edit event"}</h2></div>
      <div className="calendar-entry-form__grid">
        <label className="calendar-entry-form__wide">Title
          <input name="title" required maxLength={500} defaultValue={displayed.title} />
        </label>
        {displayed.kind === "task" ? <>
          <label>Status
            <select name="status" aria-label="Status" defaultValue={displayed.status}>
              {Object.entries(offlineTaskStatuses).filter(([id]) => !displayed.subtask || id === "todo" || id === "done")
                .map(([id,label]) => <option key={id} value={id}>{label}</option>)}
            </select>
          </label>
          {!displayed.subtask ? <label>Due date<input name="dueAt" type="datetime-local"
            defaultValue={localTime(displayed.dueAt)} /></label> : null}
        </> : <>
          <label>Start<input name="startAt" type="datetime-local" required defaultValue={localTime(displayed.startAt)} /></label>
          <label>End<input name="endAt" type="datetime-local" required defaultValue={localTime(displayed.endAt)} /></label>
        </>}
      </div>
      {editError ? <p className="calendar-entry-form__error" role="alert">{editError}</p> : null}
      <div className="calendar-entry-form__actions">
        <button className="calendar-entry-form__secondary" type="button" disabled={saving} onClick={() => edit(null)}>Cancel</button>
        <button className="calendar-entry-form__primary" type="submit" disabled={saving}>Save</button>
      </div>
    </form> : <>
      <div className={styles.search}><input type="search" className="ed-field" aria-label={`Search ${title}`}
        placeholder="Search" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <div className="notes-list pretty-scrollbar">
        {visible.filter((item) => shown(item).title.toLowerCase().includes(needle)).map((item) => {
          const record = shown(item);
          return <button key={workKey(item)} className="notes-list-item" type="button" onClick={() => edit(item)}>
            <span className="notes-list-title">{record.title}</span>
            <span className="notes-list-snippet">{item.conflict ? "Needs review" : item.draft ? "Waiting to sync" : subtitle(record)}</span>
          </button>;
        })}
        {!visible.length ? <p className="notes-empty">{local ? "Nothing to show." : "Connect to download your Board and Calendar."}</p> : null}
      </div>
    </>}
  </section>;
}
