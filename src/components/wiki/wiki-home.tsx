"use client";
import { WikiButton, WikiSelect, WikiTextarea, WikiInput } from "./wiki-controls";
import Link from "next/link";
import { WikiSpaceMenu } from "./wiki-item-menu";
import { BookOpen, Plus } from "lucide-react";
import { wikiSpaceStyle } from "./wiki-appearance";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AccessibleBoardSummary } from "@/lib/board-access";
import type { WikiPageList as PageList, WikiSpaceSummary } from "@/lib/wiki-model";
import { createWikiSpaceRequest } from "@/lib/wiki-client";
import { wikiProductName } from "@/lib/wiki-labels";
import { WikiSearchResults } from "./wiki-discovery";
import { WikiPageList } from "./wiki-page-list";
import { WikiNewPage } from "./wiki-new-page";
import { useWikiRefresh } from "./wiki-live";

export function WikiHome({ spaces, initialListing, boards, initialQuery, includeArchived, newSpaceId }: { spaces: WikiSpaceSummary[]; initialListing: PageList; boards: AccessibleBoardSummary[]; initialQuery: string; includeArchived: boolean; newSpaceId?: string }) {
  const router = useRouter();
  const [creating, setCreating] = useState(false);
  const [newPage, setNewPage] = useState(newSpaceId ?? "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  // The route key remounts this view when the committed URL scope changes.
  // Keep checkbox feedback local while that navigation is in flight.
  const [archivedFilter, setArchivedFilter] = useState(includeArchived);
  const available = boards.filter(board => !spaces.some(space => space.boardId === board.boardId));
  const editable = spaces.filter(space => space.canEdit && !space.archivedAt);
  useWikiRefresh(async () => { router.refresh(); return true; });
  return <div className="wiki-container"><div className="wiki-heading"><div><h1>{wikiProductName}</h1><p className="wiki-muted">Pages for the teams and boards you can access.</p></div><div className="wiki-actions">{editable.length ? <WikiButton variant="primary" onClick={() => setNewPage(editable[0].id)}><Plus aria-hidden="true" />New page</WikiButton> : null}{available.length ? <WikiButton onClick={() => setCreating(value => !value)}>Create space</WikiButton> : null}</div></div>
    <div className="wiki-home-filters"><label className="wiki-check"><input type="checkbox" checked={archivedFilter} onChange={event => { setArchivedFilter(event.target.checked); const query = new URLSearchParams(); if (initialQuery) query.set("q", initialQuery); if (event.target.checked) query.set("archived", "1"); router.push(`/wiki${query.size ? `?${query}` : ""}`); }} />Show archived spaces</label></div>
    {creating ? <form className="wiki-panel wiki-form" onSubmit={async event => { event.preventDefault(); const data = new FormData(event.currentTarget); setBusy(true); setError(""); try { const space = await createWikiSpaceRequest({ boardId: String(data.get("boardId")), title: String(data.get("title")), description: String(data.get("description")) }); router.push(`/wiki/${space.slug}`); } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to create space."); } finally { setBusy(false); } }}><h2>Create a space</h2><p>Everyone with access to the selected team board will have the same access to this {wikiProductName.toLowerCase()}.</p><label>Team board<WikiSelect name="boardId" required>{available.map(board => <option key={board.boardId} value={board.boardId}>{board.title}</option>)}</WikiSelect></label><label>Space title<WikiInput name="title" required maxLength={120} /></label><label>Description<WikiTextarea name="description" maxLength={2000} /></label><div className="wiki-actions"><WikiButton variant="primary" disabled={busy}>Create space</WikiButton><WikiButton type="button" onClick={() => setCreating(false)}>Cancel</WikiButton></div></form> : null}
    {newPage ? <WikiNewPage spaces={editable} initialSpaceId={newPage} onClose={() => { setNewPage(""); if (newSpaceId) router.replace(`/wiki${includeArchived ? "?archived=1" : ""}`); }} /> : null}
    {error ? <p role="alert">{error}</p> : null}<section aria-label="Spaces" className="wiki-spaces">{spaces.map(space => <WikiSpaceMenu key={space.id} space={space} className="wiki-space-menu"><Link href={`/wiki/${space.slug}`} className="wiki-panel wiki-space-card" style={wikiSpaceStyle(space.id, Boolean(space.archivedAt))}><h2><BookOpen aria-hidden="true" className="wiki-identity-icon" />{space.title}</h2><p>{space.description}</p><small>{space.boardTitle} · {space.pageCount} {space.pageCount === 1 ? "page" : "pages"}{space.archivedAt ? " · Archived, read only" : ""}</small></Link></WikiSpaceMenu>)}</section>
    {!spaces.length ? <div className="wiki-panel"><h2>A home for your team’s knowledge</h2><p>Create a space on a team board you manage.</p><Link href="/">Open Tasks to create or manage team boards</Link></div> : null}
    <h2>{initialQuery ? "Search results" : "Recent pages"}</h2>{initialQuery ? <WikiSearchResults input={{ q: initialQuery, includeArchivedSpaces: includeArchived }} /> : <WikiPageList key={`${initialQuery}:${includeArchived}:${initialListing.pages.map(page => page.updatedAt).join()}`} listing={initialListing} query={{ q: initialQuery, includeArchivedSpaces: includeArchived || undefined }} />}
  </div>;
}
