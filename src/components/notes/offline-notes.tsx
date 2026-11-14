"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import { ArrowLeft, Plus, RefreshCw } from "lucide-react";
import { usePhoneViewport } from "@/components/use-phone-viewport";
import type { NoteEditorProps } from "@/components/notes/note-editor";
import { maxNoteTitleLength, type NoteContentInput } from "@/lib/notes-model";
import {
  hasOfflineShell, hideLocalNotes, keepConflictCopy, OfflineNotesSessionExpired, OfflineNotesUnavailable, prepareOfflineShell, readLocalNotes,
  saveLocalNote, synchronizeOfflineNotes, type LocalNote, type OfflineNotesState,
} from "@/lib/offline-notes-client";
import { offlineNotesSignInPath } from "@/lib/offline-notes-model";
import { hideLocalWork, readLocalWork, syncOfflineWork, type OfflineWorkState } from "@/lib/offline-work-client";
import { OfflineWorkPanel } from "./offline-work-panel";
import linen from "./notes-linen.module.css";
import styles from "./offline-notes.module.css";

const emptyContent: NoteContentInput = { blocks: [], markdown: "", text: "", formatVersion: 2 };

type Draft = { key: string; original?: LocalNote; title: string; content: NoteContentInput };

function PhoneNoteTitle({ value, onChange }: { value: string; onChange?: (value: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const field = ref.current;
    if (!field) return;
    const resize = () => {
      field.style.height = "0px";
      field.style.height = `${field.scrollHeight}px`;
    };
    resize();
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width === field.clientWidth) return;
      width = field.clientWidth;
      resize();
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [value]);
  return <textarea ref={ref} className="notes-mobile-title" rows={1} aria-label="Note title"
    maxLength={maxNoteTitleLength} placeholder="Untitled note" value={value} readOnly={!onChange}
    onChange={onChange ? (event) => onChange(event.target.value) : undefined} />;
}

