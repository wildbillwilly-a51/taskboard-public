"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BookOpen, ChevronDown, Moon, Search, Settings2, Sun, X } from "lucide-react";
import { useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useUiSettings } from "@/components/settings-provider";
import { WorkspacePrimaryNav } from "@/components/workspace-primary-nav";
import { MobileWorkspaceHeader } from "@/components/mobile-workspace-chrome";
import { buildOptionsHref } from "@/lib/options-return";
import { WikiButton, WikiInput } from "./wiki-controls";
import { WikiDialog } from "./wiki-dialog";
import { useWikiNavigation } from "./wiki-navigation-context";
import { wikiSpaceStyle } from "./wiki-appearance";

function subscribeSystemTheme(notify: () => void) {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  media.addEventListener("change", notify);
  return () => media.removeEventListener("change", notify);
}
const readSystemDark = () => window.matchMedia("(prefers-color-scheme: dark)").matches;
const serverSystemDark = () => false;

export function WikiWorkspaceHeader({ displayName, drawer, onNavigation, onCommands }: {
  displayName: string; drawer: boolean; onNavigation: () => void; onCommands: () => void;
}) {
  const pathname = usePathname(), query = useSearchParams();
  const { settings, updateSetting } = useUiSettings();
  const systemDark = useSyncExternalStore(subscribeSystemTheme, readSystemDark, serverSystemDark);
  const { spaces } = useWikiNavigation();
  const [picking, setPicking] = useState(false), [filter, setFilter] = useState("");
  const [archived, setArchived] = useState(query.get("archived") === "1");
  const slug = decodeURIComponent(pathname.split("/")[2] ?? "");
  const globalQuery = pathname === "/wiki" ? query.get("q") ?? "" : "";
  const current = spaces.value?.find(space => space.slug === slug);
  const returnTo = pathname + (query.size ? `?${query}` : "");
  const isLight = settings.theme === "light" || (settings.theme === "system" && !systemDark);
  const toggleTheme = () => updateSetting("theme", isLight ? "dark" : "light");
  return <>
    <WikiPhoneHeader key={`phone:${pathname}:${globalQuery}`} initialQuery={globalQuery} drawer={drawer} onNavigation={onNavigation} />
    <header className="taskboard-main-header wiki-shell-header" data-workspace-header>
      <div className="taskboard-header-stack">
        <div className="taskboard-header-utility-row">
          <div className="taskboard-header-control-row">
            <div className="taskboard-board-controls">
              <WikiButton className="wiki-space-switcher" aria-label={`Space: ${current?.title ?? "All spaces"}`} aria-haspopup="dialog" aria-expanded={picking} onClick={() => setPicking(true)}>
                <BookOpen aria-hidden="true" className="wiki-identity-icon" /><span>{current?.title ?? "All spaces"}</span><ChevronDown aria-hidden="true" />
              </WikiButton>
            </div>
            <div className="taskboard-header-search-region"><WikiHeaderSearch key={`${pathname}:${globalQuery}`} initialQuery={globalQuery} onCommands={onCommands} /></div>
          </div>
        </div>
        <div className="taskboard-header-nav-row"><div className="taskboard-header-nav-inner wiki-nav-row">
          <WorkspacePrimaryNav active="wiki" />
          <div className="taskboard-header-tools wiki-header-tools">
            <WikiButton className="wiki-nav-toggle" aria-expanded={drawer} aria-label="Open navigation" onClick={onNavigation}><BookOpen aria-hidden="true" /><span>Navigation</span></WikiButton>
            <WikiButton variant="icon" onClick={toggleTheme} aria-label="Switch color theme" title={isLight ? "Switch to dark" : "Switch to light"}>{isLight ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}</WikiButton>
            <Link href={buildOptionsHref(returnTo)} className="ui-button ui-button-surface ed-icon-button wiki-options" aria-label="Options" title="Options"><Settings2 aria-hidden="true" /></Link>
            <span className="wiki-user">{displayName}</span>
          </div>
        </div></div>
      </div>
    </header>
    {picking ? <WikiDialog title="Choose space" onClose={() => setPicking(false)}>
      <label>Find a space<WikiInput type="search" value={filter} onChange={event => setFilter(event.target.value)} autoFocus /></label>
      <label className="wiki-check"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} />Show archived spaces</label>
      <nav className="wiki-space-picker" aria-label="Choose space" onClick={event => { if ((event.target as HTMLElement).closest("a")) setPicking(false); }}>
        <Link href={`/wiki${archived ? "?archived=1" : ""}`}><BookOpen aria-hidden="true" />All spaces</Link>
        {spaces.value?.filter(space => (!space.archivedAt || archived || space.id === current?.id) && `${space.title} ${space.boardTitle}`.toLowerCase().includes(filter.toLowerCase())).map(space => <Link key={space.id} href={`/wiki/${space.slug}`} style={wikiSpaceStyle(space.id, Boolean(space.archivedAt))} aria-current={current?.id === space.id ? "page" : undefined}>
          <BookOpen aria-hidden="true" className="wiki-identity-icon" /><span>{space.title}<small>{space.boardTitle}{space.archivedAt ? " · Archived" : ""}</small></span>
        </Link>)}
      </nav>
      {spaces.error ? <p role="alert">Unable to load spaces. <WikiButton onClick={() => void spaces.refresh()}>Retry spaces</WikiButton></p> : !spaces.value ? <p role="status">Loading spaces…</p> : null}
    </WikiDialog> : null}
  </>;
}

