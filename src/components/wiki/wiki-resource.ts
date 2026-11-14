"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { NoteRequestError } from "@/lib/notes-client";
import { useWikiRefresh } from "./wiki-live";

// A scope change or authorization error clears prior results. Same-scope lists
// may stay visible during a refresh; an obsolete response can never restore them.
export function useWikiResource<T>(key: string, load: (signal: AbortSignal) => Promise<T>, preserveWhileLoading = false) {
  const loader = useRef(load);
  useEffect(() => { loader.current = load; }, [load]);
  const generation = useRef(0), controller = useRef<AbortController | null>(null);
  const [state, setState] = useState<{ key: string; value?: T; error?: string }>({ key });
  const refresh = useCallback(async () => {
    const serial = ++generation.current;
    controller.current?.abort();
    const request = new AbortController(); controller.current = request;
    setState(previous => preserveWhileLoading && previous.key === key ? { key, value: previous.value } : { key });
    try { const value = await loader.current(request.signal); if (serial === generation.current && !request.signal.aborted) setState({ key, value }); }
    catch (error) { if (serial === generation.current && !request.signal.aborted) setState(previous => ({ key, value: preserveWhileLoading && previous.key === key && (!(error instanceof NoteRequestError) || error.status >= 500) ? previous.value : undefined, error: error instanceof Error ? error.message : "Unable to load. Try again." })); }
    return true;
  }, [key, preserveWhileLoading]);
  useEffect(() => { const timer = setTimeout(() => void refresh(), 0); return () => { clearTimeout(timer); controller.current?.abort(); }; }, [refresh]);
  useWikiRefresh(refresh);
  return { value: state.key === key ? state.value : undefined, error: state.key === key ? state.error : undefined, refresh };
}
