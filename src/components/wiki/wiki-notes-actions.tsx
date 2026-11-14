"use client";
import { WikiButton, WikiControlsProvider, WikiSelect } from "./wiki-controls";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { NoteDetail } from "@/lib/notes-model";
import type { WikiSpaceSummary } from "@/lib/wiki-model";
import { copyWikiPageRequest, fetchWikiSpaces, moveWikiPageRequest, promoteNoteToWikiRequest } from "@/lib/wiki-client";
import { noteDraftStore } from "@/components/notes/use-note-drafts";
import { wikiLabels, wikiProductName } from "@/lib/wiki-labels";
import { WikiDialog } from "./wiki-dialog";

type ActionProps = { note: NoteDetail; onChanged?: (note: NoteDetail) => void; onBusy?: (busy: boolean) => void };
export function useWikiPageActions({ note, onChanged, onBusy }: ActionProps) {
  const router = useRouter();
  const [spaces, setSpaces] = useState<WikiSpaceSummary[] | null>(null), [target, setTarget] = useState("");
  const [error, setError] = useState(""), [busy, setBusy] = useState(false), [confirming, setConfirming] = useState<WikiSpaceSummary | null>(null);
  const canMove = note.canEdit && !note.deletedAt && (note.wiki ? !note.wiki.spaceArchived : !note.archived);
  useEffect(() => { if (!canMove) queueMicrotask(() => { setSpaces(null); setConfirming(null); }); }, [canMove]);
  const run = async (action: (version: number) => Promise<unknown>) => {
    setBusy(true); onBusy?.(true); setError("");
    try { await noteDraftStore.runExclusive(note.id, action, { readOnly: !note.canEdit || Boolean(note.wiki?.spaceArchived) }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to complete action."); }
    finally { setBusy(false); onBusy?.(false); }
  };
  const pick = async () => {
    setError("");
    try { const listed = await fetchWikiSpaces(); const candidates = listed.filter(space => space.canEdit && !space.archivedAt && (note.wiki ? space.id !== note.wiki.spaceId : note.home.kind === "board" && space.boardId === note.home.boardId)); setSpaces(candidates); setTarget(candidates[0]?.id ?? ""); }
    catch { setError("Unable to load spaces."); }
  };
  const copy = () => run(async version => { const result = await copyWikiPageRequest(note.id, version); router.push(`/notes?note=${result.id}`); });
  const move = (destination: string) => run(async version => {
    const changed = note.wiki ? await moveWikiPageRequest(note.id, destination, note.wiki.spaceId, version) : await promoteNoteToWikiRequest(note.id, destination, version);
    noteDraftStore.install(changed); onChanged?.(changed); setConfirming(null); setSpaces(null); router.push(changed.wiki.canonicalHref);
  });
  const controls = <>{spaces && canMove ? <WikiDialog title={note.wiki ? "Move to space" : wikiLabels.add} onClose={() => { setSpaces(null); setConfirming(null); }}>
    <label>{note.wiki ? "Destination space" : `${wikiProductName} space`}<WikiSelect value={target} disabled={busy} onChange={event => setTarget(event.target.value)}>{spaces.map(space => <option key={space.id} value={space.id}>{space.title} · {space.boardTitle}</option>)}</WikiSelect></label>
    {!spaces.length ? <p>No eligible active space. Create a space on this team board first.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <div className="wiki-actions"><WikiButton disabled={!target || busy} onClick={() => { const destination = spaces.find(space => space.id === target); if (!destination) return; if (note.wiki) setConfirming(destination); else void move(destination.id); }}>{note.wiki ? "Move page" : wikiLabels.add}</WikiButton><WikiButton onClick={() => setSpaces(null)}>Cancel</WikiButton></div>
    {confirming ? <WikiDialog alert title={`Move to ${confirming.title}?`} onClose={() => setConfirming(null)}><p>Everyone with access to {confirming.boardTitle} will be able to read this page. Its current home page assignment and source topics are cleared.</p>{error ? <p role="alert">{error}</p> : null}<div className="wiki-actions"><WikiButton onClick={() => setConfirming(null)}>Cancel</WikiButton><WikiButton disabled={busy} onClick={() => void move(confirming.id)}>Move page</WikiButton></div></WikiDialog> : null}
  </WikiDialog> : null}</>;
  return { busy, pick, copy, controls, error };
}

export function WikiNotesActions(props: ActionProps) {
  const { note } = props;
  const actions = useWikiPageActions(props);
  if (!note.wiki && (note.home.kind !== "board" || !note.canEdit || note.deletedAt || note.archived)) return null;
  return <WikiControlsProvider><div className="wiki-notes-actions"><div className="wiki-actions">{note.wiki ? <><Link href={note.wiki.canonicalHref}>{wikiLabels.open} ↗</Link><Link href={`${note.wiki.canonicalHref}?view=history`}>History</Link>{!note.deletedAt ? <WikiButton disabled={actions.busy} onClick={() => void actions.copy()}>Copy to my notes</WikiButton> : null}{note.canEdit && !note.wiki.spaceArchived && !note.deletedAt ? <WikiButton disabled={actions.busy} onClick={() => void actions.pick()}>Move to space…</WikiButton> : null}</> : <WikiButton disabled={actions.busy} onClick={() => void actions.pick()}>{wikiLabels.add}…</WikiButton>}</div>{actions.error ? <p role="alert">{actions.error}</p> : null}{actions.controls}</div></WikiControlsProvider>;
}
