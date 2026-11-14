"use client";

import { useState } from "react";
import { pageMentionHref } from "@/lib/notes-content-format";
import { wikiLabels } from "@/lib/wiki-labels";
import { usePageMention } from "./page-mention-provider";
import {FolioLinkPreview} from './folio-link-preview';

export function PageMentionLabel({ noteId }: { noteId: string }) {
  const { editable, authenticated, mentions } = usePageMention();
  const mention = mentions.get(noteId);
  if (!authenticated) return <span className="page-mention">{wikiLabels.page}</span>;
  if (mention?.state !== "readable") return <span className="page-mention" aria-label={mention ? "Restricted page" : "Page unavailable"}>{mention ? "Restricted page" : wikiLabels.page}</span>;
  // Use the stable ID path; a response's presentation URL is never authority.
  const label = <>{mention.title || "Untitled page"}{mention.archived ? <small> · Archived</small> : null}</>;
  if (!editable) return <FolioLinkPreview noteId={noteId}><a className="page-mention" href={pageMentionHref(noteId)}>{label}</a></FolioLinkPreview>;
  return <FolioLinkPreview noteId={noteId}><EditableMention key={noteId} noteId={noteId} label={label} /></FolioLinkPreview>;
}

function EditableMention({ noteId, label }: { noteId: string; label: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return <span className="page-mention" contentEditable={false}>
    <button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); setOpen(false); } }}>{label}</button>
    {open ? <a className="page-mention-open" href={pageMentionHref(noteId)} target="_blank" rel="noopener noreferrer" onClick={() => setOpen(false)}>Open page ↗</a> : null}
  </span>;
}

