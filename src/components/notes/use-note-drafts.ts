"use client";

import { useEffect, useReducer, useRef } from "react";
import {
  createNoteRequest,
  NoteSaveConflictError,
  updateNoteRequest,
  type CreateNoteRequest,
} from "@/lib/notes-client";
import type { NoteContentInput, NoteDetail } from "@/lib/notes-model";
import { createWikiPageRequest } from "@/lib/wiki-client";
import { createFolioNoteRequest } from "@/lib/folio-client";

export type NoteSaveState = "idle" | "pending" | "saving" | "saved" | "error" | "conflict";

type NoteFields = { title?: string; content?: NoteContentInput };

type NoteDraft = {
  // Edits not yet sent.
  pending: NoteFields;
  // Edits in the request now running (shown until the server accepts them).
  sending: NoteFields | null;
  // The newest text the server accepted, with its version.
  acknowledged: NoteFields;
  // content_version the next save is based on (sent as expectedVersion).
  version: number;
  status: NoteSaveState;
  conflictVersion?: number;
};

const AUTOSAVE_DELAY_MS = 800;

function hasFields(fields: NoteFields | null | undefined) {
  return Boolean(fields && (fields.title !== undefined || fields.content !== undefined));
}

function newestFields(draft: NoteDraft): NoteFields {
  return {
    title: draft.pending.title ?? draft.sending?.title ?? draft.acknowledged.title,
    content: draft.pending.content ?? draft.sending?.content ?? draft.acknowledged.content,
  };
}

// ---------------------------------------------------------------------------
// The drafts store. It lives for the whole browser tab, not one visit to the
// Notes page: edits that could not be saved (an error or a conflict) are still
// there after visiting the board and coming back, every mounted Notes page is
// told when they change, and closing or reloading the tab from anywhere in the
// app warns while edits are unsaved. Each note saves on its own, one request
// at a time, so switching notes never mixes or drops edits.

const drafts = new Map<string, NoteDraft>();
const inFlight = new Map<string, Promise<boolean>>();
const timers = new Map<string, number>();
const changeListeners = new Set<() => void>();
const savedListeners = new Set<(note: NoteDetail) => void>();
const exclusive = new Set<string>();
const suspended = new Set<string>();
// Explicit live permission decisions outrank an older body-load response.
const accessSuspended = new Set<string>();

export class NoteDraftBarrierError extends Error {}

// The lock is shared by every mounted editor for a note, including Linked notes.
// Acquire synchronously, flush the old queue, and hold it until the returned
// document has been installed. Failed saves never reach the manual operation.
async function runExclusive<T>(noteId: string, operation: (version: number) => Promise<T>, options: { readOnly?: boolean } = {}): Promise<T> {
  if (exclusive.has(noteId) || (suspended.has(noteId) && !options.readOnly)) throw new NoteDraftBarrierError("This note is read-only or another action is pending.");
  exclusive.add(noteId);
  notify();
  try {
    if (options.readOnly && suspended.has(noteId) ? !isIdle(noteId) : !(await saveNote(noteId))) throw new NoteDraftBarrierError("Save or resolve your unsaved edits before continuing. Your text is kept in this tab.");
    const draft = drafts.get(noteId);
    if (!draft) throw new NoteDraftBarrierError("Reload this note before continuing.");
    return await operation(draft.version);
  } finally { exclusive.delete(noteId); notify(); }
}

function isBlocked(noteId: string) { return exclusive.has(noteId) || suspended.has(noteId); }
function suspend(noteId: string, value = true) {
  const wasSuspended = suspended.has(noteId);
  if (value) { accessSuspended.add(noteId); suspended.add(noteId); clearTimer(noteId); }
  else { accessSuspended.delete(noteId); suspended.delete(noteId); }
  if (wasSuspended && !value && !exclusive.has(noteId) && !isIdle(noteId) && statusOf(noteId) !== "conflict") scheduleSave(noteId);
  notify();
}
function install(detail: NoteDetail) {
  // Only exclusive operations may replace an acknowledged baseline while locked.
  if (!exclusive.has(detail.id)) throw new NoteDraftBarrierError("Installing a manual result requires the draft barrier.");
  drafts.set(detail.id, { pending: {}, sending: null, acknowledged: {}, version: detail.contentVersion, status: "idle" });
  notify();
}

function notify() {
  for (const listener of changeListeners) {
    listener();
  }
}

function clearTimer(noteId: string) {
  const timer = timers.get(noteId);

  if (timer !== undefined) {
    window.clearTimeout(timer);
    timers.delete(noteId);
  }
}

