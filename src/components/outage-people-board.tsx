"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type FocusEvent } from "react";
import { ChevronDown, MessageCircle } from "lucide-react";
import type { Task } from "@/lib/taskboard-data";
import { OutagePeopleDialog, type PeoplePanel, type PeopleCommand } from "./outage-people-dialog";
import { canonicalPlace, placeKey, reconcilePeopleGroups, type OutagePeopleState, type OutagePerson, type PeopleChange, type PeopleField, type PeopleGroup, type PeopleReport } from "@/lib/outage-people";
import { discussionDay, emptyPersonDetails, hasTravel, locationDuration, peopleTeamColors, travelCaption, travelDate, travelTime, unassignedTeamColor, type PeopleDetailsChange } from "@/lib/outage-people-details";
import { OutagePersonMenu } from "./outage-person-menu";
import { detailsDraft, OutagePersonTravelDialog, type DetailsDraft } from "./outage-person-travel-dialog";
import { useOutagePeopleSource, type OutagePeopleSource } from "./use-outage-people-source";
import { OutageWorkPicker } from "./outage-work-picker";
import { indexOutageWork } from "@/lib/outage-work";

type SaveFailure = Error & { status?: number; request?: PeopleChange };
type Save = (key: string, field: PeopleField, value: string, revision: string | null, linkedTaskId?: string | null, retry?: PeopleChange) => Promise<void>;
type Choice = { value: string; taskId?: string };
type Layout = PeopleGroup[];
type FieldDraft = { value: string; revision: string | null; original: string };
type FieldState = { draft: FieldDraft | null; failure: SaveFailure | null };
const captions: Record<PeopleField, string> = { team: "Team", location: "Location", activity: "Working on" };

function workItems(task: Task): Task[] { return task.subtasks.flatMap(child => [child, ...workItems(child)]); }
function groups(people: OutagePerson[], grouping: "team" | "location", teams: string[] = []): Layout {
  const byKey = new Map<string, PeopleGroup>();
  if (grouping === "team") for (const team of teams) byKey.set(team, { label: team === "Unassigned" ? "Unassigned (team)" : team, keys: [], team });
  for (const person of people) {
    const value = person[grouping].value;
    const label = value ? grouping === "team" && value === "Unassigned" ? "Unassigned (team)" : value : grouping === "team" ? "Unassigned" : "Location not reported";
    const key = grouping === "location" ? placeKey(label) : value;
    if (!byKey.has(key)) byKey.set(key, { label, keys: [], ...(grouping === "team" ? { team: value } : {}) });
    byKey.get(key)!.keys.push(person.key);
  }
  const result = [...byKey.values()];
  return grouping === "team" ? result.sort((a,b) => Number(!a.team) - Number(!b.team)) : result;
}
function reported(report: PeopleReport, timeZone: string) {
  if (!report.reportedAt) return "Not reported yet";
  return `${new Intl.DateTimeFormat(undefined, { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(report.reportedAt))} · ${report.reporter}${report.verified ? "" : " · shared"}`;
}
function sizePeopleValue(area: HTMLTextAreaElement) {
  area.style.height = "auto";
  area.style.height = `${area.scrollHeight + 2}px`;
  if (document.activeElement !== area) { area.scrollTop = 0; area.scrollLeft = 0; }
}

