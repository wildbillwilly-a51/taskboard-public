"use client";


import Link from "next/link";
import { TaskPushControls } from "@/components/task-push-controls";
import { disconnectPushOnLogout } from "@/lib/task-push-client";
import { useRouter, useSearchParams } from "next/navigation";
import { WorkspacePrimaryNav, WorkspaceSubviews } from "./workspace-primary-nav";
import {
  DndContext,
  DragOverlay,
  KeyboardCode,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  pointerWithin,
  useDroppable,
  useSensor,
  useSensors,
  type Collision,
  type CollisionDetection,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS, getEventCoordinates } from "@dnd-kit/utilities";
import {
  AlarmClock,
  Archive,
  ArrowLeft,
  ArrowLeftToLine,
  ArrowRight,
  ArrowRightToLine,
  ArrowRightLeft,
  Bell,
  CalendarDays,
  CalendarClock,
  CalendarPlus,
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Download,
  Eye,
  File,
  FileImage,
  FileText,
  KeyRound,
  LogOut,
  Maximize2,
  MoreHorizontal,
  PanelRight,
  Paperclip,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  Share2,
  ShieldCheck,
  StickyNote,
  Sparkles,
  Trash2,
  Upload,
  UserCog,
  Users,
  Wrench,
  X,
} from "lucide-react";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
  useId,
  useCallback,
  useDeferredValue,
  Fragment,
  memo,
  useRef,
  useState,
  type HTMLAttributes,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { useUiSettings } from "@/components/settings-provider";
import { TaskWorkspaceLayout } from "@/components/task-workspace-layout";
import { type NotesWorkspaceProps } from "@/components/notes/notes-workspace";
import { FolioWorkspace } from "@/components/notes/folio-workspace";
import { MobileWorkspaceHeader, MobileWorkspaceNavigation, PhoneWorkspaceMenu } from "@/components/mobile-workspace-chrome";
import { usePhoneViewport } from "@/components/use-phone-viewport";
import { TaskLinkedNotes } from "@/components/notes/task-linked-notes";

import { buildNotesHref, fetchBoardNoteCounts } from "@/lib/notes-client";
import { WorkBreakdown } from "@/components/task-work-breakdown";
import { applyAttendeeChanges } from "@/lib/outage-people";
import { reconcileParentCompletion, updateTaskCompletion } from "@/lib/task-completion";
import { TaskWorkspaceSharing } from "@/components/task-share-control";
import {
  applySubtaskMove,
  getCurrentPlacement,
  isNoOpMove,
  type SubtaskMove,
} from "@/lib/subtask-move";
import { getOutsideWindow } from "@/lib/subtask-board";
import { formatItemSpan } from "@/lib/work-windows";
import {
  findRootTaskBucketId,
  getRootTaskIndex,
  getSameBucketDropPlacement,
  getTaskDropPlacement,
  moveRootTaskOnBoard,
  type TaskDropPlacement,
} from "@/lib/taskboard-drag";
import {
  IconDropdown,
  MetaTile,
  SectionCard,
  StatusBadge,
  SurfaceCloseButton,
  TaskCardStatus,
  TASK_STATUS_LABELS,
  useDismissibleSurface,
} from "@/components/taskboard-shared";
import {
  ADD_TASK_ACTION_CLASS,
  ADD_TASK_BUTTON_CLASS,
  AGENDA_BADGE_CLASS,
  AGENDA_TITLE_CLASS,
  BUCKET_TITLE_CLASS,
  CHIP_BUTTON_ACTIVE_CLASS,
  CHIP_BUTTON_CLASS,
  COMPACT_CONTROL_TEXT_CLASS,
  COMPACT_INLINE_INPUT_CLASS,
  COMPACT_INPUT_CLASS,
  COMPACT_LABEL_CLASS,
  COMPACT_MENU_ITEM_CLASS,
  COMPACT_PRIMARY_BUTTON_CLASS,
  COMPACT_SURFACE_BUTTON_CLASS,
  EMPTY_STATE_TEXT_CLASS,
  ICON_BUTTON_CLASS,
  SMALL_CHIP_BUTTON_CLASS,
  TASK_ATTACHMENT_ACTION_BUTTON_CLASS,
  TASK_CARD_BODY_CLASS,
  TASK_CARD_TITLE_CLASS,
  TASK_EDITOR_BUTTON_CLASS,
  TASK_EDITOR_INLINE_BUTTON_CLASS,
  TASK_EDITOR_INLINE_INPUT_CLASS,
  TASK_EDITOR_INPUT_CLASS,
  TASK_EDITOR_ITEM_TEXT_CLASS,
  TASK_EDITOR_LABEL_CLASS,
  TASK_EDITOR_MENU_ITEM_CLASS,
  TASK_EDITOR_MUTED_TEXT_CLASS,
  TASK_EDITOR_SELECT_CLASS,
  TASK_EDITOR_TITLE_INPUT_CLASS,
  bucketColorOptions,
  bucketIconOptions,
  bucketIcons,
  sourceLabels,
  sidebarStatusButtonOptions,
  taskIconOptions,
  taskIcons,
} from "@/components/taskboard-constants";
import {
  applyViewPreset,
  buildCurrentViewFilters,
} from "@/components/taskboard-view-utils";
import {
  formatDate,
  formatDateOnly,
  getAgendaGroupLabel,
  useDisplayTimeZone,
  useIsClient,
  useNowMinute,
} from "@/components/taskboard-date-format";
import {
  CommandPalette,
  ShortcutSheet,
  type PaletteCommand,
  type PaletteMode,
} from "@/components/taskboard-command-palette";
import { getRescheduleToTodayDueAt, isTaskOverdue } from "@/lib/taskboard-overdue";
import {
  OPEN_OVERLAY_SELECTOR,
  isShortcutBlockedTarget,
  resolveShortcut,
  type ShortcutCommandId,
} from "@/lib/taskboard-shortcuts";
import { buildBoardPickerSections } from "@/components/board-picker-sections";
import { ViewSettingsPanel } from "@/components/taskboard-view-settings";
import { CalendarProofApp, type CalendarWorkspaceProps, type CalendarPhoneActions } from "@/components/calendar-proof";
import { toCalendarBoardOption } from "@/lib/calendar-board-options";
import { SafeLinkifiedText } from "@/components/safe-linkified-text";
import type { CalendarTaskScheduleUpdate } from "@/lib/calendar-resize";
import {
  getRememberedTaskScheduleTimes,
  getStartOfTodayInTimeZone,
  getTaskScheduleForAllDayToggle,
} from "@/lib/task-schedule";
import { buildOptionsHref } from "@/lib/options-return";
import {
  bulkTaskImportSource,
  bulkTaskImportVersion,
  parseBulkTaskImportText,
  type BulkTaskImportNewBucket,
  type BulkTaskImportSubmission,
  type BulkTaskImportTask,
} from "@/lib/bulk-task-import";
import {
  type Board,
  type ArchiveItem,
  type Bucket,
  type BucketIcon,
  type CalendarEntry,
  type MaintenanceLocation,
  type ChecklistItem,
  type RecycleBinItem,
  type Task,
  type TaskIcon,
  type TaskNote,
  type TaskNotification,
  type TaskRecurrenceFrequency,
  type TaskRecurrenceMode,
  type TaskRecurrenceRule,
  type TaskStatus,
  type ViewFilters,
  type ViewLayoutMode,
  type ViewPreset,
} from "@/lib/taskboard-data";
import type { AccessibleBoardSummary, BoardAccessMetadata } from "@/lib/board-access";
import type {
  BoardPrivacySettingsResponse,
  PersonalBoardVisibilitySetting,
} from "@/lib/board-privacy-policy";
import { getCalendarFocusDate, getCalendarFocusDateTime } from "@/lib/calendar-date-utils";
import { suppressTaskEventsLinkedToImportedSources, type TaskboardCalendarSourceEvent } from "@/lib/calendar-source-events";
import { mapBoardTasksToCalendarEvents, type TaskboardCalendarTaskEvent } from "@/lib/calendar-task-events";
import { type CardDetailLevel } from "@/lib/ui-settings";
import {
  countRootTasksInBuckets,
  filterBoardByTaskSearch,
  getTaskSearchTokens,
} from "@/lib/taskboard-search";
import { getSelectionAfterTaskRemoval } from "@/lib/task-selection";
import {
  hasSelectionWithin,
  isBlankAppContextMenu,
  isContextMenuKey,
  keepsNativeContextMenu,
  resolveTaskMenuTarget,
} from "@/lib/context-menu-request";
import { ContextMenu, type ContextMenuAction, type ContextMenuAnchor } from "@/components/ui/context-menu";
import { TaskActionTimeDialog } from "@/components/task-action-time-dialog";
import { assertSubtaskPatch, isSubtaskStatus, SUBTASK_RULE_MESSAGE } from "@/lib/subtask-rule";
import { createTaskSaveQueue, type SaveEntryKind, type SaveResult, type TaskSaveQueue } from "@/lib/task-save-queue";
import {
  getTaskActions,
  getTaskEditBlockReason,
  type TaskAction,
  type TaskActionId,
  type TaskActionSurface,
} from "@/lib/task-actions";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { InlineNameField } from "@/components/ui/inline-name-field";
import {
  canApplyLiveLoad,
  liveWriteGeneration,
  trackBoardWrite,
  useLiveBoardRevision,
  useLiveRefresh,
  type LiveBoardSnapshot,
} from "@/components/use-live-board-revision";

type ViewMode = "board" | "agenda" | "focus";
type DetailPanelMode = "sidebar" | "expanded";

const SHOW_SAVED_VIEWS = false;

function useStableCallback<T extends (...args: never[]) => unknown>(callback: T): T {
  const callbackRef = useRef(callback);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  return useCallback(
    (...args: Parameters<T>) => callbackRef.current(...args),
    [],
  ) as T;
}

// Editor draft that follows newer server values for fields the user has not
// edited, so autosave never sends back a stale snapshot of an untouched field.
// While a save of this field is in flight or queued (savePending), the draft is
// the user's latest choice and does not follow: the server value arriving may
// be the answer to an earlier save that the user has since taken back.
function useServerSyncedDraft<T>(serverValue: T, savePending = false) {
  const [draft, setDraft] = useState<T>(serverValue);
  const [syncedServerValue, setSyncedServerValue] = useState<T>(serverValue);

  if (!Object.is(syncedServerValue, serverValue)) {
    setSyncedServerValue(serverValue);
    if (Object.is(draft, syncedServerValue) && !savePending) {
      setDraft(serverValue);
    }
  }

  return [draft, setDraft] as const;
}

// A task editor queues its saves under a source of its own. Only those are its
// pending choices. Saves a replaced editor started (another mode, or the task
// reopened) and changes from shortcuts and menus are server changes it follows
// once they land, so it never sends an older value back over them.
function useEditorSaveSource() {
  return `editor:${useId()}`;
}

// Fields with this editor's save in flight or waiting (see useServerSyncedDraft).
function useEditorPendingSaveFields(saveQueue: TaskSaves, taskId: string, source: string) {
  const pendingPatch = useSyncExternalStore(
    useCallback((listener: () => void) => saveQueue.subscribe(taskId, listener), [saveQueue, taskId]),
    () => saveQueue.getPendingPatch(taskId, source),
    () => null,
  );
  return useMemo<ReadonlySet<string>>(() => new Set(Object.keys(pendingPatch ?? {})), [pendingPatch]);
}

// Autosave sends only the fields the user changed: the patch built from the
// drafts, minus every field equal to the same patch built from the task's
// current server values. A field someone else changed meanwhile (another user,
// another client) is then left alone instead of being written back.
function pickChangedTaskFields(draftPatch: TaskSavePatch, serverPatch: TaskSavePatch): TaskSavePatch {
  const changed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(draftPatch)) {
    if (JSON.stringify(value) !== JSON.stringify((serverPatch as Record<string, unknown>)[key])) {
      changed[key] = value;
    }
  }
  return changed as TaskSavePatch;
}

// The task's server values in the editors' draft form.
function getServerTaskDraftValues(task: Task): Required<Omit<TaskDraftPatchOverrides, "bucketId">> {
  const reminderOffsetMinutes = task.reminderConfig?.reminderOffsetMinutes;
  return {
    title: task.title,
    summary: getTaskPrimaryNoteDraftValue(task),
    nextAction: task.nextAction ?? "",
    status: task.status,
    startAt: formatDateTimeInput(task.startAt),
    endAt: formatDateTimeInput(task.endAt),
    allDay: Boolean(task.allDay),
    dueAt: formatDateTimeInput(task.dueAt),
    recurrenceEnabled: Boolean(task.recurrence),
    recurrenceFrequency: task.recurrence?.frequency ?? "weekly",
    recurrenceInterval: String(task.recurrence?.interval ?? 1),
    recurrenceMode: task.recurrence?.mode ?? "on_schedule",
    reminderOffsetValue:
      reminderOffsetMinutes === null || reminderOffsetMinutes === undefined ? "none" : String(reminderOffsetMinutes),
    overdueReminderEnabled: Boolean(task.reminderConfig?.overdueReminderEnabled),
    labels: formatLabelInput(task.labels),
    color: task.color,
    icon: task.icon,
  };
}
// Once a save is answered, a field the user has not touched since is shown
// with the server's value again. Usually that is the value just saved; when a
// newer snapshot overtook the answer (applyBoardMutationResponse drops the
// older one), it is that newer value, which the next save must not overwrite.
function getAcknowledgedFieldsToResync(
  acknowledged: TaskSavePatch,
  draftPatch: TaskSavePatch,
  serverPatch: TaskSavePatch,
  savePendingFields: ReadonlySet<string>,
) {
  return Object.keys(acknowledged).filter((key) => {
    const field = key as keyof TaskSavePatch;
    return (
      !savePendingFields.has(key) &&
      JSON.stringify(draftPatch[field]) === JSON.stringify(acknowledged[field]) &&
      JSON.stringify(serverPatch[field]) !== JSON.stringify(draftPatch[field])
    );
  });
}
type SnoozePreset = "later_today" | "tomorrow" | "next_week";
// Icons for task actions in menus; the status choices show a check instead.
const TASK_ACTION_ICONS: Partial<Record<TaskActionId, ReactNode>> = {
  open: <PanelRight className="h-3 w-3" aria-hidden="true" />,
  "open-workspace": <Maximize2 className="h-3 w-3" aria-hidden="true" />,
  due: <FinishFlagIcon className="h-3 w-3" />,
  time: <CalendarClock className="h-3 w-3" aria-hidden="true" />,
  snooze: <AlarmClock className="h-3 w-3" aria-hidden="true" />,
  move: <ArrowRight className="h-3 w-3" aria-hidden="true" />,
  "view-calendar": <CalendarDays className="h-3 w-3" aria-hidden="true" />,
  promote: <CalendarClock className="h-3 w-3" aria-hidden="true" />,
  "follow-up": <Plus className="h-3 w-3" aria-hidden="true" />,
  convert: <ArrowRightLeft className="h-3 w-3" aria-hidden="true" />,
  archive: <Archive className="h-3 w-3" aria-hidden="true" />,
  delete: <Trash2 className="h-3 w-3" aria-hidden="true" />,
};
// The palette's ids, keys and search words for the task actions it lists.
const PALETTE_TASK_ACTIONS: Partial<Record<TaskActionId, { id: string; shortcut?: string[]; keywords?: string }>> = {
  open: { id: "task-open", shortcut: ["Enter"] },
  "open-workspace": { id: "task-workspace", shortcut: ["W"] },
  "status-todo": { id: "task-status-todo", shortcut: ["1"], keywords: "status" },
  "status-active": { id: "task-status-active", shortcut: ["2"], keywords: "status" },
  "status-waiting": { id: "task-status-waiting", shortcut: ["3"], keywords: "status" },
  "status-done": { id: "task-status-done", shortcut: ["4"], keywords: "status" },
  due: { id: "task-due", shortcut: ["D"], keywords: "deadline today tomorrow" },
  snooze: { id: "task-snooze", shortcut: ["S"], keywords: "later defer" },
  move: { id: "task-move", shortcut: ["M"], keywords: "column" },
  time: { id: "task-time", keywords: "schedule start end all day" },
};
type UndoToastState = {
  id: number;
  message: string;
  onUndo: () => Promise<void>;
};
const UNDO_TOAST_DURATION_MS = 8000;
type ImportMode = "ics" | "bulk";
type TaskEditorPatch = {
  title: string;
  summary: string;
  nextAction?: string;
  status: TaskStatus;
  startAt: string | null;
  endAt: string | null;
  allDay?: boolean;
  dueAt: string | null;
  recurrence: TaskRecurrenceRule | null;
  reminderOffsetMinutes?: number | null;
  overdueReminderEnabled?: boolean;
  labels: string[];
  color: string;
  icon: TaskIcon;
  bucketId?: string;
  promoteToMaintenanceOutage?: boolean;
  maintenanceOutage?: MaintenanceOutagePatch;
};
type MaintenanceOutagePatch = {
  locationId?: string | null;
  owner?: string;
  attendees?: string[];
  attendeeChanges?: { name: string; attending: boolean }[];
};
// Fields of a queued save stay queued; a newer value replaces an older one,
// except outage attendee changes, which add up.
function mergeOutageAutosave(previous: TaskSavePatch | null, next: TaskSavePatch): TaskSavePatch {
  const merged = { ...previous, ...next };
  if (!previous?.maintenanceOutage) return merged;
  const before = previous.maintenanceOutage, after = next.maintenanceOutage;
  return { ...merged, maintenanceOutage: { ...before, ...after,
    ...((before.attendeeChanges || after?.attendeeChanges) ? { attendeeChanges: [...(before.attendeeChanges ?? []), ...(after?.attendeeChanges ?? [])] } : {}) } };
}
type TaskSavePatch = Partial<TaskEditorPatch>;
// The task save queue as the editors use it: TaskboardApp supplies the request.
type TaskSaves = {
  enqueue: (
    taskId: string,
    patch: TaskSavePatch,
    options: { kind: SaveEntryKind; source: string },
  ) => Promise<SaveResult<TaskSavePatch>>;
  getPendingPatch: TaskSaveQueue<TaskSavePatch>["getPendingPatch"];
  subscribe: TaskSaveQueue<TaskSavePatch>["subscribe"];
};
const WORKING_NOTES_OPEN_KEY = "taskboard-workspace-notes-open";
// Editors, subtask rows and shortcuts all send only what changed (pickChangedTaskFields).
type TaskSaveHandler = (
  taskId: string,
  patch: TaskSavePatch,
) => void | boolean | Promise<void | boolean>;
type TaskAutosaveState = "idle" | "saving" | "saved" | "error";

type RetainedArchivedTask = {
  task: Task;
  bucketId: string | null;
};
type TaskDraftPatchOverrides = Partial<{
  title: string;
  summary: string;
  nextAction: string;
  status: TaskStatus;
  startAt: string;
  endAt: string;
  allDay: boolean;
  dueAt: string;
  recurrenceEnabled: boolean;
  recurrenceFrequency: TaskRecurrenceFrequency;
  recurrenceInterval: string;
  recurrenceMode: TaskRecurrenceMode;
  reminderOffsetValue: string;
  overdueReminderEnabled: boolean;
  labels: string;
  color: string;
  icon: TaskIcon;
  bucketId: string;
}>;

type LabelChipEditorProps = {
  value: string;
  caseSensitive?: boolean;
  disabled?: boolean;
  itemName?: "label" | "attendee";
  inputPosition?: "inline" | "above";
  onChange: (value: string) => void;
  onCommit: (value: string) => void;
};

type BulkTaskImportDraftTask = BulkTaskImportTask & {
  id: string;
  labelsText: string;
  included: boolean;
};

type BulkTaskImportBucketDecision = {
  mode: "create" | "map";
  createTitle: string;
  targetBucketId: string;
};

type BulkTaskImportMetadata = {
  source: string;
  rangeLabel: string;
};


type PersonalBoardShareRole = "viewer" | "editor";
type PersonalBoardShareMember = {
  userId: string;
  email: string;
  username: string | null;
  displayName: string;
  role: "owner" | PersonalBoardShareRole;
  canRead: boolean;
  canEdit: boolean;
  canManage: boolean;
  source: string | null;
  createdAt: string;
  updatedAt: string;
};
type PersonalBoardShareCandidate = {
  id: string;
  email: string;
  username: string | null;
  displayName: string;
};

type TaskDropPreview = {
  taskId: string;
  targetBucketId: string;
  placement: TaskDropPlacement;
  overTaskId?: string;
};

const MENU_ROW_CLASS =
  "ui-menu-item grid w-full grid-cols-[0.9rem_minmax(0,1fr)_auto] items-center gap-2 rounded-[7px] px-2 py-1.5 text-left text-[11px] font-medium leading-4 text-foreground transition";


const reminderPresetOptions = [
  { value: "none", label: "None", minutes: null },
  { value: "0", label: "At due time", minutes: 0 },
  { value: "15", label: "15 minutes before", minutes: 15 },
  { value: "60", label: "1 hour before", minutes: 60 },
  { value: "1440", label: "1 day before", minutes: 1440 },
  { value: "2880", label: "2 days before", minutes: 2880 },
  { value: "10080", label: "1 week before", minutes: 10080 },
] as const;

const snoozePresetOptions: Array<{ value: SnoozePreset; label: string }> = [
  { value: "later_today", label: "Later Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "next_week", label: "Next Week" },
];

// The pointer is over a bucket but not over another task: on the dragged task's
// own original slot, in the gap between two cards, or in the bucket's empty
// space. Without a task target the drop would append to the bottom, so resolve
// a task instead: the dragged task itself on its own slot (it stays put), else
// the bucket's task whose center is nearest the pointer.
function resolveBucketTaskFallback(
  args: Parameters<CollisionDetection>[0],
  pointerHits: Collision[],
): Collision | null {
  const pointer = args.pointerCoordinates;
  if (!pointer) {
    return null;
  }

  const containerById = (id: Collision["id"]) =>
    args.droppableContainers.find((container) => container.id === id);
  const bucketHit = pointerHits.find(
    (hit) => containerById(hit.id)?.data.current?.type === "bucket",
  );
  if (!bucketHit) {
    return null;
  }

  const bucketId = String(bucketHit.id);
  const activeId = String(args.active.id);
  const activeContainer = containerById(args.active.id);
  const activeRect = args.droppableRects.get(args.active.id);
  if (
    activeContainer &&
    activeRect &&
    activeContainer.data.current?.bucketId === bucketId &&
    pointer.y >= activeRect.top &&
    pointer.y <= activeRect.bottom
  ) {
    return { id: activeContainer.id, data: { droppableContainer: activeContainer, value: 0 } };
  }

  let nearest: { container: (typeof args.droppableContainers)[number]; distance: number } | null =
    null;
  for (const container of args.droppableContainers) {
    if (
      container.data.current?.type !== "task" ||
      container.data.current?.bucketId !== bucketId ||
      String(container.id) === activeId
    ) {
      continue;
    }

    const rect = args.droppableRects.get(container.id);
    if (!rect) {
      continue;
    }

    const distance = Math.abs(rect.top + rect.height / 2 - pointer.y);
    if (!nearest || distance < nearest.distance) {
      nearest = { container, distance };
    }
  }

  return nearest
    ? {
        id: nearest.container.id,
        data: { droppableContainer: nearest.container, value: nearest.distance },
      }
    : null;
}

const collisionDetectionStrategy: CollisionDetection = (args) => {
  const activeType = args.active.data.current?.type as
    | "bucket-column"
    | "task"
    | undefined;
  const typedArgs =
    activeType === "bucket-column"
      ? {
          ...args,
          droppableContainers: args.droppableContainers.filter(
            (container) => container.data.current?.type === "bucket-column",
          ),
        }
      : activeType === "task"
        ? {
            ...args,
            droppableContainers: args.droppableContainers.filter((container) => {
              const type = container.data.current?.type;
              return type === "bucket" || type === "task";
            }),
          }
        : args;

  const keepActiveBucketAsDropTarget = activeType === "bucket-column";
  const pointerHits = pointerWithin(typedArgs).filter(
    (collision) =>
      keepActiveBucketAsDropTarget || String(collision.id) !== String(args.active.id),
  );

  if (pointerHits.length > 0) {
    if (activeType === "task") {
      const taskHits = pointerHits.filter(
        (collision) =>
          typedArgs.droppableContainers.find((container) => container.id === collision.id)?.data
            .current?.type === "task",
      );

      if (taskHits.length > 0) {
        return taskHits;
      }

      const taskFallback = resolveBucketTaskFallback(typedArgs, pointerHits);
      if (taskFallback) {
        return [taskFallback];
      }
    }

    return pointerHits;
  }

  const cornerHits = closestCorners(typedArgs).filter(
    (collision) =>
      keepActiveBucketAsDropTarget || String(collision.id) !== String(args.active.id),
  );

  if (activeType === "task") {
    const taskHits = cornerHits.filter(
      (collision) =>
        typedArgs.droppableContainers.find((container) => container.id === collision.id)?.data
          .current?.type === "task",
    );

    if (taskHits.length > 0) {
      return taskHits;
    }
  }

  return cornerHits;
};

function getDragPointerY(activatorEvent: Event | null, delta: { y: number }) {
  const start = activatorEvent ? getEventCoordinates(activatorEvent) : null;
  return start ? start.y + delta.y : null;
}

function getTaskDropPreviewIndex(tasks: Task[], preview: TaskDropPreview) {
  if (preview.placement === "append" || !preview.overTaskId) {
    return tasks.length;
  }

  const overIndex = tasks.findIndex((task) => task.id === preview.overTaskId);
  if (overIndex < 0) {
    return tasks.length;
  }

  return overIndex + (preview.placement === "after" ? 1 : 0);
}

const BUCKET_COLUMN_SORTABLE_PREFIX = "bucket-column:";

function getBucketColumnSortableId(bucketId: string) {
  return `${BUCKET_COLUMN_SORTABLE_PREFIX}${bucketId}`;
}

function getBucketIdFromBucketColumnSortableId(id: string) {
  return id.startsWith(BUCKET_COLUMN_SORTABLE_PREFIX)
    ? id.slice(BUCKET_COLUMN_SORTABLE_PREFIX.length)
    : null;
}

const isPlainEnterKey = (event: ReactKeyboardEvent<HTMLElement>) =>
  event.key === "Enter" &&
  !event.shiftKey &&
  !event.ctrlKey &&
  !event.altKey &&
  !event.metaKey &&
  !event.nativeEvent.isComposing;

const handlePlainEnterSubmit = (
  event: ReactKeyboardEvent<HTMLElement>,
  submit: () => void,
) => {
  if (!isPlainEnterKey(event)) {
    return false;
  }

  event.preventDefault();
  submit();
  return true;
};

const EMPTY_CALENDAR_ENTRIES: CalendarEntry[] = [];
const EMPTY_CALENDAR_SOURCE_EVENTS: TaskboardCalendarSourceEvent[] = [];
const EMPTY_CALENDAR_TASK_EVENTS: TaskboardCalendarTaskEvent[] = [];

function subscribeTaskView(listener: () => void) {
  window.addEventListener("taskboard:task-view", listener);
  return () => window.removeEventListener("taskboard:task-view", listener);
}
const serverTaskView = (): ViewMode => "board";

export function TaskboardApp({
  calendarWorkspace,
  notesWorkspace,
  publicSharesEnabled = false,
  initialBoard,
  initialBoardAccess,
  initialAccessibleBoards,
  initialCurrentBoardId,
  initialPersonalBoardId,
  initialBoardNotice,
  initialCalendarEntries = [],
  initialCalendarSourceEvents = [],
  includeImportedCalendarEvents = false,
  persistInitialBoardSelection,
  initialSelectedTaskId,
  initialTaskHandoffSource,
  initialViewMode = "board",
  currentUser,
  externalAuthOnly,
  externalAccountActions,
  persistenceEnabled,
}: {
  calendarWorkspace?: CalendarWorkspaceProps;
  notesWorkspace?: NotesWorkspaceProps & {sessionKey?:string;initialSpaceId?:string|null;offlineNotesAvailable?:boolean};
  publicSharesEnabled?: boolean;
  initialBoard: Board;
  initialBoardAccess: BoardAccessMetadata;
  initialAccessibleBoards: AccessibleBoardSummary[];
  initialCurrentBoardId: string;
  initialPersonalBoardId: string;
  initialBoardNotice?: string | null;
  initialCalendarEntries?: CalendarEntry[];
  initialCalendarSourceEvents?: TaskboardCalendarSourceEvent[];
  // The page showed the person's imported events (no explicit board
  // was requested); live calendar reloads keep that rule.
  includeImportedCalendarEvents?: boolean;
  persistInitialBoardSelection?: boolean;
  initialSelectedTaskId?: string | null;
  initialTaskHandoffSource?: "calendar" | null;
  initialViewMode?: ViewMode;
  currentUser: {
    id?: string;
    email: string;
    displayName: string;
    username?: string;
    role?: "standard" | "manager" | "admin";
    authProvider?: "local" | "authelia" | "oidc";
    isReservedLocalAdmin?: boolean;
  };
  externalAuthOnly: boolean;
  externalAccountActions: {
    logoutUrl: string | null;
    changePasswordUrl: string | null;
    passwordResetUrl: string | null;
  };
  persistenceEnabled: boolean;
}) {
  const displayTimeZone = useDisplayTimeZone();
  const { settings, updateSetting } = useUiSettings();
  const [board, setBoard] = useState<Board>(initialBoard);
  // Calendar data (native entries, imported events) for the board it
  // was loaded for, and the board revision it covers. It reloads whenever the
  // shown board's revision is newer, however that revision arrived.
  const [calendarData, setCalendarData] = useState(() => ({
    boardId: initialBoard.id,
    revision: initialBoard.revision ?? 0,
    entries: calendarWorkspace?.calendarEntries ?? initialCalendarEntries,
    sourceEvents: calendarWorkspace?.sourceEvents ?? initialCalendarSourceEvents,
  }));
  const calendarEntries = calendarData.boardId === board.id ? calendarData.entries : EMPTY_CALENDAR_ENTRIES;
  const calendarSourceEvents =
    calendarData.boardId === board.id ? calendarData.sourceEvents : EMPTY_CALENDAR_SOURCE_EVENTS;
  const [boardAccess, setBoardAccess] = useState<BoardAccessMetadata>(initialBoardAccess);
  const [accessibleBoards, setAccessibleBoards] = useState<AccessibleBoardSummary[]>(initialAccessibleBoards);
  const [currentBoardId, setCurrentBoardId] = useState(initialCurrentBoardId);
  const [personalBoardId] = useState(initialPersonalBoardId);
  // A subtask has no editor of its own (see subtask-rule.ts): a link or a
  // calendar item that names one opens its task with the subtask in focus.
  const initialSelection = useMemo(() => {
    const rootTaskId = initialSelectedTaskId
      ? buildBoardIndex(initialBoard.buckets).rootTaskIdByTaskId.get(initialSelectedTaskId) ?? null
      : null;
    return {
      taskId: rootTaskId,
      focusedSubtaskId: rootTaskId && rootTaskId !== initialSelectedTaskId ? initialSelectedTaskId ?? null : null,
    };
  }, [initialBoard.buckets, initialSelectedTaskId]);
  const initialOpenTaskId = initialSelection.taskId;
  const initialCalendarArrivalTaskId =
    initialTaskHandoffSource === "calendar" ? initialOpenTaskId : null;
  const [selectedTaskId, setSelectedRootTaskId] = useState<string | null>(initialOpenTaskId);
  const [focusedSubtaskId, setFocusedSubtaskId] = useState<string | null>(initialSelection.focusedSubtaskId);
  const rootTaskIdsRef = useRef<ReadonlyMap<string, string>>(new Map());
  const setSelectedTaskId = useCallback((taskId: string | null) => {
    const rootTaskId = taskId ? rootTaskIdsRef.current.get(taskId) ?? taskId : null;
    setSelectedRootTaskId(rootTaskId);
    setFocusedSubtaskId(rootTaskId !== taskId ? taskId : null);
  }, []);
  const [retainedArchivedTask, setRetainedArchivedTask] =
    useState<RetainedArchivedTask | null>(null);
  const [calendarArrivalTaskId, setCalendarArrivalTaskId] = useState<string | null>(
    initialCalendarArrivalTaskId,
  );
  const [isCalendarArrivalNoticeVisible, setIsCalendarArrivalNoticeVisible] =
    useState(Boolean(initialCalendarArrivalTaskId));
  const [boardNotice, setBoardNotice] = useState(initialBoardNotice ?? null);
  const [isInitialBoardNoticeVisible, setIsInitialBoardNoticeVisible] =
    useState(Boolean(initialBoardNotice));
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [activeTaskPreviewMode, setActiveTaskPreviewMode] = useState<
    "collapsed" | "expanded" | null
  >(null);
  const [taskDropPreview, setTaskDropPreview] = useState<TaskDropPreview | null>(null);
  const navigationParams = useSearchParams();
  const requestedTaskView = navigationParams.get("view");
  const [viewSelection, setViewSelection] = useState({ route: requestedTaskView, mode: initialViewMode });
  const viewMode: ViewMode = viewSelection.route === requestedTaskView ? viewSelection.mode
    : requestedTaskView === "agenda" || requestedTaskView === "focus" ? requestedTaskView : "board";
  // Reset the local saved-view override when history changes the route. Remember
  // the new route too, so returning to an earlier URL cannot revive its override.
  if (viewSelection.route !== requestedTaskView) {
    setViewSelection({ route: requestedTaskView, mode: viewMode });
  }
  const setViewMode = useCallback((mode: ViewMode) => {
    setViewSelection({ route: requestedTaskView, mode });
  }, [requestedTaskView]);
  const [taskSearchQuery, setTaskSearchQuery] = useState("");
  const [activeViewId, setActiveViewId] = useState(initialBoard.views[0]?.id ?? "view-board");
  const [compactCards] = useState(true);
  const isCalendarWorkspace = Boolean(calendarWorkspace);
  const isNotesWorkspace = Boolean(notesWorkspace);
  const phoneViewport = usePhoneViewport();
  // Calendar and Notes are separate routes: board-only tools stay on the board.
  const isRoutedWorkspace = isCalendarWorkspace || isNotesWorkspace;
  // Bumped by "New note" (palette, Capture menu) while Notes is open.
  const [noteCreateRequest, setNoteCreateRequest] = useState(0);
  const phoneCalendarActionsRef = useRef<CalendarPhoneActions | null>(null);
  const [bucketNoteCounts, setBucketNoteCounts] = useState<Record<string, number>>({});
  // Note counts for the bucket menus ("Notes (3)"); board view only.
  useEffect(() => {
    if (isRoutedWorkspace || !persistenceEnabled) {
      return;
    }

    const controller = new AbortController();
    fetchBoardNoteCounts(board.id, controller.signal)
      .then((counts) => setBucketNoteCounts(counts.buckets))
      .catch(() => setBucketNoteCounts({}));

    return () => controller.abort();
  }, [board.id, isRoutedWorkspace, persistenceEnabled]);
  const routeOutageView = calendarWorkspace?.focusContext?.initialOutageView === true;
  const [outageSelection, setOutageSelection] = useState({ route: routeOutageView, active: routeOutageView });
  const isOutageCalendarView = outageSelection.route === routeOutageView ? outageSelection.active : routeOutageView;
  if (outageSelection.route !== routeOutageView) {
    setOutageSelection({ route: routeOutageView, active: routeOutageView });
  }
  const setIsOutageCalendarView = useCallback((active: boolean) => {
    setOutageSelection({ route: routeOutageView, active });
  }, [routeOutageView]);
  const taskViewStorageKey = `taskboard:task-view:v1:${currentUser.id ?? currentUser.email}`;
  const readTaskView = useCallback((): ViewMode => {
    try {
      const saved = sessionStorage.getItem(taskViewStorageKey);
      return saved === "agenda" || saved === "focus" ? saved : "board";
    } catch { return "board"; }
  }, [taskViewStorageKey]);
  const lastTaskView = useSyncExternalStore(subscribeTaskView, readTaskView, serverTaskView);
  useEffect(() => {
    if (isRoutedWorkspace) return;
    try {
      sessionStorage.setItem(taskViewStorageKey, viewMode);
      window.dispatchEvent(new Event("taskboard:task-view"));
    } catch { /* Optional session memory; explicit links still work. */ }
  }, [isRoutedWorkspace, taskViewStorageKey, viewMode]);

  // Newest server snapshot on screen. Save responses and live reloads are
  // always for the board on screen; one for another board (a slow response
  // from before a board switch) or an older revision of this one (a slow save
  // response overtaken by a live reload) is dropped. Board switches set the
  // board directly and move this record first.
  const shownBoardRevisionRef = useRef({ id: board.id, revision: board.revision });
  useEffect(() => {
    shownBoardRevisionRef.current = { id: board.id, revision: board.revision };
  }, [board.id, board.revision]);
  // False when the response's board was not shown: another board is open, or
  // a newer revision already is.
  const applyBoardMutationResponse = useCallback((response: BoardMutationResponse) => {
    let applied = false;
    if (response.board) {
      const shown = shownBoardRevisionRef.current;
      const { id, revision } = response.board;
      if (id !== shown.id || (revision !== undefined && shown.revision !== undefined && revision < shown.revision)) {
        return false;
      }
      shownBoardRevisionRef.current = { id, revision };
      setBoard(response.board);
      applied = true;
    }
    if (response.boardAccess) {
      setBoardAccess(response.boardAccess);
    }
    return applied;
  }, []);
  const currentBoardPermissions = useMemo(
    () => ({
      canRead: boardAccess.canRead,
      canEdit: boardAccess.canEdit,
      canManage: boardAccess.canManage,
      canManageLifecycle: boardAccess.canManageLifecycle,
    }),
    [boardAccess.canEdit, boardAccess.canManage, boardAccess.canManageLifecycle, boardAccess.canRead],
  );
  const currentAccessibleBoard = useMemo(
    () => accessibleBoards.find((accessibleBoard) => accessibleBoard.boardId === currentBoardId) ?? null,
    [accessibleBoards, currentBoardId],
  );
  const currentAccessibleBoardId = currentAccessibleBoard?.boardId ?? null;
  // Where links to Calendar and back point: a focused subtask, else the task.
  const navigationTaskId = focusedSubtaskId ?? selectedTaskId;
  const selectedTaskCalendarDate = useMemo(() => {
    if (!navigationTaskId) {
      return null;
    }

    const task =
      buildBoardIndex(board.buckets).taskById.get(navigationTaskId) ??
      (retainedArchivedTask?.task.id === navigationTaskId ? retainedArchivedTask.task : null);
    if (!task) {
      return null;
    }

    const datedValue = task.startAt ?? task.endAt ?? task.dueAt;
    return task.allDay ? getCalendarFocusDate(datedValue) : getCalendarFocusDateTime(datedValue) ?? null;
  }, [board.buckets, retainedArchivedTask, navigationTaskId]);
  const buildTaskboardWorkspaceHref = useCallback(
    (mode: ViewMode = "board") => {
      const params = new URLSearchParams();

      if (currentAccessibleBoardId) {
        params.set("boardId", currentAccessibleBoardId);
      }

      if (mode !== "board") {
        params.set("view", mode);
      }

      if (selectedTaskCalendarDate) {
        params.set("date", selectedTaskCalendarDate);
      }

      if (navigationTaskId) {
        params.set("taskId", navigationTaskId);
      }

      const query = params.toString();
      return query ? `/?${query}` : "/";
    },
    [currentAccessibleBoardId, navigationTaskId, selectedTaskCalendarDate],
  );
  const buildCalendarWorkspaceHref = useCallback(
    (outages = false) => {
      const params = new URLSearchParams();

      if (currentAccessibleBoardId) {
        params.set("boardId", currentAccessibleBoardId);
      }

      if (outages) {
        params.set("view", "outages");
      }

      if (selectedTaskCalendarDate) {
        params.set("date", selectedTaskCalendarDate);
      }

      if (navigationTaskId) {
        params.set("taskId", navigationTaskId);
      }

      const query = params.toString();
      return query ? `/calendar?${query}` : "/calendar";
    },
    [currentAccessibleBoardId, navigationTaskId, selectedTaskCalendarDate],
  );
  const calendarWorkspaceHref = buildCalendarWorkspaceHref();
  const outageCalendarWorkspaceHref = buildCalendarWorkspaceHref(true);
  const taskboardWorkspaceHref = buildTaskboardWorkspaceHref("board");
  const agendaWorkspaceHref = buildTaskboardWorkspaceHref("agenda");
  const focusWorkspaceHref = buildTaskboardWorkspaceHref("focus");
  const notesWorkspaceHref = buildNotesHref({});
  const activeWorkspaceHref = isNotesWorkspace
    ? notesWorkspaceHref
    : isCalendarWorkspace
      ? buildCalendarWorkspaceHref(isOutageCalendarView)
      : buildTaskboardWorkspaceHref(viewMode);
  const optionsHref = buildOptionsHref(activeWorkspaceHref);
  const canOpenBoardSettings =
    currentAccessibleBoard?.boardType === "personal" &&
    currentAccessibleBoard.ownerUserId === currentUser.id;
  const isPersonalActiveBoard = currentBoardId === personalBoardId;
  const isReadOnlyBoard = !currentBoardPermissions.canEdit;
  const readOnlyBoardMessage =
    "Read-only board. You can inspect tasks, notes, and attachments, but editing is disabled.";
  const activeBoardRequestOptions = useMemo(
    () => ({ boardId: currentBoardId }),
    [currentBoardId],
  );
  const [isAddingBucket, setIsAddingBucket] = useState(false);
  const [newBucketTitle, setNewBucketTitle] = useState("");
  const [hoveredBucketId, setHoveredBucketId] = useState<string | null>(null);
  const [activeBucketDragId, setActiveBucketDragId] = useState<string | null>(null);
  // Live updates: reload the board when its revision moves (any writer), but
  // never mid-drag, mid-save or while typing (use-live-board-revision.ts).
  const isBoardInteractionBusy = useCallback(
    () => activeTaskId !== null || activeBucketDragId !== null,
    [activeTaskId, activeBucketDragId],
  );
  const loadLiveBoardSnapshot = useCallback(async (): Promise<LiveBoardSnapshot | null> => {
    const response = await persistLoadBoard(board.id);
    if (!response?.board || response.board.id !== board.id) return null;
    return { revision: response.board.revision ?? 0, apply: () => applyBoardMutationResponse(response) };
  }, [applyBoardMutationResponse, board.id]);
  const showBoardUnavailableNotice = useCallback(() => {
    setBoardNotice("You can no longer open this board, so its changes stop showing here.");
    setIsInitialBoardNoticeVisible(true);
  }, []);
  const checkBoardRevisionNow = useLiveBoardRevision({
    boardId: board.id,
    revision: board.revision,
    enabled: persistenceEnabled,
    isBusy: isBoardInteractionBusy,
    load: loadLiveBoardSnapshot,
    onBoards: setAccessibleBoards,
    onBoardUnavailable: showBoardUnavailableNotice,
  });
  const showsCalendarData = Boolean(calendarWorkspace) || viewMode === "agenda";
  const calendarRefreshKey =
    persistenceEnabled &&
    showsCalendarData &&
    board.revision !== undefined &&
    (calendarData.boardId !== board.id || calendarData.revision < board.revision)
      ? `${board.id}:${board.revision}`
      : null;
  const shownBoardForCalendarRef = useRef({ id: board.id, revision: board.revision ?? 0 });
  useEffect(() => {
    shownBoardForCalendarRef.current = { id: board.id, revision: board.revision ?? 0 };
  }, [board.id, board.revision]);
  useLiveRefresh(
    calendarRefreshKey,
    useCallback(
      async (isCurrent: () => boolean) => {
        const shown = shownBoardForCalendarRef.current;
        const generation = liveWriteGeneration();
        const params = new URLSearchParams({ boardId: shown.id, imported: includeImportedCalendarEvents ? "1" : "0" });
        const response = await fetch(`/api/calendar/snapshot?${params.toString()}`, { cache: "no-store" });
        if (!response.ok) throw new Error(`Calendar reload failed with status ${response.status}`);
        const snapshot = (await response.json()) as {
          boardId: string;
          revision: number;
          calendarEntries: CalendarEntry[];
          sourceEvents: TaskboardCalendarSourceEvent[];
        };
        const latest = shownBoardForCalendarRef.current;
        // Another board, a save that finished meanwhile, or anything in
        // progress: throw this copy away and load again.
        if (!isCurrent() || snapshot.boardId !== latest.id || !canApplyLiveLoad(generation)) return false;
        setCalendarData((current) =>
          current.boardId === snapshot.boardId && snapshot.revision < current.revision
            ? current
            : {
                boardId: snapshot.boardId,
                revision: snapshot.revision,
                entries: snapshot.calendarEntries,
                sourceEvents: snapshot.sourceEvents,
              },
        );
        return snapshot.revision >= latest.revision;
      },
      [includeImportedCalendarEvents],
    ),
  );
  // On the calendar page its task events come from the live board, so a task
  // changed anywhere moves on the calendar too.
  const calendarTaskEvents = useMemo(
    () =>
      calendarWorkspace
        ? suppressTaskEventsLinkedToImportedSources(mapBoardTasksToCalendarEvents(board), calendarSourceEvents)
        : EMPTY_CALENDAR_TASK_EVENTS,
    [board, calendarSourceEvents, calendarWorkspace],
  );
  // The calendar's board details follow the live board and board list.
  const calendarBoardContext = useMemo(
    () =>
      calendarWorkspace
        ? { ...calendarWorkspace.boardContext, activeBoardId: board.id, activeBoardTitle: board.title }
        : null,
    [board.id, board.title, calendarWorkspace],
  );
  const calendarBoardBuckets = useMemo(
    () => board.buckets.map((bucket) => ({ color: bucket.color, id: bucket.id, title: bucket.title })),
    [board.buckets],
  );
  const calendarBoardOptions = useMemo(() => accessibleBoards.map(toCalendarBoardOption), [accessibleBoards]);
  const [detailPanelMode, setDetailPanelMode] = useState<DetailPanelMode>(
    initialSelection.focusedSubtaskId ? "expanded" : "sidebar",
  );
  const [isInspectorVisible, setIsInspectorVisible] = useState(Boolean(initialOpenTaskId));
  const [isBoardSwitcherOpen, setIsBoardSwitcherOpen] = useState(false);
  const [boardPickerSearch, setBoardPickerSearch] = useState("");
  const deferredBoardPickerSearch = useDeferredValue(boardPickerSearch);
  const [showAdminBoardAccess, setShowAdminBoardAccess] = useState(false);
  const boardPickerSections = useMemo(
    () =>
      buildBoardPickerSections(accessibleBoards, {
        currentBoardId,
        searchQuery: deferredBoardPickerSearch,
        showAdminAccess: showAdminBoardAccess,
      }),
    [accessibleBoards, currentBoardId, deferredBoardPickerSearch, showAdminBoardAccess],
  );
  const [isBoardSettingsOpen, setIsBoardSettingsOpen] = useState(false);
  const [boardPrivacySettings, setBoardPrivacySettings] =
    useState<BoardPrivacySettingsResponse | null>(null);
  const [boardPrivacyDraft, setBoardPrivacyDraft] = useState<{
    personalVisibility: PersonalBoardVisibilitySetting;
    personalVisibilityTeamId: string | null;
  } | null>(null);
  const [isBoardPrivacyLoading, setIsBoardPrivacyLoading] = useState(false);
  const [isBoardPrivacySaving, setIsBoardPrivacySaving] = useState(false);
  const [boardPrivacyMessage, setBoardPrivacyMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [boardShareMembers, setBoardShareMembers] = useState<PersonalBoardShareMember[]>([]);
  const [boardShareCandidates, setBoardShareCandidates] = useState<PersonalBoardShareCandidate[]>([]);
  const [boardShareSearch, setBoardShareSearch] = useState("");
  const [boardShareCandidateId, setBoardShareCandidateId] = useState("");
  const [boardShareRole, setBoardShareRole] = useState<PersonalBoardShareRole>("viewer");
  const [isBoardShareLoading, setIsBoardShareLoading] = useState(false);
  const [isBoardShareSearching, setIsBoardShareSearching] = useState(false);
  const [isBoardShareSaving, setIsBoardShareSaving] = useState(false);
  const [boardShareMessage, setBoardShareMessage] = useState<{
    tone: "success" | "error";
    text: string;
  } | null>(null);
  const [isViewMenuOpen, setIsViewMenuOpen] = useState(false);
  const [isViewSettingsOpen, setIsViewSettingsOpen] = useState(false);
  const [mutationError, setMutationError] = useState("");
  const { confirm, dialog: confirmDialog } = useConfirm();
  // requestBoardMutation resolves (rather than throws) on HTTP errors, so callers
  // must report a missing board explicitly or the failure is silent.
  const reportMutationFailure = useCallback(
    (response: BoardMutationResponse | null, fallbackMessage: string) => {
      setMutationError(response?.error ?? fallbackMessage);
    },
    [],
  );
  // One undo toast at a time; a newer action replaces it, and it hides itself.
  const [undoToast, setUndoToast] = useState<UndoToastState | null>(null);
  const undoToastIdRef = useRef(0);
  const showUndoToast = useCallback((message: string, onUndo: () => Promise<void>) => {
    undoToastIdRef.current += 1;
    setUndoToast({ id: undoToastIdRef.current, message, onUndo });
  }, []);
  useEffect(() => {
    if (!undoToast) {
      return;
    }

    const timer = window.setTimeout(() => {
      setUndoToast((current) => (current?.id === undoToast.id ? null : current));
    }, UNDO_TOAST_DURATION_MS);

    return () => window.clearTimeout(timer);
  }, [undoToast]);
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importMode, setImportMode] = useState<ImportMode>("ics");
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importInputKey, setImportInputKey] = useState(0);
  const [isImporting, setIsImporting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const [bulkImportRawText, setBulkImportRawText] = useState("");
  const [bulkImportWarnings, setBulkImportWarnings] = useState<string[]>([]);
  const [bulkImportDraftTasks, setBulkImportDraftTasks] = useState<BulkTaskImportDraftTask[]>([]);
  const [bulkImportBucketDecisions, setBulkImportBucketDecisions] = useState<
    Record<string, BulkTaskImportBucketDecision>
  >({});
  const [bulkImportMetadata, setBulkImportMetadata] = useState<BulkTaskImportMetadata>(() => {
    const lastWeek = getLastWeekDateRange();
    return {
      source: bulkTaskImportSource,
      rangeLabel: lastWeek.label,
    };
  });
  const [bulkImportInfo, setBulkImportInfo] = useState("");
  const [isBulkImportSubmitting, setIsBulkImportSubmitting] = useState(false);
  const [isRecycleBinOpen, setIsRecycleBinOpen] = useState(false);
  const [isArchivesOpen, setIsArchivesOpen] = useState(false);
  const [isMoreMenuOpen, setIsMoreMenuOpen] = useState(false);
  const [recycleBinItems, setRecycleBinItems] = useState<RecycleBinItem[]>([]);
  const [archiveItems, setArchiveItems] = useState<ArchiveItem[]>([]);
  const [isRecycleBinLoading, setIsRecycleBinLoading] = useState(false);
  const [isArchivesLoading, setIsArchivesLoading] = useState(false);
  const [recycleBinError, setRecycleBinError] = useState("");
  const [archivesError, setArchivesError] = useState("");
  const [recycleBinInfo, setRecycleBinInfo] = useState("");
  const [archivesInfo, setArchivesInfo] = useState("");
  const [recycleBinBusyTaskId, setRecycleBinBusyTaskId] = useState<string | null>(null);
  const [archiveBusyTaskId, setArchiveBusyTaskId] = useState<string | null>(null);
  const [archivesTab, setArchivesTab] = useState<"done" | "archived">("done");
  const boardSwitcherRef = useRef<HTMLDivElement | null>(null);
  const workspaceNavRef = useRef<HTMLDivElement | null>(null);
  const importSurfaceRef = useRef<HTMLDivElement | null>(null);
  const moreMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const phoneHeaderMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const phoneNavMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const phoneMenuAnchorRef = useRef<HTMLButtonElement | null>(null);
  const moreMenuSurfaceRef = useRef<HTMLDivElement | null>(null);
  const viewMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const viewMenuSurfaceRef = useRef<HTMLDivElement | null>(null);
  const viewSettingsSurfaceRef = useRef<HTMLDivElement | null>(null);
  const expandedDetailPanelRef = useRef<HTMLDivElement | null>(null);
  const taskSidebarRef = useRef<HTMLElement | null>(null);
  const recycleBinPanelRef = useRef<HTMLDivElement | null>(null);
  const archivesPanelRef = useRef<HTMLDivElement | null>(null);
  const taskboardShellRef = useRef<HTMLElement | null>(null);
  const boardHeaderRef = useRef<HTMLElement | null>(null);
  const boardStageRef = useRef<HTMLElement | null>(null);
  const initialBoardSelectionPersistedRef = useRef(false);
  const pendingRootTaskMoveRef = useRef(new Map<string, Promise<void>>());
  const activeTaskSourceBucketIdRef = useRef<string | null>(null);
  const taskDropPreviewRef = useRef<TaskDropPreview | null>(null);
  const taskEditorTextFlushRef = useRef<(() => void) | null>(null);
  const initialBoardCollapseAppliedRef = useRef(false);

  const sensors = useSensors(
    useSensor(MouseSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(TouchSensor, {
      activationConstraint: {
        delay: 180,
        tolerance: 6,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // The whole task card is the drag activator, so Enter must stay free to
      // open the task; Space picks a card up for keyboard moving.
      keyboardCodes: {
        start: [KeyboardCode.Space],
        cancel: [KeyboardCode.Esc],
        end: [KeyboardCode.Space, KeyboardCode.Enter, KeyboardCode.Tab],
      },
    }),
  );

  useLayoutEffect(() => {
    const shell = taskboardShellRef.current;
    const header = boardHeaderRef.current;
    const stage = boardStageRef.current;
    if (!shell || !header || !stage) {
      return;
    }

    const syncStickyHeaderOffset = () => {
      const headerRect = header.getBoundingClientRect();
      const stageRect = stage.getBoundingClientRect();
      const headerHeight = Math.ceil(headerRect.height);
      const headerStyles = window.getComputedStyle(header);
      const stickyTop = Number.parseFloat(headerStyles.top) || 0;
      const contentGap = 8;
      shell.style.setProperty(
        "--taskboard-view-stage-offset",
        `${Math.max(0, stageRect.left - headerRect.left)}px`,
      );
      shell.style.setProperty(
        "--taskboard-sticky-header-offset",
        `${Math.ceil(stickyTop + headerHeight)}px`,
      );
      shell.style.setProperty(
        "--taskboard-sidebar-sticky-top",
        `${Math.ceil(stickyTop + headerHeight + contentGap)}px`,
      );
    };

    syncStickyHeaderOffset();
    const observer = new ResizeObserver(syncStickyHeaderOffset);
    observer.observe(header);
    observer.observe(stage);
    window.addEventListener("resize", syncStickyHeaderOffset);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", syncStickyHeaderOffset);
    };
  }, [isCalendarWorkspace, settings.fontScale]);

  useEffect(() => {
    if (
      !persistenceEnabled ||
      !persistInitialBoardSelection ||
      initialBoardSelectionPersistedRef.current
    ) {
      return;
    }

    initialBoardSelectionPersistedRef.current = true;
    void persistSelectedBoardPreference(
      initialBoard.id === personalBoardId ? null : initialBoard.id,
    );
  }, [initialBoard.id, persistInitialBoardSelection, persistenceEnabled, personalBoardId]);

  useEffect(() => {
    if (!calendarArrivalTaskId) {
      return;
    }

    const hideTimer = window.setTimeout(() => {
      setIsCalendarArrivalNoticeVisible(false);
    }, 7000);

    return () => {
      window.clearTimeout(hideTimer);
    };
  }, [calendarArrivalTaskId]);

  useEffect(() => {
    if (!isCalendarWorkspace) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      workspaceNavRef.current
        ?.querySelector<HTMLElement>(".ui-chip-active")
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [isCalendarWorkspace, isOutageCalendarView]);

  const activeView = board.views.find((view) => view.id === activeViewId) ?? board.views[0] ?? null;
  const boardIndex = useMemo(() => buildBoardIndex(board.buckets), [board.buckets]);
  // Done top-level tasks stay on the board until archived; Archives lists them.
  const doneRootTasks = useMemo(
    () =>
      board.buckets.flatMap((bucket) =>
        bucket.tasks
          .filter((task) => task.status === "done")
          .map((task) => ({ task, bucketTitle: bucket.title }))),
    [board.buckets],
  );
  const bucketOrderIndexById = useMemo(
    () => new Map(board.buckets.map((bucket, index) => [bucket.id, index])),
    [board.buckets],
  );
  useEffect(() => {
    rootTaskIdsRef.current = boardIndex.rootTaskIdByTaskId;
  }, [boardIndex]);
  const selectedActiveTask = selectedTaskId
    ? boardIndex.taskById.get(selectedTaskId) ?? null
    : null;
  const selectedTask =
    selectedActiveTask ??
    (selectedTaskId && retainedArchivedTask?.task.id === selectedTaskId
      ? retainedArchivedTask.task
      : null);
  const isSelectedTaskArchived = Boolean(
    selectedTaskId && retainedArchivedTask?.task.id === selectedTaskId && !selectedActiveTask,
  );
  const deferredTaskSearchQuery = useDeferredValue(taskSearchQuery);
  const taskSearchTokens = useMemo(
    () => getTaskSearchTokens(deferredTaskSearchQuery),
    [deferredTaskSearchQuery],
  );
  const isTaskSearchActive = taskSearchTokens.length > 0;
  const viewFilteredBoard = useMemo(
    () => (activeView ? applyViewPreset(board, activeView) : board),
    [board, activeView],
  );
  const visibleBoard = useMemo(
    () => filterBoardByTaskSearch(viewFilteredBoard, deferredTaskSearchQuery),
    [viewFilteredBoard, deferredTaskSearchQuery],
  );
  useEffect(() => {
    if (!calendarArrivalTaskId) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const selectedCard = Array.from(
        document.querySelectorAll<HTMLElement>("[data-task-id]"),
      ).find((element) => element.dataset.taskId === calendarArrivalTaskId);

      selectedCard?.scrollIntoView({
        block: "center",
        inline: "nearest",
        behavior: "smooth",
      });
      selectedCard?.focus({ preventScroll: true });
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [calendarArrivalTaskId, visibleBoard]);
  const visibleTaskCount = useMemo(
    () => getVisibleTaskCountForMode(visibleBoard, viewMode),
    [visibleBoard, viewMode],
  );
  const boardLabels = boardIndex.allLabels;
  const activeTask = activeTaskId ? boardIndex.taskById.get(activeTaskId) ?? null : null;
  const activeBucketDrag =
    activeBucketDragId
      ? board.buckets.find((bucket) => bucket.id === activeBucketDragId) ?? null
      : null;
  // A page opened on a subtask link starts in the workspace, which renders in
  // a portal, so it waits until hydration to match the server's HTML.
  const isHydrated = useIsClient();
  const activeDetailPanelMode: DetailPanelMode =
    detailPanelMode === "expanded" && selectedTask && isHydrated ? "expanded" : "sidebar";
  const visibleInboxBucket =
    visibleBoard.buckets.find((bucket) => bucket.title.trim().toLowerCase() === "inbox") ?? null;
  const emptyStateNewTaskBucket = visibleInboxBucket ?? visibleBoard.buckets[0] ?? null;
  const focusView =
    board.views.find((view) => view.id === "view-focus") ??
    board.views.find((view) => view.name.trim().toLowerCase() === "focus") ??
    null;
  const todayView =
    board.views.find((view) => view.id === "view-today") ??
    board.views.find((view) => view.name.trim().toLowerCase() === "today") ??
    null;
  const builtInViewIds = useMemo(
    () => new Set(["view-board", "view-today", "view-focus", "view-imports"]),
    [],
  );
  const builtInViews = useMemo(
    () => board.views.filter((view) => builtInViewIds.has(view.id)),
    [board.views, builtInViewIds],
  );
  const savedViews = useMemo(
    () => board.views.filter((view) => !builtInViewIds.has(view.id)),
    [board.views, builtInViewIds],
  );
  const flushTaskEditorTextEdits = () => {
    taskEditorTextFlushRef.current?.();
  };
  const handleSelectTask = (taskId: string) => {
    flushTaskEditorTextEdits();
    if (taskId !== calendarArrivalTaskId) {
      setCalendarArrivalTaskId(null);
      setIsCalendarArrivalNoticeVisible(false);
    }
    setRetainedArchivedTask(null);
    setSelectedTaskId(taskId);
    setIsInspectorVisible(true);
    // A subtask shows in its task's Work tab, which only the workspace has.
    const opensSubtask = (rootTaskIdsRef.current.get(taskId) ?? taskId) !== taskId;
    setDetailPanelMode(phoneViewport.isPhone || opensSubtask ? "expanded" : "sidebar");
  };

  useEffect(() => {
    if (
      !selectedTaskId ||
      !isInspectorVisible ||
      activeDetailPanelMode !== "sidebar" ||
      !window.matchMedia("(max-width: 767px)").matches
    ) {
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      taskSidebarRef.current?.scrollIntoView({
        block: "start",
        inline: "nearest",
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [activeDetailPanelMode, isInspectorVisible, selectedTaskId]);

  useEffect(() => {
    if (activeDetailPanelMode !== "expanded") {
      return;
    }

    const previousDocumentOverflow = document.documentElement.style.overflow;
    const previousBodyOverflow = document.body.style.overflow;
    document.documentElement.style.overflow = "hidden";
    document.body.style.overflow = "hidden";

    return () => {
      document.documentElement.style.overflow = previousDocumentOverflow;
      document.body.style.overflow = previousBodyOverflow;
    };
  }, [activeDetailPanelMode]);
  const handleCloseInspector = () => {
    flushTaskEditorTextEdits();
    setCalendarArrivalTaskId(null);
    setIsCalendarArrivalNoticeVisible(false);
    setRetainedArchivedTask(null);
    setSelectedTaskId(null);
    setDetailPanelMode("sidebar");
    setIsInspectorVisible(false);
  };

  useEffect(() => {
    const url = new URL(window.location.href);
    // A subtask link stays a subtask link, so a reload opens it again.
    const nextTaskId = isInspectorVisible ? focusedSubtaskId ?? selectedTaskId : null;

    if (nextTaskId) {
      if (url.searchParams.get("taskId") === nextTaskId) {
        return;
      }
      url.searchParams.set("taskId", nextTaskId);
    } else {
      if (!url.searchParams.has("taskId")) {
        return;
      }
      url.searchParams.delete("taskId");
    }

    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );
  }, [focusedSubtaskId, isInspectorVisible, selectedTaskId]);

  const handleOpenExpandedTaskDetail = () => {
    flushTaskEditorTextEdits();
    if (selectedTask) {
      setDetailPanelMode("expanded");
    }
  };
  const handleCollapseExpandedTaskDetail = () => {
    flushTaskEditorTextEdits();
    setDetailPanelMode("sidebar");
    setIsInspectorVisible(true);
  };
  const handleOpenView = (viewId: string) => {
    const view = board.views.find((candidate) => candidate.id === viewId);
    if (!view) {
      return;
    }

    setActiveViewId(view.id);
    setViewMode(coerceViewMode(view.layoutMode));
  };
  const closeImport = () => {
    setIsImportOpen(false);
    setImportFile(null);
    setImportInputKey((current) => current + 1);
    setImportMessage("");
    setImportErrors([]);
    moreMenuButtonRef.current?.focus();
  };
  useDismissibleSurface({
    isOpen: isImportOpen,
    onClose: closeImport,
    refs: [importSurfaceRef],
  });
  useDismissibleSurface({
    isOpen: isMoreMenuOpen,
    onClose: () => setIsMoreMenuOpen(false),
    refs: [moreMenuButtonRef, phoneHeaderMenuButtonRef, phoneNavMenuButtonRef, moreMenuSurfaceRef],
  });
  useDismissibleSurface({
    isOpen: isViewSettingsOpen,
    onClose: () => setIsViewSettingsOpen(false),
    refs: [viewSettingsSurfaceRef],
  });
  useDismissibleSurface({
    isOpen: isViewMenuOpen,
    onClose: () => {
      setIsViewMenuOpen(false);
      setIsViewSettingsOpen(false);
    },
    refs: [viewMenuButtonRef, viewMenuSurfaceRef],
  });
  // Outside clicks close the workspace here; Escape is handled by the layered
  // workspace handler, after any field or menu inside has had its turn.
  useDismissibleSurface({
    isOpen: activeDetailPanelMode === "expanded" && Boolean(selectedTask),
    onClose: handleCollapseExpandedTaskDetail,
    refs: [expandedDetailPanelRef],
    closeOnEscape: false,
  });
  useDismissibleSurface({
    isOpen: isRecycleBinOpen,
    onClose: () => setIsRecycleBinOpen(false),
    refs: [recycleBinPanelRef],
  });
  useDismissibleSurface({
    isOpen: isArchivesOpen,
    onClose: () => setIsArchivesOpen(false),
    refs: [archivesPanelRef],
  });
  const bulkImportIncludedTasks = useMemo(
    () => bulkImportDraftTasks.filter((task) => task.included),
    [bulkImportDraftTasks],
  );
  const bulkImportIncludedCount = bulkImportIncludedTasks.length;
  const bulkImportExcludedCount = bulkImportDraftTasks.length - bulkImportIncludedCount;
  const bucketOptions = useMemo(
    () => board.buckets.map((bucket) => ({ id: bucket.id, title: bucket.title })),
    [board.buckets],
  );
  const existingBucketIds = useMemo(
    () => new Set(bucketOptions.map((bucket) => bucket.id)),
    [bucketOptions],
  );
  const existingBucketByNormalizedTitle = useMemo(
    () =>
      new Map(
        bucketOptions.map((bucket) => [normalizeBulkImportBucketKey(bucket.title), bucket]),
      ),
    [bucketOptions],
  );
  const bulkImportMissingBucketNames = useMemo(
    () =>
      Array.from(
        new Set(
          bulkImportDraftTasks
            .filter((task) => task.included)
            .map((task) => task.bucket.trim())
            .filter(Boolean)
            .filter(
              (bucketName) =>
                !existingBucketByNormalizedTitle.has(normalizeBulkImportBucketKey(bucketName)),
            ),
        ),
      ),
    [bulkImportDraftTasks, existingBucketByNormalizedTitle],
  );
  const sidebarWidthClass =
    settings.sidebarWidth === "narrow"
      ? "md:w-[220px] lg:w-[235px] xl:w-[250px]"
      : settings.sidebarWidth === "wide"
        ? "md:w-[290px] lg:w-[330px] xl:w-[380px]"
        : "md:w-[250px] lg:w-[270px] xl:w-[290px]";
  const bucketMinWidth =
    settings.bucketWidthMode === "tight"
      ? "196px"
      : settings.bucketWidthMode === "wide"
        ? "240px"
        : "216px";
  const resolvedCompactCards =
    settings.cardDetailLevel === "minimal"
      ? true
      : settings.cardDetailLevel === "detailed"
        ? false
        : compactCards;
  const mainGapClass =
    settings.density === "relaxed" ? "gap-2" : settings.density === "tight" ? "gap-1" : "gap-1.5";
  const boardGridGapClass =
    settings.density === "relaxed" ? "gap-2" : settings.density === "tight" ? "gap-1" : "gap-1.5";
  const boardPaddingClass =
    settings.density === "relaxed"
      ? "min-h-screen px-2 pb-2 pt-0 md:px-3 md:pb-3 xl:px-3.5 xl:pb-3.5"
      : settings.density === "tight"
        ? "min-h-screen px-1 pb-1 pt-0 md:px-1.5 md:pb-1.5 xl:px-2 xl:pb-2"
        : "min-h-screen px-1.5 pb-1.5 pt-0 md:px-2 md:pb-2 xl:px-2.5 xl:pb-2.5";

  useEffect(() => {
    let isCancelled = false;

    queueMicrotask(() => {
      if (isCancelled) {
        return;
      }

      setBulkImportBucketDecisions((current) => {
        const next: Record<string, BulkTaskImportBucketDecision> = {};

        for (const bucketName of bulkImportMissingBucketNames) {
          const key = normalizeBulkImportBucketKey(bucketName);
          const existingDecision = current[key];
          next[key] = existingDecision
            ? {
                ...existingDecision,
                targetBucketId: existingBucketIds.has(existingDecision.targetBucketId)
                  ? existingDecision.targetBucketId
                  : bucketOptions[0]?.id ?? "",
              }
            : {
                mode: "create",
                createTitle: bucketName,
                targetBucketId: bucketOptions[0]?.id ?? "",
              };
        }

        return next;
      });
    });

    return () => {
      isCancelled = true;
    };
  }, [bulkImportMissingBucketNames, bucketOptions, existingBucketIds]);

  useEffect(() => {
    if (activeDetailPanelMode !== "expanded") {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      // A menu, popover, or field that already handled Escape keeps the workspace open.
      if (event.key === "Escape" && !event.defaultPrevented) {
        flushTaskEditorTextEdits();
        setDetailPanelMode("sidebar");
      }
    };

    // eslint-disable-next-line react-hooks/immutability
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeDetailPanelMode]);

  useEffect(() => {
    if (activeDetailPanelMode !== "sidebar" || !isInspectorVisible) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      // A menu, popover, or field that already handled Escape keeps the panel open.
      if (event.key !== "Escape" || event.defaultPrevented) {
        return;
      }

      flushTaskEditorTextEdits();
      setCalendarArrivalTaskId(null);
      setIsCalendarArrivalNoticeVisible(false);
      setSelectedTaskId(null);
      setDetailPanelMode("sidebar");
      setIsInspectorVisible(false);
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeDetailPanelMode, isInspectorVisible, setSelectedTaskId]);

  const toggleBucketCollapse = (bucketId: string) => {
    if (!requireEditableBoard("You can view this board, but you do not have permission to update buckets.")) {
      return;
    }

    const nextCollapsed = !findBucketById(board.buckets, bucketId)?.collapsed;

    setBoard((current) => ({
      ...current,
      buckets: current.buckets.map((bucket) =>
        bucket.id === bucketId
          ? {
              ...bucket,
              collapsed: !bucket.collapsed,
            }
          : bucket,
        ),
    }));

    void persistBucketCollapse(bucketId, nextCollapsed, persistenceEnabled, activeBoardRequestOptions);
  };

  const applyVisibleBucketCollapse = (
    nextCollapsed: boolean,
    options: { switchToBoard?: boolean } = {},
  ) => {
    const changedBucketIds = visibleBoard.buckets
      .filter((bucket) => bucket.collapsed !== nextCollapsed)
      .map((bucket) => bucket.id);

    if (options.switchToBoard) {
      setViewMode("board");
    }

    if (changedBucketIds.length === 0) {
      return;
    }

    if (!currentBoardPermissions.canEdit) {
      setMutationError("You can view this board, but you do not have permission to update buckets.");
      return;
    }

    const changedBucketIdSet = new Set(changedBucketIds);
    setBoard((current) => ({
      ...current,
      buckets: current.buckets.map((bucket) =>
        changedBucketIdSet.has(bucket.id)
          ? {
              ...bucket,
              collapsed: nextCollapsed,
            }
          : bucket,
      ),
    }));

    void Promise.all(
      changedBucketIds.map((bucketId) =>
        persistBucketCollapse(bucketId, nextCollapsed, persistenceEnabled, activeBoardRequestOptions),
      ),
    );
  };

  // Applies the collapse preference once per browser. The hydration render
  // sees the server's default settings (never initialized), so wait for the
  // stored settings; otherwise every load collapsed the board again and
  // replaced each expanded card.
  const hasStoredSettings = useIsClient();
  useEffect(() => {
    if (
      !hasStoredSettings ||
      initialBoardCollapseAppliedRef.current ||
      settings.boardCollapsePreferenceInitialized
    ) {
      return;
    }

    initialBoardCollapseAppliedRef.current = true;
    applyVisibleBucketCollapse(settings.boardCollapsePreference === "collapsed");
    updateSetting("boardCollapsePreferenceInitialized", true);
  }, [
    hasStoredSettings,
    settings.boardCollapsePreference,
    settings.boardCollapsePreferenceInitialized,
    updateSetting,
    visibleBoard.buckets,
  ]);

  const emitNotificationsRefresh = () => {
    if (typeof window === "undefined") {
      return;
    }

    window.dispatchEvent(new CustomEvent("taskboard-notifications-refresh"));
  };

  const requireEditableBoard = useCallback(
    (message = "You can view this board, but you do not have permission to edit it.") => {
      if (currentBoardPermissions.canEdit) {
        return true;
      }

      setMutationError(message);
      return false;
    },
    [currentBoardPermissions.canEdit],
  );

  // Archive, delete, restore and purge; manager-only on some team boards.
  const requireLifecycleBoard = useCallback(
    (message: string) => {
      if (currentBoardPermissions.canManageLifecycle) {
        return true;
      }

      setMutationError(message);
      return false;
    },
    [currentBoardPermissions.canManageLifecycle],
  );

  const requirePersonalBoardAction = useCallback(
    (actionLabel: string) => {
      if (isPersonalActiveBoard) {
        return true;
      }

      const message = `${actionLabel} is only available on your personal board. Switch back to your personal board to use it.`;
      setMutationError(message);
      return false;
    },
    [isPersonalActiveBoard],
  );

  const handleDragStart = (event: DragStartEvent) => {
    if (isTaskSearchActive) {
      return;
    }

    if (!currentBoardPermissions.canEdit) {
      setMutationError("You can view this board, but you do not have permission to move items.");
      return;
    }

    const activeId = String(event.active.id);
    const activeType = event.active.data.current?.type as
      | "bucket-column"
      | "task"
      | undefined;

    if (activeType === "bucket-column") {
      activeTaskSourceBucketIdRef.current = null;
      taskDropPreviewRef.current = null;
      setTaskDropPreview(null);
      const bucketId =
        (event.active.data.current?.bucketId as string | undefined) ??
        getBucketIdFromBucketColumnSortableId(activeId);

      if (bucketId) {
        setActiveBucketDragId(bucketId);
      }
      return;
    }

    if (activeType === "task") {
      activeTaskSourceBucketIdRef.current =
        (event.active.data.current?.bucketId as string | undefined) ??
          findRootTaskBucketId(board.buckets, activeId);
      taskDropPreviewRef.current = null;
      setTaskDropPreview(null);
      setActiveTaskId(activeId);
      setActiveTaskPreviewMode(
        event.active.data.current?.presentation === "collapsed" ? "collapsed" : "expanded",
      );
    }
  };

  const handleDragCancel = () => {
    activeTaskSourceBucketIdRef.current = null;
    taskDropPreviewRef.current = null;
    setTaskDropPreview(null);
    setActiveTaskId(null);
    setActiveTaskPreviewMode(null);
    setActiveBucketDragId(null);
    setHoveredBucketId(null);
  };

  const handleDragOver = ({ active, over, activatorEvent, delta }: DragOverEvent) => {
    if (isTaskSearchActive || !currentBoardPermissions.canEdit) {
      setHoveredBucketId(null);
      taskDropPreviewRef.current = null;
      setTaskDropPreview(null);
      return;
    }

    if (active.data.current?.type === "bucket-column") {
      setHoveredBucketId(null);
      taskDropPreviewRef.current = null;
      setTaskDropPreview(null);
      return;
    }

    if (!over) {
      setHoveredBucketId((current) => (current === null ? current : null));
      taskDropPreviewRef.current = null;
      setTaskDropPreview(null);
      return;
    }

    const overId = String(over.id);
    const overType = over.data.current?.type as
      | "bucket"
      | "bucket-column"
      | "task"
      | undefined;
    const targetBucketId =
      overType === "bucket"
        ? overId
        : overType === "bucket-column"
          ? (over.data.current?.bucketId as string | undefined) ??
            getBucketIdFromBucketColumnSortableId(overId)
        : (over.data.current?.bucketId as string | undefined) ??
          (boardIndex.bucketIdByTaskId.get(overId) ?? null);

    const nextHoveredBucketId = targetBucketId ?? null;
    setHoveredBucketId((current) =>
      current === nextHoveredBucketId ? current : nextHoveredBucketId,
    );

    if (!targetBucketId) {
      taskDropPreviewRef.current = null;
      setTaskDropPreview(null);
      return;
    }

    const placement = getTaskDropPlacement(
      active.rect.current.translated,
      over.rect,
      overType,
      getDragPointerY(activatorEvent, delta),
    );
    const nextPreview =
      targetBucketId === activeTaskSourceBucketIdRef.current
        ? null
        : {
            taskId: String(active.id),
            targetBucketId,
            placement,
            ...(overType === "task" ? { overTaskId: overId } : {}),
          };
    taskDropPreviewRef.current = nextPreview;
    setTaskDropPreview((current) =>
      current?.taskId === nextPreview?.taskId &&
      current?.targetBucketId === nextPreview?.targetBucketId &&
      current?.placement === nextPreview?.placement &&
      current?.overTaskId === nextPreview?.overTaskId
        ? current
        : nextPreview,
    );
  };

  const handleDragEnd = ({ active, over, activatorEvent, delta }: DragEndEvent) => {
    const pendingTaskDropPreview = taskDropPreviewRef.current;
    taskDropPreviewRef.current = null;
    setActiveTaskId(null);
    setActiveTaskPreviewMode(null);
    setActiveBucketDragId(null);
    setHoveredBucketId(null);
    setTaskDropPreview(null);

    if (isTaskSearchActive) {
      activeTaskSourceBucketIdRef.current = null;
      return;
    }

    if (!currentBoardPermissions.canEdit) {
      activeTaskSourceBucketIdRef.current = null;
      setMutationError("You can view this board, but you do not have permission to move items.");
      return;
    }

    const activeId = String(active.id);
    const activeType = active.data.current?.type as
      | "bucket-column"
      | "task"
      | undefined;
    const preview =
      pendingTaskDropPreview?.taskId === activeId ? pendingTaskDropPreview : null;

    if (!over && !preview) {
      activeTaskSourceBucketIdRef.current = null;
      return;
    }

    const overId = over ? String(over.id) : preview?.overTaskId ?? preview?.targetBucketId ?? "";
    const overType = over?.data.current?.type as
      | "bucket"
      | "bucket-column"
      | "task"
      | undefined;

    if (activeType === "bucket-column") {
      activeTaskSourceBucketIdRef.current = null;
      if (!over) {
        return;
      }
      const activeBucketId =
        (active.data.current?.bucketId as string | undefined) ??
        getBucketIdFromBucketColumnSortableId(activeId);
      const targetBucketId =
        overType === "bucket-column"
          ? (over.data.current?.bucketId as string | undefined) ??
            getBucketIdFromBucketColumnSortableId(overId)
          : overType === "bucket"
            ? overId
            : (over.data.current?.bucketId as string | undefined) ??
              boardIndex.bucketIdByTaskId.get(overId) ??
              getBucketIdFromBucketColumnSortableId(overId);

      if (!activeBucketId || !targetBucketId || activeBucketId === targetBucketId) {
        return;
      }

      const targetIndex = bucketOrderIndexById.get(targetBucketId);
      if (typeof targetIndex !== "number") {
        return;
      }

      void handleMoveBucket(activeBucketId, targetIndex);
      return;
    }

    if (activeType !== "task") {
      activeTaskSourceBucketIdRef.current = null;
      return;
    }

    if (!requireEditableBoard("You can view this board, but you do not have permission to move tasks.")) {
      activeTaskSourceBucketIdRef.current = null;
      return;
    }

    activeTaskSourceBucketIdRef.current = null;

    // Compute the move from the latest rendered board instead of inside a setBoard
    // updater: the updater is deferred while other state updates are pending, so
    // values assigned inside it are not available here to decide what to persist.
    const sourceBucketId = findRootTaskBucketId(board.buckets, activeId);

    if (!sourceBucketId) {
      return;
    }

    const targetBucketId =
      preview?.targetBucketId ??
      (overType === "bucket"
        ? overId
        : overType === "bucket-column"
          ? (over?.data.current?.bucketId as string | undefined) ??
            getBucketIdFromBucketColumnSortableId(overId)
        : (over?.data.current?.bucketId as string | undefined) ??
          findBucketIdByTaskId(board.buckets, overId));

    if (!targetBucketId) {
      return;
    }

    const overTaskId = preview?.overTaskId ?? (overType === "task" ? overId : undefined);
    const sourceBucketTasks =
      board.buckets.find((bucket) => bucket.id === sourceBucketId)?.tasks ?? [];
    const placement =
      preview?.placement ??
      (targetBucketId === sourceBucketId && overTaskId
        ? getSameBucketDropPlacement(sourceBucketTasks, activeId, overTaskId)
        : over
          ? getTaskDropPlacement(
              active.rect.current.translated,
              over.rect,
              overType,
              getDragPointerY(activatorEvent, delta),
            )
          : "append");
    const previousBoard = board;
    const nextBoard = moveRootTaskOnBoard(
      board,
      activeId,
      targetBucketId,
      placement,
      overTaskId,
    );

    if (nextBoard === board) {
      return;
    }

    setBoard(nextBoard);

    if (persistenceEnabled) {
      const movePromise = persistTaskMove(
        activeId,
        targetBucketId,
        Math.max(getRootTaskIndex(nextBoard.buckets, targetBucketId, activeId), 0),
        persistenceEnabled,
        activeBoardRequestOptions,
      );

      pendingRootTaskMoveRef.current.set(activeId, movePromise);
      void movePromise
        .catch((error) => {
          console.error("Failed to persist task movement.", error);
          // Roll back only when nothing else has changed the board since this move.
          setBoard((current) => (current === nextBoard ? previousBoard : current));
          setMutationError(
            error instanceof Error && error.message
              ? `Unable to save the task move: ${error.message}`
              : "Unable to save the task move. Reload to see the saved order.",
          );
        })
        .finally(() => {
          const currentMove = pendingRootTaskMoveRef.current.get(activeId);
          if (currentMove === movePromise) {
            pendingRootTaskMoveRef.current.delete(activeId);
          }
        });
    }
  };

  const handleCreateBucket = async (title: string) => {
    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      return;
    }

    if (persistenceEnabled) {
      if (!requireEditableBoard("You can view this board, but you do not have permission to create buckets.")) {
        return;
      }

      const response = await persistCreateBucket(trimmedTitle, activeBoardRequestOptions);
      if (response?.board) {
        const shouldCollapseNewBucket = settings.boardCollapsePreference === "collapsed";
        if (shouldCollapseNewBucket) {
          const currentBucketIds = new Set(board.buckets.map((bucket) => bucket.id));
          const createdBucket =
            response.board.buckets.find((bucket) => !currentBucketIds.has(bucket.id)) ?? null;

          setBoard({
            ...response.board,
            buckets: response.board.buckets.map((bucket) =>
              createdBucket && bucket.id === createdBucket.id
                ? {
                    ...bucket,
                    collapsed: true,
                  }
                : bucket,
            ),
          });

          if (createdBucket) {
            void persistBucketCollapse(createdBucket.id, true, persistenceEnabled, activeBoardRequestOptions);
          }
        } else {
          applyBoardMutationResponse(response);
        }
      } else {
        // Keep the typed title so the user can retry.
        reportMutationFailure(response, "Unable to create the bucket.");
        return;
      }
      setIsAddingBucket(false);
      setNewBucketTitle("");
      return;
    }

    setBoard((current) => ({
      ...current,
      buckets: [
        ...current.buckets,
        createClientBucket(
          trimmedTitle,
          current.buckets.length,
          settings.boardCollapsePreference === "collapsed",
        ),
      ],
    }));
    setIsAddingBucket(false);
    setNewBucketTitle("");
  };

  const handleRenameBucket = async (bucketId: string, title: string) => {
    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      return;
    }

    if (persistenceEnabled) {
      if (!requireEditableBoard("You can view this board, but you do not have permission to rename buckets.")) {
        return;
      }

      const response = await persistUpdateBucket(bucketId, { title: trimmedTitle }, activeBoardRequestOptions);
      if (response?.board) {
        setBoard((current) => updateBucketInBoard(current, bucketId, { title: trimmedTitle }));
      } else {
        reportMutationFailure(response, "Unable to rename the bucket.");
      }
      return;
    }

    setBoard((current) => updateBucketInBoard(current, bucketId, { title: trimmedTitle }));
  };

  const handleUpdateBucketStyle = async (
    bucketId: string,
    patch: {
      color: string;
      icon: BucketIcon;
    },
  ) => {
    if (persistenceEnabled) {
      if (!requireEditableBoard("You can view this board, but you do not have permission to update buckets.")) {
        return;
      }

      const response = await persistUpdateBucket(bucketId, patch, activeBoardRequestOptions);
      if (response?.board) {
        setBoard((current) => updateBucketInBoard(current, bucketId, patch));
      } else {
        reportMutationFailure(response, "Unable to update the bucket style.");
      }
      return;
    }

    setBoard((current) => updateBucketInBoard(current, bucketId, patch));
  };

  const handleMoveBucket = async (bucketId: string, targetIndex: number) => {
    const sourceIndex = bucketOrderIndexById.get(bucketId) ?? -1;
    const clampedTargetIndex = Math.max(0, Math.min(targetIndex, board.buckets.length - 1));

    if (
      sourceIndex < 0 ||
      board.buckets.length < 2 ||
      sourceIndex === clampedTargetIndex
    ) {
      return;
    }

    const previousBoard = board;
    if (!requireEditableBoard("You can view this board, but you do not have permission to reorder buckets.")) {
      return;
    }

    const nextBoard = moveBucketInBoard(board, sourceIndex, clampedTargetIndex);
    setBoard(nextBoard);
    setMutationError("");

    if (!persistenceEnabled) {
      return;
    }

    const response = await persistReorderBuckets(nextBoard.buckets.map((bucket) => bucket.id), activeBoardRequestOptions);
    if (response?.board) {
      applyBoardMutationResponse(response);
      return;
    }

    setBoard(previousBoard);
    setMutationError("Unable to persist the bucket order.");
  };

  const handleDeleteBucket = async (bucketId: string) => {
    const bucket = findBucketById(board.buckets, bucketId);
    const bucketTitle = bucket?.title ?? "this bucket";

    if (
      persistenceEnabled &&
      (bucket?.tasks.length ?? 0) > 0 &&
      !requireLifecycleBoard("Only a team manager can delete a bucket that still has tasks on this board.")
    ) {
      return;
    }

    if (
      !(await confirm({
        title: `Delete "${bucketTitle}"?`,
        body: "Its tasks move into the recycle bin.",
        confirmLabel: "Delete bucket",
        tone: "danger",
      }))
    ) {
      return;
    }

    if (persistenceEnabled) {
      if (!requireEditableBoard("You can view this board, but you do not have permission to delete buckets.")) {
        return;
      }

      const response = await persistDeleteBucket(bucketId, activeBoardRequestOptions);
      if (response?.board) {
        applyBoardMutationResponse(response);
        const nextTaskId = getFirstTaskId(response.board.buckets);
        setSelectedTaskId(nextTaskId);
        setIsInspectorVisible(Boolean(nextTaskId));
        if (isRecycleBinOpen) {
          void refreshRecycleBin();
        }
      } else {
        reportMutationFailure(response, "Unable to delete the bucket.");
      }
      return;
    }

    const nextBoard = removeBucketFromBoard(board, bucketId);
    setBoard(nextBoard);
    const nextTaskId = getFirstTaskId(nextBoard.buckets);
    setSelectedTaskId(nextTaskId);
    setIsInspectorVisible(Boolean(nextTaskId));
  };

  const handleCreateTask = async (
    bucketId: string,
    title: string,
    workItemType: "task" | "maintenance_outage" = "task",
  ) => {
    const trimmedTitle = title.trim();

    if (!trimmedTitle) {
      return false;
    }

    const revealCreatedTask = (nextBoard: Board, taskId: string | null | undefined) => {
      if (taskSearchQuery.trim()) {
        setTaskSearchQuery("");
      }

      if (!taskId) {
        return;
      }

      const nextActiveView = nextBoard.views.find((view) => view.id === activeViewId) ?? nextBoard.views[0] ?? null;
      const viewContainsCreatedTask = hasTaskId(
        (nextActiveView ? applyViewPreset(nextBoard, nextActiveView) : nextBoard).buckets,
        taskId,
      );

      if (viewContainsCreatedTask && viewMode !== "focus") {
        return;
      }

      const boardViewId = getDefaultBoardViewId(nextBoard);
      if (boardViewId) {
        setActiveViewId(boardViewId);
      }
      setViewMode("board");
    };

    if (persistenceEnabled) {
      if (!requireEditableBoard("You can view this board, but you do not have permission to create tasks.")) {
        return false;
      }

      const response = await persistCreateTask(
        bucketId,
        trimmedTitle,
        activeBoardRequestOptions,
        workItemType,
      );
      if (response?.board) {
        revealCreatedTask(response.board, response.taskId);
        applyBoardMutationResponse(response);
        setMutationError("");
        if (response.taskId) {
          handleSelectTask(response.taskId);
        }
        return true;
      }
      setMutationError(response?.error ?? "Unable to create task.");
      return false;
    }

    const task = createClientTask(trimmedTitle, board.buckets.length);
    if (workItemType === "maintenance_outage") {
      task.workItemType = "maintenance_outage";
      task.maintenanceOutage = { owner: "", attendees: [] };
      task.startAt = undefined;
    }
    setBoard((current) => {
      const nextBoard = addTaskToBucket(current, bucketId, task);
      revealCreatedTask(nextBoard, task.id);
      return nextBoard;
    });
    handleSelectTask(task.id);
    return true;
  };

  const handleCreateMaintenanceLocation = async (name: string) => {
    if (!persistenceEnabled || !requireEditableBoard()) {
      return null;
    }
    const response = await persistCreateMaintenanceLocation(name, activeBoardRequestOptions);
    if (!response?.board || !response.locationId) {
      setMutationError("Unable to create maintenance location.");
      return null;
    }
    applyBoardMutationResponse(response);
    setMutationError("");
    return response.locationId;
  };

  const handleCreateFollowUpTask = async (sourceTaskId: string) => {
    const sourceTask = boardIndex.taskById.get(sourceTaskId) ?? null;
    if (!sourceTask?.importedFrom) {
      return;
    }

    const sourceBucketId = boardIndex.bucketIdByTaskId.get(sourceTaskId) ?? null;
    const targetBucketId =
      sourceBucketId && findBucketById(board.buckets, sourceBucketId)
        ? sourceBucketId
        : emptyStateNewTaskBucket?.id ?? null;

    if (!targetBucketId) {
      setMutationError("No visible bucket is available for a follow-up task.");
      return;
    }

    const followUpTitle = `Follow up: ${sourceTask.title}`;
    const followUpSummary = buildImportedFollowUpSummary(sourceTask, displayTimeZone);

    if (persistenceEnabled) {
      if (!requireEditableBoard("You can view this board, but you do not have permission to create tasks.")) {
        return;
      }

      try {
        const createResponse = await persistCreateTask(targetBucketId, followUpTitle, activeBoardRequestOptions);
        const createdTaskId = createResponse?.taskId ?? null;
        const createdTask = createdTaskId && createResponse?.board
          ? buildBoardIndex(createResponse.board.buckets).taskById.get(createdTaskId) ?? null
          : null;

        if (!createResponse?.board || !createdTaskId || !createdTask) {
          setMutationError("Unable to create follow-up task.");
          return;
        }

        const updateResponse = await persistUpdateTask(createdTaskId, {
          title: followUpTitle,
          summary: followUpSummary,
          nextAction: createdTask.nextAction ?? "",
          status: createdTask.status,
          startAt: createdTask.startAt ?? null,
          endAt: createdTask.endAt ?? null,
          dueAt: createdTask.dueAt ?? null,
          recurrence: createdTask.recurrence ?? null,
          labels: createdTask.labels,
          color: createdTask.color,
          icon: createdTask.icon,
          bucketId: targetBucketId,
        }, activeBoardRequestOptions);

        if (updateResponse?.board) {
          applyBoardMutationResponse(updateResponse);
          handleSelectTask(createdTaskId);
          setMutationError("");
          emitNotificationsRefresh();
          return;
        }

        applyBoardMutationResponse(createResponse);
        handleSelectTask(createdTaskId);
        reportMutationFailure(
          updateResponse,
          "The follow-up task was created, but its details could not be saved.",
        );
      } catch (error) {
        console.error("Failed to create follow-up task.", error);
        setMutationError("Unable to create follow-up task.");
      }
      return;
    }

    const task = {
      ...createClientTask(followUpTitle, board.buckets.length),
      summary: followUpSummary,
    };
    setBoard((current) => addTaskToBucket(current, targetBucketId, task));
    handleSelectTask(task.id);
  };

  // Editors send the whole task; keyboard and palette actions send only the
  // fields they change, which the API accepts.
  const handlePeopleRosterChanged = useCallback((taskId: string, attendees: string[]) => {
    setBoard(current => updateTaskInBoard(current, taskId, { maintenanceOutage: { attendees } }));
  }, []);

  const handleSaveTask = async (
    taskId: string,
    patch: TaskSavePatch,
    // A queued save sends with the board it was made on (see the save queue).
    requestOptions = activeBoardRequestOptions,
  ) => {
    // A save queued on a board the viewer has since left: this page's board,
    // permissions and task index describe the new board, so none of them
    // apply. Send it to its own board, where the server checks access, and
    // show nothing here.
    if (persistenceEnabled && requestOptions.boardId !== activeBoardRequestOptions.boardId) {
      try {
        return Boolean((await persistUpdateTask(taskId, patch, requestOptions))?.board);
      } catch (error) {
        console.error("Failed to save a task on a board that is no longer open.", error);
        return false;
      }
    }

    const taskBeforeSave = boardIndex.taskById.get(taskId) ?? null;
    const rootTaskId = boardIndex.rootTaskIdByTaskId.get(taskId) ?? null;
    if (taskBeforeSave && rootTaskId && rootTaskId !== taskId) {
      try { assertSubtaskPatch(patch); }
      catch (error) {
        setMutationError(error instanceof Error ? error.message : SUBTASK_RULE_MESSAGE);
        return false;
      }
    }
    const transitionsRootTaskToDone = Boolean(
      taskBeforeSave &&
        rootTaskId === taskId &&
        taskBeforeSave.status !== "done" &&
        patch.status === "done",
    );
    const transitionsSelectedRootTaskToDone = transitionsRootTaskToDone && selectedTaskId === taskId;
    // Finishing the last open subtask can finish a recurring top-level task,
    // which then moves to Archives like a direct completion.
    const rootTaskBeforeSave = rootTaskId ? boardIndex.taskById.get(rootTaskId) ?? null : null;
    const completesSubtask = Boolean(
      taskBeforeSave &&
        rootTaskId &&
        rootTaskId !== taskId &&
        taskBeforeSave.status !== "done" &&
        patch.status === "done",
    );
    const completedTaskTitle = patch.title ?? taskBeforeSave?.title ?? "Task";
    const retainedTaskAfterSave = transitionsSelectedRootTaskToDone
      ? buildBoardIndex(updateTaskInBoard(board, taskId, patch).buckets).taskById.get(taskId) ?? null
      : null;
    const retainedBucketId = boardIndex.bucketIdByTaskId.get(taskId) ?? null;

    if (persistenceEnabled) {
      if (!requireEditableBoard("You can view this board, but you do not have permission to edit tasks.")) {
        return false;
      }

      try {
        if (rootTaskId) {
          await waitForPendingRootTaskMove(rootTaskId);
        }
        const response = await persistUpdateTask(
          taskId,
          patch,
          requestOptions,
        );
        if (response?.board) {
          if (
            transitionsRootTaskToDone &&
            !buildBoardIndex(response.board.buckets).taskById.has(taskId)
          ) {
            if (transitionsSelectedRootTaskToDone && retainedTaskAfterSave) {
              setRetainedArchivedTask({
                task: retainedTaskAfterSave,
                bucketId: retainedBucketId,
              });
            }
            const previousStatus = taskBeforeSave?.status ?? "todo";
            showUndoToast(`Completed "${completedTaskTitle}" and moved it to Archives.`, async () => {
              try {
                // Restoring a done task reopens it as To do; put back its earlier status.
                const restored = await persistRestoreArchiveTask(taskId, requestOptions);
                let latest: BoardMutationResponse | null = restored;
                if (previousStatus !== "todo") {
                  latest = await persistUpdateTask(
                    taskId,
                    { ...patch, status: previousStatus, bucketId: undefined },
                    requestOptions,
                  );
                }
                setRetainedArchivedTask(null);
                applyBoardMutationResponse(latest?.board ? latest : restored);
                if (isArchivesOpen) {
                  setArchiveItems(restored.items ?? []);
                }
                if (transitionsSelectedRootTaskToDone) {
                  handleSelectTask(taskId);
                }
                setMutationError("");
              } catch (error) {
                setMutationError(error instanceof Error ? error.message : "Unable to undo the completion.");
              }
            });
          }
          if (
            completesSubtask &&
            rootTaskId &&
            !buildBoardIndex(response.board.buckets).taskById.has(rootTaskId)
          ) {
            const previousStatus = taskBeforeSave?.status ?? "todo";
            const rootPreviousStatus = rootTaskBeforeSave?.status ?? "todo";
            const rootTitle = rootTaskBeforeSave?.title ?? "Task";
            showUndoToast(`Completed "${completedTaskTitle}", which finished "${rootTitle}" and moved it to Archives.`, async () => {
              try {
                // Bring back the finished task, then reopen the subtask and the
                // status the task had before its work finished it.
                // Each step is its own request, so a failure after the restore
                // is reported as a partial undo instead of being hidden.
                const restored = await persistRestoreArchiveTask(rootTaskId, activeBoardRequestOptions);
                if (isArchivesOpen) {
                  setArchiveItems(restored.items ?? []);
                }
                const reopened = await persistUpdateTask(taskId, { status: previousStatus }, activeBoardRequestOptions);
                if (!reopened?.board) {
                  applyBoardMutationResponse(restored);
                  reportMutationFailure(reopened, `Restored "${rootTitle}", but "${completedTaskTitle}" is still done.`);
                  return;
                }
                if (rootPreviousStatus !== "todo") {
                  const rootReset = await persistUpdateTask(rootTaskId, { status: rootPreviousStatus }, activeBoardRequestOptions);
                  if (!rootReset?.board) {
                    applyBoardMutationResponse(reopened);
                    reportMutationFailure(rootReset, `Restored "${rootTitle}", but could not put back its earlier status.`);
                    return;
                  }
                  applyBoardMutationResponse(rootReset);
                } else {
                  applyBoardMutationResponse(reopened);
                }
                setMutationError("");
              } catch (error) {
                setMutationError(error instanceof Error ? error.message : "Unable to undo the completion.");
              }
            });
          }
          applyBoardMutationResponse(response);
          if (isArchivesOpen) {
            setArchiveItems(response.archives ?? []);
          }
          setMutationError("");
          emitNotificationsRefresh();
          return true;
        }
        reportMutationFailure(response, "Unable to save task details.");
        return false;
      } catch (error) {
        console.error("Failed to save task.", error);
        setMutationError("Unable to save task details.");
        return false;
      }
    }

    // Without a database, done tasks also stay where they are.
    try { setBoard(updateTaskInBoard(board, taskId, patch)); return true; }
    catch (error) { setMutationError(error instanceof Error ? error.message : "Unable to update attendees."); return false; }
  };


  // Read when a removal finishes, so a task opened or an inspector closed
  // while the request ran is respected.
  const readSelectionSnapshot = useStableCallback(() => ({
    board,
    current: { selectedTaskId, isInspectorVisible },
    retainedTaskId: retainedArchivedTask?.task.id ?? null,
  }));

  const applySelectionAfterTaskRemoval = (buckets: Bucket[], fallbackTaskId: string | null) => {
    const { current, retainedTaskId } = readSelectionSnapshot();
    const next = getSelectionAfterTaskRemoval({
      current,
      retainedTaskId,
      hasTask: (id) => hasTaskId(buckets, id),
      fallbackTaskId,
      firstTaskId: getFirstTaskId(buckets),
    });
    setSelectedTaskId(next.selectedTaskId);
    setIsInspectorVisible(next.isInspectorVisible);
  };

  // A response for a board that is no longer open changes nothing here. One
  // a newer live revision overtook is judged against the board now shown.
  const updateSelectionAfterTaskRemoval = (
    response: BoardMutationResponse,
    applied: boolean,
    fallbackTaskId: string | null,
  ) => {
    const shownBoard = readSelectionSnapshot().board;
    if (!response.board || response.board.id !== shownBoardRevisionRef.current.id) {
      return;
    }
    applySelectionAfterTaskRemoval(applied ? response.board.buckets : shownBoard.buckets, fallbackTaskId);
  };

  const handleDeleteTask = async (taskId: string) => {
    if (persistenceEnabled && !requireLifecycleBoard("Only a team manager can delete tasks on this board.")) {
      return;
    }
    const parentTaskId = boardIndex.parentByTaskId.get(taskId) ?? null;
    const deletedTask = boardIndex.taskById.get(taskId) ?? null;
    const deletedTaskTitle = deletedTask?.title ?? "Task";
    const neighborTaskId = parentTaskId ? null : getNeighborRootTaskId(board.buckets, taskId);

    // A subtask with work under it asks first, from the list or the board.
    if (parentTaskId && deletedTask && deletedTask.subtasks.length > 0) {
      const { total } = getSubtaskStats(deletedTask);
      if (
        !(await confirm({
          title: `Delete "${deletedTaskTitle}" and its ${total} subtask${total === 1 ? "" : "s"}?`,
          body: persistenceEnabled ? "They move to the Recycle Bin, and Undo brings them back." : "This cannot be undone.",
          confirmLabel: "Delete",
          tone: "danger",
        }))
      ) {
        return;
      }
    }

    if (persistenceEnabled) {
      if (!requireEditableBoard("You can view this board, but you do not have permission to delete tasks.")) {
        return;
      }

      const response = await persistDeleteTask(taskId, activeBoardRequestOptions);
      if (response?.board) {
        updateSelectionAfterTaskRemoval(response, applyBoardMutationResponse(response), parentTaskId ?? neighborTaskId);
        if (isRecycleBinOpen) {
          void refreshRecycleBin();
        }
        emitNotificationsRefresh();
        // Deleted tasks and subtasks go to the Recycle Bin, so they can be
        // restored. Undo on a subtask leaves the current task open.
        if (parentTaskId) {
          showUndoToast(`Deleted "${deletedTaskTitle}".`, async () => {
            try {
              const restored = await persistRestoreRecycleBinTask(taskId, activeBoardRequestOptions);
              applyBoardMutationResponse(restored);
              // Keep the bin current even if it was opened after the delete.
              if (restored.recycleBin) {
                setRecycleBinItems(restored.recycleBin);
              }
              setMutationError("");
            } catch (error) {
              setMutationError(error instanceof Error ? error.message : "Unable to restore the subtask.");
            }
          });
        } else {
          showUndoToast(`Moved "${deletedTaskTitle}" to the Recycle Bin.`, async () => {
            try {
              const restored = await persistRestoreRecycleBinTask(taskId, activeBoardRequestOptions);
              applyBoardMutationResponse(restored);
              // Keep the bin current even if it was opened after the delete.
              if (restored.recycleBin) {
                setRecycleBinItems(restored.recycleBin);
              }
              handleSelectTask(taskId);
              setMutationError("");
            } catch (error) {
              setMutationError(error instanceof Error ? error.message : "Unable to restore the task.");
            }
          });
        }
      } else {
        reportMutationFailure(response, "Unable to delete the task.");
      }
      return;
    }

    const removed = removeTaskFromBoard(board, taskId);
    const nextBoard = parentTaskId
      ? {
          ...removed,
          buckets: removed.buckets.map((bucket) => ({
            ...bucket,
            tasks: reconcileParentCompletion(bucket.tasks, [parentTaskId], { holdRecurringRoot: true }),
          })),
        }
      : removed;
    setBoard(nextBoard);
    applySelectionAfterTaskRemoval(nextBoard.buckets, parentTaskId ?? neighborTaskId);
  };

  // Restoring from Archives reopens a task as To do; an undo puts back the
  // status it had, such as Done.
  const restoreArchivedTaskWithStatus = async (taskId: string, status: TaskStatus) => {
    const restored = await persistRestoreArchiveTask(taskId, activeBoardRequestOptions);
    if (status === "todo") {
      return restored;
    }
    const updated = await persistUpdateTask(taskId, { status }, activeBoardRequestOptions);
    return updated?.board ? { ...restored, board: updated.board } : restored;
  };

  // Archives the given done tasks from the Archives dialog's Done tab.
  const handleArchiveDoneTasks = async (taskIds: string[]) => {
    if (!persistenceEnabled || taskIds.length === 0) {
      return;
    }
    if (!requireEditableBoard("You can view this board, but you do not have permission to archive tasks.")) {
      return;
    }
    if (!requireLifecycleBoard("Only a team manager can archive tasks on this board.")) {
      return;
    }

    const firstTitle = boardIndex.taskById.get(taskIds[0])?.title ?? "Task";
    const archived: string[] = [];
    let latest: BoardMutationResponse | null = null;
    setArchiveBusyTaskId(taskIds.length === 1 ? taskIds[0] : "all-done");
    setArchivesError("");
    setArchivesInfo("");

    try {
      for (const taskId of taskIds) {
        await waitForPendingRootTaskMove(taskId);
        const response = await persistArchiveTask(taskId, activeBoardRequestOptions);
        if (response?.board) {
          latest = response;
          archived.push(taskId);
        }
      }
    } catch (error) {
      console.error("Failed to archive done tasks.", error);
      setArchivesError(error instanceof Error ? error.message : "Unable to archive done tasks.");
    } finally {
      if (latest) {
        applyBoardMutationResponse(latest);
        setArchiveItems(latest.archives ?? []);
        if (selectedTaskId && archived.includes(selectedTaskId)) {
          setSelectedTaskId(null);
          setIsInspectorVisible(false);
        }
        emitNotificationsRefresh();
      }
      setArchiveBusyTaskId(null);
    }

    if (archived.length === 0) {
      return;
    }
    const message = archived.length === 1 ? `Archived "${firstTitle}".` : `Archived ${archived.length} done tasks.`;
    setArchivesInfo(message);
    showUndoToast(message, async () => {
      try {
        let restored: Awaited<ReturnType<typeof restoreArchivedTaskWithStatus>> | null = null;
        for (const taskId of archived) {
          restored = await restoreArchivedTaskWithStatus(taskId, "done");
        }
        if (restored) {
          applyBoardMutationResponse(restored);
          setArchiveItems(restored.items ?? []);
        }
        setMutationError("");
      } catch (error) {
        setMutationError(error instanceof Error ? error.message : "Unable to undo the archive.");
      }
    });
  };

  const handleArchiveTask = async (taskId: string) => {
    const rootTaskId = boardIndex.rootTaskIdByTaskId.get(taskId) ?? taskId;
    const archivedTaskTitle = boardIndex.taskById.get(rootTaskId)?.title ?? "Task";
    const archivedTaskStatus = boardIndex.taskById.get(rootTaskId)?.status ?? "todo";
    const neighborTaskId = getNeighborRootTaskId(board.buckets, rootTaskId);

    if (persistenceEnabled) {
      if (!requireEditableBoard("You can view this board, but you do not have permission to archive tasks.")) {
        return;
      }
      if (!requireLifecycleBoard("Only a team manager can archive tasks on this board.")) {
        return;
      }

      try {
        await waitForPendingRootTaskMove(rootTaskId);
        const response = await persistArchiveTask(taskId, activeBoardRequestOptions);
        if (response?.board) {
          updateSelectionAfterTaskRemoval(response, applyBoardMutationResponse(response), neighborTaskId);
          if (isArchivesOpen) {
            setArchiveItems(response.archives ?? []);
          }
          setMutationError("");
          emitNotificationsRefresh();
          showUndoToast(`Archived "${archivedTaskTitle}".`, async () => {
            try {
              const restored = await restoreArchivedTaskWithStatus(rootTaskId, archivedTaskStatus);
              applyBoardMutationResponse(restored);
              if (isArchivesOpen) {
                setArchiveItems(restored.items ?? []);
              }
              handleSelectTask(rootTaskId);
              setMutationError("");
            } catch (error) {
              setMutationError(error instanceof Error ? error.message : "Unable to restore the task.");
            }
          });
        }
      } catch (error) {
        console.error("Failed to archive task.", error);
        const message = error instanceof Error ? error.message : "Unable to archive task.";
        setMutationError(message);
      }
      return;
    }

    const nextBoard = removeTaskFromBoard(board, rootTaskId);
    setBoard(nextBoard);
    applySelectionAfterTaskRemoval(nextBoard.buckets, neighborTaskId);
  };

  const handleConvertImportedTask = async (taskId: string) => {
    if (persistenceEnabled) {
      if (!requireEditableBoard("You can view this board, but you do not have permission to convert imported items.")) {
        return;
      }

      try {
        const rootTaskId = boardIndex.rootTaskIdByTaskId.get(taskId) ?? null;
        if (rootTaskId) {
          await waitForPendingRootTaskMove(rootTaskId);
        }
        const response = await persistConvertImportedTask(
          taskId,
          boardIndex.bucketIdByTaskId.get(taskId) ?? null,
          activeBoardRequestOptions,
        );
        if (response?.board) {
          applyBoardMutationResponse(response);
          setMutationError("");
          emitNotificationsRefresh();
        } else {
          reportMutationFailure(response, "Unable to convert the imported item into a task.");
        }
      } catch (error) {
        console.error("Failed to convert imported task.", error);
        setMutationError("Unable to convert the imported item into a task.");
      }
      return;
    }

    setBoard((current) => convertImportedTaskInBoard(current, taskId));
  };

  const handleAddSubtask = async (taskId: string, title: string) => {
    if (persistenceEnabled) {
      if (!requireEditableBoard("You can view this board, but you do not have permission to add subtasks.")) {
        return;
      }

      try {
        const rootTaskId = boardIndex.rootTaskIdByTaskId.get(taskId) ?? null;
        if (rootTaskId) {
          await waitForPendingRootTaskMove(rootTaskId);
        }
        const response = await persistCreateSubtask(taskId, title, activeBoardRequestOptions);
        if (response?.board) {
          applyBoardMutationResponse(response);
          setMutationError("");
        } else {
          reportMutationFailure(response, "Unable to add subtask.");
        }
      } catch (error) {
        console.error("Failed to add subtask.", error);
        setMutationError("Unable to add subtask.");
      }
      return;
    }

    const subtask = createClientSubtask(title);
    setBoard((current) => addSubtaskToBoard(current, taskId, subtask));
  };

  // Moves a subtask within its task (Tab, Shift+Tab, or a drag in the
  // workspace). The board shows the move at once and goes back if the server
  // refuses it. Drags offer Undo; Tab and Shift+Tab undo each other.
  const handleMoveSubtask = async (move: SubtaskMove, options: { announce?: boolean } = {}) => {
    const rootTaskId = boardIndex.rootTaskIdByTaskId.get(move.taskId) ?? null;
    const root = rootTaskId ? boardIndex.taskById.get(rootTaskId) ?? null : null;
    if (!rootTaskId || !root || rootTaskId === move.taskId || isNoOpMove(root, move)) {
      return;
    }

    const undoMove = getCurrentPlacement(root, move.taskId);
    const movedTitle = boardIndex.taskById.get(move.taskId)?.title ?? "Subtask";
    const parentTitle = boardIndex.taskById.get(move.parentTaskId)?.title ?? "the task";
    const applyMove = (current: Board): Board => ({
      ...current,
      buckets: current.buckets.map((bucket) => ({
        ...bucket,
        tasks: bucket.tasks.map((candidate) => (candidate.id === rootTaskId ? applySubtaskMove(candidate, move) : candidate)),
      })),
    });

    if (!persistenceEnabled) {
      const parentIds = [move.parentTaskId, undoMove?.parentTaskId ?? move.parentTaskId];
      setBoard((current) => {
        const moved = applyMove(current);
        return {
          ...moved,
          buckets: moved.buckets.map((bucket) => ({ ...bucket, tasks: reconcileParentCompletion(bucket.tasks, parentIds) })),
        };
      });
      return;
    }
    if (!requireEditableBoard("You can view this board, but you do not have permission to move subtasks.")) {
      return;
    }

    const boardBeforeMove = board;
    setBoard(applyMove);
    try {
      await waitForPendingRootTaskMove(rootTaskId);
      const response = await persistMoveSubtask(move, activeBoardRequestOptions);
      if (!response?.board) {
        setBoard(boardBeforeMove);
        reportMutationFailure(response, "Unable to move subtask.");
        return;
      }
      applyBoardMutationResponse(response);
      setMutationError("");
      if (options.announce && undoMove) {
        // Moves keep times as they are, so the toast says when the saved move
        // left the item outside its new window.
        const savedRoot = response.board.buckets.flatMap((bucket) => bucket.tasks).find((candidate) => candidate.id === rootTaskId);
        const outside = savedRoot ? getOutsideWindow(savedRoot, move.taskId) : null;
        const moved = undoMove.parentTaskId === move.parentTaskId
          ? `Moved "${movedTitle}".`
          : `Moved "${movedTitle}" into "${parentTitle}".`;
        // Sent as is: this toast outlives the board state it was made from.
        showUndoToast(outside ? `${moved} Its time is outside "${outside.title}".` : moved, async () => {
          try {
            const restored = await persistMoveSubtask(undoMove, activeBoardRequestOptions);
            if (restored?.board) {
              applyBoardMutationResponse(restored);
              setMutationError("");
            } else {
              reportMutationFailure(restored, "Unable to undo the move.");
            }
          } catch (error) {
            setMutationError(error instanceof Error ? error.message : "Unable to undo the move.");
          }
        });
      }
    } catch (error) {
      console.error("Failed to move subtask.", error);
      setBoard(boardBeforeMove);
      setMutationError(error instanceof Error ? error.message : "Unable to move subtask.");
    }
  };

  const handleLogout = async () => {
    await disconnectPushOnLogout().catch(() => {});
    if (externalAuthOnly) {
      if (externalAccountActions.logoutUrl) {
        window.location.assign(externalAccountActions.logoutUrl);
      }
      return;
    }

    await fetch("/api/auth/logout", { method: "POST" });
    window.location.assign("/login");
  };

  const handleSelectView = (view: ViewPreset) => {
    setActiveViewId(view.id);
    setViewMode(view.layoutMode === "list" ? "board" : view.layoutMode);
  };

  const handleSelectAccessibleBoard = async (accessibleBoard: AccessibleBoardSummary) => {
    setIsBoardSwitcherOpen(false);

    if (accessibleBoard.boardId === currentBoardId) {
      return;
    }

    if (isCalendarWorkspace) {
      if (phoneViewport.isPhone && isOutageCalendarView) {
        const target = new URL(`/calendar?boardId=${encodeURIComponent(accessibleBoard.boardId)}&view=outages`, window.location.href);
        window.location.assign(target);
        return;
      }
      window.location.assign(`/calendar?boardId=${encodeURIComponent(accessibleBoard.boardId)}`);
      return;
    }

    if (isNotesWorkspace) {
      window.location.assign(buildNotesHref({ boardId: accessibleBoard.boardId }));
      return;
    }

    setMutationError("");
    const response = await persistLoadBoard(accessibleBoard.boardId);

    if (!response?.board || !response.boardAccess) {
      setMutationError("Unable to load the selected board.");
      return;
    }

    shownBoardRevisionRef.current = { id: response.board.id, revision: response.board.revision };
    setBoard(response.board);
    setBoardAccess(response.boardAccess);
    setCurrentBoardId(response.board.id);
    if (persistenceEnabled) {
      void persistSelectedBoardPreference(
        response.board.id === personalBoardId ? null : response.board.id,
      );
    }
    setSelectedTaskId(null);
    setCalendarArrivalTaskId(null);
    setIsCalendarArrivalNoticeVisible(false);
    setActiveTaskId(null);
    setHoveredBucketId(null);
    setActiveBucketDragId(null);
    setIsInspectorVisible(false);
    setActiveViewId(response.board.views[0]?.id ?? "view-board");
    setRecycleBinItems([]);
    setArchiveItems([]);
    setIsRecycleBinOpen(false);
    setIsArchivesOpen(false);
    setIsImportOpen(false);
    setIsBoardSettingsOpen(false);
    setBoardPrivacySettings(null);
    setBoardPrivacyDraft(null);
    setBoardPrivacyMessage(null);
    setBoardShareMembers([]);
    setBoardShareCandidates([]);
    setBoardShareSearch("");
    setBoardShareCandidateId("");
    setBoardShareRole("viewer");
    setBoardShareMessage(null);
  };

  useEffect(() => {
    if (!isBoardSwitcherOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      if (boardSwitcherRef.current?.contains(target)) {
        return;
      }

      setIsBoardSwitcherOpen(false);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsBoardSwitcherOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isBoardSwitcherOpen]);

  // Escape closes the sharing dialog, as it does every other dialog.
  useEffect(() => {
    if (!isBoardSettingsOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        event.preventDefault();
        setIsBoardSettingsOpen(false);
      }
    };

    // Capture phase, so the sidebar behind the dialog stays open.
    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, [isBoardSettingsOpen]);

  const handleOpenBoardSettings = async () => {
    if (!canOpenBoardSettings) {
      return;
    }

    setIsBoardSettingsOpen(true);
    setIsBoardPrivacyLoading(true);
    setIsBoardShareLoading(true);
    setBoardPrivacyMessage(null);
    setBoardShareMessage(null);
    setBoardShareCandidates([]);
    setBoardShareSearch("");
    setBoardShareCandidateId("");

    try {
      const [settingsResponse, membersResponse] = await Promise.all([
        persistLoadBoardPrivacySettings(currentBoardId),
        persistLoadPersonalBoardMembers(currentBoardId),
      ]);
      setBoardPrivacySettings(settingsResponse);
      setBoardPrivacyDraft({
        personalVisibility: settingsResponse.board.personalVisibility,
        personalVisibilityTeamId: settingsResponse.board.personalVisibilityTeamId,
      });
      setBoardShareMembers(membersResponse.members);
    } catch (error) {
      console.error("Failed to load board settings.", error);
      setBoardPrivacyMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Unable to load board settings.",
      });
    } finally {
      setIsBoardPrivacyLoading(false);
      setIsBoardShareLoading(false);
    }
  };

  const handleSaveBoardPrivacySettings = async () => {
    if (!boardPrivacyDraft) {
      return;
    }

    setIsBoardPrivacySaving(true);
    setBoardPrivacyMessage(null);

    try {
      const result = await persistUpdateBoardPrivacySettings(currentBoardId, {
        personalVisibility: boardPrivacyDraft.personalVisibility,
        personalVisibilityTeamId:
          boardPrivacyDraft.personalVisibility === "private"
            ? null
            : boardPrivacyDraft.personalVisibilityTeamId,
      });
      setBoardPrivacySettings(result.settings);
      setBoardPrivacyDraft({
        personalVisibility: result.settings.board.personalVisibility,
        personalVisibilityTeamId: result.settings.board.personalVisibilityTeamId,
      });
      setBoardPrivacyMessage({
        tone: "success",
        text: result.changed ? "Board visibility saved." : "Board visibility was already up to date.",
      });
    } catch (error) {
      console.error("Failed to save board settings.", error);
      setBoardPrivacyMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Unable to save board settings.",
      });
    } finally {
      setIsBoardPrivacySaving(false);
    }
  };

  const handleSearchBoardShareCandidates = async () => {
    const query = boardShareSearch.trim();

    if (query.length < 2) {
      setBoardShareCandidates([]);
      setBoardShareCandidateId("");
      setBoardShareMessage({
        tone: "error",
        text: "Search requires at least 2 characters.",
      });
      return;
    }

    setIsBoardShareSearching(true);
    setBoardShareMessage(null);

    try {
      const candidates = await persistSearchPersonalBoardMemberCandidates(
        currentBoardId,
        query,
      );
      setBoardShareCandidates(candidates);
      setBoardShareCandidateId(candidates[0]?.id ?? "");
      setBoardShareMessage(
        candidates.length === 0
          ? { tone: "success", text: "No matching addable users found." }
          : null,
      );
    } catch (error) {
      console.error("Failed to search board share candidates.", error);
      setBoardShareCandidates([]);
      setBoardShareCandidateId("");
      setBoardShareMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Unable to search users.",
      });
    } finally {
      setIsBoardShareSearching(false);
    }
  };

  const handleAddBoardShareMember = async () => {
    if (!boardShareCandidateId) {
      setBoardShareMessage({
        tone: "error",
        text: "Select a user to share with.",
      });
      return;
    }

    setIsBoardShareSaving(true);
    setBoardShareMessage(null);

    try {
      const member = await persistAddPersonalBoardMember(currentBoardId, {
        userId: boardShareCandidateId,
        role: boardShareRole,
      });
      setBoardShareMembers((current) => [...current, member]);
      setBoardShareCandidates((current) =>
        current.filter((candidate) => candidate.id !== boardShareCandidateId),
      );
      setBoardShareCandidateId("");
      setBoardShareSearch("");
      setBoardShareMessage({
        tone: "success",
        text: "Board share added.",
      });
    } catch (error) {
      console.error("Failed to add board share.", error);
      setBoardShareMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Unable to add board share.",
      });
    } finally {
      setIsBoardShareSaving(false);
    }
  };

  const handleUpdateBoardShareMember = async (
    userId: string,
    role: PersonalBoardShareRole,
  ) => {
    setIsBoardShareSaving(true);
    setBoardShareMessage(null);

    try {
      const member = await persistUpdatePersonalBoardMember(currentBoardId, userId, {
        role,
      });
      setBoardShareMembers((current) =>
        current.map((item) => (item.userId === userId ? member : item)),
      );
      setBoardShareMessage({
        tone: "success",
        text: "Board share updated.",
      });
    } catch (error) {
      console.error("Failed to update board share.", error);
      setBoardShareMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Unable to update board share.",
      });
    } finally {
      setIsBoardShareSaving(false);
    }
  };

  const handleRemoveBoardShareMember = async (userId: string) => {
    setIsBoardShareSaving(true);
    setBoardShareMessage(null);

    try {
      await persistRemovePersonalBoardMember(currentBoardId, userId);
      setBoardShareMembers((current) => current.filter((member) => member.userId !== userId));
      setBoardShareMessage({
        tone: "success",
        text: "Board share removed.",
      });
    } catch (error) {
      console.error("Failed to remove board share.", error);
      setBoardShareMessage({
        tone: "error",
        text: error instanceof Error ? error.message : "Unable to remove board share.",
      });
    } finally {
      setIsBoardShareSaving(false);
    }
  };

  const handleCreateView = async () => {
    if (!requireEditableBoard()) {
      return;
    }

    const response = await persistCreateView({
      name: "Filtered view",
      layoutMode: viewMode,
      filters: buildCurrentViewFilters(board, activeView),
    }, activeBoardRequestOptions);

    if (response?.board) {
      applyBoardMutationResponse(response);
      if (response.viewId) {
        setActiveViewId(response.viewId);
      }
      setIsViewSettingsOpen(true);
      setMutationError("");
      return;
    }

    setMutationError("Unable to create saved view.");
  };

  const handleDeleteActiveView = async () => {
    if (!requireEditableBoard()) {
      return;
    }

    if (!activeView || board.views.length <= 1) {
      setMutationError("Keep at least one saved view.");
      return;
    }

    const response = await persistDeleteView(activeView.id, activeBoardRequestOptions);

    if (response?.board) {
      applyBoardMutationResponse(response);
      setActiveViewId(response.board.views[0]?.id ?? "view-board");
      setMutationError("");
      return;
    }

    setMutationError("Unable to delete saved view.");
  };

  const handleUpdateActiveView = async (patch: {
    name: string;
    layoutMode: ViewLayoutMode;
    filters: ViewFilters;
  }) => {
    if (!requireEditableBoard()) {
      return;
    }

    if (!activeView) {
      setMutationError("Select a saved view first.");
      return;
    }

    if (persistenceEnabled) {
      const response = await persistUpdateView(activeView.id, patch, activeBoardRequestOptions);

      if (response?.board) {
        applyBoardMutationResponse(response);
        setActiveViewId(activeView.id);
        setViewMode(patch.layoutMode === "list" ? "board" : patch.layoutMode);
        setIsViewSettingsOpen(false);
        setMutationError("");
        return;
      }

      setMutationError("Unable to update saved view.");
      return;
    }

    setBoard((current) => ({
      ...current,
      views: current.views.map((view) =>
        view.id === activeView.id
          ? {
              ...view,
              name: patch.name,
              layoutMode: patch.layoutMode,
              filters: patch.filters,
            }
          : view,
      ),
    }));
    setViewMode(patch.layoutMode === "list" ? "board" : patch.layoutMode);
    setIsViewSettingsOpen(false);
    setMutationError("");
  };

  const handleChecklistAdd = async (taskId: string, label: string) => {
    if (persistenceEnabled) {
      if (!requireEditableBoard("You can view this board, but you do not have permission to edit checklists.")) {
        return;
      }

      try {
        const rootTaskId = boardIndex.rootTaskIdByTaskId.get(taskId) ?? null;
        if (rootTaskId) {
          await waitForPendingRootTaskMove(rootTaskId);
        }
        const response = await persistCreateChecklistItem(taskId, label, activeBoardRequestOptions);
        if (response?.board) {
          applyBoardMutationResponse(response);
          setMutationError("");
        } else {
          reportMutationFailure(response, "Unable to add checklist item.");
        }
      } catch (error) {
        console.error("Failed to add checklist item.", error);
        setMutationError("Unable to add checklist item.");
      }
      return;
    }

    setBoard((current) => addChecklistItemToBoard(current, taskId, label));
  };

  const handleChecklistUpdate = async (
    itemId: string,
    patch: {
      label?: string;
      done?: boolean;
    },
  ) => {
    if (persistenceEnabled) {
      if (!requireEditableBoard("You can view this board, but you do not have permission to edit checklists.")) {
        return;
      }

      try {
        const rootTaskId = boardIndex.rootTaskIdByChecklistItemId.get(itemId) ?? null;
        if (rootTaskId) {
          await waitForPendingRootTaskMove(rootTaskId);
        }
        const response = await persistUpdateChecklistItem(itemId, patch, activeBoardRequestOptions);
        if (response?.board) {
          applyBoardMutationResponse(response);
          setMutationError("");
        } else {
          reportMutationFailure(response, "Unable to update checklist item.");
        }
      } catch (error) {
        console.error("Failed to update checklist item.", error);
        setMutationError("Unable to update checklist item.");
      }
      return;
    }

    setBoard((current) => updateChecklistItemInBoard(current, itemId, patch));
  };

  const handleChecklistDelete = async (itemId: string) => {
    if (persistenceEnabled) {
      if (!requireEditableBoard("You can view this board, but you do not have permission to edit checklists.")) {
        return;
      }

      try {
        const rootTaskId = boardIndex.rootTaskIdByChecklistItemId.get(itemId) ?? null;
        if (rootTaskId) {
          await waitForPendingRootTaskMove(rootTaskId);
        }
        const response = await persistDeleteChecklistItem(itemId, activeBoardRequestOptions);
        if (response?.board) {
          applyBoardMutationResponse(response);
          setMutationError("");
        } else {
          reportMutationFailure(response, "Unable to delete checklist item.");
        }
      } catch (error) {
        console.error("Failed to delete checklist item.", error);
        setMutationError("Unable to delete checklist item.");
      }
      return;
    }

    setBoard((current) => deleteChecklistItemFromBoard(current, itemId));
  };

  const handleUploadAttachments = async (taskId: string, files: File[]) => {
    if (!persistenceEnabled) {
      setMutationError("Attachments require database-backed persistence.");
      return;
    }

    if (!requireEditableBoard("You can view this board, but you do not have permission to upload attachments.")) {
      return;
    }

    try {
      const rootTaskId = boardIndex.rootTaskIdByTaskId.get(taskId) ?? null;
      if (rootTaskId) {
        await waitForPendingRootTaskMove(rootTaskId);
      }
      const response = await persistUploadTaskAttachments(taskId, files, activeBoardRequestOptions);
      if (response?.board) {
        applyBoardMutationResponse(response);
        setMutationError("");
      }
    } catch (error) {
      console.error("Failed to upload attachments.", error);
      const message = error instanceof Error ? error.message : "Unable to upload attachments.";
      setMutationError(message);
      throw error instanceof Error ? error : new Error(message);
    }
  };

  const handleDeleteAttachment = async (taskId: string, attachmentId: string) => {
    if (!persistenceEnabled) {
      setMutationError("Attachments require database-backed persistence.");
      return;
    }

    if (!requireEditableBoard("You can view this board, but you do not have permission to delete attachments.")) {
      return;
    }

    try {
      const rootTaskId = boardIndex.rootTaskIdByTaskId.get(taskId) ?? null;
      if (rootTaskId) {
        await waitForPendingRootTaskMove(rootTaskId);
      }
      const response = await persistDeleteTaskAttachment(taskId, attachmentId, activeBoardRequestOptions);
      if (response?.board) {
        applyBoardMutationResponse(response);
        setMutationError("");
      }
    } catch (error) {
      console.error("Failed to delete attachment.", error);
      const message = error instanceof Error ? error.message : "Unable to delete attachment.";
      setMutationError(message);
      throw error instanceof Error ? error : new Error(message);
    }
  };

  const handleRenameAttachment = async (
    taskId: string,
    attachmentId: string,
    displayName: string,
  ) => {
    if (!persistenceEnabled) {
      setMutationError("Attachments require database-backed persistence.");
      return;
    }

    if (!requireEditableBoard("You can view this board, but you do not have permission to rename attachments.")) {
      return;
    }

    try {
      const rootTaskId = boardIndex.rootTaskIdByTaskId.get(taskId) ?? null;
      if (rootTaskId) {
        await waitForPendingRootTaskMove(rootTaskId);
      }
      const response = await persistRenameTaskAttachment(taskId, attachmentId, displayName, activeBoardRequestOptions);
      if (response?.board) {
        applyBoardMutationResponse(response);
        setMutationError("");
      }
    } catch (error) {
      console.error("Failed to rename attachment.", error);
      const message = error instanceof Error ? error.message : "Unable to rename attachment.";
      setMutationError(message);
      throw error instanceof Error ? error : new Error(message);
    }
  };

  const handleCreateNote = async (taskId: string, body: string) => {
    if (!persistenceEnabled) {
      const note = createClientTaskNote(body, currentUser.displayName);
      setBoard((current) => addTaskNoteToBoard(current, taskId, note));
      setMutationError("");
      return;
    }

    try {
      const rootTaskId = boardIndex.rootTaskIdByTaskId.get(taskId) ?? null;
      if (rootTaskId) {
        await waitForPendingRootTaskMove(rootTaskId);
      }
      if (!requireEditableBoard("You can view this board, but you do not have permission to edit notes.")) {
        return;
      }

      const response = await persistCreateTaskNote(taskId, body, activeBoardRequestOptions);
      if (response?.board) {
        applyBoardMutationResponse(response);
        setMutationError("");
      }
    } catch (error) {
      console.error("Failed to create note.", error);
      const message = error instanceof Error ? error.message : "Unable to create note.";
      setMutationError(message);
      throw error instanceof Error ? error : new Error(message);
    }
  };

  const handleUpdateNote = async (taskId: string, noteId: string, body: string) => {
    if (!persistenceEnabled) {
      setBoard((current) =>
        updateTaskNoteInBoard(current, taskId, noteId, body, currentUser.displayName),
      );
      setMutationError("");
      return;
    }

    try {
      const rootTaskId = boardIndex.rootTaskIdByTaskId.get(taskId) ?? null;
      if (rootTaskId) {
        await waitForPendingRootTaskMove(rootTaskId);
      }
      if (!requireEditableBoard("You can view this board, but you do not have permission to edit notes.")) {
        return;
      }

      const response = await persistUpdateTaskNote(taskId, noteId, body, activeBoardRequestOptions);
      if (response?.board) {
        applyBoardMutationResponse(response);
        setMutationError("");
      }
    } catch (error) {
      console.error("Failed to update note.", error);
      const message = error instanceof Error ? error.message : "Unable to update note.";
      setMutationError(message);
      throw error instanceof Error ? error : new Error(message);
    }
  };

  const handleDeleteNote = async (taskId: string, noteId: string) => {
    if (!persistenceEnabled) {
      setBoard((current) => deleteTaskNoteFromBoard(current, taskId, noteId));
      setMutationError("");
      return;
    }

    try {
      const rootTaskId = boardIndex.rootTaskIdByTaskId.get(taskId) ?? null;
      if (rootTaskId) {
        await waitForPendingRootTaskMove(rootTaskId);
      }
      if (!requireEditableBoard("You can view this board, but you do not have permission to edit notes.")) {
        return;
      }

      const response = await persistDeleteTaskNote(taskId, noteId, activeBoardRequestOptions);
      if (response?.board) {
        applyBoardMutationResponse(response);
        setMutationError("");
      }
    } catch (error) {
      console.error("Failed to delete note.", error);
      const message = error instanceof Error ? error.message : "Unable to delete note.";
      setMutationError(message);
      throw error instanceof Error ? error : new Error(message);
    }
  };

  const handleUploadNoteAttachments = async (
    taskId: string,
    noteId: string,
    files: File[],
  ) => {
    if (!persistenceEnabled) {
      setMutationError("Attachments require database-backed persistence.");
      return;
    }

    if (!requireEditableBoard("You can view this board, but you do not have permission to upload attachments.")) {
      return;
    }

    try {
      const rootTaskId = boardIndex.rootTaskIdByTaskId.get(taskId) ?? null;
      if (rootTaskId) {
        await waitForPendingRootTaskMove(rootTaskId);
      }
      const response = await persistUploadTaskNoteAttachments(taskId, noteId, files, activeBoardRequestOptions);
      if (response?.board) {
        applyBoardMutationResponse(response);
        setMutationError("");
      }
    } catch (error) {
      console.error("Failed to upload note attachments.", error);
      const message = error instanceof Error ? error.message : "Unable to upload note attachments.";
      setMutationError(message);
      throw error instanceof Error ? error : new Error(message);
    }
  };

  const waitForPendingRootTaskMove = async (rootTaskId: string) => {
    const pendingMove = pendingRootTaskMoveRef.current.get(rootTaskId);
    if (pendingMove) {
      await pendingMove;
    }
  };

  const refreshRecycleBin = async () => {
    if (!persistenceEnabled) {
      setRecycleBinItems([]);
      return;
    }

    setIsRecycleBinLoading(true);
    setRecycleBinError("");

    try {
      const response = await persistFetchRecycleBin(activeBoardRequestOptions);
      setRecycleBinItems(response?.items ?? []);
    } catch (error) {
      console.error("Failed to load recycle bin.", error);
      setRecycleBinError("Unable to load recycle bin.");
    } finally {
      setIsRecycleBinLoading(false);
    }
  };

  const handleOpenRecycleBin = async () => {
    setIsRecycleBinOpen(true);
    setRecycleBinInfo("");
    await refreshRecycleBin();
  };

  const handleRestoreRecycleBinItem = async (taskId: string) => {
    if (!persistenceEnabled) {
      return;
    }

    const itemTitle =
      recycleBinItems.find((item) => item.id === taskId)?.title ?? "The item";
    setRecycleBinBusyTaskId(taskId);
    setRecycleBinError("");
    setRecycleBinInfo("");

    try {
      if (!requireEditableBoard("You can view this board, but you do not have permission to restore tasks.")) {
        return;
      }
      if (!requireLifecycleBoard("Only a team manager can restore deleted tasks on this board.")) {
        return;
      }

      const response = await persistRestoreRecycleBinTask(taskId, activeBoardRequestOptions);
      if (response?.board) {
        applyBoardMutationResponse(response);
        setRecycleBinItems(response.recycleBin ?? []);
        setRecycleBinInfo(`Restored "${itemTitle}" to the board.`);
        if (response.taskId) {
          // A restored subtask opens its top-level task.
          const restoredIndex = buildBoardIndex(response.board.buckets);
          handleSelectTask(restoredIndex.rootTaskIdByTaskId.get(response.taskId) ?? response.taskId);
        }
        setMutationError("");
        emitNotificationsRefresh();
      }
    } catch (error) {
      console.error("Failed to restore recycle-bin item.", error);
      const message =
        error instanceof Error ? error.message : "Unable to restore recycle-bin item.";
      setRecycleBinError(message);
      setMutationError(message);
    } finally {
      setRecycleBinBusyTaskId(null);
    }
  };

  const handlePermanentlyDeleteRecycleBinItem = async (taskId: string) => {
    if (!persistenceEnabled) {
      return;
    }

    const itemTitle =
      recycleBinItems.find((item) => item.id === taskId)?.title ?? "this item";

    if (
      !(await confirm({
        title: `Permanently delete "${itemTitle}"?`,
        body: "This cannot be undone.",
        confirmLabel: "Delete forever",
        tone: "danger",
      }))
    ) {
      return;
    }

    setRecycleBinBusyTaskId(taskId);
    setRecycleBinError("");
    setRecycleBinInfo("");

    try {
      if (!requireEditableBoard("You can view this board, but you do not have permission to permanently delete tasks.")) {
        return;
      }
      if (!requireLifecycleBoard("Only a team manager can permanently delete tasks on this board.")) {
        return;
      }

      const response = await persistDeleteRecycleBinTask(taskId, activeBoardRequestOptions);
      if (response?.board) {
        applyBoardMutationResponse(response);
        setRecycleBinItems(response.recycleBin ?? []);
        setRecycleBinInfo(`Permanently deleted "${itemTitle}".`);
        if (selectedTaskId === taskId) {
          const nextTaskId = getFirstTaskId(response.board.buckets);
          setSelectedTaskId(nextTaskId);
          setIsInspectorVisible(Boolean(nextTaskId));
        }
        setMutationError("");
        emitNotificationsRefresh();
      }
    } catch (error) {
      console.error("Failed to permanently delete recycle-bin item.", error);
      const message =
        error instanceof Error ? error.message : "Unable to permanently delete recycle-bin item.";
      setRecycleBinError(message);
      setMutationError(message);
    } finally {
      setRecycleBinBusyTaskId(null);
    }
  };

  const refreshArchives = async () => {
    if (!persistenceEnabled) {
      setArchiveItems([]);
      return;
    }

    setIsArchivesLoading(true);
    setArchivesError("");

    try {
      const response = await persistFetchArchives(activeBoardRequestOptions);
      setArchiveItems(response?.items ?? []);
    } catch (error) {
      console.error("Failed to load archives.", error);
      setArchivesError("Unable to load archives.");
    } finally {
      setIsArchivesLoading(false);
    }
  };

  const handleOpenArchives = async () => {
    // Done tasks waiting for review come first when there are any.
    setArchivesTab(doneRootTasks.length > 0 ? "done" : "archived");
    setIsArchivesOpen(true);
    setArchivesInfo("");
    await refreshArchives();
  };

  const handleRestoreArchiveItem = async (taskId: string) => {
    if (!persistenceEnabled) {
      return;
    }

    const itemTitle =
      archiveItems.find((item) => item.id === taskId)?.title ?? "The item";
    setArchiveBusyTaskId(taskId);
    setArchivesError("");
    setArchivesInfo("");

    try {
      if (!requireEditableBoard("You can view this board, but you do not have permission to restore archived tasks.")) {
        return;
      }
      if (!requireLifecycleBoard("Only a team manager can restore archived tasks on this board.")) {
        return;
      }

      const response = await persistRestoreArchiveTask(taskId, activeBoardRequestOptions);
      if (response?.board) {
        applyBoardMutationResponse(response);
        setArchiveItems(response.archives ?? []);
        setArchivesInfo(`Restored "${itemTitle}" to the board.`);
        if (response.taskId) {
          handleSelectTask(response.taskId);
        }
        setMutationError("");
        emitNotificationsRefresh();
      }
    } catch (error) {
      console.error("Failed to restore archive item.", error);
      const message =
        error instanceof Error ? error.message : "Unable to restore archive item.";
      setArchivesError(message);
      setMutationError(message);
    } finally {
      setArchiveBusyTaskId(null);
    }
  };

  const submitNewBucket = () => {
    void handleCreateBucket(newBucketTitle);
  };

  const handleImportIcs = async () => {
    if (!requirePersonalBoardAction("Import")) {
      return;
    }

    if (!importFile) {
      setImportMessage("");
      setImportErrors(["Choose an .ics file first."]);
      return;
    }

    setIsImporting(true);
    setImportMessage("");
    setImportErrors([]);

    const fromDate = new Date();
    fromDate.setHours(0, 0, 0, 0);

    const response = await persistImportIcs(importFile, fromDate.toISOString());

    setIsImporting(false);

    if (!response) {
      setImportErrors(["Unable to import the selected .ics file."]);
      return;
    }

    if (response.board) {
      applyBoardMutationResponse(response);
    }

    setImportMessage(
      [
        `${response.created} created`,
        `${response.updated} updated`,
        `${response.skippedPast} past skipped`,
        `${response.skippedRecurring} recurring skipped`,
        `${response.skippedUnsupported} unsupported skipped`,
      ].join(" | "),
    );
    setImportErrors(response.errors ?? []);
    setImportFile(null);
    setImportInputKey((current) => current + 1);
    setMutationError("");
  };

  const resetBulkImportState = () => {
    setBulkImportRawText("");
    setBulkImportWarnings([]);
    setBulkImportDraftTasks([]);
    setBulkImportBucketDecisions({});
    const lastWeek = getLastWeekDateRange();
    setBulkImportMetadata({
      source: bulkTaskImportSource,
      rangeLabel: lastWeek.label,
    });
  };


  const handleParseBulkImport = () => {
    setBulkImportInfo("");
    setImportMessage("");
    setImportErrors([]);
    setBulkImportWarnings([]);

    try {
      const { payload, warnings } = parseBulkTaskImportText(bulkImportRawText);
      setBulkImportMetadata({
        source: payload.source || bulkTaskImportSource,
        rangeLabel: payload.rangeLabel || getLastWeekDateRange().label,
      });
      setBulkImportDraftTasks(
        payload.tasks.map((task) => ({
          ...task,
          id: crypto.randomUUID(),
          labelsText: task.labels.join(", "),
          included: true,
        })),
      );
      setBulkImportWarnings(warnings);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Bulk task import content could not be parsed.";
      setImportErrors([message]);
      setBulkImportDraftTasks([]);
      setBulkImportBucketDecisions({});
    }
  };

  const updateBulkImportDraftTask = (
    taskId: string,
    patch: Partial<BulkTaskImportDraftTask>,
  ) => {
    setBulkImportDraftTasks((current) =>
      current.map((task) => (task.id === taskId ? { ...task, ...patch } : task)),
    );
  };

  const setBulkImportTaskIncluded = (taskId: string, included: boolean) => {
    updateBulkImportDraftTask(taskId, { included });
  };

  const setAllBulkImportTasksIncluded = (included: boolean) => {
    setBulkImportDraftTasks((current) =>
      current.map((task) => ({
        ...task,
        included,
      })),
    );
  };

  const handleSubmitBulkImport = async () => {
    if (!requirePersonalBoardAction("Bulk import")) {
      return;
    }

    if (!persistenceEnabled) {
      setImportErrors(["Database persistence is required for bulk task import."]);
      return;
    }

    setIsBulkImportSubmitting(true);
    setBulkImportInfo("");
    setImportErrors([]);

    try {
      const submission = buildBulkTaskImportSubmission({
        tasks: bulkImportDraftTasks,
        bucketDecisions: bulkImportBucketDecisions,
        metadata: bulkImportMetadata,
      });

      validateBulkImportDraft({
        tasks: bulkImportDraftTasks,
        bucketDecisions: bulkImportBucketDecisions,
        existingBucketByNormalizedTitle,
        existingBucketIds,
      });

      const response = await persistBulkImportTasks(submission);
      if (!response) {
        throw new Error("Bulk task import request failed.");
      }

      if (response.board) {
        applyBoardMutationResponse(response);
      }
      setBulkImportInfo(
        `${response.createdTaskCount} task${response.createdTaskCount === 1 ? "" : "s"} created` +
          (response.createdBucketCount > 0
            ? ` | ${response.createdBucketCount} new bucket${response.createdBucketCount === 1 ? "" : "s"}`
            : ""),
      );
      setBulkImportWarnings(response.warnings ?? []);
      setMutationError("");
      resetBulkImportState();
    } catch (error) {
      console.error("Failed to submit bulk task import.", error);
      const message =
        error instanceof Error ? error.message : "Bulk task import could not be completed.";
      setImportErrors([message]);
      setMutationError(message);
    } finally {
      setIsBulkImportSubmitting(false);
    }
  };


  // Every task save goes through one queue per task (src/lib/task-save-queue.ts),
  // so the editors, shortcuts and menus never have two requests for the same
  // task in flight. Each request runs the latest handleSaveTask.
  const stableHandleSaveTask = useStableCallback(handleSaveTask);
  const [taskSaveQueue] = useState(() => createTaskSaveQueue<TaskSavePatch>({ merge: mergeOutageAutosave }));
  // Queued saves run the latest handleSaveTask, with the board open when they
  // were queued.
  const taskSaves = useMemo<TaskSaves>(() => ({
    enqueue: (taskId, patch, options) =>
      taskSaveQueue.enqueue(taskId, patch, {
        ...options,
        save: async (queuedPatch) => (await stableHandleSaveTask(taskId, queuedPatch, activeBoardRequestOptions)) !== false,
      }),
    getPendingPatch: taskSaveQueue.getPendingPatch,
    subscribe: taskSaveQueue.subscribe,
  }), [activeBoardRequestOptions, stableHandleSaveTask, taskSaveQueue]);
  const saveTaskInQueue = useCallback(
    async (taskId: string, patch: TaskSavePatch) =>
      (await taskSaves.enqueue(taskId, patch, { kind: "action", source: "board" })).saved,
    [taskSaves],
  );

  const stableHandleSelectTask = useStableCallback(handleSelectTask);
  const stableHandleCreateTask = useStableCallback(handleCreateTask);
  const stableHandleRenameBucket = useStableCallback(handleRenameBucket);
  const stableHandleUpdateBucketStyle = useStableCallback(handleUpdateBucketStyle);
  const stableHandleMoveBucket = useStableCallback(handleMoveBucket);
  const stableHandleDeleteBucket = useStableCallback(handleDeleteBucket);
  const stableToggleBucketCollapse = useStableCallback(toggleBucketCollapse);

  // Keyboard shortcuts and the Ctrl+K command palette. Every action here also
  // has a mouse route; these only add a faster one.
  const router = useRouter();
  const [paletteMode, setPaletteMode] = useState<PaletteMode | null>(null);
  const [taskTimeRequest, setTaskTimeRequest] = useState<{ taskId: string; boardId: string } | null>(null);
  const taskForTime = taskTimeRequest?.boardId === board.id ? boardIndex.taskById.get(taskTimeRequest.taskId) : undefined;
  if (taskTimeRequest && !taskForTime) setTaskTimeRequest(null);
  const closeTaskTimeDialog = () => {
    const taskId = taskTimeRequest?.taskId;
    setTaskTimeRequest(null);
    if (taskId) window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-task-menu-target="${window.CSS.escape(taskId)}"]`)?.focus({ preventScroll: true });
    });
  };
  const [isShortcutSheetOpen, setIsShortcutSheetOpen] = useState(false);
  const [quickAddRequest, setQuickAddRequest] = useState<{ bucketId: string; nonce: number } | null>(
    null,
  );

  // The task a shortcut acts on: the focused card, else the open task.
  const getShortcutTaskId = () => {
    const active = document.activeElement;
    const navTaskId =
      active instanceof HTMLElement
        ? (() => {
            const target = active.closest<HTMLElement>("[data-task-nav], [data-task-menu-target]");
            return target?.dataset.taskNav ?? target?.dataset.taskMenuTarget;
          })()
        : undefined;

    if (navTaskId && boardIndex.taskById.has(navTaskId)) {
      return navTaskId;
    }

    const openTaskId = focusedSubtaskId ?? selectedTaskId;
    return isInspectorVisible && openTaskId && boardIndex.taskById.has(openTaskId)
      ? openTaskId
      : null;
  };

  const getTaskNavElements = () =>
    Array.from(document.querySelectorAll<HTMLElement>("[data-task-nav]")).filter(
      (element) => element.getClientRects().length > 0 && !element.closest('[aria-hidden="true"]'),
    );

  const focusTaskNavElement = (element: HTMLElement) => {
    element.focus({ preventScroll: true });
    element.scrollIntoView({ block: "nearest", inline: "nearest" });

    // With the sidebar open, it follows the keyboard like a reading pane.
    const taskId = element.dataset.taskNav;
    if (taskId && isInspectorVisible && activeDetailPanelMode === "sidebar" && taskId !== selectedTaskId) {
      handleSelectTask(taskId);
    }
  };

  const getCurrentTaskNavElement = (elements: HTMLElement[]) => {
    const active = document.activeElement;
    const focused = elements.find((element) => element === active || element.contains(active));
    if (focused) {
      return focused;
    }

    const taskId = getShortcutTaskId();
    return taskId ? elements.find((element) => element.dataset.taskNav === taskId) ?? null : null;
  };

  const moveTaskFocus = (delta: 1 | -1) => {
    const elements = getTaskNavElements();
    if (elements.length === 0) {
      return;
    }

    const current = getCurrentTaskNavElement(elements);
    const index = current ? elements.indexOf(current) : -1;
    const nextIndex =
      index < 0
        ? delta > 0
          ? 0
          : elements.length - 1
        : Math.min(Math.max(index + delta, 0), elements.length - 1);
    focusTaskNavElement(elements[nextIndex]);
  };

  const moveBucketFocus = (delta: 1 | -1) => {
    const columns = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="bucket-column"]'));
    if (columns.length === 0) {
      return;
    }

    const current = getCurrentTaskNavElement(getTaskNavElements());
    const currentColumn = current?.closest<HTMLElement>('[data-testid="bucket-column"]') ?? null;
    const columnIndex = currentColumn ? columns.indexOf(currentColumn) : -1;
    const rowIndex =
      currentColumn && current
        ? Array.from(currentColumn.querySelectorAll<HTMLElement>("[data-task-nav]")).indexOf(current)
        : 0;
    const start = columnIndex < 0 ? (delta > 0 ? 0 : columns.length - 1) : columnIndex + delta;

    // Skip empty buckets; keep roughly the same row in the next bucket.
    for (let index = start; index >= 0 && index < columns.length; index += delta) {
      const targets = Array.from(columns[index].querySelectorAll<HTMLElement>("[data-task-nav]"));
      if (targets.length > 0) {
        focusTaskNavElement(targets[Math.min(Math.max(rowIndex, 0), targets.length - 1)]);
        return;
      }
    }
  };

  // Null when the task cannot be changed from here (viewer access, read-only
  // import). A key press says why instead of
  // silently doing nothing.
  const getEditableShortcutTask = (taskId: string, scope: "task" | "schedule", notify = false) => {
    const task = boardIndex.taskById.get(taskId);
    if (!task) {
      return null;
    }

    const reason = getTaskEditBlockReason(task, currentBoardPermissions.canEdit, scope);

    if (reason) {
      if (notify) {
        setMutationError(reason);
      }
      return null;
    }

    return task;
  };

  const runQuickTaskUpdate = async (taskId: string, patch: TaskSavePatch, message: string) => {
    const task = boardIndex.taskById.get(taskId);
    if (!task) {
      return;
    }

    flushTaskEditorTextEdits();
    const bucketIdBefore = boardIndex.bucketIdByTaskId.get(taskId);
    const saved = await saveTaskInQueue(taskId, patch);

    // Completing a task shows its own undo toast from the save path.
    if (!saved || patch.status === "done") {
      return;
    }

    const restore: TaskSavePatch = {};
    if ("status" in patch) {
      restore.status = task.status;
    }
    if ("dueAt" in patch) {
      restore.dueAt = task.dueAt ?? null;
    }
    if ("startAt" in patch) {
      restore.startAt = task.startAt ?? null;
    }
    if ("bucketId" in patch && bucketIdBefore) {
      restore.bucketId = bucketIdBefore;
    }

    showUndoToast(message, async () => {
      await saveTaskInQueue(taskId, restore);
    });
  };

  const setShortcutTaskStatus = (taskId: string, status: TaskStatus) => {
    const task = getEditableShortcutTask(taskId, "task", true);
    if (!task) {
      return;
    }
    if (boardIndex.rootTaskIdByTaskId.get(taskId) !== taskId && !isSubtaskStatus(status)) {
      setMutationError(SUBTASK_RULE_MESSAGE);
      return;
    }
    // Done on a task that is already done archives it, like "Done: Archive".
    if (task.status === "done" && status === "done" && boardIndex.rootTaskIdByTaskId.get(taskId) === taskId) {
      if (currentBoardPermissions.canManageLifecycle) {
        void handleArchiveTask(taskId);
      }
      return;
    }
    if (task.status === status) {
      return;
    }

    void runQuickTaskUpdate(taskId, { status }, `Set "${task.title}" to ${TASK_STATUS_LABELS[status]}.`);
  };

  const setShortcutTaskDue = (taskId: string, dueAt: string | null, label: string) => {
    const task = getEditableShortcutTask(taskId, "schedule", true);
    if (!task) {
      return;
    }

    void runQuickTaskUpdate(
      taskId,
      { dueAt },
      dueAt ? `"${task.title}" is due ${label}.` : `Cleared the due date on "${task.title}".`,
    );
  };

  const snoozeShortcutTask = (taskId: string, preset: SnoozePreset, label: string) => {
    const task = getEditableShortcutTask(taskId, "schedule", true);
    const startAt = normalizeDateTimeInput(getSnoozeDateTime(preset));
    if (!task || !startAt) {
      return;
    }

    void runQuickTaskUpdate(taskId, { startAt }, `Snoozed "${task.title}" until ${label.toLowerCase()}.`);
  };

  const moveShortcutTask = (taskId: string, bucket: Bucket) => {
    const task = getEditableShortcutTask(taskId, "task", true);
    if (!task || boardIndex.rootTaskIdByTaskId.get(taskId) !== taskId) {
      return;
    }

    void runQuickTaskUpdate(taskId, { bucketId: bucket.id }, `Moved "${task.title}" to ${bucket.title}.`);
  };

  // Palette pickers are built when they open; their choices call these, so a
  // choice made later is checked against the board as it is by then.
  const stableSetShortcutTaskDue = useStableCallback(setShortcutTaskDue);
  const stableSnoozeShortcutTask = useStableCallback(snoozeShortcutTask);
  const stableMoveShortcutTask = useStableCallback(moveShortcutTask);

  // "Pick a date" opens the task and puts the cursor in its due date field.
  const focusTaskDueField = (taskId: string) => {
    const isWorkspace = activeDetailPanelMode === "expanded" && selectedTaskId === taskId;
    if (!isWorkspace) {
      handleSelectTask(taskId);
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        document
          .querySelector<HTMLInputElement>(
            isWorkspace
              ? '[data-testid="task-editor-expanded"] input[aria-label="Due date"]'
              : '[data-testid="task-editor-sidebar"] [data-testid="task-inspector-due"] input[type="date"]',
          )
          ?.focus();
      });
    });
  };

  const requestQuickAdd = (taskId: string | null) => {
    if (isRoutedWorkspace || !currentBoardPermissions.canEdit) {
      return;
    }

    const rootTaskId = taskId ? boardIndex.rootTaskIdByTaskId.get(taskId) ?? taskId : null;
    const bucketId =
      (rootTaskId ? boardIndex.bucketIdByTaskId.get(rootTaskId) : undefined) ??
      visibleBoard.buckets[0]?.id ??
      board.buckets[0]?.id;
    if (!bucketId) {
      return;
    }

    if (taskSearchQuery.trim()) {
      setTaskSearchQuery("");
    }
    setViewMode("board");
    setQuickAddRequest((current) => ({ bucketId, nonce: (current?.nonce ?? 0) + 1 }));
  };

  const focusSearch = () => {
    const input = document.getElementById("taskboard-header-search");
    if (input instanceof HTMLInputElement) {
      input.focus();
      input.select();
    }
  };

  const goToView = (mode: ViewMode) => {
    if (isRoutedWorkspace) {
      router.push(
        mode === "agenda" ? agendaWorkspaceHref : mode === "focus" ? focusWorkspaceHref : taskboardWorkspaceHref,
      );
      return;
    }

    const next = buildTaskboardWorkspaceHref(mode);
    if (`${window.location.pathname}${window.location.search}` !== next) {
      window.history.pushState(window.history.state, "", next);
    }
    setViewMode(mode);
  };

  const buildDuePaletteMode = (taskId: string, notify = false): PaletteMode | null => {
    if (boardIndex.rootTaskIdByTaskId.get(taskId) !== taskId) return null;
    const task = getEditableShortcutTask(taskId, "schedule", notify);
    if (!task) {
      return null;
    }

    return {
      title: "Set due date",
      placeholder: `Due date for "${task.title}"`,
      commands: [
        ...duePresetOptions.map((option) => ({
          id: `due-${option.value}`,
          label: `Due ${option.label.toLowerCase()}`,
          group: "Due date",
          detail: "5:00 PM",
          run: () =>
            stableSetShortcutTaskDue(
              taskId,
              normalizeDateTimeInput(getDuePresetDateTime(option.value)),
              option.label.toLowerCase(),
            ),
        })),
        { id: "due-pick", label: "Pick a date", group: "Due date", run: () => focusTaskDueField(taskId) },
        ...(task.dueAt
          ? [{ id: "due-clear", label: "Clear due date", group: "Due date", run: () => stableSetShortcutTaskDue(taskId, null, "") }]
          : []),
      ],
    };
  };

  const buildSnoozePaletteMode = (taskId: string, notify = false): PaletteMode | null => {
    if (boardIndex.rootTaskIdByTaskId.get(taskId) !== taskId) return null;
    const task = getEditableShortcutTask(taskId, "schedule", notify);
    if (!task) {
      return null;
    }

    return {
      title: "Snooze",
      placeholder: `Snooze "${task.title}" until`,
      commands: snoozePresetOptions.map((option) => ({
        id: `snooze-${option.value}`,
        label: option.label,
        group: "Snooze until",
        run: () => stableSnoozeShortcutTask(taskId, option.value, option.label),
      })),
    };
  };

  const buildMovePaletteMode = (taskId: string, notify = false): PaletteMode | null => {
    const task = getEditableShortcutTask(taskId, "task", notify);
    if (!task || boardIndex.rootTaskIdByTaskId.get(taskId) !== taskId) {
      return null;
    }

    const currentBucketId = boardIndex.bucketIdByTaskId.get(taskId);
    return {
      title: "Move to bucket",
      placeholder: `Move "${task.title}" to`,
      commands: board.buckets.map((bucket) => ({
        id: `move-${bucket.id}`,
        label: bucket.title,
        group: "Buckets",
        detail: bucket.id === currentBucketId ? "Current" : undefined,
        disabled: bucket.id === currentBucketId,
        run: () => stableMoveShortcutTask(taskId, bucket),
      })),
    };
  };

  const openPaletteMode = (mode: PaletteMode | null) => {
    if (mode) {
      setIsShortcutSheetOpen(false);
      setPaletteMode(mode);

    }
  };

  // The task's actions for a surface, from the shared list in src/lib/task-actions.ts.
  const getTaskActionsFor = (taskId: string, surface: TaskActionSurface): TaskAction[] => {
    const task = boardIndex.taskById.get(taskId);
    if (!task) {
      return [];
    }
    return getTaskActions(
      task,
      {
        canEditBoard: currentBoardPermissions.canEdit,
        canManageLifecycle: currentBoardPermissions.canManageLifecycle,
        isRootTask: boardIndex.rootTaskIdByTaskId.get(taskId) === taskId,
        isArchived: false,
        hasCalendarLink: Boolean(buildTaskCalendarHref(task, board.id)),
      },
      surface,
    );
  };

  // Runs a task action chosen from the palette or a context menu. Stable, so a
  // menu or picker opened earlier acts on the board as it is now.
  const runTaskAction = useStableCallback((taskId: string, actionId: TaskActionId) => {
    const task = boardIndex.taskById.get(taskId);
    if (!task) {
      return;
    }
    // A stale menu/palette must obey the current task type and permissions too.
    if (!getTaskActionsFor(taskId, "menu").some((action) => action.id === actionId && action.enabled)) return;

    switch (actionId) {
      case "open":
        handleSelectTask(taskId);
        return;
      case "open-workspace":
        handleSelectTask(taskId);
        setDetailPanelMode("expanded");
        return;
      case "status-todo":
      case "status-active":
      case "status-waiting":
      case "status-done":
        setShortcutTaskStatus(taskId, actionId.slice("status-".length) as TaskStatus);
        return;
      case "due":
        openPaletteMode(buildDuePaletteMode(taskId, true));
        return;
      case "time":
        setTaskTimeRequest({ taskId, boardId: board.id });
        return;
      case "snooze":
        openPaletteMode(buildSnoozePaletteMode(taskId, true));
        return;
      case "move":
        openPaletteMode(buildMovePaletteMode(taskId, true));
        return;
      case "view-calendar": {
        const href = buildTaskCalendarHref(task, board.id);
        if (href) {
          router.push(href);
        }
        return;
      }
      case "promote":
        if (getEditableShortcutTask(taskId, "task", true)) {
          // Text typed in an open editor is queued first, then the promote.
          flushTaskEditorTextEdits();
          void saveTaskInQueue(taskId, { promoteToMaintenanceOutage: true });
        }
        return;
      case "follow-up":
        void handleCreateFollowUpTask(taskId);
        return;
      case "convert":
        void handleConvertImportedTask(taskId);
        return;
      case "archive":
        void handleArchiveTask(taskId);
        return;
      case "delete":
        void handleDeleteTask(taskId);
        return;
    }
  });

  // --- Task context menus ------------------------------------------------------
  // Right-click, the Menu key or Shift+F10 on a task card, an Agenda or Focus
  // row, or a task header opens that task's actions (src/lib/task-actions.ts).
  // One handler per surface, not one per card, so memoized cards are untouched.
  // Opening a menu does not select the task: the open task stays open.
  const [taskMenu, setTaskMenu] = useState<{ boardId: string; taskId: string; anchor: ContextMenuAnchor } | null>(null);
  // A primary-button press that may still become a drag (the mouse sensor
  // waits for 8px of movement). No menu opens from the press until release.
  const dragPressPendingRef = useRef(false);
  // Where focus goes if the task a menu acted on leaves the list.
  const taskMenuFocusRef = useRef<{ taskId: string; surface: HTMLElement; index: number; until: number } | null>(null);

  // A menu whose task left the board (archived, deleted or moved elsewhere,
  // here or in another tab), or whose board is no longer open, closes.
  if (taskMenu && (taskMenu.boardId !== board.id || !boardIndex.taskById.has(taskMenu.taskId))) {
    setTaskMenu(null);
  }

  useEffect(() => {
    const clearPress = () => {
      dragPressPendingRef.current = false;
    };
    // dnd-kit reports no abort when a pending card is removed mid-press, so
    // the release itself also ends the pending press.
    window.addEventListener("pointerup", clearPress, true);
    window.addEventListener("pointercancel", clearPress, true);
    return () => {
      window.removeEventListener("pointerup", clearPress, true);
      window.removeEventListener("pointercancel", clearPress, true);
    };
  }, []);

  const stableHandleDragPending = useStableCallback(() => {
    dragPressPendingRef.current = true;
    setTaskMenu(null);
  });
  const stableHandleDragAbort = useStableCallback(() => {
    dragPressPendingRef.current = false;
  });

  const openTaskMenu = (taskId: string, trigger: HTMLElement, x?: number, y?: number) => {
    if (dragPressPendingRef.current || activeTaskId || activeBucketDragId || !boardIndex.taskById.has(taskId)) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    setTaskMenu({ boardId: board.id, taskId, anchor: { x: x ?? rect.left, y: y ?? rect.bottom, trigger } });
  };

  const handleTaskSurfaceContextMenu = (event: ReactMouseEvent<HTMLElement>) => {
    const element = event.target;
    // React passes events up from portals (the drag overlay) too; only what is
    // inside this surface in the page counts.
    // Element, not HTMLElement: a right-click can land on a card's SVG icon.
    if (phoneViewport.isPhone || !(element instanceof Element) || !event.currentTarget.contains(element)) {
      return;
    }
    const target = resolveTaskMenuTarget(element);
    if (
      !target ||
      !(target.trigger instanceof HTMLElement) ||
      keepsNativeContextMenu(element, {
        pointerType: (event.nativeEvent as PointerEvent).pointerType,
        hasSelection: hasSelectionWithin(element),
        defaultPrevented: event.defaultPrevented,
      })
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    openTaskMenu(target.taskId, target.trigger, event.clientX || undefined, event.clientY || undefined);
  };

  const handleTaskSurfaceKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    const element = event.target;
    if (
      !isContextMenuKey(event) ||
      phoneViewport.isPhone ||
      !(element instanceof Element) ||
      !event.currentTarget.contains(element) ||
      keepsNativeContextMenu(element)
    ) {
      return;
    }
    const target = resolveTaskMenuTarget(element);
    if (!target || !(target.trigger instanceof HTMLElement)) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    openTaskMenu(target.taskId, target.trigger);
  };

  const closeTaskMenu = (restoreFocus: boolean) => {
    if (restoreFocus && taskMenu?.anchor.trigger.isConnected) {
      // Focus the element directly: focusTaskNavElement would also select it.
      taskMenu.anchor.trigger.focus({ preventScroll: true });
    }
    setTaskMenu(null);
  };

  // After an action removes the task from its list (archive, delete, a status
  // or move that filters it out), focus moves to its neighbour, or the surface.
  // Only when focus was lost with it: a dialog or another choice keeps focus.
  useEffect(() => {
    const pending = taskMenuFocusRef.current;
    if (!pending) {
      return;
    }
    if (Date.now() > pending.until || !pending.surface.isConnected) {
      taskMenuFocusRef.current = null;
      return;
    }
    const targets = () => Array.from(pending.surface.querySelectorAll<HTMLElement>("[data-task-nav], [data-task-menu-target]"));
    if (targets().some((element) => (element.dataset.taskNav ?? element.dataset.taskMenuTarget) === pending.taskId)) {
      return;
    }
    taskMenuFocusRef.current = null;
    const active = document.activeElement;
    if (active && active !== document.body && active.isConnected) {
      return;
    }
    const candidates = targets().filter((element) => element.getClientRects().length > 0);
    (candidates[Math.min(pending.index, candidates.length - 1)] ?? pending.surface).focus({ preventScroll: true });
  }, [board]);

  const taskMenuActions: ContextMenuAction[] = taskMenu
    ? getTaskActionsFor(taskMenu.taskId, "menu").map((action) => ({
        id: action.id,
        label: action.label,
        icon: action.checked === undefined
          ? TASK_ACTION_ICONS[action.id]
          : action.checked
            ? <Check className="h-3 w-3" aria-hidden="true" />
            : <span className="h-3 w-3 shrink-0" aria-hidden="true" />,
        disabled: !action.enabled,
        disabledReason: action.disabledReason,
        danger: action.danger,
        separator: action.separator,
        checked: action.checked,
        // Pickers and navigation place focus themselves.
        focus: action.id === "time" || action.id === "due" || action.id === "snooze" || action.id === "move" || action.id === "view-calendar"
          ? "handoff"
          : "restore",
        run: () => {
          const { taskId, anchor } = taskMenu;
          const surface = anchor.trigger.closest<HTMLElement>("[data-task-menu-surface]");
          if (surface) {
            const shown = Array.from(surface.querySelectorAll<HTMLElement>("[data-task-nav], [data-task-menu-target]"));
            taskMenuFocusRef.current = {
              taskId,
              surface,
              index: Math.max(shown.indexOf(anchor.trigger), 0),
              until: Date.now() + 10000,
            };
          }
          runTaskAction(taskId, action.id);
        },
      }))
    : [];

  const buildMainPaletteMode = (): PaletteMode => {
    const taskId = getShortcutTaskId();
    const task = taskId ? boardIndex.taskById.get(taskId) ?? null : null;
    const commands: PaletteCommand[] = [];

    if (taskId && task) {
      const group = `Task: ${task.title}`;
      commands.push(
        ...getTaskActionsFor(taskId, "palette").map((action) => {
          const details = PALETTE_TASK_ACTIONS[action.id];
          const isCurrentStatus = action.id === `status-${task.status}` && action.label !== "Done: Archive";
          return {
            id: details?.id ?? `task-${action.id}`,
            label: action.label,
            group,
            keywords: action.label === "Done: Archive" ? "status archive" : details?.keywords,
            shortcut: details?.shortcut,
            detail: isCurrentStatus ? "Current" : undefined,
            disabled: !action.enabled,
            run: () => runTaskAction(taskId, action.id),
          };
        }),
      );
    }

    if (!isRoutedWorkspace && currentBoardPermissions.canEdit) {
      commands.push(
        { id: "create-task", label: "New task", group: "Create", shortcut: ["N"], run: () => requestQuickAdd(taskId) },
        {
          id: "create-bucket",
          label: "New bucket",
          group: "Create",
          keywords: "column",
          run: () => {
            setViewMode("board");
            setIsAddingBucket(true);
          },
        },
      );
    }

    if (persistenceEnabled) {
      commands.push({
        id: "create-note",
        label: "New note",
        group: "Create",
        keywords: "notebook capture jot",
        // In Notes the new note opens beside the list; elsewhere Notes opens with it.
        run: () =>
          isNotesWorkspace
            ? setNoteCreateRequest((current) => current + 1)
            : router.push(buildNotesHref({ createNew: true })),
      });
    }

    commands.push(
      { id: "go-search", label: "Search tasks", group: "Go to", keywords: "find", shortcut: ["/"], run: focusSearch },
      { id: "go-board", label: "Board", group: "Go to", keywords: "view", run: () => goToView("board") },
      { id: "go-agenda", label: "Agenda", group: "Go to", keywords: "view overdue upcoming", run: () => goToView("agenda") },
      { id: "go-focus", label: "Focus", group: "Go to", keywords: "view active", run: () => goToView("focus") },
      { id: "go-calendar", label: "Calendar", group: "Go to", keywords: "view", run: () => router.push(calendarWorkspaceHref) },
      { id: "go-outages", label: "Outages", group: "Go to", keywords: "maintenance calendar", run: () => router.push(outageCalendarWorkspaceHref) },
      { id: "go-notes", label: "Folio", group: "Go to", keywords: "notes spaces wiki knowledge journal", run: () => router.push(notesWorkspaceHref) },
      { id: "go-archives", label: "Archives", group: "Go to", keywords: "done completed", run: () => void handleOpenArchives() },
      { id: "go-recycle-bin", label: "Recycle Bin", group: "Go to", keywords: "deleted trash restore", run: () => void handleOpenRecycleBin() },
      { id: "go-options", label: "Options", group: "Go to", keywords: "settings preferences appearance", run: () => router.push(optionsHref) },
    );

    for (const accessibleBoard of accessibleBoards) {
      if (accessibleBoard.boardId !== currentBoardId) {
        commands.push({
          id: `board-${accessibleBoard.boardId}`,
          label: `Switch to ${accessibleBoard.title}`,
          group: "Boards",
          keywords: "board",
          run: () => void handleSelectAccessibleBoard(accessibleBoard),
        });
      }
    }

    for (const theme of ["light", "dark", "system"] as const) {
      if (settings.theme !== theme) {
        commands.push({
          id: `theme-${theme}`,
          label: theme === "system" ? "Match the system theme" : `Use ${theme} theme`,
          group: "Appearance",
          keywords: "theme mode",
          run: () => updateSetting("theme", theme),
        });
      }
    }

    commands.push({
      id: "help-shortcuts",
      label: "Keyboard shortcuts",
      group: "Help",
      keywords: "keys help",
      shortcut: ["?"],
      run: () => setIsShortcutSheetOpen(true),
    });

    return { title: "Command palette", placeholder: "Type a command or search", commands };
  };

  const runShortcutCommand = (command: ShortcutCommandId) => {
    const taskId = getShortcutTaskId();
    const isWorkspaceOpen = activeDetailPanelMode === "expanded";

    switch (command) {
      case "palette":
        return;
      case "help":
        setIsShortcutSheetOpen(true);
        return;
      case "search":
        focusSearch();
        return;
      case "new-task":
        if (!isWorkspaceOpen) {
          requestQuickAdd(taskId);
        }
        return;
      case "next-card":
      case "previous-card":
        if (!isWorkspaceOpen) {
          moveTaskFocus(command === "next-card" ? 1 : -1);
        }
        return;
      case "next-bucket":
      case "previous-bucket":
        if (!isWorkspaceOpen && !isRoutedWorkspace && viewMode === "board") {
          moveBucketFocus(command === "next-bucket" ? 1 : -1);
        }
        return;
      case "open-workspace":
        if (taskId) {
          handleSelectTask(taskId);
          setDetailPanelMode("expanded");
        }
        return;
      case "status-todo":
      case "status-active":
      case "status-waiting":
      case "status-done":
        if (taskId) {
          setShortcutTaskStatus(taskId, command.slice("status-".length) as TaskStatus);
        }
        return;
      case "due":
        if (taskId) {
          openPaletteMode(buildDuePaletteMode(taskId, true));
        }
        return;
      case "snooze":
        if (taskId) {
          openPaletteMode(buildSnoozePaletteMode(taskId, true));
        }
        return;
      case "move":
        if (taskId) {
          openPaletteMode(buildMovePaletteMode(taskId, true));
        }
        return;
    }
  };

  const handleShortcutKeyDown = useStableCallback((event: KeyboardEvent) => {
    if (event.defaultPrevented || event.isComposing || taskTimeRequest) {
      return;
    }

    const command = resolveShortcut(event, { singleKeys: settings.singleKeyShortcuts });
    if (!command) {
      return;
    }

    if (command === "palette") {
      event.preventDefault();
      setIsShortcutSheetOpen(false);
      if (paletteMode) setPaletteMode(null); else openPaletteMode(buildMainPaletteMode());
      return;
    }

    if (
      paletteMode ||
      isShortcutSheetOpen ||
      isShortcutBlockedTarget(event.target) ||
      document.querySelector(OPEN_OVERLAY_SELECTOR)
    ) {
      return;
    }

    event.preventDefault();
    runShortcutCommand(command);
  });

  useEffect(() => {
    const listener = (event: KeyboardEvent) => handleShortcutKeyDown(event);
    document.addEventListener("keydown", listener);

    return () => document.removeEventListener("keydown", listener);
  }, [handleShortcutKeyDown]);

  // Agenda's "Move all to today": one undo puts every due date back.
  const handleMoveOverdueToToday = async (taskIds: string[]) => {
    if (
      taskIds.length === 0 ||
      !requireEditableBoard("You can view this board, but you do not have permission to edit tasks.")
    ) {
      return;
    }

    const dueAt = getRescheduleToTodayDueAt(new Date());
    const previous = taskIds.flatMap((taskId) => {
      const task = boardIndex.taskById.get(taskId);
      return task ? [{ taskId, dueAt: task.dueAt ?? null }] : [];
    });
    const applyDueDates = async (updates: Array<{ taskId: string; dueAt: string | null }>) => {
      if (!persistenceEnabled) {
        setBoard((current) =>
          updates.reduce((next, update) => updateTaskInBoard(next, update.taskId, { dueAt: update.dueAt }), current),
        );
        return true;
      }

      // Each change waits behind any other save of the same task.
      let latest: BoardMutationResponse | null = null;
      for (const update of updates) {
        let response: BoardMutationResponse | null = null;
        await taskSaveQueue.enqueue(update.taskId, { dueAt: update.dueAt }, {
          kind: "action",
          source: "board",
          save: async (patch) => {
            response = await persistUpdateTask(update.taskId, patch, activeBoardRequestOptions);
            return Boolean(response?.board);
          },
        });
        const settled = response as BoardMutationResponse | null;
        if (!settled?.board) {
          reportMutationFailure(settled, "Unable to move the overdue tasks.");
          break;
        }
        latest = settled;
      }

      if (latest) {
        applyBoardMutationResponse(latest);
        setMutationError("");
        emitNotificationsRefresh();
      }
      return latest !== null;
    };

    const moved = await applyDueDates(previous.map((entry) => ({ taskId: entry.taskId, dueAt })));
    if (moved) {
      const count = previous.length;
      showUndoToast(`Moved ${count} overdue ${count === 1 ? "task" : "tasks"} to today.`, async () => {
        await applyDueDates(previous);
      });
    }
  };
  const stableHandleMoveOverdueToToday = useStableCallback(handleMoveOverdueToToday);
  // A drag that starts, ends or is cancelled is no longer a pending press.
  const stableHandleDragStart = useStableCallback((event: DragStartEvent) => {
    dragPressPendingRef.current = false;
    handleDragStart(event);
  });
  const stableHandleDragCancel = useStableCallback(() => {
    dragPressPendingRef.current = false;
    handleDragCancel();
  });
  const stableHandleDragOver = useStableCallback(handleDragOver);
  const stableHandleDragEnd = useStableCallback((event: DragEndEvent) => {
    dragPressPendingRef.current = false;
    handleDragEnd(event);
  });
  const stableHandleOpenView = useStableCallback(handleOpenView);
  const stableHandleOpenExpandedTaskDetail = useStableCallback(handleOpenExpandedTaskDetail);
  const stableHandleCollapseExpandedTaskDetail = useStableCallback(
    handleCollapseExpandedTaskDetail,
  );
  const stableHandleCloseInspector = useStableCallback(handleCloseInspector);

  return (
    <main
      ref={taskboardShellRef}
      className={`taskboard-shell ${boardPaddingClass}`}
      data-testid="taskboard-shell"
      onContextMenu={event => {
        if (isBlankAppContextMenu(event.target, {
          button: event.button,
          pointerType: "pointerType" in event.nativeEvent ? String(event.nativeEvent.pointerType) : undefined,
          hasSelection: hasSelectionWithin(event.target),
          defaultPrevented: event.defaultPrevented,
        })) event.preventDefault();
      }}
      data-phone-notes={isNotesWorkspace ? "true" : undefined}
      data-phone-calendar={isCalendarWorkspace ? "true" : undefined}
      data-phone-keyboard={phoneViewport.keyboardOpen ? "true" : undefined}
      style={phoneViewport.style}
      data-taskboard-user={currentUser.email}
      data-board-access-level={boardAccess.level}
      data-board-access-source={boardAccess.source ?? ""}
      data-board-can-read={currentBoardPermissions.canRead ? "true" : "false"}
      data-board-can-edit={currentBoardPermissions.canEdit ? "true" : "false"}
      data-board-can-manage={currentBoardPermissions.canManage ? "true" : "false"}
      data-current-board-id={currentBoardId}
      data-current-board-listed={currentAccessibleBoard ? "true" : "false"}
      data-accessible-board-count={accessibleBoards.length}
    >
      {confirmDialog}
      {isCalendarArrivalNoticeVisible && selectedTask ? (
        <div
          aria-live="polite"
          className="pointer-events-none fixed left-3 top-3 z-[73] max-w-[min(390px,calc(100vw-1.5rem))]"
          data-testid="taskboard-calendar-arrival-notice"
          role="status"
        >
          <div className="taskboard-popover pointer-events-auto rounded-[16px] border px-3 py-2 text-[10px] font-medium leading-4 text-foreground shadow-lg">
            <div className="flex items-start gap-2">
              <CalendarDays aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
              <div className="min-w-0">
                <p className="font-semibold text-foreground">Opened from Calendar</p>
                <p className="mt-0.5 truncate text-muted">{selectedTask.title}</p>
              </div>
              <button
                type="button"
                onClick={() => setIsCalendarArrivalNoticeVisible(false)}
                className="ml-1 shrink-0 rounded-full p-0.5 text-muted transition hover:bg-foreground/8 hover:text-foreground"
                aria-label="Dismiss Calendar arrival notice"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {boardNotice && isInitialBoardNoticeVisible ? (
        <div
          aria-live="polite"
          className="pointer-events-none fixed bottom-3 left-3 z-[72] max-w-[min(360px,calc(100vw-1.5rem))]"
          data-testid="taskboard-board-notice"
          role="status"
        >
          <div className="taskboard-popover pointer-events-auto rounded-[16px] border px-3 py-2 text-[10px] font-medium leading-4 text-foreground shadow-lg">
            <div className="flex items-start gap-2">
              <p className="min-w-0">{boardNotice}</p>
              <button
                type="button"
                onClick={() => setIsInitialBoardNoticeVisible(false)}
                className="ml-1 shrink-0 rounded-full p-0.5 text-muted transition hover:bg-foreground/8 hover:text-foreground"
                aria-label="Dismiss board notice"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          </div>
        </div>
      ) : null}
      {isBoardSettingsOpen ? (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-black/45 px-3 py-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="board-sharing-dialog-title"
            data-testid="board-sharing-dialog"
            className="panel-surface panel-strong grid max-h-[min(92vh,42rem)] w-full max-w-[34rem] gap-3 overflow-y-auto rounded-[18px] border p-4 shadow-2xl"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                  Sharing
                </p>
                <h2 id="board-sharing-dialog-title" className="mt-1 text-[1.05rem] font-semibold text-foreground">
                  Who can see this board
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setIsBoardSettingsOpen(false)}
                className="rounded-full p-1 text-muted transition hover:bg-foreground/8 hover:text-foreground"
                aria-label="Close sharing"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <p className="rounded-[12px] border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] leading-4 text-foreground">
              Teammates can only view a team-visible board after an administrator turns
              on team visibility. People you share the board with below keep their access
              either way.
            </p>

            {isBoardPrivacyLoading ? (
              <div className="rounded-[12px] border border-border/70 px-3 py-3 text-[12px] text-muted">
                Loading board settings...
              </div>
            ) : boardPrivacySettings && boardPrivacyDraft ? (
              <div className="grid gap-3">
                <fieldset className="grid gap-2">
                  <legend className="text-[12px] font-semibold text-foreground">
                    Visibility
                  </legend>
                  <label className="flex items-start gap-2 rounded-[12px] border border-border/70 px-3 py-2 text-[12px] text-foreground">
                    <input
                      type="radio"
                      name="board-privacy-visibility"
                      className="mt-0.5"
                      checked={boardPrivacyDraft.personalVisibility === "private"}
                      onChange={() =>
                        setBoardPrivacyDraft({
                          personalVisibility: "private",
                          personalVisibilityTeamId: null,
                        })
                      }
                    />
                    <span>
                      <span className="block font-medium">Private</span>
                      <span className="block text-[11px] leading-4 text-muted">
                        Only you and people you share it with can open this board.
                      </span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 rounded-[12px] border border-border/70 px-3 py-2 text-[12px] text-foreground">
                    <input
                      type="radio"
                      name="board-privacy-visibility"
                      className="mt-0.5"
                      checked={boardPrivacyDraft.personalVisibility === "team_visible"}
                      onChange={() =>
                        setBoardPrivacyDraft({
                          personalVisibility: "team_visible",
                          personalVisibilityTeamId:
                            boardPrivacyDraft.personalVisibilityTeamId ??
                            boardPrivacySettings.eligibleTeams[0]?.id ??
                            null,
                        })
                      }
                    />
                    <span>
                      <span className="block font-medium">Team visible</span>
                      <span className="block text-[11px] leading-4 text-muted">
                        Members of the selected team can view it read-only, once team visibility is turned on.
                      </span>
                    </span>
                  </label>
                </fieldset>

                {boardPrivacyDraft.personalVisibility === "team_visible" ? (
                  <label className="grid gap-1 text-[12px] font-medium text-foreground">
                    Team
                    <select
                      className="ui-control rounded-[10px] border px-2 py-2 text-[12px] text-foreground"
                      value={boardPrivacyDraft.personalVisibilityTeamId ?? ""}
                      onChange={(event) =>
                        setBoardPrivacyDraft((current) =>
                          current
                            ? {
                                ...current,
                                personalVisibilityTeamId: event.target.value || null,
                              }
                            : current,
                        )
                      }
                    >
                      <option value="">Select a team</option>
                      {boardPrivacySettings.eligibleTeams.map((team) => (
                        <option key={team.id} value={team.id}>
                          {team.name}
                          {team.personalBoardViewEnabled ? "" : " (team policy off)"}
                        </option>
                      ))}
                    </select>
                    {boardPrivacySettings.eligibleTeams.length === 0 ? (
                      <span className="text-[11px] font-normal leading-4 text-muted">
                        The board owner is not an active member of any eligible teams.
                      </span>
                    ) : null}
                  </label>
                ) : null}

                <div className="rounded-[12px] border border-border/70 px-3 py-2 text-[11px] leading-4 text-muted">
                  <span className="block font-semibold text-foreground">Effective status</span>
                  <span>{boardPrivacySettings.gates.reason}</span>
                </div>

                {boardPrivacySettings.impactPreview ? (
                  <div className="rounded-[12px] border border-border/70 px-3 py-2 text-[11px] leading-4 text-muted">
                    <span className="font-semibold text-foreground">
                      {boardPrivacySettings.impactPreview.affectedUsers}
                    </span>{" "}
                    active teammate
                    {boardPrivacySettings.impactPreview.affectedUsers === 1 ? "" : "s"} would be in
                      scope for read-only visibility if all gates are enabled.
                  </div>
                ) : null}

                <section className="grid gap-2 rounded-[12px] border border-border/70 px-3 py-3">
                  <div>
                    <h3 className="text-[12px] font-semibold text-foreground">
                      Explicit sharing
                    </h3>
                    <p className="mt-1 text-[11px] leading-4 text-muted">
                      People you add here find this board under Shared with me. Imports
                      and notifications stay private to you.
                    </p>
                  </div>

                  {isBoardShareLoading ? (
                    <div className="rounded-[10px] border border-border/70 px-3 py-2 text-[11px] text-muted">
                      Loading explicit shares...
                    </div>
                  ) : boardShareMembers.length === 0 ? (
                    <div className="rounded-[10px] border border-border/70 px-3 py-2 text-[11px] text-muted">
                      No explicit shares are configured.
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      {boardShareMembers.map((member) => (
                        <div
                          key={member.userId}
                          className="grid gap-2 rounded-[10px] border border-border/70 px-3 py-2 text-[11px] md:grid-cols-[minmax(0,1fr)_8rem_auto] md:items-center"
                        >
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-foreground">
                              {member.displayName}
                            </div>
                            <div className="truncate text-muted">
                              {member.email}
                              {member.username ? ` / ${member.username}` : ""}
                            </div>
                          </div>
                          <select
                            className="ui-control rounded-[9px] border px-2 py-1.5 text-[11px] text-foreground disabled:opacity-70"
                            value={member.role === "owner" ? "owner" : member.role}
                            disabled={isBoardShareSaving || member.role === "owner"}
                            onChange={(event) =>
                              void handleUpdateBoardShareMember(
                                member.userId,
                                event.target.value as PersonalBoardShareRole,
                              )
                            }
                          >
                            {member.role === "owner" ? <option value="owner">Owner grant</option> : null}
                            <option value="viewer">Viewer</option>
                            <option value="editor">Editor</option>
                          </select>
                          <button
                            type="button"
                            onClick={() => void handleRemoveBoardShareMember(member.userId)}
                            disabled={isBoardShareSaving}
                            className="ui-chip-button ui-button-surface inline-flex items-center justify-center gap-1 rounded-[9px] border px-2 py-1.5 text-[11px] font-medium disabled:opacity-60"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                            Remove
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="grid gap-2 rounded-[10px] border border-border/70 px-3 py-2">
                    <label className="grid gap-1 text-[11px] font-medium text-foreground">
                      Add user
                      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_auto]">
                        <input
                          type="search"
                          className="ui-control rounded-[9px] border px-2 py-1.5 text-[11px] text-foreground"
                          value={boardShareSearch}
                          onChange={(event) => setBoardShareSearch(event.target.value)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              event.preventDefault();
                              void handleSearchBoardShareCandidates();
                            }
                          }}
                          placeholder="Search email, username, or name"
                        />
                        <button
                          type="button"
                          onClick={() => void handleSearchBoardShareCandidates()}
                          disabled={isBoardShareSearching || boardShareSearch.trim().length < 2}
                          className="ui-chip-button ui-button-surface inline-flex items-center justify-center gap-1 rounded-[9px] border px-2 py-1.5 text-[11px] font-medium disabled:opacity-60"
                        >
                          <Search className="h-3.5 w-3.5" />
                          {isBoardShareSearching ? "Searching..." : "Search"}
                        </button>
                      </div>
                    </label>

                    {boardShareCandidates.length > 0 ? (
                      <div className="grid gap-2 md:grid-cols-[minmax(0,1fr)_7rem_auto] md:items-end">
                        <label className="grid gap-1 text-[11px] font-medium text-foreground">
                          User
                          <select
                            className="ui-control rounded-[9px] border px-2 py-1.5 text-[11px] text-foreground"
                            value={boardShareCandidateId}
                            onChange={(event) => setBoardShareCandidateId(event.target.value)}
                          >
                            {boardShareCandidates.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.displayName} - {candidate.email}
                              </option>
                            ))}
                          </select>
                        </label>
                        <label className="grid gap-1 text-[11px] font-medium text-foreground">
                          Role
                          <select
                            className="ui-control rounded-[9px] border px-2 py-1.5 text-[11px] text-foreground"
                            value={boardShareRole}
                            onChange={(event) =>
                              setBoardShareRole(event.target.value as PersonalBoardShareRole)
                            }
                          >
                            <option value="viewer">Viewer</option>
                            <option value="editor">Editor</option>
                          </select>
                        </label>
                        <button
                          type="button"
                          onClick={() => void handleAddBoardShareMember()}
                          disabled={isBoardShareSaving || !boardShareCandidateId}
                          className="ui-chip-button ui-button-primary inline-flex items-center justify-center gap-1 rounded-[9px] border px-2 py-1.5 text-[11px] font-medium disabled:opacity-60"
                        >
                          <Plus className="h-3.5 w-3.5" />
                          Add share
                        </button>
                      </div>
                    ) : null}
                  </div>
                </section>
              </div>
            ) : null}

            {boardShareMessage ? (
              <div
                className={`rounded-[12px] border px-3 py-2 text-[11px] leading-4 ${
                  boardShareMessage.tone === "error"
                    ? "ui-danger-banner"
                    : "ui-info-banner"
                }`}
              >
                {boardShareMessage.text}
              </div>
            ) : null}

            {boardPrivacyMessage ? (
              <div
                className={`rounded-[12px] border px-3 py-2 text-[11px] leading-4 ${
                  boardPrivacyMessage.tone === "error"
                    ? "ui-danger-banner"
                    : "ui-info-banner"
                }`}
              >
                {boardPrivacyMessage.text}
              </div>
            ) : null}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsBoardSettingsOpen(false)}
                className="ui-chip-button ui-button-surface rounded-[10px] border px-3 py-1.5 text-[11px] font-medium"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleSaveBoardPrivacySettings()}
                disabled={
                  isBoardPrivacyLoading ||
                  isBoardPrivacySaving ||
                  !boardPrivacyDraft ||
                  (boardPrivacyDraft.personalVisibility === "team_visible" &&
                    !boardPrivacyDraft.personalVisibilityTeamId)
                }
                className="ui-chip-button ui-button-primary rounded-[10px] border px-3 py-1.5 text-[11px] font-medium disabled:opacity-60"
              >
                {isBoardPrivacySaving ? "Saving..." : "Save settings"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
      <div className={`taskboard-main-frame mx-auto flex w-full max-w-[3600px] flex-col ${mainGapClass}`}>
        <MobileWorkspaceHeader title={isNotesWorkspace ? "Folio" : isCalendarWorkspace ? isOutageCalendarView ? "Outages" : "Calendar" : "Tasks"}
          query={taskSearchQuery} onQueryChange={setTaskSearchQuery}
          menuButtonRef={phoneHeaderMenuButtonRef} menuOpen={isMoreMenuOpen}
          headerAction={phoneViewport.isPhone && persistenceEnabled && isPersonalActiveBoard ? (
            <NotificationsControl persistenceEnabled onOpenTask={handleSelectTask} />
          ) : null}
          onMore={() => { phoneMenuAnchorRef.current = phoneHeaderMenuButtonRef.current; setIsMoreMenuOpen(current => !current); }} />
        <header
          ref={boardHeaderRef}
          className="taskboard-main-header sticky top-0 z-40 overflow-visible"
          data-testid="board-header"
        >
          <h1 className="sr-only">{currentAccessibleBoard?.title ?? board.title}</h1>
          <div className="taskboard-header-stack flex flex-col gap-0">
            <div className="taskboard-header-identity-row taskboard-header-utility-row min-w-0">
              <div className="taskboard-header-brand w-full min-w-0">
                <div className="taskboard-header-control-row flex min-w-0 flex-col gap-1 md:flex-row md:items-center md:justify-between md:gap-4">
                <div className="taskboard-board-controls flex min-w-0 flex-wrap items-center gap-1">
                <div
                  ref={boardSwitcherRef}
                  className="relative w-fit max-w-full"
                  data-testid="board-switcher-shell"
                >
                  <button
                    type="button"
                    onClick={() => setIsBoardSwitcherOpen((current) => !current)}
                    className={`${SMALL_CHIP_BUTTON_CLASS} max-w-full`}
                    aria-haspopup="dialog"
                    aria-expanded={isBoardSwitcherOpen}
                    aria-label={`Board: ${currentAccessibleBoard?.title ?? board.title}`}
                  >
                    <ArrowRightLeft className="h-3.5 w-3.5 shrink-0" />
                    <span className="min-w-0 truncate">
                      {currentAccessibleBoard?.title ?? board.title}
                    </span>
                    <span className="taskboard-board-switcher-count shrink-0 text-[9px] font-medium text-muted">
                      {accessibleBoards.length} board{accessibleBoards.length === 1 ? "" : "s"}
                    </span>
                    <ChevronDown className="h-3 w-3 shrink-0" />
                  </button>
                  {isBoardSwitcherOpen ? (
                    <div
                      role="dialog"
                      aria-label="Board picker"
                      className="taskboard-popover fixed inset-x-3 top-20 z-[75] grid max-h-[min(34rem,calc(100vh-7rem))] grid-rows-[auto_minmax(0,1fr)_auto] gap-2 overflow-hidden rounded-[14px] border p-2 shadow-xl sm:absolute sm:inset-auto sm:left-0 sm:top-[calc(100%+0.25rem)] sm:w-[min(36rem,calc(100vw-1.25rem))]"
                    >
                      <div className="ui-control flex h-8 min-w-0 items-center gap-1.5 rounded-[10px] border px-2 text-[11px] font-medium leading-4 text-foreground">
                        <Search className="h-3.5 w-3.5 shrink-0 text-muted" />
                        <input
                          value={boardPickerSearch}
                          onChange={(event) => setBoardPickerSearch(event.target.value)}
                          className="h-full min-w-0 flex-1 bg-transparent text-[11px] font-medium leading-4 text-foreground outline-none placeholder:text-muted"
                          placeholder="Search boards"
                          aria-label="Search boards"
                        />
                        {boardPickerSearch ? (
                          <button
                            type="button"
                            onClick={() => setBoardPickerSearch("")}
                            className="ui-button ui-button-surface inline-flex h-5 w-5 items-center justify-center rounded-[7px] border border-border/60 text-muted transition hover:text-foreground"
                            aria-label="Clear board search"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        ) : null}
                      </div>

                      <div
                        className="min-h-0 overflow-y-auto overscroll-contain pr-0.5 [touch-action:pan-y]"
                        role="list"
                      >
                        {boardPickerSections.sections.length > 0 ? (
                          <div className="grid gap-2">
                            {boardPickerSections.sections.map((section) => (
                              <section key={section.id} className="grid gap-1.5">
                                <div className="flex min-w-0 items-center justify-between gap-2 px-1">
                                  <div className="min-w-0">
                                    <h2 className="truncate text-[10px] font-semibold uppercase leading-4 tracking-[0.08em] text-muted">
                                      {section.title}
                                    </h2>
                                    <p className="truncate text-[9px] leading-3 text-muted">
                                      {section.description}
                                    </p>
                                  </div>
                                  <span className="shrink-0 rounded-full border border-border/60 px-1.5 py-0.5 text-[9px] font-semibold leading-3 text-muted">
                                    {section.totalCount}
                                  </span>
                                </div>
                                {section.groups.map((group) => (
                                  <div key={group.id} className="grid gap-1">
                                    {section.groups.length > 1 ? (
                                      <div className="truncate px-1 text-[9px] font-semibold leading-3 text-muted">
                                        {group.title}
                                      </div>
                                    ) : null}
                                    {group.boards.map((item) => {
                                      const accessibleBoard = item.board;

                                      return (
                                        <button
                                          key={accessibleBoard.boardId}
                                          type="button"
                                          onClick={() => void handleSelectAccessibleBoard(accessibleBoard)}
                                          title={
                                            item.isCurrentBoard
                                              ? "Current board"
                                              : "Switch to board"
                                          }
                                          className={`grid min-h-[3.25rem] w-full min-w-0 gap-1 rounded-[10px] border px-2 py-1.5 text-left text-[10px] leading-4 transition ${
                                            item.isCurrentBoard
                                              ? "border-sky-500/30 bg-sky-500/10 text-foreground"
                                              : "border-border/60 text-muted hover:border-sky-500/30 hover:text-foreground"
                                          }`}
                                        >
                                          <span className="flex min-w-0 items-center justify-between gap-2">
                                            <span className="min-w-0 truncate font-semibold">
                                              {accessibleBoard.title}
                                            </span>
                                            {item.isCurrentBoard ? (
                                              <Check className="h-3.5 w-3.5 shrink-0 text-sky-400" />
                                            ) : null}
                                          </span>
                                          <span className="flex min-w-0 flex-wrap gap-1">
                                            {item.badges.map((badge) => (
                                              <span
                                                key={badge}
                                                className="rounded-full border border-border/60 px-1.5 py-0.5 text-[9px] font-semibold leading-3 text-muted"
                                              >
                                                {badge}
                                              </span>
                                            ))}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                ))}
                              </section>
                            ))}
                          </div>
                        ) : (
                          <div className="rounded-[10px] border border-border/60 px-3 py-4 text-center text-[10px] font-medium leading-4 text-muted">
                            No matching boards.
                          </div>
                        )}
                      </div>

                      {boardPickerSections.hiddenAdminBoardCount > 0 || showAdminBoardAccess ? (
                        <button
                          type="button"
                          onClick={() => setShowAdminBoardAccess((current) => !current)}
                          className="ui-button ui-button-surface flex min-h-8 w-full items-center justify-between gap-2 rounded-[10px] border border-border/70 px-2 py-1 text-left text-[10px] font-semibold leading-4 text-muted transition hover:text-foreground"
                        >
                          <span className="min-w-0 truncate">
                            {showAdminBoardAccess ? "Hide admin access" : "Show admin access"}
                          </span>
                          {!showAdminBoardAccess ? (
                            <span className="shrink-0 text-[9px] font-medium">
                              {boardPickerSections.hiddenAdminBoardCount} hidden
                            </span>
                          ) : null}
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {canOpenBoardSettings ? (
                  <button
                    type="button"
                    onClick={() => void handleOpenBoardSettings()}
                    className={`taskboard-board-settings-button ${SMALL_CHIP_BUTTON_CLASS} gap-1 px-2`}
                    title="Share this board and choose who can see it"
                    aria-label="Share board"
                  >
                    <Share2 className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="max-sm:sr-only">Share</span>
                  </button>
                ) : null}
                {isReadOnlyBoard ? (
                  <div
                    className="flex w-fit max-w-full items-center gap-1 rounded-full border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold leading-4 text-foreground"
                    data-testid="board-read-only-indicator"
                    title={readOnlyBoardMessage}
                  >
                    <Eye className="h-3 w-3 shrink-0 text-amber-400" />
                    <span className="truncate">Read-only</span>
                    <span className="hidden text-muted sm:inline">Viewer access</span>
                  </div>
                ) : null}
                </div>

              <div
                className="taskboard-header-search-region flex min-w-0 flex-col gap-0 md:w-[min(38rem,48vw)] md:items-end"
              >
                <div className="flex w-full min-w-0 items-center gap-1.5 md:max-w-[32rem]">
                  <div
                    className="ui-control flex h-8 min-w-0 flex-1 items-center gap-1.5 rounded-[10px] border px-2 text-[11px] font-medium leading-4 text-foreground"
                  >
                    <Search className="h-3.5 w-3.5 shrink-0 text-muted" />
                    <input
                      id="taskboard-header-search"
                      type="search"
                      value={taskSearchQuery}
                      aria-label={isNotesWorkspace ? "Search Folio" : isCalendarWorkspace ? "Search calendar" : "Search tasks"}
                      onChange={(event) => setTaskSearchQuery(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key !== "Escape") {
                          return;
                        }

                        event.preventDefault();
                        event.stopPropagation();

                        if (taskSearchQuery.trim()) {
                          setTaskSearchQuery("");
                        } else {
                          event.currentTarget.blur();
                        }
                      }}
                      placeholder={isNotesWorkspace ? "Search Folio..." : isCalendarWorkspace ? "Search calendar..." : "Search tasks..."}
                      className="min-w-0 flex-1 bg-transparent text-[11px] font-medium leading-4 text-foreground outline-none placeholder:text-muted"
                    />
                    {taskSearchQuery ? (
                      <button
                        type="button"
                        onClick={() => setTaskSearchQuery("")}
                        className="ui-button ui-button-surface inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[7px] border border-border/60 text-muted transition hover:text-foreground"
                        aria-label="Clear task search"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    ) : null}
                  </div>
                  {isTaskSearchActive && !isRoutedWorkspace ? (
                    <span className="shrink-0 whitespace-nowrap text-[10px] font-semibold leading-4 text-muted">
                      {visibleTaskCount} match{visibleTaskCount === 1 ? "" : "es"}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => openPaletteMode(buildMainPaletteMode())}
                    className={`taskboard-palette-button ${SMALL_CHIP_BUTTON_CLASS} h-8 shrink-0 gap-1 px-2 max-md:hidden`}
                    title="Command palette: run any action by name (Ctrl+K)"
                    aria-label="Open command palette"
                    data-testid="open-command-palette"
                  >
                    <kbd className="taskboard-kbd">Ctrl</kbd>
                    <kbd className="taskboard-kbd">K</kbd>
                  </button>
                </div>

                {!isRoutedWorkspace && isImportOpen ? (
                <div className="flex flex-wrap items-center gap-1.5 sm:justify-end">
                <div ref={importSurfaceRef} className="relative">
                  {isImportOpen ? (
                    <div
                      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/35 p-3"
                      onClick={(event) => {
                        if (event.target === event.currentTarget) closeImport();
                      }}
                    >
                    <div className="taskboard-overlay-panel panel-surface panel-strong pretty-scrollbar grid max-h-[min(88vh,980px)] w-[min(1040px,calc(100vw-1.5rem))] gap-2 overflow-auto rounded-[22px] border p-3 shadow-2xl">
                      <div className="flex flex-wrap items-center justify-between gap-1">
                        <div>
                          <p className={COMPACT_LABEL_CLASS}>Import workflow</p>
                          <p className={EMPTY_STATE_TEXT_CLASS}>
                            Paste Taskboard JSON or upload an .ics calendar file.
                          </p>
                          <div className="mt-1 flex flex-wrap gap-1 text-[10px] font-medium leading-4">
                            {["Source", "Input", "Review", "Create"].map((step, index) => {
                              const activeStep =
                                importMode === "ics"
                                  ? index <= (importFile ? 2 : 1)
                                  : index <= (bulkImportDraftTasks.length > 0 ? 2 : 1);

                              return (
                                <span
                                  key={step}
                                  className={`rounded-full border px-2 py-0.5 ${
                                    activeStep
                                      ? "border-sky-500/30 bg-sky-500/10 text-foreground"
                                      : "border-border/70 text-muted"
                                  }`}
                                >
                                  {step}
                                </span>
                              );
                            })}
                          </div>
                        </div>
                        <div className="flex flex-wrap items-start gap-1">
                          <button
                            type="button"
                            onClick={() => setImportMode("ics")}
                            className={importMode === "ics" ? CHIP_BUTTON_ACTIVE_CLASS : CHIP_BUTTON_CLASS}
                          >
                            .ics import
                          </button>
                          <button
                            type="button"
                            onClick={() => setImportMode("bulk")}
                            className={importMode === "bulk" ? CHIP_BUTTON_ACTIVE_CLASS : CHIP_BUTTON_CLASS}
                          >
                            Bulk task import
                          </button>
                          <SurfaceCloseButton onClick={closeImport} label="Close import" />
                        </div>
                      </div>

                      {importMode === "ics" ? (
                        <>
                          <div>
                            <label className={COMPACT_LABEL_CLASS} htmlFor="ics-import-file">
                              Calendar file
                            </label>
                            <input
                              key={importInputKey}
                              id="ics-import-file"
                              type="file"
                              accept=".ics,text/calendar"
                              onChange={(event) => {
                                setImportFile(event.target.files?.[0] ?? null);
                                setImportMessage("");
                                setImportErrors([]);
                              }}
                              className="ui-control w-full rounded-[8px] border px-2 py-1 text-[10px] leading-4 text-foreground file:mr-2 file:rounded-full file:border-0 file:bg-transparent file:text-[10px] file:font-medium file:text-foreground"
                            />
                          </div>
                          <div className="flex items-center justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => void handleImportIcs()}
                              disabled={isImporting || !importFile || !persistenceEnabled}
                              className={COMPACT_PRIMARY_BUTTON_CLASS}
                            >
                              {isImporting ? "Importing" : "Import"}
                            </button>
                            <button
                              type="button"
                              onClick={closeImport}
                              className={COMPACT_SURFACE_BUTTON_CLASS}
                            >
                              Close
                            </button>
                          </div>
                        </>
                      ) : (
                        <>
                            <div className="space-y-1.5">
                              <label className={COMPACT_LABEL_CLASS} htmlFor="bulk-import-json">
                                Taskboard JSON
                              </label>
                              <textarea
                                id="bulk-import-json"
                                value={bulkImportRawText}
                                onChange={(event) => setBulkImportRawText(event.target.value)}
                                placeholder={"```json\n{\n  \"version\": 1,\n  \"tasks\": [\n    {\"bucket\": \"Inbox\", \"title\": \"Example task\"}\n  ]\n}\n```"}
                                className="ui-control min-h-[220px] w-full rounded-[10px] border px-2 py-1.5 text-[10px] leading-4 text-foreground"
                              />
                              <p className={EMPTY_STATE_TEXT_CLASS}>
                                Paste raw JSON or a fenced JSON block.
                              </p>
                            </div>

                          <div className="flex flex-wrap items-center justify-between gap-1">
                            <div className="flex flex-wrap gap-1">
                              <button
                                type="button"
                                onClick={handleParseBulkImport}
                                disabled={!bulkImportRawText.trim()}
                                className={COMPACT_PRIMARY_BUTTON_CLASS}
                              >
                                Parse preview
                              </button>
                              <button
                                type="button"
                                onClick={() => {
                                  setBulkImportInfo("");
                                  resetBulkImportState();
                                }}
                                className={COMPACT_SURFACE_BUTTON_CLASS}
                              >
                                Clear
                              </button>
                            </div>
                            <button
                              type="button"
                              onClick={closeImport}
                              className={COMPACT_SURFACE_BUTTON_CLASS}
                            >
                              Close
                            </button>
                          </div>

                          {bulkImportDraftTasks.length > 0 ? (
                            <div className="grid gap-2 lg:grid-cols-[minmax(0,0.7fr)_minmax(0,1.3fr)]">
                              <div className="space-y-2">
                                <div className="taskboard-section-card rounded-[12px] border p-2">
                                  <p className={COMPACT_LABEL_CLASS}>Bucket review</p>
                                  {bulkImportMissingBucketNames.length === 0 ? (
                                    <p className={EMPTY_STATE_TEXT_CLASS}>
                                      All bucket names match existing buckets.
                                    </p>
                                  ) : (
                                    <div className="space-y-2">
                                      {bulkImportMissingBucketNames.map((bucketName) => {
                                        const decision =
                                          bulkImportBucketDecisions[
                                            normalizeBulkImportBucketKey(bucketName)
                                          ];

                                        if (!decision) {
                                          return null;
                                        }

                                        return (
                                          <div
                                            key={bucketName}
                                            className="rounded-[10px] border border-border/70 p-2"
                                          >
                                            <p className="text-[10px] font-semibold leading-4 text-foreground">
                                              {bucketName}
                                            </p>
                                            <div className="mt-1 flex flex-wrap gap-1">
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  setBulkImportBucketDecisions((current) => ({
                                                    ...current,
                                                    [normalizeBulkImportBucketKey(bucketName)]: {
                                                      ...decision,
                                                      mode: "create",
                                                    },
                                                  }))
                                                }
                                                className={
                                                  decision.mode === "create"
                                                    ? CHIP_BUTTON_ACTIVE_CLASS
                                                    : CHIP_BUTTON_CLASS
                                                }
                                              >
                                                Create bucket
                                              </button>
                                              <button
                                                type="button"
                                                onClick={() =>
                                                  setBulkImportBucketDecisions((current) => ({
                                                    ...current,
                                                    [normalizeBulkImportBucketKey(bucketName)]: {
                                                      ...decision,
                                                      mode: "map",
                                                    },
                                                  }))
                                                }
                                                className={
                                                  decision.mode === "map"
                                                    ? CHIP_BUTTON_ACTIVE_CLASS
                                                    : CHIP_BUTTON_CLASS
                                                }
                                              >
                                                Map to existing
                                              </button>
                                            </div>
                                            {decision.mode === "create" ? (
                                              <input
                                                value={decision.createTitle}
                                                onChange={(event) =>
                                                  setBulkImportBucketDecisions((current) => ({
                                                    ...current,
                                                    [normalizeBulkImportBucketKey(bucketName)]: {
                                                      ...decision,
                                                      createTitle: event.target.value,
                                                    },
                                                  }))
                                                }
                                                className={`${COMPACT_INPUT_CLASS} mt-1`}
                                              />
                                            ) : (
                                              <select
                                                value={decision.targetBucketId}
                                                onChange={(event) =>
                                                  setBulkImportBucketDecisions((current) => ({
                                                    ...current,
                                                    [normalizeBulkImportBucketKey(bucketName)]: {
                                                      ...decision,
                                                      targetBucketId: event.target.value,
                                                    },
                                                  }))
                                                }
                                                className={`${TASK_EDITOR_SELECT_CLASS} mt-1`}
                                              >
                                                {bucketOptions.map((bucket) => (
                                                  <option key={bucket.id} value={bucket.id}>
                                                    {bucket.title}
                                                  </option>
                                                ))}
                                              </select>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-1 text-[10px] font-medium leading-4 text-muted">
                                  <span>{bulkImportDraftTasks.length} parsed</span>
                                  <span>{bulkImportIncludedCount} included</span>
                                  <span>{bulkImportExcludedCount} excluded</span>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => void handleSubmitBulkImport()}
                                  disabled={isBulkImportSubmitting || bulkImportIncludedCount === 0}
                                  className={COMPACT_PRIMARY_BUTTON_CLASS}
                                >
                                  {isBulkImportSubmitting ? "Creating" : "Create tasks"}
                                </button>
                              </div>

                              <div className="space-y-2">
                                <div className="flex flex-wrap items-center justify-between gap-1">
                                  <p className={COMPACT_LABEL_CLASS}>Review tasks</p>
                                  <div className="flex flex-wrap gap-1">
                                    <button
                                      type="button"
                                      onClick={() => setAllBulkImportTasksIncluded(true)}
                                      className={CHIP_BUTTON_CLASS}
                                    >
                                      Include all
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => setAllBulkImportTasksIncluded(false)}
                                      className={CHIP_BUTTON_CLASS}
                                    >
                                      Exclude all
                                    </button>
                                  </div>
                                </div>
                                <div className="pretty-scrollbar max-h-[420px] space-y-2 overflow-auto pr-1">
                                  {bulkImportDraftTasks.map((task) => (
                                    <div
                                      key={task.id}
                                      className={`taskboard-section-card rounded-[12px] border p-2 transition-opacity ${
                                        task.included ? "" : "opacity-55"
                                      }`}
                                    >
                                      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-1">
                                        <span className={COMPACT_LABEL_CLASS}>
                                          {task.included ? "Included in import" : "Excluded from import"}
                                        </span>
                                        <button
                                          type="button"
                                          onClick={() =>
                                            setBulkImportTaskIncluded(task.id, !task.included)
                                          }
                                          className={
                                            task.included
                                              ? CHIP_BUTTON_ACTIVE_CLASS
                                              : CHIP_BUTTON_CLASS
                                          }
                                        >
                                          {task.included ? "Included" : "Excluded"}
                                        </button>
                                      </div>
                                      <div className="grid gap-1.5 md:grid-cols-2">
                                        <label className="grid gap-0.5">
                                          <span className={COMPACT_LABEL_CLASS}>Bucket</span>
                                          <input
                                            value={task.bucket}
                                            onChange={(event) =>
                                              updateBulkImportDraftTask(task.id, {
                                                bucket: event.target.value,
                                              })
                                            }
                                            className={COMPACT_INPUT_CLASS}
                                          />
                                        </label>
                                        <label className="grid gap-0.5">
                                          <span className={COMPACT_LABEL_CLASS}>Status</span>
                                          <select
                                            value={task.status}
                                            onChange={(event) =>
                                              updateBulkImportDraftTask(task.id, {
                                                status: event.target.value as TaskStatus,
                                              })
                                            }
                                            className={TASK_EDITOR_SELECT_CLASS}
                                          >
                                            <option value="todo">Todo</option>
                                            <option value="active">Active</option>
                                            <option value="waiting">Waiting</option>
                                            <option value="done">Done</option>
                                          </select>
                                        </label>
                                        <label className="grid gap-0.5 md:col-span-2">
                                          <span className={COMPACT_LABEL_CLASS}>Title</span>
                                          <input
                                            value={task.title}
                                            onChange={(event) =>
                                              updateBulkImportDraftTask(task.id, {
                                                title: event.target.value,
                                              })
                                            }
                                            className={COMPACT_INPUT_CLASS}
                                          />
                                        </label>
                                        <label className="grid gap-0.5 md:col-span-2">
                                          <span className={COMPACT_LABEL_CLASS}>Summary</span>
                                          <input
                                            value={task.summary}
                                            onChange={(event) =>
                                              updateBulkImportDraftTask(task.id, {
                                                summary: event.target.value,
                                              })
                                            }
                                            className={COMPACT_INPUT_CLASS}
                                          />
                                        </label>
                                        <label className="grid gap-0.5 md:col-span-2">
                                          <span className={COMPACT_LABEL_CLASS}>Note</span>
                                          <textarea
                                            value={task.note}
                                            onChange={(event) =>
                                              updateBulkImportDraftTask(task.id, {
                                                note: event.target.value,
                                              })
                                            }
                                            className="ui-control min-h-[72px] w-full rounded-[8px] border px-2 py-1 text-[10px] leading-4 text-foreground"
                                          />
                                        </label>
                                        <label className="grid gap-0.5">
                                          <span className={COMPACT_LABEL_CLASS}>Labels</span>
                                          <input
                                            value={task.labelsText}
                                            onChange={(event) =>
                                              updateBulkImportDraftTask(task.id, {
                                                labelsText: event.target.value,
                                              })
                                            }
                                            className={COMPACT_INPUT_CLASS}
                                          />
                                        </label>
                                        <label className="grid gap-0.5">
                                          <span className={COMPACT_LABEL_CLASS}>Due date/time</span>
                                          <input
                                            value={task.dueAt ?? ""}
                                            onChange={(event) =>
                                              updateBulkImportDraftTask(task.id, {
                                                dueAt: event.target.value,
                                              })
                                            }
                                            placeholder="2026-06-03 or 2026-06-03T15:00:00Z"
                                            className={COMPACT_INPUT_CLASS}
                                          />
                                        </label>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              </div>
                            </div>
                          ) : null}
                        </>
                      )}

                      {!persistenceEnabled ? (
                        <p className={EMPTY_STATE_TEXT_CLASS}>
                          Database persistence is required for imports.
                        </p>
                      ) : null}
                      {importMessage ? (
                        <p className="rounded-[10px] border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-medium leading-4 text-foreground">
                          {importMessage}
                        </p>
                      ) : null}
                      {bulkImportInfo ? (
                        <p className="rounded-[10px] border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[10px] font-medium leading-4 text-foreground">
                          {bulkImportInfo}
                        </p>
                      ) : null}
                      {bulkImportWarnings.length > 0 ? (
                        <div className="rounded-[10px] border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[10px] font-medium leading-4 text-foreground">
                          {bulkImportWarnings.slice(0, 4).join(" ")}
                        </div>
                      ) : null}
                      {importErrors.length > 0 ? (
                        <div className="ui-danger-banner rounded-[10px] border px-2 py-1 text-[10px] font-medium leading-4">
                          {importErrors.slice(0, 4).join(" ")}
                        </div>
                      ) : null}
                    </div>
                    </div>
                  ) : null}
                </div>
                </div>
                ) : null}
              </div>
                </div>
              </div>
            </div>

            <div className="taskboard-header-nav-row w-full">
              <div className="taskboard-header-nav-inner flex w-full flex-wrap items-center gap-x-2.5 gap-y-1.5">
                <WorkspacePrimaryNav navRef={workspaceNavRef}
                  active={isNotesWorkspace ? "notes" : isCalendarWorkspace ? "calendar" : "tasks"}
                  tasksHref={buildTaskboardWorkspaceHref(isRoutedWorkspace ? lastTaskView : viewMode)}
                  calendarHref={isCalendarWorkspace ? buildCalendarWorkspaceHref(isOutageCalendarView) : calendarWorkspaceHref}
                  notesHref={notesWorkspaceHref} />

                {SHOW_SAVED_VIEWS && !isRoutedWorkspace ? (
                <div className="relative">
                  <button
                    ref={viewMenuButtonRef}
                    type="button"
                    onClick={() => setIsViewMenuOpen((current) => !current)}
                    className={SMALL_CHIP_BUTTON_CLASS}
                    aria-expanded={isViewMenuOpen}
                    aria-label="Saved views"
                  >
                    <span className="max-w-[180px] truncate">{activeView?.name ?? "Views"}</span>
                    <ChevronDown className="h-3 w-3" />
                  </button>
                  {isViewMenuOpen ? (
                    <FloatingMenuPortal
                      isOpen={isViewMenuOpen}
                      anchorRef={viewMenuButtonRef}
                      surfaceRef={viewMenuSurfaceRef}
                      preferredWidth={520}
                      align="start"
                      mobileSheet
                      className="taskboard-popover grid gap-2 rounded-[12px] border border-border/70 p-2 shadow-lg"
                    >
                      <p className={COMPACT_LABEL_CLASS}>Saved views</p>
                      <div className="grid gap-2">
                        <div className="grid content-start gap-1">
                          {builtInViews.map((view) => (
                            <button
                              key={view.id}
                              type="button"
                              onClick={() => {
                                handleSelectView(view);
                                setIsViewSettingsOpen(false);
                                setIsViewMenuOpen(false);
                              }}
                              className={`${COMPACT_MENU_ITEM_CLASS} justify-between gap-1.5`}
                            >
                              <span>{view.name}</span>
                              {activeView?.id === view.id ? <Check className="h-3 w-3" /> : null}
                            </button>
                          ))}
                        </div>

                        <div className="grid content-start gap-1">
                          <p className={COMPACT_LABEL_CLASS}>Saved views</p>
                          {savedViews.length > 0 ? (
                            savedViews.map((view) => (
                              <button
                                key={view.id}
                                type="button"
                                onClick={() => {
                                  handleSelectView(view);
                                  setIsViewSettingsOpen(false);
                                  setIsViewMenuOpen(false);
                                }}
                                className={`${COMPACT_MENU_ITEM_CLASS} justify-between gap-1.5`}
                              >
                                <span>{view.name}</span>
                                {activeView?.id === view.id ? <Check className="h-3 w-3" /> : null}
                              </button>
                            ))
                          ) : (
                            <p className={EMPTY_STATE_TEXT_CLASS}>No saved views yet.</p>
                          )}
                        </div>
                      </div>

                      <div className="border-t border-border/70 pt-2">
                        <p className={COMPACT_LABEL_CLASS}>Actions</p>
                        <div className="grid gap-1">
                          <button
                            type="button"
                            onClick={() => void handleCreateView()}
                            className={`${COMPACT_MENU_ITEM_CLASS} gap-1.5`}
                          >
                            <Plus className="h-3 w-3" />
                            Save current view
                          </button>
                          <button
                            type="button"
                            onClick={() => setIsViewSettingsOpen((current) => !current)}
                            disabled={!activeView}
                            className={`${COMPACT_MENU_ITEM_CLASS} gap-1.5`}
                          >
                            <Pencil className="h-3 w-3" />
                            Edit/Rename
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setIsViewSettingsOpen(false);
                              void handleDeleteActiveView();
                            }}
                            className={`${COMPACT_MENU_ITEM_CLASS} gap-1.5`}
                          >
                            <Trash2 className="h-3 w-3" />
                            Delete view
                          </button>
                        </div>
                      </div>

                      {isViewSettingsOpen && activeView ? (
                        <div ref={viewSettingsSurfaceRef}>
                          <ViewSettingsPanel
                            key={activeView.id}
                            view={activeView}
                            buckets={board.buckets}
                            labels={boardLabels}
                            onCancel={() => setIsViewSettingsOpen(false)}
                            onSave={(patch) => void handleUpdateActiveView(patch)}
                          />
                        </div>
                      ) : null}
                    </FloatingMenuPortal>
                  ) : null}
                </div>
                ) : null}

                <div className="taskboard-header-tools flex min-w-0 flex-wrap items-center gap-1 sm:ml-auto sm:justify-end">
                  {!isRoutedWorkspace ? (
                    <button
                    type="button"
                    onClick={() => setIsAddingBucket(true)}
                    disabled={!currentBoardPermissions.canEdit}
                    className={`${SMALL_CHIP_BUTTON_CLASS} justify-center gap-1 px-2`}
                    aria-label="Add bucket"
                    title="Add bucket"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Bucket</span>
                  </button>
                  ) : null}
                  {!phoneViewport.isPhone && persistenceEnabled && isPersonalActiveBoard ? (
                    <NotificationsControl
                      persistenceEnabled
                      onOpenTask={handleSelectTask}
                    />
                  ) : null}
                  <div className="relative">
                    <button
                      ref={moreMenuButtonRef}
                      type="button"
                      onClick={() => {
                        setIsMoreMenuOpen((current) => !current);
                      }}
                      className={`${SMALL_CHIP_BUTTON_CLASS} w-7 justify-center px-0`}
                      aria-expanded={isMoreMenuOpen}
                      aria-label="Menu"
                      title="Menu"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                    {!phoneViewport.isPhone && isMoreMenuOpen ? (
                      <FloatingMenuPortal
                        isOpen={isMoreMenuOpen}
                        anchorRef={moreMenuButtonRef}
                        surfaceRef={moreMenuSurfaceRef}
                        preferredWidth={420}
                        align="end"
                        mobileSheet
                        className="taskboard-popover grid gap-2 rounded-[12px] border border-border/70 p-2 shadow-lg"
                      >
                        <div className="flex items-center justify-between">
                          <p className={COMPACT_LABEL_CLASS}>Menu</p>
                          <SurfaceCloseButton label="Close menu" onClick={() => {
                            setIsMoreMenuOpen(false);
                            moreMenuButtonRef.current?.focus();
                          }} />
                        </div>

                        <div className="grid gap-2">
                          <div className="grid content-start gap-1 border-b border-border/70 pb-2">
                            <p className={`${COMPACT_LABEL_CLASS} px-1.5`}>Capture</p>
                            <button
                              type="button"
                              onClick={() => {
                                setIsMoreMenuOpen(false);

                                if (isNotesWorkspace) {
                                  setNoteCreateRequest((current) => current + 1);
                                } else {
                                  router.push(buildNotesHref({ createNew: true }));
                                }
                              }}
                              disabled={!persistenceEnabled}
                              className={MENU_ROW_CLASS}
                            >
                              <StickyNote className="h-3 w-3" />
                              <span>New note</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                if (!requirePersonalBoardAction("Import")) {
                                  return;
                                }
                                setIsImportOpen(true);
                                setIsMoreMenuOpen(false);
                              }}
                              disabled={!persistenceEnabled || !isPersonalActiveBoard}
                              title={isPersonalActiveBoard ? "Import" : "Import is only available on your personal board."}
                              className={MENU_ROW_CLASS}
                            >
                              <Upload className="h-3 w-3" />
                              <span>Import</span>
                            </button>
                          </div>

                          <div className="grid content-start gap-1 border-b border-border/70 pb-2">
                            <p className={`${COMPACT_LABEL_CLASS} px-1.5`}>Manage</p>
                            <button
                              type="button"
                              onClick={() => {
                                setIsMoreMenuOpen(false);
                                void handleOpenRecycleBin();
                              }}
                              disabled={!persistenceEnabled}
                              className={MENU_ROW_CLASS}
                            >
                              <Trash2 className="h-3 w-3" />
                              <span>Recycle Bin</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setIsMoreMenuOpen(false);
                                void handleOpenArchives();
                              }}
                              disabled={!persistenceEnabled}
                              className={MENU_ROW_CLASS}
                            >
                              <Archive className="h-3 w-3" />
                              <span>Archives</span>
                              {doneRootTasks.length > 0 ? (
                                <span className="ml-auto text-[10px] font-semibold text-muted">
                                  {doneRootTasks.length} done
                                </span>
                              ) : null}
                            </button>
                          </div>

                          <div className="grid content-start gap-1">
                            <p className={`${COMPACT_LABEL_CLASS} px-1.5`}>Options</p>
                            <Link
                              href={optionsHref}
                              className={MENU_ROW_CLASS}
                              onClick={() => setIsMoreMenuOpen(false)}
                            >
                              <Settings2 className="h-3 w-3" />
                              <span>Options</span>
                            </Link>
                            <Link
                              href="/teams"
                              className={MENU_ROW_CLASS}
                              onClick={() => setIsMoreMenuOpen(false)}
                            >
                              <Users className="h-3 w-3" />
                              <span>Teams</span>
                            </Link>
                            {currentUser.role === "admin" ? (
                              <>
                                <Link
                                  href="/admin/users"
                                  className={MENU_ROW_CLASS}
                                  onClick={() => setIsMoreMenuOpen(false)}
                                >
                                  <UserCog className="h-3 w-3" />
                                  <span>User administration</span>
                                </Link>
                                <Link
                                  href="/admin/settings/permissions"
                                  className={MENU_ROW_CLASS}
                                  onClick={() => setIsMoreMenuOpen(false)}
                                >
                                  <ShieldCheck className="h-3 w-3" />
                                  <span>Permission settings</span>
                                </Link>
                                <Link
                                  href="/admin/audit"
                                  className={MENU_ROW_CLASS}
                                  onClick={() => setIsMoreMenuOpen(false)}
                                >
                                  <ClipboardList className="h-3 w-3" />
                                  <span>Audit log</span>
                                </Link>
                              </>
                            ) : null}
                            {!externalAuthOnly ||
                            externalAccountActions.logoutUrl ||
                            externalAccountActions.changePasswordUrl ? (
                              <div className="mt-1 border-t border-border/70 pt-2">
                                <p className={`${COMPACT_LABEL_CLASS} px-1.5`}>Account/System</p>
                                {externalAccountActions.changePasswordUrl ? (
                                  <a
                                    href={externalAccountActions.changePasswordUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                    className={MENU_ROW_CLASS}
                                    onClick={() => setIsMoreMenuOpen(false)}
                                  >
                                    <KeyRound className="h-3 w-3" />
                                    <span>Change Password</span>
                                  </a>
                                ) : null}
                                {!externalAuthOnly || externalAccountActions.logoutUrl ? (
                                  <button
                                    type="button"
                                    onClick={() => void handleLogout()}
                                    className={MENU_ROW_CLASS}
                                  >
                                    <LogOut className="h-3 w-3" />
                                    <span>Logout</span>
                                  </button>
                                ) : null}
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </FloatingMenuPortal>
                    ) : null}
                  </div>
                  {!isRoutedWorkspace && isAddingBucket ? (
                    <div className="taskboard-popover inline-flex h-7 items-center gap-1 rounded-full border px-2 py-1">
                      <input
                        value={newBucketTitle}
                        onChange={(event) => setNewBucketTitle(event.target.value)}
                        onKeyDown={(event) => {
                          handlePlainEnterSubmit(event, submitNewBucket);
                        }}
                        placeholder="New bucket"
                        className={`w-28 bg-transparent font-medium text-foreground outline-none placeholder:text-muted ${COMPACT_CONTROL_TEXT_CLASS}`}
                      />
                      <button
                        type="button"
                        onClick={submitNewBucket}
                        className={COMPACT_PRIMARY_BUTTON_CLASS}
                      >
                        Add
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setIsAddingBucket(false);
                          setNewBucketTitle("");
                        }}
                        aria-label="Cancel new bucket"
                        className="ui-button ui-button-surface rounded-full border p-1 text-muted transition hover:text-foreground"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </header>

        {mutationError ? (
          <div
            role="alert"
            className="ui-danger-banner flex items-start justify-between gap-2 rounded-[16px] border px-3 py-2 text-[10px] font-medium leading-4"
          >
            <span className="min-w-0">{mutationError}</span>
            <button
              type="button"
              onClick={() => setMutationError("")}
              className="shrink-0 rounded-full p-0.5 opacity-80 transition hover:opacity-100"
              aria-label="Dismiss message"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ) : null}
        {taskMenu ? (
          <ContextMenu anchor={taskMenu.anchor} label="Task actions" actions={taskMenuActions} onClose={closeTaskMenu} />
        ) : null}
        {paletteMode ? (
          <CommandPalette key={paletteMode.title} mode={paletteMode} onClose={() => setPaletteMode(null)} />
        ) : null}
        {taskForTime ? <TaskActionTimeDialog task={taskForTime} onClose={closeTaskTimeDialog}
          onSave={(patch) => saveTaskInQueue(taskForTime.id, patch)} /> : null}
        {isShortcutSheetOpen ? (
          <ShortcutSheet
            onClose={() => setIsShortcutSheetOpen(false)}
            optionsHref={optionsHref}
            singleKeysEnabled={settings.singleKeyShortcuts}
          />
        ) : null}
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed inset-x-0 bottom-4 z-[95] flex justify-center px-4"
        >
          {undoToast ? (
            <div
              className="taskboard-popover pointer-events-auto flex max-w-[min(32rem,100%)] items-center gap-3 rounded-[12px] border px-3 py-2 text-[11px] font-medium leading-4 text-foreground shadow-lg"
              data-testid="undo-toast"
              data-keep-surfaces-open="true"
            >
              <span className="min-w-0">{undoToast.message}</span>
              <button
                type="button"
                onClick={() => {
                  const toast = undoToast;
                  setUndoToast(null);
                  void toast.onUndo();
                }}
                className={`${COMPACT_PRIMARY_BUTTON_CLASS} shrink-0`}
              >
                Undo
              </button>
              <button
                type="button"
                onClick={() => setUndoToast(null)}
                className="shrink-0 rounded-full p-0.5 text-muted transition hover:text-foreground"
                aria-label="Dismiss"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ) : null}
        </div>
        {!isNotesWorkspace ? <WorkspaceSubviews
          kind={isCalendarWorkspace ? "Calendar" : "Tasks"}
          active={isCalendarWorkspace ? isOutageCalendarView ? "outages" : "calendar" : viewMode}
          items={isCalendarWorkspace ? [
            { id: "calendar", label: "Calendar", href: calendarWorkspaceHref },
            { id: "outages", label: "Outages", href: outageCalendarWorkspaceHref },
          ] : [
            { id: "board", label: "Board", href: taskboardWorkspaceHref },
            { id: "agenda", label: "Agenda", href: agendaWorkspaceHref },
            { id: "focus", label: "Focus", href: focusWorkspaceHref },
          ]}
          onSelect={!isCalendarWorkspace ? id => goToView(id as ViewMode) : undefined}
        /> : null}
        <div className={`taskboard-workspace-row flex flex-col ${mainGapClass} md:flex-row`}>
          <section
            ref={boardStageRef}
            className={`panel-surface panel-strong pretty-scrollbar flex min-h-[78vh] min-w-0 flex-1 flex-col rounded-[28px] ${
              isCalendarWorkspace
                ? "taskboard-calendar-stage overflow-visible"
                : isNotesWorkspace
                  ? "taskboard-notes-stage overflow-visible"
                  : "overflow-hidden"
            }`}
            data-testid={isCalendarWorkspace ? "calendar-stage" : isNotesWorkspace ? "notes-stage" : "board-stage"}
          >
            {notesWorkspace ? (
              <FolioWorkspace
                key={[notesWorkspace.sessionKey,notesWorkspace.initialNoteId,notesWorkspace.initialSpaceId,notesWorkspace.initialBoardId,notesWorkspace.initialLinkTaskId,notesWorkspace.createOnOpen?'new':'open'].join(':')}
                {...notesWorkspace}
                createRequest={noteCreateRequest}
                searchQuery={taskSearchQuery}
                onClearSearch={() => setTaskSearchQuery("")}
                viewerId={currentUser.id ?? currentUser.email}
                isPhone={phoneViewport.isPhone}
              />
            ) : calendarWorkspace ? (
              <CalendarProofApp
                {...calendarWorkspace}
                boardContext={calendarBoardContext ?? calendarWorkspace.boardContext}
                boardBuckets={calendarBoardBuckets}
                boardOptions={calendarBoardOptions}
                calendarEntries={calendarEntries}
                canEditBoard={boardAccess.canEdit}
                sourceEvents={calendarSourceEvents}
                taskEvents={calendarTaskEvents}
                onCalendarDataChanged={checkBoardRevisionNow}
                isPhone={phoneViewport.isPhone}
                phoneActionsRef={phoneCalendarActionsRef}
                onPhoneBoardChange={(boardId) => {
                  const target = accessibleBoards.find(item => item.boardId === boardId);
                  if (target) void handleSelectAccessibleBoard(target);
                }}
                embeddedInTaskboardShell
                onSidebarTaskSelect={(taskId) => {
                  if (taskId) {
                    stableHandleSelectTask(taskId);
                  } else {
                    stableHandleCloseInspector();
                  }
                }}
                onOutageViewChange={setIsOutageCalendarView}
                onTaskSchedulesUpdated={(updates) => {
                  setBoard((current) => updateTaskSchedulesInBoard(current, updates));
                }}
                searchQuery={taskSearchQuery}
                selectedTaskId={navigationTaskId}
              />
            ) : (
            <div
              className="taskboard-board-scroll pretty-scrollbar flex flex-1 flex-col overflow-auto p-1.5 outline-none md:p-2"
              data-task-menu-surface=""
              tabIndex={-1}
              onContextMenu={handleTaskSurfaceContextMenu}
              onKeyDown={handleTaskSurfaceKeyDown}
            >
              {isTaskSearchActive && visibleTaskCount === 0 ? (
                <div className={`taskboard-subtle-surface rounded-[18px] border border-dashed p-4 text-center ${EMPTY_STATE_TEXT_CLASS}`}>
                  <p>No tasks match your search.</p>
                  <button
                    type="button"
                    onClick={() => setTaskSearchQuery("")}
                    className={`${COMPACT_SURFACE_BUTTON_CLASS} mt-2`}
                  >
                    Clear search
                  </button>
                </div>
              ) : viewMode === "agenda" ? (
                <div className="w-full max-w-full">
                  <AgendaPreview
                    board={visibleBoard}
                    calendarEntries={calendarEntries}
                    calendarSourceEvents={calendarSourceEvents}
                    canEdit={currentBoardPermissions.canEdit}
                    onMoveOverdueToToday={stableHandleMoveOverdueToToday}
                    onSelectTask={stableHandleSelectTask}
                  />
                </div>
              ) : viewMode === "focus" ? (
                <div className="w-full max-w-full">
                  <FocusPreview
                    board={visibleBoard}
                    detailLevel={settings.cardDetailLevel}
                    selectedTaskId={selectedTaskId}
                    onSelectTask={stableHandleSelectTask}
                  />
                </div>
              ) : (
                <DndContext
                  id="taskboard-board-dnd"
                  sensors={sensors}
                  collisionDetection={collisionDetectionStrategy}
                  onDragPending={stableHandleDragPending}
                  onDragAbort={stableHandleDragAbort}
                  onDragStart={stableHandleDragStart}
                  onDragCancel={stableHandleDragCancel}
                  onDragOver={stableHandleDragOver}
                  // onDragOver fires only when the hovered item changes, so the
                  // before/after placement would go stale while the pointer moves
                  // within one card (e.g. down past a bucket's last card).
                  // Re-evaluate on every move; unchanged previews are no-ops.
                  onDragMove={stableHandleDragOver}
                  onDragEnd={stableHandleDragEnd}
                >
                  <SortableContext
                    items={visibleBoard.buckets.map((bucket) => getBucketColumnSortableId(bucket.id))}
                    strategy={rectSortingStrategy}
                  >
                    <div
                      className={`taskboard-bucket-grid grid w-full ${boardGridGapClass}`}
                      style={{
                        gridTemplateColumns: `repeat(auto-fill,minmax(min(100%,${bucketMinWidth}),${bucketMinWidth}))`,
                      } as CSSProperties}
                    >
                      {visibleBoard.buckets.length === 0 ? (
                        <div className={`panel-surface rounded-[20px] px-4 py-6 text-center ${EMPTY_STATE_TEXT_CLASS}`}>
                          No tasks match this saved view.
                        </div>
                      ) : null}
                      {visibleBoard.buckets.map((bucket) => (
                        <BucketColumn
                          key={bucket.id}
                          bucket={bucket}
                          bucketIndex={bucketOrderIndexById.get(bucket.id) ?? 0}
                          bucketCount={board.buckets.length}
                          compactCards={resolvedCompactCards}
                          detailLevel={settings.cardDetailLevel}
                          selectedTaskId={selectedTaskId}
                          calendarArrivalTaskId={calendarArrivalTaskId}
                          onSelectTask={stableHandleSelectTask}
                          onCreateTask={stableHandleCreateTask}
                          onRenameBucket={stableHandleRenameBucket}
                          onUpdateBucketStyle={stableHandleUpdateBucketStyle}
                          onMoveBucket={stableHandleMoveBucket}
                          onDeleteBucket={stableHandleDeleteBucket}
                          onToggleCollapse={stableToggleBucketCollapse}
                          isDropTarget={hoveredBucketId === bucket.id}
                          taskDropPreview={
                            taskDropPreview?.targetBucketId === bucket.id ? taskDropPreview : null
                          }
                          draggedTask={activeTask}
                          isBucketDragDisabled={isTaskSearchActive || !currentBoardPermissions.canEdit}
                          isTaskDragDisabled={isTaskSearchActive || !currentBoardPermissions.canEdit}
                          canEditBoard={currentBoardPermissions.canEdit}
                          canManageTaskLifecycle={currentBoardPermissions.canManageLifecycle}
                          quickAddRequestNonce={
                            quickAddRequest?.bucketId === bucket.id ? quickAddRequest.nonce : null
                          }
                          notesEnabled={persistenceEnabled}
                          noteCount={bucketNoteCounts[bucket.id] ?? 0}
                          boardId={board.id}
                        />
                      ))}
                    </div>
                  </SortableContext>
                  {typeof document !== "undefined"
                    ? createPortal(
                        <DragOverlay adjustScale={false} dropAnimation={null}>
                      {activeBucketDrag ? (
                            <div
                              className="taskboard-shell taskboard-drag-overlay-root"
                              style={{ width: `min(calc(100vw - 2rem), ${bucketMinWidth})` }}
                            >
                              <BucketDragPreview bucket={activeBucketDrag} />
                            </div>
                          ) : activeTask ? (
                            <div
                              className="taskboard-shell taskboard-drag-overlay-root"
                              style={{ width: `min(calc(100vw - 2rem), ${bucketMinWidth})` }}
                            >
                              {activeTaskPreviewMode === "collapsed" ? (
                                <CollapsedTaskDragPreview
                                  task={activeTask}
                                  isSelected={activeTask.id === selectedTaskId}
                                />
                              ) : (
                                <TaskCard
                                  task={activeTask}
                                  compactCards={resolvedCompactCards}
                                  detailLevel={settings.cardDetailLevel}
                                  isSelected={activeTask.id === selectedTaskId}
                                />
                              )}
                            </div>
                          ) : null}
                        </DragOverlay>,
                        document.body,
                      )
                    : null}
                </DndContext>
              )}
            </div>
            )}
          </section>

          {activeDetailPanelMode === "sidebar" && isInspectorVisible && !(isCalendarWorkspace && phoneViewport.isPhone) ? (
            <aside
              ref={taskSidebarRef}
              className={`taskboard-task-sidebar taskboard-inspector-shell panel-surface min-w-0 h-[calc(100dvh-var(--taskboard-sidebar-sticky-top,7rem)-0.75rem)] max-h-[calc(100dvh-1.5rem)] max-w-full w-full shrink-0 self-start overflow-hidden rounded-[18px] md:sticky ${sidebarWidthClass}`}
              style={{ scrollbarGutter: "stable" }}
              data-sidebar-width={settings.sidebarWidth}
              data-testid="task-editor-sidebar"
              data-task-menu-surface=""
              onContextMenu={handleTaskSurfaceContextMenu}
              onKeyDown={handleTaskSurfaceKeyDown}
            >
              <TaskDetailPanel
                viewerId={currentUser.id ?? currentUser.email}
                publicSharesEnabled={publicSharesEnabled}
                task={selectedTask}
                isArchived={isSelectedTaskArchived}
                isRootTask={
                  selectedTask
                    ? isSelectedTaskArchived || !boardIndex.parentByTaskId.get(selectedTask.id)
                    : false
                }
                bucketOptions={bucketOptions}
                currentBucketId={
                  isSelectedTaskArchived
                    ? retainedArchivedTask?.bucketId ?? null
                    : selectedTask
                      ? boardIndex.bucketIdByTaskId.get(selectedTask.id) ?? null
                      : null
                }
                mode="sidebar"
                emptyStateNewTaskBucket={emptyStateNewTaskBucket}
                focusView={focusView}
                todayView={todayView}
                onCloseInspector={stableHandleCloseInspector}
                onCreateTask={stableHandleCreateTask}
                maintenanceLocations={board.maintenanceLocations ?? []}
                onCreateMaintenanceLocation={handleCreateMaintenanceLocation}
                onOpenView={stableHandleOpenView}
                onRegisterTextFlush={(flush) => {
                  taskEditorTextFlushRef.current = flush;
                }}
                onExpand={stableHandleOpenExpandedTaskDetail}
                onCollapse={stableHandleCloseInspector}
                onSaveTask={saveTaskInQueue}
                saveQueue={taskSaves}
                onPeopleRosterChanged={handlePeopleRosterChanged}
                onArchiveTask={handleArchiveTask}
                onDeleteTask={handleDeleteTask}
                onConvertImportedTask={handleConvertImportedTask}
                onCreateFollowUpTask={handleCreateFollowUpTask}
                onAddSubtask={handleAddSubtask}
                onMoveSubtask={handleMoveSubtask}
                onChecklistAdd={handleChecklistAdd}
                onChecklistUpdate={handleChecklistUpdate}
                onChecklistDelete={handleChecklistDelete}
                onUploadAttachments={handleUploadAttachments}
                onDeleteAttachment={handleDeleteAttachment}
                onRenameAttachment={handleRenameAttachment}
                onCreateNote={handleCreateNote}
                onUpdateNote={handleUpdateNote}
                onDeleteNote={handleDeleteNote}
                onUploadNoteAttachments={handleUploadNoteAttachments}
                attachmentsEnabled={persistenceEnabled}
                activeBoardId={currentBoardId}
                canEditBoard={currentBoardPermissions.canEdit}
                canManageTaskLifecycle={currentBoardPermissions.canManageLifecycle}
                calendarHandoffActive={Boolean(
                  calendarArrivalTaskId && selectedTask?.id === calendarArrivalTaskId,
                )}
              />
            </aside>
          ) : null}
        </div>
      </div>
      {activeDetailPanelMode === "expanded" && selectedTask && typeof document !== "undefined"
        ? createPortal(
            <div className="taskboard-shell taskboard-workspace-overlay fixed inset-0 z-50 flex items-stretch justify-center overflow-hidden p-3 sm:p-4">
              <button
                type="button"
                onClick={handleCollapseExpandedTaskDetail}
                className="absolute inset-0 bg-[rgba(20,16,12,0.5)]"
                aria-label="Collapse expanded task panel"
              />
              <section
                ref={expandedDetailPanelRef}
                className="taskboard-overlay-panel taskboard-task-workspace-panel panel-surface panel-strong pretty-scrollbar relative z-10 flex h-full min-h-0 w-[min(2400px,calc(100vw-24px))] max-h-full flex-col overflow-hidden rounded-[32px]"
                aria-label="Expanded task workspace"
                data-testid="task-editor-expanded"
                data-task-menu-surface=""
                onContextMenu={handleTaskSurfaceContextMenu}
                onKeyDown={handleTaskSurfaceKeyDown}
              >
                <TaskDetailPanel
                  viewerId={currentUser.id ?? currentUser.email}
                  publicSharesEnabled={publicSharesEnabled}
                  key={selectedTask.id}
                  task={selectedTask}
                  focusedSubtaskId={focusedSubtaskId}
                  isArchived={isSelectedTaskArchived}
                  isRootTask={
                    isSelectedTaskArchived || !boardIndex.parentByTaskId.get(selectedTask.id)
                  }
                  bucketOptions={bucketOptions}
                  currentBucketId={
                    isSelectedTaskArchived
                      ? retainedArchivedTask?.bucketId ?? null
                      : boardIndex.bucketIdByTaskId.get(selectedTask.id) ?? null
                  }
                  mode="expanded"
                  emptyStateNewTaskBucket={emptyStateNewTaskBucket}
                  focusView={focusView}
                  todayView={todayView}
                  onCloseInspector={stableHandleCloseInspector}
                  onCreateTask={stableHandleCreateTask}
                  maintenanceLocations={board.maintenanceLocations ?? []}
                  onCreateMaintenanceLocation={handleCreateMaintenanceLocation}
                  onOpenView={stableHandleOpenView}
                  onRegisterTextFlush={(flush) => {
                    taskEditorTextFlushRef.current = flush;
                  }}
                  onExpand={stableHandleOpenExpandedTaskDetail}
                  onCollapse={stableHandleCollapseExpandedTaskDetail}
                  onSaveTask={saveTaskInQueue}
                  saveQueue={taskSaves}
                  onPeopleRosterChanged={handlePeopleRosterChanged}
                  onArchiveTask={handleArchiveTask}
                  onDeleteTask={handleDeleteTask}
                  onConvertImportedTask={handleConvertImportedTask}
                  onCreateFollowUpTask={handleCreateFollowUpTask}
                  onAddSubtask={handleAddSubtask}
                  onMoveSubtask={handleMoveSubtask}
                  onChecklistAdd={handleChecklistAdd}
                  onChecklistUpdate={handleChecklistUpdate}
                  onChecklistDelete={handleChecklistDelete}
                  onUploadAttachments={handleUploadAttachments}
                  onDeleteAttachment={handleDeleteAttachment}
                  onRenameAttachment={handleRenameAttachment}
                  onCreateNote={handleCreateNote}
                  onUpdateNote={handleUpdateNote}
                  onDeleteNote={handleDeleteNote}
                  onUploadNoteAttachments={handleUploadNoteAttachments}
                  attachmentsEnabled={persistenceEnabled}
                  activeBoardId={currentBoardId}
                  canEditBoard={currentBoardPermissions.canEdit}
                  canManageTaskLifecycle={currentBoardPermissions.canManageLifecycle}
                />
              </section>
            </div>,
            document.body,
          )
        : null}
      {isRecycleBinOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="taskboard-shell fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4">
              <button
                type="button"
                onClick={() => setIsRecycleBinOpen(false)}
                className="absolute inset-0 bg-[rgba(20,16,12,0.5)]"
                aria-label="Close recycle bin"
              />
              <div ref={recycleBinPanelRef} className="taskboard-overlay-panel panel-surface panel-strong pretty-scrollbar relative z-10 flex max-h-[min(82vh,920px)] w-[min(840px,calc(100vw-24px))] min-h-0 flex-col overflow-hidden rounded-[30px]">
                <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-foreground">Recycle Bin</h2>
                    <p className="mt-0.5 text-[10px] leading-4 text-muted">
                      Deleted tasks, subtasks, and imported calendar items stay here for 30 days before lazy purge.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsRecycleBinOpen(false)}
                    className={ICON_BUTTON_CLASS}
                    aria-label="Close recycle bin"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="pretty-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3">
                  {recycleBinInfo ? (
                    <div className="ui-info-banner mb-2 rounded-[14px] border px-3 py-2 text-[10px] font-medium leading-4">
                      {recycleBinInfo}
                    </div>
                  ) : null}
                  {recycleBinError ? (
                    <div className="ui-danger-banner rounded-[14px] border px-3 py-2 text-[10px] font-medium leading-4">
                      {recycleBinError}
                    </div>
                  ) : null}
                  {isRecycleBinLoading ? (
                    <div className="taskboard-subtle-surface rounded-[18px] border border-dashed p-4 text-center text-[10px] font-medium text-muted">
                      Loading recycle bin...
                    </div>
                  ) : recycleBinItems.length === 0 ? (
                    <div className="taskboard-subtle-surface rounded-[18px] border border-dashed p-4 text-center text-[10px] font-medium text-muted">
                      The recycle bin is empty.
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      {recycleBinItems.map((item) => {
                        const isBusy = recycleBinBusyTaskId === item.id;
                        return (
                          <article
                            key={item.id}
                            className="taskboard-subtle-surface rounded-[18px] border px-3 py-2.5"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-[11px] font-semibold text-foreground">
                                    {item.title}
                                  </span>
                                  <span className="taskboard-label-chip taskboard-label-chip-muted rounded-full px-2 py-0.5 text-[10px] font-medium">
                                    {item.providerLabel}
                                  </span>
                                  <span className="taskboard-label-chip taskboard-label-chip-muted rounded-full px-2 py-0.5 text-[10px] font-medium">
                                    {getRecycleBinItemTypeLabel(item)}
                                  </span>
                                  {item.convertedImport ? (
                                    <span className="taskboard-label-chip taskboard-label-chip-muted rounded-full px-2 py-0.5 text-[10px] font-medium">
                                      Converted
                                    </span>
                                  ) : null}
                                </div>
                                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] leading-4 text-muted">
                                  <span>Deleted {formatDate(item.deletedAt, displayTimeZone)}</span>
                                  <span>Auto-purge {formatDate(item.purgeAfterAt, displayTimeZone)}</span>
                                  <span>{formatRecycleBinTimeRemaining(item.purgeAfterAt)}</span>
                                  {item.parentTitle ? (
                                    <span>Subtask of {item.parentTitle}</span>
                                  ) : null}
                                  {item.originalBucketTitle ? (
                                    <span>From {item.originalBucketTitle}</span>
                                  ) : null}
                                  {item.subtaskCount > 0 ? (
                                    <span>{item.subtaskCount} subtask{item.subtaskCount === 1 ? "" : "s"}</span>
                                  ) : null}
                                  {item.attachmentCount > 0 ? (
                                    <span>{item.attachmentCount} attachment{item.attachmentCount === 1 ? "" : "s"}</span>
                                  ) : null}
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => void handleRestoreRecycleBinItem(item.id)}
                                  disabled={isBusy || !currentBoardPermissions.canManageLifecycle}
                                  className={COMPACT_PRIMARY_BUTTON_CLASS}
                                >
                                  <RotateCcw className="h-3 w-3" />
                                  Restore
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void handlePermanentlyDeleteRecycleBinItem(item.id)}
                                  disabled={isBusy || !currentBoardPermissions.canManageLifecycle}
                                  className={COMPACT_SURFACE_BUTTON_CLASS}
                                >
                                  Delete permanently
                                </button>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {isArchivesOpen && typeof document !== "undefined"
        ? createPortal(
            <div className="taskboard-shell fixed inset-0 z-[60] flex items-center justify-center p-3 sm:p-4">
              <button
                type="button"
                onClick={() => setIsArchivesOpen(false)}
                className="absolute inset-0 bg-[rgba(20,16,12,0.5)]"
                aria-label="Close archives"
              />
              <div ref={archivesPanelRef} className="taskboard-overlay-panel panel-surface panel-strong pretty-scrollbar relative z-10 flex max-h-[min(82vh,920px)] w-[min(840px,calc(100vw-24px))] min-h-0 flex-col overflow-hidden rounded-[30px]">
                <div className="flex items-start justify-between gap-3 border-b border-border/70 px-4 py-3">
                  <div className="min-w-0">
                    <h2 className="text-sm font-semibold text-foreground">Archives</h2>
                    <p className="mt-0.5 text-[10px] leading-4 text-muted">
                      Done tasks wait here for review until you archive them. Archived tasks can be restored.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsArchivesOpen(false)}
                    className={ICON_BUTTON_CLASS}
                    aria-label="Close archives"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="flex items-center justify-between gap-2 border-b border-border/70 px-4 py-2">
                  <div className="workspace-seg archives-tabs" role="tablist" aria-label="Archives sections">
                    <button
                      type="button"
                      role="tab"
                      aria-selected={archivesTab === "done"}
                      aria-pressed={archivesTab === "done"}
                      onClick={() => setArchivesTab("done")}
                      data-testid="archives-tab-done"
                    >
                      Done · {doneRootTasks.length}
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={archivesTab === "archived"}
                      aria-pressed={archivesTab === "archived"}
                      onClick={() => setArchivesTab("archived")}
                      data-testid="archives-tab-archived"
                    >
                      Archived · {archiveItems.length}
                    </button>
                  </div>
                  {archivesTab === "done" && doneRootTasks.length > 1 ? (
                    <button
                      type="button"
                      onClick={() => void handleArchiveDoneTasks(doneRootTasks.map(({ task }) => task.id))}
                      disabled={archiveBusyTaskId !== null || !boardAccess.canEdit || !boardAccess.canManageLifecycle}
                      className={`${COMPACT_PRIMARY_BUTTON_CLASS} inline-flex items-center gap-1 whitespace-nowrap`}
                      data-testid="archives-archive-all-done"
                    >
                      <Archive className="h-3 w-3" />
                      Archive all {doneRootTasks.length}
                    </button>
                  ) : null}
                </div>
                <div className="pretty-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-3">
                  {archivesInfo ? (
                    <div className="ui-info-banner mb-2 rounded-[14px] border px-3 py-2 text-[10px] font-medium leading-4">
                      {archivesInfo}
                    </div>
                  ) : null}
                  {archivesError ? (
                    <div className="ui-danger-banner rounded-[14px] border px-3 py-2 text-[10px] font-medium leading-4">
                      {archivesError}
                    </div>
                  ) : null}
                  {archivesTab === "done" ? (
                    doneRootTasks.length === 0 ? (
                      <div className="taskboard-subtle-surface rounded-[18px] border border-dashed p-4 text-center text-[10px] font-medium text-muted">
                        No done tasks waiting. Tasks you mark done stay on the board until you archive them here or with Done: Archive.
                      </div>
                    ) : (
                      <div className="grid gap-2" data-testid="archives-done-list">
                        {doneRootTasks.map(({ task, bucketTitle }) => {
                          const isBusy = archiveBusyTaskId === task.id || archiveBusyTaskId === "all-done";
                          const subtaskCount = task.subtasks.length;
                          return (
                            <article
                              key={task.id}
                              className="taskboard-subtle-surface rounded-[18px] border px-3 py-2.5"
                              data-testid="archives-done-item"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0 flex-1">
                                  <span className="text-[11px] font-semibold text-foreground">{task.title}</span>
                                  <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] leading-4 text-muted">
                                    {task.completedAt ? (
                                      <span>Done {formatDate(task.completedAt, displayTimeZone)}</span>
                                    ) : null}
                                    <span>In {bucketTitle}</span>
                                    {subtaskCount > 0 ? (
                                      <span>{subtaskCount} subtask{subtaskCount === 1 ? "" : "s"}</span>
                                    ) : null}
                                  </div>
                                </div>
                                <div className="flex shrink-0 items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => {
                                      setIsArchivesOpen(false);
                                      handleSelectTask(task.id);
                                    }}
                                    className={COMPACT_SURFACE_BUTTON_CLASS}
                                  >
                                    Open
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleArchiveDoneTasks([task.id])}
                                    disabled={isBusy || !boardAccess.canEdit || !boardAccess.canManageLifecycle}
                                    className={`${COMPACT_PRIMARY_BUTTON_CLASS} inline-flex items-center gap-1 whitespace-nowrap`}
                                  >
                                    <Archive className="h-3 w-3" />
                                    Archive
                                  </button>
                                </div>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    )
                  ) : isArchivesLoading ? (
                    <div className="taskboard-subtle-surface rounded-[18px] border border-dashed p-4 text-center text-[10px] font-medium text-muted">
                      Loading archives...
                    </div>
                  ) : archiveItems.length === 0 ? (
                    <div className="taskboard-subtle-surface rounded-[18px] border border-dashed p-4 text-center text-[10px] font-medium text-muted">
                      Archives are empty.
                    </div>
                  ) : (
                    <div className="grid gap-2">
                      {archiveItems.map((item) => {
                        const isBusy = archiveBusyTaskId === item.id;
                        return (
                          <article
                            key={item.id}
                            className="taskboard-subtle-surface rounded-[18px] border px-3 py-2.5"
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <span className="text-[11px] font-semibold text-foreground">
                                    {item.title}
                                  </span>
                                  <span className="taskboard-label-chip taskboard-label-chip-muted rounded-full px-2 py-0.5 text-[10px] font-medium">
                                    {item.providerLabel}
                                  </span>
                                  <span className="taskboard-label-chip taskboard-label-chip-muted rounded-full px-2 py-0.5 text-[10px] font-medium">
                                    {getStoredTaskItemTypeLabel(item)}
                                  </span>
                                  {item.convertedImport ? (
                                    <span className="taskboard-label-chip taskboard-label-chip-muted rounded-full px-2 py-0.5 text-[10px] font-medium">
                                      Converted
                                    </span>
                                  ) : null}
                                </div>
                                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] leading-4 text-muted">
                                  <span>Archived {formatDate(item.archivedAt, displayTimeZone)}</span>
                                  {item.completedAt ? (
                                    <span>Done {formatDate(item.completedAt, displayTimeZone)}</span>
                                  ) : null}
                                  {item.originalBucketTitle ? (
                                    <span>From {item.originalBucketTitle}</span>
                                  ) : null}
                                  {item.subtaskCount > 0 ? (
                                    <span>{item.subtaskCount} subtask{item.subtaskCount === 1 ? "" : "s"}</span>
                                  ) : null}
                                  {item.attachmentCount > 0 ? (
                                    <span>{item.attachmentCount} attachment{item.attachmentCount === 1 ? "" : "s"}</span>
                                  ) : null}
                                </div>
                              </div>
                              <div className="flex shrink-0 items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => void handleRestoreArchiveItem(item.id)}
                                  disabled={isBusy || !currentBoardPermissions.canManageLifecycle}
                                  className={COMPACT_PRIMARY_BUTTON_CLASS}
                                >
                                  <RotateCcw className="h-3 w-3" />
                                  Restore
                                </button>
                              </div>
                            </div>
                          </article>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
      {phoneViewport.isPhone && isMoreMenuOpen ? <FloatingMenuPortal isOpen anchorRef={phoneMenuAnchorRef}
        surfaceRef={moreMenuSurfaceRef} preferredWidth={272} preferredMaxHeight={Math.min(420, phoneViewport.height - 128)}
        className="taskboard-popover taskboard-phone-menu-surface rounded-[12px] border border-border/70 p-2 shadow-lg">
        <PhoneWorkspaceMenu active={isNotesWorkspace ? "notes" : isCalendarWorkspace ? "calendar" : "tasks"}
          notesHref={notesWorkspaceHref} calendarHref={calendarWorkspaceHref} tasksHref={buildTaskboardWorkspaceHref(lastTaskView)} optionsHref={optionsHref}
          onClose={() => { setIsMoreMenuOpen(false); phoneMenuAnchorRef.current?.focus(); }}>
          {isNotesWorkspace ? <button type="button" disabled={!persistenceEnabled} onClick={() => { setIsMoreMenuOpen(false); setNoteCreateRequest(current => current + 1); }}><StickyNote aria-hidden="true" />New note</button> : <>
            {isCalendarWorkspace ? <>
              <button type="button" disabled={!currentBoardPermissions.canEdit} onClick={() => { setIsMoreMenuOpen(false); phoneCalendarActionsRef.current?.newEntry(); }}><Plus aria-hidden="true" />New entry</button>
              <button type="button" onClick={() => { setIsMoreMenuOpen(false); phoneCalendarActionsRef.current?.filters(); }}><SlidersHorizontal aria-hidden="true" />Calendars &amp; filters</button>
              <Link href={isOutageCalendarView ? calendarWorkspaceHref : outageCalendarWorkspaceHref} onClick={() => setIsMoreMenuOpen(false)}><Wrench aria-hidden="true" />{isOutageCalendarView ? "My calendar" : "Outages"}</Link>
            </> : <>
            <label>Board<select aria-label="Choose board" value={currentBoardId} onChange={event => {
              const target = accessibleBoards.find(item => item.boardId === event.target.value);
              if (target) void handleSelectAccessibleBoard(target);
              setIsMoreMenuOpen(false);
            }}>{accessibleBoards.map(item => <option key={item.boardId} value={item.boardId}>{item.title}</option>)}</select></label>
            {!isRoutedWorkspace ? <label>View<select aria-label="Task view" value={viewMode} onChange={event => { goToView(event.target.value as ViewMode); setIsMoreMenuOpen(false); }}>
              <option value="board">Board</option><option value="agenda">Agenda</option><option value="focus">Focus</option>
            </select></label> : <Link href={isOutageCalendarView ? calendarWorkspaceHref : outageCalendarWorkspaceHref} onClick={() => setIsMoreMenuOpen(false)}>{isOutageCalendarView ? "My calendar" : "Outages"}</Link>}
            </>}
          </>}
        </PhoneWorkspaceMenu>
      </FloatingMenuPortal> : null}
      <MobileWorkspaceNavigation active={isNotesWorkspace ? "notes" : isCalendarWorkspace ? "calendar" : "tasks"}
        notesHref={notesWorkspaceHref} calendarHref={calendarWorkspaceHref} tasksHref={buildTaskboardWorkspaceHref(lastTaskView)}
        menuButtonRef={phoneNavMenuButtonRef} menuOpen={isMoreMenuOpen}
        onMore={() => { phoneMenuAnchorRef.current = phoneNavMenuButtonRef.current; setIsMoreMenuOpen(current => !current); }} />
    </main>
  );
}

const FLOATING_MENU_VIEWPORT_PADDING = 12;
const FLOATING_MENU_GAP = 6;

function clampNumber(value: number, min: number, max: number) {
  if (max < min) {
    return min;
  }

  return Math.min(Math.max(value, min), max);
}

function useFloatingMenuStyle<TAnchor extends HTMLElement>({
  isOpen,
  anchorRef,
  surfaceRef,
  preferredWidth,
  align = "end",
  mobileSheet = false,
  preferredMaxHeight = Infinity,
  zIndex = 80,
}: {
  isOpen: boolean;
  anchorRef: RefObject<TAnchor | null>;
  surfaceRef: RefObject<HTMLDivElement | null>;
  preferredWidth: number;
  align?: "start" | "end";
  mobileSheet?: boolean;
  preferredMaxHeight?: number;
  zIndex?: number;
}) {
  const [style, setStyle] = useState<CSSProperties>({
    left: -9999,
    maxHeight: "calc(100vh - 24px)",
    position: "fixed",
    top: -9999,
    zIndex,
  });

  const updatePosition = useCallback(() => {
    const anchor = anchorRef.current;

    if (!anchor || typeof window === "undefined") {
      return;
    }

    const viewportWidth = Math.min(
      window.innerWidth,
      window.visualViewport?.width ?? window.innerWidth,
      document.documentElement.clientWidth || window.innerWidth,
      document.body?.clientWidth || window.innerWidth,
    );
    const viewportHeight = Math.min(
      window.innerHeight,
      window.visualViewport?.height ?? window.innerHeight,
      document.documentElement.clientHeight || window.innerHeight,
    );
    const padding = FLOATING_MENU_VIEWPORT_PADDING;
    const availableWidth = Math.max(160, viewportWidth - padding * 2);
    const useMobileSheet = mobileSheet && viewportWidth < 640;
    const width = useMobileSheet
      ? availableWidth
      : Math.min(preferredWidth, availableWidth);
    const anchorRect = anchor.getBoundingClientRect();
    const surfaceHeight = Math.min(
      surfaceRef.current?.scrollHeight ?? 320,
      preferredMaxHeight,
      Math.max(160, viewportHeight - padding * 2),
    );
    const spaceBelow = viewportHeight - anchorRect.bottom - padding;
    const spaceAbove = anchorRect.top - padding;
    const shouldOpenAbove = spaceBelow < Math.min(surfaceHeight, 220) && spaceAbove > spaceBelow;
    const rawTop = shouldOpenAbove
      ? anchorRect.top - FLOATING_MENU_GAP - surfaceHeight
      : anchorRect.bottom + FLOATING_MENU_GAP;
    const top = clampNumber(rawTop, padding, viewportHeight - padding - surfaceHeight);
    const rawLeft = useMobileSheet
      ? padding
      : align === "start"
        ? anchorRect.left
        : anchorRect.right - width;
    const left = clampNumber(rawLeft, padding, viewportWidth - padding - width);

    setStyle({
      left,
      maxHeight: Math.min(preferredMaxHeight, Math.max(120, viewportHeight - top - padding)),
      overflowY: "auto",
      position: "fixed",
      top,
      width,
      zIndex,
    });
  }, [align, anchorRef, mobileSheet, preferredMaxHeight, preferredWidth, surfaceRef, zIndex]);

  useLayoutEffect(() => {
    if (!isOpen || typeof window === "undefined") {
      return;
    }

    updatePosition();
    const frame = window.requestAnimationFrame(updatePosition);
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen, updatePosition]);

  return style;
}

function FloatingMenuPortal<TAnchor extends HTMLElement>({
  isOpen,
  anchorRef,
  surfaceRef,
  preferredWidth,
  preferredMaxHeight,
  align = "end",
  mobileSheet = false,
  expandedTaskMenu = false,
  editorScale = false,
  className,
  children,
}: {
  isOpen: boolean;
  anchorRef: RefObject<TAnchor | null>;
  surfaceRef: RefObject<HTMLDivElement | null>;
  preferredWidth: number;
  preferredMaxHeight?: number;
  align?: "start" | "end";
  mobileSheet?: boolean;
  expandedTaskMenu?: boolean;
  /** Menus opened from the task editor keep the editor's type scale. */
  editorScale?: boolean;
  className: string;
  children: ReactNode;
}) {
  const style = useFloatingMenuStyle({
    isOpen,
    anchorRef,
    surfaceRef,
    preferredWidth,
    preferredMaxHeight,
    align,
    mobileSheet,
  });
  const [isCompactExpandedTaskMenu, setIsCompactExpandedTaskMenu] = useState(false);

  useEffect(() => {
    if (!isOpen || !expandedTaskMenu) {
      return;
    }

    const expandedTaskEditor = anchorRef.current?.closest<HTMLElement>("[data-testid='task-editor-expanded']");
    if (!expandedTaskEditor) {
      return;
    }

    const resizeObserver = new ResizeObserver(([entry]) => {
      setIsCompactExpandedTaskMenu((entry?.contentRect.width ?? expandedTaskEditor.clientWidth) < 1044);
    });
    resizeObserver.observe(expandedTaskEditor);
    return () => resizeObserver.disconnect();
  }, [anchorRef, expandedTaskMenu, isOpen]);

  if (!isOpen || typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div
      className="taskboard-shell taskboard-floating-menu-layer pointer-events-none fixed inset-0 z-[80]"
      data-compact-expanded-task-menu={isCompactExpandedTaskMenu ? "true" : undefined}
      data-editor-scale={editorScale ? "true" : undefined}
    >
      <div
        ref={surfaceRef}
        className={`pointer-events-auto ${expandedTaskMenu ? "taskboard-expanded-task-menu" : ""} ${className}`}
        style={style}
        onPointerDownCapture={(event) => {
          event.stopPropagation();
        }}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

const NOTIFICATIONS_POLL_INTERVAL_MS = 5 * 60_000;

function NotificationsControl({
  persistenceEnabled,
  onOpenTask,
  polling = true,
}: {
  persistenceEnabled: boolean;
  onOpenTask: (taskId: string) => void;
  polling?: boolean;
}) {
  const displayTimeZone = useDisplayTimeZone();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const bellRef = useRef<HTMLButtonElement | null>(null);
  const [notifications, setNotifications] = useState<TaskNotification[]>([]);
  const [unreadNotificationCount, setUnreadNotificationCount] = useState(0);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const closeNotifications = () => {
    if (rootRef.current?.contains(document.activeElement)) bellRef.current?.focus();
    setIsNotificationsOpen(false);
  };
  const [isNotificationsLoading, setIsNotificationsLoading] = useState(false);
  const [notificationsError, setNotificationsError] = useState("");
  const [notificationActionId, setNotificationActionId] = useState<string | null>(null);
  const [notificationToast, setNotificationToast] = useState("");
  const seenUnreadNotificationIdsRef = useRef<Set<string>>(new Set());
  const notificationsInitializedRef = useRef(false);
  const lastSignatureRef = useRef("");
  useDismissibleSurface({
    isOpen: isNotificationsOpen,
    onClose: closeNotifications,
    refs: [rootRef],
  });

  const refreshNotifications = async (options?: { silent?: boolean }) => {
    if (!persistenceEnabled) {
      if (notifications.length > 0 || unreadNotificationCount > 0) {
        setNotifications([]);
        setUnreadNotificationCount(0);
      }
      return;
    }

    if (!options?.silent) {
      setIsNotificationsLoading(true);
    }
    setNotificationsError("");

    try {
      const response = await persistFetchNotifications();
      const items = response?.items ?? [];
      const unreadIds = new Set(items.filter((item) => !item.readAt).map((item) => item.id));
      const signature = JSON.stringify({
        unreadCount: response?.unreadCount ?? unreadIds.size,
        items: items.map((item) => ({
          id: item.id,
          readAt: item.readAt ?? null,
          dueAt: item.dueAt,
          triggerAt: item.triggerAt,
          title: item.title,
        })),
      });

      if (notificationsInitializedRef.current) {
        const newUnreadCount = Array.from(unreadIds).filter(
          (id) => !seenUnreadNotificationIdsRef.current.has(id),
        ).length;
        if (newUnreadCount > 0) {
          setNotificationToast(
            `${newUnreadCount} new notification${newUnreadCount === 1 ? "" : "s"} ready.`,
          );
        }
      }

      seenUnreadNotificationIdsRef.current = unreadIds;
      notificationsInitializedRef.current = true;

      if (signature !== lastSignatureRef.current) {
        lastSignatureRef.current = signature;
        setNotifications(items);
        setUnreadNotificationCount(response?.unreadCount ?? unreadIds.size);
      }
    } catch (error) {
      console.error("Failed to load notifications.", error);
      setNotificationsError("Unable to load notifications.");
    } finally {
      if (!options?.silent) {
        setIsNotificationsLoading(false);
      }
    }
  };

  useEffect(() => {
    if (!persistenceEnabled || !polling) {
      return;
    }

    const initialRefreshTimeout = window.setTimeout(() => {
      void refreshNotifications({ silent: true });
    }, 0);

    const handleRefresh = () => {
      if (document.visibilityState !== "visible") {
        return;
      }

      void refreshNotifications({ silent: true });
    };

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void refreshNotifications({ silent: true });
      }
    }, NOTIFICATIONS_POLL_INTERVAL_MS);

    document.addEventListener("visibilitychange", handleRefresh);
    window.addEventListener("taskboard-notifications-refresh", handleRefresh as EventListener);

    return () => {
      window.clearTimeout(initialRefreshTimeout);
      window.clearInterval(intervalId);
      document.removeEventListener("visibilitychange", handleRefresh);
      window.removeEventListener(
        "taskboard-notifications-refresh",
        handleRefresh as EventListener,
      );
    };
  }, [persistenceEnabled, polling]);

  useEffect(() => {
    if (!notificationToast) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setNotificationToast("");
    }, 4500);

    return () => window.clearTimeout(timeoutId);
  }, [notificationToast]);

  const handleToggleNotifications = async () => {
    const nextOpen = !isNotificationsOpen;
    setIsNotificationsOpen(nextOpen);
    if (nextOpen) {
      await refreshNotifications();
    }
  };

  const handleNotificationAction = async (
    notificationId: string,
    action: "read" | "dismiss",
  ) => {
    if (!persistenceEnabled) {
      return;
    }

    setNotificationActionId(notificationId);
    setNotificationsError("");

    try {
      await persistUpdateNotification(notificationId, action);
      await refreshNotifications({ silent: true });
    } catch (error) {
      console.error(`Failed to ${action} notification.`, error);
      setNotificationsError(
        action === "dismiss" ? "Unable to dismiss notification." : "Unable to mark notification as read.",
      );
    } finally {
      setNotificationActionId(null);
    }
  };

  const handleReadAllNotifications = async () => {
    if (!persistenceEnabled) {
      return;
    }

    setNotificationActionId("all");
    setNotificationsError("");

    try {
      await persistReadAllNotifications();
      await refreshNotifications({ silent: true });
    } catch (error) {
      console.error("Failed to mark all notifications as read.", error);
      setNotificationsError("Unable to mark all notifications as read.");
    } finally {
      setNotificationActionId(null);
    }
  };

  const handleOpenNotificationTask = async (notification: TaskNotification) => {
    onOpenTask(notification.taskId);
    setIsNotificationsOpen(false);
    if (!notification.readAt) {
      await handleNotificationAction(notification.id, "read");
    }
  };

  return (
    <>
      <div ref={rootRef} className="relative">
        <button
          ref={bellRef}
          type="button"
          onClick={() => void handleToggleNotifications()}
          disabled={!persistenceEnabled}
          className={`${SMALL_CHIP_BUTTON_CLASS} relative w-7 justify-center px-0`}
          aria-expanded={isNotificationsOpen}
          aria-label={
            unreadNotificationCount > 0
              ? `Notifications, ${unreadNotificationCount} unread`
              : "Notifications"
          }
          title="Notifications"
          data-testid="header-notifications-bell"
        >
          <Bell className="h-3.5 w-3.5" />
          {unreadNotificationCount > 0 ? (
            <span
              aria-hidden="true"
              className="absolute -right-1 -top-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-[var(--control-active)] px-1 text-[9px] font-semibold leading-none text-[var(--control-active-fg)]"
            >
              {unreadNotificationCount > 99 ? "99+" : unreadNotificationCount}
            </span>
          ) : null}
        </button>
        {isNotificationsOpen ? (
          <div className="taskboard-popover fixed inset-x-3 top-16 z-[75] flex max-h-[calc(100dvh-5rem)] flex-col overflow-y-auto rounded-[18px] border p-2 shadow-lg sm:absolute sm:inset-x-auto sm:right-0 sm:top-[calc(100%+0.35rem)] sm:z-30 sm:w-[min(360px,calc(100vw-2rem))]">
            <div className="flex items-center justify-between gap-2 border-b border-border/70 px-1 pb-2">
              <div>
                <p className="text-xs font-semibold text-foreground">Notifications</p>
                <p className={TASK_EDITOR_MUTED_TEXT_CLASS}>
                  {unreadNotificationCount > 0
                    ? `${unreadNotificationCount} unread`
                    : "Everything is up to date."}
                </p>
              </div>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => void handleReadAllNotifications()}
                  disabled={notificationActionId === "all" || unreadNotificationCount === 0}
                  className={COMPACT_SURFACE_BUTTON_CLASS}
                >
                  Mark all read
                </button>
                <SurfaceCloseButton
                  label="Close notifications"
                  onClick={closeNotifications}
                />
              </div>
            </div>
            <TaskPushControls />
            <div className="pretty-scrollbar mt-2 flex max-h-[360px] flex-col gap-1 overflow-auto pr-0.5">
              {isNotificationsLoading ? (
                <p className={EMPTY_STATE_TEXT_CLASS}>Loading notifications…</p>
              ) : notificationsError ? (
                <div className="ui-danger-banner rounded-[12px] border px-2 py-1.5 text-[10px] font-medium leading-4">
                  {notificationsError}
                </div>
              ) : notifications.length === 0 ? (
                <p className={EMPTY_STATE_TEXT_CLASS}>No active reminders right now.</p>
              ) : (
                notifications.map((notification) => {
                  const isBusy = notificationActionId === notification.id;
                  const kindLabel = notification.kind === "overdue" ? "Overdue" : "Due now";

                  return (
                    <div
                      key={notification.id}
                      className={`rounded-[14px] border px-2.5 py-2 ${
                        notification.readAt
                          ? "border-border/60 bg-surface-subtle/70"
                          : "border-[color:color-mix(in_srgb,var(--control-active)_28%,transparent)] bg-[color:color-mix(in_srgb,var(--control-active)_8%,var(--surface-subtle))]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate text-[11px] font-semibold text-foreground">
                            {notification.title}
                          </p>
                          <p className={`${TASK_EDITOR_MUTED_TEXT_CLASS} mt-0.5`}>
                            {kindLabel} · {formatDate(notification.dueAt, displayTimeZone)}
                          </p>
                          {notification.bucketTitle || notification.providerLabel ? (
                            <p className={`${TASK_EDITOR_MUTED_TEXT_CLASS} mt-0.5`}>
                              {[notification.bucketTitle, notification.providerLabel]
                                .filter(Boolean)
                                .join(" · ")}
                            </p>
                          ) : null}
                        </div>
                        {!notification.readAt ? (
                          <span className="rounded-full bg-[var(--control-active)] px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-[var(--control-active-fg)]">
                            New
                          </span>
                        ) : null}
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1">
                        <button
                          type="button"
                          onClick={() => void handleOpenNotificationTask(notification)}
                          disabled={isBusy}
                          className={COMPACT_PRIMARY_BUTTON_CLASS}
                        >
                          Open
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleNotificationAction(notification.id, "read")}
                          disabled={isBusy || Boolean(notification.readAt)}
                          className={COMPACT_SURFACE_BUTTON_CLASS}
                        >
                          Mark read
                        </button>
                        <button
                          type="button"
                          onClick={() => void handleNotificationAction(notification.id, "dismiss")}
                          disabled={isBusy}
                          className={COMPACT_SURFACE_BUTTON_CLASS}
                        >
                          Dismiss
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </div>
        ) : null}
      </div>
      {notificationToast ? (
        <div className="fixed bottom-4 right-4 z-[70] max-w-[320px] rounded-[16px] border border-[color:color-mix(in_srgb,var(--control-active)_28%,transparent)] bg-[color:color-mix(in_srgb,var(--control-active)_8%,var(--surface-raised))] px-3 py-2 text-[10px] font-medium leading-4 text-foreground shadow-lg">
          {notificationToast}
        </div>
      ) : null}
    </>
  );
}

function BucketDragPreview({ bucket }: { bucket: Bucket }) {
  const BucketIcon = bucketIcons[bucket.icon];

  return (
    <div
      className="taskboard-bucket-column taskboard-bucket-drag-preview panel-surface panel-strong rounded-[18px] border px-3 py-2.5 shadow-2xl"
      style={{
        "--bucket-color": bucket.color,
        borderColor: `color-mix(in srgb, ${bucket.color} 48%, var(--border))`,
        boxShadow: `0 0 0 2px ${bucket.color}44, 0 18px 44px rgba(15, 23, 42, 0.24)`,
      } as CSSProperties}
    >
      <div className="flex items-start gap-2">
        <span
          className="taskboard-bucket-icon taskboard-icon-surface flex h-7 w-7 shrink-0 items-center justify-center rounded-[14px] border"
          style={{
            color: bucket.color,
            background: `color-mix(in srgb, ${bucket.color} 18%, var(--surface-hover))`,
            borderColor: `color-mix(in srgb, ${bucket.color} 24%, var(--border))`,
          }}
        >
          <BucketIcon className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <span className={BUCKET_TITLE_CLASS}>{bucket.title}</span>
          <span className="mt-0.5 block text-[10px] font-medium leading-4 text-muted">
            {bucket.tasks.length} task{bucket.tasks.length === 1 ? "" : "s"}
          </span>
        </div>
      </div>
    </div>
  );
}

const BucketColumn = memo(function BucketColumn({
  bucket,
  bucketIndex,
  bucketCount,
  compactCards,
  detailLevel,
  selectedTaskId,
  calendarArrivalTaskId,
  onSelectTask,
  onCreateTask,
  onRenameBucket,
  onUpdateBucketStyle,
  onMoveBucket,
  onDeleteBucket,
  onToggleCollapse,
  isDropTarget,
  taskDropPreview,
  draggedTask,
  isBucketDragDisabled,
  isTaskDragDisabled,
  canEditBoard,
  canManageTaskLifecycle,
  quickAddRequestNonce = null,
  notesEnabled = false,
  noteCount = 0,
  boardId,
}: {
  bucket: Bucket;
  bucketIndex: number;
  bucketCount: number;
  compactCards: boolean;
  detailLevel: CardDetailLevel;
  selectedTaskId: string | null;
  calendarArrivalTaskId: string | null;
  onSelectTask: (taskId: string) => void;
  onCreateTask: (
    bucketId: string,
    title: string,
    workItemType?: "task" | "maintenance_outage",
  ) => Promise<boolean>;
  onRenameBucket: (bucketId: string, title: string) => void | Promise<void>;
  onUpdateBucketStyle: (
    bucketId: string,
    patch: {
      color: string;
      icon: BucketIcon;
    },
  ) => void | Promise<void>;
  onMoveBucket: (bucketId: string, targetIndex: number) => void | Promise<void>;
  onDeleteBucket: (bucketId: string) => void;
  onToggleCollapse: (bucketId: string) => void;
  isDropTarget: boolean;
  taskDropPreview: TaskDropPreview | null;
  draggedTask: Task | null;
  isBucketDragDisabled: boolean;
  isTaskDragDisabled: boolean;
  canEditBoard: boolean;
  canManageTaskLifecycle: boolean;
  // Changes each time the N shortcut or the palette asks this bucket for a new task.
  quickAddRequestNonce?: number | null;
  notesEnabled?: boolean;
  noteCount?: number;
  boardId?: string;
}) {
  const {
    attributes: bucketDragAttributes,
    listeners: bucketDragListeners,
    setNodeRef: setBucketColumnNodeRef,
    transform: bucketTransform,
    transition: bucketTransition,
    isDragging: isBucketDragging,
  } = useSortable({
    id: getBucketColumnSortableId(bucket.id),
    disabled: isBucketDragDisabled,
    data: {
      type: "bucket-column",
      bucketId: bucket.id,
    },
  });
  const { isOver, setNodeRef: setTaskDropNodeRef } = useDroppable({
    id: bucket.id,
    data: {
      type: "bucket",
      bucketId: bucket.id,
    },
  });
  const BucketIcon = bucketIcons[bucket.icon];
  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const [isRenaming, setIsRenaming] = useState(false);
  const [draftTitle, setDraftTitle] = useState(bucket.title);
  const [isAddingTaskInline, setIsAddingTaskInline] = useState(false);
  const [isCreateMenuOpen, setIsCreateMenuOpen] = useState(false);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [newWorkItemType, setNewWorkItemType] = useState<"task" | "maintenance_outage">("task");
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const createMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const createMenuRef = useRef<HTMLDivElement | null>(null);
  const quickAddInputRef = useRef<HTMLInputElement | null>(null);
  const [handledQuickAddNonce, setHandledQuickAddNonce] = useState(quickAddRequestNonce);
  if (quickAddRequestNonce && quickAddRequestNonce !== handledQuickAddNonce) {
    setHandledQuickAddNonce(quickAddRequestNonce);
    if (canEditBoard) {
      setIsCreateMenuOpen(false);
      setNewWorkItemType("task");
      setIsAddingTaskInline(true);
    }
  }
  useEffect(() => {
    if (!quickAddRequestNonce) {
      return;
    }

    quickAddInputRef.current?.focus({ preventScroll: true });
    quickAddInputRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [quickAddRequestNonce]);
  const showDropTarget = isOver || isDropTarget;
  const taskDropPreviewIndex =
    taskDropPreview && draggedTask
      ? getTaskDropPreviewIndex(bucket.tasks, taskDropPreview)
      : -1;
  const isFirstBucket = bucketIndex <= 0;
  const isLastBucket = bucketIndex >= bucketCount - 1;
  const bucketMoveMenuItemClass =
    "ui-button ui-button-surface flex h-8 min-w-0 items-center justify-center rounded-[7px] border p-0 text-muted transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-45";
  const readOnlyTitle = "Read-only board. Editing is disabled for viewer access.";
  useDismissibleSurface({
    isOpen: isMenuOpen,
    onClose: () => setIsMenuOpen(false),
    refs: [menuButtonRef, menuRef],
  });
  useDismissibleSurface({
    isOpen: isCreateMenuOpen,
    onClose: () => setIsCreateMenuOpen(false),
    refs: [createMenuButtonRef, createMenuRef],
  });

  const submitRenameBucket = () => {
    if (!canEditBoard) {
      setIsRenaming(false);
      return;
    }

    void onRenameBucket(bucket.id, draftTitle);
    setIsRenaming(false);
    setIsMenuOpen(false);
  };

  const closeInlineTask = () => {
    setIsAddingTaskInline(false);
    setNewTaskTitle("");
    setNewWorkItemType("task");
  };

  const submitInlineTask = async () => {
    if (!canEditBoard) {
      setIsAddingTaskInline(false);
      return;
    }

    const created = await onCreateTask(bucket.id, newTaskTitle, newWorkItemType);
    if (!created) {
      return;
    }

    // Narrow screens switch to the new task's panel, so close the composer there.
    // Elsewhere keep it open and focused so several tasks can be entered in a row.
    if (window.matchMedia("(max-width: 767px)").matches) {
      closeInlineTask();
      return;
    }

    setNewTaskTitle("");
    quickAddInputRef.current?.focus({ preventScroll: true });
  };

  return (
    <section
      ref={setBucketColumnNodeRef}
      data-testid="bucket-column"
      data-bucket-title={bucket.title}
      data-drop-target={showDropTarget ? "true" : undefined}
      className={`taskboard-bucket-column panel-surface panel-strong flex w-full min-w-0 flex-col overflow-hidden rounded-[18px] transition-all duration-150 ${
        showDropTarget
          ? "taskboard-bucket-drop-target"
          : ""
      } ${
        isBucketDragging ? "opacity-35 shadow-2xl" : ""
      }`}
      style={{
        transform: CSS.Translate.toString(bucketTransform),
        transition: bucketTransition,
        "--bucket-color": bucket.color,
        borderColor: showDropTarget
          ? bucket.color
          : `color-mix(in srgb, ${bucket.color} 40%, var(--border))`,
        boxShadow: showDropTarget
          ? `0 0 0 2px ${bucket.color}, 0 0 0 6px ${bucket.color}22, 0 18px 40px rgba(73, 51, 32, 0.14)`
          : undefined,
      } as CSSProperties}
    >
      <div
        className="taskboard-bucket-header border-b px-3 py-2.5"
        style={{
          background: `linear-gradient(180deg, color-mix(in srgb, ${bucket.color} 24%, var(--panel-strong)) 0%, color-mix(in srgb, ${bucket.color} 16%, var(--panel)) 100%)`,
          borderBottomColor: `color-mix(in srgb, ${bucket.color} 22%, var(--border))`,
        }}
      >
        {isRenaming ? (
          <div className="taskboard-bucket-header-row flex items-start gap-2">
            <span
                className="taskboard-bucket-icon taskboard-icon-surface flex h-8 w-8 shrink-0 items-center justify-center rounded-[16px] border"
                style={{
                  color: `var(--taskboard-bucket-icon-color, ${bucket.color})`,
                  background: `var(--taskboard-bucket-icon-background, color-mix(in srgb, ${bucket.color} 18%, var(--surface-hover)))`,
                  borderColor: `var(--taskboard-bucket-icon-border, color-mix(in srgb, ${bucket.color} 24%, var(--border)))`,
                }}
            >
              <BucketIcon className="h-4 w-4" />
            </span>

            <div className="taskboard-bucket-heading min-w-0 flex-1">
              <input
                value={draftTitle}
                onChange={(event) => setDraftTitle(event.target.value)}
                onKeyDown={(event) => {
                  handlePlainEnterSubmit(event, submitRenameBucket);
                }}
                className={`${COMPACT_INPUT_CLASS} font-semibold`}
              />
              <div className="mt-1.5 flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={submitRenameBucket}
                  className="ui-button ui-button-primary rounded-[9px] px-2 py-1 text-[11px] font-medium leading-4"
                >
                  Save
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraftTitle(bucket.title);
                    setIsRenaming(false);
                  }}
                  className="ui-button ui-button-surface rounded-[9px] border px-2 py-1 text-[11px] font-medium leading-4 text-muted transition hover:text-foreground"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="taskboard-bucket-header-row flex items-start gap-2">
            <button
              type="button"
              aria-label={`${bucket.collapsed ? "Expand" : "Collapse"} ${bucket.title} tasks, or drag to reorder the bucket`}
              title={
                canEditBoard
                  ? `Click to ${bucket.collapsed ? "expand" : "collapse"} tasks. Drag to reorder ${bucket.title}.`
                  : readOnlyTitle
              }
              // A plain click toggles the bucket's task detail; a drag (8px+)
              // reorders the bucket and suppresses the click.
              onClick={() => onToggleCollapse(bucket.id)}
              disabled={!canEditBoard}
              className={`taskboard-bucket-icon-button mt-0.5 inline-flex shrink-0 touch-none select-none items-center justify-center leading-none disabled:cursor-not-allowed disabled:opacity-65 ${isBucketDragDisabled ? "" : "cursor-grab active:cursor-grabbing"}`}
              data-testid="bucket-reorder-handle"
              {...(!isBucketDragDisabled ? bucketDragAttributes : {})}
              {...(!isBucketDragDisabled ? bucketDragListeners : {})}
            >
              <span
                className="taskboard-bucket-icon taskboard-icon-surface flex h-7 w-7 items-center justify-center rounded-[14px] border"
                style={{
                  color: `var(--taskboard-bucket-icon-color, ${bucket.color})`,
                  background: `var(--taskboard-bucket-icon-background, color-mix(in srgb, ${bucket.color} 18%, var(--surface-hover)))`,
                  borderColor: `var(--taskboard-bucket-icon-border, color-mix(in srgb, ${bucket.color} 24%, var(--border)))`,
                }}
              >
                <BucketIcon className="h-4 w-4" />
              </span>
            </button>

            <div className="taskboard-bucket-heading min-w-0 flex-1">
              <button
                type="button"
                onClick={() => onToggleCollapse(bucket.id)}
                disabled={!canEditBoard}
                title={canEditBoard ? undefined : readOnlyTitle}
                className="block max-w-full text-left"
              >
                <span className={BUCKET_TITLE_CLASS}>
                  {bucket.title}
                </span>
              </button>
              <span
                className="taskboard-bucket-task-count mt-0.5 block text-[10px] font-medium leading-4 text-muted"
                data-task-count={bucket.tasks.length}
              >
                {bucket.tasks.length} task{bucket.tasks.length === 1 ? "" : "s"}
              </span>
            </div>

            <div className="taskboard-bucket-actions flex items-center gap-1">
              <div className="relative">
                <button
                  ref={menuButtonRef}
                  type="button"
                  onClick={() => setIsMenuOpen((current) => !current)}
                  className={ICON_BUTTON_CLASS}
                  aria-label="Bucket actions"
                  aria-expanded={isMenuOpen}
                  aria-haspopup="menu"
                >
                  <MoreHorizontal className="h-3.5 w-3.5" />
                </button>

                {isMenuOpen ? (
                  <FloatingMenuPortal
                    isOpen={isMenuOpen}
                    anchorRef={menuButtonRef}
                    surfaceRef={menuRef}
                    preferredWidth={120}
                    align="end"
                    className="taskboard-bucket-menu taskboard-popover rounded-[10px] border p-2"
                  >
                    <div className="taskboard-bucket-menu-heading mb-1 border-b px-1.5 pb-1.5">
                      <span className="block truncate text-[10px] font-semibold uppercase tracking-[0.08em] text-muted">
                        {bucket.title}
                      </span>
                      <span className="block text-[9px] text-muted">Bucket actions</span>
                    </div>
                    {!canEditBoard ? (
                      <p className={`${EMPTY_STATE_TEXT_CLASS} px-1.5 pb-1`}>
                        Read-only board. Bucket editing is disabled.
                      </p>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => {
                        setDraftTitle(bucket.title);
                        setIsRenaming(true);
                        setIsMenuOpen(false);
                      }}
                      disabled={!canEditBoard}
                      className={COMPACT_MENU_ITEM_CLASS}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        onToggleCollapse(bucket.id);
                        setIsMenuOpen(false);
                      }}
                      disabled={!canEditBoard}
                      className={COMPACT_MENU_ITEM_CLASS}
                    >
                      {bucket.collapsed ? "Expand" : "Collapse"}
                    </button>
                    {notesEnabled && boardId ? (
                      <div className="mt-1 border-t border-border/70 pt-1">
                        <Link
                          href={buildNotesHref({ boardId, bucketId: bucket.id })}
                          className={`${COMPACT_MENU_ITEM_CLASS} gap-1.5`}
                          onClick={() => setIsMenuOpen(false)}
                        >
                          <StickyNote className="h-3 w-3" aria-hidden="true" />
                          {noteCount > 0 ? `Notes (${noteCount})` : "Notes"}
                        </Link>
                        {canEditBoard ? (
                          <Link
                            href={buildNotesHref({ boardId, bucketId: bucket.id, createNew: true })}
                            className={`${COMPACT_MENU_ITEM_CLASS} gap-1.5`}
                            onClick={() => setIsMenuOpen(false)}
                          >
                            <Plus className="h-3 w-3" aria-hidden="true" />
                            New note here
                          </Link>
                        ) : null}
                      </div>
                    ) : null}
                    <div className="mt-1 border-t border-border/70 pt-2">
                      <span className={`${COMPACT_LABEL_CLASS} px-1`}>Move bucket</span>
                      <div className="mt-1 grid grid-cols-4 gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          void onMoveBucket(bucket.id, 0);
                          setIsMenuOpen(false);
                        }}
                        disabled={!canEditBoard || isFirstBucket}
                        className={bucketMoveMenuItemClass}
                        aria-label="Move bucket to start"
                        title="Move to start"
                      >
                        <ArrowLeftToLine className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void onMoveBucket(bucket.id, bucketIndex - 1);
                          setIsMenuOpen(false);
                        }}
                        disabled={!canEditBoard || isFirstBucket}
                        className={bucketMoveMenuItemClass}
                        aria-label="Move bucket left"
                        title="Move left"
                      >
                        <ArrowLeft className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void onMoveBucket(bucket.id, bucketIndex + 1);
                          setIsMenuOpen(false);
                        }}
                        disabled={!canEditBoard || isLastBucket}
                        className={bucketMoveMenuItemClass}
                        aria-label="Move bucket right"
                        title="Move right"
                      >
                        <ArrowRight className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          void onMoveBucket(bucket.id, bucketCount - 1);
                          setIsMenuOpen(false);
                        }}
                        disabled={!canEditBoard || isLastBucket}
                        className={bucketMoveMenuItemClass}
                        aria-label="Move bucket to end"
                        title="Move to end"
                      >
                        <ArrowRightToLine className="h-3.5 w-3.5" />
                      </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        onDeleteBucket(bucket.id);
                        setIsMenuOpen(false);
                      }}
                      disabled={!canEditBoard || (!canManageTaskLifecycle && bucket.tasks.length > 0)}
                      className={COMPACT_MENU_ITEM_CLASS}
                    >
                      Delete
                    </button>
                    <div className="mt-1 border-t border-border/70 pt-1">
                      <span className={`${COMPACT_LABEL_CLASS} px-1.5`}>
                        Color
                      </span>
                      <div className="grid grid-cols-3 gap-1.5 px-1.5 pb-2">
                        {bucketColorOptions.map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            onClick={() => {
                              void onUpdateBucketStyle(bucket.id, {
                                color: option.value,
                                icon: bucket.icon,
                              });
                            }}
                            disabled={!canEditBoard}
                            className={`taskboard-bucket-color-swatch h-7 w-7 rounded-full border transition ${
                              bucket.color === option.value
                                ? "taskboard-bucket-color-swatch-selected scale-110 border-foreground"
                                : "taskboard-swatch-border"
                            }`}
                            style={{ backgroundColor: option.value }}
                            aria-label={`Set bucket color to ${option.label}`}
                          />
                        ))}
                      </div>

                      <span className={`${COMPACT_LABEL_CLASS} px-1.5`}>
                        Icon
                      </span>
                      <div className="grid grid-cols-3 gap-1 px-1.5 pb-1">
                        {bucketIconOptions.map((option) => {
                          const OptionIcon = bucketIcons[option.value];

                          return (
                            <button
                              key={option.value}
                              type="button"
                              onClick={() => {
                                void onUpdateBucketStyle(bucket.id, {
                                  color: bucket.color,
                                  icon: option.value,
                                });
                              }}
                              disabled={!canEditBoard}
                              className={`taskboard-icon-picker-cell ui-button ui-button-surface flex h-7 w-full items-center justify-center rounded-[7px] border transition ${
                                bucket.icon === option.value
                                  ? "taskboard-icon-picker-cell-active border-foreground text-foreground"
                                  : "border-border text-muted"
                              }`}
                              aria-label={`Set bucket icon to ${option.label}`}
                            >
                              <OptionIcon className="h-3 w-3" />
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </FloatingMenuPortal>
                ) : null}
              </div>
            </div>
          </div>
        )}
      </div>

      <div
        ref={setTaskDropNodeRef}
        className={`taskboard-bucket-body pretty-scrollbar flex min-h-[124px] flex-1 flex-col gap-2 rounded-b-[18px] p-2 transition-colors duration-150 ${
          showDropTarget ? "taskboard-drop-target" : ""
        }`}
      >
        {isAddingTaskInline ? (
          <div className="taskboard-add-shell rounded-[12px] border border-dashed border-border/60 p-1.5">
            <div className="flex flex-col gap-1.5">
              <input
                ref={quickAddInputRef}
                autoFocus
                aria-label={`New task title for ${bucket.title}`}
                value={newTaskTitle}
                onChange={(event) => setNewTaskTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    closeInlineTask();
                    return;
                  }

                  handlePlainEnterSubmit(event, submitInlineTask);
                }}
                placeholder={newWorkItemType === "maintenance_outage" ? "Outage title" : "Task title"}
                disabled={!canEditBoard}
                className={`${COMPACT_INLINE_INPUT_CLASS} w-full`}
              />
              <div className="flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={closeInlineTask}
                  className={`ui-button ui-button-surface border transition ${ADD_TASK_ACTION_CLASS}`}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={submitInlineTask}
                  disabled={!canEditBoard || !newTaskTitle.trim()}
                  className={`ui-button ui-button-primary ${ADD_TASK_ACTION_CLASS}`}
                >
                  Add
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="taskboard-add-split-control relative min-w-0">
            <button
              type="button"
              onClick={() => {
                setIsCreateMenuOpen(false);
                setNewWorkItemType("task");
                setIsAddingTaskInline(true);
              }}
              disabled={!canEditBoard}
              className={`${ADD_TASK_BUTTON_CLASS} taskboard-add-split-main min-w-0`}
            >
              + Add task
            </button>
            <button
              ref={createMenuButtonRef}
              type="button"
              onClick={() => setIsCreateMenuOpen((current) => !current)}
              disabled={!canEditBoard}
              className="taskboard-add-button taskboard-add-split-toggle"
              aria-label={`More create options for ${bucket.title}`}
              aria-haspopup="menu"
              aria-expanded={isCreateMenuOpen}
            >
              <ChevronDown className="h-3 w-3" />
            </button>
            {isCreateMenuOpen ? (
              <FloatingMenuPortal
                isOpen={isCreateMenuOpen}
                anchorRef={createMenuButtonRef}
                surfaceRef={createMenuRef}
                preferredWidth={150}
                align="end"
                className="taskboard-popover rounded-[10px] border p-1 shadow-lg"
              >
                <div role="menu" aria-label={`Create in ${bucket.title}`}>
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      setNewWorkItemType("maintenance_outage");
                      setIsAddingTaskInline(true);
                      setIsCreateMenuOpen(false);
                    }}
                    className={`${COMPACT_MENU_ITEM_CLASS} gap-1.5`}
                  >
                    <CalendarClock className="h-3 w-3" />
                    Outage
                  </button>
                </div>
              </FloatingMenuPortal>
            ) : null}
          </div>
        )}

        {bucket.collapsed ? (
          bucket.tasks.length > 0 || (taskDropPreview && draggedTask) ? (
            <SortableContext
              items={bucket.tasks.map((task) => task.id)}
              strategy={verticalListSortingStrategy}
            >
              <div className="flex flex-col gap-1">
                {bucket.tasks.map((task, index) => (
                  <Fragment key={task.id}>
                    {taskDropPreviewIndex === index && draggedTask ? (
                      <TaskDropPlaceholder collapsed task={draggedTask} />
                    ) : null}
                    <SortableCollapsedTaskCard
                      bucketId={bucket.id}
                      isCalendarArrival={task.id === calendarArrivalTaskId}
                      isDragDisabled={isTaskDragDisabled}
                      isSelected={task.id === selectedTaskId}
                      onSelectTask={onSelectTask}
                      task={task}
                    />
                  </Fragment>
                ))}
                {taskDropPreviewIndex === bucket.tasks.length && draggedTask ? (
                  <TaskDropPlaceholder collapsed task={draggedTask} />
                ) : null}
              </div>
            </SortableContext>
          ) : (
            <div className={`taskboard-subtle-surface rounded-[10px] border border-dashed border-border/60 p-3 text-left ${EMPTY_STATE_TEXT_CLASS}`}>
              No tasks.
            </div>
          )
        ) : (
          <SortableContext
            items={bucket.tasks.map((task) => task.id)}
            strategy={verticalListSortingStrategy}
          >
            {bucket.tasks.map((task, index) => (
              <Fragment key={task.id}>
                {taskDropPreviewIndex === index && draggedTask ? (
                  <TaskDropPlaceholder task={draggedTask} />
                ) : null}
                <SortableTaskCard
                  task={task}
                  bucketId={bucket.id}
                  compactCards={compactCards}
                  detailLevel={detailLevel}
                  isSelected={task.id === selectedTaskId}
                  isCalendarArrival={task.id === calendarArrivalTaskId}
                  onSelectTask={onSelectTask}
                  isDragDisabled={isTaskDragDisabled}
                />
              </Fragment>
            ))}
            {taskDropPreviewIndex === bucket.tasks.length && draggedTask ? (
              <TaskDropPlaceholder task={draggedTask} />
            ) : null}
            {bucket.tasks.length === 0 && !taskDropPreview ? (
              <div className={`taskboard-subtle-surface rounded-[10px] border border-dashed border-border/60 p-3 text-left ${EMPTY_STATE_TEXT_CLASS}`}>
                {canEditBoard ? "No tasks yet. Add one above or drag a card here." : "No tasks yet."}
              </div>
            ) : (
              <div />
            )}
          </SortableContext>
        )}

      </div>
    </section>
  );
}, (prev, next) =>
  prev.bucket === next.bucket &&
  prev.bucketIndex === next.bucketIndex &&
  prev.bucketCount === next.bucketCount &&
  prev.compactCards === next.compactCards &&
  prev.detailLevel === next.detailLevel &&
  prev.selectedTaskId === next.selectedTaskId &&
  prev.calendarArrivalTaskId === next.calendarArrivalTaskId &&
  prev.isDropTarget === next.isDropTarget &&
  prev.taskDropPreview === next.taskDropPreview &&
  prev.draggedTask === next.draggedTask &&
  prev.isTaskDragDisabled === next.isTaskDragDisabled &&
  prev.canEditBoard === next.canEditBoard &&
  prev.quickAddRequestNonce === next.quickAddRequestNonce &&
  prev.notesEnabled === next.notesEnabled &&
  prev.noteCount === next.noteCount &&
  prev.boardId === next.boardId,
);

const SortableTaskCard = memo(function SortableTaskCard({
  task,
  bucketId,
  compactCards,
  detailLevel,
  isSelected,
  isCalendarArrival,
  onSelectTask,
  isDragDisabled,
}: {
  task: Task;
  bucketId: string;
  compactCards: boolean;
  detailLevel: CardDetailLevel;
  isSelected: boolean;
  isCalendarArrival: boolean;
  onSelectTask: (taskId: string) => void;
  isDragDisabled: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    disabled: isDragDisabled,
    data: {
      type: "task",
      bucketId,
      presentation: "expanded",
    },
  });

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: isDragging ? undefined : CSS.Transform.toString(transform),
        transition: isDragging ? undefined : transition,
      }}
      className={isDragging ? "opacity-20" : undefined}
    >
      <TaskCard
        task={task}
        compactCards={compactCards}
        detailLevel={detailLevel}
        isSelected={isSelected}
        isCalendarArrival={isCalendarArrival}
        onClick={() => onSelectTask(task.id)}
        dragActivatorRef={isDragDisabled ? undefined : setActivatorNodeRef}
        dragActivatorProps={isDragDisabled ? undefined : { ...attributes, ...listeners }}
      />
    </div>
  );
}, (prev, next) =>
  prev.task === next.task &&
  prev.bucketId === next.bucketId &&
  prev.compactCards === next.compactCards &&
  prev.detailLevel === next.detailLevel &&
  prev.isSelected === next.isSelected &&
  prev.isCalendarArrival === next.isCalendarArrival &&
  prev.isDragDisabled === next.isDragDisabled,
);

const SortableCollapsedTaskCard = memo(function SortableCollapsedTaskCard({
  bucketId,
  isCalendarArrival,
  isDragDisabled,
  isSelected,
  onSelectTask,
  task,
}: {
  bucketId: string;
  isCalendarArrival: boolean;
  isDragDisabled: boolean;
  isSelected: boolean;
  onSelectTask: (taskId: string) => void;
  task: Task;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: task.id,
    disabled: isDragDisabled,
    data: {
      type: "task",
      bucketId,
      presentation: "collapsed",
    },
  });
  const displayTimeZone = useDisplayTimeZone();
  const nowMinute = useNowMinute();
  const isOverdue = nowMinute !== null && isTaskOverdue(task, nowMinute);

  return (
    <div
      ref={setNodeRef}
      data-testid="task-card"
      data-task-id={task.id}
      data-task-status={task.status}
      data-overdue={isOverdue ? "true" : undefined}
      data-drag-surface={isDragDisabled ? undefined : "true"}
      data-calendar-arrival={isCalendarArrival ? "true" : undefined}
      className={`flex w-full whitespace-normal break-words rounded-[9px] border border-border/60 bg-surface-subtle text-left text-[12px] font-medium leading-4 transition hover:border-foreground/30 hover:text-foreground ${
        isSelected ? "taskboard-card-selected" : ""
      } ${
        isCalendarArrival ? "taskboard-card-calendar-arrival" : ""
      } ${
        task.status === "done" ? "text-muted line-through" : "text-foreground"
      } ${isDragging ? "opacity-20" : ""}`}
      style={{
        transform: isDragging ? undefined : CSS.Transform.toString(transform),
        transition: isDragging ? undefined : transition,
      }}
      title={task.title}
    >
      {/* The whole card opens the task on click and moves it on drag. */}
      <button
        type="button"
        ref={isDragDisabled ? undefined : setActivatorNodeRef}
        {...(isDragDisabled ? {} : { ...attributes, ...listeners })}
        onClick={() => onSelectTask(task.id)}
        data-task-nav={task.id}
        data-drag-activator={isDragDisabled ? undefined : "true"}
        className={`taskboard-task-card-surface flex w-full min-w-0 flex-1 items-start gap-1.5 py-1.5 pl-3 pr-2.5 text-left ${
          isDragDisabled ? "" : "drag-card select-none"
        }`}
        aria-label={`Open task ${task.title}${isOverdue ? " (overdue)" : ""}`}
      >
        <span className="line-clamp-2 min-w-0 flex-1">{task.title}</span>
        {isOverdue && task.dueAt ? (
          <span
            className="taskboard-card-overdue-marker mt-px shrink-0"
            data-testid="task-card-overdue-marker"
            title={`Overdue, was due ${formatDate(task.dueAt, displayTimeZone)}`}
          >
            <FinishFlagIcon className="h-3 w-3" />
          </span>
        ) : null}
      </button>
    </div>
  );
}, (prev, next) =>
  prev.task === next.task &&
  prev.bucketId === next.bucketId &&
  prev.isCalendarArrival === next.isCalendarArrival &&
  prev.isDragDisabled === next.isDragDisabled &&
  prev.isSelected === next.isSelected,
);

function TaskDropPlaceholder({
  collapsed = false,
  task,
}: {
  collapsed?: boolean;
  task: Task;
}) {
  return (
    <div
      aria-hidden="true"
      className={`taskboard-card taskboard-task-drop-placeholder pointer-events-none flex w-full items-start border border-dashed pl-3 pr-2.5 text-left text-foreground ${
        collapsed
          ? "min-h-[34px] rounded-[9px] py-1.5 text-[12px] font-medium leading-4"
          : "min-h-[52px] rounded-[12px] py-2 text-[13px] font-semibold leading-5"
      }`}
      data-testid="task-drop-placeholder"
      data-task-id={task.id}
    >
      <span className="line-clamp-2 min-w-0 flex-1">{task.title}</span>
    </div>
  );
}

function CollapsedTaskDragPreview({
  isSelected,
  task,
}: {
  isSelected: boolean;
  task: Task;
}) {
  return (
    <div
      aria-hidden="true"
      className={`taskboard-card flex w-full items-start whitespace-normal break-words rounded-[9px] border border-border/60 py-1.5 pl-3 pr-2.5 text-left text-[12px] font-medium leading-4 shadow-lg ${
        isSelected ? "taskboard-card-selected" : ""
      } ${task.status === "done" ? "text-muted line-through" : "text-foreground"}`}
      data-testid="collapsed-task-drag-preview"
      data-task-status={task.status}
    >
      <span className="line-clamp-2 min-w-0 flex-1">{task.title}</span>
    </div>
  );
}

// A checkered "finish line" flag for due dates.
function FinishFlagIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true" className={className} fill="currentColor">
      <rect x="2" y="1.5" width="1.4" height="13" rx="0.6" />
      <rect x="3.4" y="2.5" width="10" height="7" fill="none" stroke="currentColor" strokeWidth="0.8" />
      <rect x="3.4" y="2.5" width="2.5" height="2.34" />
      <rect x="8.4" y="2.5" width="2.5" height="2.34" />
      <rect x="5.9" y="4.84" width="2.5" height="2.33" />
      <rect x="10.9" y="4.84" width="2.5" height="2.33" />
      <rect x="3.4" y="7.17" width="2.5" height="2.33" />
      <rect x="8.4" y="7.17" width="2.5" height="2.33" />
    </svg>
  );
}

function TaskCard({
  task,
  compactCards,
  detailLevel,
  isSelected = false,
  isCalendarArrival = false,
  onClick,
  dragActivatorRef,
  dragActivatorProps,
}: {
  task: Task;
  compactCards: boolean;
  detailLevel: CardDetailLevel;
  isSelected?: boolean;
  isCalendarArrival?: boolean;
  onClick?: () => void;
  dragActivatorRef?: (element: HTMLElement | null) => void;
  dragActivatorProps?: HTMLAttributes<HTMLButtonElement>;
}) {
  const isDraggable = Boolean(dragActivatorProps);
  const displayTimeZone = useDisplayTimeZone();
  const resolvedCompact = detailLevel === "minimal" ? true : compactCards;
  const summaryPreview = getTaskSummaryPreview(task);
  const summaryLineClamp =
    detailLevel === "detailed"
      ? "line-clamp-4"
      : resolvedCompact
        ? "line-clamp-2"
        : "line-clamp-3";
  const isStaleImport = task.importedFrom?.syncStatus === "stale";
  const nowMinute = useNowMinute();
  const isOverdue = nowMinute !== null && isTaskOverdue(task, nowMinute);

  // The card's status is the colored bar on its left edge (CSS, from
  // data-task-status). The bottom line shows the due date, else the created date.
  return (
    <article
      tabIndex={isCalendarArrival ? -1 : undefined}
      className={`taskboard-card drag-card rounded-[12px] border border-border/70 transition hover:-translate-y-0.5 ${
        isSelected ? "taskboard-card-selected" : ""
      } ${
        isCalendarArrival ? "taskboard-card-calendar-arrival" : ""
      } ${
        isStaleImport ? "opacity-75" : ""
      }`}
      data-testid="task-card"
      data-task-id={task.id}
      data-task-status={task.status}
      data-overdue={isOverdue ? "true" : undefined}
      data-calendar-arrival={isCalendarArrival ? "true" : undefined}
    >
      {/* The whole card opens the task on click and moves it on drag. */}
      <button
        type="button"
        ref={dragActivatorRef}
        {...dragActivatorProps}
        onClick={onClick}
        data-task-nav={task.id}
        data-drag-activator={isDraggable ? "true" : undefined}
        className={`taskboard-task-card-surface flex w-full min-w-0 flex-col items-stretch p-2 text-left ${
          isDraggable ? "select-none" : ""
        }`}
      >
        <h3 className={TASK_CARD_TITLE_CLASS}>{task.title}</h3>
        <span className="sr-only">Status: {TASK_STATUS_LABELS[task.status]}.</span>

        {summaryPreview ? (
          <p className={`taskboard-card-summary mt-0.5 whitespace-pre-line ${summaryLineClamp} ${TASK_CARD_BODY_CLASS}`}>
            {summaryPreview}
          </p>
        ) : null}

        {/* Date stamp: smaller and set apart from the description; the icon says
            which date it is (finish flag = due, calendar-plus = created). */}
        {task.dueAt ? (
          <p
            className={`taskboard-card-date mt-1.5 flex items-center gap-1 ${
              isOverdue ? "taskboard-card-date--overdue" : ""
            }`}
            data-date-kind="due"
            title={`${isOverdue ? "Overdue, was due" : "Due"} ${formatDate(task.dueAt, displayTimeZone)}`}
          >
            <FinishFlagIcon className="taskboard-card-date-icon shrink-0" />
            {isOverdue ? (
              <span className="taskboard-card-overdue-label">Overdue ·</span>
            ) : (
              <span className="sr-only">Due </span>
            )}
            {formatDate(task.dueAt, displayTimeZone)}
          </p>
        ) : task.createdAt ? (
          <p
            className="taskboard-card-date mt-1.5 flex items-center gap-1"
            data-date-kind="created"
            title={`Created ${formatDateOnly(task.createdAt, displayTimeZone)}`}
          >
            <CalendarPlus className="taskboard-card-date-icon shrink-0" aria-hidden="true" />
            <span className="sr-only">Created </span>
            {formatDateOnly(task.createdAt, displayTimeZone)}
          </p>
        ) : null}
      </button>
    </article>
  );
}

// Promote, Archive and Delete in both task editors' "…" menus, from the task
// actions every surface shares (src/lib/task-actions.ts).
function EditorTaskActionItems({
  task,
  isRootTask,
  isArchived,
  canEditBoard,
  canManageLifecycle,
  onPromote,
  onArchive,
  onDelete,
  onDone,
}: {
  task: Task;
  isRootTask: boolean;
  isArchived: boolean;
  canEditBoard: boolean;
  canManageLifecycle: boolean;
  onPromote: () => void;
  onArchive: () => void;
  onDelete: () => void;
  onDone: () => void;
}) {
  const actions = getTaskActions(task, { canEditBoard, canManageLifecycle, isRootTask, isArchived, hasCalendarLink: false }, "editor");
  const handlers: Partial<Record<TaskActionId, () => void>> = { promote: onPromote, archive: onArchive, delete: onDelete };
  return (
    <>
      {actions.map((action) => (
        <button
          key={action.id}
          type="button"
          onClick={() => {
            handlers[action.id]?.();
            onDone();
          }}
          disabled={!action.enabled}
          title={action.enabled ? undefined : action.disabledReason}
          className={`${TASK_EDITOR_MENU_ITEM_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          {TASK_ACTION_ICONS[action.id]}
          {action.label}
        </button>
      ))}
    </>
  );
}

function TaskEditorStatusBadge({
  isArchived,
  status,
}: {
  isArchived: boolean;
  status: TaskStatus;
}) {
  return isArchived ? (
    <span
      className="ui-danger-banner ed-chip rounded-full border"
      data-testid="task-editor-archived-status"
    >
      Archived
    </span>
  ) : (
    <StatusBadge status={status} sizeClassName="ed-chip" />
  );
}

function TaskAutosaveIndicator({ state }: { state: TaskAutosaveState }) {
  if (state === "idle") {
    return null;
  }

  const label = state === "saving" ? "Saving" : state === "saved" ? "Saved" : "Save error";
  return (
    <span
      className={`ed-chip w-fit rounded-full border ${
        state === "error"
          ? "ui-danger-banner"
          : "taskboard-label-chip taskboard-label-chip-muted"
      }`}
      aria-live="polite"
      data-testid="task-inspector-autosave"
      role={state === "error" ? "alert" : "status"}
    >
      {label}
    </span>
  );
}

function SidebarScheduleDisclosure({
  allDay,
  children,
  endAt,
  startAt,
}: {
  allDay: boolean;
  children: ReactNode;
  endAt: string;
  startAt: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const formatValue = (value: string) => {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "Invalid date";
    }

    return new Intl.DateTimeFormat("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
      ...(allDay ? {} : { hour: "numeric", minute: "2-digit" }),
    }).format(date);
  };
  const startSummary = startAt
    ? `Start ${formatValue(startAt)}${allDay ? " · All Day" : ""}`
    : "Start not set";
  const endSummary = endAt
    ? `End ${formatValue(endAt)}${allDay ? " · All Day" : ""}`
    : null;

  return (
    <section className="taskboard-inspector-disclosure min-w-0 rounded-[8px] border border-border/45 bg-transparent px-2 py-1.5">
      <button
        type="button"
        className="flex w-full min-w-0 items-start justify-between gap-2 text-left"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((current) => !current)}
      >
        <span className="min-w-0 flex-1 ed-meta text-foreground">
          <span className="block truncate">{startSummary}</span>
          {endSummary ? <span className="block truncate text-muted">{endSummary}</span> : null}
        </span>
        <ChevronDown
          aria-hidden="true"
          className={`mt-0.5 h-3.5 w-3.5 shrink-0 transition-transform ${
            isOpen ? "rotate-180" : ""
          }`}
        />
      </button>
      {isOpen ? <div className="mt-1.5 border-t border-border/50 pt-1.5">{children}</div> : null}
    </section>
  );
}

function SidebarDueControl({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (nextDueAt: string) => void;
}) {
  const displayTimeZone = useDisplayTimeZone();
  const normalizedValue = normalizeDateTimeInput(value);
  const { date: dateValue, time: timeValue } = splitDateTimeInput(value);
  const presetButtonClass = `${TASK_EDITOR_BUTTON_CLASS} h-6 border border-border/70 bg-background/25 px-2 disabled:cursor-not-allowed disabled:opacity-50`;

  return (
    <div className="block min-w-0" data-testid="task-inspector-due">
      <span className="mb-1 flex min-w-0 items-baseline justify-between gap-2">
        <span className={TASK_EDITOR_LABEL_CLASS}>Due</span>
        <span className="flex min-w-0 items-baseline gap-1.5">
          <span className={`truncate ${TASK_EDITOR_MUTED_TEXT_CLASS}`} data-testid="task-inspector-due-value">
            {normalizedValue ? formatDate(normalizedValue, displayTimeZone) : "No due date"}
          </span>
          {value ? (
            <button
              type="button"
              onClick={() => onChange("")}
              disabled={disabled}
              className={`${TASK_EDITOR_INLINE_BUTTON_CLASS} shrink-0 disabled:cursor-not-allowed disabled:opacity-50`}
              aria-label="Clear due date"
            >
              Clear
            </button>
          ) : null}
        </span>
      </span>
      <div className="flex min-w-0 flex-wrap items-center gap-1">
        {duePresetOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(getDuePresetDateTime(option.value))}
            disabled={disabled}
            className={presetButtonClass}
          >
            {option.label}
          </button>
        ))}
        <input
          type="date"
          value={dateValue}
          onChange={(event) =>
            onChange(
              event.target.value
                ? combineDateTimeInput(event.target.value, timeValue || `${DUE_PRESET_HOUR}:00`)
                : "",
            )
          }
          disabled={disabled}
          aria-label="Pick due date"
          className={`${TASK_EDITOR_INPUT_CLASS} h-6 w-[8.5rem] min-w-0 px-1.5 disabled:cursor-not-allowed disabled:opacity-60`}
        />
      </div>
    </div>
  );
}

function TaskDetailPanel({
  viewerId,
  task,
  focusedSubtaskId = null,
  isArchived,
  isRootTask,
  bucketOptions,
  currentBucketId,
  mode,
  emptyStateNewTaskBucket,
  focusView,
  todayView,
  onCloseInspector,
  onCreateTask,
  onOpenView,
  onRegisterTextFlush,
  onExpand,
  onCollapse,
  onSaveTask,
  saveQueue,
  onPeopleRosterChanged,
  onArchiveTask,
  onDeleteTask,
  onConvertImportedTask,
  onCreateFollowUpTask,
  onAddSubtask,
  onMoveSubtask,
  onChecklistAdd,
  onChecklistUpdate,
  onChecklistDelete,
  onUploadAttachments,
  onDeleteAttachment,
  onRenameAttachment,
  onCreateNote,
  onUpdateNote,
  onDeleteNote,
  onUploadNoteAttachments,
  attachmentsEnabled,
  activeBoardId,
  canEditBoard,
  canManageTaskLifecycle,
  publicSharesEnabled = false,
  calendarHandoffActive,
  maintenanceLocations,
  onCreateMaintenanceLocation,
}: {
  viewerId: string;
  task: Task | null;
  // The subtask a link asked for; the Work tab shows it selected.
  focusedSubtaskId?: string | null;
  isArchived: boolean;
  isRootTask: boolean;
  bucketOptions: Array<{ id: string; title: string }>;
  currentBucketId: string | null;
  mode: DetailPanelMode;
  emptyStateNewTaskBucket: { id: string; title: string } | null;
  focusView: ViewPreset | null;
  todayView: ViewPreset | null;
  onCloseInspector: () => void;
  onCreateTask: (
    bucketId: string,
    title: string,
    workItemType?: "task" | "maintenance_outage",
  ) => Promise<boolean>;
  onOpenView: (viewId: string) => void;
  onRegisterTextFlush: (flush: (() => void) | null) => void;
  onExpand: () => void;
  onCollapse: () => void;
  onSaveTask: TaskSaveHandler;
  saveQueue: TaskSaves;
  onPeopleRosterChanged?: (taskId: string, attendees: string[]) => void;
  onArchiveTask: (taskId: string) => void | Promise<void>;
  onDeleteTask: (taskId: string) => void | Promise<void>;
  onConvertImportedTask: (taskId: string) => void | Promise<void>;
  onCreateFollowUpTask: (taskId: string) => void | Promise<void>;
  onAddSubtask: (taskId: string, title: string) => void | Promise<void>;
  onMoveSubtask?: (move: SubtaskMove, options?: { announce?: boolean }) => void | Promise<void>;
  onChecklistAdd: (taskId: string, label: string) => void | Promise<void>;
  onChecklistUpdate: (
    itemId: string,
    patch: { label?: string; done?: boolean },
  ) => void | Promise<void>;
  onChecklistDelete: (itemId: string) => void | Promise<void>;
  onUploadAttachments: (taskId: string, files: File[]) => void | Promise<void>;
  onDeleteAttachment: (taskId: string, attachmentId: string) => void | Promise<void>;
  onRenameAttachment: (
    taskId: string,
    attachmentId: string,
    displayName: string,
  ) => void | Promise<void>;
  onCreateNote: (taskId: string, body: string) => void | Promise<void>;
  onUpdateNote: (taskId: string, noteId: string, body: string) => void | Promise<void>;
  onDeleteNote: (taskId: string, noteId: string) => void | Promise<void>;
  onUploadNoteAttachments: (
    taskId: string,
    noteId: string,
    files: File[],
  ) => void | Promise<void>;
  attachmentsEnabled: boolean;
  activeBoardId: string;
  canEditBoard: boolean;
  canManageTaskLifecycle: boolean;
  publicSharesEnabled?: boolean;
  calendarHandoffActive?: boolean;
  maintenanceLocations: MaintenanceLocation[];
  onCreateMaintenanceLocation: (name: string) => Promise<string | null>;
}) {
  if (!task) {
    return (
      <TaskInspectorEmptyState
        emptyStateNewTaskBucket={emptyStateNewTaskBucket}
        focusView={focusView}
        todayView={todayView}
        canEditBoard={canEditBoard}
        onCloseInspector={onCloseInspector}
        onCreateTask={onCreateTask}
        onOpenView={onOpenView}
      />
    );
  }

  if (mode === "sidebar") {
    return (
      <TaskSidebarEditor
        key={task.id}
        task={task}
        isArchived={isArchived}
        isRootTask={isRootTask}
        bucketOptions={bucketOptions}
        currentBucketId={currentBucketId}
        onCloseInspector={onCloseInspector}
        onRegisterTextFlush={onRegisterTextFlush}
        onExpand={onExpand}
        saveQueue={saveQueue}
        onArchiveTask={onArchiveTask}
        onDeleteTask={onDeleteTask}
        onConvertImportedTask={onConvertImportedTask}
        onCreateFollowUpTask={onCreateFollowUpTask}
        activeBoardId={activeBoardId}
        canEditBoard={canEditBoard}
        canManageTaskLifecycle={canManageTaskLifecycle}
        calendarHandoffActive={calendarHandoffActive}
        maintenanceLocations={maintenanceLocations}
        onCreateMaintenanceLocation={onCreateMaintenanceLocation}
      />
    );
  }

  return (
    <TaskDetailEditor
      viewerId={viewerId}
      publicSharesEnabled={publicSharesEnabled}
      key={task.id}
      task={task}
      focusedSubtaskId={focusedSubtaskId}
      isArchived={isArchived}
      isRootTask={isRootTask}
      bucketOptions={bucketOptions}
      currentBucketId={currentBucketId}
      mode={mode}
      onCloseInspector={onCloseInspector}
      onRegisterTextFlush={onRegisterTextFlush}
      onExpand={onExpand}
      onCollapse={onCollapse}
      onPeopleRosterChanged={onPeopleRosterChanged}
      onSaveTask={onSaveTask}
      saveQueue={saveQueue}
      onArchiveTask={onArchiveTask}
      onDeleteTask={onDeleteTask}
      onConvertImportedTask={onConvertImportedTask}
      onCreateFollowUpTask={onCreateFollowUpTask}
      onAddSubtask={onAddSubtask}
      onMoveSubtask={onMoveSubtask}
      onChecklistAdd={onChecklistAdd}
      onChecklistUpdate={onChecklistUpdate}
      onChecklistDelete={onChecklistDelete}
      onUploadAttachments={onUploadAttachments}
      onDeleteAttachment={onDeleteAttachment}
      onRenameAttachment={onRenameAttachment}
      onCreateNote={onCreateNote}
      onUpdateNote={onUpdateNote}
      onDeleteNote={onDeleteNote}
      onUploadNoteAttachments={onUploadNoteAttachments}
      attachmentsEnabled={attachmentsEnabled}
      activeBoardId={activeBoardId}
      canEditBoard={canEditBoard}
      canManageTaskLifecycle={canManageTaskLifecycle}
      maintenanceLocations={maintenanceLocations}
      onCreateMaintenanceLocation={onCreateMaintenanceLocation}
    />
  );
}

function LabelChipEditor({
  value,
  caseSensitive = false,
  disabled = false,
  itemName = "label",
  inputPosition = "inline",
  onChange,
  onCommit,
}: LabelChipEditorProps) {
  const labels = useMemo(() => parseLabelInput(value, caseSensitive), [value, caseSensitive]);
  const [draftLabel, setDraftLabel] = useState("");

  const commitLabels = (nextLabels: string[]) => {
    const nextValue = formatLabelInput(nextLabels, caseSensitive);
    onChange(nextValue);
    onCommit(nextValue);
  };

  const commitDraftLabel = () => {
    const nextLabels = parseLabelInput(draftLabel, caseSensitive);
    if (nextLabels.length === 0) {
      setDraftLabel("");
      return;
    }

    commitLabels([...labels, ...nextLabels]);
    setDraftLabel("");
  };

  const removeLabel = (labelToRemove: string) => {
    commitLabels(
      labels.filter((label) => caseSensitive ? label !== labelToRemove : label.toLocaleLowerCase() !== labelToRemove.toLocaleLowerCase()),
    );
  };

  const removeLastLabel = () => {
    if (labels.length === 0 || draftLabel.length > 0) {
      return;
    }

    commitLabels(labels.slice(0, -1));
  };

  const input = (
    <input
      value={draftLabel}
      onChange={(event) => {
        const nextValue = event.target.value;
        if (nextValue.includes(",")) {
          const nextLabels = parseLabelInput(nextValue, caseSensitive);
          if (nextLabels.length > 0) {
            commitLabels([...labels, ...nextLabels]);
          }
          setDraftLabel("");
          return;
        }

        setDraftLabel(nextValue);
      }}
      onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commitDraftLabel();
          return;
        }

        if (event.key === "Backspace") {
          removeLastLabel();
        }
      }}
      onBlur={commitDraftLabel}
      disabled={disabled}
      placeholder={labels.length > 0 ? `Add ${itemName}` : `Type ${itemName} and press Enter`}
      className={inputPosition === "above"
        ? TASK_EDITOR_INPUT_CLASS
        : "min-w-[9rem] flex-1 border-0 bg-transparent px-0 py-1 ed-field text-foreground outline-none placeholder:text-muted disabled:cursor-not-allowed"}
      aria-label={`Add ${itemName}`}
    />
  );

  const chips = (
    <div
      className={`taskboard-label-editor flex min-h-9 w-full min-w-0 flex-wrap items-center gap-1.5 rounded-[10px] border border-border/70 bg-background/35 px-2 py-1 ${
        disabled ? "cursor-not-allowed opacity-60" : ""
      }`}
    >
      {labels.map((label) => (
        <span
          key={label}
          className="taskboard-label-chip taskboard-label-edit-chip inline-flex max-w-full items-center gap-1 rounded-[8px] border border-border/60 px-2 py-0.5 ed-meta font-medium"
        >
          <span className="min-w-0 truncate">{label}</span>
          <button
            type="button"
            onClick={() => removeLabel(label)}
            disabled={disabled}
            className="taskboard-label-chip-remove -mr-1 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[6px] text-muted hover:bg-foreground/10 hover:text-foreground disabled:cursor-not-allowed"
            aria-label={`Remove ${itemName} ${label}`}
          >
            <X className="h-3 w-3" />
          </button>
        </span>
      ))}
      {inputPosition === "inline" ? input : null}
    </div>
  );

  return inputPosition === "above" ? <div className="space-y-1.5">{input}{chips}</div> : chips;
}

function MaintenanceOutageFields({
  task,
  locations,
  disabled,
  compact = false,
  onSave,
  onCreateLocation,
}: {
  task: Task;
  locations: MaintenanceLocation[];
  disabled: boolean;
  // The workspace details column: a titled group without the explainer.
  compact?: boolean;
  onSave: (patch: MaintenanceOutagePatch) => void;
  onCreateLocation: (name: string) => Promise<string | null>;
}) {
  const outage = task.maintenanceOutage ?? { owner: "", attendees: [] };
  const selectableLocations = locations.filter(
    (location) => location.isActive || location.id === outage.locationId,
  );

  // "+ Add location..." swaps the select for a name typed in place.
  const [isAddingLocation, setIsAddingLocation] = useState(false);

  const handleLocationChange = (value: string) => {
    if (value === "__add__") {
      setIsAddingLocation(true);
      return;
    }

    onSave({ locationId: value || null });
  };

  const handleCreateLocation = async (name: string) => {
    const locationId = await onCreateLocation(name);
    if (!locationId) {
      return "Unable to create maintenance location.";
    }
    setIsAddingLocation(false);
    onSave({ locationId });
    return null;
  };

  return (
    <section
      className={`${compact ? "workspace-outage-group" : "taskboard-subtle-surface"} space-y-1.5 rounded-[12px] border border-border/60 p-2.5`}
      data-testid="maintenance-outage-fields"
    >
      {compact ? (
        <span className={TASK_EDITOR_LABEL_CLASS}>Outage</span>
      ) : (
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0">
            <p className="ed-strong text-foreground">Maintenance outage</p>
            <p className={TASK_EDITOR_MUTED_TEXT_CLASS}>Only the title is required.</p>
          </div>
          <span className="taskboard-label-chip shrink-0 rounded-[6px] px-2 py-0.5 ed-chip">
            Outage
          </span>
        </div>
      )}
      <label className="block min-w-0">
        <span className={TASK_EDITOR_LABEL_CLASS}>Location</span>
        {isAddingLocation && !disabled ? (
          <InlineNameField
            label="New maintenance location name"
            placeholder="New location name"
            inputClassName={TASK_EDITOR_INPUT_CLASS}
            testId="maintenance-location-name-input"
            onSubmit={handleCreateLocation}
            onCancel={() => setIsAddingLocation(false)}
          />
        ) : (
          <select
            value={outage.locationId ?? ""}
            onChange={(event) => handleLocationChange(event.target.value)}
            disabled={disabled}
            className={TASK_EDITOR_SELECT_CLASS}
          >
            <option value="">None</option>
            {selectableLocations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}{location.isActive ? "" : " (inactive)"}
              </option>
            ))}
            <option value="__add__">+ Add location...</option>
          </select>
        )}
      </label>
      <label className="block min-w-0">
        <span className={TASK_EDITOR_LABEL_CLASS}>Owner</span>
        <input
          key={`${task.id}-owner-${outage.owner}`}
          defaultValue={outage.owner}
          onBlur={(event) => onSave({ owner: event.currentTarget.value })}
          disabled={disabled}
          className={TASK_EDITOR_INPUT_CLASS}
          placeholder="Optional owner"
        />
      </label>
      <div className="block min-w-0" role="group" aria-label="Attendees">
        <span className={TASK_EDITOR_LABEL_CLASS}>Attendees</span>
        <LabelChipEditor
          value={formatLabelInput(outage.attendees, true)}
          caseSensitive
          disabled={disabled}
          itemName="attendee"
          inputPosition="above"
          onChange={() => {}}
          onCommit={value => {
            const next = parseLabelInput(value, true), previous = outage.attendees;
            const attendeeChanges = [...previous.filter(name => !next.includes(name)).map(name => ({ name, attending: false })), ...next.filter(name => !previous.includes(name)).map(name => ({ name, attending: true }))];
            if (attendeeChanges.length) onSave({ attendeeChanges });
          }}
        />
      </div>
    </section>
  );
}

function TaskScheduleFields({
  allDay,
  disabled,
  endAt,
  onAllDayChange,
  onEndAtChange,
  onStartAtChange,
  startAt,
  testIdPrefix,
}: {
  allDay: boolean;
  disabled: boolean;
  endAt: string;
  onAllDayChange: (allDay: boolean, startAt: string, endAt: string) => void;
  onEndAtChange: (value: string) => void;
  onStartAtChange: (value: string) => void;
  startAt: string;
  testIdPrefix: string;
}) {
  const startDateTime = splitDateTimeInput(startAt);
  const endDateTime = splitDateTimeInput(endAt);
  const rememberedTimedValuesRef = useRef(
    allDay ? { endTime: "", startTime: "" } : getRememberedTaskScheduleTimes(startAt, endAt),
  );

  useEffect(() => {
    if (!allDay) {
      rememberedTimedValuesRef.current = getRememberedTaskScheduleTimes(startAt, endAt);
    }
  }, [allDay, endAt, startAt]);

  return (
    <div className="grid gap-2" data-testid={`${testIdPrefix}-schedule-fields`}>
      <label className="block min-w-0">
        <span className={TASK_EDITOR_LABEL_CLASS}>Start</span>
        <div className="flex min-w-0 flex-wrap gap-1.5">
          <input
            type="date"
            value={startDateTime.date}
            onChange={(event) =>
              onStartAtChange(
                combineDateTimeInput(
                  event.target.value,
                  allDay ? "00:00" : startDateTime.time,
                ),
              )
            }
            disabled={disabled}
            className={`${TASK_EDITOR_INPUT_CLASS} task-editor-date-part-input min-w-[9.5rem] flex-[2_1_9.5rem] disabled:cursor-not-allowed disabled:opacity-60`}
            aria-label="Start date"
          />
          {!allDay ? (
            <input
              type="time"
              value={startDateTime.time}
              onChange={(event) => {
                rememberedTimedValuesRef.current.startTime = event.target.value;
                onStartAtChange(combineDateTimeInput(startDateTime.date, event.target.value));
              }}
              disabled={disabled}
              className={`${TASK_EDITOR_INPUT_CLASS} task-editor-date-part-input min-w-[8rem] flex-[1_1_8rem] disabled:cursor-not-allowed disabled:opacity-60`}
              aria-label="Start time"
            />
          ) : null}
        </div>
      </label>
      <label className="block min-w-0">
        <span className={TASK_EDITOR_LABEL_CLASS}>End</span>
        <div className="flex min-w-0 flex-wrap gap-1.5">
          <input
            type="date"
            value={endDateTime.date}
            onChange={(event) =>
              onEndAtChange(
                combineDateTimeInput(
                  event.target.value,
                  allDay ? "00:00" : endDateTime.time,
                ),
              )
            }
            disabled={disabled}
            className={`${TASK_EDITOR_INPUT_CLASS} task-editor-date-part-input min-w-[9.5rem] flex-[2_1_9.5rem] disabled:cursor-not-allowed disabled:opacity-60`}
            aria-label="End date"
          />
          {!allDay ? (
            <input
              type="time"
              value={endDateTime.time}
              onChange={(event) => {
                rememberedTimedValuesRef.current.endTime = event.target.value;
                onEndAtChange(combineDateTimeInput(endDateTime.date, event.target.value));
              }}
              disabled={disabled}
              className={`${TASK_EDITOR_INPUT_CLASS} task-editor-date-part-input min-w-[8rem] flex-[1_1_8rem] disabled:cursor-not-allowed disabled:opacity-60`}
              aria-label="End time"
            />
          ) : null}
        </div>
      </label>
      <label className="flex w-fit items-center gap-2 ed-body font-medium text-foreground">
        <input
          type="checkbox"
          checked={allDay}
          onChange={(event) => {
            const nextAllDay = event.target.checked;
            if (nextAllDay) {
              rememberedTimedValuesRef.current = getRememberedTaskScheduleTimes(startAt, endAt);
            }
            const nextSchedule = getTaskScheduleForAllDayToggle({
              endAt,
              nextAllDay,
              rememberedTimes: rememberedTimedValuesRef.current,
              startAt,
            });
            onAllDayChange(
              nextAllDay,
              nextSchedule.startAt,
              nextSchedule.endAt,
            );
          }}
          disabled={disabled}
          className="h-3.5 w-3.5 accent-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60"
          data-testid={`${testIdPrefix}-all-day`}
        />
        All day
      </label>
    </div>
  );
}

function TaskSidebarEditor({
  task,
  isArchived,
  isRootTask,
  bucketOptions,
  currentBucketId,
  onCloseInspector,
  onRegisterTextFlush,
  onExpand,
  saveQueue,
  onArchiveTask,
  onDeleteTask,
  onConvertImportedTask,
  onCreateFollowUpTask,
  activeBoardId,
  canEditBoard,
  canManageTaskLifecycle,
  calendarHandoffActive,
  maintenanceLocations,
  onCreateMaintenanceLocation,
}: {
  task: Task;
  isArchived: boolean;
  isRootTask: boolean;
  bucketOptions: Array<{ id: string; title: string }>;
  currentBucketId: string | null;
  onCloseInspector: () => void;
  onRegisterTextFlush: (flush: (() => void) | null) => void;
  onExpand: () => void;
  saveQueue: TaskSaves;
  onArchiveTask: (taskId: string) => void | Promise<void>;
  onDeleteTask: (taskId: string) => void | Promise<void>;
  onConvertImportedTask: (taskId: string) => void | Promise<void>;
  onCreateFollowUpTask: (taskId: string) => void | Promise<void>;
  activeBoardId: string;
  canEditBoard: boolean;
  canManageTaskLifecycle: boolean;
  calendarHandoffActive?: boolean;
  maintenanceLocations: MaintenanceLocation[];
  onCreateMaintenanceLocation: (name: string) => Promise<string | null>;
}) {
  const displayTimeZone = useDisplayTimeZone();
  // Fields with an autosave in flight or queued (see useServerSyncedDraft).
  const editorSaveSource = useEditorSaveSource();
  const savePendingFields = useEditorPendingSaveFields(saveQueue, task.id, editorSaveSource);
  const [acknowledgedPatch, setAcknowledgedPatch] = useState<TaskSavePatch | null>(null);
  const [draftTitle, setDraftTitle] = useServerSyncedDraft(task.title, savePendingFields.has("title"));
  const [draftSummary, setDraftSummary] = useServerSyncedDraft(getTaskPrimaryNoteDraftValue(task), savePendingFields.has("summary"));
  const [draftNextAction, setDraftNextAction] = useServerSyncedDraft(task.nextAction ?? "", savePendingFields.has("nextAction"));
  const [draftStatus, setDraftStatus] = useServerSyncedDraft<TaskStatus>(task.status, savePendingFields.has("status"));
  const [draftBucketId, setDraftBucketId] = useState(currentBucketId ?? "");
  const [draftStartAt, setDraftStartAt] = useServerSyncedDraft(formatDateTimeInput(task.startAt), savePendingFields.has("startAt"));
  const [draftEndAt, setDraftEndAt] = useServerSyncedDraft(formatDateTimeInput(task.endAt), savePendingFields.has("endAt"));
  const [draftAllDay, setDraftAllDay] = useServerSyncedDraft(Boolean(task.allDay), savePendingFields.has("allDay"));
  const [draftDueAt, setDraftDueAt] = useServerSyncedDraft(formatDateTimeInput(task.dueAt), savePendingFields.has("dueAt"));
  const [draftLabels, setDraftLabels] = useServerSyncedDraft(formatLabelInput(task.labels), savePendingFields.has("labels"));
  const [isTaskMenuOpen, setIsTaskMenuOpen] = useState(false);
  const [isSnoozeMenuOpen, setIsSnoozeMenuOpen] = useState(false);
  const [draftSnoozeDate, setDraftSnoozeDate] = useState("");
  const [autosaveState, setAutosaveState] = useState<TaskAutosaveState>("idle");
  const taskMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const taskMenuRef = useRef<HTMLDivElement | null>(null);
  const snoozeMenuRef = useRef<HTMLDivElement | null>(null);
  const autosaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const Icon = taskIcons[task.icon];
  const subtaskStats = getSubtaskStats(task);
  const isReadOnlyImport = Boolean(task.importedFrom?.readOnly);
  const canMutateTask = canEditBoard && !isReadOnlyImport && !isArchived;
  const canEditSourceFields = canMutateTask;
  const isStaleImport = task.importedFrom?.syncStatus === "stale";
  const checklistDoneCount = task.checklist.filter((item) => item.done).length;
  const openSubtaskCount = Math.max(subtaskStats.total - subtaskStats.done, 0);
  const calendarTaskHref = buildTaskCalendarHref(task, activeBoardId);
  const checklistPreviewItems = task.checklist.slice(0, 4);
  const checklistMoreCount = Math.max(task.checklist.length - checklistPreviewItems.length, 0);
  const subtaskPreviewItems = task.subtasks.slice(0, 4);
  const subtaskMoreCount = Math.max(task.subtasks.length - subtaskPreviewItems.length, 0);
  const isDirty =
    draftTitle !== task.title ||
    draftSummary !== getTaskPrimaryNoteDraftValue(task) ||
    draftNextAction !== (task.nextAction ?? "") ||
    (isRootTask && draftBucketId !== (currentBucketId ?? "")) ||
    draftStatus !== task.status ||
    draftStartAt !== formatDateTimeInput(task.startAt) ||
    draftEndAt !== formatDateTimeInput(task.endAt) ||
    draftAllDay !== Boolean(task.allDay) ||
    draftDueAt !== formatDateTimeInput(task.dueAt) ||
    draftLabels !== formatLabelInput(task.labels);

  useDismissibleSurface({
    isOpen: isTaskMenuOpen,
    onClose: () => setIsTaskMenuOpen(false),
    refs: [taskMenuButtonRef, taskMenuRef],
  });
  useDismissibleSurface({
    isOpen: isSnoozeMenuOpen,
    onClose: () => setIsSnoozeMenuOpen(false),
    refs: [snoozeMenuRef],
  });

  const buildFullDraftTaskPatch = (overrides: TaskDraftPatchOverrides = {}): TaskEditorPatch => ({
    title: (overrides.title ?? draftTitle).trim() || task.title,
    summary: overrides.summary ?? draftSummary,
    nextAction: overrides.nextAction ?? draftNextAction,
    status: overrides.status ?? draftStatus,
    startAt: normalizeDateTimeInput(overrides.startAt ?? draftStartAt),
    endAt: normalizeDateTimeInput(overrides.endAt ?? draftEndAt),
    allDay: overrides.allDay ?? draftAllDay,
    dueAt: normalizeDateTimeInput(overrides.dueAt ?? draftDueAt),
    recurrence: task.recurrence ?? null,
    labels: parseLabelInput(overrides.labels ?? draftLabels),
    color: task.color,
    icon: task.icon,
    ...(isRootTask && typeof overrides.bucketId === "string" && overrides.bucketId
      ? { bucketId: overrides.bucketId }
      : {}),
  });

  // Compared with what the server will hold once the save in flight and the
  // queued one land, so taking a change back before its save returns is sent.
  const buildDraftTaskPatch = (overrides: TaskDraftPatchOverrides = {}): TaskSavePatch =>
    pickChangedTaskFields(buildFullDraftTaskPatch(overrides), {
      ...buildFullDraftTaskPatch(getServerTaskDraftValues(task)),
      ...saveQueue.getPendingPatch(task.id, editorSaveSource),
    });

  // Saves go through the task's save queue (TaskboardApp), which sends one
  // request at a time and merges waiting drafts. A promote is an action: it is
  // sent on its own, never merged into a later draft.
  const queueAutosave = (patch: TaskSavePatch, kind: SaveEntryKind = "draft") => {
    if (!canMutateTask || Object.keys(patch).length === 0) {
      return;
    }

    setAutosaveState("saving");
    void saveQueue.enqueue(task.id, patch, { kind, source: editorSaveSource }).then(({ saved, patch: sent }) => {
      // Only a successful save is answered; after a failure the drafts stay
      // as typed, to be sent again.
      if (saved) {
        setAcknowledgedPatch((current) => ({ ...current, ...sent }));
      }
      setAutosaveState(
        !saved ? "error" : saveQueue.getPendingPatch(task.id, editorSaveSource) ? "saving" : "saved",
      );
    });
  };

  // A status change is an action: never merged into a later save, so a Done
  // (which can complete a recurring task) cannot be replaced by the next choice.
  const queueDraftAutosave = (overrides: TaskDraftPatchOverrides = {}) => {
    queueAutosave(buildDraftTaskPatch(overrides), overrides.status === undefined ? "draft" : "action");
  };

  const flushTextAutosave = () => {
    if (autosaveDebounceRef.current) {
      clearTimeout(autosaveDebounceRef.current);
      autosaveDebounceRef.current = null;
    }

    if (isDirty && canMutateTask) {
      queueDraftAutosave();
    }
  };
  // The debounce timer must read the latest drafts when it fires; the closure
  // from the render that scheduled it can hold stale status, dates, or labels.
  const runDebouncedTextAutosave = useStableCallback(() => {
    if (isDirty && canMutateTask) {
      queueDraftAutosave();
    }
  });

  useEffect(() => {
    onRegisterTextFlush(flushTextAutosave);

    return () => {
      onRegisterTextFlush(null);
    };
  });

  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useLayoutEffect(() => {
    setDraftTitle(task.title);
    setDraftSummary(getTaskPrimaryNoteDraftValue(task));
    setDraftNextAction(task.nextAction ?? "");
    setDraftStatus(task.status);
    setDraftBucketId(currentBucketId ?? "");
    setDraftStartAt(formatDateTimeInput(task.startAt));
    setDraftEndAt(formatDateTimeInput(task.endAt));
    setDraftAllDay(Boolean(task.allDay));
    setDraftDueAt(formatDateTimeInput(task.dueAt));
    setDraftLabels(formatLabelInput(task.labels));
    setIsTaskMenuOpen(false);
    setIsSnoozeMenuOpen(false);
    setDraftSnoozeDate("");
    setAutosaveState("idle");
    setAcknowledgedPatch(null);
    if (autosaveDebounceRef.current) {
      clearTimeout(autosaveDebounceRef.current);
      autosaveDebounceRef.current = null;
    }
    // Only another task resets the drafts. A move to another bucket (also one
    // made elsewhere) keeps them; draftBucketId follows in its own effect.
  }, [task.id]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useLayoutEffect(() => {
    if (!acknowledgedPatch) {
      return;
    }
    setAcknowledgedPatch(null);
    const server = getServerTaskDraftValues(task);
    const resync = getAcknowledgedFieldsToResync(
      acknowledgedPatch,
      buildFullDraftTaskPatch(),
      buildFullDraftTaskPatch(server),
      savePendingFields,
    );
    for (const key of resync) {
      if (key === "title") setDraftTitle(server.title);
      if (key === "summary") setDraftSummary(server.summary);
      if (key === "nextAction") setDraftNextAction(server.nextAction);
      if (key === "status") setDraftStatus(server.status);
      if (key === "startAt") setDraftStartAt(server.startAt);
      if (key === "endAt") setDraftEndAt(server.endAt);
      if (key === "allDay") setDraftAllDay(server.allDay);
      if (key === "dueAt") setDraftDueAt(server.dueAt);
      if (key === "labels") setDraftLabels(server.labels);
    }
  }, [acknowledgedPatch]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  useEffect(() => {
    let isCancelled = false;

    queueMicrotask(() => {
      if (!isCancelled) {
        setDraftBucketId(currentBucketId ?? "");
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [currentBucketId]);

  useEffect(() => {
    if (!canMutateTask || !isDirty) {
      return;
    }

    if (autosaveDebounceRef.current) {
      clearTimeout(autosaveDebounceRef.current);
    }

    autosaveDebounceRef.current = setTimeout(() => {
      autosaveDebounceRef.current = null;
      runDebouncedTextAutosave();
    }, 700);

    return () => {
      if (autosaveDebounceRef.current) {
        clearTimeout(autosaveDebounceRef.current);
        autosaveDebounceRef.current = null;
      }
    };
  }, [draftTitle, draftSummary, draftNextAction, draftLabels]);

  useEffect(
    () => () => {
      if (autosaveDebounceRef.current) {
        clearTimeout(autosaveDebounceRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (autosaveState !== "saved") {
      return;
    }

    const hideTimer = window.setTimeout(() => setAutosaveState("idle"), 2500);
    return () => window.clearTimeout(hideTimer);
  }, [autosaveState]);

  const applyQuickStatus = (status: TaskStatus) => {
    if (!canMutateTask) {
      return;
    }

    setDraftStatus(status);
    queueDraftAutosave({ status });
  };

  // Once a top-level task is saved as done, its Done button reads
  // "Done: Archive" and a second click archives it. Subtasks archive with
  // their parent, so theirs stays a plain Done.
  const offersArchiveFromDone =
    isRootTask && canMutateTask && canManageTaskLifecycle && task.status === "done" && draftStatus === "done";
  const handleStatusButton = (status: TaskStatus) => {
    if (status === "done" && offersArchiveFromDone) {
      void onArchiveTask(task.id);
      return;
    }
    applyQuickStatus(status);
  };
  const getStatusButtonLabel = (option: { value: TaskStatus; label: string }) =>
    option.value === "done" && offersArchiveFromDone ? "Done: Archive" : option.label;

  const applySnoozeStart = (nextStartAt: string) => {
    if (!canEditSourceFields) {
      return;
    }

    setDraftStartAt(nextStartAt);
    queueDraftAutosave({ startAt: nextStartAt });
    setIsSnoozeMenuOpen(false);
  };

  const applyPickDateSnooze = () => {
    if (!draftSnoozeDate) {
      return;
    }

    applySnoozeStart(`${draftSnoozeDate}T09:00`);
  };

  const headerControls = (
    <div className="flex shrink-0 items-center justify-end gap-1" data-testid="task-inspector-header-controls">
      <button
        type="button"
        onClick={onExpand}
        className={ICON_BUTTON_CLASS}
        aria-label="Expand detail panel"
      >
        <Maximize2 className="h-3 w-3" />
      </button>
      {!isArchived ? <div className="relative">
        <button
          ref={taskMenuButtonRef}
          type="button"
          onClick={() => setIsTaskMenuOpen((current) => !current)}
          className={ICON_BUTTON_CLASS}
          aria-label="Task actions"
        >
          <MoreHorizontal className="h-3 w-3" />
        </button>
        {isTaskMenuOpen ? (
          <FloatingMenuPortal
            editorScale
            isOpen={isTaskMenuOpen}
            anchorRef={taskMenuButtonRef}
            surfaceRef={taskMenuRef}
            preferredWidth={160}
            align="end"
            mobileSheet
            className="taskboard-popover rounded-[12px] border p-1"
          >
            <button
              type="button"
              onClick={() => {
                onExpand();
                setIsTaskMenuOpen(false);
              }}
              className={TASK_EDITOR_MENU_ITEM_CLASS}
            >
              <Bell className="h-3 w-3" />
              Add Reminder
            </button>
            <button
              type="button"
              onClick={() => {
                onExpand();
                setIsTaskMenuOpen(false);
              }}
              className={TASK_EDITOR_MENU_ITEM_CLASS}
            >
              <CalendarClock className="h-3 w-3" />
              Open Scheduling
            </button>
            <EditorTaskActionItems
              task={task}
              isRootTask={isRootTask}
              isArchived={isArchived}
              canEditBoard={canEditBoard}
              canManageLifecycle={canManageTaskLifecycle}
              onPromote={() => queueAutosave({ ...buildDraftTaskPatch(), promoteToMaintenanceOutage: true }, "action")}
              onArchive={() => void onArchiveTask(task.id)}
              onDelete={() => void onDeleteTask(task.id)}
              onDone={() => setIsTaskMenuOpen(false)}
            />
          </FloatingMenuPortal>
        ) : null}
      </div> : null}
      <SurfaceCloseButton onClick={onCloseInspector} label="Close task inspector" />
    </div>
  );

  const importedSidebarSection = task.importedFrom ? (
    <ImportedEventInspector
      task={task}
      attachmentCount={task.attachments.length}
      onExpand={onExpand}
      onConvert={() => void onConvertImportedTask(task.id)}
      onCreateFollowUp={() => void onCreateFollowUpTask(task.id)}
      onHide={() => void onDeleteTask(task.id)}
      canEditBoard={canEditBoard}
      calendarTaskHref={calendarTaskHref}
    />
  ) : null;

  return (
    <div className="task-editor-root flex h-full min-h-0 flex-col" data-testid="task-editor">
      <div className="taskboard-inspector-header px-3 pb-2 pt-2.5">
        <div
          className="flex min-w-0 items-start gap-0 outline-none"
          data-testid="task-inspector-header"
          data-task-menu-target={isArchived ? undefined : task.id}
          tabIndex={isArchived ? undefined : -1}
        >
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex min-w-0 items-start justify-between gap-1.5">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" data-testid="task-inspector-chips">
                <span
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[13px]"
                  style={{ backgroundColor: `${task.color}22`, color: task.color }}
                >
                  <Icon className="h-3 w-3" />
                </span>
                <TaskEditorStatusBadge isArchived={isArchived} status={task.status} />
                {task.importedFrom ? (
                  <span className="taskboard-label-chip ed-chip rounded-full">
                    {getImportedProviderDisplayLabel(task)}
                  </span>
                ) : null}
                {task.workItemType === "maintenance_outage" ? (
                  <span className="taskboard-label-chip ed-chip rounded-[6px]">
                    Outage
                  </span>
                ) : null}
                {isStaleImport && !isReadOnlyImport ? (
                  <span className="taskboard-label-chip taskboard-label-chip-muted ed-chip rounded-full">
                    Stale
                  </span>
                ) : null}
              </div>
              {headerControls}
            </div>
            <TaskAutosaveIndicator state={autosaveState} />
            <h2 className="sr-only">Task title</h2>
            <label className="block min-w-0" data-testid="task-inspector-title">
              <span className="sr-only">Title</span>
              {!canEditSourceFields ? (
                <h2 className="min-w-0 break-words ed-title text-foreground">
                  {isReadOnlyImport ? <SafeLinkifiedText text={task.title} /> : task.title}
                </h2>
              ) : (
                <textarea
                  value={draftTitle}
                  onChange={(event) => setDraftTitle(event.target.value)}
                  onBlur={flushTextAutosave}
                  rows={2}
                  className={TASK_EDITOR_TITLE_INPUT_CLASS}
                  data-testid="task-inspector-title-input"
                />
              )}
            </label>
            {!canEditBoard ? (
              <p className={`mt-0.5 ${TASK_EDITOR_MUTED_TEXT_CLASS}`} data-testid="task-editor-read-only-note">
                Read-only board. Task edits are disabled for viewer access.
              </p>
            ) : null}
            {task.dueAt && (!isRootTask || (isReadOnlyImport && importedSidebarSection)) ? (
              <div className={`flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 ${TASK_EDITOR_MUTED_TEXT_CLASS}`}>
                <span className="shrink-0">Due {formatDate(task.dueAt, displayTimeZone)}</span>
              </div>
            ) : null}
            {calendarHandoffActive ? (
              <p
                aria-live="polite"
                className="taskboard-calendar-handoff-note mt-1 flex w-fit max-w-full items-center gap-1 rounded-full border px-2 py-0.5 ed-chip"
                data-testid="task-inspector-calendar-handoff"
                role="status"
              >
                <CalendarDays aria-hidden="true" className="h-3 w-3 shrink-0" />
                <span className="min-w-0 truncate">Opened from Calendar</span>
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="taskboard-inspector-body pretty-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto px-3 py-2">
        <div className="space-y-2">
          {isReadOnlyImport && importedSidebarSection ? (
            importedSidebarSection
          ) : (
            <>
              <div className="taskboard-inspector-section w-full min-w-0" data-testid="task-inspector-quick-edit">
                <div className="space-y-2">
                  <div className="grid w-full min-w-0 grid-cols-2 gap-1" data-testid="task-inspector-quick-actions">
                    {sidebarStatusButtonOptions.map((option) => {
                      const isCurrentStatus = draftStatus === option.value;

                      return (
                        <button
                          key={option.value}
                          type="button"
                          onClick={() => handleStatusButton(option.value)}
                          disabled={!canMutateTask}
                          aria-pressed={isCurrentStatus}
                          data-status={option.value}
                          data-testid="task-inspector-status-button"
                          className={`${TASK_EDITOR_BUTTON_CLASS} w-full min-w-0 justify-center whitespace-nowrap border px-1.5 disabled:cursor-not-allowed disabled:opacity-50 ${
                            isCurrentStatus
                              ? option.activeClassName
                              : "border-border/70 bg-background/25"
                          }`}
                        >
                          {getStatusButtonLabel(option)}
                        </button>
                      );
                    })}
                  </div>
                  {isRootTask ? (
                    <SidebarDueControl
                      value={draftDueAt}
                      disabled={!canMutateTask}
                      onChange={(nextDueAt) => {
                        setDraftDueAt(nextDueAt);
                        queueDraftAutosave({ dueAt: nextDueAt });
                      }}
                    />
                  ) : null}
                  <div
                    ref={snoozeMenuRef}
                    className="relative min-w-0"
                    onKeyDown={(event) => {
                      if (event.key !== "Escape" || !isSnoozeMenuOpen) {
                        return;
                      }

                      event.preventDefault();
                      event.stopPropagation();
                      event.nativeEvent.stopImmediatePropagation();
                      setIsSnoozeMenuOpen(false);
                    }}
                  >
                    <button
                      type="button"
                      onClick={() => setIsSnoozeMenuOpen((current) => !current)}
                      disabled={!canEditSourceFields}
                      className={`${TASK_EDITOR_BUTTON_CLASS} w-full min-w-0 justify-center gap-1.5 whitespace-nowrap px-1.5 disabled:cursor-not-allowed disabled:opacity-50`}
                      aria-expanded={isSnoozeMenuOpen}
                      data-testid="task-snooze-button"
                    >
                      <AlarmClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      Snooze
                    </button>
                    {isSnoozeMenuOpen ? (
                      <SnoozeMenu
                        draftDate={draftSnoozeDate}
                        onDraftDateChange={setDraftSnoozeDate}
                        onApplyPreset={(preset) => applySnoozeStart(getSnoozeDateTime(preset))}
                        onApplyPickDate={applyPickDateSnooze}
                      />
                    ) : null}
                  </div>
                  <label className="block min-w-0">
                    <span className={TASK_EDITOR_LABEL_CLASS}>Bucket</span>
                    <select
                      value={draftBucketId}
                      onChange={(event) => {
                        const nextBucketId = event.target.value;
                        setDraftBucketId(nextBucketId);
                        queueDraftAutosave({ bucketId: nextBucketId });
                      }}
                      disabled={!isRootTask || !canMutateTask}
                      className={`${TASK_EDITOR_SELECT_CLASS} disabled:cursor-not-allowed disabled:opacity-60`}
                    >
                      {bucketOptions.map((bucket) => (
                        <option key={bucket.id} value={bucket.id}>
                          {bucket.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <SidebarScheduleDisclosure
                    allDay={draftAllDay}
                    endAt={draftEndAt}
                    startAt={draftStartAt}
                  >
                    <TaskScheduleFields
                      allDay={draftAllDay}
                      disabled={!canEditSourceFields}
                      endAt={draftEndAt}
                      key={task.id}
                      onAllDayChange={(nextAllDay, nextStartAt, nextEndAt) => {
                        setDraftAllDay(nextAllDay);
                        setDraftStartAt(nextStartAt);
                        setDraftEndAt(nextEndAt);
                        queueDraftAutosave({
                          allDay: nextAllDay,
                          startAt: nextStartAt,
                          endAt: nextEndAt,
                        });
                      }}
                      onEndAtChange={(nextEndAt) => {
                        setDraftEndAt(nextEndAt);
                        queueDraftAutosave({ endAt: nextEndAt });
                      }}
                      onStartAtChange={(nextStartAt) => {
                        setDraftStartAt(nextStartAt);
                        queueDraftAutosave({ startAt: nextStartAt });
                      }}
                      startAt={draftStartAt}
                      testIdPrefix="task-inspector"
                    />
                  </SidebarScheduleDisclosure>
                  <div className="block">
                    <span className={TASK_EDITOR_LABEL_CLASS}>Labels</span>
                    <LabelChipEditor
                      value={draftLabels}
                      disabled={!canMutateTask}
                      onChange={setDraftLabels}
                      onCommit={(nextLabels) => queueDraftAutosave({ labels: nextLabels })}
                    />
                  </div>
                  <div className="space-y-0">
                    <PrimaryNoteEditor
                      value={draftSummary}
                      onChange={setDraftSummary}
                      onBlur={flushTextAutosave}
                      disabled={!canMutateTask}
                      rows={2}
                      minHeightClassName="min-h-[52px]"
                      dataTestId="task-inspector-primary-note-textarea"
                    />
                    <WorkingNotesInspectorRow
                      notes={task.notes}
                    />
                  </div>
                </div>
              </div>
              <div className="taskboard-inspector-section space-y-0" data-testid="task-inspector-nav-rows">
                {task.workItemType === "maintenance_outage" ? (
                  <MaintenanceOutageFields
                    task={task}
                    locations={maintenanceLocations}
                    disabled={!canMutateTask}
                    onSave={(maintenanceOutage) =>
                      queueAutosave({ ...buildDraftTaskPatch(), maintenanceOutage })
                    }
                    onCreateLocation={onCreateMaintenanceLocation}
                  />
                ) : null}
                {/* Work breakdown rows appear only once they have content, keeping a
                    minimal task's panel short; one row offers to add the first item. */}
                {task.checklist.length > 0 ? (
                  <QuickInspectorRow
                    title="Checklist"
                    detail={`${checklistDoneCount}/${task.checklist.length} complete`}
                  >
                    <ChecklistPreview items={checklistPreviewItems} moreCount={checklistMoreCount} />
                  </QuickInspectorRow>
                ) : null}
                {task.subtasks.length > 0 ? (
                  <QuickInspectorRow
                    title="Subtasks"
                    detail={`${openSubtaskCount} open`}
                  >
                    <SubtaskPreview tasks={subtaskPreviewItems} moreCount={subtaskMoreCount} />
                  </QuickInspectorRow>
                ) : null}
                {task.attachments.length > 0 ? (
                  <QuickInspectorRow
                    title="Attachments"
                    detail={`${task.attachments.length} file${task.attachments.length === 1 ? "" : "s"}`}
                    actionLabel="Open"
                    onAction={onExpand}
                  />
                ) : null}
                {task.checklist.length === 0 && task.subtasks.length === 0 && task.attachments.length === 0 ? (
                  <QuickInspectorRow
                    title="Checklist, subtasks, files"
                    detail="None yet"
                    actionLabel={canMutateTask ? "Add" : undefined}
                    onAction={canMutateTask ? onExpand : undefined}
                  />
                ) : null}
              </div>
            </>
          )}
        </div>
      </div>
      <div className="taskboard-inspector-footer grid shrink-0 gap-1 px-3 py-2">
        <button
          type="button"
          onClick={onExpand}
          className={`${TASK_EDITOR_BUTTON_CLASS} ui-button-primary w-full justify-center py-1.5`}
          data-testid="task-inspector-open-workspace"
        >
          Open Task Workspace
        </button>
        {calendarTaskHref ? (
          <Link
            aria-label={`View ${task.title} in Calendar`}
            className={`${TASK_EDITOR_BUTTON_CLASS} ui-button-surface w-full justify-center border py-1.5`}
            data-testid="task-inspector-view-calendar"
            href={calendarTaskHref}
          >
            <CalendarDays className="h-3 w-3" />
            View in Calendar
          </Link>
        ) : (
          <button
            type="button"
            disabled
            className={`${TASK_EDITOR_BUTTON_CLASS} ui-button-surface w-full justify-center border py-1.5 opacity-55`}
          >
            <CalendarDays className="h-3 w-3" />
            View in Calendar
          </button>
        )}
      </div>
    </div>
  );
}

function TaskDetailEditor({
  viewerId,
  task,
  focusedSubtaskId,
  isArchived,
  isRootTask,
  bucketOptions,
  currentBucketId,
  mode,
  onCloseInspector,
  onRegisterTextFlush,
  onExpand,
  onCollapse,
  onSaveTask,
  saveQueue,
  onPeopleRosterChanged,
  onArchiveTask,
  onDeleteTask,
  onConvertImportedTask,
  onCreateFollowUpTask,
  onAddSubtask,
  onMoveSubtask,
  onChecklistAdd,
  onChecklistUpdate,
  onChecklistDelete,
  onUploadAttachments,
  onDeleteAttachment,
  onRenameAttachment,
  onCreateNote,
  onUpdateNote,
  onDeleteNote,
  onUploadNoteAttachments,
  attachmentsEnabled,
  activeBoardId,
  canEditBoard,
  canManageTaskLifecycle,
  publicSharesEnabled = false,
  maintenanceLocations,
  onCreateMaintenanceLocation,
}: {
  viewerId: string;
  task: Task;
  focusedSubtaskId: string | null;
  isArchived: boolean;
  isRootTask: boolean;
  bucketOptions: Array<{ id: string; title: string }>;
  currentBucketId: string | null;
  mode: DetailPanelMode;
  onCloseInspector: () => void;
  onRegisterTextFlush: (flush: (() => void) | null) => void;
  onExpand: () => void;
  onCollapse: () => void;
  onSaveTask: TaskSaveHandler;
  saveQueue: TaskSaves;
  onPeopleRosterChanged?: (taskId: string, attendees: string[]) => void;
  onArchiveTask: (taskId: string) => void | Promise<void>;
  onDeleteTask: (taskId: string) => void | Promise<void>;
  onConvertImportedTask: (taskId: string) => void | Promise<void>;
  onCreateFollowUpTask: (taskId: string) => void | Promise<void>;
  onAddSubtask: (taskId: string, title: string) => void | Promise<void>;
  onMoveSubtask?: (move: SubtaskMove, options?: { announce?: boolean }) => void | Promise<void>;
  onChecklistAdd: (taskId: string, label: string) => void | Promise<void>;
  onChecklistUpdate: (
    itemId: string,
    patch: { label?: string; done?: boolean },
  ) => void | Promise<void>;
  onChecklistDelete: (itemId: string) => void | Promise<void>;
  onUploadAttachments: (taskId: string, files: File[]) => void | Promise<void>;
  onDeleteAttachment: (taskId: string, attachmentId: string) => void | Promise<void>;
  onRenameAttachment: (
    taskId: string,
    attachmentId: string,
    displayName: string,
  ) => void | Promise<void>;
  onCreateNote: (taskId: string, body: string) => void | Promise<void>;
  onUpdateNote: (taskId: string, noteId: string, body: string) => void | Promise<void>;
  onDeleteNote: (taskId: string, noteId: string) => void | Promise<void>;
  onUploadNoteAttachments: (
    taskId: string,
    noteId: string,
    files: File[],
  ) => void | Promise<void>;
  attachmentsEnabled: boolean;
  activeBoardId: string;
  canEditBoard: boolean;
  canManageTaskLifecycle: boolean;
  publicSharesEnabled?: boolean;
  maintenanceLocations: MaintenanceLocation[];
  onCreateMaintenanceLocation: (name: string) => Promise<string | null>;
}) {
  const displayTimeZone = useDisplayTimeZone();
  // Fields with an autosave in flight or queued (see useServerSyncedDraft).
  const editorSaveSource = useEditorSaveSource();
  const savePendingFields = useEditorPendingSaveFields(saveQueue, task.id, editorSaveSource);
  const [acknowledgedPatch, setAcknowledgedPatch] = useState<TaskSavePatch | null>(null);
  const [draftTitle, setDraftTitle] = useServerSyncedDraft(task.title, savePendingFields.has("title"));
  const [draftSummary, setDraftSummary] = useServerSyncedDraft(getTaskPrimaryNoteDraftValue(task), savePendingFields.has("summary"));
  const [draftNextAction] = useServerSyncedDraft(task.nextAction ?? "", savePendingFields.has("nextAction"));
  const [draftStatus, setDraftStatus] = useServerSyncedDraft<TaskStatus>(task.status, savePendingFields.has("status"));
  const [draftBucketId, setDraftBucketId] = useState(currentBucketId ?? "");
  const [draftStartAt, setDraftStartAt] = useServerSyncedDraft(formatDateTimeInput(task.startAt), savePendingFields.has("startAt"));
  const [draftEndAt, setDraftEndAt] = useServerSyncedDraft(formatDateTimeInput(task.endAt), savePendingFields.has("endAt"));
  const [draftAllDay, setDraftAllDay] = useServerSyncedDraft(Boolean(task.allDay), savePendingFields.has("allDay"));
  const [draftDueAt, setDraftDueAt] = useServerSyncedDraft(formatDateTimeInput(task.dueAt), savePendingFields.has("dueAt"));
  const [draftRecurrenceEnabled, setDraftRecurrenceEnabled] = useServerSyncedDraft(
    Boolean(task.recurrence),
    savePendingFields.has("recurrence"),
  );
  const [draftRecurrenceFrequency, setDraftRecurrenceFrequency] =
    useServerSyncedDraft<TaskRecurrenceFrequency>(task.recurrence?.frequency ?? "weekly", savePendingFields.has("recurrence"));
  const [draftRecurrenceInterval, setDraftRecurrenceInterval] = useServerSyncedDraft(
    String(task.recurrence?.interval ?? 1),
    savePendingFields.has("recurrence"),
  );
  const [draftRecurrenceMode, setDraftRecurrenceMode] = useServerSyncedDraft<TaskRecurrenceMode>(
    task.recurrence?.mode ?? "on_schedule",
    savePendingFields.has("recurrence"),
  );
  const [draftReminderOffsetValue, setDraftReminderOffsetValue] = useServerSyncedDraft(
    task.reminderConfig?.reminderOffsetMinutes === null ||
      task.reminderConfig?.reminderOffsetMinutes === undefined
      ? "none"
      : String(task.reminderConfig.reminderOffsetMinutes),
    savePendingFields.has("reminderOffsetMinutes"),
  );
  const [draftOverdueReminderEnabled, setDraftOverdueReminderEnabled] = useServerSyncedDraft(
    Boolean(task.reminderConfig?.overdueReminderEnabled),
    savePendingFields.has("overdueReminderEnabled"),
  );
  const [isRecurrenceSectionOpen, setIsRecurrenceSectionOpen] = useState(Boolean(task.recurrence));
  const [isReminderSectionOpen, setIsReminderSectionOpen] = useState(
    task.reminderConfig?.reminderOffsetMinutes !== null &&
      task.reminderConfig?.reminderOffsetMinutes !== undefined ||
      Boolean(task.reminderConfig?.overdueReminderEnabled),
  );
  const [draftLabels, setDraftLabels] = useServerSyncedDraft(formatLabelInput(task.labels), savePendingFields.has("labels"));
  const [draftColor] = useServerSyncedDraft(task.color, savePendingFields.has("color"));
  const [draftIcon, setDraftIcon] = useServerSyncedDraft<TaskIcon>(task.icon, savePendingFields.has("icon"));
  const [newChecklistLabel, setNewChecklistLabel] = useState("");
  const [pendingAttachmentFiles, setPendingAttachmentFiles] = useState<File[]>([]);
  const [attachmentInputKey, setAttachmentInputKey] = useState(0);
  const [attachmentError, setAttachmentError] = useState("");
  const [attachmentInfo, setAttachmentInfo] = useState("");
  const [isUploadingAttachments, setIsUploadingAttachments] = useState(false);
  const [isAttachmentDragOver, setIsAttachmentDragOver] = useState(false);
  const [previewAttachmentId, setPreviewAttachmentId] = useState<string | null>(null);
  const [editingAttachmentId, setEditingAttachmentId] = useState<string | null>(null);
  const [draftAttachmentDisplayName, setDraftAttachmentDisplayName] = useState("");
  const [renamingAttachmentId, setRenamingAttachmentId] = useState<string | null>(null);
  const [deletingAttachmentId, setDeletingAttachmentId] = useState<string | null>(null);
  const [isAttachmentManagerOpen, setIsAttachmentManagerOpen] = useState(false);
  const [newNoteBody, setNewNoteBody] = useState("");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);
  const [draftEditingNoteBody, setDraftEditingNoteBody] = useState("");
  const [noteBusyId, setNoteBusyId] = useState<string | null>(null);
  const [noteError, setNoteError] = useState("");
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [noteInfo, setNoteInfo] = useState("");
  const [expandedWorkingNoteIds, setExpandedWorkingNoteIds] = useState<Record<string, boolean>>({});
  const [noteAttachmentInputKeyById, setNoteAttachmentInputKeyById] = useState<Record<string, number>>({});
  // Working notes start folded under the work; the choice is remembered in this browser.
  const [isWorkingNotesOpen, setIsWorkingNotesOpen] = useState(() => {
    try {
      return typeof window !== "undefined" && window.localStorage.getItem(WORKING_NOTES_OPEN_KEY) === "true";
    } catch {
      return false;
    }
  });
  const toggleWorkingNotes = () => {
    setIsWorkingNotesOpen((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(WORKING_NOTES_OPEN_KEY, String(next));
      } catch {
        // Storage can be unavailable; the section still toggles.
      }
      return next;
    });
  };
  const [isTaskMenuOpen, setIsTaskMenuOpen] = useState(false);

  const [isSnoozeMenuOpen, setIsSnoozeMenuOpen] = useState(false);
  const [isAttachmentDropdownOpen, setIsAttachmentDropdownOpen] = useState(false);
  const [popupPreviewAttachmentId, setPopupPreviewAttachmentId] = useState<string | null>(null);
  const [draftSnoozeDate, setDraftSnoozeDate] = useState("");
  const [autosaveState, setAutosaveState] = useState<TaskAutosaveState>("idle");
  const attachmentDragDepthRef = useRef(0);
  const taskMenuButtonRef = useRef<HTMLButtonElement | null>(null);
  const taskMenuRef = useRef<HTMLDivElement | null>(null);
  const snoozeMenuRef = useRef<HTMLDivElement | null>(null);
  const attachmentDropdownRef = useRef<HTMLDivElement | null>(null);
  const autosaveDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previousTaskIdRef = useRef(task.id);

  const Icon = taskIcons[task.icon];
  const subtaskStats = getSubtaskStats(task);
  const workspaceDateLabel =
    task.startAt && task.endAt
      ? formatItemSpan(task, { timeZone: displayTimeZone })
      : task.dueAt
        ? `Due ${formatDate(task.dueAt, displayTimeZone)}`
        : task.startAt
          ? `Starts ${formatDate(task.startAt, displayTimeZone)}`
          : "";
  const isReadOnlyImport = Boolean(task.importedFrom?.readOnly);
  const canMutateTask = canEditBoard && !isReadOnlyImport && !isArchived;
  const canEditSourceFields = canMutateTask;
  const isStaleImport = task.importedFrom?.syncStatus === "stale";
  const isExpanded = mode === "expanded";
  const previewAttachment =
    previewAttachmentId === null
      ? null
      : task.attachments.find((attachment) => attachment.id === previewAttachmentId) ?? null;
  const popupPreviewAttachment =
    popupPreviewAttachmentId === null
      ? null
      : task.attachments.find((attachment) => attachment.id === popupPreviewAttachmentId) ?? null;
  const attachmentsBusy =
    isUploadingAttachments || renamingAttachmentId !== null || deletingAttachmentId !== null;
  const calendarTaskHref = buildTaskCalendarHref(task, activeBoardId);
  const shouldShowAttachmentManager =
    isAttachmentManagerOpen ||
    task.attachments.length > 0 ||
    pendingAttachmentFiles.length > 0 ||
    isAttachmentDragOver ||
    attachmentsBusy ||
    Boolean(attachmentInfo || attachmentError || previewAttachment);
  useDismissibleSurface({
    isOpen: isTaskMenuOpen,
    onClose: () => setIsTaskMenuOpen(false),
    refs: [taskMenuButtonRef, taskMenuRef],
  });
  useDismissibleSurface({
    isOpen: isSnoozeMenuOpen,
    onClose: () => setIsSnoozeMenuOpen(false),
    refs: [snoozeMenuRef],
  });
  useDismissibleSurface({
    isOpen: isAttachmentDropdownOpen,
    onClose: () => setIsAttachmentDropdownOpen(false),
    refs: [attachmentDropdownRef],
  });
  useEffect(() => {
    if (!popupPreviewAttachment) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        setPopupPreviewAttachmentId(null);
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [popupPreviewAttachment]);
  const isDirty =
    draftTitle !== task.title ||
    draftSummary !== getTaskPrimaryNoteDraftValue(task) ||
    draftNextAction !== (task.nextAction ?? "") ||
    (isRootTask && draftBucketId !== (currentBucketId ?? "")) ||
    draftStatus !== task.status ||
    draftStartAt !== formatDateTimeInput(task.startAt) ||
    draftEndAt !== formatDateTimeInput(task.endAt) ||
    draftAllDay !== Boolean(task.allDay) ||
    draftDueAt !== formatDateTimeInput(task.dueAt) ||
    serializeRecurrenceRule(getDraftRecurrenceRule({
      enabled: draftRecurrenceEnabled,
      frequency: draftRecurrenceFrequency,
      interval: draftRecurrenceInterval,
      mode: draftRecurrenceMode,
    })) !== serializeRecurrenceRule(task.recurrence) ||
    (isRootTask &&
      canMutateTask &&
      (draftReminderOffsetValue !==
        (task.reminderConfig?.reminderOffsetMinutes === null ||
        task.reminderConfig?.reminderOffsetMinutes === undefined
          ? "none"
          : String(task.reminderConfig.reminderOffsetMinutes)) ||
        draftOverdueReminderEnabled !==
          Boolean(task.reminderConfig?.overdueReminderEnabled))) ||
    draftLabels !== formatLabelInput(task.labels) ||
    draftColor !== task.color ||
    draftIcon !== task.icon;

  const buildFullDraftTaskPatch = (overrides: TaskDraftPatchOverrides = {}): TaskEditorPatch => {
    const title = (overrides.title ?? draftTitle).trim() || task.title;
    const reminderOffsetValue = overrides.reminderOffsetValue ?? draftReminderOffsetValue;

    return {
      title,
      summary: overrides.summary ?? draftSummary,
      nextAction: overrides.nextAction ?? draftNextAction,
      status: overrides.status ?? draftStatus,
      startAt: normalizeDateTimeInput(overrides.startAt ?? draftStartAt),
      endAt: normalizeDateTimeInput(overrides.endAt ?? draftEndAt),
      allDay: overrides.allDay ?? draftAllDay,
      dueAt: normalizeDateTimeInput(overrides.dueAt ?? draftDueAt),
      recurrence: getDraftRecurrenceRule({
        enabled: overrides.recurrenceEnabled ?? draftRecurrenceEnabled,
        frequency: overrides.recurrenceFrequency ?? draftRecurrenceFrequency,
        interval: overrides.recurrenceInterval ?? draftRecurrenceInterval,
        mode: overrides.recurrenceMode ?? draftRecurrenceMode,
      }),
      ...(isRootTask && canMutateTask
        ? {
            reminderOffsetMinutes:
              reminderOffsetValue === "none" ? null : Number(reminderOffsetValue),
            overdueReminderEnabled:
              overrides.overdueReminderEnabled ?? draftOverdueReminderEnabled,
          }
        : {}),
      labels: parseLabelInput(overrides.labels ?? draftLabels),
      color: overrides.color ?? draftColor,
      icon: overrides.icon ?? draftIcon,
      ...(isRootTask && typeof overrides.bucketId === "string" && overrides.bucketId
        ? { bucketId: overrides.bucketId }
        : {}),
    };
  };

  // Compared with what the server will hold once the save in flight and the
  // queued one land, so taking a change back before its save returns is sent.
  const buildDraftTaskPatch = (overrides: TaskDraftPatchOverrides = {}): TaskSavePatch =>
    pickChangedTaskFields(buildFullDraftTaskPatch(overrides), {
      ...buildFullDraftTaskPatch(getServerTaskDraftValues(task)),
      ...saveQueue.getPendingPatch(task.id, editorSaveSource),
    });

  // Saves go through the task's save queue (TaskboardApp), which sends one
  // request at a time and merges waiting drafts. A promote is an action: it is
  // sent on its own, never merged into a later draft.
  const queueAutosave = (patch: TaskSavePatch, kind: SaveEntryKind = "draft") => {
    if (!canMutateTask || Object.keys(patch).length === 0) {
      return;
    }

    setAutosaveState("saving");
    void saveQueue.enqueue(task.id, patch, { kind, source: editorSaveSource }).then(({ saved, patch: sent }) => {
      // Only a successful save is answered; after a failure the drafts stay
      // as typed, to be sent again.
      if (saved) {
        setAcknowledgedPatch((current) => ({ ...current, ...sent }));
      }
      setAutosaveState(
        !saved ? "error" : saveQueue.getPendingPatch(task.id, editorSaveSource) ? "saving" : "saved",
      );
    });
  };

  // A status change is an action: never merged into a later save, so a Done
  // (which can complete a recurring task) cannot be replaced by the next choice.
  const queueDraftAutosave = (overrides: TaskDraftPatchOverrides = {}) => {
    queueAutosave(buildDraftTaskPatch(overrides), overrides.status === undefined ? "draft" : "action");
  };

  const flushTextAutosave = () => {
    if (autosaveDebounceRef.current) {
      clearTimeout(autosaveDebounceRef.current);
      autosaveDebounceRef.current = null;
    }

    if (isDirty && canMutateTask) {
      queueDraftAutosave();
    }
  };
  // The debounce timer must read the latest drafts when it fires; the closure
  // from the render that scheduled it can hold stale status, dates, or labels.
  const runDebouncedTextAutosave = useStableCallback(() => {
    if (isDirty && canMutateTask) {
      queueDraftAutosave();
    }
  });

  useEffect(() => {
    onRegisterTextFlush(flushTextAutosave);

    return () => {
      onRegisterTextFlush(null);
    };
  });

  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */
  useLayoutEffect(() => {
    if (!acknowledgedPatch) {
      return;
    }
    setAcknowledgedPatch(null);
    const server = getServerTaskDraftValues(task);
    const resync = getAcknowledgedFieldsToResync(
      acknowledgedPatch,
      buildFullDraftTaskPatch(),
      buildFullDraftTaskPatch(server),
      savePendingFields,
    );
    for (const key of resync) {
      if (key === "title") setDraftTitle(server.title);
      if (key === "summary") setDraftSummary(server.summary);
      if (key === "status") setDraftStatus(server.status);
      if (key === "startAt") setDraftStartAt(server.startAt);
      if (key === "endAt") setDraftEndAt(server.endAt);
      if (key === "allDay") setDraftAllDay(server.allDay);
      if (key === "dueAt") setDraftDueAt(server.dueAt);
      if (key === "labels") setDraftLabels(server.labels);
      if (key === "icon") setDraftIcon(server.icon);
      if (key === "reminderOffsetMinutes") setDraftReminderOffsetValue(server.reminderOffsetValue);
      if (key === "overdueReminderEnabled") setDraftOverdueReminderEnabled(server.overdueReminderEnabled);
      if (key === "recurrence") {
        setDraftRecurrenceEnabled(server.recurrenceEnabled);
        setDraftRecurrenceFrequency(server.recurrenceFrequency);
        setDraftRecurrenceInterval(server.recurrenceInterval);
        setDraftRecurrenceMode(server.recurrenceMode);
      }
    }
  }, [acknowledgedPatch]);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  useEffect(() => {
    if (previousTaskIdRef.current === task.id) {
      return;
    }

    previousTaskIdRef.current = task.id;
    let isCancelled = false;

    queueMicrotask(() => {
      if (!isCancelled) {
        setAutosaveState("idle");
        setNewNoteBody("");
        setEditingNoteId(null);
        setDraftEditingNoteBody("");
        setNoteBusyId(null);
        setNoteError("");
        setNoteInfo("");
        setExpandedWorkingNoteIds({});
        setNoteAttachmentInputKeyById({});
        setIsAttachmentDropdownOpen(false);
        setPopupPreviewAttachmentId(null);
      }
    });
    setAcknowledgedPatch(null);
    if (autosaveDebounceRef.current) {
      clearTimeout(autosaveDebounceRef.current);
      autosaveDebounceRef.current = null;
    }

    return () => {
      isCancelled = true;
    };
  }, [task.id, task.notes.length]);

  useEffect(() => {
    let isCancelled = false;

    queueMicrotask(() => {
      if (!isCancelled) {
        setDraftBucketId(currentBucketId ?? "");
      }
    });

    return () => {
      isCancelled = true;
    };
  }, [currentBucketId]);

  useEffect(() => {
    if (!canMutateTask || !isDirty) {
      return;
    }

    if (autosaveDebounceRef.current) {
      clearTimeout(autosaveDebounceRef.current);
    }

    autosaveDebounceRef.current = setTimeout(() => {
      autosaveDebounceRef.current = null;
      runDebouncedTextAutosave();
    }, 700);

    return () => {
      if (autosaveDebounceRef.current) {
        clearTimeout(autosaveDebounceRef.current);
        autosaveDebounceRef.current = null;
      }
    };
  }, [draftTitle, draftSummary, draftNextAction, draftLabels]);

  useEffect(
    () => () => {
      if (autosaveDebounceRef.current) {
        clearTimeout(autosaveDebounceRef.current);
      }
    },
    [],
  );

  useEffect(() => {
    if (autosaveState !== "saved") {
      return;
    }

    const hideTimer = window.setTimeout(() => setAutosaveState("idle"), 2500);
    return () => window.clearTimeout(hideTimer);
  }, [autosaveState]);

  const draftStartDateTime = splitDateTimeInput(draftStartAt);
  const draftEndDateTime = splitDateTimeInput(draftEndAt);
  const draftDueDateTime = splitDateTimeInput(draftDueAt);
  const currentBucketTitle =
    bucketOptions.find((bucket) => bucket.id === currentBucketId)?.title ?? "No bucket";
  const checklistDoneCount = task.checklist.filter((item) => item.done).length;
  const openSubtaskCount = Math.max(subtaskStats.total - subtaskStats.done, 0);
  const checklistPreviewItems = task.checklist.slice(0, 4);
  const checklistMoreCount = Math.max(task.checklist.length - checklistPreviewItems.length, 0);
  const subtaskPreviewItems = task.subtasks.slice(0, 4);
  const subtaskMoreCount = Math.max(task.subtasks.length - subtaskPreviewItems.length, 0);
  const workingNotesOldestFirst = useMemo(
    () => getWorkingNotesOldestFirst(task.notes),
    [task.notes],
  );

  const submitChecklistItem = () => {
    if (!canMutateTask) {
      return;
    }

    const label = newChecklistLabel.trim();
    if (!label) {
      return;
    }

    void onChecklistAdd(task.id, label);
    setNewChecklistLabel("");
  };

  const buildAttachmentHref = (
    attachmentId: string,
    disposition: "attachment" | "inline" = "attachment",
  ) => appendBoardIdToRequest(
    `/api/tasks/${task.id}/attachments/${attachmentId}?disposition=${disposition}`,
    activeBoardId,
  ) as string;
  const attachmentInputId = `task-attachments-${task.id}-${attachmentInputKey}`;

  const resizeWorkingNoteComposer = (textarea: HTMLTextAreaElement) => {
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 320)}px`;
  };

  const resetAttachmentDragState = () => {
    attachmentDragDepthRef.current = 0;
    setIsAttachmentDragOver(false);
  };

  const toggleWorkingNoteExpanded = (noteId: string) => {
    setExpandedWorkingNoteIds((current) => ({
      ...current,
      [noteId]: !current[noteId],
    }));
  };

  const submitAttachmentFiles = async (files: File[]) => {
    if (!canMutateTask) {
      setAttachmentError("Read-only board. Attachment changes are disabled for viewer access.");
      resetAttachmentDragState();
      return;
    }

    if (files.length === 0) {
      return;
    }

    setAttachmentError("");
    setAttachmentInfo("");
    setIsUploadingAttachments(true);
    try {
      await onUploadAttachments(task.id, files);
      setPendingAttachmentFiles([]);
      setAttachmentInputKey((current) => current + 1);
      resetAttachmentDragState();
      setAttachmentInfo(
        `Uploaded ${files.length} attachment${files.length === 1 ? "" : "s"}.`,
      );
    } catch (error) {
      resetAttachmentDragState();
      setAttachmentError(
        error instanceof Error ? error.message : "Unable to upload attachments.",
      );
    } finally {
      resetAttachmentDragState();
      setIsUploadingAttachments(false);
    }
  };

  const submitAttachments = async () => {
    await submitAttachmentFiles(pendingAttachmentFiles);
  };

  const startAttachmentRename = (attachmentId: string, displayName: string) => {
    if (!canMutateTask) {
      setAttachmentError("Read-only board. Attachment changes are disabled for viewer access.");
      return;
    }

    setAttachmentError("");
    setAttachmentInfo("");
    setEditingAttachmentId(attachmentId);
    setDraftAttachmentDisplayName(displayName);
  };

  const cancelAttachmentRename = () => {
    setEditingAttachmentId(null);
    setDraftAttachmentDisplayName("");
    setRenamingAttachmentId(null);
    setAttachmentError("");
  };

  const saveAttachmentRename = async (attachmentId: string) => {
    if (!canMutateTask) {
      setAttachmentError("Read-only board. Attachment changes are disabled for viewer access.");
      return;
    }

    const nextDisplayName = draftAttachmentDisplayName.trim();

    if (!nextDisplayName) {
      setAttachmentError("Attachment name is required.");
      return;
    }

    setAttachmentError("");
    setAttachmentInfo("");
    setRenamingAttachmentId(attachmentId);
    try {
      await onRenameAttachment(task.id, attachmentId, nextDisplayName);
      setEditingAttachmentId(null);
      setDraftAttachmentDisplayName("");
      setAttachmentInfo(`Renamed attachment to "${nextDisplayName}".`);
    } catch (error) {
      setAttachmentError(
        error instanceof Error ? error.message : "Unable to rename attachment.",
      );
    } finally {
      setRenamingAttachmentId(null);
    }
  };

  const deleteAttachment = async (attachmentId: string) => {
    if (!canMutateTask) {
      setAttachmentError("Read-only board. Attachment changes are disabled for viewer access.");
      return;
    }

    const attachmentName =
      task.attachments.find((attachment) => attachment.id === attachmentId)?.displayName ??
      "this attachment";

    if (
      !(await confirm({
        title: `Delete "${attachmentName}" from this task?`,
        confirmLabel: "Delete attachment",
        tone: "danger",
      }))
    ) {
      return;
    }

    setAttachmentError("");
    setAttachmentInfo("");
    setDeletingAttachmentId(attachmentId);
    try {
      await onDeleteAttachment(task.id, attachmentId);
      if (previewAttachmentId === attachmentId) {
        setPreviewAttachmentId(null);
      }
      if (popupPreviewAttachmentId === attachmentId) {
        setPopupPreviewAttachmentId(null);
      }
      if (editingAttachmentId === attachmentId) {
        cancelAttachmentRename();
      }
      setAttachmentInfo(`Deleted "${attachmentName}".`);
    } catch (error) {
      setAttachmentError(
        error instanceof Error ? error.message : "Unable to delete attachment.",
      );
    } finally {
      setDeletingAttachmentId(null);
    }
  };

  const submitNewNote = async () => {
    if (!canMutateTask) {
      setNoteError("Read-only board. Notes are disabled for viewer access.");
      return;
    }

    const body = newNoteBody.trim();
    if (!body || noteBusyId !== null) {
      return;
    }

    setNoteError("");
    setNoteInfo("");
    setNoteBusyId("new");
    try {
      await onCreateNote(task.id, body);
      setNewNoteBody("");
      setNoteInfo("Note posted.");
    } catch (error) {
      setNoteError(error instanceof Error ? error.message : "Unable to post note.");
    } finally {
      setNoteBusyId(null);
    }
  };

  const startNoteEdit = (note: TaskNote) => {
    if (!canMutateTask) {
      setNoteError("Read-only board. Notes are disabled for viewer access.");
      return;
    }

    setNoteError("");
    setNoteInfo("");
    setEditingNoteId(note.id);
    setDraftEditingNoteBody(note.body);
  };

  const cancelNoteEdit = () => {
    setEditingNoteId(null);
    setDraftEditingNoteBody("");
  };

  const saveNoteEdit = async (noteId: string) => {
    if (!canMutateTask) {
      setNoteError("Read-only board. Notes are disabled for viewer access.");
      return;
    }

    const body = draftEditingNoteBody.trim();
    if (!body || noteBusyId !== null) {
      return;
    }

    setNoteError("");
    setNoteInfo("");
    setNoteBusyId(noteId);
    try {
      await onUpdateNote(task.id, noteId, body);
      cancelNoteEdit();
      setNoteInfo("Note updated.");
    } catch (error) {
      setNoteError(error instanceof Error ? error.message : "Unable to update note.");
    } finally {
      setNoteBusyId(null);
    }
  };

  const deleteNote = async (note: TaskNote) => {
    if (!canMutateTask) {
      setNoteError("Read-only board. Notes are disabled for viewer access.");
      return;
    }

    if (
      !(await confirm({
        title: "Delete this note?",
        body: "Its attachments will remain on the task.",
        confirmLabel: "Delete note",
        tone: "danger",
      }))
    ) {
      return;
    }

    setNoteError("");
    setNoteInfo("");
    setNoteBusyId(note.id);
    try {
      await onDeleteNote(task.id, note.id);
      if (editingNoteId === note.id) {
        cancelNoteEdit();
      }
      setNoteInfo("Note deleted.");
    } catch (error) {
      setNoteError(error instanceof Error ? error.message : "Unable to delete note.");
    } finally {
      setNoteBusyId(null);
    }
  };

  const uploadNoteFiles = async (noteId: string, files: FileList | null) => {
    if (!canMutateTask) {
      setNoteError("Read-only board. Note attachments are disabled for viewer access.");
      return;
    }

    const selectedFiles = Array.from(files ?? []);
    if (selectedFiles.length === 0 || noteBusyId !== null) {
      return;
    }

    setNoteError("");
    setNoteInfo("");
    setNoteBusyId(noteId);
    try {
      await onUploadNoteAttachments(task.id, noteId, selectedFiles);
      setNoteAttachmentInputKeyById((current) => ({
        ...current,
        [noteId]: (current[noteId] ?? 0) + 1,
      }));
      setNoteInfo(
        `Uploaded ${selectedFiles.length} file${selectedFiles.length === 1 ? "" : "s"} to note.`,
      );
    } catch (error) {
      setNoteError(error instanceof Error ? error.message : "Unable to upload note files.");
    } finally {
      setNoteBusyId(null);
    }
  };

  const handleAttachmentDragEnter = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!attachmentsEnabled || !canMutateTask || attachmentsBusy) {
      return;
    }
    attachmentDragDepthRef.current += 1;
    setIsAttachmentDragOver(true);
  };

  const handleAttachmentDragOver = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!attachmentsEnabled || !canMutateTask || attachmentsBusy) {
      return;
    }
    event.dataTransfer.dropEffect = "copy";
    setIsAttachmentDragOver(true);
  };

  const handleAttachmentDragLeave = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    if (!attachmentsEnabled || !canMutateTask || attachmentsBusy) {
      return;
    }
    attachmentDragDepthRef.current = Math.max(attachmentDragDepthRef.current - 1, 0);
    if (attachmentDragDepthRef.current === 0) {
      setIsAttachmentDragOver(false);
    }
  };

  const handleAttachmentDrop = (event: ReactDragEvent<HTMLDivElement>) => {
    event.preventDefault();
    resetAttachmentDragState();
    if (!attachmentsEnabled || !canMutateTask || attachmentsBusy) {
      return;
    }

    const files = Array.from(event.dataTransfer.files ?? []);
    if (files.length === 0) {
      return;
    }

    setPendingAttachmentFiles(files);
    void submitAttachmentFiles(files);
  };

  const applyQuickStatus = (status: TaskStatus) => {
    if (!canMutateTask) {
      return;
    }

    setDraftStatus(status);
    queueDraftAutosave({ status });
  };

  // Once a top-level task is saved as done, its Done button reads
  // "Done: Archive" and a second click archives it. Subtasks archive with
  // their parent, so theirs stays a plain Done.
  const offersArchiveFromDone =
    isRootTask && canMutateTask && canManageTaskLifecycle && task.status === "done" && draftStatus === "done";
  const handleStatusButton = (status: TaskStatus) => {
    if (status === "done" && offersArchiveFromDone) {
      void onArchiveTask(task.id);
      return;
    }
    applyQuickStatus(status);
  };
  const getStatusButtonLabel = (option: { value: TaskStatus; label: string }) =>
    option.value === "done" && offersArchiveFromDone ? "Done: Archive" : option.label;

  const applySnoozeStart = (nextStartAt: string) => {
    if (!canEditSourceFields) {
      return;
    }

    setDraftStartAt(nextStartAt);
    queueDraftAutosave({ startAt: nextStartAt });
    setIsSnoozeMenuOpen(false);
  };

  const applyPickDateSnooze = () => {
    if (!draftSnoozeDate) {
      return;
    }

    applySnoozeStart(`${draftSnoozeDate}T09:00`);
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const taskEditorSection = (
    <SectionCard title="Task editor">
      {isReadOnlyImport ? (
        <div className="space-y-2">
          <p className={`whitespace-pre-wrap ${TASK_EDITOR_MUTED_TEXT_CLASS}`}>
            <SafeLinkifiedText text={getTaskSummaryPreview(task) || "No event notes."} />
          </p>
          {task.importedFrom?.convertToTask ? (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => void onConvertImportedTask(task.id)}
                disabled={!canEditBoard}
                className={TASK_EDITOR_INLINE_BUTTON_CLASS}
              >
                Convert to task
              </button>
            </div>
          ) : null}
        </div>
      ) : !canMutateTask ? (
        <div className="space-y-2">
          <p
            className={TASK_EDITOR_MUTED_TEXT_CLASS}
            data-testid="task-editor-read-only-note"
          >
            Read-only board. Task edits are disabled for viewer access.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block">
            <span className={TASK_EDITOR_LABEL_CLASS}>Title</span>
            <input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onBlur={flushTextAutosave}
              disabled={!canEditSourceFields}
              className={TASK_EDITOR_INPUT_CLASS}
            />
          </label>

          <PrimaryNoteEditor
            value={draftSummary}
            onChange={setDraftSummary}
            onBlur={flushTextAutosave}
            disabled={!canMutateTask}
            rows={2}
            minHeightClassName="min-h-[60px]"
            dataTestId="task-primary-note-textarea"
          />

          <label className="block">
            <span className={TASK_EDITOR_LABEL_CLASS}>Status</span>
            <select
              value={draftStatus}
              onChange={(event) => {
                const nextStatus = event.target.value as TaskStatus;
                setDraftStatus(nextStatus);
                queueDraftAutosave({ status: nextStatus });
              }}
              className={TASK_EDITOR_SELECT_CLASS}
            >
              <option value="todo">Todo</option>
              <option value="active">Active</option>
              <option value="waiting">Waiting</option>
              <option value="done">Done</option>
            </select>
          </label>

          <label className="block min-w-0 max-w-full">
            <span className={TASK_EDITOR_LABEL_CLASS}>Start</span>
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_5.5rem] gap-1.5">
              <input
                type="date"
                value={draftStartDateTime.date}
                onChange={(event) => {
                  const nextStartAt = combineDateTimeInput(
                    event.target.value,
                    draftStartDateTime.time,
                  );
                  setDraftStartAt(nextStartAt);
                  queueDraftAutosave({ startAt: nextStartAt });
                }}
                className={`${TASK_EDITOR_INPUT_CLASS} task-editor-date-part-input`}
                aria-label="Start date"
              />
              <input
                type="time"
                value={draftStartDateTime.time}
                onChange={(event) => {
                  const nextStartAt = combineDateTimeInput(
                    draftStartDateTime.date,
                    event.target.value,
                  );
                  setDraftStartAt(nextStartAt);
                  queueDraftAutosave({ startAt: nextStartAt });
                }}
                className={`${TASK_EDITOR_INPUT_CLASS} task-editor-date-part-input`}
                aria-label="Start time"
              />
            </div>
          </label>

          <label className="block min-w-0 max-w-full">
            <span className={TASK_EDITOR_LABEL_CLASS}>End</span>
            <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_5.5rem] gap-1.5">
              <input
                type="date"
                value={draftEndDateTime.date}
                onChange={(event) => {
                  const nextEndAt = combineDateTimeInput(
                    event.target.value,
                    draftEndDateTime.time,
                  );
                  setDraftEndAt(nextEndAt);
                  queueDraftAutosave({ endAt: nextEndAt });
                }}
                className={`${TASK_EDITOR_INPUT_CLASS} task-editor-date-part-input`}
                aria-label="End date"
              />
              <input
                type="time"
                value={draftEndDateTime.time}
                onChange={(event) => {
                  const nextEndAt = combineDateTimeInput(
                    draftEndDateTime.date,
                    event.target.value,
                  );
                  setDraftEndAt(nextEndAt);
                  queueDraftAutosave({ endAt: nextEndAt });
                }}
                className={`${TASK_EDITOR_INPUT_CLASS} task-editor-date-part-input`}
                aria-label="End time"
              />
            </div>
          </label>

          <details
            className="rounded-[14px] border border-border/70 bg-surface-subtle p-2.5"
            open={isRecurrenceSectionOpen}
            onToggle={(event) => setIsRecurrenceSectionOpen(event.currentTarget.open)}
          >
            <summary className="cursor-pointer ed-label text-muted">
              Recurrence
            </summary>
            <div className="mt-2 flex items-center justify-between gap-2">
              <div>
                <p className={TASK_EDITOR_LABEL_CLASS}>Recurring task</p>
                <p className={TASK_EDITOR_MUTED_TEXT_CLASS}>
                  Requires a due date. The next occurrence is generated when you mark this task done.
                </p>
              </div>
              <label className="flex items-center gap-2 ed-body font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={draftRecurrenceEnabled}
                  onChange={(event) => {
                    const nextEnabled = event.target.checked;
                    setDraftRecurrenceEnabled(nextEnabled);
                    queueDraftAutosave({ recurrenceEnabled: nextEnabled });
                  }}
                  disabled={!canEditSourceFields}
                  className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                />
                Enabled
              </label>
            </div>

            {draftRecurrenceEnabled ? (
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <label className="block">
                  <span className={TASK_EDITOR_LABEL_CLASS}>Frequency</span>
                  <select
                    value={draftRecurrenceFrequency}
                    onChange={(event) => {
                      const nextFrequency = event.target.value as TaskRecurrenceFrequency;
                      setDraftRecurrenceFrequency(nextFrequency);
                      queueDraftAutosave({ recurrenceFrequency: nextFrequency });
                    }}
                    disabled={!canEditSourceFields}
                    className={TASK_EDITOR_SELECT_CLASS}
                  >
                    <option value="daily">Daily</option>
                    <option value="weekly">Weekly</option>
                    <option value="monthly">Monthly</option>
                    <option value="weekday">Weekday-only</option>
                    <option value="custom">Every N days</option>
                  </select>
                </label>

                <label className="block">
                  <span className={TASK_EDITOR_LABEL_CLASS}>Interval</span>
                  <input
                    type="number"
                    min={1}
                    value={draftRecurrenceInterval}
                    onChange={(event) => {
                      const nextInterval = event.target.value;
                      setDraftRecurrenceInterval(nextInterval);
                      queueDraftAutosave({ recurrenceInterval: nextInterval });
                    }}
                    disabled={!canEditSourceFields || draftRecurrenceFrequency === "weekday"}
                    className={`${TASK_EDITOR_INPUT_CLASS} disabled:cursor-not-allowed disabled:opacity-60`}
                  />
                </label>

                <label className="block">
                  <span className={TASK_EDITOR_LABEL_CLASS}>Next occurrence</span>
                  <select
                    value={draftRecurrenceMode}
                    onChange={(event) => {
                      const nextMode = event.target.value as TaskRecurrenceMode;
                      setDraftRecurrenceMode(nextMode);
                      queueDraftAutosave({ recurrenceMode: nextMode });
                    }}
                    disabled={!canEditSourceFields}
                    className={TASK_EDITOR_SELECT_CLASS}
                  >
                    <option value="on_schedule">On schedule</option>
                    <option value="after_completion">After completion</option>
                  </select>
                </label>
              </div>
            ) : null}
          </details>

          {isRootTask && canMutateTask ? (
            <details
              className="rounded-[14px] border border-border/70 bg-surface-subtle p-2.5"
              open={isReminderSectionOpen}
              onToggle={(event) => setIsReminderSectionOpen(event.currentTarget.open)}
            >
              <summary className="cursor-pointer ed-label text-muted">
                Reminders
              </summary>
              <div className="mt-2 flex items-center justify-between gap-2">
                <div>
                  <p className={TASK_EDITOR_LABEL_CLASS}>Reminders</p>
                  <p className={TASK_EDITOR_MUTED_TEXT_CLASS}>
                    Reminder settings travel with each recurring occurrence.
                  </p>
                </div>
              </div>

              <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
                <label className="block">
                  <span className={TASK_EDITOR_LABEL_CLASS}>Reminder</span>
                  <select
                    value={draftReminderOffsetValue}
                    onChange={(event) => {
                      const nextReminderOffset = event.target.value;
                      setDraftReminderOffsetValue(nextReminderOffset);
                      queueDraftAutosave({ reminderOffsetValue: nextReminderOffset });
                    }}
                    className={TASK_EDITOR_SELECT_CLASS}
                  >
                    {reminderPresetOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex items-center gap-2 pb-0.5 ed-body font-medium text-foreground">
                  <input
                    type="checkbox"
                    checked={draftOverdueReminderEnabled}
                    onChange={(event) => {
                      const nextOverdueEnabled = event.target.checked;
                      setDraftOverdueReminderEnabled(nextOverdueEnabled);
                      queueDraftAutosave({ overdueReminderEnabled: nextOverdueEnabled });
                    }}
                    className="h-3.5 w-3.5 accent-[var(--color-accent)]"
                  />
                  Overdue reminder
                </label>
              </div>
            </details>
          ) : null}

          <div className="block">
            <span className={TASK_EDITOR_LABEL_CLASS}>Labels</span>
            <LabelChipEditor
              value={draftLabels}
              disabled={!canMutateTask}
              onChange={setDraftLabels}
              onCommit={(nextLabels) => queueDraftAutosave({ labels: nextLabels })}
            />
          </div>

          {/* Task colors are no longer shown on cards (status bar instead), so
              the color picker is hidden; stored colors are left untouched. */}
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className={TASK_EDITOR_LABEL_CLASS}>Icon</span>
              {canMutateTask ? (
                <IconDropdown
                  value={draftIcon}
                  onChange={(nextIcon) => {
                    setDraftIcon(nextIcon);
                    queueDraftAutosave({ icon: nextIcon });
                  }}
                  options={taskIconOptions}
                />
              ) : (
                <WorkspaceMetaLine label="Current" value={draftIcon} />
              )}
            </label>
          </div>

        </div>
      )}
    </SectionCard>
  );

  const sidebarQuickEditSection = !isExpanded ? (
    <div
      className="w-full min-w-0"
      data-testid="task-inspector-quick-edit"
    >
      <div className="space-y-1.5">
        <button
          type="button"
          onClick={onExpand}
          className={`${TASK_EDITOR_BUTTON_CLASS} ui-button-primary w-full justify-center`}
          data-testid="task-inspector-open-workspace"
        >
          Open Task Workspace
        </button>

        <div className="grid w-full min-w-0 grid-cols-2 gap-1" data-testid="task-inspector-quick-actions">
          {sidebarStatusButtonOptions.map((option) => {
            const isCurrentStatus = draftStatus === option.value;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => handleStatusButton(option.value)}
                disabled={!canMutateTask}
                aria-pressed={isCurrentStatus}
                data-status={option.value}
                data-testid="task-inspector-status-button"
                className={`${TASK_EDITOR_BUTTON_CLASS} w-full min-w-0 justify-center whitespace-nowrap border px-1.5 disabled:cursor-not-allowed disabled:opacity-50 ${
                  isCurrentStatus
                    ? option.activeClassName
                    : "border-border/70 bg-background/25"
                }`}
              >
                {getStatusButtonLabel(option)}
              </button>
            );
          })}
        </div>

        <label className="block min-w-0">
          <span className={TASK_EDITOR_LABEL_CLASS}>Bucket</span>
          <select
            value={draftBucketId}
            onChange={(event) => {
              const nextBucketId = event.target.value;
              setDraftBucketId(nextBucketId);
              queueDraftAutosave({ bucketId: nextBucketId });
            }}
            disabled={!isRootTask || !canMutateTask}
            className={`${TASK_EDITOR_SELECT_CLASS} disabled:cursor-not-allowed disabled:opacity-60`}
          >
            {bucketOptions.map((bucket) => (
              <option key={bucket.id} value={bucket.id}>
                {bucket.title}
              </option>
            ))}
          </select>
        </label>

        <div
          ref={snoozeMenuRef}
          className="relative min-w-0"
          onKeyDown={(event) => {
            if (event.key !== "Escape" || !isSnoozeMenuOpen) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            event.nativeEvent.stopImmediatePropagation();
            setIsSnoozeMenuOpen(false);
          }}
        >
          <button
            type="button"
            onClick={() => setIsSnoozeMenuOpen((current) => !current)}
            disabled={!canMutateTask}
            className={`${TASK_EDITOR_BUTTON_CLASS} w-full min-w-0 justify-center gap-1.5 whitespace-nowrap px-1.5 disabled:cursor-not-allowed disabled:opacity-50`}
            aria-expanded={isSnoozeMenuOpen}
            data-testid="task-snooze-button"
          >
            <AlarmClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Snooze
          </button>
          {isSnoozeMenuOpen ? (
            <SnoozeMenu
              draftDate={draftSnoozeDate}
              onDraftDateChange={setDraftSnoozeDate}
              onApplyPreset={(preset) => applySnoozeStart(getSnoozeDateTime(preset))}
              onApplyPickDate={applyPickDateSnooze}
            />
          ) : null}
        </div>

        <label className="block min-w-0">
          <span className={TASK_EDITOR_LABEL_CLASS}>End</span>
          <div className="flex min-w-0 flex-wrap gap-1.5" data-testid="task-inspector-end-controls">
            <input
              type="date"
              value={draftEndDateTime.date}
              onChange={(event) => {
                const nextEndAt = combineDateTimeInput(event.target.value, draftEndDateTime.time);
                setDraftEndAt(nextEndAt);
                queueDraftAutosave({ endAt: nextEndAt });
              }}
              disabled={!canMutateTask}
              className={`${TASK_EDITOR_INPUT_CLASS} task-editor-date-part-input min-w-[9.5rem] flex-[2_1_9.5rem] disabled:cursor-not-allowed disabled:opacity-60`}
              aria-label="End date"
            />
            <input
              type="time"
              value={draftEndDateTime.time}
              onChange={(event) => {
                const nextEndAt = combineDateTimeInput(draftEndDateTime.date, event.target.value);
                setDraftEndAt(nextEndAt);
                queueDraftAutosave({ endAt: nextEndAt });
              }}
              disabled={!canMutateTask}
              className={`${TASK_EDITOR_INPUT_CLASS} task-editor-date-part-input min-w-[8rem] flex-[1_1_8rem] disabled:cursor-not-allowed disabled:opacity-60`}
              aria-label="End time"
            />
          </div>
        </label>

        <PrimaryNoteEditor
          value={draftSummary}
          onChange={setDraftSummary}
          onBlur={flushTextAutosave}
          disabled={!canMutateTask}
          rows={2}
          minHeightClassName="min-h-[52px]"
          dataTestId="task-inspector-primary-note-textarea"
        />
        <div className="block">
          <span className={TASK_EDITOR_LABEL_CLASS}>Labels</span>
          <LabelChipEditor
            value={draftLabels}
            disabled={!canMutateTask}
            onChange={setDraftLabels}
            onCommit={(nextLabels) => queueDraftAutosave({ labels: nextLabels })}
          />
        </div>
      </div>
    </div>
  ) : null;

  const sidebarRowsSection = !isExpanded ? (
    <div className="space-y-1.5" data-testid="task-inspector-nav-rows">
      <WorkingNotesInspectorRow
        notes={task.notes}
      />
      <QuickInspectorRow
        title="Checklist"
        detail={`${checklistDoneCount}/${task.checklist.length} complete`}
      >
        <ChecklistPreview
          items={checklistPreviewItems}
          moreCount={checklistMoreCount}
        />
      </QuickInspectorRow>
      <QuickInspectorRow
        title="Subtasks"
        detail={`${openSubtaskCount} open`}
      >
        <SubtaskPreview
          tasks={subtaskPreviewItems}
          moreCount={subtaskMoreCount}
        />
      </QuickInspectorRow>
      <QuickInspectorRow
        title="Attachments"
        detail={`${task.attachments.length} file${task.attachments.length === 1 ? "" : "s"}`}
        actionLabel={task.attachments.length > 0 ? "Open" : "Add"}
        onAction={onExpand}
      />
    </div>
  ) : null;

  const importedSidebarSection = !isExpanded && task.importedFrom ? (
    <ImportedEventInspector
      task={task}
      attachmentCount={task.attachments.length}
      onExpand={onExpand}
      onConvert={() => void onConvertImportedTask(task.id)}
      onCreateFollowUp={() => void onCreateFollowUpTask(task.id)}
      onHide={() => void onDeleteTask(task.id)}
      canEditBoard={canEditBoard}
      calendarTaskHref={calendarTaskHref}
    />
  ) : null;

  const calendarBehaviorSection = isExpanded && task.importedFrom ? (
    <div className="space-y-2">
      <div className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
        <WorkspaceMetaLine label="Source" value={getImportedProviderDisplayLabel(task)} />
        <WorkspaceMetaLine label="Import status" value={task.importedFrom.syncStatus ?? "active"} />
        <WorkspaceMetaLine label="Recurring" value={task.importedFrom.isRecurring ? "Rolling" : "No"} />
      </div>
    </div>
  ) : null;

  const checklistSection = isExpanded ? (
    <>
      {task.checklist.length > 0 ? (
        <div className="space-y-1">
          {task.checklist.map((item) => (
            <ChecklistItemEditor
              key={item.id}
              item={item}
              canEditBoard={canMutateTask}
              onUpdate={onChecklistUpdate}
              onDelete={onChecklistDelete}
            />
          ))}
        </div>
      ) : (
        <FlatEmptyState text="No checklist items yet." />
      )}

      {canMutateTask ? (
        <div className="mt-1.5 flex gap-1.5">
          <input
            value={newChecklistLabel}
            onChange={(event) => setNewChecklistLabel(event.target.value)}
            onKeyDown={(event) => {
              handlePlainEnterSubmit(event, submitChecklistItem);
            }}
            placeholder="Add checklist item"
            className={`${TASK_EDITOR_INLINE_INPUT_CLASS} placeholder:text-muted`}
          />
          <button
            type="button"
            onClick={submitChecklistItem}
            className={TASK_EDITOR_INLINE_BUTTON_CLASS}
          >
            Add
          </button>
        </div>
      ) : null}
    </>
  ) : null;

  const primaryNoteSection = isExpanded ? (
    <section
      className="taskboard-section-card rounded-[10px] border border-border/70 p-2.5"
      data-testid="task-primary-note-section"
    >
      <h2 className="mb-2 ed-label text-muted">
        Description
      </h2>
      {isReadOnlyImport ? (
        <div
          className="min-h-[72px] whitespace-pre-wrap rounded-[8px] border border-border/60 px-2.5 py-2 ed-body text-foreground"
          data-testid="task-primary-note-read-only"
        >
          <SafeLinkifiedText text={draftSummary || "No event notes."} />
        </div>
      ) : (
        <PrimaryNoteEditor
          value={draftSummary}
          onChange={setDraftSummary}
          onBlur={flushTextAutosave}
          disabled={!canMutateTask}
          rows={3}
          minHeightClassName="min-h-[84px]"
          resizeClassName="resize-y"
          dataTestId="task-primary-note-textarea"
          showLabel={false}
        />
      )}
    </section>
  ) : null;

  const workingNotesSection = isExpanded ? (
    <section
      className="task-working-notes-canvas min-h-0"
      data-testid="task-working-notes-section"
      data-open={isWorkingNotesOpen ? "true" : "false"}
    >
      {/* Collapsible under the work; narrow workspaces show notes in their own tab. */}
      <h2 className="task-notes-heading">
        <button
          type="button"
          className="task-notes-toggle"
          aria-expanded={isWorkingNotesOpen}
          onClick={toggleWorkingNotes}
          data-testid="task-working-notes-toggle"
        >
          <ChevronDown className="task-notes-toggle-icon h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="work-section-label">Working notes</span>
          <span className="work-muted">{formatWorkingNotesSummary(task.notes)}</span>
        </button>
      </h2>
      <div className="task-notes-body">
      <div className="task-working-notes-feedback">
          {noteInfo ? (
            <div className="ui-info-banner rounded-[10px] border px-2.5 py-2 ed-body text-foreground">
              {noteInfo}
            </div>
          ) : null}
          {noteError ? (
            <div className="ui-danger-banner rounded-[10px] border px-2.5 py-2 ed-body">
              {noteError}
            </div>
          ) : null}
      </div>

      <div className="task-working-notes-composer">
        {canMutateTask ? (
          <div className="border-t border-border/50 pt-2.5">
            <label className="block">
              <span className={TASK_EDITOR_LABEL_CLASS}>New working note</span>
              <textarea
                value={newNoteBody}
                onChange={(event) => setNewNoteBody(event.target.value)}
                onInput={(event) => resizeWorkingNoteComposer(event.currentTarget)}
                rows={2}
                placeholder="Post an update, decision, or troubleshooting note."
                style={{ minHeight: "56px", maxHeight: "320px" }}
                className={`${TASK_EDITOR_INPUT_CLASS} min-h-[56px] resize-y overflow-x-hidden overflow-y-auto py-1 placeholder:text-muted`}
                data-testid="task-note-composer"
                aria-label="New working note"
              />
            </label>
            <div className="mt-2 flex justify-end">
              <button
                type="button"
                onClick={() => void submitNewNote()}
                disabled={!newNoteBody.trim() || noteBusyId !== null}
                className={`${TASK_EDITOR_BUTTON_CLASS} ui-button-primary inline-flex items-center justify-center whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50`}
              >
                {noteBusyId === "new" ? "Posting..." : "Post note"}
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <div
        className="task-working-notes-stream pretty-scrollbar"
        data-testid="task-notes-activity-stream"
      >

          {workingNotesOldestFirst.length > 0 ? (
            <div className="space-y-2">
              {workingNotesOldestFirst.map((note) => {
                const isEditingNote = editingNoteId === note.id;
                const isBusyNote = noteBusyId === note.id;
                const isWorkingNoteExpanded = Boolean(expandedWorkingNoteIds[note.id]);

                return (
                  <article
                    key={note.id}
                    className="rounded-[10px] border border-border/70 px-2.5 py-2.5"
                    data-testid="task-note-item"
                  >
                    <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="ed-strong text-foreground">
                          {note.authorName}
                        </p>
                        <p className={TASK_EDITOR_MUTED_TEXT_CLASS}>
                          {formatDate(note.createdAt, displayTimeZone)}
                          {note.updatedAt ? ` | Edited ${formatDate(note.updatedAt, displayTimeZone)}` : ""}
                          {note.editorName && note.editorName !== note.authorName
                            ? ` by ${note.editorName}`
                            : ""}
                        </p>
                      </div>
                      {isEditingNote ? (
                        <div className="flex shrink-0 flex-wrap gap-1">
                          <button
                            type="button"
                            onClick={() => void saveNoteEdit(note.id)}
                            disabled={!draftEditingNoteBody.trim() || isBusyNote}
                            className={`${TASK_EDITOR_INLINE_BUTTON_CLASS} inline-flex items-center gap-1 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50`}
                          >
                            <Check className="h-3 w-3" />
                            Save
                          </button>
                          <button
                            type="button"
                            onClick={cancelNoteEdit}
                            disabled={isBusyNote}
                            className={`${TASK_EDITOR_INLINE_BUTTON_CLASS} inline-flex items-center gap-1 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50`}
                          >
                            <X className="h-3 w-3" />
                            Cancel
                          </button>
                        </div>
                      ) : null}
                    </div>

                    {isEditingNote ? (
                      <textarea
                        autoFocus
                        value={draftEditingNoteBody}
                        onChange={(event) => setDraftEditingNoteBody(event.target.value)}
                        disabled={!canMutateTask}
                        rows={4}
                        className={`${TASK_EDITOR_INPUT_CLASS} min-h-[96px] resize-y overflow-x-hidden py-1`}
                      />
                    ) : (
                      <p
                        className={`whitespace-pre-wrap pr-1 ed-body text-foreground ${
                          isWorkingNoteExpanded ? "" : "max-h-[400px] overflow-y-auto"
                        }`}
                      >
                        <SafeLinkifiedText text={note.body} />
                      </p>
                    )}

                    {note.attachments.length > 0 ? (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {note.attachments.map((attachment) => {
                          const PreviewIcon = getAttachmentPreviewIcon(attachment.previewKind);

                          return (
                            <a
                              key={attachment.id}
                              href={buildAttachmentHref(attachment.id)}
                              className={`${TASK_EDITOR_INLINE_BUTTON_CLASS} inline-flex max-w-full items-center gap-1 whitespace-nowrap`}
                            >
                              <PreviewIcon className="h-3 w-3" />
                              <span className="truncate">{attachment.displayName}</span>
                            </a>
                          );
                        })}
                      </div>
                    ) : null}

                    {!isEditingNote ? (
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 border-t border-border/50 pt-2">
                        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
                          {attachmentsEnabled && canMutateTask ? (
                            <label
                              className={`${TASK_EDITOR_INLINE_BUTTON_CLASS} inline-flex cursor-pointer items-center gap-1 whitespace-nowrap ${
                                noteBusyId !== null ? "cursor-not-allowed opacity-50" : ""
                              }`}
                            >
                              <Paperclip className="h-3 w-3" />
                              Attachments
                              <input
                                key={`${note.id}-${noteAttachmentInputKeyById[note.id] ?? 0}`}
                                type="file"
                                multiple
                                onChange={(event) => void uploadNoteFiles(note.id, event.target.files)}
                                disabled={noteBusyId !== null}
                                className="sr-only"
                                aria-label="Add files to working note"
                              />
                            </label>
                          ) : null}
                        </div>
                        <div className="ml-auto flex flex-wrap items-center justify-end gap-1">
                          {canMutateTask ? (
                            <>
                              <button
                                type="button"
                                onClick={() => startNoteEdit(note)}
                                disabled={noteBusyId !== null}
                                className={`${TASK_EDITOR_INLINE_BUTTON_CLASS} inline-flex items-center gap-1 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50`}
                              >
                                <Pencil className="h-3 w-3" />
                                Edit
                              </button>
                              <button
                                type="button"
                                onClick={() => void deleteNote(note)}
                                disabled={noteBusyId !== null}
                                className={`${TASK_EDITOR_INLINE_BUTTON_CLASS} inline-flex items-center gap-1 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50`}
                              >
                                <Trash2 className="h-3 w-3" />
                                {isBusyNote ? "Deleting..." : "Delete"}
                              </button>
                            </>
                          ) : null}
                          <button
                            type="button"
                            onClick={() => toggleWorkingNoteExpanded(note.id)}
                            className={`${TASK_EDITOR_INLINE_BUTTON_CLASS} inline-flex items-center gap-1 whitespace-nowrap`}
                            aria-expanded={isWorkingNoteExpanded}
                          >
                            {isWorkingNoteExpanded ? (
                              <ChevronDown className="h-3 w-3" />
                            ) : (
                              <ChevronRight className="h-3 w-3" />
                            )}
                            {isWorkingNoteExpanded ? "Collapse" : "Expand"}
                          </button>
                        </div>
                      </div>
                    ) : null}
                  </article>
                );
              })}
            </div>
          ) : (
            <FlatEmptyState text="No working notes yet." />
          )}

      </div>
      </div>
    </section>
  ) : null;

  const attachmentsSection = isExpanded ? (
    shouldShowAttachmentManager ? (
      <div
        onDragEnter={handleAttachmentDragEnter}
        onDragOver={handleAttachmentDragOver}
        onDragLeave={handleAttachmentDragLeave}
        onDrop={handleAttachmentDrop}
        className={`rounded-[10px] border border-dashed p-2 transition ${
          isAttachmentDragOver
            ? "border-accent/80 bg-accent/10 shadow-[inset_0_0_0_1px_rgba(14,165,233,0.24)]"
            : "border-border/60"
        } ${attachmentsBusy ? "opacity-80" : ""}`}
      >
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <p className="ed-body font-medium text-foreground">
              {task.attachments.length > 0
                ? `${task.attachments.length} file${task.attachments.length === 1 ? "" : "s"} attached`
                : "Add files"}
            </p>
            <p className={TASK_EDITOR_MUTED_TEXT_CLASS}>
              Drop files here or use the file picker.
            </p>
          </div>
        </div>

        {attachmentInfo ? (
          <div className="ui-info-banner mb-2 rounded-[10px] border px-2.5 py-2 ed-body text-foreground">
            {attachmentInfo}
          </div>
        ) : null}
        {attachmentError ? (
          <div className="ui-danger-banner mb-2 rounded-[10px] border px-2.5 py-2 ed-body">
            {attachmentError}
          </div>
        ) : null}

        {previewAttachment ? (
          <div className="mb-2 rounded-[12px] border border-border/70 bg-panel/70 p-2">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate ed-body font-medium text-foreground">
                  Previewing {previewAttachment.displayName}
                </p>
                <p className={TASK_EDITOR_MUTED_TEXT_CLASS}>
                  {previewAttachment.previewKind === "pdf" ? "PDF preview" : "Image preview"}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap items-center justify-end gap-1">
                <button
                  type="button"
                  onClick={() => setPopupPreviewAttachmentId(previewAttachment.id)}
                  className={TASK_ATTACHMENT_ACTION_BUTTON_CLASS}
                >
                  <Maximize2 className="h-3 w-3" />
                  Open larger preview
                </button>
                <a
                  href={buildAttachmentHref(previewAttachment.id)}
                  className={TASK_ATTACHMENT_ACTION_BUTTON_CLASS}
                >
                  <Download className="h-3 w-3" />
                  Download
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewAttachmentId(null)}
                  className={TASK_ATTACHMENT_ACTION_BUTTON_CLASS}
                >
                  <X className="h-3 w-3" />
                  Close
                </button>
              </div>
            </div>
            {previewAttachment.previewKind === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={buildAttachmentHref(previewAttachment.id, "inline")}
                alt={previewAttachment.displayName}
                className="max-h-[240px] w-full rounded-[10px] border border-border/60 bg-background object-contain"
              />
            ) : previewAttachment.previewKind === "pdf" ? (
              <iframe
                src={buildAttachmentHref(previewAttachment.id, "inline")}
                title={previewAttachment.displayName}
                className="h-[320px] w-full rounded-[10px] border border-border/60 bg-background"
              />
            ) : null}
          </div>
        ) : null}

        {task.attachments.length > 0 ? (
          <div className="space-y-1.5">
            {task.attachments.map((attachment) => {
              const PreviewIcon = getAttachmentPreviewIcon(attachment.previewKind);
              const isEditingAttachment = editingAttachmentId === attachment.id;
              const isRenamingAttachment = renamingAttachmentId === attachment.id;
              const isDeletingAttachment = deletingAttachmentId === attachment.id;

              return (
                <div
                  key={attachment.id}
                  className="taskboard-subtle-surface rounded-[12px] border px-2.5 py-2"
                >
                  <div className="grid min-w-0 gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-1.5">
                        <PreviewIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
                        <div className="min-w-0 flex-1">
                          {isEditingAttachment ? (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <input
                                autoFocus
                                value={draftAttachmentDisplayName}
                                onChange={(event) => setDraftAttachmentDisplayName(event.target.value)}
                                onKeyDown={(event) => {
                                  if (
                                    handlePlainEnterSubmit(event, () =>
                                      void saveAttachmentRename(attachment.id),
                                    )
                                  ) {
                                    return;
                                  }

                                  if (event.key === "Escape") {
                                    event.preventDefault();
                                    cancelAttachmentRename();
                                  }
                                }}
                                className={`${TASK_EDITOR_INLINE_INPUT_CLASS} min-w-[160px] flex-1`}
                              />
                              <button
                                type="button"
                                onClick={() => void saveAttachmentRename(attachment.id)}
                                disabled={isRenamingAttachment}
                                className={`${TASK_ATTACHMENT_ACTION_BUTTON_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
                              >
                                <Check className="h-3 w-3" />
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={cancelAttachmentRename}
                                disabled={isRenamingAttachment}
                                className={`${TASK_ATTACHMENT_ACTION_BUTTON_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
                              >
                                <X className="h-3 w-3" />
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                if (attachment.previewKind !== "none") {
                                  setPreviewAttachmentId((current) =>
                                    current === attachment.id ? null : attachment.id,
                                  );
                                }
                              }}
                              className={`min-w-0 text-left ${
                                attachment.previewKind !== "none" ? "cursor-pointer hover:text-accent" : ""
                              }`}
                              disabled={attachment.previewKind === "none"}
                            >
                              <span className="block truncate ed-body font-medium text-foreground">
                                {attachment.displayName}
                              </span>
                            </button>
                          )}
                          <p className={`mt-0.5 ${TASK_EDITOR_MUTED_TEXT_CLASS}`}>
                            {formatFileSize(attachment.sizeBytes)} | Added {formatDate(attachment.createdAt, displayTimeZone)}
                          </p>
                        </div>
                      </div>

                      {attachment.previewKind === "image" ? (
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewAttachmentId((current) =>
                              current === attachment.id ? null : attachment.id,
                            )
                          }
                          className="mt-2 block overflow-hidden rounded-[10px] border border-border/60 bg-background"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={buildAttachmentHref(attachment.id, "inline")}
                            alt={attachment.displayName}
                            className="h-24 w-24 object-cover"
                          />
                        </button>
                      ) : null}
                    </div>

                    <div className="flex min-w-0 flex-wrap items-center gap-1">
                      {attachment.previewKind !== "none" ? (
                        <button
                          type="button"
                          onClick={() =>
                            setPreviewAttachmentId((current) =>
                              current === attachment.id ? null : attachment.id,
                            )
                          }
                          className={TASK_ATTACHMENT_ACTION_BUTTON_CLASS}
                        >
                          <Eye className="h-3 w-3" />
                          {previewAttachmentId === attachment.id ? "Hide preview" : "Preview"}
                        </button>
                      ) : null}
                      {attachmentsEnabled ? (
                        <button
                          type="button"
                          onClick={() => startAttachmentRename(attachment.id, attachment.displayName)}
                          disabled={attachmentsBusy}
                          className={`${TASK_ATTACHMENT_ACTION_BUTTON_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          <Pencil className="h-3 w-3" />
                          Rename
                        </button>
                      ) : null}
                      <a
                        href={buildAttachmentHref(attachment.id)}
                        className={TASK_ATTACHMENT_ACTION_BUTTON_CLASS}
                      >
                        <Download className="h-3 w-3" />
                        Download
                      </a>
                      {attachmentsEnabled ? (
                        <button
                          type="button"
                          onClick={() => void deleteAttachment(attachment.id)}
                          disabled={attachmentsBusy}
                          className={`${TASK_ATTACHMENT_ACTION_BUTTON_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
                        >
                          <Trash2 className="h-3 w-3" />
                          {isDeletingAttachment ? "Deleting..." : "Delete"}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="taskboard-subtle-surface rounded-[12px] border border-dashed px-2.5 py-2">
            <p className={TASK_EDITOR_MUTED_TEXT_CLASS}>No attachments yet.</p>
          </div>
        )}

        {attachmentsEnabled ? (
          <div className="mt-2 space-y-2">
            <label
              htmlFor={attachmentInputId}
              className={`taskboard-subtle-surface flex cursor-pointer flex-col gap-2 rounded-[10px] border border-dashed px-3 py-3 text-left transition ${
                isAttachmentDragOver
                  ? "border-accent/80 bg-accent/10"
                  : "border-border/60 hover:border-border"
              } ${attachmentsBusy ? "cursor-not-allowed opacity-60" : ""}`}
            >
              <input
                id={attachmentInputId}
                key={attachmentInputKey}
                type="file"
                multiple
                onClick={resetAttachmentDragState}
                onBlur={resetAttachmentDragState}
                onChange={(event) => {
                  resetAttachmentDragState();
                  setPendingAttachmentFiles(Array.from(event.target.files ?? []));
                }}
                disabled={attachmentsBusy}
                className="sr-only"
                aria-label="Choose task attachment files"
              />
              <span className="flex min-w-0 flex-wrap items-center gap-2">
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[8px] border border-border/70 text-muted">
                  <Upload className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block ed-strong text-foreground">
                    Drop files here or choose files
                  </span>
                  <span className={TASK_EDITOR_MUTED_TEXT_CLASS}>
                    PDFs, images, and other task files. Max 25 MB per file.
                  </span>
                </span>
                <span className={TASK_ATTACHMENT_ACTION_BUTTON_CLASS}>
                  <Paperclip className="h-3 w-3" />
                  Choose files
                </span>
              </span>
              {pendingAttachmentFiles.length > 0 ? (
                <span className="flex flex-wrap gap-1">
                  {pendingAttachmentFiles.slice(0, 4).map((file) => (
                    <span
                      key={`${file.name}-${file.size}-${file.lastModified}`}
                      className="taskboard-label-chip max-w-full rounded-[9px] px-2 py-0.5 ed-meta font-medium"
                    >
                      <span className="inline-block max-w-[180px] truncate align-bottom">{file.name}</span>
                    </span>
                  ))}
                  {pendingAttachmentFiles.length > 4 ? (
                    <span className="taskboard-label-chip taskboard-label-chip-muted rounded-[9px] px-2 py-0.5 ed-meta font-medium">
                      +{pendingAttachmentFiles.length - 4} more
                    </span>
                  ) : null}
                </span>
              ) : null}
            </label>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                {pendingAttachmentFiles.length > 0 ? (
                  <p className={TASK_EDITOR_MUTED_TEXT_CLASS}>
                    {pendingAttachmentFiles.length} file{pendingAttachmentFiles.length === 1 ? "" : "s"} selected
                  </p>
                ) : (
                  <p className={TASK_EDITOR_MUTED_TEXT_CLASS}>Select files or drop them into this section.</p>
                )}
                {isUploadingAttachments ? (
                  <p className={TASK_EDITOR_MUTED_TEXT_CLASS}>Uploading attachments...</p>
                ) : null}
              </div>
              <button
                type="button"
                onClick={() => void submitAttachments()}
                disabled={pendingAttachmentFiles.length === 0 || attachmentsBusy}
                className={`${TASK_EDITOR_BUTTON_CLASS} ui-button-primary inline-flex items-center gap-1 whitespace-nowrap disabled:cursor-not-allowed disabled:opacity-50`}
              >
                <Upload className="h-3 w-3" />
                {isUploadingAttachments ? "Uploading..." : "Upload files"}
              </button>
            </div>
          </div>
        ) : (
          <p className={`mt-2 ${TASK_EDITOR_MUTED_TEXT_CLASS}`}>
            Attachments require database-backed persistence.
          </p>
        )}
      </div>
    ) : (
      <FlatEmptyState
        text="No files attached"
        actionLabel="Add File"
        onAction={() => setIsAttachmentManagerOpen(true)}
      />
    )
  ) : null;

  // Header controls: status and title live in the one-line header.
  const workspaceStatusControl = isExpanded ? (
    <>
    <div className="workspace-seg workspace-status-seg" role="group" aria-label="Status" data-testid="task-overview-status-button-row">
      {sidebarStatusButtonOptions.map((option) => (
        <button
          key={option.value}
          type="button"
          onClick={() => handleStatusButton(option.value)}
          disabled={!canEditSourceFields}
          aria-pressed={draftStatus === option.value}
          data-status={option.value}
          data-testid="task-overview-status-button"
        >
          <span className="workspace-status-dot" aria-hidden="true" />
          {getStatusButtonLabel(option)}
        </button>
      ))}
    </div>
    <select className="workspace-status-select" aria-label="Task status" value={draftStatus} disabled={!canEditSourceFields} onChange={event => handleStatusButton(event.target.value as TaskStatus)}>
      {sidebarStatusButtonOptions.map(option => <option key={option.value} value={option.value}>{getStatusButtonLabel(option)}</option>)}
    </select>
    </>
  ) : null;

  const workspaceTitleControl = isExpanded ? (
    <label className="workspace-title-field" data-testid="task-overview-title-field">
      <span className="sr-only">Title</span>
      {isReadOnlyImport ? (
        <h2 className="workspace-title-text ed-title">
          <SafeLinkifiedText text={task.title} />
        </h2>
      ) : (
        <textarea
          rows={1}
          value={draftTitle}
          onChange={(event) => setDraftTitle(event.target.value)}
          onBlur={flushTextAutosave}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          disabled={!canEditSourceFields}
          className="workspace-title-input ed-title"
          data-testid="task-overview-title-input"
        />
      )}
    </label>
  ) : null;

  // Details column: settings you set once, grouped and compact.
  const workspaceNoticeSection = isExpanded ? (
    isReadOnlyImport ? (
      task.importedFrom?.convertToTask ? (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className={TASK_EDITOR_MUTED_TEXT_CLASS}>Imported calendar item, read-only.</span>
          <button
            type="button"
            onClick={() => void onConvertImportedTask(task.id)}
            disabled={!canEditBoard}
            className={TASK_EDITOR_INLINE_BUTTON_CLASS}
          >
            Convert to task
          </button>
        </div>
      ) : null
    ) : !canMutateTask ? (
      <p className={TASK_EDITOR_MUTED_TEXT_CLASS} data-testid="task-editor-read-only-note">
        Read-only board. Task edits are disabled for viewer access.
      </p>
    ) : null
  ) : null;

  const workspaceBucketSection = isExpanded ? (
    <div className="grid min-w-0 gap-1.5" data-testid="task-overview-status-bucket-row">
      <label className="block min-w-0">
        <span className={TASK_EDITOR_LABEL_CLASS}>Bucket</span>
        <select
          value={draftBucketId}
          onChange={(event) => {
            const nextBucketId = event.target.value;
            setDraftBucketId(nextBucketId);
            queueDraftAutosave({ bucketId: nextBucketId });
          }}
          disabled={!canMutateTask || !isRootTask}
          className={`${TASK_EDITOR_SELECT_CLASS} disabled:cursor-not-allowed disabled:opacity-60`}
          data-testid="task-overview-bucket-select"
        >
          {bucketOptions.map((bucket) => (
            <option key={bucket.id} value={bucket.id}>
              {bucket.title}
            </option>
          ))}
        </select>
      </label>
      {canEditSourceFields ? (
        <div
          ref={snoozeMenuRef}
          className="relative min-w-0"
          onKeyDown={(event) => {
            if (event.key !== "Escape" || !isSnoozeMenuOpen) {
              return;
            }

            event.preventDefault();
            event.stopPropagation();
            event.nativeEvent.stopImmediatePropagation();
            setIsSnoozeMenuOpen(false);
          }}
        >
          <button
            type="button"
            onClick={() => setIsSnoozeMenuOpen((current) => !current)}
            className={`${TASK_EDITOR_BUTTON_CLASS} w-full min-w-0 justify-center gap-1.5 whitespace-nowrap px-1.5`}
            aria-expanded={isSnoozeMenuOpen}
            data-testid="task-snooze-button"
          >
            <AlarmClock className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            Snooze
          </button>
          {isSnoozeMenuOpen ? (
            <SnoozeMenu
              draftDate={draftSnoozeDate}
              onDraftDateChange={setDraftSnoozeDate}
              onApplyPreset={(preset) => applySnoozeStart(getSnoozeDateTime(preset))}
              onApplyPickDate={applyPickDateSnooze}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  ) : null;

  const schedulingSection = isExpanded ? (
    <div className="grid min-w-0 gap-1.5" data-testid="task-workspace-scheduling">
      <span className={TASK_EDITOR_LABEL_CLASS}>Schedule</span>
      <div className="task-workspace-scheduling-grid grid min-w-0 gap-2">
        <div className="taskboard-scheduling-panel taskboard-subtle-surface min-w-0 rounded-[12px] border border-border/60 p-2.5">
          <div className="grid gap-2">
            <TaskScheduleFields
              allDay={draftAllDay}
              disabled={!canEditSourceFields}
              endAt={draftEndAt}
              key={task.id}
              onAllDayChange={(nextAllDay, nextStartAt, nextEndAt) => {
                setDraftAllDay(nextAllDay);
                setDraftStartAt(nextStartAt);
                setDraftEndAt(nextEndAt);
                queueDraftAutosave({
                  allDay: nextAllDay,
                  startAt: nextStartAt,
                  endAt: nextEndAt,
                });
              }}
              onEndAtChange={(nextEndAt) => {
                setDraftEndAt(nextEndAt);
                queueDraftAutosave({ endAt: nextEndAt });
              }}
              onStartAtChange={(nextStartAt) => {
                setDraftStartAt(nextStartAt);
                queueDraftAutosave({ startAt: nextStartAt });
              }}
              startAt={draftStartAt}
              testIdPrefix="task-workspace"
            />
            <FlatDisclosureRow
              title={draftRecurrenceEnabled ? "Recurrence" : "Make recurring"}
              detail={draftRecurrenceEnabled ? `${draftRecurrenceFrequency} recurrence` : "No recurrence configured"}
              defaultOpen={Boolean(task.recurrence)}
            >
              <div className="space-y-2">
                <label className="flex items-center gap-2 ed-body font-medium text-foreground">
                  <input
                    type="checkbox"
                    checked={draftRecurrenceEnabled}
                    onChange={(event) => {
                      const nextEnabled = event.target.checked;
                      setDraftRecurrenceEnabled(nextEnabled);
                      queueDraftAutosave({ recurrenceEnabled: nextEnabled });
                    }}
                    disabled={!canMutateTask}
                    className="h-3.5 w-3.5 accent-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  Enabled
                </label>
                {draftRecurrenceEnabled ? (
                  <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-1 xl:grid-cols-3">
                    <label className="block">
                      <span className={TASK_EDITOR_LABEL_CLASS}>Frequency</span>
                      <select
                        value={draftRecurrenceFrequency}
                        onChange={(event) => {
                          const nextFrequency = event.target.value as TaskRecurrenceFrequency;
                          setDraftRecurrenceFrequency(nextFrequency);
                          queueDraftAutosave({ recurrenceFrequency: nextFrequency });
                        }}
                        disabled={!canEditSourceFields}
                        className={`${TASK_EDITOR_SELECT_CLASS} disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                        <option value="monthly">Monthly</option>
                        <option value="weekday">Weekday-only</option>
                        <option value="custom">Every N days</option>
                      </select>
                    </label>
                    <label className="block">
                      <span className={TASK_EDITOR_LABEL_CLASS}>Interval</span>
                      <input
                        type="number"
                        min={1}
                        value={draftRecurrenceInterval}
                        onChange={(event) => {
                          const nextInterval = event.target.value;
                          setDraftRecurrenceInterval(nextInterval);
                          queueDraftAutosave({ recurrenceInterval: nextInterval });
                        }}
                        disabled={!canEditSourceFields || draftRecurrenceFrequency === "weekday"}
                        className={`${TASK_EDITOR_INPUT_CLASS} disabled:cursor-not-allowed disabled:opacity-60`}
                      />
                    </label>
                    <label className="block">
                      <span className={TASK_EDITOR_LABEL_CLASS}>Next occurrence</span>
                      <select
                        value={draftRecurrenceMode}
                        onChange={(event) => {
                          const nextMode = event.target.value as TaskRecurrenceMode;
                          setDraftRecurrenceMode(nextMode);
                          queueDraftAutosave({ recurrenceMode: nextMode });
                        }}
                        disabled={!canEditSourceFields}
                        className={`${TASK_EDITOR_SELECT_CLASS} disabled:cursor-not-allowed disabled:opacity-60`}
                      >
                        <option value="on_schedule">On schedule</option>
                        <option value="after_completion">After completion</option>
                      </select>
                    </label>
                  </div>
                ) : null}
              </div>
            </FlatDisclosureRow>
          </div>
        </div>
        {isRootTask ? (
          <div className="taskboard-scheduling-panel taskboard-subtle-surface min-w-0 rounded-[12px] border border-border/60 p-2.5">
            <FlatDisclosureRow
              title={draftDueAt ? "Due date" : "Add due date"}
              detail={draftDueAt ? "Optional due date configured" : "No due date"}
              defaultOpen={Boolean(draftDueAt)}
            >
              <div className="grid gap-2">
                <label className="block">
                  <span className={TASK_EDITOR_LABEL_CLASS}>Due date</span>
                  <div className="flex min-w-0 flex-wrap gap-1.5">
                    <input
                      type="date"
                      value={draftDueDateTime.date}
                      onChange={(event) => {
                        const nextDueAt = combineDateTimeInput(event.target.value, draftDueDateTime.time);
                        setDraftDueAt(nextDueAt);
                        queueDraftAutosave({ dueAt: nextDueAt });
                      }}
                      disabled={!canMutateTask}
                      className={`${TASK_EDITOR_INPUT_CLASS} task-editor-date-part-input min-w-[9.5rem] flex-[2_1_9.5rem] disabled:cursor-not-allowed disabled:opacity-60`}
                      aria-label="Due date"
                    />
                    <input
                      type="time"
                      value={draftDueDateTime.time}
                      onChange={(event) => {
                        const nextDueAt = combineDateTimeInput(draftDueDateTime.date, event.target.value);
                        setDraftDueAt(nextDueAt);
                        queueDraftAutosave({ dueAt: nextDueAt });
                      }}
                      disabled={!canMutateTask}
                      className={`${TASK_EDITOR_INPUT_CLASS} task-editor-date-part-input min-w-[8rem] flex-[1_1_8rem] disabled:cursor-not-allowed disabled:opacity-60`}
                      aria-label="Due time"
                    />
                  </div>
                </label>
                {draftDueAt ? (
                  <button
                    type="button"
                    onClick={() => {
                      setDraftDueAt("");
                      queueDraftAutosave({ dueAt: "" });
                    }}
                    disabled={!canMutateTask}
                    className={`${TASK_EDITOR_BUTTON_CLASS} w-fit disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    Remove due date
                  </button>
                ) : null}
              </div>
            </FlatDisclosureRow>
            <FlatDisclosureRow
              title={draftReminderOffsetValue !== "none" || draftOverdueReminderEnabled ? "Reminders" : "Add reminders"}
              detail={
                draftReminderOffsetValue !== "none" || draftOverdueReminderEnabled
                  ? "Reminder settings configured"
                  : draftDueAt
                    ? "No reminder configured; reminders can use the due date"
                    : "No reminder configured; reminders use the task start"
              }
              defaultOpen={draftReminderOffsetValue !== "none" || draftOverdueReminderEnabled}
            >
              <div className="grid gap-2">
                <label className="block">
                  <span className={TASK_EDITOR_LABEL_CLASS}>Reminder</span>
                  <select
                    value={draftReminderOffsetValue}
                    onChange={(event) => {
                      const nextReminderOffset = event.target.value;
                      setDraftReminderOffsetValue(nextReminderOffset);
                      queueDraftAutosave({ reminderOffsetValue: nextReminderOffset });
                    }}
                    disabled={!canMutateTask}
                    className={`${TASK_EDITOR_SELECT_CLASS} disabled:cursor-not-allowed disabled:opacity-60`}
                  >
                    {reminderPresetOptions.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex items-center gap-2 pb-0.5 ed-body font-medium text-foreground">
                  <input
                    type="checkbox"
                    checked={draftOverdueReminderEnabled}
                    onChange={(event) => {
                      const nextOverdueEnabled = event.target.checked;
                      setDraftOverdueReminderEnabled(nextOverdueEnabled);
                      queueDraftAutosave({ overdueReminderEnabled: nextOverdueEnabled });
                    }}
                    disabled={!canMutateTask}
                    className="h-3.5 w-3.5 accent-[var(--color-accent)] disabled:cursor-not-allowed disabled:opacity-60"
                  />
                  Overdue reminder
                </label>
              </div>
            </FlatDisclosureRow>
          </div>
        ) : null}
      </div>
    </div>
  ) : null;

  // Subtasks sit at full width under the description. A subtask with a time
  // and work under it reads as a window the work fills.
  const workBreakdownSection = isExpanded ? (
    <WorkBreakdown
      viewerId={viewerId}
      task={task}
      focusTaskId={focusedSubtaskId}
      canEdit={canMutateTask}
      timeZone={displayTimeZone}
      onSaveTask={onSaveTask}
      onPeopleRosterChanged={onPeopleRosterChanged}
      onDeleteTask={canManageTaskLifecycle ? onDeleteTask : undefined}
      onAddSubtask={onAddSubtask}
      onMoveSubtask={onMoveSubtask}
      checklist={checklistSection}
      checklistDetail={
        task.checklist.length > 0
          ? `${task.checklist.filter((item) => item.done).length} of ${task.checklist.length} done`
          : "None yet"
      }
    />
  ) : null;

  const workspaceAttachmentsSection = isExpanded ? (
    <div className="grid min-w-0 gap-1.5" data-testid="task-workspace-files">
      <span className={TASK_EDITOR_LABEL_CLASS}>Files</span>
      {attachmentsSection}
    </div>
  ) : null;

  const expandedAttachmentMenu = isExpanded ? (
    <div ref={attachmentDropdownRef} className="relative">
      <button
        type="button"
        onClick={() => setIsAttachmentDropdownOpen((current) => !current)}
        className={`${TASK_ATTACHMENT_ACTION_BUTTON_CLASS} workspace-attachments-button`}
        aria-label="Task attachments"
        aria-expanded={isAttachmentDropdownOpen}
        data-count={task.attachments.length}
      >
        <Paperclip className="h-3 w-3" />
        {task.attachments.length > 0 ? <span>{task.attachments.length}</span> : null}
      </button>
      {isAttachmentDropdownOpen ? (
        <div className="taskboard-popover absolute right-0 top-9 z-30 w-80 max-w-[calc(100vw-2rem)] rounded-[12px] border p-2">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="ed-strong text-foreground">Attachments</p>
              <p className={TASK_EDITOR_MUTED_TEXT_CLASS}>
                {task.attachments.length > 0
                  ? `${task.attachments.length} file${task.attachments.length === 1 ? "" : "s"} attached`
                  : "No files attached."}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setIsAttachmentDropdownOpen(false)}
              className={TASK_ATTACHMENT_ACTION_BUTTON_CLASS}
              aria-label="Close task attachments"
            >
              <X className="h-3 w-3" />
              Close
            </button>
          </div>
          {task.attachments.length > 0 ? (
            <div className="max-h-72 space-y-1.5 overflow-auto pr-1">
              {task.attachments.map((attachment) => {
                const PreviewIcon = getAttachmentPreviewIcon(attachment.previewKind);
                const isDeletingAttachment = deletingAttachmentId === attachment.id;

                return (
                  <div
                    key={attachment.id}
                    className="rounded-[9px] border border-border/60 px-2 py-1.5"
                  >
                    <div className="flex min-w-0 items-start gap-1.5">
                      <PreviewIcon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted" />
                      <div className="min-w-0 flex-1">
                        <p className="truncate ed-body font-medium text-foreground">
                          {attachment.displayName}
                        </p>
                        <p className={TASK_EDITOR_MUTED_TEXT_CLASS}>
                          {formatFileSize(attachment.sizeBytes)} | Added {formatDate(attachment.createdAt, displayTimeZone)}
                        </p>
                      </div>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1">
                      {attachment.previewKind !== "none" ? (
                        <button
                          type="button"
                          onClick={() => {
                            setPopupPreviewAttachmentId(attachment.id);
                            setIsAttachmentDropdownOpen(false);
                          }}
                          className={TASK_ATTACHMENT_ACTION_BUTTON_CLASS}
                        >
                          <Eye className="h-3 w-3" />
                          View
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => {
                          setIsAttachmentManagerOpen(true);
                          startAttachmentRename(attachment.id, attachment.displayName);
                          setIsAttachmentDropdownOpen(false);
                        }}
                        disabled={!canMutateTask || attachmentsBusy}
                        className={`${TASK_ATTACHMENT_ACTION_BUTTON_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                        <Pencil className="h-3 w-3" />
                        Rename
                      </button>
                      <a
                        href={buildAttachmentHref(attachment.id)}
                        className={TASK_ATTACHMENT_ACTION_BUTTON_CLASS}
                      >
                        <Download className="h-3 w-3" />
                        Download
                      </a>
                      <button
                        type="button"
                        onClick={() => void deleteAttachment(attachment.id)}
                        disabled={!canMutateTask || attachmentsBusy}
                        className={`${TASK_ATTACHMENT_ACTION_BUTTON_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
                      >
                        <Trash2 className="h-3 w-3" />
                        {isDeletingAttachment ? "Deleting..." : "Delete"}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="rounded-[9px] border border-dashed border-border/60 px-2.5 py-2">
              <p className={TASK_EDITOR_MUTED_TEXT_CLASS}>No files attached.</p>
            </div>
          )}
          {attachmentsEnabled && canMutateTask ? (
            <button
              type="button"
              onClick={() => {
                setIsAttachmentManagerOpen(true);
                setIsAttachmentDropdownOpen(false);
              }}
              className={`${TASK_ATTACHMENT_ACTION_BUTTON_CLASS} mt-2 w-full`}
            >
              <Upload className="h-3 w-3" />
              Add files
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  ) : null;

  const advancedSection = isExpanded ? (
    <div className="grid min-w-0 gap-1.5">
      <span className={TASK_EDITOR_LABEL_CLASS}>Labels</span>
      <LabelChipEditor
        value={draftLabels}
        disabled={!canMutateTask}
        onChange={setDraftLabels}
        onCommit={(nextLabels) => queueDraftAutosave({ labels: nextLabels })}
      />
      {calendarBehaviorSection ? (
        <FlatDisclosureRow title="Calendar details" detail="Source and sync details" defaultOpen={false}>
          {calendarBehaviorSection}
        </FlatDisclosureRow>
      ) : null}
    </div>
  ) : null;

  const taskHeaderControls = (
    <div className="flex shrink-0 items-center justify-end gap-1" data-testid="task-inspector-header-controls">
      {!isExpanded ? (
        <button
          type="button"
          onClick={onExpand}
          className={ICON_BUTTON_CLASS}
          aria-label="Expand detail panel"
        >
          <Maximize2 className="h-3 w-3" />
        </button>
      ) : null}

      {!isArchived ? <div className="relative">
        <button
          ref={taskMenuButtonRef}
          type="button"
          onClick={() => setIsTaskMenuOpen((current) => !current)}
          className={ICON_BUTTON_CLASS}
          aria-label="Task actions"
        >
          <MoreHorizontal className="h-3 w-3" />
        </button>

        {isTaskMenuOpen ? (
          <FloatingMenuPortal
            editorScale
            isOpen={isTaskMenuOpen}
            anchorRef={taskMenuButtonRef}
            surfaceRef={taskMenuRef}
            preferredWidth={isExpanded ? 240 : 160}
            align="end"
            mobileSheet
            expandedTaskMenu={isExpanded}
            className="taskboard-popover rounded-[12px] border p-1"
          >

            {isExpanded ? (
              <div className="workspace-menu-navigation">
                <button type="button" onClick={() => { setIsTaskMenuOpen(false);onCollapse(); }}>Back to board</button>
                {calendarTaskHref ? <Link href={calendarTaskHref}>View in Calendar</Link> : null}
              </div>
            ) : null}
            {isExpanded ? (
              <div className="mb-1 grid gap-2 border-b border-border/60 px-1 pb-2">
                <p className={TASK_EDITOR_LABEL_CLASS}>Appearance</p>
                {/* Task color picker hidden: cards show status, not task color. */}
                <div className="grid grid-cols-2 gap-2">
                  <label className="block min-w-0">
                    <span className={TASK_EDITOR_LABEL_CLASS}>Icon</span>
                    {!canMutateTask ? (
                      <WorkspaceMetaLine label="Current" value={draftIcon} />
                    ) : (
                      <IconDropdown
                        value={draftIcon}
                        onChange={(nextIcon) => {
                          setDraftIcon(nextIcon);
                          queueDraftAutosave({ icon: nextIcon });
                        }}
                        options={taskIconOptions}
                      />
                    )}
                  </label>
                </div>
              </div>
            ) : null}
            {!isExpanded ? (
              <button
                type="button"
                onClick={() => {
                  onExpand();
                  setIsTaskMenuOpen(false);
                }}
                className={TASK_EDITOR_MENU_ITEM_CLASS}
              >
                <Bell className="h-3 w-3" />
                Add Reminder
              </button>
            ) : null}
            {!isExpanded ? (
              <button
                type="button"
                onClick={() => {
                  onExpand();
                  setIsTaskMenuOpen(false);
                }}
                className={TASK_EDITOR_MENU_ITEM_CLASS}
              >
                <CalendarClock className="h-3 w-3" />
                Open Scheduling
              </button>
            ) : null}
            <EditorTaskActionItems
              task={task}
              isRootTask={isRootTask}
              isArchived={isArchived}
              canEditBoard={canEditBoard}
              canManageLifecycle={canManageTaskLifecycle}
              onPromote={() => queueAutosave({ ...buildDraftTaskPatch(), promoteToMaintenanceOutage: true }, "action")}
              onArchive={() => void onArchiveTask(task.id)}
              onDelete={() => void onDeleteTask(task.id)}
              onDone={() => setIsTaskMenuOpen(false)}
            />
          </FloatingMenuPortal>
        ) : null}
      </div> : null}
      {isExpanded && publicSharesEnabled && !isArchived ? <TaskWorkspaceSharing taskId={task.id} title={task.title} className={ICON_BUTTON_CLASS}/> : null}
      {isExpanded ? (
        <SurfaceCloseButton onClick={onCollapse} label="Close expanded task detail" />
      ) : (
        <SurfaceCloseButton onClick={onCloseInspector} label="Close task inspector" />
      )}
    </div>
  );

  const attachmentPreviewPopup =
    popupPreviewAttachment && typeof document !== "undefined"
      ? createPortal(
          <div
            className="taskboard-shell fixed inset-0 z-[70] flex items-center justify-center p-3 sm:p-4"
            data-editor-scale="true"
            role="dialog"
            aria-modal="true"
            aria-label={`Preview ${popupPreviewAttachment.displayName}`}
            onPointerDownCapture={(event) => {
              event.stopPropagation();
            }}
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setPopupPreviewAttachmentId(null);
            }}
          >
            <div className="pointer-events-none absolute inset-0 bg-black/45" aria-hidden="true" />
            <div
              className="taskboard-popover relative z-10 flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-[16px] border shadow-2xl"
              onPointerDownCapture={(event) => {
                event.stopPropagation();
              }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-center justify-between gap-2 border-b border-border/70 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate ed-strong text-foreground">
                    {popupPreviewAttachment.displayName}
                  </p>
                  <p className={TASK_EDITOR_MUTED_TEXT_CLASS}>
                    {popupPreviewAttachment.previewKind === "pdf" ? "PDF preview" : "Image preview"}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <a
                    href={buildAttachmentHref(popupPreviewAttachment.id)}
                    className={TASK_ATTACHMENT_ACTION_BUTTON_CLASS}
                  >
                    <Download className="h-3 w-3" />
                    Download
                  </a>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      setPopupPreviewAttachmentId(null);
                    }}
                    className={TASK_ATTACHMENT_ACTION_BUTTON_CLASS}
                    aria-label="Close attachment preview"
                  >
                    <X className="h-3 w-3" />
                    Close
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto bg-background p-3">
                {popupPreviewAttachment.previewKind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={buildAttachmentHref(popupPreviewAttachment.id, "inline")}
                    alt={popupPreviewAttachment.displayName}
                    className="mx-auto max-h-[78vh] max-w-full rounded-[10px] border border-border/60 bg-background object-contain"
                  />
                ) : popupPreviewAttachment.previewKind === "pdf" ? (
                  <iframe
                    src={buildAttachmentHref(popupPreviewAttachment.id, "inline")}
                    title={popupPreviewAttachment.displayName}
                    className="h-[78vh] w-full rounded-[10px] border border-border/60 bg-background"
                  />
                ) : null}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
    {confirmDialog}
    <div
      className="task-editor-root flex h-full min-h-0 flex-col"
      data-editor-mode={isExpanded ? "expanded" : "sidebar"}
      data-testid="task-editor"
    >
      <div
        className={`border-b border-border/70 ${
          isExpanded ? "task-workspace-header" : "px-2 py-1.5"
        }`}
      >
        <div
          className={`flex min-w-0 outline-none ${isExpanded ? "items-center" : "items-start gap-0"}`}
          data-testid="task-inspector-header"
          data-task-menu-target={isArchived ? undefined : task.id}
          tabIndex={isArchived ? undefined : -1}
        >
          <span
            className="task-workspace-header-icon hidden mt-0.5 shrink-0 items-center justify-center rounded-[13px]"
            style={{ backgroundColor: `${task.color}22`, color: task.color }}
          >
            <Icon className="h-3 w-3" />
          </span>
          <div className="min-w-0 flex-1">
            {isExpanded ? (
              // One line: title, status, what it is and when, then actions.
              <div className="workspace-header-row" data-testid="task-overview-section">
                {workspaceTitleControl}
                {isArchived ? <TaskEditorStatusBadge isArchived={isArchived} status={task.status} /> : workspaceStatusControl}
                <div className="workspace-chips">
                  {task.importedFrom ? (
                    <span className="workspace-chip">{getImportedProviderDisplayLabel(task)}</span>
                  ) : null}
                  {isStaleImport && !isReadOnlyImport ? (
                    <span className="workspace-chip" data-tone="muted">Stale</span>
                  ) : null}
                  {currentBucketTitle ? <span className="workspace-chip">{currentBucketTitle}</span> : null}
                  {workspaceDateLabel ? (
                    <span className="workspace-chip tabular-nums" data-testid="task-workspace-date-chip">{workspaceDateLabel}</span>
                  ) : null}
                  {subtaskStats.total > 0 ? (
                    <span className="workspace-chip tabular-nums" data-tone="muted">
                      {subtaskStats.done} of {subtaskStats.total} done
                    </span>
                  ) : null}
                </div>
                <div className="workspace-header-actions">
                  <TaskAutosaveIndicator state={autosaveState} />
                  {calendarTaskHref ? (
                    <Link
                      aria-label={`View ${task.title} in Calendar`}
                      title="View in Calendar"
                      className={ICON_BUTTON_CLASS}
                      data-testid="task-inspector-view-calendar"
                      href={calendarTaskHref}
                    >
                      <CalendarDays className="h-3 w-3" />
                    </Link>
                  ) : null}
                  {expandedAttachmentMenu}
                  {taskHeaderControls}
                </div>
              </div>
            ) : (
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex min-w-0 items-start justify-between gap-1.5">
                  <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5" data-testid="task-inspector-chips">
                    <span
                      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-[13px]"
                      style={{ backgroundColor: `${task.color}22`, color: task.color }}
                    >
                      <Icon className="h-3 w-3" />
                    </span>
                    <TaskEditorStatusBadge isArchived={isArchived} status={task.status} />
                    {task.importedFrom ? (
                      <span className="taskboard-label-chip ed-chip rounded-full">
                        {getImportedProviderDisplayLabel(task)}
                      </span>
                    ) : null}
                    {isStaleImport && !isReadOnlyImport ? (
                      <span className="taskboard-label-chip taskboard-label-chip-muted ed-chip rounded-full">
                        Stale
                      </span>
                    ) : null}
                  </div>
                  {taskHeaderControls}
                </div>
                <TaskAutosaveIndicator state={autosaveState} />
                <h2 className="sr-only">Task title</h2>
                <label className="block min-w-0" data-testid="task-inspector-title">
                  <span className="sr-only">Title</span>
                  {!canEditSourceFields ? (
                    <h2 className="min-w-0 break-words ed-title text-foreground">
                      {isReadOnlyImport ? <SafeLinkifiedText text={task.title} /> : task.title}
                    </h2>
                  ) : (
                    <textarea
                      value={draftTitle}
                      onChange={(event) => setDraftTitle(event.target.value)}
                      onBlur={flushTextAutosave}
                      rows={2}
                      className={TASK_EDITOR_TITLE_INPUT_CLASS}
                      data-testid="task-inspector-title-input"
                    />
                  )}
                </label>
                <div className={`flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 ${TASK_EDITOR_MUTED_TEXT_CLASS}`}>
                  <span className="min-w-0 truncate">{currentBucketTitle}</span>
                  {task.dueAt ? <span className="shrink-0">Due {formatDate(task.dueAt, displayTimeZone)}</span> : null}
                </div>
                {calendarTaskHref ? (
                  <Link
                    aria-label={`View ${task.title} in Calendar`}
                    className={`${TASK_ATTACHMENT_ACTION_BUTTON_CLASS} w-fit`}
                    data-testid="task-inspector-view-calendar"
                    href={calendarTaskHref}
                  >
                    <CalendarDays className="h-3 w-3" />
                    View in Calendar
                  </Link>
                ) : null}
              </div>
            )}

          </div>
        </div>
      </div>

      <div
        className={
          isExpanded
            ? "task-workspace-body min-h-0 flex flex-1 flex-col overflow-hidden"
            : "min-h-0 flex-1 overflow-visible px-2 py-1.5"
        }
      >
        {isExpanded ? (
          <>
          <TaskWorkspaceLayout
            key={task.id}
            work={
              <>
                {workBreakdownSection}
              </>
            }
            workingNotes={workingNotesSection}
            notes={
              <>
                <TaskLinkedNotes
                  taskId={task.id}
                  boardId={activeBoardId}
                  bucketId={currentBucketId}
                  canEdit={canEditBoard}
                  enabled={attachmentsEnabled}
                />
              </>
            }
            details={
              <>
                {primaryNoteSection}
                {workspaceNoticeSection}
                {workspaceBucketSection}
                {schedulingSection}
                {task.workItemType === "maintenance_outage" ? (
                  <MaintenanceOutageFields
                    task={task}
                    locations={maintenanceLocations}
                    disabled={!canMutateTask}
                    compact
                    onSave={(maintenanceOutage) =>
                      queueAutosave({ ...buildDraftTaskPatch(), maintenanceOutage })
                    }
                    onCreateLocation={onCreateMaintenanceLocation}
                  />
                ) : null}
                {advancedSection}
              </>
            }
            files={workspaceAttachmentsSection}
            notesCount={task.notes.length}
            filesCount={task.attachments.length}
          />
          </>
        ) : (
          <div className="space-y-1.5">
            {isReadOnlyImport && importedSidebarSection ? (
              importedSidebarSection
            ) : (
              <>
                {sidebarQuickEditSection}
                {sidebarRowsSection}
              </>
            )}
          </div>
        )}
      </div>
    </div>
    {attachmentPreviewPopup}

    </>
  );
}


function FlatDisclosureRow({
  title,
  detail,
  children,
  defaultOpen = false,
  open,
  onOpenChange,
}: {
  title: string;
  detail?: string;
  children: ReactNode;
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const [internalIsOpen, setInternalIsOpen] = useState(defaultOpen);
  const isOpen = open ?? internalIsOpen;

  return (
    <details
      className="min-w-0 border-t border-border/50 pt-1.5 first:border-t-0 first:pt-0"
      open={isOpen}
      onToggle={(event) => {
        const nextOpen = event.currentTarget.open;
        if (open === undefined) {
          setInternalIsOpen(nextOpen);
        }
        onOpenChange?.(nextOpen);
      }}
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-[8px] py-1 ed-strong text-foreground">
        <span>{title}</span>
        {detail ? <span className={`font-normal ${TASK_EDITOR_MUTED_TEXT_CLASS}`}>{detail}</span> : null}
      </summary>
      <div className="mt-1.5 min-w-0">{children}</div>
    </details>
  );
}

function FlatEmptyState({
  text,
  actionLabel,
  onAction,
}: {
  text: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-[8px] border border-dashed border-border/50 px-2 py-1.5">
      <p className={TASK_EDITOR_MUTED_TEXT_CLASS}>{text}</p>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction} className={TASK_EDITOR_INLINE_BUTTON_CLASS}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}

function WorkspaceMetaLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-baseline justify-between gap-2 border-t border-border/40 py-1 first:border-t-0">
      <span className={TASK_EDITOR_MUTED_TEXT_CLASS}>{label}</span>
      <span className="min-w-0 truncate ed-body font-medium text-foreground">{value}</span>
    </div>
  );
}

function TaskInspectorEmptyState({
  emptyStateNewTaskBucket,
  focusView,
  todayView,
  canEditBoard,
  onCloseInspector,
  onCreateTask,
  onOpenView,
}: {
  emptyStateNewTaskBucket: { id: string; title: string } | null;
  focusView: ViewPreset | null;
  todayView: ViewPreset | null;
  canEditBoard: boolean;
  onCloseInspector: () => void;
  onCreateTask: (bucketId: string, title: string) => Promise<boolean>;
  onOpenView: (viewId: string) => void;
}) {
  const [draftTitle, setDraftTitle] = useState("");
  const canCreateTask = canEditBoard && Boolean(emptyStateNewTaskBucket);

  const submitTask = async () => {
    const title = draftTitle.trim();
    if (!canCreateTask || !title || !emptyStateNewTaskBucket) {
      return;
    }

    if (await onCreateTask(emptyStateNewTaskBucket.id, title)) {
      setDraftTitle("");
    }
  };

  return (
    <div
      className="task-editor-root flex h-full min-h-0 flex-col"
      data-testid="task-editor"
    >
      <div className="flex items-center justify-between gap-2 border-b border-border/70 px-2 py-2">
        <div className="min-w-0">
          <p className="ed-strong text-foreground">Task inspector</p>
          <p className={TASK_EDITOR_MUTED_TEXT_CLASS}>No task selected.</p>
        </div>
        <div className="flex items-center gap-1.5">
          <SurfaceCloseButton onClick={onCloseInspector} label="Close task inspector" />
        </div>
      </div>
      <div className="pretty-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto p-2">
        <SectionCard title="Quick start">
          <div className="space-y-2">
            <p className={TASK_EDITOR_MUTED_TEXT_CLASS}>
              Select a card to inspect it, or create a task in the current visible view.
            </p>
            <input
              value={draftTitle}
              onChange={(event) => setDraftTitle(event.target.value)}
              onKeyDown={(event) => {
                handlePlainEnterSubmit(event, submitTask);
              }}
              disabled={!canCreateTask}
              placeholder={
                emptyStateNewTaskBucket
                  ? `New task in ${emptyStateNewTaskBucket.title}`
                  : "No visible bucket available"
              }
              className={`${TASK_EDITOR_INPUT_CLASS} placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60`}
            />
            {!canEditBoard ? (
              <p
                className={TASK_EDITOR_MUTED_TEXT_CLASS}
                data-testid="task-inspector-read-only-note"
              >
                Read-only board. Task creation is disabled for viewer access.
              </p>
            ) : !canCreateTask ? (
              <p className={TASK_EDITOR_MUTED_TEXT_CLASS}>
                No visible buckets in this view. Change filters or open the board view to create a task.
              </p>
            ) : null}
            <button
              type="button"
              onClick={submitTask}
              disabled={!canCreateTask || !draftTitle.trim()}
              className={`${TASK_EDITOR_BUTTON_CLASS} ui-button-primary w-full justify-center disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <Plus className="h-3 w-3" />
              New Task
            </button>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {focusView ? (
                <button
                  type="button"
                  onClick={() => onOpenView(focusView.id)}
                  className={`${TASK_EDITOR_INLINE_BUTTON_CLASS} justify-center`}
                >
                  Open Focus
                </button>
              ) : null}
              {todayView ? (
                <button
                  type="button"
                  onClick={() => onOpenView(todayView.id)}
                  className={`${TASK_EDITOR_INLINE_BUTTON_CLASS} justify-center`}
                >
                  Open Today
                </button>
              ) : null}
            </div>
          </div>
        </SectionCard>
      </div>
    </div>
  );
}

function QuickInspectorRow({
  title,
  detail,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  detail: string;
  actionLabel?: string;
  onAction?: () => void;
  children?: ReactNode;
}) {
  return (
    <div className="taskboard-inspector-row w-full min-w-0 border-t border-border/30 px-0 py-2 first:border-t-0">
      <div className="flex min-w-0 items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="ed-strong text-foreground">{title}</p>
          <p className={`truncate ${TASK_EDITOR_MUTED_TEXT_CLASS}`}>{detail}</p>
        </div>
        {actionLabel && onAction ? (
          <button type="button" onClick={onAction} className={`${TASK_EDITOR_INLINE_BUTTON_CLASS} shrink-0`}>
            {actionLabel}
          </button>
        ) : null}
      </div>
      {children ? <div className="mt-1.5">{children}</div> : null}
    </div>
  );
}

function WorkingNotesInspectorRow({
  notes,
}: {
  notes: TaskNote[];
}) {
  return (
    <div className="taskboard-inspector-row w-full min-w-0 border-t border-border/30 px-0 py-2 first:border-t-0">
      <div className="flex min-w-0 items-baseline justify-between gap-2">
        <span className={TASK_EDITOR_LABEL_CLASS}>Working Notes</span>
        {notes.length > 0 ? (
          <span className={`truncate ${TASK_EDITOR_MUTED_TEXT_CLASS}`}>
            {formatWorkingNotesSummary(notes)}
          </span>
        ) : null}
      </div>
      <div className="mt-1.5">
        <TaskWorkingNotesPreview
          notes={notes}
          emptyText="No working notes yet."
          compact
        />
      </div>
    </div>
  );
}

function PrimaryNoteEditor({
  value,
  onChange,
  onBlur,
  disabled,
  rows = 2,
  minHeightClassName = "min-h-[60px]",
  resizeClassName = "resize-none",
  dataTestId,
  showLabel = true,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur: () => void;
  disabled?: boolean;
  rows?: number;
  minHeightClassName?: string;
  resizeClassName?: string;
  dataTestId?: string;
  showLabel?: boolean;
}) {
  return (
    <label className="block min-w-0" data-testid="task-primary-note-field">
      {showLabel ? (
        <span className="mb-1 flex min-w-0 items-center justify-between gap-2">
          <span className={TASK_EDITOR_LABEL_CLASS}>Description</span>
        </span>
      ) : null}
      <textarea
        aria-label="Task description"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={onBlur}
        disabled={disabled}
        rows={rows}
        placeholder="Describe the task, goal, or current working context."
        className={`${TASK_EDITOR_INPUT_CLASS} ${minHeightClassName} ${resizeClassName} overflow-x-hidden py-1 placeholder:text-muted disabled:cursor-not-allowed disabled:opacity-60`}
        data-testid={dataTestId}
      />
    </label>
  );
}

function ChecklistPreview({
  items,
  moreCount,
}: {
  items: ChecklistItem[];
  moreCount: number;
}) {
  if (items.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1" data-testid="task-inspector-checklist-preview">
      {items.map((item) => (
        <div key={item.id} className="flex min-w-0 items-center gap-1.5">
          <span
            className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border text-[8px] ${
              item.done
                ? "border-accent bg-accent/15 text-accent"
                : "border-border/70 text-muted"
            }`}
            aria-hidden="true"
          >
            {item.done ? <Check className="h-2.5 w-2.5" /> : null}
          </span>
          <span className={`min-w-0 truncate ed-meta ${item.done ? "text-muted line-through" : "text-foreground"}`}>
            {item.label}
          </span>
        </div>
      ))}
      {moreCount > 0 ? (
        <p className={TASK_EDITOR_MUTED_TEXT_CLASS}>+ {moreCount} more</p>
      ) : null}
    </div>
  );
}

function TaskWorkingNotesPreview({
  notes,
  emptyText,
  compact = false,
}: {
  notes: TaskNote[];
  emptyText: string;
  compact?: boolean;
}) {
  const displayTimeZone = useDisplayTimeZone();
  const orderedNotes = getWorkingNotesOldestFirst(notes);
  const previewNote = compact ? orderedNotes[orderedNotes.length - 1] : orderedNotes[0];
  if (!previewNote) {
    return <p className={TASK_EDITOR_MUTED_TEXT_CLASS}>{emptyText}</p>;
  }

  if (!compact) {
    return (
      <div className="space-y-1.5" data-testid="task-inspector-notes-preview">
        {orderedNotes.map((note) => (
          <article key={note.id} className="rounded-[8px] border border-border/50 px-2 py-1.5">
            <p className="whitespace-pre-wrap ed-meta text-foreground">
              {note.body}
            </p>
            <p className={TASK_EDITOR_MUTED_TEXT_CLASS}>
              {note.authorName} | {formatDate(note.createdAt, displayTimeZone)}
              {note.updatedAt ? ` | Edited ${formatDate(note.updatedAt, displayTimeZone)}` : ""}
            </p>
          </article>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-1" data-testid="task-inspector-notes-preview">
      <p className="line-clamp-2 whitespace-pre-line ed-meta text-foreground">
        {previewNote.body}
      </p>
      <p className={TASK_EDITOR_MUTED_TEXT_CLASS}>
        Latest by {previewNote.authorName} on {formatDate(previewNote.createdAt, displayTimeZone)}
      </p>
    </div>
  );
}

function formatWorkingNotesSummary(notes: TaskNote[]) {
  if (notes.length === 0) {
    return "No working notes";
  }

  return `${notes.length} note${notes.length === 1 ? "" : "s"}`;
}

function getTaskPrimaryNoteDraftValue(task: Task) {
  return task.primaryNote?.body ?? task.summary;
}

function getTaskSummaryPreview(task: Task) {
  return getTaskPrimaryNoteDraftValue(task).trim();
}

function getWorkingNoteCreatedTime(note: TaskNote) {
  const createdTime = new Date(note.createdAt).getTime();
  return Number.isFinite(createdTime) ? createdTime : 0;
}

function getWorkingNotesOldestFirst(notes: TaskNote[]) {
  return [...notes].sort((left, right) => {
    const createdCompare =
      getWorkingNoteCreatedTime(left) - getWorkingNoteCreatedTime(right);
    return createdCompare === 0 ? left.id.localeCompare(right.id) : createdCompare;
  });
}

function SubtaskPreview({
  tasks,
  moreCount,
}: {
  tasks: Task[];
  moreCount: number;
}) {
  if (tasks.length === 0) {
    return null;
  }

  return (
    <div className="space-y-1" data-testid="task-inspector-subtask-preview">
      {tasks.map((subtask) => (
        <div key={subtask.id} className="flex min-w-0 items-center gap-1.5">
          <span
            className="shrink-0 rounded-full border border-border/60 px-1.5 py-0.5 ed-meta font-medium text-muted"
          >
            {formatStatusLabel(subtask.status)}
          </span>
          <span className="min-w-0 truncate ed-meta text-foreground">
            {subtask.title}
          </span>
        </div>
      ))}
      {moreCount > 0 ? (
        <p className={TASK_EDITOR_MUTED_TEXT_CLASS}>+ {moreCount} more</p>
      ) : null}
    </div>
  );
}

function formatStatusLabel(status: TaskStatus) {
  switch (status) {
    case "active":
      return "Active";
    case "waiting":
      return "Waiting";
    case "done":
      return "Done";
    case "todo":
    default:
      return "Todo";
  }
}

function SnoozeMenu({
  draftDate,
  onDraftDateChange,
  onApplyPreset,
  onApplyPickDate,
}: {
  draftDate: string;
  onDraftDateChange: (value: string) => void;
  onApplyPreset: (preset: SnoozePreset) => void;
  onApplyPickDate: () => void;
}) {
  return (
    <div className="taskboard-popover absolute right-0 top-7 z-20 w-full rounded-[12px] border p-1.5">
      <div className="grid gap-1">
        {snoozePresetOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onApplyPreset(option.value)}
            className={TASK_EDITOR_MENU_ITEM_CLASS}
          >
            {option.label}
          </button>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <input
          type="date"
          value={draftDate}
          onChange={(event) => onDraftDateChange(event.target.value)}
          className={`${TASK_EDITOR_INPUT_CLASS} task-editor-date-part-input`}
          aria-label="Pick snooze date"
        />
        <button
          type="button"
          onClick={onApplyPickDate}
          disabled={!draftDate}
          className={`${TASK_EDITOR_INLINE_BUTTON_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          Pick
        </button>
      </div>
    </div>
  );
}

function ImportedEventInspector({
  task,
  attachmentCount,
  canEditBoard,
  calendarTaskHref,
  onExpand,
  onConvert,
  onCreateFollowUp,
  onHide,
}: {
  task: Task;
  attachmentCount: number;
  canEditBoard: boolean;
  calendarTaskHref: string | null;
  onExpand: () => void;
  onConvert: () => void;
  onCreateFollowUp: () => void;
  onHide: () => void;
}) {
  const displayTimeZone = useDisplayTimeZone();
  const providerLabel = getImportedProviderDisplayLabel(task);

  return (
    <div className="space-y-1.5">
      <button
        type="button"
        onClick={onExpand}
        className={`${TASK_EDITOR_BUTTON_CLASS} ui-button-primary w-full justify-center`}
        data-testid="task-inspector-open-workspace"
      >
        Open Task Workspace
      </button>
      <SectionCard title="Event details">
        <div className="space-y-2">
          <div>
            <p className="ed-title text-foreground">
              <SafeLinkifiedText text={task.title} />
            </p>
            <p className={TASK_EDITOR_MUTED_TEXT_CLASS}>
              {task.startAt
                ? task.endAt
                  ? `${formatDate(task.startAt, displayTimeZone)} - ${formatDate(task.endAt, displayTimeZone)}`
                  : formatDate(task.startAt, displayTimeZone)
                : task.endAt
                  ? formatDate(task.endAt, displayTimeZone)
                  : task.dueAt
                    ? formatDate(task.dueAt, displayTimeZone)
                    : "No event time"}
            </p>
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2">
            <MetaTile label="Source" value={providerLabel} />
            <MetaTile
              label="Sync"
              value={task.importedFrom?.syncStatus ?? "active"}
            />
            <MetaTile label="Recurring" value={task.importedFrom?.isRecurring ? "Rolling" : "No"} />
            <MetaTile label="Attachments" value={`${attachmentCount} local file${attachmentCount === 1 ? "" : "s"}`} />
          </div>
          {getTaskSummaryPreview(task) ? (
            <p className={`whitespace-pre-line ${TASK_EDITOR_MUTED_TEXT_CLASS}`}>
              <SafeLinkifiedText text={getTaskSummaryPreview(task)} />
            </p>
          ) : null}
        </div>
      </SectionCard>
      <div className="grid gap-1.5">
        {!canEditBoard ? (
          <p className={TASK_EDITOR_MUTED_TEXT_CLASS}>
            Read-only board. Import actions that create or move tasks are disabled.
          </p>
        ) : null}
        <button
          type="button"
          onClick={onCreateFollowUp}
          disabled={!canEditBoard}
          className={`${TASK_EDITOR_INLINE_BUTTON_CLASS} justify-center disabled:cursor-not-allowed disabled:opacity-50`}
        >
          Create follow-up task
        </button>
        {task.importedFrom?.convertToTask ? (
          <button
            type="button"
            onClick={onConvert}
            disabled={!canEditBoard}
            className={`${TASK_EDITOR_INLINE_BUTTON_CLASS} justify-center disabled:cursor-not-allowed disabled:opacity-50`}
          >
            Convert to task
          </button>
        ) : null}
        {calendarTaskHref ? (
          <Link
            aria-label={`View ${task.title} in Calendar`}
            className={`${TASK_EDITOR_INLINE_BUTTON_CLASS} justify-center`}
            data-testid="task-inspector-view-calendar"
            href={calendarTaskHref}
          >
            <CalendarDays className="h-3 w-3" />
            View in Calendar
          </Link>
        ) : null}
        <button
          type="button"
          onClick={onHide}
          disabled={!canEditBoard}
          className={`${TASK_EDITOR_INLINE_BUTTON_CLASS} justify-center disabled:cursor-not-allowed disabled:opacity-50`}
        >
          Move import to recycle bin
        </button>
      </div>
    </div>
  );
}

function ChecklistItemEditor({
  item,
  canEditBoard,
  onUpdate,
  onDelete,
}: {
  item: ChecklistItem;
  canEditBoard: boolean;
  onUpdate: (
    itemId: string,
    patch: { label?: string; done?: boolean },
  ) => void | Promise<void>;
  onDelete: (itemId: string) => void | Promise<void>;
}) {
  const [draftLabel, setDraftLabel] = useState(item.label);
  const [isEditing, setIsEditing] = useState(false);

  const saveLabel = async () => {
    if (!canEditBoard) {
      setDraftLabel(item.label);
      setIsEditing(false);
      return;
    }

    const label = draftLabel.trim();

    if (!label) {
      setDraftLabel(item.label);
      setIsEditing(false);
      return;
    }

    if (label !== item.label) {
      await onUpdate(item.id, { label });
    }

    setIsEditing(false);
  };

  return (
    <div className="flex items-center gap-1">
      <span className="work-checklist-target">
      <button
        type="button"
        onClick={() => void onUpdate(item.id, { done: !item.done })}
        disabled={!canEditBoard}
        className={`work-checklist-toggle flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded-full border ${
          item.done ? "border-emerald-600 bg-emerald-600 text-white" : "border-border text-transparent"
        } disabled:cursor-not-allowed disabled:opacity-50`}
        aria-label={item.done ? "Mark checklist item not done" : "Mark checklist item done"}
        aria-pressed={item.done}
      >
        {item.done ? <Check className="h-2.5 w-2.5" /> : null}
      </button>
      </span>
      {isEditing ? (
        <input
          autoFocus
          value={draftLabel}
          onChange={(event) => setDraftLabel(event.target.value)}
          onBlur={() => void saveLabel()}
          onKeyDown={(event) => {
            if (handlePlainEnterSubmit(event, () => void saveLabel())) {
              return;
            }

            if (event.key === "Escape") {
              setDraftLabel(item.label);
              setIsEditing(false);
            }
          }}
          disabled={!canEditBoard}
          className={`${TASK_EDITOR_INLINE_INPUT_CLASS} disabled:cursor-not-allowed disabled:opacity-60`}
        />
      ) : (
        <button
          type="button"
          onClick={() => setIsEditing(true)}
          disabled={!canEditBoard}
          className={`min-w-0 flex-1 text-left ${TASK_EDITOR_ITEM_TEXT_CLASS} ${
            item.done ? "text-muted line-through" : "text-foreground"
          } disabled:cursor-not-allowed`}
        >
          {item.label}
        </button>
      )}
      <button
        type="button"
        onClick={() => void onDelete(item.id)}
        disabled={!canEditBoard}
        className="ui-button ui-button-surface rounded-full border p-0.5 text-muted transition hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
        aria-label="Delete checklist item"
      >
        <Trash2 className="h-2.5 w-2.5" />
      </button>
    </div>
  );
}


function getAgendaTimestamp(...values: Array<string | undefined>) {
  for (const value of values) {
    if (!value) {
      continue;
    }

    const timestamp = new Date(value).getTime();

    if (Number.isFinite(timestamp)) {
      return timestamp;
    }
  }

  return Number.POSITIVE_INFINITY;
}

function formatAgendaDateRange(
  displayTimeZone: string,
  startAt?: string,
  endAt?: string,
  allDay = false,
) {
  const formatValue = (value: string) =>
    allDay ? formatDateOnly(value, displayTimeZone) : formatDate(value, displayTimeZone);
  const prefix = allDay ? "All day | " : "";

  if (startAt && endAt && startAt !== endAt) {
    return `${prefix}${formatValue(startAt)} - ${formatValue(endAt)}`;
  }

  if (startAt) {
    return `${prefix}${formatValue(startAt)}`;
  }

  if (endAt) {
    return `${prefix}${formatValue(endAt)}`;
  }

  return "No scheduled date";
}

function formatTaskAgendaSchedule(task: Task, displayTimeZone: string) {
  if (task.startAt || task.endAt) {
    return formatAgendaDateRange(displayTimeZone, task.startAt, task.endAt, Boolean(task.allDay));
  }

  return task.dueAt ? `Due ${formatDate(task.dueAt, displayTimeZone)}` : "No scheduled date";
}

function buildSourceEventCalendarHref(sourceEvent: TaskboardCalendarSourceEvent) {
  const focusDate = getCalendarFocusDate(sourceEvent.start);

  return focusDate ? `/calendar?date=${encodeURIComponent(focusDate)}` : "/calendar";
}

const AgendaPreview = memo(function AgendaPreview({
  board,
  calendarEntries,
  calendarSourceEvents,
  canEdit,
  onMoveOverdueToToday,
  onSelectTask,
}: {
  board: Board;
  calendarEntries: CalendarEntry[];
  calendarSourceEvents: TaskboardCalendarSourceEvent[];
  canEdit: boolean;
  onMoveOverdueToToday: (taskIds: string[]) => void;
  onSelectTask: (taskId: string) => void;
}) {
  const displayTimeZone = useDisplayTimeZone();
  const isClient = useIsClient();
  const nowMinute = useNowMinute();
  const agendaNow = new Date();
  const suppressedImportedTaskIds = useMemo(
    () =>
      new Set(
        calendarSourceEvents
          .filter((sourceEvent) => sourceEvent.data.suppressLinkedTaskEvent)
          .map((sourceEvent) => sourceEvent.data.linkedTaskId)
          .filter((taskId): taskId is string => Boolean(taskId)),
      ),
    [calendarSourceEvents],
  );

  const items = useMemo(
    () =>
      [
        ...board.buckets.flatMap((bucket) =>
          bucket.tasks
            .filter((task) => !suppressedImportedTaskIds.has(task.id))
            .map((task) => ({
              kind: "task" as const,
              task,
              bucketColor: bucket.color,
              bucketTitle: bucket.title,
              timestamp: getAgendaTimestamp(task.startAt, task.endAt, task.dueAt),
            })),
        ),
        ...calendarEntries
          .filter((entry) => !entry.linkedTaskId)
          .map((entry) => ({
            kind: "calendar-entry" as const,
            entry,
            timestamp: getAgendaTimestamp(entry.startAt, entry.endAt),
          })),
        ...calendarSourceEvents.map((sourceEvent) => ({
          kind: "source-event" as const,
          sourceEvent,
          timestamp: getAgendaTimestamp(sourceEvent.start, sourceEvent.end),
        })),
      ],
    [board.buckets, calendarEntries, calendarSourceEvents, suppressedImportedTaskIds],
  );

  // Overdue tasks lead the agenda in their own group, oldest due date first;
  // everything else keeps its time order. "Now" is known only after hydration.
  const overdueTaskIds = useMemo(
    () =>
      new Set(
        nowMinute === null
          ? []
          : items.flatMap((item) =>
              item.kind === "task" && isTaskOverdue(item.task, nowMinute) ? [item.task.id] : [],
            ),
      ),
    [items, nowMinute],
  );
  const isOverdueItem = (item: (typeof items)[number]) =>
    item.kind === "task" && overdueTaskIds.has(item.task.id);
  const visibleItems = useMemo(() => {
    const dueTime = (item: (typeof items)[number]) =>
      item.kind === "task" ? new Date(item.task.dueAt ?? 0).getTime() : 0;
    const overdue = items
      .filter((item) => item.kind === "task" && overdueTaskIds.has(item.task.id))
      .sort((left, right) => dueTime(left) - dueTime(right));
    const rest = items
      .filter((item) => !(item.kind === "task" && overdueTaskIds.has(item.task.id)))
      .sort((left, right) => left.timestamp - right.timestamp);

    return [...overdue, ...rest].slice(0, 50);
  }, [items, overdueTaskIds]);
  const editableOverdueTaskIds = useMemo(
    () =>
      canEdit
        ? items.flatMap((item) =>
            item.kind === "task" &&
            overdueTaskIds.has(item.task.id)
              ? [item.task.id]
              : [],
          )
        : [],
    [canEdit, items, overdueTaskIds],
  );
  const getGroupLabel = (item: (typeof items)[number]) =>
    isOverdueItem(item) ? "Overdue" : getAgendaGroupLabel(item.timestamp, agendaNow);

  return (
    <section className="space-y-1.5">
      {items.length === 0 ? (
        <div className={`taskboard-subtle-surface rounded-[18px] border border-dashed p-4 text-center ${EMPTY_STATE_TEXT_CLASS}`}>
          No tasks, calendar items, or imported source events match this agenda view.
        </div>
      ) : null}
      {visibleItems.map((item, index) => {
        // Date headings need the viewer's local day, so they render after hydration.
        const groupLabel = isClient ? getGroupLabel(item) : null;
        const previousGroupLabel =
          isClient && index > 0 ? getGroupLabel(visibleItems[index - 1]) : null;
        const itemElement = renderAgendaItem(item);

        if (!groupLabel || groupLabel === previousGroupLabel) {
          return itemElement;
        }

        return groupLabel === "Overdue" ? (
          <Fragment key="agenda-group-Overdue">
            <div
              className="taskboard-agenda-overdue-heading flex flex-wrap items-center justify-between gap-2 px-1 pt-2 first:pt-0"
              data-testid="agenda-overdue-heading"
            >
              <h3 className={`${TASK_EDITOR_LABEL_CLASS} taskboard-overdue-text`} data-testid="agenda-group-heading">
                Overdue · {overdueTaskIds.size}
              </h3>
              {editableOverdueTaskIds.length > 0 ? (
                <button
                  type="button"
                  onClick={() => onMoveOverdueToToday(editableOverdueTaskIds)}
                  className={COMPACT_SURFACE_BUTTON_CLASS}
                  data-testid="agenda-move-overdue-today"
                >
                  Move all to today
                </button>
              ) : null}
            </div>
            {itemElement}
          </Fragment>
        ) : (
          <Fragment key={`agenda-group-${groupLabel}`}>
            <h3
              className={`px-1 pt-2 first:pt-0 ${TASK_EDITOR_LABEL_CLASS}`}
              data-testid="agenda-group-heading"
            >
              {groupLabel}
            </h3>
            {itemElement}
          </Fragment>
        );
      })}
      {items.length > visibleItems.length ? (
        <div className={`taskboard-subtle-surface rounded-[16px] border border-dashed px-3 py-2 ${EMPTY_STATE_TEXT_CLASS}`}>
          Showing the first {visibleItems.length} agenda items.
        </div>
      ) : null}
    </section>
  );

  function renderAgendaItem(item: (typeof visibleItems)[number]) {
        if (item.kind === "calendar-entry") {
          const entry = item.entry;
          const focusDate = getCalendarFocusDate(entry.startAt);
          const href = focusDate
            ? `/calendar?boardId=${encodeURIComponent(entry.boardId)}&date=${encodeURIComponent(focusDate)}`
            : `/calendar?boardId=${encodeURIComponent(entry.boardId)}`;

          return (
            <Link
              className="taskboard-section-card flex w-full items-center justify-between gap-3 rounded-[14px] border px-3 py-2 text-left transition"
              href={href}
              key={entry.id}
              style={{
                background: `linear-gradient(90deg, color-mix(in srgb, ${entry.color} 12%, var(--surface-subtle)) 0%, var(--surface-raised) 62%)`,
                borderColor: `color-mix(in srgb, ${entry.color} 30%, var(--border))`,
                borderLeftColor: entry.color,
                borderLeftWidth: "4px",
              }}
            >
              <div className="min-w-0">
                <div className="mb-0.5 flex min-w-0 items-center gap-1.5">
                  <span className="taskboard-label-chip rounded-full px-2 py-0.5 text-[10px] font-medium leading-4">
                    Calendar item
                  </span>
                  <p className="min-w-0 truncate text-[11px] font-medium leading-4 text-muted">
                    {entry.location || "Calendar"}
                  </p>
                </div>
                <p className={AGENDA_TITLE_CLASS}>{entry.title}</p>
                {entry.description ? (
                  <p className={`mt-0.5 line-clamp-2 whitespace-pre-line ${TASK_CARD_BODY_CLASS}`}>
                    {entry.description}
                  </p>
                ) : null}
              </div>
              <div className={AGENDA_BADGE_CLASS}>
                {formatAgendaDateRange(displayTimeZone, entry.startAt, entry.endAt, entry.allDay)}
              </div>
            </Link>
          );
        }

        if (item.kind === "source-event") {
          const sourceEvent = item.sourceEvent;

          return (
            <Link
              className="taskboard-section-card flex w-full items-center justify-between gap-3 rounded-[14px] border px-3 py-2 text-left transition"
              href={buildSourceEventCalendarHref(sourceEvent)}
              key={sourceEvent.id}
              style={{
                background: `linear-gradient(90deg, ${sourceEvent.backgroundColor} 0%, var(--surface-raised) 62%)`,
                borderColor: `color-mix(in srgb, ${sourceEvent.color} 30%, var(--border))`,
                borderLeftColor: sourceEvent.color,
                borderLeftWidth: "4px",
              }}
            >
              <div className="min-w-0">
                <div className="mb-0.5 flex min-w-0 flex-wrap items-center gap-1.5">
                  <span className="taskboard-label-chip rounded-full px-2 py-0.5 text-[10px] font-medium leading-4">
                    {sourceEvent.data.providerLabel}
                  </span>
                  <p className="min-w-0 truncate text-[11px] font-medium leading-4 text-muted">
                    {sourceEvent.location || sourceEvent.data.providerLabel}
                  </p>
                </div>
                <p className={AGENDA_TITLE_CLASS}>{sourceEvent.title}</p>
                {sourceEvent.data.hasRecurrence ? (
                  <p className={`mt-0.5 line-clamp-2 ${TASK_CARD_BODY_CLASS}`}>Recurring</p>
                ) : null}
              </div>
              <div className={AGENDA_BADGE_CLASS}>
                {formatAgendaDateRange(displayTimeZone, sourceEvent.start, sourceEvent.end)}
              </div>
            </Link>
          );
        }

        const { task, bucketColor, bucketTitle } = item;
        const isOverdue = overdueTaskIds.has(task.id);

        return (
          <button
            key={task.id}
            type="button"
            onClick={() => onSelectTask(task.id)}
            data-task-nav={task.id}
            data-overdue={isOverdue ? "true" : undefined}
            className="taskboard-section-card flex w-full items-center justify-between gap-3 rounded-[14px] border px-3 py-2 text-left transition"
            style={{
              background: `linear-gradient(90deg, color-mix(in srgb, ${bucketColor} 14%, var(--surface-subtle)) 0%, var(--surface-raised) 62%)`,
              borderColor: `color-mix(in srgb, ${bucketColor} 34%, var(--border))`,
              borderLeftColor: bucketColor,
              borderLeftWidth: "4px",
            }}
          >
            <div className="min-w-0">
              <div className="mb-0.5 flex min-w-0 items-center gap-1.5">
                <TaskCardStatus status={task.status} />
                {task.importedFrom?.readOnly ? (
                  <span className="taskboard-label-chip rounded-full px-2 py-0.5 text-[10px] font-medium leading-4">
                    {getImportedProviderDisplayLabel(task)}
                  </span>
                ) : null}
                {task.workItemType === "maintenance_outage" ? (
                  <span className="taskboard-label-chip rounded-[6px] px-2 py-0.5 text-[10px] font-semibold leading-4">
                    Outage
                  </span>
                ) : null}
                <p className="min-w-0 truncate text-[11px] font-medium leading-4 text-muted">
                  {task.maintenanceOutage?.locationName || bucketTitle}
                </p>
              </div>
              <p className={AGENDA_TITLE_CLASS}>
                {task.title}
              </p>
              {getTaskSummaryPreview(task) ? (
                <p className={`mt-0.5 line-clamp-2 whitespace-pre-line ${TASK_CARD_BODY_CLASS}`}>
                  {getTaskSummaryPreview(task)}
                </p>
              ) : null}
            </div>
            <div className={`${AGENDA_BADGE_CLASS} ${isOverdue ? "taskboard-overdue-text" : ""}`}>
              {isOverdue && task.dueAt
                ? `Was due ${formatDate(task.dueAt, displayTimeZone)}`
                : formatTaskAgendaSchedule(task, displayTimeZone)}
            </div>
          </button>
        );
  }
}, (prev, next) =>
  prev.board === next.board &&
  prev.calendarEntries === next.calendarEntries &&
  prev.calendarSourceEvents === next.calendarSourceEvents &&
  prev.canEdit === next.canEdit &&
  prev.onMoveOverdueToToday === next.onMoveOverdueToToday,
);

const FocusPreview = memo(function FocusPreview({
  board,
  detailLevel,
  selectedTaskId,
  onSelectTask,
}: {
  board: Board;
  detailLevel: CardDetailLevel;
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
}) {
  const focusTasks = useMemo(
    () =>
      board.buckets.flatMap((bucket) =>
        bucket.tasks.filter((task) => task.status === "active"),
      ),
    [board.buckets],
  );
  const nowMinute = useNowMinute();
  const overdueCount =
    nowMinute === null ? 0 : focusTasks.filter((task) => isTaskOverdue(task, nowMinute)).length;

  return (
    <section className="grid gap-3" data-testid="focus-view">
      <header className="flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
        <h2 className="text-[13px] font-semibold text-foreground">
          Active tasks <span className="text-muted">· {focusTasks.length}</span>
        </h2>
        {overdueCount > 0 ? (
          <span className="taskboard-overdue-text text-[11px] font-semibold" data-testid="focus-overdue-count">
            {overdueCount} overdue
          </span>
        ) : null}
        <p className={`${EMPTY_STATE_TEXT_CLASS} basis-full`}>
          Focus shows every task set to Active. Press 2 on any task, or choose Active in its sidebar, to add it here.
        </p>
      </header>
      {focusTasks.length === 0 ? (
        <div
          className={`taskboard-subtle-surface rounded-[18px] border border-dashed p-4 text-center ${EMPTY_STATE_TEXT_CLASS}`}
          data-testid="focus-empty-state"
        >
          Nothing is active right now. Pick a task on the board and set it to Active to keep it in view here.
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {focusTasks.map((task) => (
            <div key={task.id} className="panel-surface rounded-[22px] p-3.5">
              <TaskCard
                task={task}
                compactCards={false}
                detailLevel={detailLevel}
                isSelected={task.id === selectedTaskId}
                onClick={() => onSelectTask(task.id)}
              />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}, (prev, next) =>
  prev.board === next.board &&
  prev.detailLevel === next.detailLevel &&
  prev.selectedTaskId === next.selectedTaskId,
);

function updateTaskSchedulesInBoard(
  board: Board,
  updates: CalendarTaskScheduleUpdate[],
) {
  const updatesByTaskId = new Map(updates.map((update) => [update.taskId, update]));

  if (updatesByTaskId.size === 0) {
    return board;
  }

  let boardChanged = false;
  const updateTasks = (tasks: Task[]): Task[] => {
    let tasksChanged = false;
    const nextTasks = tasks.map((task) => {
      const schedule = updatesByTaskId.get(task.id);
      const subtasks = updateTasks(task.subtasks);
      const taskChanged = Boolean(schedule) || subtasks !== task.subtasks;

      if (!taskChanged) {
        return task;
      }

      tasksChanged = true;
      return {
        ...task,
        ...(schedule ? { startAt: schedule.startAt, endAt: schedule.endAt } : {}),
        subtasks,
      };
    });

    return tasksChanged ? nextTasks : tasks;
  };
  const buckets = board.buckets.map((bucket) => {
    const tasks = updateTasks(bucket.tasks);

    if (tasks === bucket.tasks) {
      return bucket;
    }

    boardChanged = true;
    return { ...bucket, tasks };
  });

  return boardChanged ? { ...board, buckets } : board;
}

type BoardIndex = {
  taskById: Map<string, Task>;
  parentByTaskId: Map<string, string | null>;
  bucketIdByTaskId: Map<string, string | null>;
  rootTaskIdByTaskId: Map<string, string>;
  rootTaskIdByChecklistItemId: Map<string, string>;
  allLabels: string[];
};

function buildBoardIndex(buckets: Bucket[]): BoardIndex {
  const taskById = new Map<string, Task>();
  const parentByTaskId = new Map<string, string | null>();
  const bucketIdByTaskId = new Map<string, string | null>();
  const rootTaskIdByTaskId = new Map<string, string>();
  const rootTaskIdByChecklistItemId = new Map<string, string>();
  const labels = new Set<string>();

  const visitTask = (
    task: Task,
    parentTaskId: string | null,
    bucketId: string,
    rootTaskId: string,
  ) => {
    taskById.set(task.id, task);
    parentByTaskId.set(task.id, parentTaskId);
    bucketIdByTaskId.set(task.id, bucketId);
    rootTaskIdByTaskId.set(task.id, rootTaskId);

    for (const label of task.labels) {
      labels.add(label);
    }

    for (const checklistItem of task.checklist) {
      rootTaskIdByChecklistItemId.set(checklistItem.id, rootTaskId);
    }

    for (const subtask of task.subtasks) {
      visitTask(subtask, task.id, bucketId, rootTaskId);
    }
  };

  for (const bucket of buckets) {
    for (const task of bucket.tasks) {
      visitTask(task, null, bucket.id, task.id);
    }
  }

  return {
    taskById,
    parentByTaskId,
    bucketIdByTaskId,
    rootTaskIdByTaskId,
    rootTaskIdByChecklistItemId,
    allLabels: Array.from(labels).sort((left, right) => left.localeCompare(right)),
  };
}

function findBucketIdByTaskId(buckets: Bucket[], taskId: string): string | null {
  for (const bucket of buckets) {
    if (bucket.tasks.some((task) => task.id === taskId)) {
      return bucket.id;
    }
  }

  return null;
}

function findBucketById(buckets: Bucket[], bucketId: string) {
  return buckets.find((bucket) => bucket.id === bucketId) ?? null;
}

function getFirstTaskId(buckets: Bucket[]) {
  for (const bucket of buckets) {
    for (const task of bucket.tasks) {
      return task.id;
    }
  }

  return null;
}

function getDefaultBoardViewId(board: Board) {
  return (
    board.views.find((view) => view.id === "view-board")?.id ??
    board.views.find((view) => view.name.trim().toLowerCase() === "board")?.id ??
    board.views[0]?.id ??
    null
  );
}

function getVisibleTaskCountForMode(board: Board, viewMode: ViewMode) {
  if (viewMode === "focus") {
    return board.buckets.reduce(
      (count, bucket) =>
        count + bucket.tasks.filter((task) => task.status === "active").length,
      0,
    );
  }

  return countRootTasksInBuckets(board.buckets);
}

// The card after a root task in its bucket, or the one before it, so the
// selection stays near a card that is removed.
function getNeighborRootTaskId(buckets: Bucket[], taskId: string) {
  for (const bucket of buckets) {
    const index = bucket.tasks.findIndex((task) => task.id === taskId);
    if (index >= 0) {
      return bucket.tasks[index + 1]?.id ?? bucket.tasks[index - 1]?.id ?? null;
    }
  }

  return null;
}

function hasTaskId(buckets: Bucket[], taskId: string) {
  const walk = (tasks: Task[]): boolean =>
    tasks.some((task) => task.id === taskId || walk(task.subtasks));

  return buckets.some((bucket) => walk(bucket.tasks));
}

function createClientBucket(title: string, index: number, collapsed = false): Bucket {
  const palette = [
    { color: "#d97706", icon: "sun" as const },
    { color: "#155e75", icon: "brain" as const },
    { color: "#475569", icon: "inbox" as const },
    { color: "#8b5cf6", icon: "brain" as const },
    { color: "#0891b2", icon: "sun" as const },
    { color: "#65a30d", icon: "inbox" as const },
  ];
  const choice = palette[index % palette.length];

  return {
    id: crypto.randomUUID(),
    title,
    color: choice.color,
    icon: choice.icon,
    collapsed,
    tasks: [],
  };
}

function getViewerTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone;
}

function createClientTask(title: string, index: number): Task {
  const palette = [
    { color: "#0f766e", icon: "rocket" as const },
    { color: "#6366f1", icon: "sparkles" as const },
    { color: "#334155", icon: "calendar" as const },
    { color: "#65a30d", icon: "flag" as const },
    { color: "#0891b2", icon: "message" as const },
  ];
  const choice = palette[index % palette.length];

  return {
    id: crypto.randomUUID(),
    title,
    summary: "",
    nextAction: "",
    status: "todo",
    color: choice.color,
    icon: choice.icon,
    startAt: getStartOfTodayInTimeZone(new Date(), getViewerTimeZone()),
    allDay: true,
    labels: [],
    notes: [],
    checklist: [],
    attachments: [],
    subtasks: [],
  };
}

function createClientSubtask(title: string): Task {
  return {
    id: crypto.randomUUID(),
    title,
    summary: "",
    nextAction: "",
    status: "todo",
    color: "#64748b",
    icon: "layers",
    labels: [],
    notes: [],
    checklist: [],
    attachments: [],
    subtasks: [],
  };
}

function createClientTaskNote(body: string, authorName: string): TaskNote {
  return {
    id: crypto.randomUUID(),
    body: body.trim(),
    createdAt: new Date().toISOString(),
    authorName,
    attachments: [],
  };
}

function updateBucketInBoard(
  board: Board,
  bucketId: string,
  patch: Partial<Pick<Bucket, "title" | "collapsed" | "color" | "icon">>,
) {
  return {
    ...board,
    buckets: board.buckets.map((bucket) =>
      bucket.id === bucketId ? { ...bucket, ...patch } : bucket,
    ),
  };
}

function removeBucketFromBoard(board: Board, bucketId: string) {
  return {
    ...board,
    buckets: board.buckets.filter((bucket) => bucket.id !== bucketId),
  };
}

function moveBucketInBoard(board: Board, sourceIndex: number, targetIndex: number) {
  if (
    sourceIndex < 0 ||
    targetIndex < 0 ||
    sourceIndex >= board.buckets.length ||
    targetIndex >= board.buckets.length ||
    sourceIndex === targetIndex
  ) {
    return board;
  }

  return {
    ...board,
    buckets: arrayMove(board.buckets, sourceIndex, targetIndex),
  };
}

function addTaskToBucket(board: Board, bucketId: string, task: Task) {
  return {
    ...board,
    buckets: board.buckets.map((bucket) =>
      bucket.id === bucketId
        ? {
            ...bucket,
            collapsed: false,
            tasks: [...bucket.tasks, task],
          }
        : bucket,
    ),
  };
}

function addTaskNoteToBoard(board: Board, taskId: string, note: TaskNote) {
  return {
    ...board,
    buckets: board.buckets.map((bucket) => ({
      ...bucket,
      tasks: updateTaskList(bucket.tasks, taskId, (task) => ({
        ...task,
        notes: [note, ...task.notes],
      })),
    })),
  };
}

function updateTaskNoteInBoard(
  board: Board,
  taskId: string,
  noteId: string,
  body: string,
  editorName: string,
) {
  return {
    ...board,
    buckets: board.buckets.map((bucket) => ({
      ...bucket,
      tasks: updateTaskList(bucket.tasks, taskId, (task) => ({
        ...task,
        notes: task.notes.map((note) =>
          note.id === noteId
            ? {
                ...note,
                body: body.trim(),
                updatedAt: new Date().toISOString(),
                editorName,
              }
            : note,
        ),
      })),
    })),
  };
}

function deleteTaskNoteFromBoard(board: Board, taskId: string, noteId: string) {
  return {
    ...board,
    buckets: board.buckets.map((bucket) => ({
      ...bucket,
      tasks: updateTaskList(bucket.tasks, taskId, (task) => ({
        ...task,
        notes: task.notes.filter((note) => note.id !== noteId),
      })),
    })),
  };
}

function updateTaskInBoard(
  board: Board,
  taskId: string,
  patch: Partial<Pick<Task, "title" | "summary" | "nextAction" | "status" | "labels" | "color" | "icon" | "allDay">> & {
    recurrence?: TaskRecurrenceRule | null;
    startAt?: string | null;
    endAt?: string | null;
    dueAt?: string | null;
    reminderOffsetMinutes?: number | null;
    overdueReminderEnabled?: boolean;
    bucketId?: string;
    promoteToMaintenanceOutage?: boolean;
    maintenanceOutage?: MaintenanceOutagePatch;
  },
) {
  const { bucketId, promoteToMaintenanceOutage, maintenanceOutage, ...taskPatch } = patch;
  const nextBuckets =
    bucketId && findBucketIdByTaskId(board.buckets, taskId) !== bucketId
      ? moveRootTaskOnBoard(board, taskId, bucketId, "append").buckets
      : board.buckets;

  return {
    ...board,
    buckets: nextBuckets.map((bucket) => ({
      ...bucket,
      tasks: updateTaskList(typeof taskPatch.status === "string"
        ? updateTaskCompletion(bucket.tasks, taskId, taskPatch.status)
        : bucket.tasks, taskId, (task) => ({
        ...task,
        ...taskPatch,
        workItemType:
          promoteToMaintenanceOutage === true
            ? "maintenance_outage"
            : task.workItemType,
        maintenanceOutage:
          promoteToMaintenanceOutage === true || maintenanceOutage
            ? {
                owner: maintenanceOutage?.owner ?? task.maintenanceOutage?.owner ?? "",
                attendees:
                  maintenanceOutage?.attendeeChanges ? applyAttendeeChanges(task.maintenanceOutage?.attendees, maintenanceOutage.attendeeChanges) : maintenanceOutage?.attendees ?? task.maintenanceOutage?.attendees ?? [],
                ...(("locationId" in (maintenanceOutage ?? {}))
                  ? maintenanceOutage?.locationId
                    ? { locationId: maintenanceOutage.locationId }
                    : {}
                  : task.maintenanceOutage?.locationId
                    ? { locationId: task.maintenanceOutage.locationId }
                    : {}),
                ...(task.maintenanceOutage?.locationName
                  ? { locationName: task.maintenanceOutage.locationName }
                  : {}),
              }
            : task.maintenanceOutage,
        startAt: taskPatch.startAt === null ? undefined : (taskPatch.startAt ?? task.startAt),
        endAt: taskPatch.endAt === null ? undefined : (taskPatch.endAt ?? task.endAt),
        dueAt: taskPatch.dueAt === null ? undefined : (taskPatch.dueAt ?? task.dueAt),
        recurrence:
          "recurrence" in taskPatch
            ? taskPatch.recurrence === null
              ? undefined
              : taskPatch.recurrence
            : task.recurrence,
        reminderConfig:
          "reminderOffsetMinutes" in taskPatch || "overdueReminderEnabled" in taskPatch
            ? {
                reminderOffsetMinutes:
                  "reminderOffsetMinutes" in taskPatch
                    ? taskPatch.reminderOffsetMinutes ?? null
                    : task.reminderConfig?.reminderOffsetMinutes ?? null,
                overdueReminderEnabled:
                  "overdueReminderEnabled" in taskPatch
                    ? Boolean(taskPatch.overdueReminderEnabled)
                    : Boolean(task.reminderConfig?.overdueReminderEnabled),
              }
            : task.reminderConfig,
      })),
    })),
  };
}

function addChecklistItemToBoard(board: Board, taskId: string, label: string) {
  return {
    ...board,
    buckets: board.buckets.map((bucket) => ({
      ...bucket,
      tasks: updateTaskList(bucket.tasks, taskId, (task) => ({
        ...task,
        checklist: [
          ...task.checklist,
          {
            id: crypto.randomUUID(),
            label,
            done: false,
          },
        ],
      })),
    })),
  };
}

function updateChecklistItemInBoard(
  board: Board,
  itemId: string,
  patch: { label?: string; done?: boolean },
) {
  return {
    ...board,
    buckets: board.buckets.map((bucket) => ({
      ...bucket,
      tasks: updateTaskChecklistList(bucket.tasks, itemId, patch),
    })),
  };
}

function deleteChecklistItemFromBoard(board: Board, itemId: string) {
  return {
    ...board,
    buckets: board.buckets.map((bucket) => ({
      ...bucket,
      tasks: removeChecklistItemFromTasks(bucket.tasks, itemId),
    })),
  };
}

function convertImportedTaskInBoard(board: Board, taskId: string) {
  return {
    ...board,
    buckets: board.buckets.map((bucket) => ({
      ...bucket,
      tasks: updateTaskList(bucket.tasks, taskId, (task) => ({
        ...task,
        importedFrom: task.importedFrom
          ? {
              ...task.importedFrom,
              readOnly: false,
              convertToTask: false,
            }
          : undefined,
      })),
    })),
  };
}

function addSubtaskToBoard(board: Board, taskId: string, subtask: Task) {
  return {
    ...board,
    buckets: board.buckets.map((bucket) => ({
      ...bucket,
      tasks: reconcileParentCompletion(
        updateTaskList(bucket.tasks, taskId, (task) => ({
          ...task,
          subtasks: [...task.subtasks, subtask],
        })),
        [taskId],
      ),
    })),
  };
}

function removeTaskFromBoard(board: Board, taskId: string) {
  return {
    ...board,
    buckets: board.buckets.map((bucket) => ({
      ...bucket,
      tasks: removeTaskFromList(bucket.tasks, taskId),
    })),
  };
}

function updateTaskList(
  tasks: Task[],
  taskId: string,
  updater: (task: Task) => Task,
): Task[] {
  return tasks.map((task) => {
    if (task.id === taskId) {
      return updater(task);
    }

    return {
      ...task,
      subtasks: updateTaskList(task.subtasks, taskId, updater),
    };
  });
}

function removeTaskFromList(tasks: Task[], taskId: string): Task[] {
  return tasks
    .filter((task) => task.id !== taskId)
    .map((task) => ({
      ...task,
      subtasks: removeTaskFromList(task.subtasks, taskId),
    }));
}

function updateTaskChecklistList(
  tasks: Task[],
  itemId: string,
  patch: { label?: string; done?: boolean },
): Task[] {
  return tasks.map((task) => ({
    ...task,
    checklist: task.checklist.map((item) =>
      item.id === itemId
        ? {
            ...item,
            ...(typeof patch.label === "string" ? { label: patch.label } : {}),
            ...(typeof patch.done === "boolean" ? { done: patch.done } : {}),
          }
        : item,
    ),
    subtasks: updateTaskChecklistList(task.subtasks, itemId, patch),
  }));
}

function removeChecklistItemFromTasks(tasks: Task[], itemId: string): Task[] {
  return tasks.map((task) => ({
    ...task,
    checklist: task.checklist.filter((item) => item.id !== itemId),
    subtasks: removeChecklistItemFromTasks(task.subtasks, itemId),
  }));
}

function getSubtaskStats(task: Task): { done: number; total: number } {
  let done = 0;
  let total = 0;

  const walk = (tasks: Task[]) => {
    for (const item of tasks) {
      total += 1;
      if (item.status === "done") {
        done += 1;
      }
      walk(item.subtasks);
    }
  };

  walk(task.subtasks);

  return { done, total };
}

function coerceViewMode(layoutMode: ViewLayoutMode): ViewMode {
  return layoutMode === "agenda" || layoutMode === "focus" ? layoutMode : "board";
}

function getSnoozeDateTime(preset: SnoozePreset) {
  const now = new Date();
  const target = new Date(now);

  if (preset === "later_today") {
    target.setHours(17, 0, 0, 0);
    if (target.getTime() <= now.getTime()) {
      target.setDate(target.getDate() + 1);
      target.setHours(9, 0, 0, 0);
    }
    return formatDateTimeInput(target.toISOString());
  }

  if (preset === "tomorrow") {
    target.setDate(target.getDate() + 1);
    target.setHours(9, 0, 0, 0);
    return formatDateTimeInput(target.toISOString());
  }

  const daysUntilNextMonday = ((8 - target.getDay()) % 7) || 7;
  target.setDate(target.getDate() + daysUntilNextMonday);
  target.setHours(9, 0, 0, 0);
  return formatDateTimeInput(target.toISOString());
}

type DuePreset = "today" | "tomorrow" | "next_week";

const DUE_PRESET_HOUR = 17;

const duePresetOptions: ReadonlyArray<{ value: DuePreset; label: string }> = [
  { value: "today", label: "Today" },
  { value: "tomorrow", label: "Tomorrow" },
  { value: "next_week", label: "Next week" },
];

// Due presets land at 5:00 PM local time; "Next week" means next Monday, matching Snooze.
function getDuePresetDateTime(preset: DuePreset, now = new Date()) {
  const target = new Date(now);

  if (preset === "tomorrow") {
    target.setDate(target.getDate() + 1);
  } else if (preset === "next_week") {
    const daysUntilNextMonday = ((8 - target.getDay()) % 7) || 7;
    target.setDate(target.getDate() + daysUntilNextMonday);
  }

  target.setHours(DUE_PRESET_HOUR, 0, 0, 0);
  return formatDateTimeInput(target.toISOString());
}

function getImportedProviderDisplayLabel(task: Task) {
  return task.importedFrom
    ? sourceLabels[task.importedFrom.source] ?? task.importedFrom.providerLabel
    : "Calendar";
}

function buildImportedFollowUpSummary(task: Task, displayTimeZone: string) {
  const source = getImportedProviderDisplayLabel(task);
  const eventTime = task.startAt
    ? task.endAt
      ? `${formatDate(task.startAt, displayTimeZone)} - ${formatDate(task.endAt, displayTimeZone)}`
      : formatDate(task.startAt, displayTimeZone)
    : task.dueAt
      ? formatDate(task.dueAt, displayTimeZone)
      : "No event date/time";

  return [
    `Follow-up created from imported ${source} event.`,
    `Original event: ${task.title}`,
    `Event date/time: ${eventTime}`,
  ].join("\n");
}

function formatDueDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
  }).format(date);
}

function formatFileSize(sizeBytes: number) {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  if (sizeBytes < 1024 * 1024) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function getStoredTaskItemTypeLabel(
  item: Pick<RecycleBinItem | ArchiveItem, "source" | "convertedImport">,
) {
  if (item.source === "native") {
    return "Task";
  }

  if (item.convertedImport) {
    return "Converted task";
  }

  return "Calendar event";
}

function getRecycleBinItemTypeLabel(item: RecycleBinItem) {
  return getStoredTaskItemTypeLabel(item);
}

function formatRecycleBinTimeRemaining(purgeAfterAt: string) {
  const now = Date.now();
  const purgeAt = new Date(purgeAfterAt).getTime();

  if (!Number.isFinite(purgeAt)) {
    return "Auto-purge date unavailable";
  }

  const msRemaining = purgeAt - now;
  const daysRemaining = Math.ceil(msRemaining / (1000 * 60 * 60 * 24));

  if (daysRemaining <= 0) {
    return "Purges on next cleanup";
  }

  if (daysRemaining === 1) {
    return "Purges in 1 day";
  }

  return `Purges in ${daysRemaining} days`;
}

function getAttachmentPreviewIcon(previewKind: "image" | "pdf" | "none") {
  switch (previewKind) {
    case "image":
      return FileImage;
    case "pdf":
      return FileText;
    default:
      return File;
  }
}

function formatDateTimeInput(value?: string) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");

  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function buildTaskCalendarHref(task: Task, boardId: string) {
  const datedValue = task.startAt ?? task.endAt ?? task.dueAt;
  const focusDate = task.allDay
    ? getCalendarFocusDate(datedValue)
    : getCalendarFocusDateTime(datedValue);

  if (!focusDate) {
    return null;
  }

  const params = new URLSearchParams({
    boardId,
    date: focusDate,
    taskId: task.id,
  });

  return `/calendar?${params.toString()}`;
}

function splitDateTimeInput(value: string) {
  if (!value) {
    return {
      date: "",
      time: "",
    };
  }

  const [date = "", time = ""] = value.split("T");

  return {
    date,
    time: time.slice(0, 5),
  };
}

function combineDateTimeInput(date: string, time: string) {
  if (!date) {
    return "";
  }

  return `${date}T${time || "00:00"}`;
}

function normalizeDateTimeInput(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return null;
  }

  const date = new Date(trimmed);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function getDraftRecurrenceRule(args: {
  enabled: boolean;
  frequency: TaskRecurrenceFrequency;
  interval: string;
  mode: TaskRecurrenceMode;
}): TaskRecurrenceRule | null {
  if (!args.enabled) {
    return null;
  }

  const parsedInterval =
    args.frequency === "weekday" ? 1 : Math.max(1, Math.trunc(Number(args.interval) || 1));

  return {
    frequency: args.frequency,
    interval: parsedInterval,
    mode: args.mode,
  };
}

function serializeRecurrenceRule(rule?: TaskRecurrenceRule | null) {
  if (!rule) {
    return "";
  }

  return JSON.stringify(rule);
}

function normalizeLabelList(labels: string[], caseSensitive = false) {
  const seenLabels = new Set<string>();
  const normalizedLabels: string[] = [];

  for (const label of labels) {
    const normalizedLabel = label.trim();
    const labelKey = caseSensitive ? normalizedLabel : normalizedLabel.toLocaleLowerCase();
    if (!normalizedLabel || seenLabels.has(labelKey)) {
      continue;
    }

    seenLabels.add(labelKey);
    normalizedLabels.push(normalizedLabel);
  }

  return normalizedLabels;
}

function formatLabelInput(labels: string[], caseSensitive = false) {
  return normalizeLabelList(labels, caseSensitive).join(", ");
}

function parseLabelInput(value: string, caseSensitive = false) {
  return normalizeLabelList(value.split(","), caseSensitive);
}

type BoardMutationResponse = {
  board: Board | null;
  error?: string;
  boardAccess?: BoardAccessMetadata;
  bucketId?: string;
  taskId?: string;
  locationId?: string;
  subtaskId?: string;
  viewId?: string;
  recycleBin?: RecycleBinItem[];
  archives?: ArchiveItem[];
};

type BoardRequestOptions = {
  boardId?: string | null;
};

function appendBoardIdToRequest(input: RequestInfo | URL, boardId?: string | null) {
  if (!boardId || typeof input !== "string") {
    return input;
  }

  const url = new URL(input, "https://taskboard.local");
  url.searchParams.set("boardId", boardId);
  return `${url.pathname}${url.search}${url.hash}`;
}

type IcsImportResponse = BoardMutationResponse & {
  created: number;
  updated: number;
  skippedPast: number;
  skippedRecurring: number;
  skippedUnsupported: number;
  errors?: string[];
};

type BulkTaskImportResponse = BoardMutationResponse & {
  createdTaskCount: number;
  createdBucketCount: number;
  warnings?: string[];
  error?: string;
};

type RecycleBinResponse = BoardMutationResponse & {
  items?: RecycleBinItem[];
  error?: string;
};

type ArchivesResponse = BoardMutationResponse & {
  items?: ArchiveItem[];
  error?: string;
};

type NotificationsResponse = {
  unreadCount: number;
  items: TaskNotification[];
  error?: string;
};


async function requestBoardMutation(
  input: RequestInfo | URL,
  init: RequestInit,
  options: BoardRequestOptions = {},
): Promise<BoardMutationResponse | null> {
  try {
    const { response, body } = await trackBoardWrite((async () => {
      const response = await fetch(appendBoardIdToRequest(input, options.boardId), init);
      return { response, body: (await response.json().catch(() => null)) as BoardMutationResponse | null };
    })());

    if (!response.ok) {
      const message = body?.error ?? `Request failed with status ${response.status}`;
      console.error("Taskboard mutation failed.", new Error(message));
      return { board: null, error: message };
    }

    return body;
  } catch (error) {
    console.error("Taskboard mutation failed.", error);
    return null;
  }
}

async function persistLoadBoard(boardId: string): Promise<BoardMutationResponse | null> {
  try {
    const response = await fetch(appendBoardIdToRequest("/api/board", boardId));
    const body = (await response.json()) as BoardMutationResponse & { error?: string };

    if (!response.ok) {
      throw new Error(body.error ?? `Request failed with status ${response.status}`);
    }

    return body;
  } catch (error) {
    console.error("Board load failed.", error);
    return null;
  }
}

async function persistSelectedBoardPreference(boardId: string | null) {
  try {
    const response = await fetch("/api/boards/selected", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ boardId }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;

    if (!response.ok) {
      throw new Error(body?.error ?? `Request failed with status ${response.status}`);
    }
  } catch (error) {
    console.error("Selected board preference save failed.", error);
  }
}

async function persistLoadBoardPrivacySettings(boardId: string) {
  const response = await fetch(`/api/boards/${encodeURIComponent(boardId)}/settings`);
  const body = (await response.json().catch(() => null)) as
    | BoardPrivacySettingsResponse
    | { error?: string }
    | null;

  if (!response.ok) {
    throw new Error(
      (body && "error" in body ? body.error : null) ??
        `Request failed with status ${response.status}`,
    );
  }

  return body as BoardPrivacySettingsResponse;
}

async function persistUpdateBoardPrivacySettings(
  boardId: string,
  input: {
    personalVisibility: PersonalBoardVisibilitySetting;
    personalVisibilityTeamId: string | null;
  },
) {
  const response = await fetch(`/api/boards/${encodeURIComponent(boardId)}/settings`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const body = (await response.json().catch(() => null)) as
    | {
        settings?: BoardPrivacySettingsResponse;
        changed?: boolean;
        error?: string;
      }
    | null;

  if (!response.ok || !body?.settings) {
    throw new Error(body?.error ?? `Request failed with status ${response.status}`);
  }

  return {
    settings: body.settings,
    changed: Boolean(body.changed),
  };
}

async function persistLoadPersonalBoardMembers(boardId: string) {
  const response = await fetch(`/api/boards/${encodeURIComponent(boardId)}/members`);
  const body = (await response.json().catch(() => null)) as
    | {
        members?: PersonalBoardShareMember[];
        error?: string;
      }
    | null;

  if (!response.ok || !body?.members) {
    throw new Error(body?.error ?? `Request failed with status ${response.status}`);
  }

  return {
    members: body.members,
  };
}

async function persistSearchPersonalBoardMemberCandidates(boardId: string, query: string) {
  const params = new URLSearchParams({ q: query });
  const response = await fetch(
    `/api/boards/${encodeURIComponent(boardId)}/member-candidates?${params.toString()}`,
  );
  const body = (await response.json().catch(() => null)) as
    | {
        candidates?: PersonalBoardShareCandidate[];
        error?: string;
      }
    | null;

  if (!response.ok || !body?.candidates) {
    throw new Error(body?.error ?? `Request failed with status ${response.status}`);
  }

  return body.candidates;
}

async function persistAddPersonalBoardMember(
  boardId: string,
  input: { userId: string; role: PersonalBoardShareRole },
) {
  const response = await fetch(`/api/boards/${encodeURIComponent(boardId)}/members`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  });
  const body = (await response.json().catch(() => null)) as
    | {
        member?: PersonalBoardShareMember;
        error?: string;
      }
    | null;

  if (!response.ok || !body?.member) {
    throw new Error(body?.error ?? `Request failed with status ${response.status}`);
  }

  return body.member;
}

async function persistUpdatePersonalBoardMember(
  boardId: string,
  userId: string,
  input: { role: PersonalBoardShareRole },
) {
  const response = await fetch(
    `/api/boards/${encodeURIComponent(boardId)}/members/${encodeURIComponent(userId)}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  );
  const body = (await response.json().catch(() => null)) as
    | {
        member?: PersonalBoardShareMember;
        error?: string;
      }
    | null;

  if (!response.ok || !body?.member) {
    throw new Error(body?.error ?? `Request failed with status ${response.status}`);
  }

  return body.member;
}

async function persistRemovePersonalBoardMember(boardId: string, userId: string) {
  const response = await fetch(
    `/api/boards/${encodeURIComponent(boardId)}/members/${encodeURIComponent(userId)}`,
    {
      method: "DELETE",
    },
  );
  const body = (await response.json().catch(() => null)) as { error?: string } | null;

  if (!response.ok) {
    throw new Error(body?.error ?? `Request failed with status ${response.status}`);
  }
}

async function persistImportIcs(file: File, fromDate: string): Promise<IcsImportResponse | null> {
  const formData = new FormData();
  formData.set("file", file);
  formData.set("fromDate", fromDate);

  try {
    const response = await fetch("/api/imports/ics", {
      method: "POST",
      body: formData,
    });
    const body = (await response.json()) as IcsImportResponse & { error?: string };

    if (!response.ok) {
      throw new Error(body.error ?? `Request failed with status ${response.status}`);
    }

    return body;
  } catch (error) {
    console.error("ICS import failed.", error);
    return null;
  }
}

async function persistBulkImportTasks(
  submission: BulkTaskImportSubmission,
): Promise<BulkTaskImportResponse | null> {
  try {
    const response = await fetch("/api/imports/bulk", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(submission),
    });
    const body = (await response.json()) as BulkTaskImportResponse;

    if (!response.ok) {
      throw new Error(body.error ?? `Request failed with status ${response.status}`);
    }

    return body;
  } catch (error) {
    console.error("Bulk task import failed.", error);
    return null;
  }
}

async function persistBucketCollapse(
  bucketId: string,
  collapsed: boolean,
  persistenceEnabled: boolean,
  options: BoardRequestOptions = {},
) {
  if (!persistenceEnabled) {
    return;
  }

  try {
    // Tracked: the bucket is already collapsed on screen.
    await trackBoardWrite(fetch(appendBoardIdToRequest(`/api/buckets/${bucketId}`, options.boardId), {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ collapsed }),
    }));
  } catch (error) {
    console.error("Failed to persist bucket collapse state.", error);
  }
}

async function persistCreateBucket(title: string, options: BoardRequestOptions = {}) {
  return requestBoardMutation("/api/buckets", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title }),
  }, options);
}

async function persistCreateView(args: {
  name: string;
  layoutMode: ViewLayoutMode;
  filters: ViewFilters;
}, options: BoardRequestOptions = {}) {
  return requestBoardMutation("/api/views", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(args),
  }, options);
}

async function persistDeleteView(viewId: string, options: BoardRequestOptions = {}) {
  return requestBoardMutation(`/api/views/${viewId}`, {
    method: "DELETE",
  }, options);
}

async function persistUpdateView(
  viewId: string,
  patch: {
    name: string;
    layoutMode: ViewLayoutMode;
    filters: ViewFilters;
  },
  options: BoardRequestOptions = {},
) {
  return requestBoardMutation(`/api/views/${viewId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  }, options);
}

async function persistUpdateBucket(
  bucketId: string,
  patch: {
    title?: string;
    color?: string;
    icon?: BucketIcon;
  },
  options: BoardRequestOptions = {},
) {
  return requestBoardMutation(`/api/buckets/${bucketId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  }, options);
}

async function persistReorderBuckets(bucketIds: string[], options: BoardRequestOptions = {}) {
  return requestBoardMutation("/api/buckets/reorder", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ bucketIds }),
  }, options);
}

async function persistDeleteBucket(bucketId: string, options: BoardRequestOptions = {}) {
  return requestBoardMutation(`/api/buckets/${bucketId}`, {
    method: "DELETE",
  }, options);
}

async function persistTaskMove(
  taskId: string,
  targetBucketId: string,
  targetIndex: number,
  persistenceEnabled: boolean,
  options: BoardRequestOptions = {},
) {
  if (!persistenceEnabled) {
    return;
  }

  // Tracked: the card is already moved on screen, so a live reload waits for it.
  const response = await trackBoardWrite(fetch(appendBoardIdToRequest("/api/tasks/reorder", options.boardId), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      taskId,
      targetBucketId,
      targetIndex,
    }),
  }));

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(payload?.error ?? "Failed to persist task movement.");
  }
}

async function persistCreateTask(
  bucketId: string,
  title: string,
  options: BoardRequestOptions = {},
  workItemType: "task" | "maintenance_outage" = "task",
) {
  return requestBoardMutation("/api/tasks", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ bucketId, title, workItemType, timeZone: getViewerTimeZone() }),
  }, options);
}

async function persistCreateMaintenanceLocation(
  name: string,
  options: BoardRequestOptions = {},
) {
  return requestBoardMutation("/api/maintenance-locations", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  }, options);
}

// Fields left out of the patch are left unchanged by the API.
async function persistUpdateTask(
  taskId: string,
  patch: TaskSavePatch,
  options: BoardRequestOptions = {},
) {
  return requestBoardMutation(`/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      ...patch,
    }),
  }, options);
}

async function persistConvertImportedTask(
  taskId: string,
  bucketId?: string | null,
  options: BoardRequestOptions = {},
) {
  return requestBoardMutation(`/api/tasks/${taskId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      convertToTask: true,
      ...(bucketId ? { bucketId } : {}),
    }),
  }, options);
}

async function persistUploadTaskAttachments(
  taskId: string,
  files: File[],
  options: BoardRequestOptions = {},
) {
  const formData = new FormData();

  for (const file of files) {
    formData.append("files", file);
  }

  const response = await fetch(appendBoardIdToRequest(`/api/tasks/${taskId}/attachments`, options.boardId), {
    method: "POST",
    body: formData,
  });
  const body = (await response.json()) as BoardMutationResponse & { error?: string };

  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }

  return body;
}

async function persistDeleteTaskAttachment(
  taskId: string,
  attachmentId: string,
  options: BoardRequestOptions = {},
) {
  const response = await fetch(appendBoardIdToRequest(`/api/tasks/${taskId}/attachments/${attachmentId}`, options.boardId), {
    method: "DELETE",
  });
  const body = (await response.json()) as BoardMutationResponse & { error?: string };

  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }

  return body;
}

async function persistRenameTaskAttachment(
  taskId: string,
  attachmentId: string,
  displayName: string,
  options: BoardRequestOptions = {},
) {
  const response = await fetch(appendBoardIdToRequest(`/api/tasks/${taskId}/attachments/${attachmentId}`, options.boardId), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ displayName }),
  });
  const body = (await response.json()) as BoardMutationResponse & { error?: string };

  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }

  return body;
}

async function persistCreateTaskNote(taskId: string, body: string, options: BoardRequestOptions = {}) {
  const response = await fetch(appendBoardIdToRequest(`/api/tasks/${taskId}/notes`, options.boardId), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body }),
  });
  const payload = (await response.json()) as BoardMutationResponse & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed with status ${response.status}`);
  }

  return payload;
}

async function persistUpdateTaskNote(
  taskId: string,
  noteId: string,
  body: string,
  options: BoardRequestOptions = {},
) {
  const response = await fetch(appendBoardIdToRequest(`/api/tasks/${taskId}/notes/${noteId}`, options.boardId), {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ body }),
  });
  const payload = (await response.json()) as BoardMutationResponse & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed with status ${response.status}`);
  }

  return payload;
}

async function persistDeleteTaskNote(
  taskId: string,
  noteId: string,
  options: BoardRequestOptions = {},
) {
  const response = await fetch(appendBoardIdToRequest(`/api/tasks/${taskId}/notes/${noteId}`, options.boardId), {
    method: "DELETE",
  });
  const payload = (await response.json()) as BoardMutationResponse & { error?: string };

  if (!response.ok) {
    throw new Error(payload.error ?? `Request failed with status ${response.status}`);
  }

  return payload;
}

async function persistUploadTaskNoteAttachments(
  taskId: string,
  noteId: string,
  files: File[],
  options: BoardRequestOptions = {},
) {
  const formData = new FormData();

  for (const file of files) {
    formData.append("files", file);
  }

  const response = await fetch(appendBoardIdToRequest(`/api/tasks/${taskId}/notes/${noteId}/attachments`, options.boardId), {
    method: "POST",
    body: formData,
  });
  const body = (await response.json()) as BoardMutationResponse & { error?: string };

  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }

  return body;
}

async function persistDeleteTask(taskId: string, options: BoardRequestOptions = {}) {
  return requestBoardMutation(`/api/tasks/${taskId}`, {
    method: "DELETE",
  }, options);
}

async function persistArchiveTask(taskId: string, options: BoardRequestOptions = {}) {
  const response = await fetch(appendBoardIdToRequest(`/api/tasks/${taskId}/archive`, options.boardId), {
    method: "POST",
  });
  const body = (await response.json()) as ArchivesResponse;

  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }

  return body;
}

async function persistFetchRecycleBin(options: BoardRequestOptions = {}) {
  const response = await fetch(appendBoardIdToRequest("/api/recycle-bin", options.boardId));
  const body = (await response.json()) as RecycleBinResponse;

  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }

  return body;
}

async function persistFetchArchives(options: BoardRequestOptions = {}) {
  const response = await fetch(appendBoardIdToRequest("/api/archives", options.boardId));
  const body = (await response.json()) as ArchivesResponse;

  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }

  return body;
}

async function persistFetchNotifications() {
  const response = await fetch("/api/notifications");
  const body = (await response.json()) as NotificationsResponse;

  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }

  return body;
}

async function persistUpdateNotification(
  notificationId: string,
  action: "read" | "dismiss",
) {
  const response = await fetch(`/api/notifications/${notificationId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action }),
  });
  const body = (await response.json().catch(() => null)) as { error?: string } | null;

  if (!response.ok) {
    throw new Error(body?.error ?? `Request failed with status ${response.status}`);
  }
}

async function persistReadAllNotifications() {
  const response = await fetch("/api/notifications/read-all", {
    method: "POST",
  });
  const body = (await response.json().catch(() => null)) as { error?: string } | null;

  if (!response.ok) {
    throw new Error(body?.error ?? `Request failed with status ${response.status}`);
  }
}

async function persistRestoreRecycleBinTask(taskId: string, options: BoardRequestOptions = {}) {
  const response = await fetch(appendBoardIdToRequest(`/api/recycle-bin/${taskId}/restore`, options.boardId), {
    method: "POST",
  });
  const body = (await response.json()) as RecycleBinResponse;

  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }

  return body;
}

async function persistDeleteRecycleBinTask(taskId: string, options: BoardRequestOptions = {}) {
  const response = await fetch(appendBoardIdToRequest(`/api/recycle-bin/${taskId}`, options.boardId), {
    method: "DELETE",
  });
  const body = (await response.json()) as RecycleBinResponse;

  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }

  return body;
}

async function persistRestoreArchiveTask(taskId: string, options: BoardRequestOptions = {}) {
  const response = await fetch(appendBoardIdToRequest(`/api/archives/${taskId}/restore`, options.boardId), {
    method: "POST",
  });
  const body = (await response.json()) as ArchivesResponse;

  if (!response.ok) {
    throw new Error(body.error ?? `Request failed with status ${response.status}`);
  }

  return body;
}

async function persistMoveSubtask(move: SubtaskMove, options: BoardRequestOptions = {}) {
  return requestBoardMutation(`/api/tasks/${move.taskId}/move`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ parentTaskId: move.parentTaskId, targetIndex: move.targetIndex }),
  }, options);
}

async function persistCreateSubtask(taskId: string, title: string, options: BoardRequestOptions = {}) {
  return requestBoardMutation(`/api/tasks/${taskId}/subtasks`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ title }),
  }, options);
}

async function persistCreateChecklistItem(taskId: string, label: string, options: BoardRequestOptions = {}) {
  return requestBoardMutation(`/api/tasks/${taskId}/checklist`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ label }),
  }, options);
}

async function persistUpdateChecklistItem(
  itemId: string,
  patch: { label?: string; done?: boolean },
  options: BoardRequestOptions = {},
) {
  return requestBoardMutation(`/api/checklist/${itemId}`, {
    method: "PATCH",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  }, options);
}

async function persistDeleteChecklistItem(itemId: string, options: BoardRequestOptions = {}) {
  return requestBoardMutation(`/api/checklist/${itemId}`, {
    method: "DELETE",
  }, options);
}

function normalizeBulkImportBucketKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

function getLastWeekDateRange(now = new Date()) {
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const dayOfWeek = today.getDay();
  const offsetToMonday = (dayOfWeek + 6) % 7;
  const startOfCurrentWeek = new Date(today);
  startOfCurrentWeek.setDate(today.getDate() - offsetToMonday);

  const startOfLastWeek = new Date(startOfCurrentWeek);
  startOfLastWeek.setDate(startOfCurrentWeek.getDate() - 7);

  const endOfLastWeek = new Date(startOfCurrentWeek);
  endOfLastWeek.setDate(startOfCurrentWeek.getDate() - 1);

  return {
    start: startOfLastWeek,
    end: endOfLastWeek,
    label: `${formatIsoDateOnly(startOfLastWeek)} to ${formatIsoDateOnly(endOfLastWeek)}`,
  };
}

function buildBulkTaskImportSubmission(args: {
  tasks: BulkTaskImportDraftTask[];
  bucketDecisions: Record<string, BulkTaskImportBucketDecision>;
  metadata: BulkTaskImportMetadata;
}): BulkTaskImportSubmission {
  const includedTasks = args.tasks.filter((task) => task.included);
  const includedBucketKeys = new Set(
    includedTasks.map((task) => normalizeBulkImportBucketKey(task.bucket)),
  );
  const tasks = includedTasks.map((task) => ({
    bucket: task.bucket.trim(),
    title: task.title.trim(),
    summary: task.summary.trim(),
    nextAction: task.nextAction.trim(),
    note: task.note.trim(),
    labels: parseLabelInput(task.labelsText),
    status: task.status,
    dueAt: task.dueAt?.trim() ? task.dueAt.trim() : null,
  }));

  const bucketMappings = Object.entries(args.bucketDecisions)
    .filter(([sourceBucket, decision]) =>
      includedBucketKeys.has(sourceBucket) && decision.mode === "map",
    )
    .map(([sourceBucket, decision]) => ({
      sourceBucket,
      targetBucketId: decision.targetBucketId,
    }));

  const newBuckets = Object.entries(args.bucketDecisions)
    .filter(([sourceBucket, decision]) =>
      includedBucketKeys.has(sourceBucket) && decision.mode === "create",
    )
    .map(([sourceBucket, decision]) => ({
      sourceBucket,
      title: decision.createTitle.trim(),
    }));

  return {
    version: bulkTaskImportVersion,
    source: args.metadata.source || bulkTaskImportSource,
    rangeLabel: args.metadata.rangeLabel || getLastWeekDateRange().label,
    tasks,
    ...(bucketMappings.length > 0 ? { bucketMappings } : {}),
    ...(newBuckets.length > 0 ? { newBuckets } : {}),
  };
}

function validateBulkImportDraft(args: {
  tasks: BulkTaskImportDraftTask[];
  bucketDecisions: Record<string, BulkTaskImportBucketDecision>;
  existingBucketByNormalizedTitle: Map<string, { id: string; title: string }>;
  existingBucketIds: Set<string>;
}) {
  if (args.tasks.length === 0) {
    throw new Error("Parse a bulk task import before creating tasks.");
  }

  const includedTasks = args.tasks.filter((task) => task.included);

  if (includedTasks.length === 0) {
    throw new Error("Select at least one included task before creating tasks.");
  }

  const missingBucketKeys = new Set<string>();

  for (const [index, task] of includedTasks.entries()) {
    const bucket = task.bucket.trim();
    const title = task.title.trim();

    if (!bucket) {
      throw new Error(`Task ${index + 1} bucket is required.`);
    }

    if (!title) {
      throw new Error(`Task ${index + 1} title is required.`);
    }

    if (!["todo", "active", "waiting", "done"].includes(task.status)) {
      throw new Error(`Task ${index + 1} status is invalid.`);
    }

    const dueAt = task.dueAt?.trim();
    if (dueAt) {
      const parsed = new Date(dueAt);
      if (Number.isNaN(parsed.getTime())) {
        throw new Error(`Task ${index + 1} due date/time is invalid.`);
      }
    }

    const bucketKey = normalizeBulkImportBucketKey(bucket);
    if (!args.existingBucketByNormalizedTitle.has(bucketKey)) {
      missingBucketKeys.add(bucketKey);
    }
  }

  for (const bucketKey of missingBucketKeys) {
    const decision = args.bucketDecisions[bucketKey];
    if (!decision) {
      throw new Error(`Bucket "${bucketKey}" is missing a review decision.`);
    }

    if (decision.mode === "map") {
      if (!args.existingBucketIds.has(decision.targetBucketId)) {
        throw new Error(`Mapped bucket target for "${bucketKey}" is invalid.`);
      }
      continue;
    }

    if (!decision.createTitle.trim()) {
      throw new Error(`Created bucket title for "${bucketKey}" is required.`);
    }
  }
}

function formatIsoDateOnly(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