function scheduleSave(noteId: string) {
  clearTimer(noteId);
  timers.set(noteId, window.setTimeout(() => {
    timers.delete(noteId);
    void saveNote(noteId);
  }, AUTOSAVE_DELAY_MS));
}

// Sends a note's unsaved edits, waiting for any save already running for it.
// Resolves true once nothing is left unsaved, false on an error or an
// unresolved conflict.
async function saveNote(noteId: string, options: { keepalive?: boolean } = {}): Promise<boolean> {
  clearTimer(noteId);

  for (;;) {
    if (suspended.has(noteId)) return false;
    const running = inFlight.get(noteId);

    if (running) {
      if (!(await running)) return false;
      continue;
    }

    const draft = drafts.get(noteId);

    if (!draft || !hasFields(draft.pending)) {
      return !draft || (draft.status !== "error" && draft.status !== "conflict");
    }

    if (draft.status === "conflict") {
      return false;
    }

    const sending = draft.pending;
    draft.pending = {};
    draft.sending = sending;
    draft.status = "saving";
    notify();

    const attempt = (async () => {
      try {
        const saved = await updateNoteRequest(
          noteId,
          {
            ...(sending.title !== undefined ? { title: sending.title } : {}),
            ...(sending.content !== undefined ? { content: sending.content } : {}),
            expectedVersion: draft.version,
          },
          options,
        );
        draft.acknowledged = { ...draft.acknowledged, ...sending };
        draft.version = saved.contentVersion;
        draft.status = hasFields(draft.pending) ? "pending" : "saved";

        for (const listener of savedListeners) {
          listener(saved);
        }

        return true;
      } catch (error) {
        // Put the sent fields back under any newer edits made meanwhile.
        draft.pending = { ...sending, ...draft.pending };

        if (error instanceof NoteSaveConflictError) {
          draft.status = "conflict";
          draft.conflictVersion = error.currentVersion;
        } else {
          draft.status = "error";
        }

        return false;
      } finally {
        draft.sending = null;
        inFlight.delete(noteId);
        notify();
      }
    })();

    inFlight.set(noteId, attempt);

    if (!(await attempt)) {
      return false;
    }
  }
}

// Records an edit and saves it shortly after typing stops.
function edit(noteId: string, baseVersion: number, fields: NoteFields) {
  if (isBlocked(noteId)) return;
  let draft = drafts.get(noteId);

  if (!draft) {
    draft = { pending: {}, sending: null, acknowledged: {}, version: baseVersion, status: "idle" };
    drafts.set(noteId, draft);
  }

  draft.pending = { ...draft.pending, ...fields };

  if (draft.status !== "conflict") {
    draft.status = "pending";
  }

  notify();
  scheduleSave(noteId);
}

// A note copy fresh from the server. Returns the text to show: the user's
// pending or in-flight edits win, and an older copy (fetched before the latest
// save was accepted) never replaces the accepted text.
function register(detail: NoteDetail): NoteFields | null {
  // Server renders are shared between users and requests. Draft state belongs
  // exclusively to a browser tab, never to a server module instance.
  if (typeof window === "undefined") return null;
  if ((detail.wiki || detail.folio) && (!detail.canEdit || detail.wiki?.spaceArchived)) { suspended.add(detail.id); clearTimer(detail.id); }
  else if (isIdle(detail.id) && !accessSuspended.has(detail.id)) suspended.delete(detail.id);
  const draft = drafts.get(detail.id);

  if (!draft) {
    drafts.set(detail.id, {
      pending: {},
      sending: null,
      acknowledged: {},
      version: detail.contentVersion,
      status: "idle",
    });
    return null;
  }

  const busy = hasFields(draft.pending) || draft.sending !== null || draft.status === "conflict";

  if (!busy && detail.contentVersion >= draft.version) {
    // The server copy is current: start clean from it.
    draft.version = detail.contentVersion;
    draft.acknowledged = {};
    draft.status = "idle";
    return null;
  }

  const newest = newestFields(draft);
  return hasFields(newest) ? newest : null;
}

// Drops a note's draft (after "Reload theirs", trash, or delete).
function forget(noteId: string) {
  clearTimer(noteId);
  drafts.delete(noteId);
  suspended.delete(noteId); accessSuspended.delete(noteId);
  notify();
}

// "Keep mine" after a conflict: overwrite the newer server version.
function keepMine(noteId: string) {
  if (isBlocked(noteId)) return Promise.resolve(false);
  const draft = drafts.get(noteId);

  if (!draft || draft.status !== "conflict") {
    return Promise.resolve(true);
  }

  draft.version = draft.conflictVersion ?? draft.version;
  draft.conflictVersion = undefined;
  draft.status = "pending";
  notify();
  return saveNote(noteId);
}

