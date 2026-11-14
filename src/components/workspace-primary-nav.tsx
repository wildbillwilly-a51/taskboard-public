"use client";

import Link from "next/link";
import { CalendarDays, LayoutDashboard, StickyNote } from "lucide-react";
import type { RefObject } from "react";
import { SMALL_CHIP_BUTTON_CLASS } from "./taskboard-constants";


type Workspace = "tasks" | "calendar" | "notes" | "wiki";

export function WorkspacePrimaryNav({ active, tasksHref = "/", calendarHref = "/calendar", notesHref = "/folio", navRef }: {
  active: Workspace;
  tasksHref?: string;
  calendarHref?: string;
  notesHref?: string;
  navRef?: RefObject<HTMLDivElement | null>;
}) {
  const items = [
    { id: "tasks", label: "Tasks", href: tasksHref, icon: LayoutDashboard },
    { id: "calendar", label: "Calendar", href: calendarHref, icon: CalendarDays },
    { id: "notes", label: "Folio", href: notesHref, icon: StickyNote },
  ];
  return <div ref={navRef} role="navigation" className="taskboard-primary-nav wiki-workspace-nav flex items-center gap-1" aria-label="Workspace navigation">
    {items.map(({ id, label, href, icon: Icon }) => <Link key={id} href={href}
      className={`taskboard-view-mode-button ${SMALL_CHIP_BUTTON_CLASS} ${active === id ? "ui-chip-active" : ""}`}
      aria-current={active === id ? "page" : undefined}><Icon aria-hidden="true" />{label}</Link>)}
  </div>;
}

// Keep route-link semantics, including modified clicks, using the established
// workspace tabs' visual role rather than introducing another control scale.
export function WorkspaceSubviews({ kind, active, items, onSelect }: {
  kind: "Tasks" | "Calendar";
  active: string;
  items: Array<{ id: string; label: string; href: string }>;
  onSelect?: (id: string) => void;
}) {
  return <nav className="workspace-subviews task-workspace-tabs" aria-label={`${kind} views`}>
    {items.map(item => <Link key={item.id} href={item.href} scroll={false}
      className={active === item.id ? "ui-chip-active" : undefined}
      aria-current={active === item.id ? "page" : undefined}
      onNavigate={onSelect ? event => { event.preventDefault(); onSelect(item.id); } : undefined}>
      {item.label}
    </Link>)}
  </nav>;
}
