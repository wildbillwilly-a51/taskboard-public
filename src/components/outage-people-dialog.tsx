"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { Task } from "@/lib/taskboard-data";
import { formatItemSpan } from "@/lib/work-windows";
import type { OutagePeopleState, PeopleChange, PeopleTeamChange } from "@/lib/outage-people";
import type { PeopleDetailsChange } from "@/lib/outage-people-details";

export type PeoplePanel = { kind: "add" } | { kind: "members" | "remove"; team: string } | { kind: "person"; key: string } | { kind: "assign"; keys: string[] };
export type PeopleCommand = PeopleChange | PeopleTeamChange | PeopleDetailsChange;
type Member = { userId: string; displayName: string; isDisabled: boolean };
type DirectoryTeam = { id: string; name: string; memberCount?: number };
type Step = PeoplePanel | { kind: "directory" } | { kind: "create"; source?: DirectoryTeam };

export function OutagePeopleDialog({ panel, data, canEdit, works, timeZone, submit, reload, close }: {
  panel: PeoplePanel; data: OutagePeopleState; canEdit: boolean; works: Task[]; timeZone: string;
  submit: (command: PeopleCommand) => Promise<void>; reload: () => Promise<OutagePeopleState | null>; close: () => void;
}) {
  const [step, setStep] = useState<Step>(panel), [name, setName] = useState("");
  const [directory, setDirectory] = useState<DirectoryTeam[]>([]), [members, setMembers] = useState<Member[]>([]);
  const [picked, setPicked] = useState<string[]>([]), [loading, setLoading] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [conflict, setConflict] = useState(false);
  const [retry, setRetry] = useState<PeopleCommand | null>(null);
  const dialog = useRef<HTMLDialogElement>(null), base = useRef(data), mounted = useRef(true);
  const titleId = useId(), nameId = useId();
  const teamNames = [...new Set([...(data.teams ?? []), ...data.people.map(p => p.team.value).filter(Boolean)])];
  const person = step.kind === "person" ? data.people.find(p => p.key === step.key) : null;
  const linked = works.find(work => work.id === person?.activity.linkedTaskId);
  const title = step.kind === "add" ? "Add team" : step.kind === "directory" ? "Use an existing team" : step.kind === "create" ? step.source ? "Choose attending members" : "Create outage group" : step.kind === "members" ? `Add people to ${step.team}` : step.kind === "remove" ? `Remove ${step.team}?` : step.kind === "assign" ? "Choose a team" : person?.name ?? "Person details";
  useEffect(() => {
    mounted.current = true;
    const trigger = document.activeElement as HTMLElement | null;
    const board = trigger?.closest(".outage-people");
    const personKey = trigger?.dataset.personKey;
    const element = dialog.current;
    dialog.current?.showModal();
    return () => { mounted.current = false; element?.close(); if (trigger?.isConnected) trigger.focus(); else if (personKey) board?.querySelector<HTMLButtonElement>(`[data-person-key="${CSS.escape(personKey)}"]`)?.focus(); };
  }, []);
  const sourceId = step.kind === "create" ? step.source?.id : undefined;
  useEffect(() => {
    if (step.kind !== "directory" && !sourceId) return;
    if (data.shared) return;
    const controller = new AbortController();
    const url = sourceId ? `/api/teams/${encodeURIComponent(sourceId)}/members` : "/api/teams";
    fetch(url, { cache: "no-store", credentials: "same-origin", signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Unable to load Taskboard teams.");
      if (controller.signal.aborted) return;
      if (sourceId) {
        const active = (result.members as Member[]).filter(member => !member.isDisabled);
        setMembers(active);
        setPicked(active.flatMap(member => data.people.some(p => p.key === member.displayName.trim() && !p.team.value) ? [`user:${member.userId}`] : []));
      } else setDirectory(result.teams);
    }).catch(reason => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Unable to load teams."); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
    // Opening a directory step takes one snapshot; a roster refresh must not
    // discard the user's checked members or start another directory request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step.kind === "directory", sourceId, data.shared]);
  const transition = (next: Step) => { setRetry(null); base.current = data; setError(""); setConflict(false); setPicked([]); setMembers([]); setLoading(next.kind === "directory" || next.kind === "create" && !!next.source); setStep(next); };
  const choose = (key: string, checked: boolean) => { setRetry(null); setPicked(previous => checked ? [...new Set([...previous, key])] : previous.filter(value => value !== key)); };
  const execute = async (request: PeopleCommand) => {
    if (busy || !canEdit) return;
    setBusy(true); setError("");
    try { await submit(request); if (mounted.current) close(); }
    catch (reason) {
      const failure = reason as Error & { status?: number };
      setRetry(failure.status && failure.status < 500 ? null : request);
      if (failure.status === 409) { setConflict(true); await reload(); }
      if (mounted.current) setError(failure.message || "Unable to save. Your choices have been kept.");
    } finally { if (mounted.current) setBusy(false); }
  };
  const updates = (keys: string[]) => keys.map(personKey => ({ personKey, expectedRevision: base.current.people.find(p => p.key === personKey)?.team.revision ?? null }));
  const create = () => {
    if (step.kind !== "create" && step.kind !== "remove") return;
    const attending = new Set(base.current.people.map(person => person.key));
    const chosen = members.filter(member => picked.includes(`user:${member.userId}`));
    const names = chosen.map(member => member.displayName.trim());
    if (new Set(names).size !== names.length) { setError("Choose only one member with each distinct attendee name."); return; }
    const addUserIds = chosen.filter(member => !attending.has(member.displayName.trim())).map(member => member.userId);
    const existing = [...picked.filter(key => key.startsWith("person:")).map(key => key.slice(7)), ...names.filter(memberName => attending.has(memberName))];
    void execute(retry ?? { operation: step.kind === "remove" ? "remove-team" : "create-team", mutationId: crypto.randomUUID(), name: step.kind === "remove" ? step.team : name.trim(), sourceTeamId: step.kind === "create" ? step.source?.id ?? null : null, updates: updates(existing), addUserIds });
  };
  const assign = (team: string, keys: string[]) => void execute(retry && "field" in retry && retry.value === team ? retry : { mutationId: crypto.randomUUID(), field: "team", value: team, linkedTaskId: null, requireTeam: true, updates: updates(keys) });
  const candidates = step.kind === "create" && step.source ? members.map(member => {
    const attending = data.people.find(p => p.key === member.displayName.trim());
    return { key: `user:${member.userId}`, name: member.displayName.trim(), team: attending?.team.value || (attending ? "Unassigned" : "Will be added as an attendee") };
  }) : data.people.filter(p => step.kind !== "members" || p.team.value !== step.team).sort((a,b) => Number(!!a.team.value) - Number(!!b.team.value)).map(p => ({ key: `person:${p.key}`, name: p.name, team: p.team.value || "Unassigned" }));
  const newCount = candidates.filter(candidate => picked.includes(candidate.key) && candidate.key.startsWith("user:") && !data.people.some(p => p.key === candidate.name)).length;
  const busyOrConflict = busy || loading || conflict || !canEdit;
  return <dialog ref={dialog} className="people-sheet" aria-labelledby={titleId} aria-busy={busy} onKeyDown={event => event.stopPropagation()} onCancel={event => { event.preventDefault(); if (!busy) close(); }}>
    <header className="people-sheet-header"><h2 id={titleId} className="ed-title">{title}</h2><button type="button" className="work-button" disabled={busy} onClick={close}>Close</button></header>
    {step.kind === "add" ? <div className="people-team-choices">
      {!data.shared ? <button type="button" className="work-button" onClick={() => transition({ kind: "directory" })}><span>Use an existing team<small className="work-muted">Choose a Taskboard team and its attending members</small></span></button> : null}
      <button type="button" className="work-button" onClick={() => { setName(""); transition({ kind: "create" }); }}><span>Create outage group<small className="work-muted">Make a group just for this outage</small></span></button>
    </div> : null}
    {step.kind === "directory" ? <div className="people-team-choices">{directory.map(team => <button type="button" className="work-button" key={team.id} onClick={() => { setName(team.name.slice(0,80)); transition({ kind: "create", source: team }); }}><span>{team.name}<small className="work-muted">{team.memberCount ?? ""} members{teamNames.includes(team.name) ? " · On board" : ""}</small></span></button>)}{!loading && !error && !directory.length ? <p className="work-muted">No Taskboard teams are available to you.</p> : null}<button type="button" className="work-button" onClick={() => transition({ kind: "add" })}>Back</button></div> : null}
    {step.kind === "create" || step.kind === "members" ? <>
      {step.kind === "create" ? <label className="people-team-name" htmlFor={nameId}>Team name<input id={nameId} className="work-input" maxLength={80} value={name} disabled={busy} placeholder="For example, Camera crew" onChange={event => { setRetry(null); setName(event.target.value); }}/></label> : null}
      <h3 className="work-section-label">{step.kind === "create" && step.source ? "Choose members attending this outage" : "Choose people"}</h3>
      <div className="people-member-list">{candidates.map(candidate => <label className="people-member-choice" key={candidate.key}><input type="checkbox" disabled={busy} checked={picked.includes(candidate.key)} onChange={event => choose(candidate.key,event.target.checked)}/><span>{candidate.name}<small className="work-muted">{candidate.team}</small></span></label>)}</div>
      <p className="work-muted">Changes apply to this outage.{newCount ? ` ${newCount} ${newCount === 1 ? "person will" : "people will"} also be added to its attendee list.` : ""}</p>
      {candidates.some(candidate => picked.includes(candidate.key) && data.people.some(p => p.key === candidate.name && p.team.value)) ? <p className="work-muted">Selected people in another team will move to this team for the outage.</p> : null}
      <div className="people-dialog-actions"><button type="button" className="work-button" disabled={busy} onClick={close}>Cancel</button><button type="button" className="work-button" disabled={busyOrConflict || (step.kind === "create" ? !name.trim() : !picked.length)} onClick={() => step.kind === "create" ? create() : assign(step.team,picked.map(key => key.slice(7)))}>{busy ? "Saving…" : retry ? "Retry" : step.kind === "create" ? `${teamNames.includes(name.trim()) ? "Add members" : "Add team"}${newCount ? ` + ${newCount} ${newCount === 1 ? "attendee" : "attendees"}` : ""}` : `Assign ${picked.length} ${picked.length === 1 ? "person" : "people"}`}</button></div>
    </> : null}
    {step.kind === "assign" ? <><p className="ed-body">{step.keys.join(", ")}</p><div className="people-team-choices">{[...teamNames, ""].map(team => <button key={team} type="button" className="work-button" disabled={busyOrConflict} onClick={() => assign(team,step.keys)}>{team || "Unassigned"}</button>)}</div></> : null}
    {step.kind === "remove" ? <><p className="ed-body">Remove this empty group from the outage?</p><button type="button" className="work-button" disabled={busyOrConflict} onClick={create}>{retry ? "Retry" : "Remove empty team"}</button></> : null}
    {step.kind === "person" && person ? <>
      <dl className="people-person-facts"><div><dt className="work-muted">Team for this outage</dt><dd>{person.team.value || "Unassigned"} {canEdit ? <button type="button" className="work-button" onClick={() => transition({ kind: "assign", keys: [person.key] })}>Change team</button> : null}</dd></div><div><dt className="work-muted">Location</dt><dd>{person.location.value || "Not reported"}</dd></div><div><dt className="work-muted">Working on</dt><dd>{person.activity.unavailable ? "Linked work is no longer available" : person.activity.value || "Not reported"}</dd></div></dl>
      {linked ? <p className="ed-body">Linked work: {linked.title}{linked.startAt && linked.endAt ? ` · ${formatItemSpan(linked, { timeZone })}` : ""}</p> : null}
      <h3 className="work-section-label">Recent changes</h3>{person.history.length ? <ol className="people-history">{person.history.map(entry => <li key={entry.id}><span className="work-muted">{entry.reportedAt ? new Intl.DateTimeFormat(undefined,{ timeZone, month:"short",day:"numeric",hour:"numeric",minute:"2-digit" }).format(new Date(entry.reportedAt)) : ""} · {entry.reporter}{entry.verified ? "" : " · shared"}</span><br/>{entry.field === "team" ? "Team" : entry.field === "location" ? "Location" : "Activity"}: {entry.unavailable ? "Linked work is no longer available" : entry.value || "Not reported"}</li>)}</ol> : <p className="work-muted">No reports yet.</p>}
    </> : null}
    {loading ? <p role="status" className="work-muted">Loading teams…</p> : null}
    {error ? <p role="alert" className="people-dialog-error">{error}</p> : null}
    {conflict ? <button type="button" className="work-button" disabled={busy} onClick={() => {
      base.current = data; setRetry(null); setConflict(false); setError("");
      setPicked(previous => previous.filter(key => key.startsWith("user:") ? members.some(member => `user:${member.userId}` === key) : data.people.some(p => `person:${p.key}` === key)));
      if (step.kind === "assign") { const keys = step.keys.filter(key => data.people.some(p => p.key === key)); if (keys.length) setStep({ kind: "assign", keys }); else close(); }
    }}>Use latest assignments</button> : null}
  </dialog>;
}