function PeopleFieldEditor({ person, field, canEdit, report, choices, saving, save, reload, state, changeState, workRoot, workTitle, workPath, selectedCount }: {
  person: OutagePerson; field: PeopleField; canEdit: boolean; report: PeopleReport; choices: Choice[]; saving: boolean; save: Save; reload: () => Promise<OutagePeopleState | null>; timeZone: string;
  state: FieldState | undefined; changeState: (update: (previous: FieldState) => FieldState) => void;
  workRoot?: Task; workTitle?: string; workPath?: string; selectedCount?: number;
}) {
  // The board owns drafts by person/field. A row may move between groups
  // while another writer's update is loaded; remounting must not erase text.
  const { draft, failure } = state ?? { draft: null, failure: null };
  const setDraft = (update: FieldDraft | null | ((previous: FieldDraft | null) => FieldDraft | null)) => changeState(previous => ({ ...previous, draft: typeof update === "function" ? update(previous.draft) : update }));
  const setFailure = (value: SaveFailure | null) => changeState(previous => ({ ...previous, failure: value }));
  const [open, setOpen] = useState(false);
  const [more, setMore] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null), fieldRoot = useRef<HTMLDivElement>(null), arrow = useRef<HTMLButtonElement>(null);
  const skipBlur = useRef(false), submitting = useRef(false);
  const restoreFocus = useRef(false);
  useLayoutEffect(() => {
    if (!saving && !open && restoreFocus.current) {
      restoreFocus.current = false; skipBlur.current = false;
      const active = document.activeElement;
      if (!active || active === document.body || fieldRoot.current?.contains(active)) arrow.current?.focus();
    }
  }, [saving, open]);
  const originalValue = !report.unavailable && report.linkedTaskId ? workTitle ?? report.value : report.value;
  const value = draft?.value ?? originalValue;
  const label = `${captions[field]} for ${person.name}`;
  const menuId = useId();
  const normalizedValue = field === "location" ? canonicalPlace(value, choices.map(choice => choice.value)) : value.trim();
  const recoveryLink = failure?.request && normalizedValue === failure.request.value ? failure.request.linkedTaskId : null;
  useLayoutEffect(() => {
    const area = input.current;
    if (area) sizePeopleValue(area);
  });
  const commit = async (text: string, taskId: string | null = null, retry?: PeopleChange, latestRevision?: string | null, explicitChoice = false) => {
    if (submitting.current || saving || !canEdit) return;
    const next = field === "location" ? canonicalPlace(text, choices.map(choice => choice.value)) : text.trim();
    // A transport retry represents exactly one immutable request. Changed
    // text is a new correction, still guarded by the draft's original revision.
    const retryRequest = retry && next === retry.value && taskId === retry.linkedTaskId ? retry : undefined;
    setOpen(false);
    // An explicit bulk choice may change other people even when this anchor
    // already matches. Merely focusing, tabbing or pressing Enter must not.
    if ((!explicitChoice || (selectedCount ?? 1) <= 1) && !failure && !retryRequest && next === (draft?.original ?? report.value) && (!taskId || taskId === report.linkedTaskId)) { setDraft(null); return; }
    submitting.current = true;
    try {
      await save(person.key, field, next, latestRevision !== undefined ? latestRevision : draft ? draft.revision : report.revision, taskId, retryRequest);
      setDraft(null); setFailure(null);
    } catch (reason) {
      setDraft(previous => ({ value: next, revision: previous ? previous.revision : report.revision, original: previous?.original ?? report.value }));
      setFailure(reason as SaveFailure);
    } finally { submitting.current = false; }
  };
  const leave = (event: FocusEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
    setOpen(false);
    if (skipBlur.current) { skipBlur.current = false; return; }
    if (!failure && draft) void commit(input.current?.value ?? draft.value);
  };
  const search = draft && value !== draft.original ? value.trim().toLocaleLowerCase() : "";
  const matches = choices.filter(choice => search.length < 2 || choice.value.toLocaleLowerCase().includes(search));
  const filtered = more ? matches : matches.slice(0, 6);
  return <div className={`people-field people-field-${field}`} data-people-field onBlur={leave} ref={fieldRoot}>
    <span className="people-mobile-label">{field === "location" ? "Location" : field === "activity" ? "Working on" : "Team"}</span>
    <div className="people-field-input">
      {canEdit ? <textarea ref={input} className="work-input people-value" rows={1} aria-label={label} title={value || undefined} value={value} maxLength={field === "team" ? 80 : field === "location" ? 240 : 1000} disabled={saving}
        placeholder={report.unavailable ? "Linked work is no longer available" : field === "location" ? "Not set" : `Add ${field === "activity" ? "work" : field}`}
        onFocus={event => { skipBlur.current = false; if (!draft) setDraft({ value: originalValue, revision: report.revision, original: originalValue }); sizePeopleValue(event.currentTarget); }}
        onBlur={event => { event.currentTarget.scrollTop = 0; event.currentTarget.scrollLeft = 0; }}
        onChange={event => { const text = event.target.value; setDraft(previous => ({ value: text, revision: previous ? previous.revision : report.revision, original: previous?.original ?? originalValue })); setMore(false); setOpen(field !== "activity" && text.trim().length >= 2); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing) return;
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); skipBlur.current = true; setDraft(null); setFailure(null); setOpen(false); event.currentTarget.blur(); }
          else if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); skipBlur.current = true; void commit(event.currentTarget.value, recoveryLink, failure?.status !== 409 ? failure?.request : undefined); event.currentTarget.blur(); }
        }} /> : <span className={`people-read-value ${!report.value ? "work-muted" : ""}`} title={report.unavailable ? undefined : originalValue || undefined}>{report.unavailable ? "Linked work is no longer available" : originalValue || "Not reported"}</span>}
      {canEdit ? <button ref={arrow} type="button" className="work-button people-arrow" aria-label={`${field === "activity" ? "Work" : captions[field]} choices for ${person.name}`} aria-controls={menuId} aria-expanded={open} disabled={saving} onPointerDown={event => event.preventDefault()} onClick={event => { event.currentTarget.focus(); setOpen(previous => !previous); }}><ChevronDown aria-hidden="true"/></button> : null}
    </div>
    {workPath && !draft && !report.unavailable ? <small className="people-report work-muted" title={workPath}>{workPath}</small> : null}
    {open && workRoot && field === "activity" ? <OutageWorkPicker id={menuId} task={workRoot} linkedTaskId={report.linkedTaskId} query={search} personName={person.name} selectedCount={selectedCount} close={() => setOpen(false)} choose={(title, id) => { restoreFocus.current = true; skipBlur.current = true; void commit(title, id, undefined, undefined, true); }}/> : open ? <div className={`people-choices ${more ? "people-choices-full" : ""}`} id={menuId} role="group" aria-label={`Suggested ${field === "activity" ? "work" : field === "team" ? "teams" : "locations"}`}>
      {filtered.length ? filtered.map(choice => <button type="button" className="work-button" key={`${choice.taskId ?? ""}:${choice.value}`} onPointerDown={event => event.preventDefault()} onClick={() => { const inputFocused = document.activeElement === input.current; if (inputFocused) skipBlur.current = true; void commit(choice.value, choice.taskId ?? null, undefined, undefined, true); if (inputFocused) input.current?.blur(); }}>{choice.value}</button>) : <span className="work-muted">No matching suggestions</span>}
      {!more && matches.length > 6 ? <button type="button" className="work-button" onPointerDown={event => event.preventDefault()} onClick={() => setMore(true)}>More · {matches.length} items</button> : null}
    </div> : null}
    {failure ? <div className="people-field-error" role="alert"><p>{failure.message}</p>{failure.status === 409 ? <>
      <p className="work-muted">Latest: {report.value || "Not reported"}</p>
      <button className="work-button" type="button" onClick={async () => { if (await reload()) { setDraft(null); setFailure(null); } }}>Use latest</button>
      <button className="work-button" type="button" onClick={async () => { const latest = await reload(); const revision = latest?.people.find(p => p.key === person.key)?.[field].revision; if (revision !== undefined) void commit(value, recoveryLink, undefined, revision); }}>Save my text</button>
    </> : <button className="work-button" type="button" onClick={() => void commit(value, recoveryLink, failure.request)}>Retry</button>}</div> : null}
  </div>;
}

