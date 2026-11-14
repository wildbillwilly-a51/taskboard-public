"use client";

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type CSSProperties,
} from "react";
import {
  DndContext,
  DragOverlay,
  MouseSensor,
  TouchSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragMoveEvent,
} from "@dnd-kit/core";
import { ChevronDown, Clock3, GripVertical, MoreHorizontal, Plus, Trash2 } from "lucide-react";

import type { Task } from "@/lib/taskboard-data";
import { getTaskCompletion } from "@/lib/task-completion";
import {
  formatHours,
  formatItemSpan,
  getItemSpan,
  getWindowFill,
  isOutsideWindow,
  type TimedItem,
  type TimeSpan,
} from "@/lib/work-windows";
import { WorkItemTimeEditor, type WorkItemPatch } from "@/components/work-item-time-editor";
import { SubtaskBoard } from "@/components/subtask-board";
import { OutagePeopleBoard } from "@/components/outage-people-board";
import { useOutagePeopleSource } from "./use-outage-people-source";
import { OutageWorkRoster, OutageWorkRosterProvider, WorkRosterNotice } from "./outage-work-roster";
import { getTimelineLabels } from "@/lib/timeline-labels";
import { selectTimelineTicks } from "@/lib/timeline-ticks";
import { getTimelineAxis } from "@/lib/timeline-axis";
import { getWorkstreamColor } from "@/lib/subtask-board";
import { subtaskExpansionKey, useSubtaskExpansion } from "@/components/subtask-expansion-prefs";
import {
  getDropMove,
  getIndentMove,
  getOutdentMove,
  getCurrentPlacement,
  isNoOpMove,
  type DropZone,
  type SubtaskMove,
} from "@/lib/subtask-move";

export type { WorkItemPatch };

type Handlers = {
  canEdit: boolean;
  timeZone: string;
  onSaveTask: (taskId: string, patch: WorkItemPatch) => unknown;
  onDeleteTask?: (taskId: string) => unknown;
  onAddSubtask: (taskId: string, title: string) => unknown;
  onMoveSubtask?: (move: SubtaskMove, options?: { announce?: boolean }) => unknown;
  onPeopleRosterChanged?: (taskId: string, attendees: string[]) => void;
};

// Shared by every row: what is being dragged, where it would land, and which
// row should reopen its title editor after a Tab or Shift+Tab move.
type WorkMoveState = {
  root: Task;
  canMove: boolean;
  moving: boolean;
  activeId: string | null;
  dropTarget: { overId: string; zone: DropZone } | null;
  pendingEditId: string | null;
  setPendingEditId: (taskId: string | null) => void;
  move: (move: SubtaskMove, options?: { announce?: boolean }) => void;
};

const WorkMoveContext = createContext<WorkMoveState | null>(null);
const WorkExpansionContext = createContext<ReturnType<typeof useSubtaskExpansion> | null>(null);

function findTask(root: Task, taskId: string): Task | null {
  if (root.id === taskId) {
    return root;
  }
  for (const child of root.subtasks) {
    const found = findTask(child, taskId);
    if (found) {
      return found;
    }
  }
  return null;
}

// Top quarter of a row drops before it, bottom quarter after it, the middle
// inside it.
function getDropZone(event: DragMoveEvent): DropZone | null {
  const over = event.over;
  const pointer = event.activatorEvent as PointerEvent | TouchEvent;
  const startY = "touches" in pointer ? pointer.touches[0]?.clientY : pointer.clientY;
  if (!over || typeof startY !== "number") {
    return null;
  }
  const relative = (startY + event.delta.y - over.rect.top) / Math.max(1, over.rect.height);
  return relative < 0.28 ? "before" : relative > 0.72 ? "after" : "inside";
}

function isPlainEnter(event: ReactKeyboardEvent<HTMLElement>) {
  return event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.nativeEvent.isComposing;
}

function hasAnyTime(tasks: Task[]): boolean {
  return tasks.some((task) => Boolean(task.startAt && task.endAt) || hasAnyTime(task.subtasks));
}

function countItems(tasks: Task[]): { total: number; done: number } {
  return tasks.reduce(
    (sum, task) => {
      const nested = countItems(task.subtasks);
      return { total: sum.total + 1 + nested.total, done: sum.done + (getTaskCompletion(task) === "done" ? 1 : 0) + nested.done };
    },
    { total: 0, done: 0 },
  );
}

type WorkBreakdownProps = Handlers & {
  task: Task;
  checklist: ReactNode;
  checklistDetail: string;
  viewerId?: string;
  peopleEndpoint?: string;
  // A subtask someone opened by link: the Board shows it selected.
  focusTaskId?: string | null;
};

