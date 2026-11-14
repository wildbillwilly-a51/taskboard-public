"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useState } from "react";
import { BookOpen, ChevronDown, ChevronRight, Clock3, FileText, Folder, Library, Plus, Settings2 } from "lucide-react";
import { fetchWikiTopics } from "@/lib/wiki-discovery-client";
import type { WikiSpaceSummary } from "@/lib/wiki-model";
import type { WikiTopic } from "@/lib/wiki-discovery-model";
import { useWikiResource } from "./wiki-resource";
import { topicPath } from "./wiki-topic-paths";
import { WikiTopicManager } from "./wiki-topics";
import { WikiButton } from "./wiki-controls";
import { useWikiNavigation } from "./wiki-navigation-context";
import { wikiSpaceStyle } from "./wiki-appearance";
import { WikiLinkMenu, WikiSpaceMenu } from "./wiki-item-menu";

const disclosurePreferences = new Map<string, boolean>();
function TopicBranch({ topics, topic, slug, selected, onManage, onNavigate }: { topics: WikiTopic[]; topic: WikiTopic; slug: string; selected?: string | null; onManage?: () => void; onNavigate?: () => void }) {
  const preferenceKey = `${topic.spaceId}:${topic.id}`;
  const [expanded, setExpanded] = useState(() => disclosurePreferences.get(preferenceKey) ?? true);
  const children = topics.filter(item => item.parentTopicId === topic.id);
  return <li><div className="wiki-topic-row"><WikiLinkMenu href={`/wiki/${slug}?topicId=${topic.id}`} title={topic.title} kind="topic" onNavigate={onNavigate} actions={onManage ? [{ label: "Manage topics", icon: <Settings2 aria-hidden="true" />, run: onManage, separator: true }] : []}>
    {children.length ? <WikiButton variant="icon" aria-label={`${expanded ? "Collapse" : "Expand"} ${topic.title}`} aria-expanded={expanded} onClick={() => { disclosurePreferences.set(preferenceKey, !expanded); setExpanded(!expanded); }}>{expanded ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}</WikiButton> : <span className="wiki-topic-indent" />}
    <Link aria-current={selected === topic.id ? "page" : undefined} href={`/wiki/${slug}?topicId=${topic.id}`}><Folder aria-hidden="true" /><span>{topic.title}</span><small>{topic.pageCount}</small></Link>
  </WikiLinkMenu></div>{children.length && expanded ? <ul>{children.map(child => <TopicBranch key={child.id} topics={topics} topic={child} slug={slug} selected={selected} onManage={onManage} onNavigate={onNavigate} />)}</ul> : null}</li>;
}
export function WikiSpaceTopics({ space, onNavigate }: { space: WikiSpaceSummary; onNavigate?: () => void }) {
  const query = useSearchParams(), selected = query.get("topicId");
  const resource = useWikiResource(space.id, signal => fetchWikiTopics(space.id, signal), true);
  const [manage, setManage] = useState(false);
  const topic = resource.value?.topics.find(topic => topic.id === selected);
  return <section aria-label="Topics" style={wikiSpaceStyle(space.id)}>
    <div className="wiki-rail-heading"><h2>Topics</h2>{space.canManage && !space.archivedAt ? <WikiButton variant="icon" aria-label="Manage topics" title="Manage topics" onClick={() => setManage(true)}><Settings2 aria-hidden="true" /></WikiButton> : null}</div>
    {topic ? <p className="wiki-topic-path">{topicPath(topic, resource.value!.topics)}</p> : selected && resource.value ? <p role="alert">Topic unavailable.</p> : null}
    {resource.error ? <p role="alert">Unable to load topics. <WikiButton onClick={() => void resource.refresh()}>Retry topics</WikiButton></p> : resource.value ? <><ul className="wiki-topic-tree">{resource.value.topics.filter(topic => !topic.parentTopicId).map(topic => <TopicBranch key={topic.id} topics={resource.value!.topics} topic={topic} slug={space.slug} selected={selected} onNavigate={onNavigate} onManage={space.canManage && !space.archivedAt ? () => setManage(true) : undefined} />)}</ul>{!resource.value.topics.length ? <p className="wiki-muted wiki-rail-empty">No topics yet.</p> : null}</> : <p role="status">Loading topics…</p>}
    {manage && space.canManage && !space.archivedAt ? <WikiTopicManager spaceId={space.id} onClose={() => { setManage(false); void resource.refresh(); }} /> : null}
  </section>;
}
export function WikiNavigation({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname(), query = useSearchParams();
  const [archived, setArchived] = useState(query.get("archived") === "1");
  const { spaces, recent } = useWikiNavigation();
  const currentSlug = decodeURIComponent(pathname.split("/")[2] ?? "");
  const space = spaces.value?.find(space => space.slug === currentSlug);
  const editable = spaces.value?.find(item => item.canEdit && !item.archivedAt);
  const newSpace = space?.canEdit && !space.archivedAt ? space : editable;
  return <nav aria-label="Knowledge navigation" onClick={event => { if ((event.target as HTMLElement).closest("a")) onNavigate?.(); }}>
    {newSpace ? <Link className="ui-button ui-button-primary ed-button wiki-rail-new" href={`/wiki?new=1&spaceId=${newSpace.id}`}><Plus aria-hidden="true" />New page</Link> : null}
    <Link className="wiki-all-spaces" aria-current={pathname === "/wiki" ? "page" : undefined} href="/wiki"><Library aria-hidden="true" /><span>All spaces</span></Link>
    <section aria-label="Spaces"><div className="wiki-rail-heading"><h2>Spaces</h2></div>
      <label className="wiki-check wiki-rail-archived"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} />Show archived spaces</label>
      {spaces.error ? <p role="alert">Unable to load spaces. <WikiButton onClick={() => void spaces.refresh()}>Retry spaces</WikiButton></p> : !spaces.value ? <p role="status">Loading spaces…</p> : <ul className="wiki-nav-spaces">
        {spaces.value.filter(item => !item.archivedAt || archived || item.id === space?.id).map(item => <li key={item.id} style={wikiSpaceStyle(item.id, Boolean(item.archivedAt))}><WikiSpaceMenu space={item} onNavigate={onNavigate}><Link href={`/wiki/${item.slug}`} aria-current={item.id === space?.id && !query.get("topicId") ? "page" : undefined}><BookOpen aria-hidden="true" className="wiki-identity-icon" /><span>{item.title}{item.archivedAt ? <small>Archived</small> : null}</span><small className="wiki-rail-count">{item.pageCount}</small></Link></WikiSpaceMenu></li>)}
      </ul>}
    </section>
    {space ? <WikiSpaceTopics key={space.id} space={space} onNavigate={onNavigate} /> : null}
    <section aria-label="Recent pages"><div className="wiki-rail-heading"><h2><Clock3 aria-hidden="true" />Recent</h2></div>
      {recent.error ? <p role="alert">Unable to load recent pages. <WikiButton onClick={() => void recent.refresh()}>Retry recent pages</WikiButton></p> : recent.value ? <ul className="wiki-nav-recent">{recent.value.pages.map(page => <li key={page.id}><WikiLinkMenu href={page.href} title={page.title || "Untitled page"} noteId={page.id} onNavigate={onNavigate}><Link href={page.href} aria-current={pathname === page.href ? "page" : undefined}><FileText aria-hidden="true" /><span>{page.title || "Untitled page"}<small>{page.spaceTitle}</small></span></Link></WikiLinkMenu></li>)}</ul> : <p role="status">Loading recent pages…</p>}
    </section>
  </nav>;
}
