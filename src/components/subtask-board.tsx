"use client";

import { useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type SyntheticEvent } from "react";
import {
  DndContext,
  DragOverlay,
  MeasuringStrategy,
  MouseSensor,
  TouchSensor,
  closestCenter,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
} from "@dnd-kit/core";
import { SortableContext, rectSortingStrategy, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Clock3, Layers, Plus, Trash2 } from "lucide-react";

import type { Task } from "@/lib/taskboard-data";
import { getTaskCompletion } from "@/lib/task-completion";
import {
  countDone,
  findBoardItem,
  getAncestors,
  getBoardStatus,
  getCardDropMove,
  getColumnColor,
  getMoveTargets,
  getMoveToMove,
  getOutsideWindow,
  getPreview,
  getSiblingMove,
  getStepMove,
  getWorkstreamColor,
  WORKSTREAM_PALETTE,
  type BoardPreview,
} from "@/lib/subtask-board";
import { findSubtaskLocation, isNoOpMove, type SubtaskMove } from "@/lib/subtask-move";
import { formatItemSpan, getItemSpan, type TimeSpan } from "@/lib/work-windows";
import { WorkItemTimeEditor, type WorkItemPatch } from "@/components/work-item-time-editor";
import { resolveShortcut } from "@/lib/taskboard-shortcuts";
import {
  ADD_TASK_BUTTON_CLASS,
  BUCKET_TITLE_CLASS,
  COMPACT_INLINE_INPUT_CLASS,
  TASK_CARD_TITLE_CLASS,
  TASK_EDITOR_BUTTON_CLASS,
  TASK_EDITOR_INLINE_BUTTON_CLASS,
  TASK_EDITOR_INLINE_INPUT_CLASS,
  TASK_EDITOR_LABEL_CLASS,
  TASK_EDITOR_MUTED_TEXT_CLASS,
  TASK_EDITOR_SELECT_CLASS,
  TASK_EDITOR_TITLE_INPUT_CLASS,
} from "@/components/taskboard-constants";
import { SurfaceCloseButton } from "@/components/taskboard-shared";
// Cards shown in a column, and checklist items on a card, before "Show all".
const CARD_PREVIEW = 6;
const STEP_PREVIEW = 8;

type BoardHandlers = {
  canEdit: boolean;
  timeZone: string;
  onSaveTask: (taskId: string, patch: WorkItemPatch) => unknown;
  onDeleteTask?: (taskId: string) => unknown;
  onAddSubtask: (taskId: string, title: string) => unknown;
  onMoveSubtask?: (move: SubtaskMove, options?: { announce?: boolean }) => unknown;
};

// What every column, card, and checklist item reads: the tree, the
// selection, which items are open, and the one move that may be in flight.
type BoardState = BoardHandlers & {
  root: Task;
  selectedId: string | null;
  select: (taskId: string) => void;
  isOpen: (taskId: string) => boolean;
  toggleOpen: (taskId: string) => void;
  isShowingAll: (taskId: string) => boolean;
  showAll: (taskId: string) => void;
  canMove: boolean;
  moving: boolean;
  move: (move: SubtaskMove | null) => void;
  dropTarget: DropTarget | null;
};

// Fields and buttons inside a draggable surface stop presses so typing,
// selecting text, and clicking never start a drag.
const keepPressInside = {
  onMouseDown: (event: SyntheticEvent) => event.stopPropagation(),
  onTouchStart: (event: SyntheticEvent) => event.stopPropagation(),
  onKeyDown: (event: ReactKeyboardEvent) => {
    // Nested lists also use this drag boundary. Let the global palette reach
    // the focused work item, including steps several levels inside a card.
    if (resolveShortcut(event, { singleKeys: false }) !== "palette") event.stopPropagation();
  },
};

// A column, card, or step lands among its own siblings: the one under the
// pointer, else the nearest one while the pointer is over the area they
// fill. Going by the pointer first keeps a tall column droppable on a short
// one. Let go anywhere else and nothing moves.
const DROP_MARGIN = 16;
const siblingCollision: CollisionDetection = (args) => {
  const parentId = args.active.data.current?.parentId;
  const siblings = args.droppableContainers.filter((container) => container.data.current?.parentId === parentId);
  const rects = siblings.map((container) => args.droppableRects.get(container.id)).filter((rect) => rect !== undefined);
  const pointer = args.pointerCoordinates;
  if (!pointer || rects.length === 0) return [];
  const underPointer = pointerWithin({ ...args, droppableContainers: siblings });
  if (underPointer.length > 0) return underPointer;
  const inside =
    pointer.x >= Math.min(...rects.map((rect) => rect.left)) - DROP_MARGIN &&
    pointer.x <= Math.max(...rects.map((rect) => rect.right)) + DROP_MARGIN &&
    pointer.y >= Math.min(...rects.map((rect) => rect.top)) - DROP_MARGIN &&
    pointer.y <= Math.max(...rects.map((rect) => rect.bottom)) + DROP_MARGIN;
  return inside ? closestCenter({ ...args, droppableContainers: siblings }) : [];
};