export function WorkBreakdown(props: WorkBreakdownProps) {
  return <WorkBreakdownVisit key={`${subtaskExpansionKey(props.task.id, props.viewerId)}:${props.focusTaskId ?? ""}:${props.peopleEndpoint ?? ""}`} {...props} />;
}

function WorkBreakdownVisit({
  task,
  checklist,
  checklistDetail,
  viewerId,
  peopleEndpoint,
  focusTaskId,
  ...handlers
}: WorkBreakdownProps) {
  const expansion = useSubtaskExpansion(task.id, viewerId);
  const [view, setView] = useState<"list" | "board" | "timeline" | "people">(focusTaskId ? "board" : "list");
  const [peopleVisited, setPeopleVisited] = useState(false);
  const source = useOutagePeopleSource(peopleEndpoint ?? `/api/tasks/${encodeURIComponent(task.id)}/people`, task.workItemType === "maintenance_outage" && (view === "list" || view === "people"), JSON.stringify(task.maintenanceOutage?.attendees ?? []));
  const [newTitle, setNewTitle] = useState("");
  const addInputRef = useRef<HTMLInputElement | null>(null);
  const counts = countItems(task.subtasks);
  const usesTimes = hasAnyTime(task.subtasks);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<WorkMoveState["dropTarget"]>(null);
  const [pendingEditId, setPendingEditId] = useState<string | null>(null);
  const [moving, setMoving] = useState(false);
  const moveInFlight = useRef(false);
  const canMove = Boolean(handlers.canEdit && handlers.onMoveSubtask);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  );
  const moveState: WorkMoveState = {
    root: task,
    canMove,
    moving,
    activeId,
    dropTarget,
    pendingEditId,
    setPendingEditId,
    move: (move, options) => {
      if (moveInFlight.current || isNoOpMove(task, move)) return;
      moveInFlight.current = true;
      setMoving(true);
      void Promise.resolve(handlers.onMoveSubtask?.(move, options)).finally(() => {
        moveInFlight.current = false;
        setMoving(false);
      });
    },
  };
  const trackDrop = (event: DragMoveEvent) => {
    const zone = getDropZone(event);
    const overId = event.over ? String(event.over.id) : null;
    if (!zone || !overId || !getDropMove(task, String(event.active.id), overId, zone)) {
      setDropTarget(null);
      return;
    }
    setDropTarget((current) => (current?.overId === overId && current.zone === zone ? current : { overId, zone }));
  };
  const endDrag = () => {
    setActiveId(null);
    setDropTarget(null);
  };
  const activeTask = activeId ? findTask(task, activeId) : null;

  const submitNew = async () => {
    const title = newTitle.trim();
    if (!title || !handlers.canEdit) {
      return;
    }
    setNewTitle("");
    await handlers.onAddSubtask(task.id, title);
    // Keep the field ready for the next item.
    addInputRef.current?.focus();
  };

  return (
    <OutageWorkRosterProvider task={task} source={source}><section className="work-breakdown grid gap-2.5" data-testid="task-work-breakdown" aria-label="Subtasks and checklist">
      <section className="work-subtasks" aria-label="Subtasks">
      <div className="work-subtask-header" data-testid="task-subtask-header">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 className="work-section-label">{view === "people" ? "People" : "Subtasks"}</h2>
        <span className="work-muted tabular-nums" data-testid="task-subtask-progress">
          {view === "people" ? `${task.maintenanceOutage?.attendees.length ?? 0} attendees` : counts.total > 0 ? `${counts.done} of ${counts.total} done` : "None yet"}
        </span>
        {counts.total > 0 || task.workItemType === "maintenance_outage" ? (
          <div className="work-seg ml-auto" role="group" aria-label="Subtask view">
            <button type="button" aria-pressed={view === "list"} onClick={() => setView("list")}>
              List
            </button>
            <button type="button" aria-pressed={view === "board"} onClick={() => setView("board")} data-testid="task-subtask-board-toggle">
              Board
            </button>
            <button type="button" aria-pressed={view === "timeline"} onClick={() => setView("timeline")} data-testid="task-subtask-timeline-toggle">
              Timeline
            </button>
            {task.workItemType === "maintenance_outage" ? <button type="button" aria-pressed={view === "people"} onClick={() => { setPeopleVisited(true); setView("people"); }} data-testid="task-outage-people-toggle">People</button> : null}
          </div>
        ) : null}
      </div>

      {view !== "people" && counts.total > 0 && counts.done > 0 ? (
        <div className="work-progress" aria-hidden="true">
          <i style={{ width: `${(counts.done / counts.total) * 100}%` }} />
        </div>
      ) : null}
      </div>

      {peopleVisited ? <div hidden={view !== "people"}><OutagePeopleBoard key={task.id} task={task} source={source} endpoint={peopleEndpoint ?? `/api/tasks/${encodeURIComponent(task.id)}/people`} canEdit={handlers.canEdit} timeZone={handlers.timeZone} active={view === "people"} onRosterChanged={handlers.onPeopleRosterChanged}/></div> : null}
      {view === "people" ? null : view === "timeline" ? (
        <SubtaskTimeline task={task} timeZone={handlers.timeZone} />
      ) : view === "board" ? (
        <SubtaskBoard task={task} initialSelectedId={focusTaskId} {...handlers} />
      ) : (
        <div className="work-list" data-testid="task-subtask-list" data-people={task.workItemType === "maintenance_outage" && !!source.data?.people.some(person => person.activity.linkedTaskId && !person.activity.unavailable)}>
          <WorkRosterNotice/>
          <WorkMoveContext.Provider value={moveState}>
            <DndContext
              sensors={sensors}
              collisionDetection={pointerWithin}
              onDragStart={(event) => setActiveId(String(event.active.id))}
              onDragMove={trackDrop}
              onDragOver={trackDrop}
              onDragCancel={endDrag}
              onDragEnd={(event) => {
                const move = dropTarget && event.over
                  ? getDropMove(task, String(event.active.id), dropTarget.overId, dropTarget.zone)
                  : null;
                endDrag();
                if (move) {
                  moveState.move(move, { announce: true });
                }
              }}
            >
              <WorkExpansionContext value={expansion}>
                {task.subtasks.map((subtask) => (
                  <WorkItemNode key={subtask.id} item={subtask} depth={0} parent={null} usesTimes={usesTimes} color={getWorkstreamColor(task, subtask)} {...handlers} />
                ))}
              </WorkExpansionContext>
              <DragOverlay dropAnimation={null}>
                {activeTask ? <div className="work-drag-overlay">{activeTask.title}</div> : null}
              </DragOverlay>
            </DndContext>
          </WorkMoveContext.Provider>
          {handlers.canEdit ? (
            <div className="work-add-row">
              <label className="sr-only" htmlFor={`add-subtask-${task.id}`}>Add subtask</label>
              <input
                ref={addInputRef}
                id={`add-subtask-${task.id}`}
                value={newTitle}
                onChange={(event) => setNewTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (isPlainEnter(event)) {
                    event.preventDefault();
                    void submitNew();
                  }
                }}
                placeholder="Add subtask. Enter adds another."
                className="work-input"
                data-testid="task-add-subtask-input"
              />
              <button type="button" className="work-button" onClick={() => void submitNew()} disabled={!newTitle.trim()}>
                Add
              </button>
            </div>
          ) : task.subtasks.length === 0 ? (
            <p className="work-empty">No subtasks.</p>
          ) : null}
        </div>
      )}

      </section>
      {view !== "people" ? <><div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="work-section-label">Checklist</h2>
        <span className="work-muted">{checklistDetail}</span>
      </div>
      <div className="work-checklist">{checklist}</div></> : null}
    </section></OutageWorkRosterProvider>
  );
}