export function OfflineNotes({ workEnabled = false }: { workEnabled?: boolean }) {
  const phone = usePhoneViewport();
  const [mode,setMode] = useState<"notes" | "task" | "event">("notes");
  const [editingWork,setEditingWork] = useState(false);
  const [local, setLocal] = useState<OfflineNotesState | null>(null);
  const [work, setWork] = useState<OfflineWorkState | null>(null);
  const [editor, setEditor] = useState<ComponentType<NoteEditorProps> | null>(null);
  const [ready, setReady] = useState(false);
  const [connected, setConnected] = useState(true);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signIn, setSignIn] = useState(false);
  const [syncError, setSyncError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [startupError, setStartupError] = useState("");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saveAsCopy, setSaveAsCopy] = useState(false);
  const body = useRef(emptyContent);
  const activeSync = useRef<Promise<void> | null>(null);
  const syncRequested = useRef(false);
  const selectedNote = local?.notes.find((note) => note.key === selected);
  const pending = (local?.notes.filter((note) => note.pendingId && !note.conflict).length ?? 0)
    + (work?.items.filter((item) => item.draft && !item.conflict).length ?? 0);
  const conflicts = (local?.notes.filter((note) => note.conflict).length ?? 0)
    + (work?.items.filter((item) => item.conflict).length ?? 0);
  const hasLocalCopies = Boolean(local && (!workEnabled || work));

  const sync = useCallback(() => {
    if (!navigator.onLine) return Promise.resolve();
    if (activeSync.current) {
      syncRequested.current = true;
      return activeSync.current;
    }
    activeSync.current = (async () => {
      setBusy(true);
      setSyncError("");
      try {
        do {
          syncRequested.current = false;
          const [notesResult, workResult] = await Promise.allSettled([
            synchronizeOfflineNotes(setLocal),
            workEnabled ? syncOfflineWork(setWork) : Promise.resolve(),
          ]);
          const notesError: unknown = notesResult.status === "rejected" ? notesResult.reason : null;
          const workError: unknown = workResult.status === "rejected" ? workResult.reason : null;
          if (notesError instanceof OfflineNotesUnavailable) {
            setLocal(null);
            setDraft(null);
            setSelected(null);
            await hideLocalNotes().catch(() => undefined);
          } else if (notesResult.status === "rejected") {
            const saved = await readLocalNotes().catch(() => null);
            setLocal((current) => current ?? saved);
          }
          if (workError instanceof OfflineNotesUnavailable) {
            setWork(null);
            setEditingWork(false);
            await hideLocalWork().catch(() => undefined);
          } else if (workResult.status === "rejected") {
            const saved = await readLocalWork().catch(() => null);
            setWork((current) => current ?? saved);
          }

          const expired = [notesError, workError].some((error) => error instanceof OfflineNotesSessionExpired);
          const unavailable = [notesError, workError].find((error) => error instanceof OfflineNotesUnavailable);
          setSignIn(expired);
          setSyncError(expired ? "Sign in to sync. Your edits stay on this device."
            : unavailable ? unavailable.message
            : (notesResult.status === "rejected" || workResult.status === "rejected") && navigator.onLine
              ? "Sync paused. Your local edits are safe." : "");
        } while (syncRequested.current && navigator.onLine);
      } finally {
        activeSync.current = null;
        setBusy(false);
      }
    })();
    return activeSync.current;
  }, [workEnabled]);

  useEffect(() => {
    let mounted = true;
    setConnected(navigator.onLine);
    if (navigator.onLine) void sync();
    else void Promise.all([readLocalNotes(), workEnabled ? readLocalWork() : null]).then(([notes, savedWork]) => {
      if (!mounted || navigator.onLine) return;
      setLocal(notes);
      setWork(savedWork);
    }).catch(() => {
      if (mounted) setStartupError("Could not read your offline data. Connect and reopen the app to try again.");
    });
    const start = async () => {
      try {
        const module = await import("@/components/notes/note-editor");
        if (!mounted) return;
        setEditor(() => module.default);
        const cached = await hasOfflineShell();
        if (cached && mounted) setReady(true);
        if (navigator.onLine) {
          try { await prepareOfflineShell(); }
          catch (error) { if (!cached) throw error; }
          if (mounted) setReady(true);
        }
      } catch {
        if (mounted) setStartupError("Offline startup could not finish. Connect and reopen the app to try again.");
      }
    };
    void start();
    const online = () => { setConnected(true); void sync(); };
    const offline = () => setConnected(false);
    const refresh = () => { if (document.visibilityState === "visible") void sync(); };
    window.addEventListener("online", online);
    window.addEventListener("offline", offline);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      mounted = false;
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offline);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, [sync, workEnabled]);

  function openDraft(note?: LocalNote) {
    const content = note?.body.content ?? emptyContent;
    body.current = content;
    setSaveError("");
    setSaveAsCopy(false);
    setDraft({ key: note?.key ?? crypto.randomUUID(), original: note, title: note?.body.title ?? "", content });
  }

  function cancelDraft() {
    setDraft(null);
    setSaveAsCopy(false);
    setSaveError("");
  }

  async function saveDraft(event: { preventDefault(): void }, copy = false) {
    event.preventDefault();
    if (!draft || !local || saving) return;
    setSaving(true);
    setSaveError("");
    const key = copy ? crypto.randomUUID() : draft.key;
    try {
      setLocal(await saveLocalNote(local.ownerId, key, { title: draft.title, content: body.current }, copy ? undefined : draft.original));
      setSelected(key);
      cancelDraft();
      void sync();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Could not save this note on the device.");
      setSaveAsCopy(Boolean(draft.original));
    } finally {
      setSaving(false);
    }
  }

  async function saveConflictCopy(note: LocalNote) {
    if (!local || saving) return;
    setSaving(true);
    setSaveError("");
    const key = crypto.randomUUID();
    try {
      setLocal(await keepConflictCopy(local.ownerId, note.key, key));
      setSelected(key);
      void sync();
    } catch {
      setSaveError("Could not save a local copy. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const needle = query.trim().toLowerCase();
  const visibleNotes = local?.notes.filter(({ body: note }) =>
    !needle || note.title.toLowerCase().includes(needle) || note.content.text.toLowerCase().includes(needle),
  ) ?? [];
  const status = busy ? "Syncing…" : signIn ? "Sign in required" : conflicts ? `${conflicts} to review`
    : pending ? `${pending} waiting to sync` : syncError ? "Sync paused"
    : connected ? hasLocalCopies ? "Up to date" : "Connecting…" : "Offline";
  const syncStatus = <div className={styles.status} role="status">
    <span>{status}</span>
    {ready && hasLocalCopies ? <span>Ready offline</span> : null}
  </div>;
  const syncNotice = startupError || syncError ? <div className="notes-notice">
    {startupError || syncError} {signIn ? <a className="ui-button" href={offlineNotesSignInPath}>Sign in</a> : null}
  </div> : null;
  const pane = draft || selectedNote ? "note" : "list";
  const Editor = editor;
  const navigation = workEnabled ? <nav className={`task-workspace-tabs ${styles.workspaceNav}`} aria-label="Offline workspaces">
    {([["notes","Notes"],["task","Board"],["event","Calendar"]] as const).map(([id,label]) =>
      <button key={id} type="button" aria-current={mode === id ? "page" : undefined}
        className={mode === id ? "ui-chip-active" : undefined}
        disabled={mode !== id && (Boolean(draft) || editingWork)} onClick={() => setMode(id)}>{label}</button>)}
  </nav> : null;

  if (mode !== "notes") return (
    <main className={`taskboard-shell ${styles.shell}`} data-testid="offline-notes"
      data-phone-notes={phone.isPhone ? "true" : undefined} style={phone.style}>
      {navigation}
      <OfflineWorkPanel key={`${mode}:${work?.ownerId ?? ""}`} mode={mode} local={work}
        syncDisabled={!connected || busy} onSync={sync} onSaved={setWork} onEditing={setEditingWork}>
        {syncStatus}
        {syncNotice}
      </OfflineWorkPanel>
    </main>
  );

  return (
    <main className={`taskboard-shell ${styles.shell}`} data-testid="offline-notes"
      data-phone-notes={phone.isPhone ? "true" : undefined} style={phone.style}>
      {syncStatus}
      {navigation}
      {syncNotice}
      <div className={`notes-frame ${linen.root}`} data-editor-scale={phone.isPhone ? undefined : "true"}>
        <div className={`notes-workspace ${styles.workspace}`} data-pane={pane}>
          <section className="notes-list-pane" aria-label="Notes list">
            <header className="notes-pane-header">
              <h1 className="notes-pane-title">Offline Personal Notes</h1>
              <button className="notes-icon-button" type="button" aria-label="Sync now" title="Sync now"
                disabled={!connected || busy} onClick={() => void sync()}><RefreshCw size={16} /></button>
              <button className="notes-icon-button" type="button" aria-label="New note" title="New note"
                disabled={!local || !Editor || Boolean(draft)} onClick={() => openDraft()}><Plus size={16} /></button>
            </header>
            <div className={styles.search}>
              <input type="search" className="ed-field" aria-label="Search offline notes" placeholder="Search notes" value={query}
                onChange={(event) => setQuery(event.target.value)} />
            </div>
            <div className="notes-list pretty-scrollbar">
              {visibleNotes.map((note) => (
                <button type="button" className="notes-list-item" key={note.key}
                  data-active={selected === note.key} disabled={Boolean(draft)}
                  onClick={() => { setSelected(note.key); setSaveError(""); }}>
                  <span className="notes-list-title">{note.body.title || "Untitled note"}</span>
                  <span className="notes-list-snippet">
                    {note.conflict ? "Needs review" : note.pendingId ? "Waiting to sync" : note.body.content.text}
                  </span>
                </button>
              ))}
              {visibleNotes.length === 0 ? <p className="notes-empty">{needle ? "No matching notes." : local ? "No Personal notes yet." : "Connect to load your Personal notes."}</p> : null}
            </div>
          </section>
          <section className="notes-editor-pane" aria-label="Note">
            {draft && Editor ? (
              <form className="notes-editor-shell" onSubmit={saveDraft}>
                <header className="notes-editor-toolbar">
                  {phone.isPhone ? <h2 className="notes-pane-title">{draft.original ? "Edit note" : "New note"}</h2>
                    : <input className="notes-title-input" aria-label="Note title" maxLength={maxNoteTitleLength}
                      placeholder="Untitled note" value={draft.title}
                      onChange={(event) => setDraft({ ...draft, title: event.target.value })} />}
                  <div className={styles.draftActions}>
                    <button className="ui-button" type="button" disabled={saving} onClick={cancelDraft}>Cancel</button>
                    <button className="ui-button" type="submit" disabled={saving}>Save</button>
                  </div>
                </header>
                <div className="notes-editor-body pretty-scrollbar">
                  {phone.isPhone ? <PhoneNoteTitle value={draft.title} onChange={(title) => setDraft({ ...draft, title })} /> : null}
                  <Editor key={draft.key} initialBlocks={draft.content.blocks} editable mobile={phone.isPhone}
                    contentFormatVersion={draft.content.formatVersion}
                    onChange={(content) => { body.current = content; }} />
                </div>
                {saveError ? <div className="notes-conflict" role="alert">
                  {saveError} {saveAsCopy ? <button className="ui-button" type="button" onClick={(event) => void saveDraft(event, true)}>Save as a copy</button> : null}
                </div> : null}
              </form>
            ) : selectedNote && Editor ? (
              <article className="notes-editor-shell">
                <header className="notes-editor-toolbar">
                  <button className="notes-icon-button notes-back-to-list" type="button" aria-label="Back to notes"
                    onClick={() => setSelected(null)}><ArrowLeft size={16} /></button>
                  {phone.isPhone ? <span className="notes-pane-title">{selectedNote.pendingId ? "Saved on this device" : "Note"}</span>
                    : <input className="notes-title-input" aria-label="Note title" readOnly
                      value={selectedNote.body.title || "Untitled note"} />}
                  {!selectedNote.conflict ? <button className="ui-button" type="button" onClick={() => openDraft(selectedNote)}>Edit</button> : null}
                </header>
                <div className="notes-editor-body pretty-scrollbar">
                  {selectedNote.conflict ? <div className="notes-conflict">
                    <p>{selectedNote.conflict === "changed" ? "This note changed on another device. Your edits are below." : "This note is no longer available in Personal. Your edits are below."}</p>
                    <button className="ui-button" type="button" disabled={saving} onClick={() => void saveConflictCopy(selectedNote)}>Save my edits as a copy</button>
                    {selectedNote.serverCopy ? (
                      <div className={styles.conflictCopy}>
                        <strong>Server version</strong>
                        <p>{selectedNote.serverCopy.title}</p>
                        <p>{selectedNote.serverCopy.content.text}</p>
                      </div>
                    ) : null}
                  </div> : null}
                  {saveError ? <p className="notes-error" role="alert">{saveError}</p> : null}
                  <h2 className="sr-only">{selectedNote.body.title || "Untitled note"}</h2>
                  {phone.isPhone ? <PhoneNoteTitle value={selectedNote.body.title || "Untitled note"} /> : null}
                  <Editor key={`${selectedNote.key}:${selectedNote.version}:${selectedNote.pendingId}`}
                    initialBlocks={selectedNote.body.content.blocks} contentFormatVersion={selectedNote.body.content.formatVersion}
                    editable={false} mobile={phone.isPhone} onChange={() => {}} />
                </div>
              </article>
            ) : <div className="notes-editor-empty">Select a note or create one.</div>}
          </section>
        </div>
      </div>
    </main>
  );
}