// A card can also go to another column, as a task moves between buckets on
// the main board: onto a card there, or onto the column itself. Within its
// own column it reorders as before.
const COLUMN_DROP_PREFIX = "column-drop:";
const boardCollision: CollisionDetection = (args) => {
  if (args.active.data.current?.kind !== "card") return siblingCollision(args);
  const ownColumn = args.active.data.current?.parentId;
  const cards = args.droppableContainers.filter((container) => container.data.current?.kind === "card");
  const overCard = pointerWithin({ ...args, droppableContainers: cards });
  if (overCard.length > 0) return overCard;
  const columns = args.droppableContainers.filter((container) => container.data.current?.kind === "column-drop");
  const overColumn = pointerWithin({ ...args, droppableContainers: columns });
  if (overColumn.length === 0) return [];
  return String(overColumn[0].id) === `${COLUMN_DROP_PREFIX}${ownColumn}` ? siblingCollision(args) : overColumn;
};

// Where a dragged card would land in another column, for the highlight.
type DropTarget = { columnId: string; beforeId: string | null };

function isPlainEnter(event: ReactKeyboardEvent<HTMLElement>) {
  return event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.nativeEvent.isComposing;
}

// The closest window above an item, used to seed and check its time.
function nearestSpan(root: Task, taskId: string): TimeSpan | null {
  const above = getAncestors(root, taskId) ?? [];
  for (let index = above.length - 1; index >= 0; index -= 1) {
    const span = getItemSpan(above[index]);
    if (span) return span;
  }
  return getItemSpan(root);
}