type BoardProps = { task: Task; endpoint: string; canEdit: boolean; timeZone: string; active?: boolean; onRosterChanged?: (taskId: string, attendees: string[]) => void; source?: OutagePeopleSource };
export function OutagePeopleBoard(props: BoardProps) {
  return props.source ? <OutagePeopleBoardBody {...props} source={props.source}/> : <StandalonePeopleBoard {...props}/>;
}
function StandalonePeopleBoard(props: BoardProps) {
  const source = useOutagePeopleSource(props.endpoint, props.active ?? true, JSON.stringify(props.task.maintenanceOutage?.attendees ?? []));
  return <OutagePeopleBoardBody {...props} source={source}/>;
}
function OutagePeopleBoardBody({ task, endpoint, canEdit, timeZone, active = true, onRosterChanged, source }: BoardProps & { source: OutagePeopleSource }) {
  const { data, message, setMessage, latest, alive, pending, apply, clear, reload, guardReads, listen, beginMutation, commitMutation, endMutation } = source;
  const [grouping, setGrouping] = useState<"team" | "location">("team"), [panel, setPanel] = useState<PeoplePanel | null>(null);
  const [view, setView] = useState<"all" | "travel">("all"), [now, setNow] = useState(Date.now);
  const [travelPerson, setTravelPerson] = useState<string | null>(null), [detailsDrafts, setDetailsDrafts] = useState<Record<string, DetailsDraft>>({});
  const [detailsUndo, setDetailsUndo] = useState<PeopleDetailsChange | null>(null);
  const [selecting, setSelecting] = useState(false), [selected, setSelected] = useState<string[]>([]);
  const [reporterPreference, setReporter] = useState(() => {
    try { return sessionStorage.getItem(`taskboard.people.reporter:${task.id}`) ?? ""; } catch { return ""; }
  });
  const [pendingKeys, setPendingKeys] = useState<string[]>([]), [layout, setLayout] = useState<Layout | null>(null);
  const [fieldStates, setFieldStates] = useState<Record<string, FieldState>>({});
  const [undo, setUndo] = useState<{ field: PeopleField; people: { key: string; value: string; linkedTaskId: string | null; revision: string }[] } | null>(null);
  const tail = useRef<Promise<unknown>>(Promise.resolve()), root = useRef<HTMLElement>(null);
  const works = useMemo(() => workItems(task), [task]);
  const workIndex = useMemo(() => indexOutageWork(task), [task]);
  const attendeesRevision = JSON.stringify(task.maintenanceOutage?.attendees ?? []);
  const committedAttendees = useRef(attendeesRevision);
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;
    let width = 0, font = "";
    const resize = () => {
      if (!element.clientWidth) { width = 0; return; }
      const nextFont = getComputedStyle(element).font;
      if (width === element.clientWidth && font === nextFont) return;
      width = element.clientWidth; font = nextFont;
      element.querySelectorAll<HTMLTextAreaElement>("textarea.people-value").forEach(sizePeopleValue);
    };
    const observer = new ResizeObserver(resize); observer.observe(element); resize();
    return () => observer.disconnect();
  }, []);
  const fieldFocused = useCallback(() => !!root.current?.querySelector("[data-people-field]:focus-within, .people-person-menu[open], .people-sheet[open], .outage-work-picker[open]"), []);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  useEffect(() => guardReads(fieldFocused), [guardReads, fieldFocused]);
  useEffect(() => { committedAttendees.current = attendeesRevision; }, [attendeesRevision]);
  useEffect(() => listen(value => setSelected(previous => previous.filter(key => value?.people.some(person => person.key === key)))), [listen]);
  // A saved preference is valid only while that name remains on this roster.
  const reporter = data?.people.some(p => p.name === reporterPreference) ? reporterPreference : "";
  const editable = canEdit && !!data?.canEdit && (!data.shared || !!reporter);
  const send = useCallback((input: PeopleCommand) => {
    const current = latest.current;
    if (!current?.canEdit || !canEdit || current.shared && !reporter) return Promise.reject(new Error("Choose who is reporting before editing."));
    const request: PeopleCommand = { ...input, ...(current.shared ? { reporterName: reporter } : {}) };
    const field = "field" in request ? request.field : "team";
    const isDetails = "operation" in request && request.operation === "person-details";
    const busyKeys = request.updates.map(update => `${update.personKey}:${isDetails ? "details" : field}`);
    const attendeesAtRequest = committedAttendees.current;
    const authority = beginMutation(); setPendingKeys(previous => [...previous, ...busyKeys]); setMessage("Saving…");
    const before = isDetails ? [] : current.people.filter(p => request.updates.some(update => update.personKey === p.key)).map(p => ({ key: p.key, value: p[field].value, linkedTaskId: p[field].linkedTaskId, revision: p[field].revision }));
    const job = async () => {
      try {
        const response = await fetch(endpoint, { method: "PATCH", cache: "no-store", signal: AbortSignal.timeout(15_000), credentials: current.shared ? "omit" : "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request) });
        const result = await response.json().catch(() => ({ error: "Unable to save. Your text has been kept. Try again." }));
        if (!response.ok) {
          if ([401, 403, 404].includes(response.status)) { clear(); }
          const error: SaveFailure = new Error(result.error || "Unable to save. Your text has been kept."); error.status = response.status; if ("field" in request) error.request = request;
          if (response.status === 409) await reload();
          throw error;
        }
        // A roster refresh that started during this save must not put older
        // reports back after the PATCH response has already been applied.
        if (!commitMutation(authority)) throw new Error("People access changed. Refresh before editing.");
        apply(result);
        if (!isDetails && ("operation" in request || request.field === "team")) onRosterChanged?.(task.id, result.people.map((person: OutagePerson) => person.name));
        // An attendee save can commit after this report's server snapshot was
        // taken. Finish by reading that newer roster instead of reverting it
        // until the next poll when the report response arrives late.
        if (attendeesAtRequest !== committedAttendees.current) await reload();
        if (alive.current) {
          setMessage("Saved");
          setDetailsUndo(null);
          if (isDetails) {
            const previous = current.people.find(p => p.key === request.updates[0].personKey), person = result.people.find((p: OutagePerson) => p.key === request.updates[0].personKey);
            const proof = result.applied?.find((p: NonNullable<OutagePeopleState["applied"]>[number]) => p.field === "details" && p.personKey === previous?.key);
            const locationProof = result.applied?.find((p: NonNullable<OutagePeopleState["applied"]>[number]) => p.field === "location" && p.personKey === previous?.key);
            if (previous && proof && (previous.details?.revision ?? null) === request.updates[0].expectedRevision && (!request.location || previous.location.revision === request.location.expectedRevision) && person?.details?.revision === proof.revision && (!locationProof || person.location.revision === locationProof.revision)) { const prior = previous.details ?? emptyPersonDetails(); setDetailsUndo({ operation: "person-details", mutationId: crypto.randomUUID(), updates: [{ personKey: previous.key, expectedRevision: proof.revision }], travel: prior.travel, discussedDay: prior.discussedDay, ...(locationProof ? { location: { value: previous.location.value, expectedRevision: locationProof.revision } } : {}) }); }
          }
          const undoable = before.flatMap(p => {
            if (request.updates.find(update => update.personKey === p.key)?.expectedRevision !== p.revision) return [];
            const proof = result.applied?.find((entry: NonNullable<OutagePeopleState["applied"]>[number]) => entry.personKey === p.key && entry.field === field);
            const report = result.people.find((entry: OutagePerson) => entry.key === p.key)?.[field];
            return proof && report?.revision === proof.revision ? [{ ...p, revision: proof.revision }] : [];
          });
          setUndo("field" in request && before.length && undoable.length === before.length && before.every(p => p.value === before[0].value && p.linkedTaskId === before[0].linkedTaskId) ? { field, people: undoable } : null);
        }
      } catch (reason) {
        const error = reason as SaveFailure; if ("field" in request) error.request ??= request;
        if (alive.current) setMessage(error.message || "Unable to save people.");
        throw error;
      } finally {
        endMutation();
        if (alive.current) { setPendingKeys(previous => previous.filter(key => !busyKeys.includes(key))); if (!fieldFocused() && !pending.current) setLayout(null); }
      }
    };
    const operation = tail.current.then(job, job); tail.current = operation.catch(() => {});
    return operation;
  }, [apply, canEdit, clear, endpoint, fieldFocused, reload, reporter, onRosterChanged, task.id, alive, latest, pending, setMessage, beginMutation, commitMutation, endMutation]);
  const save: Save = (personKey, field, value, revision, linkedTaskId = null, retry) => {
    const current = latest.current;
    const keys = selected.includes(personKey) ? selected : [personKey];
    return send(retry ?? { mutationId: crypto.randomUUID(), field, value, linkedTaskId,
      updates: keys.map(key => ({ personKey: key, expectedRevision: key === personKey ? revision : current?.people.find(p => p.key === key)?.[field].revision ?? null })) });
  };
  const today = discussionDay(timeZone);
  const teamColors = peopleTeamColors([...(data?.teams ?? []), ...(data?.people.map(person => person.team.value) ?? [])]);
  const traveling = view === "travel";
  const visiblePeople = data?.people.filter(person => !traveling || hasTravel((person.details ?? emptyPersonDetails()).travel)) ?? [];
  const grouped = data ? groups(visiblePeople, grouping, traveling ? [] : data.teams).map(group => traveling ? { ...group, keys: group.keys.toSorted((a,b) => Number(data.people.find(p => p.key === a)?.details?.travel.phase === "left") - Number(data.people.find(p => p.key === b)?.details?.travel.phase === "left")) } : group) : [];
  const displayed = layout ? reconcilePeopleGroups(layout, grouped) : grouped;
  const byKey = new Map(data?.people.map(person => [person.key, person]) ?? []);
  const locations: Choice[] = [...new Set([...(data?.locations ?? []), "Remote", "Off site"])].map(value => ({ value }));
  const choices: Choice[] = works.map(work => ({ value: work.title, taskId: work.id }));
  const openTravel = (person: OutagePerson) => { setDetailsDrafts(previous => { const prior = previous[person.key]; return prior && (prior.dirty || prior.error || prior.request) ? previous : { ...previous, [person.key]: detailsDraft(person) }; }); setTravelPerson(person.key); };
  const closeTravel = () => { if (travelPerson) setDetailsDrafts(previous => { const draft = previous[travelPerson]; if (draft && (draft.dirty || draft.error || draft.request)) return previous; const next = { ...previous }; delete next[travelPerson]; return next; }); setTravelPerson(null); if (!pending.current) setLayout(null); };
  const fieldEditor = (person: OutagePerson, field: PeopleField) => {
    const key = `${person.key}:${field}`;
    return <PeopleFieldEditor key={key} person={person} field={field} report={person[field]} state={fieldStates[key]} changeState={update => setFieldStates(previous => ({ ...previous, [key]: update(previous[key] ?? { draft: null, failure: null }) }))} canEdit={editable && (!selected.length || selected.includes(person.key))} choices={field === "location" ? locations : choices} saving={pendingKeys.includes(key)} save={save} reload={reload} timeZone={timeZone} workRoot={field === "activity" ? task : undefined} workTitle={field === "activity" ? workIndex.get(person.activity.linkedTaskId ?? "")?.task.title : undefined} workPath={field === "activity" ? workIndex.get(person.activity.linkedTaskId ?? "")?.titles.slice(0, -1).join(" › ") : undefined} selectedCount={selected.includes(person.key) ? selected.length : 1}/>;
  };
  return <section className="outage-people" data-testid="outage-people-board" ref={root}
    onFocusCapture={event => { if ((event.target as HTMLElement).closest("[data-people-field]") && !layout) setLayout(grouped); }}
    // Release grouping after the field's bubbling blur has initiated its save.
    // Capture-phase regrouping can remove the row before that handler runs.
    onBlur={event => { if (!(event.relatedTarget as HTMLElement | null)?.closest?.("[data-people-field]") && !pending.current) setLayout(null); }}>
    {selecting ? <div className="people-toolbar"><button type="button" className="work-button" onClick={() => { setSelecting(false); setSelected([]); }}>Done selecting</button></div> : null}
    <div className="work-seg people-tabs" role="group" aria-label="People filters"><button type="button" aria-pressed={!traveling} onClick={() => { setLayout(null); setView("all"); setGrouping("team"); }}>All {data?.people.length ?? 0}</button><button type="button" aria-pressed={traveling} onClick={() => { setLayout(null); setView("travel"); setGrouping("team"); setSelected([]); setSelecting(false); }}>Traveling {data?.people.filter(p => hasTravel((p.details ?? emptyPersonDetails()).travel)).length ?? 0}</button></div>
    {data?.shared && canEdit && data.canEdit ? <label className="people-reporter ed-body">Reporting as <select aria-label="Reporting as" className="work-input" value={reporter} onChange={event => { setReporter(event.target.value); try { sessionStorage.setItem(`taskboard.people.reporter:${task.id}`, event.target.value); } catch { /* optional preference */ } }}><option value="">Choose your name</option>{data.people.map(p => <option value={p.name} key={p.key}>{p.name}</option>)}</select><span className="work-muted">Reported name</span></label> : null}
    {selected.length ? <div className="people-selection work-muted">Edits apply to {selected.length} selected {selected.length === 1 ? "person" : "people"}. <button type="button" className="work-button" onClick={() => setPanel({ kind: "assign", keys: selected.slice() })}>Change team</button><button type="button" className="work-button" onClick={() => setSelected([])}>Clear selection</button></div> : null}
    {!data ? <p role="status" className="work-muted">{message}</p> : !visiblePeople.length && !displayed.length ? <p className="work-muted">{traveling ? "No travel details added yet." : "Add attendees in the outage details to start the People board."}</p> : <><div className={`people-columns ${traveling ? "people-travel-columns" : ""}`} aria-hidden="true"><span>Person</span>{traveling ? <><span>Arrival</span><span>Departure</span><span>Travel notes</span></> : <><span>Location</span><span>Duration</span><span>Working on</span><span>Discussed</span></>}</div>{displayed.map(group => <section className="people-group" key={group.label} data-unassigned={!group.team} style={{ "--people-team-color": teamColors[group.team ?? ""] ?? unassignedTeamColor } as CSSProperties}><header className="people-group-header"><h3 className="people-group-title">{group.label} <span className="work-muted">{group.keys.length}</span></h3>{!group.keys.length && editable ? <button type="button" className="work-button" onClick={() => setPanel({ kind: "remove", team: group.team! })}>Remove empty team</button> : null}</header>{!group.keys.length ? <p className="work-muted">No people assigned yet.</p> : null}{group.keys.map(key => {
      const person = byKey.get(key); if (!person) return null;
      const details = person.details ?? emptyPersonDetails(), travel = details.travel, caption = travelCaption(travel), busy = pendingKeys.includes(`${key}:details`);
      const menu = <OutagePersonMenu person={person} data={data} canEdit={editable} traveling={traveling} submit={send} openTravel={() => openTravel(person)} openReports={() => setPanel({ kind: "person", key })} selectPeople={() => { setSelecting(true); setSelected([key]); }} onClosed={() => { if (!pending.current) setLayout(null); }}/>;
      const dateCell = (label: string, date: string, extra: string) => <button type="button" className="people-travel-cell" aria-label={`${label} for ${person.name}: ${[date || "not set", extra].filter(Boolean).join(", ")}`} onClick={() => openTravel(person)}><span className="people-travel-mobile-label work-muted">{label}</span><span>{date || "—"}</span>{extra ? <small className="work-muted">{extra}</small> : null}</button>;
      return <div className={`${traveling ? "people-travel-person" : "people-person"} ${selected.includes(key) ? "people-selected" : ""}`} key={key} data-person={key} data-travel={!!caption} data-phase={travel.phase}>
        <div className="people-person-heading"><div className="people-name">{selecting && editable ? <label className="people-select-target"><input type="checkbox" aria-label={`Select ${person.name}`} checked={selected.includes(key)} onChange={event => setSelected(previous => event.target.checked ? [...previous, key] : previous.filter(id => id !== key))}/></label> : null}<button type="button" className="people-name-button" aria-label={`Details for ${person.name}`} data-person-key={person.key} onClick={() => traveling ? openTravel(person) : setPanel({ kind: "person", key })}>{person.name}</button>{menu}</div>{traveling ? <small className="people-travel-status work-muted">{travel.phase === "inbound" ? "Traveling in" : travel.phase === "arrived" ? "On site" : travel.phase === "left" ? "Left site" : "Travel planned"}</small> : caption ? <button type="button" className="people-trip-caption work-muted" onClick={() => openTravel(person)}>{caption}</button> : null}</div>
        {traveling ? <>{dateCell("Arrival", travelDate(travel.arrival.slice(0,10)), [travelTime(travel.arrival.slice(11)), travel.phase === "inbound" && travel.arrival ? "Expected" : ""].filter(Boolean).join(" · "))}{dateCell("Departure", travelDate(travel.phase === "left" && travel.leftDate ? travel.leftDate : travel.departureDate), travel.phase === "left" && travel.leftDate ? "Left site" : travelTime(travel.departureTime))}<button type="button" className="people-travel-cell people-travel-notes" data-empty={!travel.travelNotes} onClick={() => openTravel(person)} aria-label={`Travel notes for ${person.name}: ${travel.travelNotes || "none"}`} title={travel.travelNotes || undefined}><span className="people-travel-mobile-label work-muted">Travel notes</span><span>{travel.travelNotes || "—"}</span></button></> : <><div className="people-location-pair">{fieldEditor(person, "location")}<span className="people-location-meta"><span className="people-mobile-label" aria-hidden="true">Location</span><span className="people-duration work-muted" title={reported(person.location,timeZone)} aria-label={`Duration since location update for ${person.name}`}>{person.location.value ? locationDuration(person.location.reportedAt,now) : "—"}</span></span></div>{fieldEditor(person, "activity")}<button type="button" className="work-button people-discussed" disabled={!editable || busy} aria-pressed={details.discussedDay === today} aria-label={`${details.discussedDay === today ? "Undo discussed mark for" : "Mark discussed for"} ${person.name}`} title={`Discussed on ${today} (${timeZone}); does not change location or work`} onClick={() => { const command: PeopleDetailsChange = { operation: "person-details", mutationId: crypto.randomUUID(), updates: [{ personKey: key, expectedRevision: details.revision }], travel, discussedDay: details.discussedDay === today ? "" : today }; void send(command).catch(() => {}); }}><MessageCircle aria-hidden="true"/></button></>}
      </div>;
    })}</section>)}</>}
    {data ? <div className="people-footer"><span className="work-muted">{data.shared ? "Shared page" : `Reporting as ${data.viewerName}`} · {timeZone}</span><span className="work-muted" role="status" aria-live="polite">{message || (editable ? "Click or tap a field to edit" : "Read only")}</span>{undo && editable ? <button type="button" className="work-button" disabled={!!pendingKeys.length} onClick={async () => {
      const request: PeopleChange = { mutationId: crypto.randomUUID(), field: undo.field, value: undo.people[0].value, linkedTaskId: undo.people[0].linkedTaskId, updates: undo.people.map(p => ({ personKey: p.key, expectedRevision: p.revision })), ...(data.shared ? { reporterName: reporter } : {}) };
      // Different previous values need distinct guarded corrections. Keep this
      // command all-or-nothing: only offer bulk Undo when the values match.
      try { await save(undo.people[0].key, undo.field, request.value, undo.people[0].revision, request.linkedTaskId, request); setUndo(null); setMessage("Change undone"); } catch { /* the save notice explains the conflict */ }
    }}>Undo</button> : null}{detailsUndo && editable ? <button type="button" className="work-button" disabled={!!pendingKeys.length} onClick={async () => { try { await send(detailsUndo); setDetailsUndo(null); setMessage("Change undone"); } catch { /* retain guarded Undo */ } }}>Undo</button> : null}</div> : null}
    {panel && data && active ? <OutagePeopleDialog key={JSON.stringify(panel)} panel={panel} data={data} canEdit={editable} works={works} timeZone={timeZone} submit={send} reload={reload} close={() => { setPanel(null); if (!pending.current) setLayout(null); }}/> : null}
    {travelPerson && data && active && byKey.get(travelPerson) && detailsDrafts[travelPerson] ? <OutagePersonTravelDialog key={travelPerson} person={byKey.get(travelPerson)!} draft={detailsDrafts[travelPerson]} today={today} canEdit={editable} changeDraft={draft => setDetailsDrafts(previous => { const next = { ...previous }; if (draft) next[travelPerson] = draft; else delete next[travelPerson]; return next; })} submit={send} reload={reload} close={closeTravel}/> : null}
  </section>;
}
