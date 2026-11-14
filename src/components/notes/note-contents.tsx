"use client";

import { useEditorState } from "@blocknote/react";
import { ListTree, Link2, X } from "lucide-react";
import { createPortal } from "react-dom";
import { useCallback, useEffect, useEffectEvent, useId, useLayoutEffect, useRef, useState } from "react";
import type { notesEditorSchema } from "@/lib/notes-editor-schema";
import type { NoteContentInput } from "@/lib/notes-model";
import { noteOutline, sectionFromHash, sectionHref } from "@/lib/note-outline";
import styles from "./note-contents.module.css";
import { revealPersonalSection } from "./note-section-folds";

export type NoteContentsOptions = {
  noteId: string;
  host: HTMLElement | null;
  railHost?: HTMLElement | null;
  viewerId: string;
  mobile: boolean;
  editing: boolean;
  copySection: (blockId: string, content: NoteContentInput) => Promise<string>;
};

type Editor = typeof notesEditorSchema.BlockNoteEditor;
export function NoteContents({ editor, options, serialize }: { editor: Editor; options: NoteContentsOptions; serialize: () => NoteContentInput }) {
  const { host, railHost, mobile, noteId, viewerId, editing, copySection } = options;
  const blocks = useEditorState({ editor, selector: ({ editor }) => editor.document });
  const headings = noteOutline(blocks, editing);
  const signature = JSON.stringify(headings);
  const [open, setOpen] = useState(false);
  const preferenceKey = `taskboard-folio-contents:v1:${viewerId}`;
  const [railOpen, setRailOpen] = useState(() => { try { return localStorage.getItem(preferenceKey) === "true"; } catch { return false; } });
  const [paneWide, setPaneWide] = useState(false);
  const canDock = paneWide && !mobile && Boolean(railHost);
  const paneHasRoom = useCallback(() => {
    const pane = host?.closest<HTMLElement>(".notes-editor-pane");
    if (!pane || !railHost || mobile) return false;
    const size = Number.parseFloat(getComputedStyle(editor.domElement ?? pane).fontSize) || 16;
    return pane.clientWidth >= Math.max(1000, size * 58 + 240);
  }, [host, railHost, mobile, editor]);
  const visible = canDock ? railOpen : open;
  const rememberRail = (value: boolean) => { setRailOpen(value); try { localStorage.setItem(preferenceKey, String(value)); } catch { /* convenience only */ } };
  useEffect(() => {
    const pane = host?.closest<HTMLElement>(".notes-editor-pane");
    if (!pane || !railHost) return;
    let previous: boolean | undefined;
    const observer = new ResizeObserver(() => {
      // Reserve a rail only when the user's current text size leaves room for
      // prose. Resizing never turns a remembered rail into an unexpected modal.
      const wide = paneHasRoom();
      setPaneWide(wide);
      if (previous !== undefined && previous !== wide) setOpen(false);
      previous = wide;
    });
    observer.observe(pane);
    if (editor.domElement) observer.observe(editor.domElement);
    return () => observer.disconnect();
  }, [host, railHost, editor, paneHasRoom]);
  const [active, setActive] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const [copying, setCopying] = useState(false);
  const [manualLink, setManualLink] = useState("");
  const button = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const linkField = useRef<HTMLInputElement>(null);
  const lastJump = useRef<{ id: string | null; scrollTop: number } | null>(null);
  const contentId = useId();
  const readingBody = useCallback(() => editor.domElement?.closest<HTMLElement>(".notes-editor-body"), [editor]);
  // Escape every ID: imported documents need not use UUIDs.
  const headingElement = useCallback((id: string) => editor.domElement?.querySelector<HTMLElement>(`[data-id="${CSS.escape(id)}"] [data-content-type="heading"]`) ?? null, [editor]);

  const jump = useCallback((id: string | null, keyboard = false) => {
    const root = readingBody();
    if (!root) return false;
    if (!id) { root.scrollTo({ top: 0, behavior: "auto" }); lastJump.current = { id: null, scrollTop: root.scrollTop }; setActive(null); return true; }
    revealPersonalSection(editor, id);
    const heading = headingElement(id);
    if (!heading) return false;
    // BlockNote 0.56 toggle buttons update personal localStorage/DOM state, not
    // document content. Reveal ancestors from outside in, without a transaction.
    const entry = noteOutline(editor.document, true).find(h => h.id === id);
    for (const ancestor of entry?.ancestors ?? []) {
      const wrapper = editor.domElement?.querySelector<HTMLElement>(`[data-node-type="blockContainer"][data-id="${CSS.escape(ancestor)}"]`);
      wrapper?.querySelector<HTMLButtonElement>(":scope > .bn-toggle-wrapper > .bn-toggle-button[aria-expanded=false]")?.click();
    }
    root.scrollTo({ top: root.scrollTop + heading.getBoundingClientRect().top - root.getBoundingClientRect().top - 16, behavior: "auto" });
    lastJump.current = { id, scrollTop: root.scrollTop };
    setActive(id);
    if (keyboard && !editing) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
    return true;
  }, [editor, editing, headingElement, readingBody]);

  // A fragment is resolved only in its matching document, after the editor has
  // mounted. No saved-note lookup or arbitrary same-title fallback is permitted.
  const applyFragment = useEffectEvent(() => {
      const url = new URL(window.location.href);
      if (url.searchParams.get("note") !== noteId) return;
      if (!url.hash) { jump(null); setNotice(""); return; }
      const id = sectionFromHash(url.hash);
      if (!id) return;
      setNotice(jump(id) ? "" : "This section is no longer available.");
  });
  useEffect(() => {
    const apply = () => applyFragment();
    const frame = requestAnimationFrame(apply);
    window.addEventListener("hashchange", apply);
    window.addEventListener("popstate", apply);
    return () => { cancelAnimationFrame(frame); window.removeEventListener("hashchange", apply); window.removeEventListener("popstate", apply); };
    // Heading changes update the outline, never reapply a deep link while typing.
  }, [noteId, editor]);

  useEffect(() => {
    const root = readingBody();
    if (!root) return;
    const entries = noteOutline(editor.document, editing);
    let frame = 0;
    const update = () => {
      frame = 0;
      if (lastJump.current && Math.abs(lastJump.current.scrollTop - root.scrollTop) < 1) { setActive(lastJump.current.id); return; }
      lastJump.current = null;
      const top = root.getBoundingClientRect().top + 18;
      let current: string | null = null;
      for (const entry of entries) {
        const node = headingElement(entry.id);
        if (node?.getClientRects().length && node.getBoundingClientRect().top <= top) current = entry.id;
      }
      setActive(current);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(update); };
    root.addEventListener("scroll", schedule, { passive: true });
    const observer = new ResizeObserver(schedule);
    observer.observe(root); if (editor.domElement) observer.observe(editor.domElement);
    // Image loads and toggle visibility can change heading positions.
    root.addEventListener("load", schedule, true);
    root.addEventListener("click", schedule);
    schedule();
    return () => { root.removeEventListener("scroll", schedule); root.removeEventListener("load", schedule, true); root.removeEventListener("click", schedule); observer.disconnect(); cancelAnimationFrame(frame); };
  }, [editor, editing, signature, headingElement, readingBody]);

  useLayoutEffect(() => {
    if (!open || canDock || !dialog.current) return;
    const node = dialog.current;
    const rect = button.current?.getBoundingClientRect();
    if (rect && !mobile) {
      node.style.setProperty("--contents-left", `${Math.max(12, Math.min(rect.left, window.innerWidth - 304))}px`);
      node.style.setProperty("--contents-top", `${Math.max(12, rect.bottom + 6)}px`);
      node.style.maxHeight = `min(65dvh, ${Math.max(120, window.innerHeight - rect.bottom - 20)}px)`;
    }
    // Use the corrected native-dialog handoff: focus after showModal, before paint.
    node.showModal();
    const target = node.querySelector<HTMLElement>('[aria-current="location"]') ?? node.querySelector<HTMLElement>("[data-contents-jump]");
    target?.focus({ preventScroll: true });
    return () => { node.close(); };
  }, [open, mobile, canDock]);
  useLayoutEffect(() => { if (manualLink) { linkField.current?.focus(); linkField.current?.select(); } }, [manualLink]);
  const close = () => { dialog.current?.close(); setOpen(false); if (canDock) rememberRail(false); setManualLink(""); button.current?.focus({ preventScroll: true }); };

  const select = (id: string | null, keyboard: boolean) => {
    if (!canDock) close();
    // Native dialog closure restores focus before the destination is scrolled.
    requestAnimationFrame(() => {
      if (!jump(id, keyboard)) { setNotice("This section is no longer available."); return; }
      setNotice("");
      if (!noteId.startsWith("new-note-draft:")) {
        const url = new URL(window.location.href);
        url.searchParams.set("note", noteId);
        url.hash = id ? sectionHref(noteId, id).split("#")[1] : "";
        window.history.replaceState(window.history.state, "", url.href);
      }
    });
  };
  const copy = async (id: string, trigger: HTMLButtonElement) => {
    let fallback = false;
    setCopying(true); setNotice(""); setManualLink("");
    try {
      const href = await copySection(id, serialize());
      const url = new URL(href, window.location.origin).href;
      try { await navigator.clipboard.writeText(url); setNotice("Section link copied."); }
      catch { fallback = true; setManualLink(url); setNotice("Copy this section link."); }
    } catch (error) { setNotice(error instanceof Error ? error.message : "Unable to save this section link."); }
    finally { setCopying(false); requestAnimationFrame(() => { if (!fallback && trigger.isConnected && (canDock || dialog.current?.open)) trigger.focus({ preventScroll: true }); }); }
  };

  if (!host) return null;
  const contents = <>
      <header><strong>Contents</strong><button type="button" aria-label="Close contents" onClick={close}><X size={18} /></button></header>
      <nav aria-label="Document sections"><ol>
        <li><button type="button" data-contents-jump aria-current={active === null ? "location" : undefined} onClick={e => select(null, e.detail === 0)}>Top</button></li>
        {headings.map(h => <li key={h.id} style={{ paddingInlineStart: `${Math.min(h.depth, 5) * 12}px` }}>
          <button type="button" data-contents-jump aria-current={active === h.id ? "location" : undefined} title={h.text} onClick={e => select(h.id, e.detail === 0)}>{h.text}</button>
          <button type="button" className={styles.copy} aria-label={`Copy link to ${h.text}`} title="Copy section link" disabled={copying} onClick={e => void copy(h.id, e.currentTarget)}><Link2 size={14} /></button>
        </li>)}
      </ol></nav>
      {!headings.length ? <p>Add headings to create contents.</p> : null}
      {notice ? <p role="status">{notice}</p> : null}
      {manualLink ? <input ref={linkField} aria-label="Section link" readOnly value={manualLink} /> : null}
    </>;
  return <>{createPortal(<>
    <button ref={button} type="button" className="notes-icon-button" aria-label="Contents" title="Contents" aria-haspopup={canDock ? undefined : "dialog"} aria-expanded={visible} aria-controls={contentId} onClick={() => { setNotice(""); const wide = paneHasRoom(); setPaneWide(wide); if (wide) rememberRail(!railOpen); else setOpen(!open); }}><ListTree size={18} /></button>
    {notice && !visible ? <span role="status" className={styles.notice}>{notice}<button type="button" aria-label="Dismiss contents notice" onClick={() => setNotice("")}>×</button></span> : null}
    {open && !canDock ? <dialog ref={dialog} id={contentId} className={styles.panel} data-mobile={mobile} aria-label="Contents" onCancel={e => { e.preventDefault(); close(); }} onClick={e => { if (e.target === e.currentTarget) { const rect = e.currentTarget.getBoundingClientRect(); if (e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom) close(); } }}>{contents}</dialog> : null}
  </>, host)}
  {canDock && railOpen && railHost ? createPortal(<aside id={contentId} className={`${styles.panel} ${styles.rail}`} aria-label="Contents">{contents}</aside>, railHost) : null}</>;
}
