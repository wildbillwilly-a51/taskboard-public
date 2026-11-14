"use client";

import { createContext, useCallback, useContext, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export type TaskWorkspaceDestination = "work" | "updates" | "notes" | "details" | "files";
const WorkspaceContext = createContext<{ active: TaskWorkspaceDestination; setNotesCount: (count: number) => void; beforeLeaveNotes: (listener: () => void) => () => void }>({ active: "work", setNotesCount: () => {}, beforeLeaveNotes: () => () => {} });
export const useTaskWorkspace = () => useContext(WorkspaceContext);

export function TaskWorkspaceLayout({ work, workingNotes, notes, details, files, notesCount, filesCount }: {
  work: ReactNode;
  workingNotes: ReactNode;
  notes: ReactNode;
  details: ReactNode;
  files: ReactNode;
  notesCount: number;
  filesCount: number;
}) {
  const [active, setActive] = useState<TaskWorkspaceDestination>("work");
  const [linkedCount, setNotesCount] = useState(0);
  const [wide, setWide] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const id = useId();
  const tabs = useRef(new Map<TaskWorkspaceDestination, HTMLButtonElement>());
  const noteLeaveListener = useRef<(() => void) | null>(null);
  const beforeLeaveNotes = useCallback((listener: () => void) => {
    noteLeaveListener.current = listener;
    return () => { if (noteLeaveListener.current === listener) noteLeaveListener.current = null; };
  }, []);
  const activate = (destination: TaskWorkspaceDestination) => {
    if (active === "notes" && destination !== "notes") noteLeaveListener.current?.();
    setActive(destination);
  };
  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      const next = entry.contentRect.width >= 1180;
      setWide(next);
      if (next) setActive(current => current === "details" ? "work" : current);
    });
    if (root.current) observer.observe(root.current);
    return () => observer.disconnect();
  }, []);
  const destinations: Array<{ key: TaskWorkspaceDestination; label: string; count?: number }> = [
    { key: "work", label: "Work" },
    { key: "updates", label: "Working notes", count: notesCount },
    { key: "notes", label: "Notes", count: linkedCount },
    ...(!wide ? [{ key: "details" as const, label: "Details" }] : []),
    { key: "files", label: "Files", count: filesCount },
  ];
  const navigate = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0 : event.key === "End" ? destinations.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + destinations.length) % destinations.length;
    activate(destinations[next].key);
    tabs.current.get(destinations[next].key)?.focus();
  };
  const slots: Array<[TaskWorkspaceDestination, ReactNode]> = [["work", work], ["updates", workingNotes], ["notes", notes], ["details", details], ["files", files]];
  return <WorkspaceContext value={{ active, setNotesCount, beforeLeaveNotes }}>
    <div ref={root} className="task-workspace-layout min-h-0 flex-1" data-testid="task-workspace-layout" data-active-tab={active}>
      <div className="task-workspace-grid min-h-0">
        <nav className="task-workspace-tabs" role="tablist" aria-label="Task workspace sections">
          {destinations.map(({ key, label, count }, index) => <button key={key} type="button" role="tab"
            ref={element => { if (element) tabs.current.set(key, element); else tabs.current.delete(key); }}
            id={`${id}-${key}-tab`} aria-controls={`${id}-${key}-panel`} aria-selected={active === key}
            tabIndex={active === key ? 0 : -1} data-active={active === key} data-workspace-tab={key}
            onClick={() => activate(key)} onKeyDown={event => navigate(event, index)}>
            {label}{count ? <small> · {count}</small> : null}
          </button>)}
        </nav>
        {slots.map(([key, content]) => <section key={key} className="task-workspace-slot pretty-scrollbar"
          id={`${id}-${key}-panel`} role={key === "details" && wide ? "region" : "tabpanel"}
          aria-label={key === "details" && wide ? "Task details" : undefined}
          aria-labelledby={key === "details" && wide ? undefined : `${id}-${key}-tab`}
          hidden={key === "details" && wide ? false : active !== key}
          data-active={active === key} data-destination={key}>
          {content}
        </section>)}
      </div>
    </div>
  </WorkspaceContext>;
}
