"use client";

import { createContext, useContext, useEffect, useReducer, useState, type ReactNode } from "react";
import { useLiveNotesToken } from "@/components/use-live-board-revision";
import { extractPageMentionIds } from "@/lib/notes-content-format";
import type { NoteEditorFormatProps } from "@/lib/notes-editor-contract";
import type { WikiMentionResolution } from "@/lib/wiki-discovery-model";
import { resolveWikiMentionsRequest } from "@/lib/wiki-discovery-client";
import { resolveFolioMentionsRequest } from "@/lib/folio-feature-client";

type MentionContext = { editable: boolean; authenticated: boolean; mentions: ReadonlyMap<string, WikiMentionResolution> };
const empty = new Map<string, WikiMentionResolution>();
const Context = createContext<MentionContext>({ editable: false, authenticated: false, mentions: empty });
export const usePageMention = () => useContext(Context);

// The public path never mounts the authenticated subscription or makes a lookup.
export function PageMentionProvider({ blocks, wikiContext, authenticatedMentions=false, editable = false, children }: NoteEditorFormatProps & { blocks: unknown[]; editable?: boolean; children: ReactNode }) {
  return wikiContext||authenticatedMentions
    ? <AuthenticatedMentions key={`${wikiContext?.spaceId??'folio'}:${wikiContext?.noteId ?? "new"}`} folio={authenticatedMentions} blocks={blocks} editable={editable}>{children}</AuthenticatedMentions>
    : <Context value={{ editable, authenticated: false, mentions: empty }}>{children}</Context>;
}

function AuthenticatedMentions({ blocks, editable, children, folio }: { blocks: unknown[]; editable: boolean; children: ReactNode; folio: boolean }) {
  const token = useLiveNotesToken();
  const [epoch, invalidate] = useReducer((value: number) => value + 1, 0);
  const ids = JSON.stringify(extractPageMentionIds(blocks));
  const key = JSON.stringify([folio, ids, token, epoch]);
  const [resolved, setResolved] = useState<{ key: string; mentions: Map<string, WikiMentionResolution> }>();
  useEffect(() => {
    const refresh = () => invalidate();
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", refresh);
    window.addEventListener("taskboard-wiki-live", refresh);
    document.addEventListener("visibilitychange", visible);
    return () => {
      window.removeEventListener("focus", refresh);
      window.removeEventListener("taskboard-wiki-live", refresh);
      document.removeEventListener("visibilitychange", visible);
    };
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    let retry: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const noteIds: string[] = JSON.parse(ids);
        const mentions = new Map<string, WikiMentionResolution>();
        for (let offset = 0; offset < noteIds.length; offset += 100) {
          const chunk = noteIds.slice(offset, offset + 100);
          const result = await (folio ? resolveFolioMentionsRequest : resolveWikiMentionsRequest)({ noteIds: chunk }, controller.signal);
          if (controller.signal.aborted) return;
          for (const item of result) if (chunk.includes(item.noteId)) mentions.set(item.noteId, item);
        }
        if (!controller.signal.aborted) setResolved({ key, mentions });
      } catch {
        // Old titles stay invalidated on failure. Retry without a second poller.
        if (!controller.signal.aborted) retry = setTimeout(invalidate, 10_000);
      }
    };
    void load();
    return () => { controller.abort(); clearTimeout(retry); };
  }, [ids, key, folio]);
  return <Context value={{ editable, authenticated: true, mentions: resolved?.key === key ? resolved.mentions : empty }}>{children}</Context>;
}
