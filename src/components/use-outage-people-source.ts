"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OutagePeopleState } from "@/lib/outage-people";

// One read/poll owner for List and People. Its parent is keyed by task + endpoint.
export function useOutagePeopleSource(endpoint: string, active: boolean, attendeesRevision: string) {
  const [data, setData] = useState<OutagePeopleState | null>(null);
  const [message, setMessage] = useState("Loading people…");
  const latest = useRef<OutagePeopleState | null>(null), alive = useRef(true), pending = useRef(0), epoch = useRef(0);
  const authority = useRef(0);
  const refreshing = useRef<Promise<OutagePeopleState | null> | null>(null);
  const readGuards = useRef(new Set<() => boolean>());
  const listeners = useRef(new Set<(value: OutagePeopleState | null) => void>());
  const listen = useCallback((listener: (value: OutagePeopleState | null) => void) => { listeners.current.add(listener); return () => { listeners.current.delete(listener); }; }, []);
  const blocked = useCallback(() => [...readGuards.current].some(guard => guard()), []);
  const guardReads = useCallback((guard: () => boolean) => {
    readGuards.current.add(guard);
    return () => { readGuards.current.delete(guard); };
  }, []);
  const apply = useCallback((value: OutagePeopleState) => {
    latest.current = value;
    if (alive.current) { setData(value); for (const listener of listeners.current) listener(value); }
  }, []);
  const clear = useCallback(() => {
    epoch.current++; authority.current++;
    latest.current = null;
    if (alive.current) { setData(null); for (const listener of listeners.current) listener(null); }
  }, []);
  const reload = useCallback(async (force = true): Promise<OutagePeopleState | null> => {
    if (!alive.current) return null;
    if (!force && (refreshing.current || blocked() || pending.current || document.visibilityState === "hidden")) return latest.current;
    while (refreshing.current) await refreshing.current;
    if (!alive.current) return null;
    const generation = epoch.current;
    const request = (async () => {
      try {
        const response = await fetch(endpoint, { cache: "no-store", signal: AbortSignal.timeout(15_000), credentials: endpoint.startsWith("/share/") ? "omit" : "same-origin" });
        const result = await response.json().catch(() => ({ error: "Unable to refresh people. Try again." }));
        if (!alive.current) return null;
        if ([401, 403, 404].includes(response.status)) {
          clear(); setMessage(result.error || "This people board is unavailable."); return null;
        }
        if (epoch.current !== generation) return null;
        if (!response.ok) throw new Error(result.error || "Unable to refresh people.");
        if (force || !blocked() && !pending.current) { apply(result); setMessage(""); }
        return result;
      } catch (error) {
        // Overload/transport failures are temporary; retain the authorized snapshot.
        if (alive.current && epoch.current === generation) setMessage(error instanceof Error ? error.message : "Unable to refresh people. Try again.");
        return null;
      }
    })();
    refreshing.current = request;
    try { return await request; } finally { if (refreshing.current === request) refreshing.current = null; }
  }, [apply, blocked, clear, endpoint]);
  const invalidate = useCallback(() => { epoch.current++; authority.current++; }, []);
  useEffect(() => { alive.current = true; return () => { alive.current = false; invalidate(); }; }, [invalidate]);
  useEffect(() => {
    if (!active) return;
    void reload();
    const timer = setInterval(() => void reload(false), 10_000);
    const refresh = () => void reload(false);
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [active, attendeesRevision, reload]);
  const beginMutation = useCallback(() => { pending.current++; epoch.current++; return authority.current; }, []);
  const commitMutation = useCallback((generation: number) => {
    if (!alive.current || generation !== authority.current) return false;
    epoch.current++; return true;
  }, []);
  const endMutation = useCallback(() => { pending.current--; }, []);
  return useMemo(() => ({ data, message, setMessage, latest, alive, pending, apply, clear, reload, guardReads, listen, beginMutation, commitMutation, endMutation }), [data, message, apply, clear, reload, guardReads, listen, beginMutation, commitMutation, endMutation]);
}
export type OutagePeopleSource = ReturnType<typeof useOutagePeopleSource>;