// The work tab's board, drawn like the main board: top-level subtasks are
// bucket columns, their work is task cards in them, and the cards' work is a
// checklist on each card, which opens in place to show deeper work. Clicking
// any of them shows it in a side panel; the board itself never changes level. The list and timeline show the same subtasks and every
// change goes through the same handlers.
export function SubtaskBoard({ task, initialSelectedId = null, ...handlers }: BoardHandlers & { task: Task; initialSelectedId?: string | null }) {
  const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId);
  // An item opened by link starts in view, with everything above it open.
  const [open, setOpen] = useState<ReadonlySet<string>>(() =>
    new Set(initialSelectedId ? getAncestors(task, initialSelectedId)?.map((item) => item.id) : []));
  const [showingAll, setShowingAll] = useState<ReadonlySet<string>>(() => new Set());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const [moving, setMoving] = useState(false);
  const moveInFlight = useRef(false);
  const canMove = Boolean(handlers.canEdit && handlers.onMoveSubtask);
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 6 } }),
  );
  // The panel follows the item by id, so it shows the latest saved copy and
  // closes on its own when the item is deleted.
  const selected = selectedId && selectedId !== task.id ? findBoardItem(task, selectedId) : null;
  const activeItem = activeId ? findBoardItem(task, activeId) : null;

  const state: BoardState = {
    ...handlers,
    root: task,
    selectedId: selected?.id ?? null,
    select: setSelectedId,
    isOpen: (taskId) => open.has(taskId),
    toggleOpen: (taskId) => setOpen((current) => {
      const next = new Set(current);
      if (!next.delete(taskId)) next.add(taskId);
      return next;
    }),
    isShowingAll: (taskId) => showingAll.has(taskId),
    showAll: (taskId) => setShowingAll((current) => new Set(current).add(taskId)),
    canMove,
    moving,
    move: (next) => {
      if (!next || !handlers.onMoveSubtask || moveInFlight.current || isNoOpMove(task, next)) return;
      moveInFlight.current = true;
      setMoving(true);
      void Promise.resolve(handlers.onMoveSubtask(next, { announce: true })).finally(() => {
        moveInFlight.current = false;
        setMoving(false);
      });
    },
    dropTarget,
  };
  // A card over another column, or over a card in one, lands there.
  const crossColumnTarget = (activeKey: string, overKey: string | null): DropTarget | null => {
    if (!overKey) return null;
    const from = findSubtaskLocation(task, activeKey);
    if (!from || from.parent.id === task.id) return null;
    if (overKey.startsWith(COLUMN_DROP_PREFIX)) {
      const columnId = overKey.slice(COLUMN_DROP_PREFIX.length);
      return columnId === from.parent.id ? null : { columnId, beforeId: null };
    }
    const to = findSubtaskLocation(task, overKey);
    if (!to || to.parent.id === from.parent.id || to.parent.id === task.id) return null;
    return { columnId: to.parent.id, beforeId: overKey };
  };
  const endDrag = () => {
    setActiveId(null);
    setDropTarget(null);
  };

  return (
    <div className="subtask-board" data-testid="task-subtask-board" data-selection-scope="subtasks">
      <div className="subtask-board-layout" data-panel-open={selected ? "true" : undefined}>
        <DndContext
          sensors={sensors}
          collisionDetection={boardCollision}
          // Saved changes can redraw the board mid-drag; measuring targets
          // again every 100 ms keeps a drop where the pointer is.
          measuring={{ droppable: { strategy: MeasuringStrategy.WhileDragging, frequency: 100 } }}
          onDragStart={(event) => setActiveId(String(event.active.id))}
          onDragOver={(event) => setDropTarget(crossColumnTarget(String(event.active.id), event.over ? String(event.over.id) : null))}
          onDragCancel={endDrag}
          onDragEnd={(event) => {
            const activeKey = String(event.active.id);
            const overKey = event.over ? String(event.over.id) : null;
            const target = crossColumnTarget(activeKey, overKey);
            endDrag();
            if (target) state.move(getCardDropMove(task, activeKey, target.columnId, target.beforeId));
            else if (overKey && !overKey.startsWith(COLUMN_DROP_PREFIX)) state.move(getSiblingMove(task, activeKey, overKey));
          }}
        >
          <div className="subtask-board-main">
            <SortableContext items={task.subtasks.map((box) => box.id)} strategy={rectSortingStrategy}>
              <div className="subtask-board-grid" data-testid="subtask-board-grid">
                {task.subtasks.map((box, index) => (
                  <BoardBox key={box.id} item={box} index={index} state={state} />
                ))}
                {handlers.canEdit ? <AddBox onAdd={(title) => handlers.onAddSubtask(task.id, title)} /> : null}
              </div>
            </SortableContext>
          </div>
          <DragOverlay dropAnimation={null}>
            {activeItem ? <div className="subtask-board-drag-overlay taskboard-card rounded-[12px] border border-border/70">{activeItem.title}</div> : null}
          </DragOverlay>
        </DndContext>
        {selected ? <SubtaskInspector key={selected.id} item={selected} state={state} onClose={() => setSelectedId(null)} /> : null}
      </div>
    </div>
  );
}

function CompletionBox({ item, state }: { item: Task; state: BoardState }) {
  const completion = getTaskCompletion(item);
  const isDone = completion === "done";
  return (
    <label className="subtask-check" {...keepPressInside}>
      <input
        type="checkbox"
        ref={(node) => { if (node) node.indeterminate = completion === "mixed"; }}
        checked={isDone}
        aria-checked={completion === "mixed" ? "mixed" : isDone}
        onChange={() => void state.onSaveTask(item.id, { status: isDone ? "todo" : "done" })}
        disabled={!state.canEdit}
        aria-label={isDone ? `Mark ${item.title} not done` : `Mark ${item.title} done`}
        className="work-check"
      />
    </label>
  );
}

// The main board card's date stamp, used for an item's time.
function When({ item, state, compact = false }: { item: Task; state: BoardState; compact?: boolean }) {
  if (!getItemSpan(item)) return null;
  const timedAbove = Boolean(nearestSpan(state.root, item.id));
  return (
    <span className="taskboard-card-date subtask-when inline-flex min-w-0 items-center gap-1" title={formatItemSpan(item, { timeZone: state.timeZone })}>
      <Clock3 className="taskboard-card-date-icon shrink-0" aria-hidden="true" />
      <span className="truncate">{formatItemSpan(item, { timeZone: state.timeZone, includeDay: !compact || !timedAbove || item.allDay })}</span>
    </span>
  );
}

// The work list's warning for an item whose time falls outside its nearest
// timed parent. Moves keep times as they are, so this is how a move into a
// different window shows.
function OutsideWindow({ item, state }: { item: Task; state: BoardState }) {
  const timeWindow = getOutsideWindow(state.root, item.id);
  if (!timeWindow) return null;
  return <span className="work-warn subtask-outside" title={`Outside the time window of ${timeWindow.title}`}>Outside the window</span>;
}