function WikiHeaderSearch({ onCommands, initialQuery }: { onCommands: () => void; initialQuery: string }) {
  const router = useRouter(), params = useSearchParams();
  const [query, setQuery] = useState(initialQuery);
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = new URLSearchParams();
    if (query.trim()) next.set("q", query.trim());
    if (params.get("archived") === "1") next.set("archived", "1");
    router.push(`/wiki${next.size ? `?${next}` : ""}`);
  };
  return <form className="wiki-header-search" action="/wiki" onSubmit={submit} role="search" aria-label="Wiki search">
    <div className="ui-control wiki-header-search-field"><Search aria-hidden="true" /><input type="search" name="q" aria-label="Search all spaces" placeholder="Search wiki…" maxLength={200} value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === "Escape") { setQuery(""); event.currentTarget.blur(); } }} />
      {query ? <WikiButton variant="icon" type="button" aria-label="Clear wiki search" onClick={() => setQuery("")}><X aria-hidden="true" /></WikiButton> : null}
      <WikiButton type="submit" variant="icon" aria-label="Run wiki search"><Search aria-hidden="true" /></WikiButton>
    </div>
    <WikiButton type="button" className="taskboard-palette-button" onClick={onCommands} aria-label="Open command palette" title="Command palette (Ctrl+K)"><kbd className="taskboard-kbd">Ctrl</kbd><kbd className="taskboard-kbd">K</kbd></WikiButton>
  </form>;
}

function WikiPhoneHeader({ drawer, onNavigation, initialQuery }: { drawer: boolean; onNavigation: () => void; initialQuery: string }) {
  const router = useRouter(), params = useSearchParams();
  const [query, setQuery] = useState(initialQuery);
  const button = useRef<HTMLButtonElement>(null);
  return <form className="wiki-phone-header" role="search" aria-label="Phone Wiki search" onSubmit={event => { event.preventDefault(); const next = new URLSearchParams(); if (query.trim()) next.set("q", query.trim()); if (params.get("archived") === "1") next.set("archived", "1"); router.push(`/wiki${next.size ? `?${next}` : ""}`); }}>
    <MobileWorkspaceHeader title="Wiki" brandAs="span" query={query} onQueryChange={setQuery} onMore={onNavigation} menuButtonRef={button} menuOpen={drawer} menuLabel="Open navigation" menuId="wiki-navigation-drawer" />
  </form>;
}
