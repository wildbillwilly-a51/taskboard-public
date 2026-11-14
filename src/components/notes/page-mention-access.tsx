"use client";

import { useEffect, useRef, useState } from "react";
import { useLiveNotesToken } from "@/components/use-live-board-revision";
import { fetchNote, isNoteUnavailableError } from "@/lib/notes-client";
import type { NoteDetail } from "@/lib/notes-model";
import { noteDraftStore } from "./use-note-drafts";

type Access = Pick<NoteDetail, "canEdit" | "wiki" | "deletedAt">;
// Hosts gate title autosave too, without eagerly bundling BlockNote into Notes.
export function useNoteFormatSupport(blocks: unknown, version = 1) {
  const [validate, setValidate] = useState<((blocks: unknown, version: number) => boolean) | null>(null);
  useEffect(() => {
    let active = true;
    void import("@/lib/notes-editor-schema").then(module => { if (active) setValidate(() => module.canRenderNoteContent); }, () => { /* Keep writes gated if the editor chunk could not load. */ });
    return () => { active = false; };
  }, []);
  // Untouched new drafts have no schema-dependent content; preserve immediate
  // title autofocus while the editor chunk loads. Existing content waits.
  return Array.isArray(blocks) && blocks.length === 0 && (version === 1 || version === 2) ? true : validate ? validate(blocks, version) : false;
}
// Permission refresh must not wait for a dirty body, focus, or the shared body
// refresh queue. Merge access only; never install a version or replace a draft.
export function useWikiNoteAccess(noteId: string | undefined, apply: (access: Access) => void) {
  const token = useLiveNotesToken();
  const callback = useRef(apply);
  useEffect(() => { callback.current = apply; }, [apply]);
  useEffect(() => {
    if (!noteId) return;
    let controller: AbortController | undefined;
    const refresh = () => {
      controller?.abort();
      const request = new AbortController(); controller = request;
      void fetchNote(noteId, request.signal).then(note => {
        if (request.signal.aborted) return;
        noteDraftStore.suspend(noteId, !note.canEdit || Boolean(note.deletedAt) || Boolean(note.wiki?.spaceArchived));
        callback.current({ canEdit: note.canEdit, wiki: note.wiki, deletedAt: note.deletedAt });
      }, error => {
        if (!request.signal.aborted && isNoteUnavailableError(error)) {
          noteDraftStore.suspend(noteId);
          callback.current({ canEdit: false, deletedAt: null, wiki: undefined });
        }
      });
    };
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("taskboard-wiki-live", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      controller?.abort(); window.removeEventListener("focus", refresh);
      window.removeEventListener("taskboard-wiki-live", refresh); document.removeEventListener("visibilitychange", visible);
    };
  }, [noteId, token]);
}