function WorkItemActions({ title, hasTime, onTime, onAdd, onDelete }: {
  title: string;
  hasTime: boolean;
  onTime: () => void;
  onAdd: () => void;
  onDelete?: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const panelId = useId();
  const root = useRef<HTMLSpanElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const firstAction = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!expanded) return;
    if (document.activeElement === trigger.current) firstAction.current?.focus();
    const outside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setExpanded(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [expanded]);

  return (
    <span
      ref={root}
      className="work-actions"
      data-expanded={expanded}
      onPointerEnter={(event) => { if (event.pointerType === "mouse") setExpanded(true); }}
      onPointerLeave={(event) => {
        if (event.pointerType === "mouse" && !event.currentTarget.contains(document.activeElement)) setExpanded(false);
      }}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setExpanded(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded) {
          event.preventDefault();
          event.stopPropagation();
          setExpanded(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        className="work-actions-trigger"
        aria-label={`Subtask actions for ${title}`}
        aria-expanded={expanded}
        aria-controls={panelId}
        aria-hidden={expanded || undefined}
        tabIndex={expanded ? -1 : 0}
        title="Subtask actions"
        onClick={() => setExpanded(true)}
      >
        <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
      </button>
      <span id={panelId} className="work-actions-panel" role="group" aria-label={`Actions for ${title}`} hidden={!expanded}>
        {/* The first action stays on the right as the strip expands left. */}
        <button ref={firstAction} type="button" aria-label="Add child subtask" title="Add work inside" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button type="button" aria-label={hasTime ? "Change time" : "Set time"} title={hasTime ? "Change time" : "Set time"} onClick={onTime}>
          <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        {onDelete ? <button type="button" aria-label="Delete subtask" title="Delete" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
        </button> : null}
      </span>
    </span>
  );
}

function WorkItemNode({
  item,
  depth,
  parent,
  usesTimes,
  color,
  ...handlers
}: Handlers & {
  item: Task;
  depth: number;
  parent: Task | null;
  usesTimes: boolean;
  /** The workstream color, given to top-level items; their work inherits it. */
  color?: string;
}) {
  const { canEdit, timeZone, onSaveTask, onDeleteTask, onAddSubtask } = handlers;
  const moveState = useContext(WorkMoveContext);
  const canMove = Boolean(moveState?.canMove);
  const {
    attributes: dragAttributes,
    listeners: dragListeners,
    setNodeRef: setDragNodeRef,
    setActivatorNodeRef: setDragHandleRef,
  } = useDraggable({ id: item.id, disabled: !canMove });
  const { setNodeRef: setDropNodeRef } = useDroppable({ id: item.id, disabled: !canMove });
  const dropZone = moveState?.dropTarget?.overId === item.id ? moveState.dropTarget.zone : undefined;
  const isDragging = moveState?.activeId === item.id;
  const expansion = useContext(WorkExpansionContext)!;
  const isOpen = expansion.isOpen(item.id, depth);
  const setIsOpen = (expanded: boolean) => expansion.setOpen(item.id, expanded);
  // After Tab or Shift+Tab the row remounts in its new place with its title
  // editor open, so typing can continue.
  const [startedFromMove] = useState(() => moveState?.pendingEditId === item.id);
  const [isEditing, setIsEditing] = useState(startedFromMove);
  const [draftTitle, setDraftTitle] = useState(item.title);
  const [isTimeOpen, setIsTimeOpen] = useState(false);
  const [isAddingChild, setIsAddingChild] = useState(false);
  const [childTitle, setChildTitle] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [phone, setPhone] = useState(false);
  const rowRoot = useRef<HTMLDivElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const update = () => {
      setPhone(media.matches);
      if (!media.matches) setMenuOpen(false);
    };
    update();media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: PointerEvent) => { if (!rowRoot.current?.contains(event.target as Node)) setMenuOpen(false); };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menuOpen]);
  const span = getItemSpan(item);
  const parentSpan = parent ? getItemSpan(parent) : null;
  const hasChildren = item.subtasks.length > 0;
  const isWindow = Boolean(span && hasChildren);
  const fill = isWindow ? getWindowFill(item, item.subtasks) : null;
  const outside = Boolean(parent && span && parentSpan && isOutsideWindow(parent, item));
  const completion = getTaskCompletion(item);
  const isDone = completion === "done";
  const placement = moveState ? getCurrentPlacement(moveState.root, item.id) : null;
  const siblings = placement && moveState ? findTask(moveState.root, placement.parentTaskId)?.subtasks ?? [] : [];
  const previous = placement ? siblings[placement.targetIndex - 1] : undefined;
  const next = placement ? siblings[placement.targetIndex + 1] : undefined;

  const clearPendingEdit = moveState?.setPendingEditId;
  useEffect(() => {
    if (startedFromMove) {
      clearPendingEdit?.(null);
    }
  }, [clearPendingEdit, startedFromMove]);

  const moveWithTab = (outdent: boolean) => {
    if (!moveState || moveState.moving) {
      return false;
    }
    const move = outdent ? getOutdentMove(moveState.root, item.id) : getIndentMove(moveState.root, item.id);
    if (!move) {
      return false;
    }
    const nextTitle = draftTitle.trim();
    if (nextTitle && nextTitle !== item.title) {
      void onSaveTask(item.id, { title: nextTitle });
    }
    setIsEditing(false);
    moveState.setPendingEditId(item.id);
    moveState.move(move);
    return true;
  };

  const saveTitle = async () => {
    const nextTitle = draftTitle.trim();
    setIsEditing(false);
    if (!nextTitle) {
      setDraftTitle(item.title);
      return;
    }
    if (nextTitle !== item.title && canEdit) {
      await onSaveTask(item.id, { title: nextTitle });
    }
  };

  const submitChild = async () => {
    const title = childTitle.trim();
    if (!title || !canEdit) {
      setIsAddingChild(false);
      setChildTitle("");
      return;
    }
    setChildTitle("");
    await onAddSubtask(item.id, title);
  };

  let when: ReactNode = null;
  if (span) {
    const sameAsParentDay = Boolean(parentSpan) && !item.allDay;
    when = (
      <span className="work-when" data-kind={isWindow ? "window" : "timed"} title={formatItemSpan(item, { timeZone })}>
        {formatItemSpan(item, { timeZone, includeDay: !sameAsParentDay })}
      </span>
    );
  } else if (!parentSpan && usesTimes && depth === 0) {
    when = canEdit ? (
      <button type="button" className="work-tag work-tag-action" onClick={() => setIsTimeOpen(true)}>
        Not scheduled · Set time
      </button>
    ) : (
      <span className="work-tag">Not scheduled</span>
    );
  }

  return (
    <div ref={rowRoot} className="work-node" data-depth={depth} style={color ? { "--work-color": color } as CSSProperties : undefined} onKeyDown={event => {
      if (event.key === "Escape" && menuOpen) { event.stopPropagation();setMenuOpen(false);menuButton.current?.focus(); }
    }}>
      <div
        ref={(node) => {
          setDropNodeRef(node);
          setDragNodeRef(node);
        }}
        className="work-row"
        data-task-menu-target={item.id}
        tabIndex={-1}
        data-kind={isWindow ? "window" : depth === 0 ? "top" : "child"}
        data-top-level={depth === 0}
        data-has-children={hasChildren}
        data-can-move={canMove}
        data-can-edit={canEdit}
        data-done={isDone ? "true" : undefined}
        data-drop={dropZone}
        data-dragging={isDragging ? "true" : undefined}
        style={{ "--work-depth": depth } as CSSProperties}
        data-testid="task-subtask-row"
      >
        {canMove ? (
          <button
            type="button"
            ref={setDragHandleRef}
            {...dragListeners}
            {...dragAttributes}
            tabIndex={-1}
            className="work-drag-handle"
            aria-label={`Drag ${item.title} to move it. Or edit its title and press Tab or Shift+Tab.`}
            title="Drag to move into or out of another subtask"
            data-testid="task-subtask-drag-handle"
          >
            <GripVertical className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : null}
        {hasChildren ? (
          <button
            type="button"
            className="work-caret"
            aria-expanded={isOpen}
            aria-label={`${isOpen ? "Collapse" : "Expand"} ${item.title}`}
            onClick={() => setIsOpen(!isOpen)}
          >
            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
          </button>
        ) : (
          <span className="work-caret-spacer" aria-hidden="true" />
        )}
        <label className="work-check-target">
          <input
            type="checkbox"
            ref={node => { if (node) node.indeterminate = completion === "mixed"; }}
            checked={isDone}
            aria-checked={completion === "mixed" ? "mixed" : isDone}
            onChange={() => void onSaveTask(item.id, { status: isDone ? "todo" : "done" })}
            disabled={!canEdit}
            aria-label={isDone ? "Mark subtask not done" : "Mark subtask done"}
            className="work-check"
          />
        </label>
        <div className="work-row-content">
        {isEditing ? (
          <textarea
            rows={1}
            autoFocus
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(event) => {
              if (isPlainEnter(event)) {
                event.preventDefault();
                void saveTitle();
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setDraftTitle(item.title);
                setIsEditing(false);
              } else if (
                event.key === "Tab" &&
                !event.ctrlKey &&
                !event.altKey &&
                !event.metaKey &&
                canMove &&
                moveWithTab(event.shiftKey)
              ) {
                // Tab nests under the subtask above, Shift+Tab moves out. When
                // there is nowhere to go, Tab moves focus as usual.
                event.preventDefault();
              }
            }}
            className="work-input work-title-input"
            aria-label="Subtask title"
          />
        ) : (
          <button
            type="button"
            className="work-title"
            onClick={() => {
              if (phone && hasChildren) setIsOpen(!isOpen);
              else if (canEdit) {
                setDraftTitle(item.title);
                setIsEditing(true);
              }
            }}
            disabled={!canEdit && !(phone && hasChildren)}
            aria-expanded={phone && hasChildren ? isOpen : undefined}
            title={item.title}
          >
            {hasChildren ? <ChevronDown className="work-title-caret" aria-hidden="true" data-open={isOpen} /> : null}{item.title}
          </button>
        )}
        <OutageWorkRoster taskId={item.id} timeZone={timeZone}/>
        <span className="work-row-meta">
        {outside ? <span className="work-warn">Outside the window</span> : null}
        {when}
        {fill ? (
          <span className="work-fill" title={`${formatHours(fill.scheduledHours)} of ${formatHours(fill.totalHours)} hours have work scheduled`}>
            <span className="work-fill-bar" aria-hidden="true">
              <i style={{ width: `${Math.min(100, (fill.scheduledHours / fill.totalHours) * 100)}%` }} />
            </span>
            {formatHours(fill.scheduledHours)} of {formatHours(fill.totalHours)} h
          </span>
        ) : null}
        </span>
        </div>
        {canEdit ? (
          <WorkItemActions
            title={item.title}
            hasTime={Boolean(span)}
            onTime={() => setIsTimeOpen((current) => !current)}
            onAdd={() => { setIsAddingChild(true); setIsOpen(true); }}
            onDelete={onDeleteTask ? () => void onDeleteTask(item.id) : undefined}
          />
        ) : null}
        <button ref={menuButton} type="button" className="work-row-menu" aria-label={`Subtask actions for ${item.title}`} aria-expanded={menuOpen} onClick={() => setMenuOpen(current => !current)}><MoreHorizontal aria-hidden="true" /></button>
      </div>

      {menuOpen ? <div className="work-mobile-actions" aria-label={`Actions for ${item.title}`}>
        {canEdit ? <>
          <button type="button" onClick={() => { setIsTimeOpen(true);setMenuOpen(false); }}>Set time</button>
          <button type="button" onClick={() => { setDraftTitle(item.title);setIsEditing(true);setMenuOpen(false); }}>Rename</button>
          <button type="button" onClick={() => { setIsAddingChild(true);setIsOpen(true);setMenuOpen(false); }}>Add child</button>
          {onDeleteTask ? <button type="button" onClick={() => { setMenuOpen(false);void onDeleteTask(item.id); }}>Delete</button> : null}
        </> : null}
        {canMove && moveState ? <>
          <button type="button" disabled={moveState.moving || !previous} onClick={() => { const move = previous && getDropMove(moveState.root, item.id, previous.id, "before");if (move) moveState.move(move);setMenuOpen(false); }}>Move up</button>
          <button type="button" disabled={moveState.moving || !next} onClick={() => { const move = next && getDropMove(moveState.root, item.id, next.id, "after");if (move) moveState.move(move);setMenuOpen(false); }}>Move down</button>
          <button type="button" disabled={moveState.moving || !getIndentMove(moveState.root, item.id)} onClick={() => { const move = getIndentMove(moveState.root, item.id);if (move) moveState.move(move);setMenuOpen(false); }}>Indent</button>
          <button type="button" disabled={moveState.moving || !getOutdentMove(moveState.root, item.id)} onClick={() => { const move = getOutdentMove(moveState.root, item.id);if (move) moveState.move(move);setMenuOpen(false); }}>Outdent</button>
        </> : null}
        {!canEdit ? <span className="work-muted">Read only</span> : null}
        <button type="button" onClick={() => { setMenuOpen(false);menuButton.current?.focus(); }}>Close</button>
      </div> : null}

      {isTimeOpen ? (
        <WorkItemTimeEditor
          item={item}
          parentSpan={parentSpan}
          depth={depth}
          onCancel={() => setIsTimeOpen(false)}
          onSave={async (patch) => {
            setIsTimeOpen(false);
            await onSaveTask(item.id, patch);
          }}
        />
      ) : null}

      {hasChildren ? (
        <div className="work-children" hidden={!isOpen}>
          {item.subtasks.map((child) => (
            <WorkItemNode key={child.id} item={child} depth={depth + 1} parent={span ? item : parent} usesTimes={usesTimes} {...handlers} />
          ))}
        </div>
      ) : null}

      {isAddingChild ? (
        <div className="work-add-row" style={{ "--work-depth": depth + 1 } as CSSProperties}>
          <label className="sr-only" htmlFor={`add-child-${item.id}`}>Add work inside {item.title}</label>
          <input
            autoFocus
            id={`add-child-${item.id}`}
            value={childTitle}
            onChange={(event) => setChildTitle(event.target.value)}
            onKeyDown={(event) => {
              if (isPlainEnter(event)) {
                event.preventDefault();
                void submitChild();
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setChildTitle("");
                setIsAddingChild(false);
              }
            }}
            onBlur={() => {
              if (!childTitle.trim()) {
                setIsAddingChild(false);
              }
            }}
            placeholder={`Add work inside "${item.title}". Enter adds another.`}
            className="work-input"
          />
        </div>
      ) : null}
    </div>
  );
}