function statusOf(noteId: string | null | undefined): NoteSaveState {
  return (noteId && drafts.get(noteId)?.status) || "idle";
}

// Nothing typed, sending or in conflict for this note, so a newer copy from
// elsewhere may replace what is shown (the same rule register applies).
function isIdle(noteId: string) {
  const draft = drafts.get(noteId);
  return !draft || (!hasFields(draft.pending) && draft.sending === null && draft.status !== "conflict");
}

// The newest title and Markdown known for a note (pending, sending, or
// accepted), for Export after a save.
function latestOf(noteId: string) {
  const draft = drafts.get(noteId);
  return draft ? newestFields(draft) : {};
}

// ---------------------------------------------------------------------------
// New notes. "New note" opens a draft that is saved nowhere until the user
// types in it or changes one of its settings (owner decision, 2026-10-18).
// Drafts live here rather than in the page, like other unsaved edits: text
// typed into a draft survives leaving Notes, a failed create is tried again
// (the next edit, a new draft, leaving Notes, closing the tab), and leaving
// the tab warns while a draft's text or a create is not saved. A draft id is
// never sent to the server.

export type NewNoteTarget = CreateNoteRequest | { kind: "wiki"; spaceId: string } | { kind:"folio" };
type NewNoteDraft = {
  target: NewNoteTarget;
  // Title and body typed before the note existed.
  typed: NoteFields;
  creating: Promise<NoteDetail | null> | null;
  created: NoteDetail | null;
  failed: boolean;
};

const DRAFT_ID_PREFIX = "new-note-draft:";
const newNotes = new Map<string, NewNoteDraft>();
const createdListeners = new Set<(draftId: string, note: NoteDetail) => void>();
let draftCounter = 0;

export function isNewNoteDraftId(id: string | null | undefined): id is string {
  return typeof id === "string" && id.startsWith(DRAFT_ID_PREFIX);
}

// Creates the draft's note once; later callers get the same note. Text typed
// meanwhile is saved to it. Resolves null if the create failed.
function createNewNote(draftId: string): Promise<NoteDetail | null> {
  const draft = newNotes.get(draftId);

  if (!draft) {
    return Promise.resolve(null);
  }

  if (draft.created) {
    return Promise.resolve(draft.created);
  }

  if (!draft.creating) {
    draft.failed = false;
    const target = draft.target;
    const creating = "kind" in target && target.kind === "wiki"
      ? createWikiPageRequest(target.spaceId, {}) : "kind" in target && target.kind === "folio"
      ? createFolioNoteRequest() : createNoteRequest(target as CreateNoteRequest);
    draft.creating = creating.then(
      (created) => {
        register(created);

        if (hasFields(draft.typed)) {
          edit(created.id, created.contentVersion, draft.typed);
          void saveNote(created.id);
        }

        draft.typed = {};
        draft.created = created;
        draft.creating = null;
        // Everything is with the note now; anyone still waiting holds this
        // promise, and the page has switched to the note's own id.
        newNotes.delete(draftId);

        for (const listener of createdListeners) {
          listener(draftId, created);
        }

        // Saving works again, so drafts whose create failed earlier retry.
        for (const otherId of newNotes.keys()) {
          flushNewNote(otherId);
        }

        notify();
        return created;
      },
      () => {
        draft.creating = null;
        draft.failed = true;
        notify();
        return null;
      },
    );
    notify();
  }

  return draft.creating;
}

function hasUnsavedText(draft: NewNoteDraft) {
  return !draft.created && hasFields(draft.typed);
}

// Saves a draft that has typed text; an untouched one stays uncreated.
function flushNewNote(draftId: string) {
  const draft = newNotes.get(draftId);

  if (draft && hasUnsavedText(draft) && !draft.creating) {
    void createNewNote(draftId);
  }
}

// The page moved off a draft: one with typed text is saved (and kept until it
// is), an untouched or already created one is dropped. A create still running
// finishes on its own.
function leaveNewNote(draftId: string) {
  const draft = newNotes.get(draftId);

  if (!draft) {
    return;
  }

  if (hasUnsavedText(draft)) {
    flushNewNote(draftId);
  } else if (!draft.creating) {
    newNotes.delete(draftId);
  }
}

// Leaving Notes with a draft open drops or saves it a moment later, unless
// the page holds it again first: React replays effects in development, so a
// draft still on screen must survive an unmount that is immediately undone.
const pendingLeaves = new Map<string, number>();

