"use client";
import { WikiButton, WikiSelect, WikiTextarea, WikiInput } from "./wiki-controls";
import Link from "next/link";
import { ArrowLeft, BookOpen, Plus } from "lucide-react";
import { wikiSpaceStyle } from "./wiki-appearance";
import { useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";
import type { WikiPageDetail, WikiPageList as PageList, WikiSpaceSummary } from "@/lib/wiki-model";
import { removeWikiSpaceRequest, updateWikiSpaceRequest } from "@/lib/wiki-client";
import { WikiSearchResults } from "./wiki-discovery";
import { WikiPageList } from "./wiki-page-list";
import { WikiNewPage } from "./wiki-new-page";
import { WikiReader } from "./wiki-reader";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useWikiRefresh } from "./wiki-live";

export function WikiSpace({ initialSpace: space, initialListing, home, initialQuery = "", status = "active", topicId, topicUnavailable = false }: { initialSpace: WikiSpaceSummary; initialListing: PageList; home: WikiPageDetail | null; initialQuery?: string; status?: "active" | "archived" | "trash"; topicId?: string; topicUnavailable?: boolean }) {
  const router = useRouter(), search = useSearchParams();
  const settings = space.canManage && search.get("settings") === "1";
  const setSettings = (open: boolean) => { const next = new URLSearchParams(search); if (open) next.set("settings", "1"); else next.delete("settings"); router.replace(`/wiki/${space.slug}${next.size ? `?${next}` : ""}`, { scroll: false }); };
  const [creating, setCreating] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const { confirm, dialog } = useConfirm();
  useWikiRefresh(async () => { router.refresh(); return true; });
  const run = async (action: () => Promise<unknown>) => { setBusy(true); setError(""); try { await action(); router.refresh(); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to update space."); } finally { setBusy(false); } };
  return <div className="wiki-container"><Link className="wiki-breadcrumb" href="/wiki"><ArrowLeft aria-hidden="true" />All spaces</Link><div className="wiki-heading wiki-space-heading" style={wikiSpaceStyle(space.id, Boolean(space.archivedAt))}><div><p className="wiki-eyebrow">{space.boardTitle}</p><h1><BookOpen aria-hidden="true" />{space.title}</h1><p>{space.description}</p></div><div className="wiki-actions">{space.canEdit && !space.archivedAt ? <WikiButton variant="primary" onClick={() => setCreating(value => !value)}><Plus aria-hidden="true" />New page</WikiButton> : null}{space.canManage ? <WikiButton onClick={() => setSettings(!settings)}>Space settings</WikiButton> : null}</div></div>{space.archivedAt ? <p className="wiki-banner">Archived space. Pages are read only. Reading, history, downloads and personal copies remain available.</p> : null}
    {settings ? <section className="wiki-panel wiki-form" aria-label="Space settings"><h2>Space settings</h2>{!space.archivedAt ? <form onSubmit={event => { event.preventDefault(); const data = new FormData(event.currentTarget); void run(() => updateWikiSpaceRequest(space.id, { title: String(data.get("title")), description: String(data.get("description")) })); }}><label>Space title<WikiInput name="title" defaultValue={space.title} required maxLength={120} /></label><label>Description<WikiTextarea name="description" defaultValue={space.description} maxLength={2000} /></label><WikiButton variant="primary" disabled={busy}>Save settings</WikiButton></form> : null}<div className="wiki-actions"><WikiButton disabled={busy} onClick={async () => { if (!space.archivedAt && !(await confirm({ title: "Archive this space?", body: "All pages become read only. Existing trashed pages still expire on their original 30-day schedule. Board label and task changes can still affect pages.", confirmLabel: "Archive space", focusCancel: true }))) return; void run(() => updateWikiSpaceRequest(space.id, { archived: !space.archivedAt })); }}>{space.archivedAt ? "Unarchive space" : "Archive space"}</WikiButton>{!space.archivedAt && space.homeNoteId ? <WikiButton disabled={busy} onClick={() => void run(() => updateWikiSpaceRequest(space.id, { homeNoteId: null }))}>Clear home page</WikiButton> : null}{!space.archivedAt && !space.pageCount && !space.trashCount ? <WikiButton disabled={busy} onClick={async () => { if (await confirm({ title: "Remove this empty space?", body: "The team board is kept.", confirmLabel: "Remove space", tone: "danger" })) void run(async () => { await removeWikiSpaceRequest(space.id); router.push("/wiki"); }); }}>Remove empty space</WikiButton> : null}</div></section> : null}
    {error ? <p role="alert">{error}</p> : null}{creating ? <WikiNewPage spaces={[space]} initialSpaceId={space.id} onClose={() => setCreating(false)} /> : null}
    {home && !home.deletedAt ? <section className="wiki-panel"><h2><Link href={home.wiki.canonicalHref}>{home.displayTitle}</Link></h2><WikiReader content={home.content} format={home.contentFormatVersion} wikiContext={{ spaceId: space.id, noteId: home.id }} /></section> : null}
    {topicId ? <p>Filtered by topic and its descendants. <Link href={`/wiki/${space.slug}`}>Clear topic filter</Link></p> : null}
    <form className="wiki-search">{topicId ? <input type="hidden" name="topicId" value={topicId} /> : null}<label>Search this space<WikiInput type="search" maxLength={200} name="q" defaultValue={initialQuery} placeholder="Find a page…" /></label><label>Pages<WikiSelect name="status" defaultValue={status}><option value="active">Active</option><option value="archived">Archived pages</option><option value="trash">Trash</option></WikiSelect></label><WikiButton>Search</WikiButton></form>
    {topicUnavailable ? <p role="alert">Topic unavailable. <Link href={`/wiki/${space.slug}`}>Show all pages in this space</Link></p> : initialQuery && status === "active" ? <WikiSearchResults input={{ q: initialQuery, spaceId: space.id, topicId, includeArchivedSpaces: Boolean(space.archivedAt) }} /> : <WikiPageList key={initialListing.pages.map(page => page.id + page.updatedAt).join()} listing={initialListing} query={{ spaceId: space.id, q: initialQuery, status, topicId }} />}{dialog}</div>;
}