type Lane = { key: string; title: string; item: TimedItem; span: TimeSpan | null; done: boolean; isWindow: boolean; topLevel?: boolean; color?: string; workTitles?: string[] };

function descendantTitles(tasks: Task[]): string[] {
  return tasks.flatMap(task => [task.title, ...descendantTitles(task.subtasks)]);
}

function WindowTimelineBar({ lane, timeZone, style }: { lane: Lane; timeZone: string; style: CSSProperties }) {
  const { startAt, endAt, allDay } = lane.item;
  const labels = useMemo(() => getTimelineLabels({ startAt, endAt, allDay }, timeZone)!, [startAt, endAt, allDay, timeZone]);
  const [full, compact, duration] = labels.candidates;
  const [labelIndex, setLabelIndex] = useState(2);
  const barRef = useRef<HTMLSpanElement>(null);
  const measuresRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const bar = barRef.current;
    const measures = measuresRef.current;
    if (!bar || !measures) return;
    const fit = () => {
      const css = getComputedStyle(bar);
      const available = bar.getBoundingClientRect().width
        - parseFloat(css.borderLeftWidth) - parseFloat(css.borderRightWidth)
        - parseFloat(css.paddingLeft) - parseFloat(css.paddingRight) - 0.5;
      const index = [...measures.children].findIndex(child => child.getBoundingClientRect().width <= available);
      setLabelIndex(index < 0 ? 2 : index);
    };
    // Intrinsic text probes also resize on font/scale changes, even when the
    // scheduled bar's dimensions have not changed.
    const observer = new ResizeObserver(fit);
    observer.observe(bar);
    [...measures.children].forEach(child => observer.observe(child));
    fit();
    return () => observer.disconnect();
  }, [full, compact, duration]);
  const details = `${lane.title}\n${labels.details}${lane.workTitles?.length ? `\nWork: ${lane.workTitles.join("; ")}` : ""}`;
  return <span ref={barRef} className="work-timeline-bar work-timeline-window-bar" role="img" aria-label={details} title={details}
    data-done={lane.done ? "true" : undefined} style={style}>
    <span className="work-timeline-window-label">{labels.candidates[labelIndex]}</span>
    <span ref={measuresRef} className="work-timeline-label-measures" aria-hidden="true">
      {labels.candidates.map((label, index) => <span key={index}>{label}</span>)}
    </span>
  </span>;
}

