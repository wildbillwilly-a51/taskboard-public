"use client";

import { useCallback, useState, useSyncExternalStore } from "react";
import { PHONE_MEDIA_QUERY } from "@/lib/phone-layout";

type Overrides = Readonly<Record<string, boolean>>;
const emptyOverrides: Overrides = Object.freeze({});
const prefix = "taskboard-subtask-expansion:v1:";
const listeners = new Set<() => void>();
const cache = new Map<string, { raw: string | null; overrides: Overrides }>();
const memoryOverrides = new Map<string, Overrides>();

// Public shares have no viewer identity. Never include their bearer token.
export function subtaskExpansionKey(taskId: string, viewerId?: string) {
  return prefix + JSON.stringify([viewerId ?? null, taskId]);
}

export function parseSubtaskExpansion(raw: string | null): Overrides {
  if (!raw) return emptyOverrides;
  try {
    const value = JSON.parse(raw);
    if (value?.version !== 1 || !value.overrides || typeof value.overrides !== "object" || Array.isArray(value.overrides)) {
      return emptyOverrides;
    }
    return Object.fromEntries(Object.entries(value.overrides).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
  } catch {
    return emptyOverrides;
  }
}

export function isSubtaskExpanded(overrides: Overrides, taskId: string, depth: number, phone: boolean) {
  return Object.hasOwn(overrides, taskId) ? overrides[taskId] : !phone && depth === 0;
}

function readOverrides(key: string): Overrides {
  const memory = memoryOverrides.get(key);
  if (memory) return memory;
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(key);
  } catch {
    // Browser storage is optional; toggles still work for this session.
    return cache.get(key)?.overrides ?? emptyOverrides;
  }
  const previous = cache.get(key);
  if (previous?.raw === raw) return previous.overrides;
  const overrides = parseSubtaskExpansion(raw);
  cache.set(key, { raw, overrides });
  return overrides;
}

function updateOverride(key: string, taskId: string, expanded: boolean) {
  const overrides = { ...readOverrides(key), [taskId]: expanded };
  const raw = JSON.stringify({ version: 1, overrides });
  try {
    window.localStorage.setItem(key, raw);
    memoryOverrides.delete(key);
  } catch {
    memoryOverrides.set(key, overrides);
  }
  cache.set(key, { raw, overrides });
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key.startsWith(prefix)) {
      if (event.key === null) memoryOverrides.clear();
      else memoryOverrides.delete(event.key);
      listener();
    }
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function subscribePhone(listener: () => void) {
  const media = window.matchMedia(PHONE_MEDIA_QUERY);
  media.addEventListener("change", listener);
  return () => media.removeEventListener("change", listener);
}

const getPhoneSnapshot = () => window.matchMedia(PHONE_MEDIA_QUERY).matches;
// Until the viewport is known, keep branches shut so phones never flash open.
const getServerPhoneSnapshot = () => true;
const getServerOverrides = () => emptyOverrides;

// Mount once per viewer/task visit, above List/Timeline and the recursive rows.
export function useSubtaskExpansion(taskId: string, viewerId?: string) {
  const key = subtaskExpansionKey(taskId, viewerId);
  const phone = useSyncExternalStore(subscribePhone, getPhoneSnapshot, getServerPhoneSnapshot);
  const getSnapshot = useCallback(() => readOverrides(key), [key]);
  const saved = useSyncExternalStore(subscribe, getSnapshot, getServerOverrides);
  const [mobileOverrides, setMobileOverrides] = useState<Overrides>(emptyOverrides);
  const overrides = phone ? mobileOverrides : saved;
  return {
    isOpen: (id: string, depth: number) => isSubtaskExpanded(overrides, id, depth, phone),
    setOpen: (id: string, expanded: boolean) => {
      if (phone) setMobileOverrides(current => ({ ...current, [id]: expanded }));
      else updateOverride(key, id, expanded);
    },
  };
}
