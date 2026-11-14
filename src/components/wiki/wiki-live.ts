"use client";
import { useEffect, useRef } from "react";
import { isLiveBusy, setNotesToken } from "@/components/use-live-board-revision";

const eventName = "taskboard-wiki-live";
export function useWikiPoller() {
  useEffect(() => {
    let stopped = false, running = false, failures = 0;
    let notes: string | null = null, boards: string | null = null;
    let timer: ReturnType<typeof setTimeout>;
    let controller: AbortController | undefined;
    const schedule = (delay: number) => { clearTimeout(timer); if (!stopped) timer = setTimeout(() => void check(), delay); };
    const check = async (force = false) => {
      if (running || stopped) return;
      if (document.visibilityState !== "visible") { schedule(10_000); return; }
      running = true;
      controller = new AbortController();
      try {
        const query = new URLSearchParams({ notes: "1" });
        if (boards) query.set("boards", boards);
        const response = await fetch(`/api/live?${query}`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("Live check failed");
        const body = await response.json();
        if (stopped) return;
        const changed = body.notes?.token !== notes || body.boards?.token !== boards;
        notes = body.notes?.token ?? notes; boards = body.boards?.token ?? boards;
        if (notes) setNotesToken(notes);
        if (changed || force) window.dispatchEvent(new Event(eventName));
        failures = 0;
      } catch { failures++; }
      finally { running = false; schedule(failures ? Math.min(60_000, 10_000 * 2 ** failures) : 10_000 + (Math.random() * 4_000 - 2_000)); }
    };
    const focus = () => { if (document.visibilityState === "visible") { clearTimeout(timer); void check(true); } };
    window.addEventListener("focus", focus); document.addEventListener("visibilitychange", focus);
    schedule(0);
    return () => { stopped = true; clearTimeout(timer); controller?.abort(); window.removeEventListener("focus", focus); document.removeEventListener("visibilitychange", focus); };
  }, []);
}
// Retry deferred refreshes without a second poller. Permission responses are
// handled by the callback even while a local document must be preserved.
export function useWikiRefresh(refresh: () => Promise<boolean>) {
  const latest = useRef(refresh);
  useEffect(() => { latest.current = refresh; }, [refresh]);
  useEffect(() => {
    let disposed = false, running = false;
    let timer: ReturnType<typeof setTimeout>;
    let failures = 0;
    const run = async (retry = false) => {
      clearTimeout(timer);
      if (running || disposed) return;
      if (retry && isLiveBusy()) { timer = setTimeout(() => void run(true), 1500); return; }
      running = true;
      let done = false;
      try { done = await latest.current(); failures = 0; } catch { failures++; }
      finally { running = false; }
      if (!done && !disposed) timer = setTimeout(() => void run(true), failures ? Math.min(60_000, 10_000 * 2 ** failures) : 1500);
    };
    const signal = () => void run();
    window.addEventListener(eventName, signal);
    return () => { disposed = true; clearTimeout(timer); window.removeEventListener(eventName, signal); };
  }, []);
}
