"use client";
import { FileText } from "lucide-react";
import { WikiButton } from "./wiki-controls";
import Link from "next/link";
import { WikiLinkMenu } from "./wiki-item-menu";
import { useState } from "react";
import { fetchWikiPages } from "@/lib/wiki-client";
import type { WikiPageList as PageList, WikiPageListInput } from "@/lib/wiki-model";
export function WikiPageList({ listing, query = {} }: { listing: PageList; query?: WikiPageListInput }) {
  const [extra, setExtra] = useState<PageList | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const shown = extra ?? listing;
  return <section aria-label="Pages"><ul className="wiki-page-list">{shown.pages.map(page => <li key={page.id}><WikiLinkMenu href={page.wiki.canonicalHref} title={page.displayTitle} noteId={page.id}><Link href={page.wiki.canonicalHref}><FileText aria-hidden="true" /><strong>{page.displayTitle}</strong><span>{page.wiki.spaceTitle}{page.deletedAt ? " · In trash" : ""}</span><p>{page.snippet}</p></Link></WikiLinkMenu></li>)}</ul>{!shown.pages.length ? <p className="wiki-muted">No matching pages.</p> : null}{shown.hasMore ? <WikiButton disabled={busy} onClick={async () => { setBusy(true); try { const next = await fetchWikiPages({ ...query, offset: shown.offset + shown.limit }); setExtra({ ...next, pages: [...shown.pages, ...next.pages] }); } catch { setError("Unable to load more pages."); } finally { setBusy(false); } }}>Load more pages</WikiButton> : null}{error ? <p role="alert">{error}</p> : null}</section>;
}
