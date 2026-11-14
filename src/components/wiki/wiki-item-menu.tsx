"use client";

import { useEffect, useId, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpRight, BookOpen, Copy, FileText, History, MoreHorizontal, Plus, Settings2 } from "lucide-react";
import { ContextMenu, type ContextMenuAction, type ContextMenuAnchor } from "@/components/ui/context-menu";
import { hasSelectionWithin, isContextMenuKey, keepsNativeContextMenu } from "@/lib/context-menu-request";
import type { WikiSpaceSummary } from "@/lib/wiki-model";
import { WikiButton } from "./wiki-controls";

export type WikiMenuAction = ContextMenuAction;
export const wikiMenuOpenEvent = "taskboard:wiki-menu-open";
const menuClasses = {
  menu: "taskboard-shell wiki-context-menu",
  heading: "wiki-menu-heading",
  // The explicit editor role owns sizing. The generic ui-menu-item role also
  // opts into Board density rules when this portal sits inside a drawer.
  item: "wiki-menu-item ed-menu-item",
  danger: "wiki-menu-danger",
  separated: "wiki-menu-separated",
};

/** One action list serves the visible button, row background and Menu key.
 * Real links, selected text and rich editors keep the browser's own menu. */
export function WikiItemMenu({ label, actions, children, className = "", onOpen }: {
  label: string; actions: WikiMenuAction[]; children?: ReactNode; className?: string; onOpen?: () => void;
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const id = useId();
  const [anchor, setAnchor] = useState<ContextMenuAnchor | null>(null);
  const close = (restore: boolean) => { setAnchor(null); if (restore) trigger.current?.focus({ preventScroll: true }); };
  const open = (point?: { x: number; y: number }) => {
    if (!trigger.current) return;
    window.dispatchEvent(new Event(wikiMenuOpenEvent));
    onOpen?.();
    const box = trigger.current.getBoundingClientRect();
    setAnchor({ trigger: trigger.current, x: point?.x ?? box.left, y: point?.y ?? box.bottom + 4 });
  };
  useEffect(() => {
    if (!anchor) return;
    const dismiss = () => setAnchor(null);
    const command = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k" && !event.isComposing) dismiss(); };
    window.addEventListener("popstate", dismiss); window.addEventListener("keydown", command, true); window.addEventListener(wikiMenuOpenEvent, dismiss);
    return () => { window.removeEventListener("popstate", dismiss); window.removeEventListener("keydown", command, true); window.removeEventListener(wikiMenuOpenEvent, dismiss); };
  }, [anchor]);
  const context = (event: MouseEvent<HTMLDivElement>) => {
    const native = event.nativeEvent;
    if (keepsNativeContextMenu(event.target, { defaultPrevented: event.defaultPrevented, hasSelection: hasSelectionWithin(event.target), pointerType: "pointerType" in native ? String(native.pointerType) : undefined })) return;
    event.preventDefault(); event.stopPropagation(); open({ x: event.clientX, y: event.clientY });
  };
  return <div className={`wiki-item-menu ${className}`} onContextMenu={context}>
    {children}
    <WikiButton type="button" variant="icon" ref={trigger} className="wiki-item-menu-trigger" aria-label={label} title={label} aria-haspopup="menu" aria-expanded={Boolean(anchor)} aria-controls={anchor ? id : undefined}
      onClick={() => anchor ? close(true) : open()} onKeyDown={event => {
        if (isContextMenuKey(event) || event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); event.stopPropagation(); open(); }
      }}><MoreHorizontal aria-hidden="true" /></WikiButton>
    {anchor ? <ContextMenu id={id} anchor={anchor} label={label} actions={actions} classNames={menuClasses} onClose={close}
      portalTarget={anchor.trigger.closest<HTMLDialogElement>("dialog[open]")} /> : null}
  </div>;
}

/** Navigation actions do not need a content-version write or duplicate the
 * editor's mutation queue. Editing/destructive actions remain on the page. */
export function WikiLinkMenu({ href, title, kind = "page", noteId, actions = [], children, className = "", onNavigate }: {
  href: string; title: string; kind?: "page" | "space" | "topic"; noteId?: string; actions?: WikiMenuAction[]; children: ReactNode; className?: string; onNavigate?: () => void;
}) {
  const router = useRouter();
  const [error, setError] = useState("");
  const icon = kind === "space" ? <BookOpen aria-hidden="true" /> : <FileText aria-hidden="true" />;
  const go = (path: string) => () => { onNavigate?.(); router.push(path); };
  const items: WikiMenuAction[] = [
    { label: `Open ${kind}`, icon, run: go(href), focus: "handoff" },
    { label: "Open in new tab", icon: <ArrowUpRight aria-hidden="true" />, run: () => { window.open(href, "_blank", "noopener,noreferrer"); }, focus: "handoff" },
    ...(kind === "page" ? [{ label: "History", icon: <History aria-hidden="true" />, run: go(`${href}?view=history`), focus: "handoff" as const }] : []),
    ...(noteId ? [{ label: "Open Notes details", icon: <FileText aria-hidden="true" />, run: go(`/notes?note=${noteId}`), focus: "handoff" as const }] : []),
    { label: "Copy link", icon: <Copy aria-hidden="true" />, run: () => { void (async () => { try { await navigator.clipboard.writeText(new URL(href, window.location.origin).href); } catch { setError("Unable to copy the link. Use the page address instead."); } })(); } },
    ...actions,
  ];
  return <div className={`wiki-link-menu ${className}`}><WikiItemMenu label={`${kind[0].toUpperCase() + kind.slice(1)} actions for ${title}`} actions={items} onOpen={() => setError("")}>{children}</WikiItemMenu>{error ? <p className="wiki-menu-error" role="alert">{error}</p> : null}</div>;
}

export function WikiSpaceMenu({ space, children, className, onNavigate }: { space: WikiSpaceSummary; children: ReactNode; className?: string; onNavigate?: () => void }) {
  const router = useRouter();
  const actions: WikiMenuAction[] = [];
  if (space.canEdit && !space.archivedAt) actions.push({ label: "New page", icon: <Plus aria-hidden="true" />, run: () => { onNavigate?.(); router.push(`/wiki?new=1&spaceId=${space.id}`); }, focus: "handoff", separator: true });
  if (space.canManage) actions.push({ label: "Space settings", icon: <Settings2 aria-hidden="true" />, run: () => { onNavigate?.(); router.push(`/wiki/${space.slug}?settings=1`); }, focus: "handoff", separator: !actions.length });
  return <WikiLinkMenu href={`/wiki/${space.slug}`} title={space.title} kind="space" actions={actions} className={className} onNavigate={onNavigate}>{children}</WikiLinkMenu>;
}
