"use client";

import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Users, X } from "lucide-react";
import type { Task } from "@/lib/taskboard-data";
import type { OutagePerson } from "@/lib/outage-people";
import { indexOutageWork, outageWorkRosters, type WorkRoster } from "@/lib/outage-work";
import type { OutagePeopleSource } from "./use-outage-people-source";
import { useModalOutsideDismiss } from "./use-modal-outside-dismiss";
import "./outage-work-roster.css";

const RosterContext = createContext<ReturnType<typeof useRosterValue> | null>(null);
function useRosterValue(task: Task, source: OutagePeopleSource) {
  const index = useMemo(() => indexOutageWork(task), [task]);
  const result = useMemo(() => outageWorkRosters(index, source.data?.people ?? []), [index, source.data]);
  return { ...result, index, source };
}
export function OutageWorkRosterProvider({ task, source, children }: { task: Task; source: OutagePeopleSource; children: ReactNode }) {
  const value = useRosterValue(task, source);
  return <RosterContext value={value}>{children}</RosterContext>;
}
export function WorkRosterNotice() {
  const context = useContext(RosterContext);
  return context?.unresolved.length ? <small className="work-muted" role="status">{context.unresolved.length} linked work {context.unresolved.length === 1 ? "report is" : "reports are"} waiting for the task list to refresh.</small> : null;
}

function packNames(people: OutagePerson[], width: number, lines: number, measure: (text: string) => number, prefix = "") {
  const output = Array.from({ length: lines }, () => "");
  let at = 0, placed = 0;
  for (const person of people) {
    const candidate = output[at] ? `${output[at]}, ${person.name}` : `${prefix}${person.name}`;
    if (measure(candidate) > width - (at === lines - 1 ? 30 : 2)) {
      if (at < lines - 1 && output[at]) { at++; }
      else if (output[at]) break;
      // A long single name is ellipsized, with the full value in the roster.
      output[at] = `${prefix}${person.name}`; placed++;
    } else { output[at] = candidate; placed++; }
  }
  return { output, more: people.length - placed };
}

export function OutageWorkRoster({ taskId, timeZone }: { taskId: string; timeZone: string }) {
  const context = useContext(RosterContext);
  const roster = context?.rosters.get(taskId);
  if (!context?.rosters.size) return null;
  return roster ? <WorkRosterContent taskId={taskId} timeZone={timeZone} context={context} roster={roster}/> : <span className="work-roster-slot" aria-hidden="true"/>;
}
function WorkRosterContent({ taskId, timeZone, context, roster }: { taskId: string; timeZone: string; context: ReturnType<typeof useRosterValue>; roster: WorkRoster }) {
  const button = useRef<HTMLButtonElement>(null), probe = useRef<HTMLSpanElement>(null), dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  useModalOutsideDismiss(dialog, () => setOpen(false), open);
  const guardReads = context.source.guardReads;
  const [metrics, setMetrics] = useState({ width: 190, lines: 2, font: "12px sans-serif" });
  useLayoutEffect(() => {
    if (!button.current || !probe.current) return;
    const read = () => {
      if (!button.current) return;
      const css = getComputedStyle(button.current);
      const next = { width: button.current.clientWidth, lines: parseFloat(css.lineHeight) * 2 <= 28 ? 2 : 1, font: css.font };
      setMetrics(previous => previous.width === next.width && previous.lines === next.lines && previous.font === next.font ? previous : next);
    };
    const observer = new ResizeObserver(read); observer.observe(button.current); observer.observe(probe.current); read();
    return () => observer.disconnect();
  }, [roster]);
  useEffect(() => {
    if (!open) return;
    const element = dialog.current; element?.showModal();
    const trigger = button.current;
    const unguard = guardReads(() => !!element?.open);
    return () => { unguard(); element?.close(); trigger?.focus(); };
  }, [open, guardReads]);
  const total = roster.direct.length + roster.descendants.length;
  const task = context.index.get(taskId)?.task;
  const compact = metrics.width < 100 || metrics.lines === 1;
  const canvas = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  if (canvas) canvas.font = metrics.font;
  const measure = (value: string) => canvas?.measureText(value).width ?? value.length * 7;
  const groupLines = (people: OutagePerson[], lines: number, prefix = "") => {
    const packed = packNames(people, metrics.width, lines, measure, prefix);
    return packed.output.map((line, index) => <span key={index} className={`work-roster-line ${prefix ? "work-roster-inherited" : ""}`}><span>{line}</span>{index === lines - 1 && packed.more ? <b>+{packed.more}</b> : null}</span>);
  };
  const groups = new Map<string, OutagePerson[]>();
  for (const person of [...roster.direct, ...roster.descendants]) {
    const id = person.activity.linkedTaskId!;
    groups.set(id, [...(groups.get(id) ?? []), person]);
  }
  return <span className="work-roster-slot">
    <button ref={button} type="button" className="work-roster-button" data-large-text={metrics.lines === 1} aria-label={`Working on ${task?.title}: ${total} ${total === 1 ? "person" : "people"}, ${roster.direct.length} directly and ${roster.descendants.length} in subtasks`} onClick={() => setOpen(true)}>
      <span ref={probe} className="work-roster-probe" aria-hidden="true">M</span>
      {compact ? <span className="work-roster-count"><Users aria-hidden="true"/>{total}</span> : roster.direct.length && roster.descendants.length ? <>{groupLines(roster.direct, 1)}{groupLines(roster.descendants, 1, "↳ ")}</> : groupLines(roster.direct.length ? roster.direct : roster.descendants, 2, roster.direct.length ? "" : "↳ ")}
    </button>
    {open ? <dialog ref={dialog} className="taskboard-shell work-roster-dialog" data-editor-scale="true" aria-label={`People working on ${task?.title}`} onCancel={event => { event.preventDefault(); setOpen(false); }} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) { event.preventDefault(); setOpen(false); } } }}>
      <header><h2>{task?.title}</h2><button type="button" className="work-button" aria-label="Close working people" onClick={() => setOpen(false)}><X/></button></header>
      <p className="work-muted">Last reported work · ↳ in subtasks</p>
      {[...groups].map(([id, people]) => <section key={id}><h3>{id === taskId ? "At this task" : context.index.get(id)?.titles.join(" › ") ?? "Task list refreshing"}</h3>{people.map(person => <div className="work-roster-person" key={person.key}><span>{person.name}</span><small>{person.activity.reportedAt ? `Reported ${new Intl.DateTimeFormat(undefined, { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(person.activity.reportedAt))}` : "Report time unavailable"}</small></div>)}</section>)}
    </dialog> : null}
  </span>;
}
