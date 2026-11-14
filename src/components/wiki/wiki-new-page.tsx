"use client";
import { WikiInput } from "./wiki-controls";
import { WikiButton, WikiSelect } from "./wiki-controls";
import { wikiLabels } from "@/lib/wiki-labels";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { WikiSpaceSummary } from "@/lib/wiki-model";
import type { NoteDetail, NoteContentInput } from "@/lib/notes-model";
import { startNewNote, useNoteDrafts } from "@/components/notes/use-note-drafts";
const NoteEditor = dynamic(() => import("./wiki-editor"), { ssr: false });

export function WikiNewPage({ spaces, initialSpaceId, onClose }: { spaces: WikiSpaceSummary[]; initialSpaceId: string; onClose: () => void }) {
  const router = useRouter();
  const [spaceId, setSpaceId] = useState(spaces.find(space => space.id === initialSpaceId)?.id ?? spaces[0]?.id ?? "");
  const [draftId, setDraftId] = useState<string | null>(null);
  const [opening, startOpening] = useTransition();
  const draftRef = useRef<string | null>(null);
  const createdRef = useRef<NoteDetail | null>(null);
  const allowed = spaces.some(space => space.id === spaceId && space.canEdit && !space.archivedAt);
  const drafts = useNoteDrafts({ onSaved: () => {}, onCreated: (id, note) => { if (id === draftRef.current && note.wiki) { createdRef.current = note; startOpening(() => router.push(`${note.wiki!.canonicalHref}`)); } } });
  useEffect(() => () => { if (draftRef.current) drafts.releaseNewNote(draftRef.current); }, [drafts]);
  const ensure = () => {
    if (!draftRef.current) { draftRef.current = startNewNote({ kind: "wiki", spaceId }); setDraftId(draftRef.current); }
    return draftRef.current;
  };
  const edit = (fields: { title?: string; content?: NoteContentInput }) => {
    if (!allowed) return;
    const created = createdRef.current;
    if (created) drafts.edit(created.id, created.contentVersion, fields);
    else drafts.editNewNote(ensure(), fields);
  };
  return <section className="wiki-panel wiki-form" aria-label={wikiLabels.newPage}><h2>New page</h2><p className="wiki-muted">Nothing is created until you type. Your page will be shared with this space’s board.</p>{opening ? <p role="status">Opening page… You can keep typing.</p> : null}<label>Space<WikiSelect value={spaceId} disabled={Boolean(draftId)} onChange={event => setSpaceId(event.target.value)}>{spaces.map(space => <option key={space.id} value={space.id}>{space.title} · {space.boardTitle}</option>)}</WikiSelect></label>{spaceId ? <><label>Page title<WikiInput disabled={!allowed} maxLength={300} onChange={event => edit({ title: event.target.value })} /></label><NoteEditor initialBlocks={[]} contentFormatVersion={2} wikiContext={{ spaceId }} editable={allowed} onChange={content => edit({ content: { ...content, formatVersion: 2 } })} /></> : <p>No editable active spaces are available.</p>}{draftId && drafts.newNoteStatus(draftId) === "error" ? <p role="alert">Could not create the page. Your text is kept.<WikiButton onClick={() => void drafts.createNewNote(draftId)}>Retry create</WikiButton></p> : null}<WikiButton type="button" onClick={onClose}>Close draft</WikiButton></section>;
}