function Progress({ item }: { item: Task }) {
  const total = item.subtasks.length;
  if (total === 0) return null;
  const done = countDone(item);
  return (
    <span className="taskboard-card-date subtask-progress ml-auto inline-flex shrink-0 items-center gap-1.5" aria-label={`${done} of ${total} done`}>
      <span className="subtask-progress-bar" aria-hidden="true"><i style={{ width: `${(done / total) * 100}%` }} /></span>
      <span aria-hidden="true">{done}/{total}</span>
    </span>
  );
}

function ShowAll({ parent, preview, state }: { parent: Task; preview: BoardPreview; state: BoardState }) {
  if (preview.shown.length === parent.subtasks.length) return null;
  return (
    <button type="button" className="subtask-show-all" onClick={() => state.showAll(parent.id)} {...keepPressInside}>
      Show all {parent.subtasks.length}{preview.hiddenDone > 0 ? ` (${preview.hiddenDone} done)` : ""}
    </button>
  );
}

// A top-level subtask: drawn as a bucket on the main board, in its own
// color, with its header, icon, and count, and its work inside as cards. One
// with no work is just its header; adding work grows the same column.
function BoardBox({ item, index, state }: { item: Task; index: number; state: BoardState }) {
  const { listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !state.canMove || state.moving,
    data: { parentId: state.root.id, kind: "column" },
  });
  const { setNodeRef: setDropNodeRef } = useDroppable({
    id: `${COLUMN_DROP_PREFIX}${item.id}`,
    disabled: !state.canMove || state.moving,
    data: { kind: "column-drop" },
  });
  const [adding, setAdding] = useState(false);
  const preview = getPreview(item.subtasks, CARD_PREVIEW, state.selectedId, state.isShowingAll(item.id));
  const isSelected = state.selectedId === item.id;
  const color = getColumnColor(index, WORKSTREAM_PALETTE);
  const total = item.subtasks.length;

  return (
    <section
      ref={(node) => {
        setNodeRef(node);
        setDropNodeRef(node);
      }}
      className="subtask-box taskboard-bucket-column panel-surface panel-strong flex w-full min-w-0 flex-col overflow-hidden rounded-[18px]"
      data-testid="subtask-board-box"
      data-task-menu-target={item.id}
      tabIndex={-1}
      data-subtask-id={item.id}
      data-task-status={getBoardStatus(item)}
      data-done={getTaskCompletion(item) === "done" ? "true" : undefined}
      data-selected={isSelected ? "true" : undefined}
      data-dragging={isDragging ? "true" : undefined}
      data-drop-target={state.dropTarget?.columnId === item.id ? "true" : undefined}
      aria-label={item.title}
      style={{
        transform: CSS.Translate.toString(transform),
        transition,
        "--bucket-color": color,
        borderColor: `color-mix(in srgb, ${color} 40%, var(--border))`,
      } as CSSProperties}
    >
      {/* The header is the column's drag surface; its title still opens the panel on a click. */}
      <div
        ref={setActivatorNodeRef}
        className="subtask-box-header taskboard-bucket-header border-b px-3 py-2.5"
        style={{
          background: `linear-gradient(180deg, color-mix(in srgb, ${color} 24%, var(--panel-strong)) 0%, color-mix(in srgb, ${color} 16%, var(--panel)) 100%)`,
          borderBottomColor: `color-mix(in srgb, ${color} 22%, var(--border))`,
        }}
        {...listeners}
      >
        <div className="taskboard-bucket-header-row flex items-start gap-2">
          <span
            className="taskboard-bucket-icon taskboard-icon-surface flex h-7 w-7 shrink-0 items-center justify-center rounded-[14px] border"
            style={{
              color: `var(--taskboard-bucket-icon-color, ${color})`,
              background: `var(--taskboard-bucket-icon-background, color-mix(in srgb, ${color} 18%, var(--surface-hover)))`,
              borderColor: `var(--taskboard-bucket-icon-border, color-mix(in srgb, ${color} 24%, var(--border)))`,
            }}
          >
            {/* Every workstream has the same icon; its color tells them apart. */}
            <Layers className="h-4 w-4" aria-hidden="true" />
          </span>
          <div className="taskboard-bucket-heading min-w-0 flex-1">
            <button type="button" className="subtask-box-title block max-w-full text-left" onClick={() => state.select(item.id)} aria-pressed={isSelected} title={item.title}>
              <span className={BUCKET_TITLE_CLASS}>{item.title}</span>
            </button>
            <span className="taskboard-bucket-task-count mt-0.5 block text-[10px] font-medium leading-4 text-muted">
              {total > 0 ? `${countDone(item)} of ${total} done` : getTaskCompletion(item) === "done" ? "Done" : "Not done"}
            </span>
            {/* The time takes its own line, so a long window never cuts off. */}
            <When item={item} state={state} />
          </div>
          {state.canEdit && total === 0 && !adding ? (
            <button type="button" className="subtask-box-add" onClick={() => setAdding(true)} aria-label={`Add a card to ${item.title}`} title="Add a card" data-testid="subtask-board-add-inside" {...keepPressInside}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : null}
          <CompletionBox item={item} state={state} />
        </div>
      </div>
      {/* A column with no cards is just its header, like a short bucket; the
          add field opens below it. */}
      {total > 0 || adding ? (
        <div className="subtask-box-body taskboard-bucket-body flex flex-col gap-2 p-2">
          {state.canEdit ? (
            adding ? (
              <AddField
                label={`Add a card to ${item.title}`}
                placeholder="Card title. Enter adds another."
                onAdd={(title) => state.onAddSubtask(item.id, title)}
                onDone={() => setAdding(false)}
              />
            ) : (
              <button type="button" className={`${ADD_TASK_BUTTON_CLASS} w-full`} onClick={() => setAdding(true)} aria-label={`Add a card to ${item.title}`} data-testid="subtask-board-add-inside">
                + Add card
              </button>
            )
          ) : null}
          {total > 0 ? (
            <SortableContext items={preview.shown.map((child) => child.id)} strategy={verticalListSortingStrategy}>
              {preview.shown.map((child) => (
                <BoardCard key={child.id} item={child} parent={item} state={state} />
              ))}
              <ShowAll parent={item} preview={preview} state={state} />
            </SortableContext>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

// A subtask inside a column, drawn as the main board's task card: status on
// its left edge, title, a date stamp and progress line, and its own work as
// a checklist. Clicking anywhere on it opens it in the side panel.
function BoardCard({ item, parent, state }: { item: Task; parent: Task; state: BoardState }) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !state.canMove || state.moving,
    data: { parentId: parent.id, kind: "card" },
  });
  const isSelected = state.selectedId === item.id;
  const preview = getPreview(item.subtasks, STEP_PREVIEW, state.selectedId, state.isShowingAll(item.id));

  return (
    <article
      ref={setNodeRef}
      className={`subtask-card taskboard-card drag-card rounded-[12px] border border-border/70${isSelected ? " taskboard-card-selected" : ""}`}
      data-testid="subtask-board-card"
      data-task-menu-target={item.id}
      data-subtask-id={item.id}
      data-task-status={getBoardStatus(item)}
      data-done={getTaskCompletion(item) === "done" ? "true" : undefined}
      data-dragging={isDragging ? "true" : undefined}
      data-drop-before={state.dropTarget?.beforeId === item.id ? "true" : undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      // A click on the card's background selects it and takes focus, so focus
      // stays inside the board, where task shortcuts are off.
      tabIndex={-1}
      onClick={(event) => {
        if ((event.target as Element).closest("button, input, label, .subtask-checklist")) return;
        event.currentTarget.focus({ preventScroll: true });
        state.select(item.id);
      }}
      // The whole card is a drag surface, as on the main board.
      {...listeners}
    >
      <div className="taskboard-task-card-surface flex w-full min-w-0 flex-col items-stretch p-2 text-left">
        <div className="taskboard-card-heading-row flex min-w-0 items-start">
          <button type="button" className={`subtask-card-title ${TASK_CARD_TITLE_CLASS} min-w-0 flex-1 text-left`} onClick={() => state.select(item.id)} aria-pressed={isSelected} title={item.title}>
            {item.title}
          </button>
          <CompletionBox item={item} state={state} />
        </div>
        {getItemSpan(item) || item.subtasks.length > 0 ? (
          <div className="subtask-card-meta flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <When item={item} state={state} compact />
            <OutsideWindow item={item} state={state} />
            <Progress item={item} />
          </div>
        ) : null}
        {item.subtasks.length > 0 ? <StepList parent={item} preview={preview} state={state} /> : null}
      </div>
    </article>
  );
}

// A card's own work, as a checklist on the card. An item with work of its
// own is a group row, bold on a band of its column's color, as the work list
// sets windows apart; its count opens that work in place, indented under it.
function StepList({ parent, preview, state }: { parent: Task; preview: BoardPreview; state: BoardState }) {
  return (
    <SortableContext items={preview.shown.map((child) => child.id)} strategy={verticalListSortingStrategy}>
      <ul className="subtask-checklist" {...keepPressInside}>
        {preview.shown.map((child) => (
          <BoardStep key={child.id} item={child} parent={parent} state={state} />
        ))}
      </ul>
      <ShowAll parent={parent} preview={preview} state={state} />
    </SortableContext>
  );
}

function BoardStep({ item, parent, state }: { item: Task; parent: Task; state: BoardState }) {
  const { listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !state.canMove || state.moving,
    data: { parentId: parent.id, kind: "step" },
  });
  const hasChildren = item.subtasks.length > 0;
  const isOpen = hasChildren && state.isOpen(item.id);
  const isSelected = state.selectedId === item.id;
  const status = getBoardStatus(item);
  const done = countDone(item);

  return (
    <li
      ref={setNodeRef}
      className="subtask-step"
      data-testid="subtask-board-step"
      data-task-menu-target={item.id}
      tabIndex={-1}
      data-subtask-id={item.id}
      data-group={hasChildren ? "true" : undefined}
      data-task-status={status}
      data-done={getTaskCompletion(item) === "done" ? "true" : undefined}
      data-selected={isSelected ? "true" : undefined}
      data-dragging={isDragging ? "true" : undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <div className="subtask-step-main" {...listeners}>
        <div className="min-w-0 flex-1">
          <button type="button" className="subtask-step-title" onClick={() => state.select(item.id)} aria-pressed={isSelected} title={item.title}>
            {item.title}
          </button>
          <When item={item} state={state} compact />
          <OutsideWindow item={item} state={state} />
        </div>
        {hasChildren ? (
          <button
            type="button"
            className="subtask-step-count"
            {...keepPressInside}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? "Close" : "Open"} the ${item.subtasks.length} inside ${item.title}, ${done} done`}
            onClick={() => state.toggleOpen(item.id)}
          >
            {done}/{item.subtasks.length}
            <ChevronDown className="h-3 w-3" aria-hidden="true" />
          </button>
        ) : null}
        <CompletionBox item={item} state={state} />
      </div>
      {isOpen ? (
        <StepList parent={item} preview={getPreview(item.subtasks, STEP_PREVIEW, state.selectedId, state.isShowingAll(item.id))} state={state} />
      ) : null}
    </li>
  );
}

function AddField({ label, placeholder, onAdd, onDone, inPanel = false }: { label: string; placeholder: string; onAdd: (title: string) => unknown; onDone?: () => void; inPanel?: boolean }) {
  const [title, setTitle] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const submit = async () => {
    const next = title.trim();
    if (!next) return;
    setTitle("");
    await onAdd(next);
    // Keep the field ready for the next item.
    inputRef.current?.focus();
  };
  return (
    <div className={inPanel ? "flex min-w-0" : "taskboard-add-shell flex rounded-[12px] border border-dashed border-border/60 p-1.5"} {...keepPressInside}>
      <input
        ref={inputRef}
        autoFocus={Boolean(onDone)}
        aria-label={label}
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        onKeyDown={(event) => {
          if (isPlainEnter(event)) {
            event.preventDefault();
            void submit();
          } else if (event.key === "Escape" && onDone) {
            event.preventDefault();
            event.stopPropagation();
            setTitle("");
            onDone();
          }
        }}
        onBlur={() => {
          if (!title.trim()) onDone?.();
        }}
        placeholder={placeholder}
        className={`${inPanel ? TASK_EDITOR_INLINE_INPUT_CLASS : COMPACT_INLINE_INPUT_CLASS} w-full`}
        data-testid="subtask-board-add-input"
      />
    </div>
  );
}

// The last column: adds a top-level subtask, the way a new bucket would sit
// at the end of the main board.
function AddBox({ onAdd }: { onAdd: (title: string) => unknown }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="subtask-add-box" data-testid="subtask-board-add-card">
      {adding ? (
        <AddField label="Add subtask" placeholder="Subtask title. Enter adds another." onAdd={onAdd} onDone={() => setAdding(false)} />
      ) : (
        <button type="button" className={`${ADD_TASK_BUTTON_CLASS} w-full`} onClick={() => setAdding(true)}>
          + Add subtask
        </button>
      )}
    </div>
  );
}

// The selected column, card, or step, shown beside the board. It offers what
// the work list does for a subtask and no more (see subtask-rule.ts): done,
// the title, its time, the work inside, where it sits, and delete. Where it
// sits is a path of buttons that select those items; the board stays put.
function SubtaskInspector({ item, state, onClose }: { item: Task; state: BoardState; onClose: () => void }) {
  const { root, canEdit, timeZone } = state;
  const above = getAncestors(root, item.id) ?? [];
  const location = findSubtaskLocation(root, item.id);
  const span = getItemSpan(item);
  const isDone = getTaskCompletion(item) === "done";
  const column = above[0] ?? item;
  const columnColor = getWorkstreamColor(root, column);
  // A title being typed survives other updates; an untouched field shows
  // the saved title, so Undo and other editors show through.
  const [draftTitle, setDraftTitle] = useState<string | null>(null);
  const [isTimeOpen, setIsTimeOpen] = useState(false);
  const [moveTarget, setMoveTarget] = useState("");
  const targets = getMoveTargets(root, item.id).filter((target) => target.id !== location?.parent.id);
  const saveTitle = () => {
    const next = draftTitle?.trim();
    setDraftTitle(null);
    if (next && next !== item.title) void state.onSaveTask(item.id, { title: next });
  };

  return (
    <aside
      className="subtask-inspector taskboard-inspector-shell panel-surface flex min-h-0 min-w-0 flex-col overflow-hidden rounded-[18px]"
      data-testid="subtask-inspector"
      data-task-menu-target={item.id}
      tabIndex={-1}
      aria-label={`Details for ${item.title}`}
      style={{ "--bucket-color": columnColor } as CSSProperties}
    >
      <div className="taskboard-inspector-header space-y-1 px-3 pb-2 pt-2.5">
        <div className="flex min-w-0 items-center justify-between gap-1.5">
          <div className="subtask-inspector-done flex min-w-0 flex-1 items-center gap-1.5" data-testid="subtask-inspector-done">
            <CompletionBox item={item} state={state} />
            <span className={TASK_EDITOR_MUTED_TEXT_CLASS}>
              {item.subtasks.length > 0 ? "Done when all the work inside is done" : isDone ? "Done" : "Not done"}
            </span>
          </div>
          <SurfaceCloseButton onClick={onClose} label="Close details" />
        </div>
        <nav className={`subtask-inspector-path flex min-w-0 flex-wrap items-center gap-x-1 gap-y-0.5 ${TASK_EDITOR_MUTED_TEXT_CLASS}`} aria-label="Where this sits">
          <span>{above.length === 0 ? "Column on the board" : "In"}</span>
          {above.map((step, index) => (
            <span key={step.id} className="inline-flex min-w-0 items-center gap-1">
              {index > 0 ? <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" /> : null}
              <button type="button" onClick={() => state.select(step.id)} title={step.title}>{step.title}</button>
            </span>
          ))}
        </nav>
        {canEdit ? (
          <textarea
            rows={2}
            value={draftTitle ?? item.title}
            onChange={(event) => setDraftTitle(event.target.value)}
            onBlur={saveTitle}
            onKeyDown={(event) => {
              if (isPlainEnter(event)) {
                event.preventDefault();
                event.currentTarget.blur();
              } else if (event.key === "Escape") {
                event.preventDefault();
                event.stopPropagation();
                setDraftTitle(null);
              }
            }}
            className={`subtask-inspector-title ${TASK_EDITOR_TITLE_INPUT_CLASS}`}
            aria-label="Title"
            data-testid="subtask-inspector-title"
          />
        ) : (
          <h3 className="min-w-0 break-words ed-title text-foreground">{item.title}</h3>
        )}
      </div>

      <div className="taskboard-inspector-body pretty-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-2">
        <div className="taskboard-inspector-section space-y-1" aria-label="Time">
          <span className={TASK_EDITOR_LABEL_CLASS}>Time</span>
          <div className="taskboard-inspector-disclosure flex min-w-0 items-center justify-between gap-2 rounded-[8px] border border-border/45 px-2 py-1.5">
            <span className={`min-w-0 ed-meta ${span ? "text-foreground" : "text-muted"}`}>
              {span ? formatItemSpan(item, { timeZone }) : "No time set"}
            </span>
            {canEdit && !isTimeOpen ? (
              <button type="button" className={`${TASK_EDITOR_INLINE_BUTTON_CLASS} shrink-0`} onClick={() => setIsTimeOpen(true)}>
                {span ? "Change" : "Set time"}
              </button>
            ) : null}
          </div>
          {isTimeOpen ? (
            <WorkItemTimeEditor
              item={item}
              parentSpan={nearestSpan(root, item.id)}
              depth={0}
              onCancel={() => setIsTimeOpen(false)}
              onSave={async (patch) => {
                setIsTimeOpen(false);
                await state.onSaveTask(item.id, patch);
              }}
            />
          ) : null}
        </div>

        <div className="taskboard-inspector-section" aria-label="Work inside">
          <div className="taskboard-inspector-row w-full min-w-0 py-1">
            <p className="ed-strong text-foreground">Work inside</p>
            <p className={`truncate ${TASK_EDITOR_MUTED_TEXT_CLASS}`}>
              {item.subtasks.length > 0 ? `${countDone(item)} of ${item.subtasks.length} done` : "None yet"}
            </p>
          </div>
          {item.subtasks.length > 0 ? (
            <ul className="subtask-inspector-children mb-1.5 space-y-0.5">
              {item.subtasks.map((child) => (
                <li key={child.id} data-task-menu-target={child.id} tabIndex={-1} className="flex min-w-0 items-center gap-1.5" data-group={child.subtasks.length > 0 ? "true" : undefined} data-task-status={getBoardStatus(child)} data-done={getTaskCompletion(child) === "done" ? "true" : undefined}>
                  <CompletionBox item={child} state={state} />
                  <button type="button" className="min-w-0 flex-1 truncate text-left ed-meta text-foreground" onClick={() => state.select(child.id)} title={child.title}>
                    {child.title}
                  </button>
                  {child.subtasks.length > 0 ? <span className="shrink-0 ed-meta text-muted tabular-nums">{countDone(child)}/{child.subtasks.length}</span> : null}
                </li>
              ))}
            </ul>
          ) : null}
          {canEdit ? (
            <AddField inPanel label={`Add work inside ${item.title}`} placeholder="Add work inside. Enter adds another." onAdd={(title) => state.onAddSubtask(item.id, title)} />
          ) : null}
        </div>

        {state.canMove ? (
          <div className="taskboard-inspector-section space-y-1" aria-label="Move">
            <span className={TASK_EDITOR_LABEL_CLASS}>Position</span>
            <div className="grid grid-cols-2 gap-1">
              <button type="button" className={`${TASK_EDITOR_BUTTON_CLASS} ui-button-surface justify-center border py-1`} disabled={state.moving || !getStepMove(root, item.id, -1)} onClick={() => state.move(getStepMove(root, item.id, -1))}>
                <ArrowUp className="h-3 w-3" aria-hidden="true" />
                Move up
              </button>
              <button type="button" className={`${TASK_EDITOR_BUTTON_CLASS} ui-button-surface justify-center border py-1`} disabled={state.moving || !getStepMove(root, item.id, 1)} onClick={() => state.move(getStepMove(root, item.id, 1))}>
                <ArrowDown className="h-3 w-3" aria-hidden="true" />
                Move down
              </button>
            </div>
            <label className="block min-w-0 pt-1" htmlFor={`move-to-${item.id}`}>
              <span className={TASK_EDITOR_LABEL_CLASS}>Move to</span>
            </label>
            <div className="flex min-w-0 gap-1">
              <select id={`move-to-${item.id}`} className={TASK_EDITOR_SELECT_CLASS} value={moveTarget} onChange={(event) => setMoveTarget(event.target.value)} data-testid="subtask-inspector-move-to">
                <option value="">Choose where…</option>
                {targets.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.isRoot ? "Its own column on the board" : target.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className={`${TASK_EDITOR_INLINE_BUTTON_CLASS} shrink-0`}
                disabled={state.moving || !moveTarget}
                onClick={() => {
                  state.move(getMoveToMove(root, item.id, moveTarget));
                  setMoveTarget("");
                }}
              >
                Move
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {canEdit && state.onDeleteTask ? (
        <div className="taskboard-inspector-footer grid shrink-0 gap-1 px-3 py-2">
          <button type="button" className={`subtask-inspector-delete ${TASK_EDITOR_BUTTON_CLASS} ui-button-surface w-full justify-center border py-1.5`} onClick={() => void state.onDeleteTask?.(item.id)}>
            <Trash2 className="h-3 w-3" aria-hidden="true" />
            Delete
          </button>
        </div>
      ) : null}
    </aside>
  );
}
