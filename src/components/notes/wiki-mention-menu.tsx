"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useBlockNoteEditor, useExtension, useExtensionState } from "@blocknote/react";
import { SuggestionMenu } from "@blocknote/core/extensions";
import { searchWikiPagesRequest } from "@/lib/wiki-discovery-client";
import type { WikiSearchHit } from "@/lib/wiki-discovery-model";
import { wikiLabels } from "@/lib/wiki-labels";
import { useLiveNotesToken } from "@/components/use-live-board-revision";
import {discoverNotes} from '@/lib/folio-feature-client';

// Keep BlockNote's trigger/query/selection mapping, with our own async menu so
// empty/error results remain open and permission invalidations clear old titles.
export function WikiMentionMenu({folio=false}:{folio?:boolean}) {
  const editor = useBlockNoteEditor();
  const menu = useExtension(SuggestionMenu);
  const state = useExtensionState(SuggestionMenu);
  const token = useLiveNotesToken();
  const [archived, setArchived] = useState(false);
  const active = state?.show && (state.triggerCharacter === "[["||folio&&state.triggerCharacter==='@');
  useEffect(() => {
    menu.addSuggestionMenu({ triggerCharacter: "[[", shouldOpen: () => editor.isEditable && !editor.prosemirrorView.composing });
    if(folio)menu.addSuggestionMenu({triggerCharacter:'@',shouldOpen:tr=>{if(!editor.isEditable||editor.prosemirrorView.composing)return false;const p=tr.selection.from,before=tr.doc.textBetween(Math.max(0,p-1),p,' ',' ');return !before||/[\s([{]/.test(before);}});
    return () => { menu.removeSuggestionMenu("[[");if(folio)menu.removeSuggestionMenu('@'); if (["[[",'@'].includes(menu.store.state?.triggerCharacter??'')) menu.closeMenu(); };
  }, [editor, menu,folio]);
  return active ? <MentionResults key={JSON.stringify([state.query, token])} query={state.query} rect={state.referencePos} archived={archived} setArchived={setArchived} folio={folio}/> : null;
}

function MentionResults({ query, rect, archived, setArchived,folio }: { query: string; rect: DOMRect; archived: boolean; setArchived: React.Dispatch<React.SetStateAction<boolean>>;folio:boolean }) {
  const [manualQuery,setManualQuery]=useState<string|null>(null);const search=manualQuery??query;
  const editor = useBlockNoteEditor();
  const menu = useExtension(SuggestionMenu);
  const id = useId();
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<{ key: string; pages: WikiSearchHit[]; error?: boolean }>();
  const [index, setIndex] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const key = JSON.stringify([search, archived, attempt,folio]);
  const current = result?.key === key ? result : undefined;
  const pages = current?.pages ?? [];
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(() => {
      const request=folio?discoverNotes({q:search,titleOnly:true,recent:!search},controller.signal).then(async r=>!search&&!r.notes.length?discoverNotes({titleOnly:true},controller.signal):r).then(r=>({pages:r.notes.map(n=>({id:n.id,title:n.title,href:`/folio?note=${n.id}`,spaceId:'folio',spaceTitle:n.pageSpaceId?'Space page':'Folio',updatedAt:n.updatedAt,archived:false,snippet:[]}))})):searchWikiPagesRequest({ q: search, limit: 20, includeArchivedSpaces: archived }, controller.signal);
      void request.then(
        response => { if (!controller.signal.aborted) setResult({ key, pages: response.pages }); },
        () => { if (!controller.signal.aborted) setResult({ key, pages: [], error: true }); },
      );
    }, 180);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [search, archived, key,folio]);
  useEffect(() => {
    const invalidate = () => { menu.closeMenu(); };
    window.addEventListener("taskboard-wiki-live", invalidate);
    window.addEventListener("blur", invalidate);
    return () => { window.removeEventListener("taskboard-wiki-live", invalidate); window.removeEventListener("blur", invalidate); };
  }, [menu]);
  const select = (page: WikiSearchHit) => {
    if (!editor.isEditable || editor.prosemirrorView.composing) return;
    menu.closeMenu(); menu.clearQuery();
    editor.insertInlineContent([{ type: "pageMention", props: { noteId: page.id.toLowerCase() } }, " "] as never);
    editor.focus();
  };
  useEffect(() => {
    const dom = editor.domElement;
    if (!dom) return;
    dom.setAttribute("aria-controls", id);
    dom.setAttribute("aria-expanded", "true");
    if (pages[index]) dom.setAttribute("aria-activedescendant", `${id}-${index}`);
    else dom.removeAttribute("aria-activedescendant");
    const keydown = (event: KeyboardEvent) => {
      if (event.isComposing || editor.prosemirrorView.composing) {
        // Let the browser commit IME text, but do not let ProseMirror's Enter
        // binding split the block or a suggestion binding select a page.
        if (event.key === "Enter") event.stopImmediatePropagation();
        return;
      }
      if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); menu.closeMenu(); editor.focus(); }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault(); event.stopImmediatePropagation();
        setIndex(value => pages.length ? (value + (event.key === "ArrowDown" ? 1 : -1) + pages.length) % pages.length : 0);
      }
      if (event.key === "Enter") {
        if (!pages[index]) { menu.closeMenu(); return; }
        event.preventDefault(); event.stopImmediatePropagation();
        select(pages[index]);
      }
    };
    dom.addEventListener("keydown", keydown, true);
    return () => {
      dom.removeEventListener("keydown", keydown, true);
      dom.removeAttribute("aria-controls"); dom.removeAttribute("aria-expanded"); dom.removeAttribute("aria-activedescendant");
    };
    // Selection handlers deliberately follow the current query's results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, menu, id, pages, index]);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target) && !editor.domElement?.contains(event.target)) menu.closeMenu();
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [editor, menu]);
  const viewport = window.visualViewport;
  const left = Math.max(8, Math.min(rect.left, (viewport?.width ?? window.innerWidth) - 328));
  const top = Math.max(8, Math.min(rect.bottom + 4, (viewport?.height ?? window.innerHeight) + (viewport?.offsetTop ?? 0) - 290));
  return createPortal(<div ref={root} className="wiki-mention-menu" style={{ left, top }} onPointerDown={event => {if(!(event.target instanceof HTMLInputElement))event.preventDefault();}} onKeyDown={event => { if (event.key === "Escape") { menu.closeMenu(); editor.focus(); }if(event.target instanceof HTMLInputElement){if(['ArrowUp','ArrowDown'].includes(event.key)){event.preventDefault();setIndex(i=>pages.length?(i+(event.key==='ArrowDown'?1:-1)+pages.length)%pages.length:0);}if(event.key==='Enter'&&pages[index]){event.preventDefault();select(pages[index]);}} }}>
    <div className="wiki-mention-menu-heading">{folio?'Link a note':`Link a ${wikiLabels.page.toLowerCase()}`}</div>
    {folio?<input aria-label="Search notes" placeholder="Search note titles…" value={search} onChange={e=>{setManualQuery(e.target.value);setIndex(0);}}/>:<button type="button" aria-pressed={archived} onClick={() => { setArchived(value => !value); setIndex(0); }}>Include archived spaces</button>}
    {!current ? <p role="status">Searching…</p> : current.error ? <p role="alert">Unable to find pages. <button type="button" onClick={() => setAttempt(value => value + 1)}>Retry</button></p> : !pages.length ? <p role="status">No matching pages.</p> : null}
    <div id={id} role="listbox" aria-label="Pages to link">
      {pages.map((page, i) => <button type="button" role="option" id={`${id}-${i}`} aria-selected={index === i} key={page.id} onClick={() => select(page)}>
        <span>{page.title || "Untitled page"}</span><small>{page.spaceTitle}{page.archived ? " · Archived" : ""}</small>
      </button>)}
    </div>
  </div>, document.body);
}
