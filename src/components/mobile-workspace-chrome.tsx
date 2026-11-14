"use client";


import Link from "next/link";
import { CalendarDays, LayoutDashboard, Menu, MoreHorizontal, Search, Settings2, StickyNote, X } from "lucide-react";
import type { ReactNode, RefObject } from "react";

export function MobileWorkspaceHeader({ title, query, onQueryChange, onMore, menuButtonRef, menuOpen, menuLabel = "Menu", menuId = "phone-workspace-menu", brandAs: Brand = "h1", headerAction }: {
  title: string;
  query: string;
  onQueryChange: (value: string) => void;
  onMore: () => void;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  menuOpen: boolean;
  menuLabel?: string;
  menuId?: string;
  brandAs?: "h1" | "span";
  headerAction?: ReactNode;
}) {
  return <header className="taskboard-mobile-header">
    <Brand className="taskboard-mobile-brand">{title}</Brand>
    <label className="taskboard-mobile-search">
      <Search aria-hidden="true" />
      <input type="search" aria-label={`Search ${title.toLowerCase()}`} placeholder="Search" value={query}
        onChange={event => onQueryChange(event.target.value)}
        onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); event.currentTarget.blur(); } }} />
    </label>
    {headerAction}
    <button ref={menuButtonRef} type="button" aria-label={menuLabel} aria-expanded={menuOpen} aria-controls={menuId} onClick={onMore}><Menu aria-hidden="true" /></button>
  </header>;
}

export function MobileWorkspaceNavigation({ active, notesHref, calendarHref, tasksHref, onMore, menuButtonRef, menuOpen }: {
  active: "notes" | "calendar" | "tasks";
  notesHref: string;
  calendarHref: string;
  tasksHref: string;
  onMore: () => void;
  menuButtonRef: RefObject<HTMLButtonElement | null>;
  menuOpen: boolean;
}) {
  return <nav className="taskboard-mobile-navigation" aria-label="Phone navigation">
    <Link href={tasksHref} aria-current={active === "tasks" ? "page" : undefined}><LayoutDashboard aria-hidden="true" /><span>Tasks</span></Link>
    <Link href={calendarHref} aria-current={active === "calendar" ? "page" : undefined}><CalendarDays aria-hidden="true" /><span>Calendar</span></Link>
    <Link href={notesHref} aria-current={active === "notes" ? "page" : undefined}><StickyNote aria-hidden="true" /><span>Folio</span></Link>
    <button ref={menuButtonRef} type="button" aria-expanded={menuOpen} aria-controls="phone-workspace-menu" onClick={onMore}><MoreHorizontal aria-hidden="true" /><span>More</span></button>
  </nav>;
}

export function PhoneWorkspaceMenu({ active, notesHref, calendarHref, tasksHref, optionsHref, onClose, children }: {
  active: "notes" | "calendar" | "tasks";
  notesHref: string;
  calendarHref: string;
  tasksHref: string;
  optionsHref: string;
  onClose: () => void;
  children?: ReactNode;
}) {
  return <nav id="phone-workspace-menu" aria-label="Workspace menu" className="taskboard-phone-menu">
    <header><span>{active === "notes" ? "Folio" : active === "calendar" ? "Calendar" : "Tasks"}</span>
      <button type="button" aria-label="Close menu" onClick={onClose}><X aria-hidden="true" /><span>Close</span></button>
    </header>
    {children ? <div className="taskboard-phone-menu-context">{children}</div> : null}
    {active !== "calendar" ? <>
      {active !== "notes" ? <Link href={notesHref} onClick={onClose}><StickyNote aria-hidden="true" />Folio</Link> : null}
      <Link href={calendarHref} onClick={onClose}><CalendarDays aria-hidden="true" />Calendar</Link>
      {active !== "tasks" ? <Link href={tasksHref} onClick={onClose}><LayoutDashboard aria-hidden="true" />Tasks</Link> : null}
    </> : null}

    <Link href={optionsHref} onClick={onClose}><Settings2 aria-hidden="true" />Options</Link>
  </nav>;
}
