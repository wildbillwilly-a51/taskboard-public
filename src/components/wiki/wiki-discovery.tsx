"use client";
import { FileText, Link2 } from "lucide-react";
import { WikiButton } from "./wiki-controls";
import Link from "next/link";
import { WikiLinkMenu } from "./wiki-item-menu";
import { useState } from "react";
import { fetchWikiBacklinks, searchWikiPagesRequest } from "@/lib/wiki-discovery-client";
import type { WikiSearchHit, WikiSearchInput, WikiSearchResult } from "@/lib/wiki-discovery-model";
import { useWikiResource } from "./wiki-resource";

export function WikiHits({ pages }: { pages: WikiSearchHit[] }) {
  return <ul className="wiki-page-list">{pages.map(page => <li key={page.id}><WikiLinkMenu href={page.href} title={page.title || "Untitled page"} noteId={page.id}><Link href={page.href}><FileText aria-hidden="true" /><strong>{page.title || "Untitled page"}</strong><span>{page.spaceTitle}{page.archived ? " · Archived" : ""}</span><p>{page.snippet.map((part, index) => part.match ? <mark key={index}>{part.text}</mark> : <span className="wiki-snippet" key={index}>{part.text}</span>)}</p></Link></WikiLinkMenu></li>)}</ul>;
}
function Results({ initial, loadMore, empty }: { initial: WikiSearchResult; loadMore: (offset: number) => Promise<WikiSearchResult>; empty: string }) {
  const [extra, setExtra] = useState<{ base: WikiSearchResult; result: WikiSearchResult } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const result = extra?.base === initial ? extra.result : initial;
  return <><WikiHits pages={result.pages} />{!result.pages.length ? <p className="wiki-muted">{empty}</p> : null}{error ? <p role="alert">{error}</p> : null}{result.hasMore ? <WikiButton disabled={busy} onClick={async () => { setBusy(true); setError(""); try { const next = await loadMore(result.offset + result.limit); setExtra({ base: initial, result: { ...next, pages: [...result.pages, ...next.pages.filter(page => !result.pages.some(old => old.id === page.id))] } }); } catch { setError("Unable to load more pages. Try again."); } finally { setBusy(false); } }}>Load more pages</WikiButton> : null}</>;
}
export function WikiSearchResults({ input }: { input: WikiSearchInput }) {
  const key = JSON.stringify(input);
  const resource = useWikiResource(key, signal => searchWikiPagesRequest(input, signal), true);
  return <section aria-label="Search results">{resource.error ? <p role="alert">{resource.error} <WikiButton onClick={() => void resource.refresh()}>Retry search</WikiButton></p> : null}{resource.value ? <Results key={key} initial={resource.value} loadMore={offset => searchWikiPagesRequest({ ...input, offset })} empty="No matching pages." /> : !resource.error ? <p role="status">Finding pages…</p> : null}</section>;
}
export function WikiBacklinks({ noteId }: { noteId: string }) {
  const resource = useWikiResource(noteId, signal => fetchWikiBacklinks(noteId, {}, signal), true);
  return <section aria-label="Backlinks"><h2><Link2 aria-hidden="true" />Backlinks</h2>{resource.error ? <p role="alert">Unable to load backlinks. <WikiButton onClick={() => void resource.refresh()}>Retry backlinks</WikiButton></p> : null}{resource.value ? <Results initial={resource.value} loadMore={offset => fetchWikiBacklinks(noteId, { offset })} empty="No pages link here yet." /> : !resource.error ? <p role="status">Loading backlinks…</p> : null}</section>;
}
