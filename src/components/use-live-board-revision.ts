"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import type { AccessibleBoardSummary } from "@/lib/board-access";

// Live updates. The database bumps a board's revision on every real change,
// and a note scope's revision on every note change, whoever made it (another
// user, another device, another client or
// agent). One poller per page asks GET /api/live while the page is visible:
// the shown board's revision, the board list's token, and the Notes token when
// something on the page shows notes. Each view reloads only what moved, and
// only when that cannot disturb what the viewer is doing.

const CHECK_INTERVAL_MS = 10_000;
const CHECK_JITTER_MS = 2_000;
const BUSY_RETRY_MS = 1_000;
const MAX_BACKOFF_MS = 60_000;

// Writes in flight on this page. A reload waits for them, so it never
// replaces an optimistic change with a snapshot taken before that change
// saved; a load that started before a write finished is thrown away
// (writeGeneration) and done again.
let boardWritesInFlight = 0;
let writeGeneration = 0;
// Interactions a reload must not land in, such as a calendar drag.
let holds = 0;
const writesSettledListeners = new Set<() => void>();

function settled() {
  if (boardWritesInFlight === 0 && holds === 0) {
    writesSettledListeners.forEach((listener) => listener());
  }
}

export async function trackBoardWrite<T>(write: Promise<T>): Promise<T> {
  boardWritesInFlight += 1;
  try {
    return await write;
  } finally {
    boardWritesInFlight -= 1;
    writeGeneration += 1;
    settled();
  }
}

// Holds reloads until the returned release is called (once).
export function holdLiveRefresh() {
  holds += 1;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    holds -= 1;
    settled();
  };
}

// Typing anywhere that feeds a save holds the reload until focus leaves it.
// Search boxes only filter what is shown, so they do not hold it.
function isEditingFocused() {
  const element = document.activeElement;
  if (!(element instanceof HTMLElement) || element.matches("input[type=search]") || element.closest("[data-live-refresh-ok]")) {
    return false;
  }
  return element.isContentEditable || element.matches("input, textarea, select");
}

export function isLiveBusy() {
  return boardWritesInFlight > 0 || holds > 0 || isEditingFocused();
}

export function liveWriteGeneration() {
  return writeGeneration;
}

// The Notes token from the last poll, for views that show notes. Polling asks
// for it only while one of them is mounted.
let notesToken: string | null = null;
let notesSubscribers = 0;
const notesTokenListeners = new Set<() => void>();

export function setNotesToken(token: string) {
  if (token === notesToken) return;
  notesToken = token;
  notesTokenListeners.forEach((listener) => listener());
}

export function useLiveNotesToken() {
  useEffect(() => {
    notesSubscribers += 1;
    return () => {
      notesSubscribers -= 1;
    };
  }, []);
  return useSyncExternalStore(
    (listener) => {
      notesTokenListeners.add(listener);
      return () => notesTokenListeners.delete(listener);
    },
    () => notesToken,
    () => null,
  );
}

// Runs refresh whenever key changes, and again until it reports that it put
// its result on screen: it is retried while the page is busy, after a
// failure, or when it threw its result away. refresh receives isCurrent, false
// once the key moved on or the view unmounted. A null key does nothing.
export function useLiveRefresh(key: string | null, refresh: (isCurrent: () => boolean) => Promise<boolean>) {
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (key === null) return;
    let disposed = false;
    let running = false;
    let failures = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const isCurrent = () => !disposed;

    const attempt = async () => {
      clearTimeout(timer);
      if (disposed || running) return;
      if (isLiveBusy()) {
        timer = setTimeout(() => void attempt(), BUSY_RETRY_MS);
        return;
      }
      running = true;
      let done = false;
      try {
        done = await refreshRef.current(isCurrent);
        failures = 0;
      } catch {
        failures += 1;
      } finally {
        running = false;
      }
      if (!disposed && !done) {
        timer = setTimeout(() => void attempt(), failures ? Math.min(MAX_BACKOFF_MS, CHECK_INTERVAL_MS * 2 ** failures) : BUSY_RETRY_MS);
      }
    };
    const onSettled = () => {
      if (!running) void attempt();
    };

    writesSettledListeners.add(onSettled);
    void attempt();
    return () => {
      disposed = true;
      clearTimeout(timer);
      writesSettledListeners.delete(onSettled);
    };
  }, [key]);
}

// A load is safe to show if nothing started meanwhile.
export function canApplyLiveLoad(generation: number) {
  return generation === writeGeneration && !isLiveBusy();
}

export type LiveBoardSnapshot = {
  // Revision the loaded snapshot represents.
  revision: number;
  // Puts the snapshot on screen.
  apply: () => void;
};

type Options = {
  boardId: string;
  // Revision of the board currently on screen; undefined turns updates off.
  revision: number | undefined;
  enabled: boolean;
  // View-specific interactions that must finish first (a drag, for example).
  isBusy: () => boolean;
  load: () => Promise<LiveBoardSnapshot | null>;
  // The board list changed (shared, unshared, renamed, access level).
  onBoards?: (boards: AccessibleBoardSummary[], personalBoardId: string | null) => void;
  // The shown board can no longer be opened; it stops refreshing.
  onBoardUnavailable?: (status: "forbidden" | "not_found") => void;
};

