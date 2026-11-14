"use client";

import Link from "next/link";
import { BookOpen, CalendarDays, LayoutDashboard, Settings2, StickyNote } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { WikiNavigation } from "./wiki-navigation";
import { WikiDialog } from "./wiki-dialog";
import { wikiLabels, wikiProductName } from "@/lib/wiki-labels";
import { useWikiPoller } from "./wiki-live";
import { CommandPalette, type PaletteMode } from "@/components/taskboard-command-palette";
import { WikiNavigationProvider } from "./wiki-navigation-context";
import { WikiWorkspaceHeader } from "./wiki-workspace-header";
import { buildOptionsHref } from "@/lib/options-return";
import { WikiButton, WikiControlsProvider } from "./wiki-controls";
import { fetchWikiSpaces } from "@/lib/wiki-client";
import { wikiMenuOpenEvent } from "./wiki-item-menu";

export function WikiShell(props: { displayName: string; children: ReactNode }) {
  return <WikiControlsProvider><WikiNavigationProvider><WikiShellContent {...props} /></WikiNavigationProvider></WikiControlsProvider>;
}

function WikiShellContent({ displayName, children }: { displayName: string; children: ReactNode }) {
  useWikiPoller();
  const router = useRouter(), pathname = usePathname(), query = useSearchParams();
  const [commandError, setCommandError] = useState("");
  const commandGeneration = useRef(0);
  const [palette, setPalette] = useState<PaletteMode | null>(null), [drawer, setDrawer] = useState(false);
  // The palette is global to Wiki. Search/history/new-draft query changes
  // don't change its command scope; a different page path does.
  const navigationScope = pathname;
  useEffect(() => { ++commandGeneration.current; }, [navigationScope]);
  const commands = useCallback(() => {
    if (document.querySelector("dialog[open]")) return;
    const generation = ++commandGeneration.current;
    const location = window.location.pathname;
    const current = () => generation === commandGeneration.current && location === window.location.pathname && !document.querySelector("dialog[open]");
    // A command is an explicit action, so recheck current permissions instead
    // of capturing an empty/stale navigation cache during a route transition.
    setCommandError("");
    void fetchWikiSpaces().then(spaces => {
      if (!current()) return;
      const editable = spaces.filter(space => space.canEdit && !space.archivedAt);
      setPalette({ title: `${wikiProductName} commands`, placeholder: "Choose a command", commands: [
      { id: "wiki", label: wikiLabels.allSpaces, group: "Go to", run: () => router.push("/wiki") },
      ...editable.map(space => ({ id: space.id, label: editable.length === 1 ? wikiLabels.newPage : `${wikiLabels.newPage} in ${space.title}`, group: "Create", run: () => router.push(`/wiki?new=1&spaceId=${space.id}`) })),
      ] });
    }).catch(() => { if (current()) setCommandError("Unable to load spaces. Try again."); });
  }, [router]);
  useEffect(() => {
    const invalidate = () => { ++commandGeneration.current; };
    const key = (event: KeyboardEvent) => {
      // Respect editor shortcuts (such as inserting a link) before opening
      // the workspace palette, as the Board shortcut handler does.
      if (event.defaultPrevented || event.isComposing) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") { event.preventDefault(); commands(); }
    };
    const cancel = (event: KeyboardEvent) => { if (event.key === "Escape") invalidate(); };
    window.addEventListener("keydown", key); window.addEventListener("keydown", cancel, true); document.addEventListener("pointerdown", invalidate, true); window.addEventListener(wikiMenuOpenEvent, invalidate);
    return () => { invalidate(); window.removeEventListener("keydown", key); window.removeEventListener("keydown", cancel, true); document.removeEventListener("pointerdown", invalidate, true); window.removeEventListener(wikiMenuOpenEvent, invalidate); };
  }, [commands]);
  return <div className="taskboard-shell wiki-app wiki-root" data-editor-scale="true">
    <a className="wiki-skip" href="#wiki-main">Skip to content</a>
    <div className="taskboard-main-frame wiki-frame">
      <WikiWorkspaceHeader key={query.get("archived") ?? "0"} displayName={displayName} drawer={drawer} onNavigation={() => setDrawer(true)} onCommands={commands} />
      {commandError ? <p className="wiki-banner" role="alert">{commandError} <WikiButton onClick={commands}>Retry commands</WikiButton></p> : null}
      <div className="wiki-layout panel-surface"><aside className="wiki-sidebar"><WikiNavigation key={query.get("archived") ?? "0"} /></aside><main id="wiki-main" tabIndex={-1}>{children}</main></div>
    </div>
    <nav className="taskboard-mobile-navigation wiki-phone-navigation" aria-label="Phone navigation">
      <Link href="/"><LayoutDashboard aria-hidden="true" /><span>Tasks</span></Link>
      <Link href="/calendar"><CalendarDays aria-hidden="true" /><span>Calendar</span></Link>
      <Link href="/wiki" aria-current="page"><BookOpen aria-hidden="true" /><span>Wiki</span></Link>
      <Link href="/notes"><StickyNote aria-hidden="true" /><span>Notes</span></Link>
    </nav>
    {drawer ? <WikiDialog title="Navigation" drawer onClose={() => setDrawer(false)}><div id="wiki-navigation-drawer"><WikiNavigation key={query.get("archived") ?? "0"} onNavigate={() => setDrawer(false)} /><Link className="wiki-drawer-options" href={buildOptionsHref(pathname + (query.size ? `?${query}` : ""))}><Settings2 aria-hidden="true" />Options</Link></div></WikiDialog> : null}
    {palette ? <CommandPalette mode={palette} onClose={() => setPalette(null)} /> : null}
  </div>;
}
