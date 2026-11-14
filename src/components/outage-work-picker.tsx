"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ArrowLeft, Check, ChevronDown, ChevronRight, Search, X } from "lucide-react";
import type { Task } from "@/lib/taskboard-data";
import { indexOutageWork, type WorkChoice } from "@/lib/outage-work";
import { useModalOutsideDismiss } from "./use-modal-outside-dismiss";
import "./outage-work-picker.css";

export function OutageWorkPicker({ task, linkedTaskId, query = "", close, choose, personName, selectedCount = 1, id }: {
  task: Task; linkedTaskId: string | null; query?: string; close: () => void; id?: string;
  choose: (title: string, id: string) => void; personName: string; selectedCount?: number;
}) {
  const index = useMemo(() => indexOutageWork(task), [task]);
  const dialog = useRef<HTMLDialogElement>(null), titleId = useId();
  useModalOutsideDismiss(dialog, close);
  const [search, setSearch] = useState(query);
  const [expanded, setExpanded] = useState(() => new Set(index.get(linkedTaskId ?? "")?.path.slice(0, -1) ?? []));
  const [levelId, setLevelId] = useState<string | null>(() => index.get(linkedTaskId ?? "")?.parentId ?? null);
  const [phone, setPhone] = useState(() => typeof window !== "undefined" && matchMedia("(max-width:767px)").matches);
  const [pendingChoice, setPendingChoice] = useState<WorkChoice | null>(null);
  useEffect(() => {
    const trigger = document.activeElement as HTMLElement | null;
    const element = dialog.current;
    const media = matchMedia("(max-width:767px)");
    const update = () => {
      setPhone(media.matches);
      if (!element || media.matches) return;
      const anchor = element.closest("[data-people-field]")?.getBoundingClientRect();
      if (!anchor) return;
      const box = element.getBoundingClientRect();
      // The root's reserved scrollbar gutters offset the fixed containing box.
      // Keep the popup inside that box, rather than adding its offset twice.
      const viewport = document.documentElement.getBoundingClientRect();
      element.style.setProperty("--work-picker-left", `${Math.max(8, Math.min(anchor.left - viewport.left, viewport.width - box.width - 8))}px`);
      element.style.setProperty("--work-picker-top", `${Math.max(8, Math.min(anchor.bottom + 6, innerHeight - box.height - 8))}px`);
    };
    const observer = new ResizeObserver(update);
    media.addEventListener("change", update); window.addEventListener("resize", update); element?.showModal(); if (element) observer.observe(element); update();
    element?.querySelector('[data-current="true"]')?.scrollIntoView({ block: "nearest" });
    return () => { observer.disconnect(); media.removeEventListener("change", update); window.removeEventListener("resize", update); element?.close(); if (trigger?.isConnected) trigger.focus(); };
  }, []);
  const pick = (item: WorkChoice) => selectedCount > 1 ? setPendingChoice(item) : choose(item.task.title, item.task.id);
  const children = (parent: string | null) => [...index.values()].filter(item => item.parentId === parent);
  const matches = search.trim().length >= 2 ? [...index.values()].filter(item => item.titles.join(" ").toLocaleLowerCase().includes(search.trim().toLocaleLowerCase())) : null;
  const currentLevel = index.get(levelId ?? "");
  const renderTree = (parent: string | null): React.ReactNode => children(parent).map(item => {
    const nested = children(item.task.id).length > 0, open = expanded.has(item.task.id);
    return <div key={item.task.id}>
      <div className="work-picker-row" style={{ paddingInlineStart: item.depth * 17 }} data-current={item.task.id === linkedTaskId}>
        {nested ? <button type="button" className="work-picker-caret" aria-label={`${open ? "Collapse" : "Expand"} ${item.task.title}`} aria-expanded={open} onClick={() => setExpanded(previous => { const next = new Set(previous); if (open) next.delete(item.task.id); else next.add(item.task.id); return next; })}>{open ? <ChevronDown/> : <ChevronRight/>}</button> : <span className="work-picker-caret"/>}
        <button type="button" className="work-picker-choice" onClick={() => pick(item)}><span>{item.task.title}{item.task.status === "done" ? <small>Done</small> : null}</span>{item.task.id === linkedTaskId ? <Check aria-label="Current task"/> : null}</button>
      </div>{nested && open ? renderTree(item.task.id) : null}
    </div>;
  });
  return <dialog ref={dialog} id={id} className="taskboard-shell outage-work-picker" data-editor-scale="true" data-phone={phone} aria-labelledby={titleId} onCancel={event => { event.preventDefault(); close(); }} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) { event.preventDefault(); close(); } } }} onKeyDown={event => event.stopPropagation()}>
    <header><div><h2 id={titleId}>Choose work</h2><span className="work-muted">{selectedCount > 1 ? `${selectedCount} selected people` : personName}</span></div><button type="button" className="work-button" aria-label="Close work picker" onClick={close}><X/></button></header>
    <label className="work-picker-search"><Search aria-hidden="true"/><input className="work-input" aria-label="Search all work" placeholder="Search all tasks…" value={search} onChange={event => setSearch(event.target.value)}/></label>
    <div className="work-picker-items">
      {matches ? matches.length ? matches.map(item => <button key={item.task.id} type="button" className="work-picker-result" onClick={() => pick(item)}><span>{item.task.title}</span><small>{item.titles.slice(0, -1).join(" › ") || "Top-level task"}{item.task.status === "done" ? " · Done" : ""}</small></button>) : <p className="work-muted">No matching tasks</p> : phone ? <>
        <div className="work-picker-level">{currentLevel ? <button type="button" className="work-button" aria-label="Back to parent tasks" onClick={() => setLevelId(currentLevel.parentId)}><ArrowLeft/></button> : null}<div><strong>{currentLevel?.task.title ?? "Top-level tasks"}</strong><small>{currentLevel?.titles.slice(0, -1).join(" › ") || task.title}</small></div></div>
        {currentLevel ? <button type="button" className="work-button work-picker-use" onClick={() => pick(currentLevel)}>Use “{currentLevel.task.title}”</button> : null}
        {children(levelId).map(item => { const count = children(item.task.id).length; return <button key={item.task.id} type="button" className="work-picker-result" onClick={() => count ? setLevelId(item.task.id) : pick(item)}><span>{item.task.title}<small>{count ? `${count} subtasks` : item.task.status === "done" ? "Done" : ""}</small></span>{count ? <ChevronRight/> : item.task.id === linkedTaskId ? <Check/> : null}</button>; })}
      </> : renderTree(null)}
    </div>
    {pendingChoice ? <footer><span>{pendingChoice.titles.join(" › ")}</span><button type="button" className="work-button" onClick={() => choose(pendingChoice.task.title, pendingChoice.task.id)}>Set {selectedCount} people to this task</button></footer> : <footer className="work-muted">{phone ? "Open a parent to choose it or its subtasks." : "Arrows expand. Task names select."}</footer>}
  </dialog>;
}
