import { offlineNotesApi, offlineNotesCache, offlineNotesPath, offlineNotesWorkerPath, type OfflineNote, type OfflineNoteBody, type OfflineSave, type OfflineSnapshot } from "@/lib/offline-notes-model";

export type LocalNote = {
  key: string;
  noteId: string | null;
  version: number | null;
  body: OfflineNoteBody;
  pendingId: string | null;
  sending: OfflineSave | null;
  conflict: "changed" | "unavailable" | null;
  serverCopy: OfflineNote | null;
};

export type OfflineNotesState = { ownerId: string; notes: LocalNote[]; hidden?: boolean };

let database: Promise<IDBDatabase> | undefined;

function openDatabase() {
  database ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("taskboard-offline-personal-notes", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("workspace");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((error: unknown) => {
    database = undefined;
    throw error;
  });
  return database;
}

// Save the working copy and its outbox state in one IndexedDB transaction.
// Resolve on commit, rather than when the put request is first accepted.
export async function offlineWorkspace<T>(key: "state" | "work", change?: (state: T | null) => T | null) {
  const db = await openDatabase();
  return new Promise<T | null>((resolve, reject) => {
    const transaction = change ? db.transaction("workspace", "readwrite", { durability: "strict" })
      : db.transaction("workspace", "readonly");
    const store = transaction.objectStore("workspace");
    const read = store.get(key);
    let state: T | null = null;
    let failure: unknown;
    read.onsuccess = () => {
      try {
        state = read.result ?? null;
        if (change) {
          state = change(state);
          store.put(state, key);
        }
      } catch (error) {
        failure = error;
        transaction.abort();
      }
    };
    transaction.oncomplete = () => resolve(state);
    transaction.onabort = () => reject(failure ?? transaction.error ?? new Error("The local save did not finish."));
  });
}

function workspace(change?: (state: OfflineNotesState | null) => OfflineNotesState | null) {
  return offlineWorkspace("state",change);
}

export async function readLocalNotes() {
  const state = await workspace();
  return state?.hidden ? null : state;
}

export function hideLocalNotes() {
  return workspace((state) => state ? { ...state, hidden: true } : null);
}

function requireWorkspace(state: OfflineNotesState | null, ownerId: string) {
  if (state?.ownerId !== ownerId) throw new OfflineNotesUnavailable("Sign in to the account that saved these notes.");
  return state;
}

function fromServer(note: OfflineNote, key = note.id): LocalNote {
  const { id, version, title, content } = note;
  return { key, noteId: id, version, body: { title, content }, pendingId: null, sending: null, conflict: null, serverCopy: null };
}

export function saveLocalNote(ownerId: string, key: string, body: OfflineNoteBody, original?: LocalNote) {
  return workspace((state) => {
    const current = requireWorkspace(state, ownerId);
    if (current.hidden) throw new OfflineNotesUnavailable("Sign in to the account that saved these notes.");
    const existing = current.notes.find((note) => note.key === key);
    if (original && (!existing || existing.conflict
      || JSON.stringify(existing.body) !== JSON.stringify(original.body))) {
      throw new Error("This note changed while it was open. Save as a copy to keep your edits.");
    }
    const note: LocalNote = {
      key, noteId: existing?.noteId ?? null, version: existing?.version ?? null, body,
      pendingId: crypto.randomUUID(), sending: existing?.sending ?? null, conflict: null, serverCopy: null,
    };
    return { ownerId, notes: [note, ...current.notes.filter((item) => item.key !== key)] };
  });
}

export function keepConflictCopy(ownerId: string, key: string, copyKey: string) {
  return workspace((state) => {
    const current = requireWorkspace(state, ownerId);
    if (current.hidden) throw new OfflineNotesUnavailable("Sign in to the account that saved these notes.");
    const note = current.notes.find((item) => item.key === key);
    if (!note?.conflict) return current;
    const copy: LocalNote = {
      ...note, key: copyKey, noteId: null, version: null, pendingId: crypto.randomUUID(),
      sending: null, conflict: null, serverCopy: null,
    };
    const remaining = current.notes.filter((item) => item.key !== key);
    if (note.serverCopy) remaining.push(fromServer(note.serverCopy, key));
    return { ownerId, notes: [copy, ...remaining] };
  });
}

export class OfflineNotesSessionExpired extends Error {}
export class OfflineNotesUnavailable extends Error {}

export async function requestOfflineApi(path: string, init?: RequestInit) {
  const response = await fetch(path, {
    ...init, redirect: "manual", cache: "no-store", signal: AbortSignal.timeout(8000),
  });
  if (response.type === "opaqueredirect" || response.status === 401 || response.status === 403)
    throw new OfflineNotesSessionExpired();
  if (response.status === 404)
    throw new OfflineNotesUnavailable(path === offlineNotesApi
      ? "Offline Notes is unavailable for this account." : "Offline Board and Calendar are unavailable for this account.");
  return response;
}

function requestSync(init?: RequestInit) {
  return requestOfflineApi(offlineNotesApi,init);
}

async function readSnapshot(): Promise<OfflineSnapshot> {
  const response = await requestSync();
  if (!response.ok) throw new Error("Could not refresh notes. Your local copies are still available.");
  return response.json();
}

function mergeSnapshot(snapshot: OfflineSnapshot) {
  return workspace((state) => {
    if (!state) return { ownerId: snapshot.ownerId, notes: snapshot.notes.map((note) => fromServer(note)) };
    const current = requireWorkspace(state, snapshot.ownerId);
    const remote = new Map(snapshot.notes.map((note) => [note.id, note]));
    const notes: LocalNote[] = [];
    for (const local of current.notes) {
      const server = local.noteId ? remote.get(local.noteId) : undefined;
      if (local.noteId) remote.delete(local.noteId);
      if (local.conflict) notes.push({ ...local, serverCopy: server ?? null });
      else if (local.pendingId) notes.push(local);
      else if (server) notes.push(fromServer(server, local.key));
    }
    for (const server of remote.values()) notes.push(fromServer(server));
    return { ownerId: snapshot.ownerId, notes };
  });
}

async function syncWorkspace(onState: (state: OfflineNotesState | null) => void) {
  const snapshot = await readSnapshot();
  const initial = await workspace();
  if (!initial) {
    onState(await mergeSnapshot(snapshot));
    return;
  }
  requireWorkspace(initial, snapshot.ownerId);
  const { ownerId } = snapshot;
  let pushed = false;
  let currentNotes = initial.notes;
  for (let candidate = currentNotes.find((note) => note.pendingId && !note.conflict);
    candidate; candidate = currentNotes.find((note) => note.pendingId && !note.conflict)) {
    const key = candidate.key;
    let sending: OfflineSave | null = null;
    const prepared = await workspace((state) => {
      const current = requireWorkspace(state, ownerId);
      return {
        ...current, notes: current.notes.map((note) => {
          if (note.key !== key || note.conflict || !note.pendingId) return note;
          sending = note.sending ?? {
            operationId: note.pendingId, noteId: note.noteId, expectedVersion: note.version, ...note.body,
          };
          return { ...note, sending };
        }),
      };
    });
    currentNotes = prepared?.notes ?? [];
    const operation = sending as OfflineSave | null;
    if (!operation) continue;
    const response = await requestSync({
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...operation, ownerId }),
    });
    const result = await response.json();
    const conflict = response.status === 409 && result.kind === "conflict"
      && (result.reason === "changed" || result.reason === "unavailable");
    if (!conflict && (!response.ok || result.kind !== "saved")) {
      throw new Error("A note is still waiting to sync. Try Sync now again.");
    }
    const updated = await workspace((state) => {
      const current = requireWorkspace(state, ownerId);
      return {
        ...current, notes: current.notes.map((note) => {
          if (note.key !== key || note.sending?.operationId !== operation.operationId) return note;
          if (conflict) return {
            ...note, sending: null, conflict: result.reason,
            serverCopy: snapshot.notes.find((remote) => remote.id === note.noteId) ?? null,
          };
          return {
            ...note, noteId: result.noteId, version: result.version, sending: null,
            pendingId: note.pendingId === operation.operationId ? null : note.pendingId,
          };
        }),
      };
    });
    currentNotes = updated?.notes ?? [];
    onState(updated);
    pushed = true;
  }
  onState(await mergeSnapshot(pushed ? await readSnapshot() : snapshot));
}