function releaseNewNote(draftId: string) {
  holdNewNote(draftId);
  pendingLeaves.set(
    draftId,
    window.setTimeout(() => {
      pendingLeaves.delete(draftId);
      leaveNewNote(draftId);
    }, 0),
  );
}

function holdNewNote(draftId: string) {
  const timer = pendingLeaves.get(draftId);

  if (timer !== undefined) {
    window.clearTimeout(timer);
    pendingLeaves.delete(draftId);
  }
}

export function startNewNote(target: NewNoteTarget): string {
  // Server rendering keeps nothing; the browser starts its own draft.
  if (typeof window === "undefined") {
    return `${DRAFT_ID_PREFIX}server`;
  }

  // Earlier drafts whose create failed try again.
  for (const draftId of newNotes.keys()) {
    flushNewNote(draftId);
  }

  draftCounter += 1;
  const draftId = `${DRAFT_ID_PREFIX}${draftCounter}`;
  newNotes.set(draftId, { target, typed: {}, creating: null, created: null, failed: false });
  return draftId;
}

// The first typed character creates the note.
function editNewNote(draftId: string, fields: NoteFields) {
  const draft = newNotes.get(draftId);

  if (!draft) {
    return;
  }

  if (draft.created) {
    edit(draft.created.id, draft.created.contentVersion, fields);
    return;
  }

  draft.typed = { ...draft.typed, ...fields };
  notify();
  void createNewNote(draftId);
}

function newNoteStatus(draftId: string): NoteSaveState {
  const draft = newNotes.get(draftId);

  if (!draft) {
    return "idle";
  }

  if (draft.creating) {
    return "saving";
  }

  return draft.failed ? "error" : "idle";
}

function hasAnyUnsaved() {
  for (const draft of newNotes.values()) {
    if (draft.creating || hasUnsavedText(draft)) {
      return true;
    }
  }

  for (const draft of drafts.values()) {
    if (hasFields(draft.pending) || draft.sending) {
      return true;
    }
  }

  return false;
}

function saveAll(options: { keepalive?: boolean } = {}) {
  for (const draftId of newNotes.keys()) {
    flushNewNote(draftId);
  }

  for (const [noteId, draft] of drafts) {
    if (hasFields(draft.pending) && draft.status !== "conflict") {
      void saveNote(noteId, options);
    }
  }
}

// One guard for the whole tab, active from the first visit to Notes: closing
// or reloading anywhere in the app tries to save and asks first while edits
// are unsaved. Browsers allow no custom UI here; saving is best effort.
if (typeof window !== "undefined") {
  window.addEventListener("beforeunload", (event) => {
    if (hasAnyUnsaved()) {
      saveAll({ keepalive: true });
      event.preventDefault();
    }
  });
}

const store = {
  newNoteSnapshot: (id:string) => { const draft=newNotes.get(id); return draft ? {target:draft.target,typed:draft.typed} : null; },
  runExclusive,
  isBlocked,
  suspend,
  install,
  edit,
  saveNote,
  register,
  forget,
  keepMine,
  statusOf,
  isIdle,
  latestOf,
  hasAnyUnsaved,
  saveAll,
  startNewNote,
  editNewNote,
  createNewNote,
  flushNewNote,
  leaveNewNote,
  releaseNewNote,
  holdNewNote,
  newNoteStatus,
};

export const noteDraftStore = store;

// Subscribes a Notes page to the drafts store: it re-renders when any draft
// changes, hears about every accepted save, and hears when a draft becomes a
// note (only while mounted). Leaving the page sends pending edits instead of
// waiting on timers.
export function useNoteDrafts({
  onSaved,
  onCreated,
}: {
  onSaved: (note: NoteDetail) => void;
  onCreated: (draftId: string, note: NoteDetail) => void;
}) {
  const [, rerender] = useReducer((value: number) => value + 1, 0);
  const onSavedRef = useRef(onSaved);
  const onCreatedRef = useRef(onCreated);

  useEffect(() => {
    onSavedRef.current = onSaved;
    onCreatedRef.current = onCreated;
  }, [onCreated, onSaved]);

  useEffect(() => {
    const handleSaved = (note: NoteDetail) => onSavedRef.current(note);
    const handleCreated = (draftId: string, note: NoteDetail) => onCreatedRef.current(draftId, note);
    changeListeners.add(rerender);
    savedListeners.add(handleSaved);
    createdListeners.add(handleCreated);

    return () => {
      changeListeners.delete(rerender);
      savedListeners.delete(handleSaved);
      createdListeners.delete(handleCreated);
      saveAll();
    };
  }, []);

  return store;
}
