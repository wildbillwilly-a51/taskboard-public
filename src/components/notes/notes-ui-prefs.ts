"use client";

// Per-viewer Notes layout preferences (column widths, expanded folders), kept
// in this browser's localStorage under the signed-in user's id. A convenience
// only: everything works when storage is unavailable, and the server render
// always uses the defaults.
import { useCallback, useSyncExternalStore } from "react";
import { NOTES_LAYOUT, normalizeNotesColumnWidths, type NotesColumnWidths } from "@/lib/notes-layout";
import { normalizeNoteReadingScale } from "@/lib/phone-layout";

const STORAGE_PREFIX = "taskboard-notes-ui:";

function storageKey(viewerId: string) {
  return STORAGE_PREFIX + (viewerId || "anonymous");
}

export type NotesUiPrefs = {
  widths: NotesColumnWidths;
  expandedBoards: string[];
  expandedNotebooks: string[];
  readingScale: number;
};

const defaultPrefs: NotesUiPrefs = {
  widths: { sidebar: NOTES_LAYOUT.sidebar.default, list: NOTES_LAYOUT.list.default },
  expandedBoards: [],
  expandedNotebooks: [],
  readingScale: 100,
};

const listeners = new Set<() => void>();
// Parsed value per storage key, reused while the stored text is unchanged.
const cache = new Map<string, { raw: string | null; prefs: NotesUiPrefs }>();
// Used when storage cannot be written, so changes still apply this session.
const memoryPrefs = new Map<string, NotesUiPrefs>();

function parse(raw: string | null): NotesUiPrefs {
  if (!raw) {
    return defaultPrefs;
  }

  try {
    const value = JSON.parse(raw) as Partial<Record<keyof NotesUiPrefs, unknown>>;
    const ids = (list: unknown) =>
      Array.isArray(list) ? list.filter((item): item is string => typeof item === "string").slice(0, 500) : [];
    return {
      widths: normalizeNotesColumnWidths(value.widths),
      expandedBoards: ids(value.expandedBoards),
      expandedNotebooks: ids(value.expandedNotebooks),
      readingScale: normalizeNoteReadingScale(value.readingScale ?? 100),
    };
  } catch {
    return defaultPrefs;
  }
}

function readPrefs(key: string): NotesUiPrefs {
  const memory = memoryPrefs.get(key);

  if (memory) {
    return memory;
  }

  let raw: string | null = null;

  try {
    raw = window.localStorage.getItem(key);
  } catch {
    raw = null;
  }

  const cached = cache.get(key);

  if (cached && cached.raw === raw) {
    return cached.prefs;
  }

  const prefs = parse(raw);
  cache.set(key, { raw, prefs });
  return prefs;
}

function getServerSnapshot() {
  return defaultPrefs;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key?.startsWith(STORAGE_PREFIX)) {
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

export function updateNotesUiPrefs(viewerId: string, update: (current: NotesUiPrefs) => NotesUiPrefs) {
  const key = storageKey(viewerId);
  const next = update(readPrefs(key));

  try {
    window.localStorage.setItem(key, JSON.stringify(next));
    memoryPrefs.delete(key);
  } catch {
    memoryPrefs.set(key, next);
  }

  for (const listener of listeners) {
    listener();
  }
}

export function useNotesUiPrefs(viewerId: string) {
  const key = storageKey(viewerId);
  const getSnapshot = useCallback(() => readPrefs(key), [key]);
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Adds ids to an expanded list (no duplicates), keeping it bounded.
export function withExpanded(list: string[], ids: Iterable<string>) {
  const next = new Set(list);

  for (const id of ids) {
    next.add(id);
  }

  return Array.from(next).slice(-500);
}