function TimelineStrip({ title, range, lanes, timeZone, tone, color }: { title: string; range: TimeSpan; lanes: Lane[]; timeZone: string; tone: "outage" | "window"; color?: string }) {
  const total = range.end - range.start;
  const pct = (value: number) => `${(Math.max(0, Math.min(total, value)) / total) * 100}%`;
  // A bar draws only the part of its span inside the strip's range.
  const visible = (span: TimeSpan): TimeSpan | null => {
    const start = Math.max(span.start, range.start);
    const end = Math.min(span.end, range.end);
    return end > start ? { start, end } : null;
  };
  const barStyle = (span: TimeSpan): CSSProperties => ({ left: pct(span.start - range.start), width: pct(span.end - span.start) });
  const { ticks, nights } = useMemo(() => getTimelineAxis({ start: range.start, end: range.end }, timeZone), [range.start, range.end, timeZone]);
  const axisRef = useRef<HTMLDivElement>(null);
  const [visibleTicks, setVisibleTicks] = useState<number[] | null>(null);
  useEffect(() => {
    const axis = axisRef.current;
    if (!axis) return;
    const labels = Array.from(axis.children) as HTMLElement[];
    const measure = () => {
      const indices = selectTimelineTicks(labels.map(label => label.getBoundingClientRect()), 8);
      setVisibleTicks(previous => previous?.join(",") === indices.join(",") ? previous : indices);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(axis);
    labels.forEach(label => observer.observe(label));
    measure();
    return () => observer.disconnect();
  }, [ticks]);

  return (
    <div className="work-timeline-strip" data-tone={tone} style={color ? { "--work-color": color } as CSSProperties : undefined}>
      <h3 className="work-timeline-title">{title}</h3>
      <div className="work-timeline-scroll">
        <div className="work-timeline-grid">
          <span className="work-timeline-axis-spacer" />
          <div ref={axisRef} className="work-timeline-axis">
            {ticks.map((tick, index) => (
              <span key={tick.at} data-edge={index === 0 ? "start" : index === ticks.length - 1 ? "end" : undefined} style={{ left: pct(tick.at - range.start), visibility: visibleTicks?.includes(index) ? "visible" : "hidden" }}>{tick.label}</span>
            ))}
          </div>
          {lanes.map((lane) => {
            const shown = lane.span ? visible(lane.span) : null;
            return (
            <div key={lane.key} className="contents" style={lane.color ? { "--work-color": lane.color } as CSSProperties : undefined}>
              <span className="work-timeline-label" title={lane.title} data-top-level={lane.topLevel}>
                <span className="work-timeline-name">{lane.title}</span>{lane.span ? <span className="work-timeline-time" data-short={(lane.span.end - lane.span.start) / total < 0.2}>{formatItemSpan(lane.item, { timeZone, includeDay: false })}</span> : null}
              </span>
              <div className="work-timeline-lane">
                {nights.map((night) => (
                  <span
                    key={night.start}
                    className="work-timeline-night"
                    aria-hidden="true"
                    style={{ left: pct(night.start - range.start), width: pct(Math.min(night.end, range.end) - Math.max(night.start, range.start)) }}
                  />
                ))}
                {lane.span && !shown ? (
                  <span className="work-tag work-timeline-unscheduled work-timeline-outside" title={`${lane.title} · ${formatItemSpan(lane.item, { timeZone })}`}>
                    Outside the window<span className="sr-only"> · {formatItemSpan(lane.item, { timeZone })}</span>
                  </span>
                ) : lane.span && shown ? tone === "window" ? (
                  <WindowTimelineBar lane={lane} timeZone={timeZone} style={barStyle(shown)} />
                ) : (
                  <span
                    className="work-timeline-bar"
                    data-window={lane.isWindow ? "true" : undefined}
                    role="img"
                    aria-label={`${lane.title} · ${formatItemSpan(lane.item, { timeZone })}`}
                    data-done={lane.done ? "true" : undefined}
                    title={`${lane.title} · ${formatItemSpan(lane.item, { timeZone })}`}
                    style={barStyle(shown)}
                  >
                    {/* Short bars keep their time in the tooltip (and beside the title on phones). */}
                    <span className="work-timeline-bar-time">{(shown.end - shown.start) / total >= 0.1
                      ? formatItemSpan(lane.item, { timeZone, includeDay: tone === "outage" && !lane.item.allDay })
                      : null}</span>
                  </span>
                ) : tone !== "window" ? (
                  <span className="work-tag work-timeline-unscheduled">Not scheduled</span>
                ) : null}
              </div>
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// The whole task on one strip, then each window opened hour by hour.
export function SubtaskTimeline({ task, timeZone }: { task: Task; timeZone: string }) {
  const lanes: Lane[] = task.subtasks.map((subtask) => ({
    key: subtask.id,
    title: subtask.title,
    item: subtask,
    span: getItemSpan(subtask),
    done: getTaskCompletion(subtask) === "done",
    isWindow: Boolean(getItemSpan(subtask) && subtask.subtasks.length > 0),
    topLevel: true,
    color: getWorkstreamColor(task, subtask),
  }));
  const timed = lanes.filter((lane) => lane.span) as Array<Lane & { span: TimeSpan }>;
  const own = getItemSpan(task);

  if (timed.length === 0) {
    return (
      <p className="work-empty" data-testid="task-subtask-timeline">
        Give a subtask a time (the clock button on its row) to see it here. A subtask with a time and work under it shows as a window.
      </p>
    );
  }

  const range: TimeSpan = own ?? {
    start: Math.min(...timed.map((lane) => lane.span.start)),
    end: Math.max(...timed.map((lane) => lane.span.end)),
  };
  const windows = task.subtasks.filter((subtask) => getItemSpan(subtask) && subtask.subtasks.length > 0);

  return (
    <div className="work-timeline" data-testid="task-subtask-timeline">
      <TimelineStrip title={own ? `Whole ${task.workItemType === "maintenance_outage" ? "outage" : "task"} · ${formatItemSpan(task, { timeZone })}` : "All scheduled subtasks"} range={range} lanes={lanes} timeZone={timeZone} tone="outage" />
      {windows.map((windowTask) => {
        const windowSpan = getItemSpan(windowTask) as TimeSpan;
        const fill = getWindowFill(windowTask, windowTask.subtasks);
        return (
          <TimelineStrip
            key={windowTask.id}
            title={`Inside ${windowTask.title} · ${formatItemSpan(windowTask, { timeZone })}${fill ? ` · ${formatHours(fill.scheduledHours)} of ${formatHours(fill.totalHours)} h scheduled` : ""}`}
            range={windowSpan}
            lanes={windowTask.subtasks.map((child) => ({
              key: child.id,
              title: child.title,
              item: child,
              span: getItemSpan(child),
              done: getTaskCompletion(child) === "done",
              isWindow: false,
              workTitles: descendantTitles(child.subtasks),
            }))}
            timeZone={timeZone}
            tone="window"
            color={getWorkstreamColor(task, windowTask)}
          />
        );
      })}
    </div>
  );
}