type LiveResponse = {
  board?: { status: "ok"; revision: number } | { status: "forbidden" | "not_found" };
  boards?: { token: string; boards?: AccessibleBoardSummary[]; personalBoardId?: string | null };
  notes?: { token: string };
};

export function useLiveBoardRevision({ boardId, revision, enabled, isBusy, load, onBoards, onBoardUnavailable }: Options) {
  const shownRevision = useRef(revision ?? 0);
  const isBusyRef = useRef(isBusy);
  const loadRef = useRef(load);
  const onBoardsRef = useRef(onBoards);
  const onBoardUnavailableRef = useRef(onBoardUnavailable);
  const boardsTokenRef = useRef<string | null>(null);
  const checkNowRef = useRef<() => void>(() => {});

  useEffect(() => {
    shownRevision.current = Math.max(shownRevision.current, revision ?? 0);
  }, [revision]);
  useEffect(() => {
    isBusyRef.current = isBusy;
    loadRef.current = load;
    onBoardsRef.current = onBoards;
    onBoardUnavailableRef.current = onBoardUnavailable;
  }, [isBusy, load, onBoards, onBoardUnavailable]);
  // A different board starts from its own revision.
  useEffect(() => {
    shownRevision.current = revision ?? 0;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  const active = enabled && revision !== undefined;

  useEffect(() => {
    if (!active) return;

    let disposed = false;
    let checking = false;
    let applying = false;
    // The shown board can no longer be opened; the other channels go on.
    let boardStopped = false;
    let latestRevision = 0;
    let failures = 0;
    let checkTimer: ReturnType<typeof setTimeout> | undefined;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;

    const busy = () => isLiveBusy() || isBusyRef.current();

    const tryApply = async () => {
      clearTimeout(retryTimer);
      if (disposed || applying || boardStopped || latestRevision <= shownRevision.current) return;
      if (busy()) {
        retryTimer = setTimeout(() => void tryApply(), BUSY_RETRY_MS);
        return;
      }
      applying = true;
      try {
        const snapshot = await loadRef.current();
        if (disposed || !snapshot) return;
        // Something started meanwhile, or this page already shows a newer
        // save: keep what is on screen and try again shortly.
        if (busy()) {
          retryTimer = setTimeout(() => void tryApply(), BUSY_RETRY_MS);
          return;
        }
        if (snapshot.revision < shownRevision.current) return;
        shownRevision.current = snapshot.revision;
        latestRevision = Math.max(latestRevision, snapshot.revision);
        snapshot.apply();
      } finally {
        applying = false;
      }
    };

    const scheduleCheck = (delay: number) => {
      clearTimeout(checkTimer);
      if (!disposed) checkTimer = setTimeout(() => void check(), delay);
    };

    const check = async () => {
      if (disposed || checking) return;
      if (document.visibilityState !== "visible") {
        scheduleCheck(CHECK_INTERVAL_MS);
        return;
      }
      checking = true;
      controller = new AbortController();
      try {
        const params = new URLSearchParams();
        if (!boardStopped) params.set("boardId", boardId);
        if (boardsTokenRef.current) params.set("boards", boardsTokenRef.current);
        if (notesSubscribers > 0) params.set("notes", "1");
        const response = await fetch(`/api/live?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (disposed) return;
        if (!response.ok) throw new Error(`Live check failed with status ${response.status}`);
        const body = (await response.json()) as LiveResponse;
        failures = 0;
        if (body.boards?.boards) {
          onBoardsRef.current?.(body.boards.boards, body.boards.personalBoardId ?? null);
        }
        if (body.boards?.token) boardsTokenRef.current = body.boards.token;
        if (body.notes?.token) setNotesToken(body.notes.token);
        if (body.board && body.board.status !== "ok" && !boardStopped) {
          boardStopped = true;
          onBoardUnavailableRef.current?.(body.board.status);
        } else if (body.board?.status === "ok") {
          latestRevision = Math.max(latestRevision, Number(body.board.revision ?? 0));
          void tryApply();
        }
      } catch (error) {
        if (disposed || (error instanceof Error && error.name === "AbortError")) return;
        failures += 1;
      } finally {
        checking = false;
      }
      const backoff = failures ? Math.min(MAX_BACKOFF_MS, CHECK_INTERVAL_MS * 2 ** failures) : 0;
      scheduleCheck(backoff || CHECK_INTERVAL_MS + (Math.random() * 2 - 1) * CHECK_JITTER_MS);
    };

    const checkNow = () => {
      failures = 0;
      scheduleCheck(0);
    };
    const resume = () => {
      if (document.visibilityState === "visible") checkNow();
    };
    const onSettled = () => void tryApply();

    checkNowRef.current = checkNow;
    writesSettledListeners.add(onSettled);
    window.addEventListener("focus", resume);
    document.addEventListener("visibilitychange", resume);
    scheduleCheck(CHECK_INTERVAL_MS);

    return () => {
      disposed = true;
      controller?.abort();
      clearTimeout(checkTimer);
      clearTimeout(retryTimer);
      writesSettledListeners.delete(onSettled);
      window.removeEventListener("focus", resume);
      document.removeEventListener("visibilitychange", resume);
      checkNowRef.current = () => {};
    };
  }, [active, boardId]);

  // Ask right away, e.g. after this page saved calendar or note changes, or
  // when another tab reports a change.
  return useCallback(() => checkNowRef.current(), []);
}
