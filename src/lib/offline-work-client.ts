import { OfflineNotesUnavailable, offlineWorkspace, requestOfflineApi } from "@/lib/offline-notes-client";
import {
  offlineWorkApi, type OfflineWorkItem, type OfflineWorkPatch, type OfflineWorkSave, type OfflineWorkSnapshot,
} from "@/lib/offline-work-model";

type Draft = { id: string; patch: OfflineWorkPatch };
export type LocalWorkItem = {
  server: OfflineWorkItem;
  draft?: Draft;
  sending?: OfflineWorkSave;
  conflict?: string;
  serverCopy?: OfflineWorkItem;
};
export type OfflineWorkState = { ownerId: string; items: LocalWorkItem[]; hidden?: boolean };

const workspace = (change?: (state: OfflineWorkState | null) => OfflineWorkState | null) =>
  offlineWorkspace("work",change);
const keyOf = (item: OfflineWorkItem) => `${item.kind}:${item.id}`;
export const workKey = (item: LocalWorkItem) => keyOf(item.server);

function requireWorkspace(state: OfflineWorkState | null, ownerId: string) {
  if (state?.ownerId !== ownerId) throw new OfflineNotesUnavailable("Sign in to the account that saved these edits.");
  return state;
}

export async function readLocalWork() {
  const state = await workspace();
  return state?.hidden ? null : state;
}

export function hideLocalWork() {
  return workspace((state) => state && { ...state, hidden:true });
}

function changeItem(ownerId: string, key: string, change: (item: LocalWorkItem) => LocalWorkItem | null) {
  return workspace((state) => {
    const current = requireWorkspace(state,ownerId);
    if (current.hidden) throw new OfflineNotesUnavailable("Sign in to the account that saved these edits.");
    const index = current.items.findIndex((item) => workKey(item) === key);
    if (index < 0) throw new Error("This item is no longer available.");
    const updated = change(current.items[index]);
    const items = [...current.items];
    if (updated) items[index] = updated;
    else items.splice(index,1);
    return { ...current, items };
  });
}

export function saveLocalWork(ownerId: string, original: LocalWorkItem, patch: OfflineWorkPatch) {
  return changeItem(ownerId,workKey(original),(item) => {
    if (item.server.version !== original.server.version || item.draft?.id !== original.draft?.id || item.conflict)
      throw new Error("This item changed while it was open. Close the editor and review the latest copy.");
    return { ...item, draft:{ id:crypto.randomUUID(), patch:{ ...item.draft?.patch,...patch } } };
  });
}

export function resolveLocalWork(ownerId: string, original: LocalWorkItem, apply: boolean) {
  return changeItem(ownerId,workKey(original),(item) => {
    if (!item.conflict || item.draft?.id !== original.draft?.id
      || item.serverCopy?.version !== original.serverCopy?.version)
      throw new Error("The item changed. Review it again.");
    if (apply) {
      if (!item.serverCopy || !item.draft) throw new Error("This item is no longer available.");
      return { server:item.serverCopy, draft:{ id:crypto.randomUUID(), patch:item.draft.patch } };
    }
    return item.serverCopy ? { server:item.serverCopy } : null;
  });
}

async function snapshot(): Promise<OfflineWorkSnapshot> {
  const response = await requestOfflineApi(offlineWorkApi);
  if (!response.ok) throw new Error("Could not refresh Board and Calendar.");
  return response.json();
}

function merge(remote: OfflineWorkSnapshot) {
  return workspace((state) => {
    if (state) requireWorkspace(state,remote.ownerId);
    const remoteItems = new Map(remote.items.map((item) => [keyOf(item),item]));
    const items: LocalWorkItem[] = [];
    for (const local of state?.items ?? []) {
      const current = remoteItems.get(workKey(local));
      remoteItems.delete(workKey(local));
      if (local.conflict) items.push({ ...local, serverCopy:current });
      else if (local.draft) items.push(local);
      else if (current) items.push({ server:current });
    }
    for (const server of remoteItems.values()) items.push({ server });
    return { ownerId:remote.ownerId, items };
  });
}

export function syncOfflineWork(onState: (state: OfflineWorkState | null) => void) {
  return navigator.locks.request("taskboard-offline-work-sync",async () => {
    const remote = await snapshot();
    let local = await merge(remote);
    onState(local);
    let attempted = false;
    for (let item = local?.items.find((record) => record.draft && !record.conflict);
      item; item = local?.items.find((record) => record.draft && !record.conflict)) {
      const key = workKey(item);
      local = await changeItem(remote.ownerId,key,(current) => {
        if (!current.draft || current.conflict || current.sending) return current;
        return { ...current, sending:{
          operationId:current.draft.id, itemId:current.server.id, kind:current.server.kind,
          version:current.server.version, patch:current.draft.patch,
        } };
      });
      const operation = local?.items.find((record) => workKey(record) === key)?.sending;
      if (!operation) continue;
      attempted = true;
      const response = await requestOfflineApi(offlineWorkApi,{
        method:"POST", headers:{ "Content-Type":"application/json" },
        body:JSON.stringify({ ...operation,ownerId:remote.ownerId }),
      });
      if (response.status >= 500 || response.status === 429) throw new Error("The server could not save the queued edit.");
      const result = await response.json();
      local = await changeItem(remote.ownerId,key,(current) => {
        if (current.sending?.operationId !== operation.operationId) return current;
        if (response.ok && result.kind === "saved" && typeof result.version === "string") {
          return {
            server:{ ...current.server,...operation.patch,version:result.version },
            draft:current.draft?.id === operation.operationId ? undefined : current.draft,
          };
        }
        const conflict = result.kind === "conflict"
          ? result.reason === "unavailable" ? "This item is no longer available." : "This item changed on the server."
          : typeof result.error === "string" ? result.error : "This edit needs review.";
        return { ...current, sending:undefined, conflict };
      });
      onState(local);
    }
    if (attempted) onState(await merge(await snapshot()));
  });
}