export async function synchronizeOfflineNotes(onState: (state: OfflineNotesState | null) => void) {
  // Keep snapshots and writes in order when more than one tab is open.
  await navigator.locks.request("taskboard-offline-personal-notes-sync", () => syncWorkspace(onState));
}

async function activatedWorker(registration: ServiceWorkerRegistration) {
  const worker = registration.active ?? registration.waiting ?? registration.installing;
  if (!worker) throw new Error("Offline startup is still being prepared.");
  if (worker.state === "activated") return worker;

  await new Promise<void>((resolve, reject) => {
    const finish = (error?: Error) => {
      window.clearTimeout(timer);
      worker.removeEventListener("statechange", check);
      if (error) reject(error);
      else resolve();
    };
    const check = () => {
      if (worker.state === "activated") finish();
      if (worker.state === "redundant") finish(new Error("Offline startup could not be prepared."));
    };
    const timer = window.setTimeout(() => finish(new Error("Offline startup could not be prepared.")), 15000);
    worker.addEventListener("statechange", check);
    check();
  });
  return worker;
}

export async function prepareOfflineShell() {
  const registration = await navigator.serviceWorker.register(offlineNotesWorkerPath);
  const worker = await activatedWorker(registration);
  await document.fonts.ready;
  const assets = performance.getEntriesByType("resource").map(({ name }) => name);
  const channel = new MessageChannel();
  try {
    await new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => reject(new Error("Offline startup could not be prepared.")), 15000);
      channel.port1.onmessage = ({ data }) => {
        window.clearTimeout(timer);
        if (data === "ready") resolve();
        else reject(new Error("Offline startup could not be prepared."));
      };
      worker.postMessage({ type: "prepare", assets }, [channel.port2]);
    });
  } finally {
    channel.port1.close();
  }
}

export async function hasOfflineShell() {
  if (!("serviceWorker" in navigator) || !("caches" in window)) return false;
  const registration = await navigator.serviceWorker.getRegistration(offlineNotesPath);
  return registration?.active?.scriptURL === new URL(offlineNotesWorkerPath, location.origin).href
    && Boolean(await caches.match(offlineNotesPath, { cacheName: offlineNotesCache }));
}
