"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Archive,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderPlus,
  Inbox,
  LayoutGrid,
  Link2,
  ListChecks,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Paperclip,
  Tag,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { InlineNameField } from "@/components/ui/inline-name-field";
import { WikiNotesActions } from "@/components/wiki/wiki-notes-actions";
import { NoteActionsMenu } from "@/components/notes/note-actions-menu";
import { ContextMenu, type ContextMenuAnchor, type ContextMenuAction, type ContextMenuClassNames } from "@/components/ui/context-menu";
import { hasSelectionWithin, isContextMenuKey, keepsNativeContextMenu } from "@/lib/context-menu-request";
import { NotesMoveDialog, type NotesMoveOption } from "@/components/notes/notes-move-dialog";
import { MobileNoteAttachments } from "@/components/notes/mobile-note-attachments";
import { MobileFolderActions } from "@/components/notes/mobile-folder-actions";
import { MobileNoteFolders, MobileNoteFolderRows, type MobileFolderLocation } from "@/components/notes/mobile-note-folders";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { useNoteFormatSupport, useWikiNoteAccess } from "./page-mention-access";
import { canApplyLiveLoad, liveWriteGeneration, useLiveNotesToken, useLiveRefresh } from "@/components/use-live-board-revision";
import {
  updateNotesUiPrefs,
  useNotesUiPrefs,
  withExpanded,
} from "@/components/notes/notes-ui-prefs";
import { NotePropertyStrip } from "@/components/notes/note-property-strip";
import { buildNotesBucketContexts, findNotesBucketContext, noteBucketContext, notesBucketStyle } from "@/lib/notes-bucket-context";
import { NoteContextMark } from "./note-context-mark";
import linen from "./notes-linen.module.css";
import { TaskLinkPicker, type LinkableTask } from "@/components/notes/task-link-picker";
import {
  isNewNoteDraftId,
  startNewNote,
  useNoteDrafts,
  type NoteSaveState,
} from "@/components/notes/use-note-drafts";
import {
  convertNoteToTaskRequest,
  buildNotesHref,
  createNotebookRequest,
  deleteNoteForeverRequest,
  deleteNotebookRequest,
  deleteNoteAttachmentRequest,
  fetchBoardLabels,
  fetchNote,
  fetchNoteHomes,
  fetchNotebooks,
  fetchNotes,
  fetchNoteTags,
  getNoteAttachmentUrl,
  isNoteUnavailableError,
  NoteRequestError,
  linkNoteTaskRequest,
  restoreNoteRequest,
  trashNoteRequest,
  unlinkNoteTaskRequest,
  updateNotebookRequest,
  updateNoteRequest,
  uploadNoteAttachmentRequest,
  type CreateNoteRequest,
  type NoteListQuery,
  type UpdateNoteRequest,
} from "@/lib/notes-client";
import {
  getEffectiveNotesColumnWidths,
  getNotesColumnBounds,
  getNotesLayoutMode,
  getVisibleNotesColumns,
  NOTES_LAYOUT,
  type NotesColumnWidths,
} from "@/lib/notes-layout";
import type {
  Notebook,
  NoteContentInput,
  NoteDetail,
  NoteHomeBoardOption,
  NoteSummary,
  NoteTagSummary,
} from "@/lib/notes-model";
import { isUuid } from "@/lib/notes-model";

const NoteEditor = dynamic(() => import("@/components/notes/note-editor"), {
  ssr: false,
  loading: () => <div className="notes-editor-loading">Loading editor…</div>,
});

const LIST_PAGE_SIZE = 100;
const LIST_MAX = 500;

export type NotesWorkspaceProps = {
  homeOptions: NoteHomeBoardOption[];
  initialNoteId?: string | null;
  initialBoardId?: string | null;
  initialBucketId?: string | null;
  createOnOpen?: boolean;
  // A new note started from a task ("New linked note") links to it once saved.
  initialLinkTaskId?: string | null;
};

type NotesWorkspaceShellProps = NotesWorkspaceProps & {
  // Each increase asks for a new note (palette or Capture menu "New note").
  createRequest: number;
  searchQuery: string;
  // Clears the shared header search (choosing a folder ends a search).
  onClearSearch: () => void;
  // The signed-in user, so layout preferences stay per person.
  viewerId: string;
  linkableTasks: LinkableTask[];
  linkableTasksBoardId: string;
  isPhone: boolean;
};

export type NotesFilter =
  | { kind: "all" }
  | { kind: "inbox" }
  | { kind: "pinned" }
  | { kind: "notebook"; notebookId: string }
  | { kind: "board"; boardId: string; bucketId: string | null }
  | { kind: "tag"; name: string }
  | { kind: "archived" }
  | { kind: "trash" };

type MobilePane = "nav" | "list" | "note";
type Notice = { text: string; href?: string; hrefLabel?: string };
type NotesItemTarget = { kind: "note"; item: NoteSummary } | { kind: "notebook"; item: Notebook };
// Notes keeps its own menu classes, which its desktop scale rules target.
const NOTES_CONTEXT_MENU_CLASSES: ContextMenuClassNames = {
  menu: "notes-context-menu",
  heading: "notes-context-heading",
  item: "notes-menu-item ui-menu-item ed-menu-item",
  danger: "notes-menu-danger",
  separated: "notes-context-separated",
};

// Fields each kind of mutation owns: a response only updates these, so a late
// reply can never roll back newer text saved meanwhile.
const OWNED = {
  pinned: ["pinned"],
  archived: ["archived"],
  labels: ["labels"],
  home: ["home", "notebookId", "labels", "canEdit", "ownerUserId", "ownerDisplayName"],
  links: ["linkedTasks", "linkedTaskCount"],
  saved: ["title", "displayTitle", "snippet", "contentVersion", "updatedAt", "updatedByDisplayName"],
} as const satisfies Record<string, ReadonlyArray<keyof NoteDetail>>;

function mergeOwned<T extends object>(current: T, update: Partial<NoteDetail>, keys: ReadonlyArray<keyof NoteDetail>): T {
  const next = { ...current } as Record<string, unknown>;

  for (const key of keys) {
    if (key in current && key in update) {
      next[key] = update[key];
    }
  }

  return next as T;
}

// A new note is a draft until the user types in it or changes one of its
// settings (owner decision, 2026-10-18); the drafts store keeps it and
// creates the note (use-note-drafts.ts). This shows a draft in the editor.
function buildDraftDetail(
  draftId: string,
  target: CreateNoteRequest,
  context: {
    homeOptions: NoteHomeBoardOption[];
    linkableTasks: LinkableTask[];
    linkableTasksBoardId: string;
    viewerId: string;
  },
): NoteDetail {
  const board = target.boardId ? context.homeOptions.find((option) => option.boardId === target.boardId) : undefined;
  const bucket = board?.buckets.find((item) => item.id === target.bucketId);
  const linkedTask = target.linkTaskId ? context.linkableTasks.find((task) => task.id === target.linkTaskId) : undefined;
  const now = new Date().toISOString();
  const linkedTasks = target.linkTaskId
    ? [
        {
          id: target.linkTaskId,
          title: linkedTask?.title ?? "Linked task",
          status: "todo" as const,
          boardId: context.linkableTasksBoardId,
          boardTitle: context.homeOptions.find((option) => option.boardId === context.linkableTasksBoardId)?.title ?? "",
          bucketId: null,
          bucketTitle: linkedTask?.bucketTitle || null,
          archived: false,
        },
      ]
    : [];

  return {
    id: draftId,
    title: "",
    displayTitle: "",
    snippet: "",
    home: board
      ? {
          kind: "board",
          boardId: board.boardId,
          boardTitle: board.title,
          bucketId: bucket?.id ?? null,
          bucketTitle: bucket?.title ?? null,
        }
      : { kind: "personal" },
    notebookId: board ? null : (target.notebookId ?? null),
    labels: target.labels ?? [],
    pinned: false,
    archived: false,
    deletedAt: null,
    purgeAfterAt: null,
    ownerUserId: context.viewerId,
    ownerDisplayName: null,
    updatedByDisplayName: null,
    createdAt: now,
    updatedAt: now,
    canEdit: true,
    linkedTaskCount: linkedTasks.length,
    attachmentCount: 0,
    content: [],
    contentMarkdown: "",
    contentVersion: 0,
    linkedTasks,
    attachments: [],
  };
}

function filterKey(filter: NotesFilter) {
  switch (filter.kind) {
    case "notebook":
      return `notebook:${filter.notebookId}`;
    case "board":
      return `board:${filter.boardId}:${filter.bucketId ?? ""}`;
    case "tag":
      return `tag:${filter.name.toLowerCase()}`;
    default:
      return filter.kind;
  }
}

function filterToQuery(filter: NotesFilter): NoteListQuery {
  switch (filter.kind) {
    case "inbox":
      return { scope: "personal", notebookId: "inbox" };
    case "pinned":
      return { scope: "all", pinned: true };
    case "notebook":
      return { scope: "personal", notebookId: filter.notebookId };
    case "board":
      return { scope: "board", boardId: filter.boardId, bucketId: filter.bucketId ?? undefined };
    case "tag":
      return { scope: "personal", label: filter.name };
    case "archived":
      return { scope: "all", status: "archived" };
    case "trash":
      return { scope: "all", status: "trash" };
    default:
      return { scope: "all" };
  }
}

// The folder a note lives in, used to open a deep-linked note in context.
function homeFilter(note: NoteSummary): NotesFilter {
  if (note.deletedAt) {
    return { kind: "trash" };
  }

  if (note.archived) {
    return { kind: "archived" };
  }

  if (note.home.kind === "board") {
    return { kind: "board", boardId: note.home.boardId, bucketId: note.home.bucketId };
  }

  return note.notebookId ? { kind: "notebook", notebookId: note.notebookId } : { kind: "inbox" };
}

function formatUpdated(iso: string) {
  const date = new Date(iso);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        ...(date.getFullYear() === now.getFullYear() ? {} : { year: "numeric" }),
      });
}

function homeLabel(note: NoteSummary) {
  if (note.home.kind === "personal") {
    return "Personal";
  }

  return note.home.bucketTitle ? `${note.home.boardTitle} · ${note.home.bucketTitle}` : note.home.boardTitle;
}

function encodeHome(note: NoteSummary) {
  return note.home.kind === "personal"
    ? `personal:${note.notebookId ?? ""}`
    : `board:${note.home.boardId}:${note.home.bucketId ?? ""}`;
}

function getTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

type NotebookRow = { notebook: Notebook; depth: number; path: string; hasChildren: boolean };

function buildNotebookRows(notebooks: Notebook[]): NotebookRow[] {
  const children = new Map<string | null, Notebook[]>();

  for (const notebook of notebooks) {
    const list = children.get(notebook.parentNotebookId) ?? [];
    list.push(notebook);
    children.set(notebook.parentNotebookId, list);
  }

  const rows: NotebookRow[] = [];
  const visit = (parentId: string | null, depth: number, prefix: string) => {
    for (const notebook of children.get(parentId) ?? []) {
      const path = prefix ? `${prefix} / ${notebook.title}` : notebook.title;
      rows.push({ notebook, depth, path, hasChildren: (children.get(notebook.id) ?? []).length > 0 });
      visit(notebook.id, depth + 1, path);
    }
  };

  visit(null, 0, "");
  return rows;
}

function notebookAncestors(notebooks: Notebook[], notebookId: string) {
  const byId = new Map(notebooks.map((notebook) => [notebook.id, notebook]));
  const ancestors: string[] = [];
  let current = byId.get(notebookId)?.parentNotebookId ?? null;

  while (current && !ancestors.includes(current)) {
    ancestors.push(current);
    current = byId.get(current)?.parentNotebookId ?? null;
  }

  return ancestors;
}

function setNoteInUrl(noteId: string | null) {
  const url = new URL(window.location.href);

  for (const key of ["new", "boardId", "bucketId", "linkTaskId"]) {
    url.searchParams.delete(key);
  }

  if (noteId) {
    url.searchParams.set("note", noteId);
  } else {
    url.searchParams.delete("note");
  }

  // null, so the Next.js router keeps useSearchParams in step (it copies its
  // own history state over).
  window.history.replaceState(null, "", url);
}

export function NotesWorkspace({
  homeOptions: initialHomeOptions,
  initialNoteId,
  initialBoardId,
  initialBucketId,
  createOnOpen,
  initialLinkTaskId,
  createRequest,
  searchQuery,
  onClearSearch,
  viewerId,
  linkableTasks,
  linkableTasksBoardId,
  isPhone,
}: NotesWorkspaceShellProps) {
  const prefs = useNotesUiPrefs(viewerId);
  const { confirm, dialog: confirmDialog } = useConfirm();
  // Boards and buckets notes can live in; reloaded when Notes change.
  const wikiRouter = useRouter();
  const [homeOptions, setHomeOptions] = useState(initialHomeOptions);
  const bucketContexts = useMemo(() => buildNotesBucketContexts(homeOptions), [homeOptions]);
  const initialBoardOption = homeOptions.find((board) => board.boardId === initialBoardId) ?? null;
  // The home a "New note" link asks for (?new=1&boardId&bucketId&linkTaskId),
  // when the viewer can edit that board.
  const linkDraftTarget = useCallback(
    (
      boardId: string | null | undefined,
      bucketId: string | null | undefined,
      linkTaskId: string | null | undefined,
    ): CreateNoteRequest => {
      const board = homeOptions.find((option) => option.boardId === boardId);
      return {
        ...(board?.canEdit
          ? {
              boardId: board.boardId,
              bucketId: board.buckets.some((bucket) => bucket.id === bucketId) ? (bucketId ?? null) : null,
            }
          : {}),
        ...(isUuid(linkTaskId) ? { linkTaskId } : {}),
      };
    },
    [homeOptions],
  );
  // "New note" links open straight onto a draft.
  const [initialDraft] = useState(() => {
    if (!createOnOpen || initialNoteId) {
      return null;
    }

    const target = linkDraftTarget(initialBoardId, initialBucketId, initialLinkTaskId);
    return { id: startNewNote(target), target };
  });
  const draftContext = useMemo(
    () => ({ homeOptions, linkableTasks, linkableTasksBoardId, viewerId }),
    [homeOptions, linkableTasks, linkableTasksBoardId, viewerId],
  );
  const [filter, setFilter] = useState<NotesFilter>(() =>
    initialBoardOption
      ? {
          kind: "board",
          boardId: initialBoardOption.boardId,
          bucketId: initialBoardOption.buckets.some((bucket) => bucket.id === initialBucketId)
            ? (initialBucketId ?? null)
            : null,
        }
      : { kind: "all" },
  );
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [listState, setListState] = useState<{ key: string; error: string; hasMore: boolean }>({
    key: "",
    error: "",
    hasMore: false,
  });
  const [listPages, setListPages] = useState(1);
  const [actionError, setActionError] = useState("");
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [inboxCount, setInboxCount] = useState(0);
  const [tags, setTags] = useState<NoteTagSummary[]>([]);
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(initialNoteId ?? initialDraft?.id ?? null);
  const [currentNote, setNote] = useState<NoteDetail | null>(() =>
    initialDraft ? buildDraftDetail(initialDraft.id, initialDraft.target, draftContext) : null,
  );
  const note = currentNote && currentNote.id === selectedNoteId ? currentNote : null;
  const editorContext = note ? noteBucketContext(bucketContexts, note) : undefined;
  const isDraft = isNewNoteDraftId(note?.id);
  const [noteError, setNoteError] = useState("");
  const [editorKey, setEditorKey] = useState(0);
  // Which note the editor was opened for. A draft keeps its editor (and the
  // cursor) when it becomes a saved note.
  const [editorNoteId, setEditorNoteId] = useState<string | null>(initialDraft?.id ?? null);
  // The newest labels the server reported for each note, so queued label
  // changes build on each other and on a fresh reload. A reply that is older
  // than what is known (a slow pin reply after a reload) never replaces it.
  const knownLabelsRef = useRef(new Map<string, { labels: string[]; updatedAt: number }>());
  const rememberLabels = useCallback((detail: Pick<NoteDetail, "id" | "labels" | "updatedAt">) => {
    const updatedAt = Date.parse(detail.updatedAt) || 0;
    const known = knownLabelsRef.current.get(detail.id);

    if (!known || updatedAt >= known.updatedAt) {
      knownLabelsRef.current.set(detail.id, { labels: detail.labels, updatedAt });
    }
  }, []);
  const [focusBodyRequest, setFocusBodyRequest] = useState(0);
  const [mobilePane, setMobilePane] = useState<MobilePane>(initialNoteId || createOnOpen ? "note" : "list");
  const [mobileFolderLocation, setMobileFolderLocation] = useState<MobileFolderLocation>("root");
  const [mobileEditing, setMobileEditing] = useState(Boolean(initialDraft));
  const [mobileFormatting, setMobileFormatting] = useState(false);
  const [mobileDetails, setMobileDetails] = useState(false);
  const [readingSettings, setReadingSettings] = useState(false);
  const [detailsSection, setDetailsSection] = useState("overview");
  const readingButtonRef = useRef<HTMLButtonElement>(null);
  const readingPanelRef = useRef<HTMLElement>(null);
  const detailsButtonRef = useRef<HTMLButtonElement>(null);
  const detailsPanelRef = useRef<HTMLDivElement>(null);
  const openDetails = () => { setReadingSettings(false); setDetailsSection("overview"); setMobileDetails(true); };
  useEffect(() => {
    if (!isPhone || (!readingSettings && !mobileDetails)) return;
    (readingSettings ? readingPanelRef : detailsPanelRef).current?.querySelector<HTMLButtonElement>("button")?.focus({ preventScroll: true });
    const close = (focus: boolean) => {
      setReadingSettings(false); setMobileDetails(false);
      if (focus) (readingSettings ? readingButtonRef : detailsButtonRef).current?.focus();
    };
    const pointer = (event: PointerEvent) => {
      const target = event.target as HTMLElement;
      if (target.closest('[aria-modal="true"]')) return;
      const panel = readingSettings ? readingPanelRef : detailsPanelRef;
      const button = readingSettings ? readingButtonRef : detailsButtonRef;
      if (!panel.current?.contains(target) && !button.current?.contains(target)) close(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); close(true); }
    };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
    return () => { document.removeEventListener("pointerdown", pointer); document.removeEventListener("keydown", key); };
  }, [isPhone, readingSettings, mobileDetails]);
  const [debouncedSearch, setDebouncedSearch] = useState(searchQuery);
  const [listNonce, setListNonce] = useState(0);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [draftTitle, setDraftTitle] = useState("");
  const isSearching = debouncedSearch.trim().length > 0;
  const activeNoteIdRef = useRef<string | null>(initialNoteId ?? initialDraft?.id ?? null);
  const loadedNoteIdRef = useRef<string | null>(initialDraft?.id ?? null);
  const loadedVersionRef = useRef(0);
  // A note whose text must not change right now (reloading the server copy,
  // or being moved to the trash).
  const [lockedNoteId, setLockedNoteId] = useState<string | null>(null);
  const titleInputRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  useEffect(() => {
    const field = titleInputRef.current;
    if (isPhone && field instanceof HTMLTextAreaElement) {
      const resize = () => { field.style.height = "0px"; field.style.height = `${field.scrollHeight}px`; };
      resize();
      let width = field.clientWidth;
      const observer = new ResizeObserver(() => { if (width !== field.clientWidth) { width = field.clientWidth; resize(); } });
      observer.observe(field);
      return () => observer.disconnect();
    }
  }, [draftTitle, isPhone, mobilePane, prefs.readingScale]);
  // A deep-linked note (no board requested) opens inside its own folder.
  const revealInitialNoteRef = useRef(Boolean(initialNoteId && !initialBoardOption));
  const pendingRevealNotebookRef = useRef<string | null>(null);
  const [revealRequest, setRevealRequest] = useState(0);

  useEffect(() => {
    activeNoteIdRef.current = selectedNoteId;
  }, [selectedNoteId]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      setDebouncedSearch(searchQuery);

      // On a phone, results show in the list pane.
      if (searchQuery.trim()) {
        setMobilePane("list");
      }
    }, 250);
    return () => window.clearTimeout(handle);
  }, [searchQuery]);

  // --- Sidebar data -------------------------------------------------------------

  const [sidebarRequest, setSidebarRequest] = useState(0);
  const refreshSidebar = useCallback(() => setSidebarRequest((current) => current + 1), []);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchNotebooks(), fetchNoteTags()])
      .then(([notebookListing, tagList]) => {
        if (!cancelled) {
          setNotebooks(notebookListing.notebooks);
          setInboxCount(notebookListing.inboxCount);
          setTags(tagList);
        }
      })
      // The sidebar keeps its last state; the list shows its own errors.
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [sidebarRequest]);

  // --- Expanded folders -----------------------------------------------------------

  const expandedBoards = useMemo(() => new Set(prefs.expandedBoards), [prefs.expandedBoards]);
  const expandedNotebooks = useMemo(() => new Set(prefs.expandedNotebooks), [prefs.expandedNotebooks]);

  const expand = useCallback((boards: string[], notebookIds: string[]) => {
    if (boards.length === 0 && notebookIds.length === 0) {
      return;
    }

    updateNotesUiPrefs(viewerId, (current) => ({
      ...current,
      expandedBoards: withExpanded(current.expandedBoards, boards),
      expandedNotebooks: withExpanded(current.expandedNotebooks, notebookIds),
    }));
  }, [viewerId]);

  const toggleExpanded = (kind: "board" | "notebook", id: string) => {
    updateNotesUiPrefs(viewerId, (current) => {
      const key = kind === "board" ? "expandedBoards" : "expandedNotebooks";
      const list = current[key];
      return { ...current, [key]: list.includes(id) ? list.filter((item) => item !== id) : [...list, id] };
    });
  };

  // Opens a folder's ancestors so it can be seen (create, delete, deep link).
  const revealFilter = useCallback(
    (target: NotesFilter, notebookList: Notebook[]) => {
      if (target.kind === "board" && target.bucketId) {
        expand([target.boardId], []);
      } else if (target.kind === "notebook") {
        expand([], notebookAncestors(notebookList, target.notebookId));
      }
    },
    [expand],
  );

  // --- List -------------------------------------------------------------------------

  // Searching looks across all notes; otherwise the selected folder applies.
  const listLimit = Math.min(LIST_PAGE_SIZE * listPages, LIST_MAX);
  const listQuery = useMemo(
    () => (isSearching ? { scope: "all" as const, q: debouncedSearch.trim() } : {
      ...filterToQuery(filter),
      // The existing API supports direct board notes. On phones, buckets are
      // child folders; the board folder lists only notes at its own level.
      ...(isPhone && filter.kind === "board" && !filter.bucketId ? { bucketId: "none" } : {}),
    }),
    [debouncedSearch, filter, isSearching, isPhone],
  );
  const listKey = `${JSON.stringify(listQuery)}#${listNonce}#${listLimit}`;
  // Search spans all homes even while the remembered folder is a bucket.
  const listContext = listQuery.scope === "board"
    ? findNotesBucketContext(bucketContexts, listQuery.boardId, listQuery.bucketId)
    : undefined;
  const isListLoading = listState.key !== listKey;
  const listError = (listState.key === listKey ? listState.error : "") || actionError;
  const hasMoreNotes = listState.hasMore;

  useEffect(() => {
    const controller = new AbortController();
    fetchNotes({ ...listQuery, limit: listLimit }, controller.signal)
      .then((result) => {
        // A cancelled load (folder or search changed) never replaces the list.
        if (controller.signal.aborted) {
          return;
        }

        if (!Array.isArray(result)) {
          throw new Error("Unable to load notes.");
        }

        setNotes(result);
        setListState({ key: listKey, error: "", hasMore: result.length >= listLimit });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setListState({
            key: listKey,
            error: error instanceof Error ? error.message : "Unable to load notes.",
            hasMore: false,
          });
        }
      });

    return () => controller.abort();
  }, [listKey, listLimit, listQuery]);

  // Refetch after anything that can change which notes belong in this list.
  const refreshList = useCallback(() => setListNonce((value) => value + 1), []);

  const patchSummary = useCallback((update: Partial<NoteDetail> & { id: string }, keys: ReadonlyArray<keyof NoteDetail>) => {
    setNotes((current) => current.map((item) => (item.id === update.id ? mergeOwned(item, update, keys) : item)));
  }, []);

  // --- Drafts and the open note --------------------------------------------------

  const drafts = useNoteDrafts({
    onSaved: (saved) => {
      patchSummary(saved, OWNED.saved);
      setNote((current) => (current && current.id === saved.id ? mergeOwned(current, saved, OWNED.saved) : current));
    },
    // A draft became a note. If it is still on screen, the page switches to
    // the note; the editor (and cursor) stay because its key does not change.
    onCreated: (draftId, created) => {
      rememberLabels(created);
      refreshList();
      refreshSidebar();

      if (activeNoteIdRef.current !== draftId) {
        return;
      }

      activeNoteIdRef.current = created.id;

      if (loadedNoteIdRef.current === draftId) {
        loadedNoteIdRef.current = created.id;
        loadedVersionRef.current = created.contentVersion;
      }

      setSelectedNoteId(created.id);
      setNoteInUrl(created.id);
      setNote((current) => (current && current.id === draftId ? created : current));
    },
  });

  // Shows a note fresh from the server; unsaved edits for it win.
  const openLoadedNote = useCallback(
    (detail: NoteDetail) => {
      const local = drafts.register(detail);
      rememberLabels(detail);
      loadedNoteIdRef.current = detail.id;
      loadedVersionRef.current = detail.contentVersion;
      setNote(local?.content ? { ...detail, content: local.content.blocks } : detail);
      setDraftTitle(local?.title ?? detail.title);
      setEditorNoteId(detail.id);
      setEditorKey((key) => key + 1);
    },
    [drafts, rememberLabels],
  );

  useEffect(() => {
    // A note just created or reloaded here is already open.
    if (!selectedNoteId || loadedNoteIdRef.current === selectedNoteId) {
      return;
    }

    let cancelled = false;
    fetchNote(selectedNoteId)
      .then((detail) => {
        if (cancelled) {
          return;
        }

        openLoadedNote(detail);

        if (revealInitialNoteRef.current && detail.id === initialNoteId) {
          revealInitialNoteRef.current = false;
          const target = homeFilter(detail);
          setFilter(target);
          expand(detail.home.kind === "board" && detail.home.bucketId ? [detail.home.boardId] : [], []);
          pendingRevealNotebookRef.current = detail.notebookId;
          setRevealRequest((value) => value + 1);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setNoteError(error instanceof Error ? error.message : "Unable to open the note.");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [expand, initialNoteId, openLoadedNote, selectedNoteId]);

  // Opens a deep-linked note's notebook parents as soon as both the note and
  // the notebook list have loaded, in either order.
  useEffect(() => {
    const notebookId = pendingRevealNotebookRef.current;

    if (!notebookId || !notebooks.some((notebook) => notebook.id === notebookId)) {
      return;
    }

    pendingRevealNotebookRef.current = null;
    expand([], notebookAncestors(notebooks, notebookId));
  }, [expand, notebooks, revealRequest]);

  // Keep the open note's row in view (deep links, folder changes).
  useEffect(() => {
    if (!selectedNoteId || isListLoading) {
      return;
    }

    document
      .querySelector(`[data-note-row="${CSS.escape(selectedNoteId)}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [isListLoading, selectedNoteId]);

  // --- Drafts of new notes -----------------------------------------------------------

  // The id to act on for the open note: a draft is created first.
  const resolveOpenNoteId = useCallback(async () => {
    const noteId = activeNoteIdRef.current;

    if (!isNewNoteDraftId(noteId)) {
      return noteId;
    }

    return (await drafts.createNewNote(noteId))?.id ?? null;
  }, [drafts]);

  const handleContentChange = useCallback(
    (content: NoteContentInput) => {
      const noteId = activeNoteIdRef.current;

      if (isNewNoteDraftId(noteId)) {
        drafts.editNewNote(noteId, { content });
      } else if (noteId && loadedNoteIdRef.current === noteId) {
        drafts.edit(noteId, loadedVersionRef.current, { content });
      }
    },
    [drafts],
  );

  const handleTitleChange = (value: string) => {
    if (!note) {
      return;
    }

    setDraftTitle(value);
    const noteId = activeNoteIdRef.current;

    if (isNewNoteDraftId(noteId)) {
      drafts.editNewNote(noteId, { title: value });
    } else if (noteId && loadedNoteIdRef.current === noteId) {
      drafts.edit(noteId, loadedVersionRef.current, { title: value });
    }
  };

  const handleReloadNote = async () => {
    if (!note) {
      return;
    }

    const noteId = note.id;
    setLockedNoteId(noteId);

    try {
      const detail = await fetchNote(noteId);
      drafts.forget(noteId);

      if (activeNoteIdRef.current === noteId) {
        openLoadedNote(detail);
      }
    } catch (error) {
      if (activeNoteIdRef.current === noteId) {
        setNoteError(error instanceof Error ? error.message : "Unable to reload the note.");
      }
    } finally {
      setLockedNoteId((current) => (current === noteId ? null : current));
    }
  };

  const selectNote = useCallback(
    (noteId: string | null) => {
      const previous = activeNoteIdRef.current;

      // The previous note keeps saving on its own (drafts are per note). A
      // draft with typed text is saved; an untouched one is dropped.
      if (previous && previous !== noteId) {
        if (isNewNoteDraftId(previous)) {
          drafts.leaveNewNote(previous);
        } else {
          void drafts.saveNote(previous);
        }
      }

      activeNoteIdRef.current = noteId;
      setSelectedNoteId(noteId);
      setNotice(null);
      setNoteError("");
      setNoteInUrl(isNewNoteDraftId(noteId) ? null : noteId);

      if (noteId) {
        setMobilePane("note");
        setMobileEditing(isNewNoteDraftId(noteId));
        setMobileFormatting(false);
        setMobileDetails(false);
        setReadingSettings(false);
      }
    },
    [drafts],
  );

  // --- Creating ---------------------------------------------------------------------

  const createTarget = useMemo((): CreateNoteRequest => {
    if (filter.kind === "notebook") {
      return { notebookId: filter.notebookId };
    }

    if (filter.kind === "tag") {
      return { labels: [filter.name] };
    }

    if (filter.kind === "board") {
      const board = homeOptions.find((option) => option.boardId === filter.boardId);

      if (board?.canEdit) {
        return { boardId: board.boardId, bucketId: filter.bucketId };
      }
    }

    return {};
  }, [filter, homeOptions]);

  // Opens a new draft. Nothing is saved until the user types in it or changes
  // one of its settings; leaving it untouched leaves nothing behind.
  const handleCreateNote = useCallback(
    (target: CreateNoteRequest = createTarget) => {
      const draftId = drafts.startNewNote(target);
      selectNote(draftId);
      loadedNoteIdRef.current = draftId;
      loadedVersionRef.current = 0;
      setNote(buildDraftDetail(draftId, target, draftContext));
      setDraftTitle("");
      setEditorNoteId(draftId);
      setEditorKey((key) => key + 1);
      window.setTimeout(() => titleInputRef.current?.focus(), 50);
    },
    [createTarget, draftContext, drafts, selectNote],
  );

  // Leaving Notes on a draft drops it if untouched and saves typed text. The
  // store waits a moment, and a remount holds the draft again, so React's
  // development effect replay does not drop a draft still on screen.
  useEffect(() => {
    const activeRef = activeNoteIdRef;

    if (isNewNoteDraftId(activeRef.current)) {
      drafts.holdNewNote(activeRef.current);
    }

    return () => {
      const noteId = activeRef.current;

      if (isNewNoteDraftId(noteId)) {
        drafts.releaseNewNote(noteId);
      }
    };
  }, [drafts]);

  // Arriving at a "New note" link while Notes is already open (Back,
  // Forward, or a link) opens a draft too.
  const searchParams = useSearchParams();
  const wantsNewNote = searchParams?.get("new") === "1" && !searchParams.get("note");
  const wantedNewNoteRef = useRef(wantsNewNote);

  useEffect(() => {
    if (wantsNewNote && !wantedNewNoteRef.current && searchParams) {
      handleCreateNote(
        linkDraftTarget(searchParams.get("boardId"), searchParams.get("bucketId"), searchParams.get("linkTaskId")),
      );
    }

    wantedNewNoteRef.current = wantsNewNote;
  }, [handleCreateNote, linkDraftTarget, searchParams, wantsNewNote]);

  const lastCreateRequestRef = useRef(createRequest);

  useEffect(() => {
    if (createRequest !== lastCreateRequestRef.current) {
      lastCreateRequestRef.current = createRequest;
      handleCreateNote({});
    }
  }, [createRequest, handleCreateNote]);

  // --- Note actions -----------------------------------------------------------------

  // Runs a mutation for the open note. Its response updates only the fields
  // it owns, and nothing on screen changes if another note is open by then.
  const applyUpdateTo = useCallback(
    async (
      target: Promise<string | null>,
      body: UpdateNoteRequest,
      keys: ReadonlyArray<keyof NoteDetail>,
      options: { refreshList?: boolean } = {},
    ) => {
      const noteId = await target;

      if (!noteId) {
        return null;
      }

      try {
        const updated = await updateNoteRequest(noteId, body);
        rememberLabels(updated);
        patchSummary(updated, keys);
        setNote((current) => (current && current.id === noteId ? mergeOwned(current, updated, keys) : current));

        if (options.refreshList) {
          refreshList();
          refreshSidebar();
        }

        return updated;
      } catch (error) {
        if (activeNoteIdRef.current === noteId) {
          setNoteError(error instanceof Error ? error.message : "Unable to update the note.");
        } else {
          setActionError(error instanceof Error ? error.message : "Unable to update the note.");
        }

        return null;
      }
    },
    [patchSummary, refreshList, refreshSidebar, rememberLabels],
  );

  // Changing a setting on a draft creates it first.
  const applyUpdate = useCallback(
    (body: UpdateNoteRequest, keys: ReadonlyArray<keyof NoteDetail>, options: { refreshList?: boolean } = {}) =>
      note ? applyUpdateTo(resolveOpenNoteId(), body, keys, options) : Promise.resolve(null),
    [applyUpdateTo, note, resolveOpenNoteId],
  );

  const leaveNote = (noteId: string, message: Notice | null) => {
    setNotes((current) => current.filter((item) => item.id !== noteId));

    if (loadedNoteIdRef.current === noteId) {
      loadedNoteIdRef.current = null;
    }

    setNote((current) => (current && current.id === noteId ? null : current));

    if (activeNoteIdRef.current === noteId) {
      selectNote(null);
      setMobilePane("list");
      setNotice(message);
    }

    refreshList();
    refreshSidebar();
  };

  const handleTrash = async (target: NoteSummary | null = note) => {
    if (!target) {
      return;
    }

    const noteId = target.id;
    // Editing stops until the note is in the trash, so nothing typed now is
    // lost. The last edits are saved first; a failed or conflicting save
    // stops here instead of discarding them.
    setLockedNoteId(noteId);
    const unlock = () => setLockedNoteId((current) => (current === noteId ? null : current));

    if (!(await drafts.saveNote(noteId))) {
      unlock();
      setActionError("This note has edits that are not saved yet, so it was not moved to the trash.");
      return;
    }

    try {
      await trashNoteRequest(noteId);
      drafts.forget(noteId);
      unlock();
      leaveNote(noteId, { text: "Note moved to the trash. It is deleted for good after 30 days." });
    } catch (error) {
      unlock();

      if (activeNoteIdRef.current === noteId) {
        setNoteError(error instanceof Error ? error.message : "Unable to delete the note.");
      } else {
        setActionError(error instanceof Error ? error.message : "Unable to delete the note.");
      }
    }
  };

  const handleRestore = async () => {
    if (!note) {
      return;
    }

    const noteId = note.id;

    try {
      const restored = await restoreNoteRequest(noteId);
      refreshList();
      refreshSidebar();

      if (activeNoteIdRef.current === noteId) {
        openLoadedNote(restored);
        setNotice({ text: "Note restored." });
      }
    } catch (error) {
      if (activeNoteIdRef.current === noteId) {
        setNoteError(error instanceof Error ? error.message : "Unable to restore the note.");
      }
    }
  };

  const handleDeleteForever = async () => {
    if (
      !note ||
      (note.wiki && !note.wiki.canDeletePermanently) ||
      !(await confirm({
        title: `Delete "${note.displayTitle}" forever?`,
        body: "The note and its attachments are removed for good. This can't be undone.",
        confirmLabel: "Delete forever",
        tone: "danger",
      }))
    ) {
      return;
    }

    const noteId = note.id;

    try {
      await deleteNoteForeverRequest(noteId);
      drafts.forget(noteId);
      leaveNote(noteId, null);
    } catch (error) {
      if (activeNoteIdRef.current === noteId) {
        setNoteError(error instanceof Error ? error.message : "Unable to delete the note.");
      }
    }
  };

  const handleExportMarkdown = async () => {
    if (!note) {
      return;
    }

    const noteId = note.id;

    if (!(await drafts.saveNote(noteId))) {
      setNoteError("Save this note before exporting it (see the message above).");
      return;
    }

    const latest = drafts.latestOf(noteId);
    const title = (latest.title ?? note.title).trim();
    const body = latest.content?.markdown ?? note.contentMarkdown;
    const markdown = title ? `# ${title}\n\n${body}` : body;
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `${(title || note.displayTitle || "note").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 80)}.md`;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const handleHomeChange = async (value: string) => {
    if (!note || note.wiki || value === encodeHome(note)) {
      return;
    }

    const [kind, first, second] = value.split(":");

    if (kind === "personal") {
      if (note.home.kind === "board") {
        // A new note has nothing to share yet, so it moves without asking.
        const confirmed =
          isDraft ||
          (await confirm({
            title: "Make this a personal note?",
            body: `"${note.displayTitle}" leaves ${note.home.boardTitle}. Only you will be able to see it.`,
            confirmLabel: "Make personal",
          }));

        if (!confirmed) {
          return;
        }

        await applyUpdate({ home: { boardId: null }, notebookId: first || null }, OWNED.home, { refreshList: true });
        return;
      }

      await applyUpdate({ notebookId: first || null }, OWNED.home, { refreshList: true });
      return;
    }

    const board = homeOptions.find((option) => option.boardId === first);

    if (!board) {
      return;
    }

    // A new note has nothing to share yet, so it moves without asking.
    if (!isDraft && (note.home.kind === "personal" || note.home.boardId !== board.boardId)) {
      const confirmed = await confirm({
        title: `Move to ${board.title}?`,
        body: `Everyone with access to ${board.title} will be able to see "${note.displayTitle}".`,
        confirmLabel: "Move note",
      });

      if (!confirmed) {
        return;
      }
    }

    await applyUpdate({ home: { boardId: board.boardId, bucketId: second || null } }, OWNED.home, {
      refreshList: true,
    });
  };

  // Link, unlink, and Convert to task for a note run one at a time, so their
  // replies apply in order.
  const linkQueueRef = useRef<Promise<void>>(Promise.resolve());
  const [isConvertOpen, setIsConvertOpen] = useState(false);
  const [convertBucketValue, setConvertBucketValue] = useState("");

  const editableBucketOptions = useMemo(
    () =>
      homeOptions
        .filter((board) => board.canEdit)
        .flatMap((board) =>
          board.buckets.map((bucket) => ({
            value: `${board.boardId}:${bucket.id}`,
            label: `${board.title} · ${bucket.title}`,
          })),
        ),
    [homeOptions],
  );

  const openConvert = () => {
    if (!note) {
      return;
    }

    const preferred =
      note.home.kind === "board" && note.home.bucketId
        ? `${note.home.boardId}:${note.home.bucketId}`
        : editableBucketOptions.find((option) => option.value.startsWith(`${linkableTasksBoardId}:`))?.value ??
          editableBucketOptions[0]?.value ??
          "";
    setConvertBucketValue(preferred);
    setIsConvertOpen(true);
  };

  const handleConvert = async () => {
    if (!note || !convertBucketValue) {
      return;
    }

    const noteId = note.id;
    const [boardId, bucketId] = convertBucketValue.split(":");

    // The task takes the note's title, so the latest title must be saved.
    if (!(await drafts.saveNote(noteId))) {
      setNoteError("Save this note before creating a task from it.");
      return;
    }

    try {
      const queued = linkQueueRef.current.then(() =>
        convertNoteToTaskRequest(noteId, { boardId, bucketId, timeZone: getTimeZone() }),
      );
      linkQueueRef.current = queued.then(
        () => undefined,
        () => undefined,
      );
      const result = await queued;
      patchSummary(result.note, OWNED.links);
      setNote((current) => (current && current.id === noteId ? mergeOwned(current, result.note, OWNED.links) : current));

      if (activeNoteIdRef.current === noteId) {
        setIsConvertOpen(false);
        setNotice({
          text: "Task created and linked to this note.",
          href: `/?boardId=${encodeURIComponent(result.boardId)}&taskId=${encodeURIComponent(result.taskId)}`,
          hrefLabel: "Open task",
        });
      }
    } catch (error) {
      if (activeNoteIdRef.current === noteId) {
        setNoteError(error instanceof Error ? error.message : "Unable to create the task.");
      }
    }
  };

  const runLinkChange = (request: (noteId: string) => Promise<NoteDetail>, failure: string) => {
    if (!note) {
      return Promise.resolve();
    }

    // Linking a task to a draft creates it first.
    const resolving = resolveOpenNoteId();
    const next = linkQueueRef.current
      .then(() => resolving)
      .then((noteId) => (noteId ? applyLinkChange(noteId, request, failure) : undefined));
    linkQueueRef.current = next;
    return next;
  };

  const applyLinkChange = async (
    noteId: string,
    request: (noteId: string) => Promise<NoteDetail>,
    failure: string,
  ) => {
    try {
      const updated = await request(noteId);
      patchSummary(updated, OWNED.links);
      setNote((current) => (current && current.id === noteId ? mergeOwned(current, updated, OWNED.links) : current));
    } catch (error) {
      if (activeNoteIdRef.current === noteId) {
        setNoteError(error instanceof Error ? error.message : failure);
      }
    }
  };

  const [boardLabelsReload, setBoardLabelsReload] = useState(0);
  // The label being typed belongs to the note it was typed in; a ref lets every
  // way of leaving the field commit it exactly once.
  const [labelDraftState, setLabelDraftState] = useState({ noteId: null as string | null, value: "" });
  const labelDraft = labelDraftState.noteId === editorNoteId ? labelDraftState.value : "";
  const labelDraftRef = useRef(labelDraftState);
  const setLabelDraft = (value: string) => {
    const next = { noteId: editorNoteId, value };
    labelDraftRef.current = next;
    setLabelDraftState(next);
  };
  const [boardLabels, setBoardLabels] = useState<{ boardId: string | null; labels: string[] }>({
    boardId: null,
    labels: [],
  });
  const noteBoardId = note?.home.kind === "board" ? note.home.boardId : null;
  const boardLabelSuggestions = boardLabels.boardId === noteBoardId ? boardLabels.labels : [];

  useEffect(() => {
    if (!noteBoardId) {
      return;
    }

    let cancelled = false;
    fetchBoardLabels(noteBoardId)
      .then((labels) => {
        if (!cancelled) {
          setBoardLabels({ boardId: noteBoardId, labels });
        }
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [noteBoardId, boardLabelsReload]);

  // --- Live updates -----------------------------------------------------------------

  // Notes changed elsewhere (another person, device): reload the
  // list, folders, tags, folder options and the open note together. Nothing
  // replaces what is shown while a notes change of this page is saving (that
  // load is thrown away and done again), and the open note changes only when
  // nothing is typed, sending or in conflict for it. Its text is replaced, and
  // the editor reset, only when its version moved; other changes (home,
  // labels, links, pin, trash) are merged in.
  const liveNotesToken = useLiveNotesToken();
  useWikiNoteAccess(note?.wiki ? note.id : undefined, access => {
    setNote(current => current && current.id === note?.id ? { ...current, canEdit: access.canEdit, deletedAt: access.deletedAt, wiki: access.wiki ?? current.wiki } : current);
  });
  const liveListRef = useRef({ listQuery, listLimit, listKey });
  useEffect(() => {
    liveListRef.current = { listQuery, listLimit, listKey };
  });
  useLiveRefresh(
    liveNotesToken,
    useCallback(
      async (isCurrent: () => boolean) => {
        const generation = liveWriteGeneration();
        const list = liveListRef.current;
        const openId = activeNoteIdRef.current;
        const open = openId && !isNewNoteDraftId(openId) && loadedNoteIdRef.current === openId ? openId : null;

        if (open && !drafts.isIdle(open)) {
          return false;
        }

        // The list is loaded on its own: a folder removed elsewhere makes it
        // fail, which must not stop the folders and the open note updating.
        const [listed, notebookListing, tagList, homes, openResult] = await Promise.all([
          fetchNotes({ ...list.listQuery, limit: list.listLimit }).then(
            (notes) => ({ notes }),
            (error: unknown) => ({ error }),
          ),
          fetchNotebooks(),
          fetchNoteTags(),
          fetchNoteHomes(),
          open
            ? fetchNote(open).then(
                (detail) => ({ detail }),
                (error: unknown) => ({ error }),
              )
            : Promise.resolve(null),
        ]);

        if (!isCurrent() || !canApplyLiveLoad(generation) || (open && !drafts.isIdle(open))) {
          return false;
        }

        // A list the server refused (a folder removed, access lost) is shown
        // as such and done; any other failure is tried again once the rest
        // is on screen.
        const listRetry =
          "error" in listed && !(listed.error instanceof NoteRequestError && listed.error.status >= 400 && listed.error.status < 500)
            ? listed.error
            : null;

        if (liveListRef.current.listKey === list.listKey && !listRetry) {
          if ("notes" in listed && Array.isArray(listed.notes)) {
            setNotes(listed.notes);
            setListState({ key: list.listKey, error: "", hasMore: listed.notes.length >= list.listLimit });
          } else {
            setListState({
              key: list.listKey,
              error: "error" in listed && listed.error instanceof Error ? listed.error.message : "Unable to load notes.",
              hasMore: false,
            });
          }
        }

        setNotebooks(notebookListing.notebooks);
        setInboxCount(notebookListing.inboxCount);
        setTags(tagList);
        setHomeOptions(homes);
        setBoardLabelsReload((value) => value + 1);

        if (open && openResult && activeNoteIdRef.current === open && loadedNoteIdRef.current === open) {
          if ("error" in openResult) {
            // Gone or no longer shared: say so. Anything else is tried again
            // (with backoff), so the note does not stay stale.
            if (!isNoteUnavailableError(openResult.error)) {
              throw openResult.error;
            }
            setNoteError(openResult.error instanceof Error ? openResult.error.message : "Unable to open the note.");
          } else if (openResult.detail.contentVersion > loadedVersionRef.current) {
            openLoadedNote(openResult.detail);
          } else {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { content: _content, contentMarkdown: _markdown, ...metadata } = openResult.detail;
            rememberLabels(openResult.detail);
            setNote((current) => (current && current.id === open ? { ...current, ...metadata } : current));
          }
        }

        if (listRetry) {
          throw listRetry;
        }

        return true;
      },
      [drafts, openLoadedNote, rememberLabels],
    ),
  );

  // Label changes run one at a time, each starting from the newest labels
  // the server reported for the note, so quick changes (or changes made while
  // a draft is being created) never overwrite each other or a fresh reload.
  const labelQueueRef = useRef<Promise<void>>(Promise.resolve());

  const changeLabels = (change: (labels: string[]) => string[]) => {
    if (!note) {
      return Promise.resolve();
    }

    const shown = note.labels;
    const target = resolveOpenNoteId();
    const run = labelQueueRef.current.then(async () => {
      const noteId = await target;

      if (!noteId) {
        return;
      }

      const base = knownLabelsRef.current.get(noteId)?.labels ?? shown;
      const labels = change(base);

      if (labels.length === base.length && labels.every((label, index) => label === base[index])) {
        return;
      }

      await applyUpdateTo(Promise.resolve(noteId), { labels }, OWNED.labels, { refreshList: true });
    });
    labelQueueRef.current = run;
    return run;
  };

  const addLabel = async () => {
    const draft = labelDraftRef.current;
    const label = draft.noteId === editorNoteId ? draft.value.replace(/\s+/g, " ").trim() : "";

    if (!note || !label) {
      return;
    }

    setLabelDraft("");
    await changeLabels((labels) =>
      labels.some((existing) => existing.toLowerCase() === label.toLowerCase()) ? labels : [...labels, label],
    );
  };

  const removeLabel = async (label: string) => {
    await changeLabels((labels) => labels.filter((existing) => existing !== label));
  };

  const uploadFile = useCallback(async (file: File) => {
    // Adding a file to a draft creates it first.
    const noteId = await resolveOpenNoteId();

    if (!noteId) {
      throw new Error("Open a note first.");
    }

    const attachments = await uploadNoteAttachmentRequest(noteId, file);
    setNote(current => current?.id === noteId ? { ...current, attachments } : current);
    const latest = attachments[attachments.length - 1];

    if (!latest) {
      throw new Error("The upload did not return a file.");
    }

    return getNoteAttachmentUrl(noteId, latest.id);
  }, [resolveOpenNoteId]);

  // --- Notebooks --------------------------------------------------------------------

  const notebookRows = useMemo(() => buildNotebookRows(notebooks), [notebooks]);
  const notebookPaths = useMemo(
    () => new Map(notebookRows.map(({ notebook, path }) => [notebook.id, path])),
    [notebookRows],
  );
  // Rows shown in the sidebar: children of collapsed notebooks are hidden.
  const visibleNotebookRows = useMemo(() => {
    const rows: NotebookRow[] = [];
    let hiddenBelowDepth: number | null = null;

    for (const row of notebookRows) {
      if (hiddenBelowDepth !== null && row.depth > hiddenBelowDepth) {
        continue;
      }

      hiddenBelowDepth = null;
      rows.push(row);

      if (row.hasChildren && !expandedNotebooks.has(row.notebook.id)) {
        hiddenBelowDepth = row.depth;
      }
    }

    return rows;
  }, [expandedNotebooks, notebookRows]);
  const selectedNotebook =
    filter.kind === "notebook" ? notebooks.find((notebook) => notebook.id === filter.notebookId) ?? null : null;

  // A new notebook is named in a field in the sidebar (at the top, or under
  // its parent); renaming edits the list heading in place.
  const [newNotebookParent, setNewNotebookParent] = useState<{ parentId: string | null } | null>(null);
  const [isRenamingNotebook, setIsRenamingNotebook] = useState(false);

  const startNewNotebook = (parentNotebookId: string | null) => {
    if (parentNotebookId) {
      expand([], [...notebookAncestors(notebooks, parentNotebookId), parentNotebookId]);
    }

    setNewNotebookParent({ parentId: parentNotebookId });
    // On a phone the field is in the folders pane.
    setMobilePane(isPhone && parentNotebookId ? "list" : "nav");
  };

  const createNotebook = async (title: string): Promise<string | null> => {
    try {
      const listing = await createNotebookRequest(title, newNotebookParent?.parentId ?? null);
      const target: NotesFilter = { kind: "notebook", notebookId: listing.notebook.id };
      setNewNotebookParent(null);
      setNotebooks(listing.notebooks);
      setInboxCount(listing.inboxCount);
      chooseFilter(target);
      revealFilter(target, listing.notebooks);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Unable to create the notebook.";
    }
  };

  const renameNotebook = async (title: string): Promise<string | null> => {
    if (!selectedNotebook) {
      setIsRenamingNotebook(false);
      return null;
    }

    try {
      const listing = await updateNotebookRequest(selectedNotebook.id, { title });
      setNotebooks(listing.notebooks);
      setIsRenamingNotebook(false);
      return null;
    } catch (error) {
      return error instanceof Error ? error.message : "Unable to rename the notebook.";
    }
  };

  const handleDeleteNotebook = async (target = selectedNotebook) => {
    if (
      !target ||
      !(await confirm({
        title: `Delete the notebook "${target.title}"?`,
        body: "Its notes and notebooks move up one level. No notes are deleted.",
        confirmLabel: "Delete notebook",
        tone: "danger",
      }))
    ) {
      return;
    }

    try {
      const listing = await deleteNotebookRequest(target.id);
      const nextFilter: NotesFilter = target.parentNotebookId
        ? { kind: "notebook", notebookId: target.parentNotebookId }
        : { kind: "inbox" };
      setNotebooks(listing.notebooks);
      setInboxCount(listing.inboxCount);
      if (filter.kind === "notebook" && filter.notebookId === target.id) {
        setFilter(nextFilter);
        revealFilter(nextFilter, listing.notebooks);
      }
      refreshList();
      // The open note may have moved up with this notebook.
      setNote(current => current?.notebookId === target.id ? { ...current, notebookId: target.parentNotebookId } : current);
      // The moved-up notebooks stay visible under the parent.
      if (target.parentNotebookId) {
        expand([], [target.parentNotebookId]);
      }
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to delete the notebook.");
    }
  };

  // Row actions carry their own identity; opening a menu never selects a note
  // or changes folders. In particular, note B cannot mutate open note A.
  const [itemMenu, setItemMenu] = useState<{ target: NotesItemTarget; anchor: ContextMenuAnchor } | null>(null);
  const [renameTarget, setRenameTarget] = useState<{ target: NotesItemTarget; view: string } | null>(null);
  const renameView = `${filterKey(filter)}:${debouncedSearch}`;
  const renamingItem = renameTarget?.view === renameView ? renameTarget.target : null;
  const renameRevision = useRef(0);
  const setRenamingItem = (target: NotesItemTarget | null) => {
    renameRevision.current += 1;
    setRenameTarget(target ? { target, view: renameView } : null);
  };
  const renameLockedNoteId = renamingItem?.kind === "note" ? renamingItem.item.id : null;
  const removedRowFocus = useRef<{ id: string; index: number } | null>(null);
  useEffect(() => {
    const pending = removedRowFocus.current;
    if (!pending || isListLoading || notes.some(item => item.id === pending.id)) return;
    removedRowFocus.current = null;
    // A completed row action owns focus only while the user has not moved it.
    if (document.activeElement !== document.body) return;
    const rows = document.querySelectorAll<HTMLButtonElement>("[data-note-row]");
    (rows[Math.min(pending.index, rows.length - 1)] ?? document.querySelector<HTMLButtonElement>('[aria-label="New note here"]'))?.focus({ preventScroll: true });
  }, [notes, isListLoading]);
  const [movingItem, setMovingItem] = useState<NotesItemTarget | null>(null);
  const [contextBusy, setContextBusy] = useState(false);
  const contextBusyRef = useRef(false);
  const [editRequest, setEditRequest] = useState<string | null>(null);

  useEffect(() => {
    if (editRequest && note?.id === editRequest) {
      const pane = document.querySelector(".notes-editor-pane");
      const focusEditor = () => {
        const editor = pane?.querySelector<HTMLElement>('.bn-editor[contenteditable="true"]');
        if (!editor) return false;
        editor.focus({ preventScroll: true });
        return true;
      };
      // The first editor is loaded dynamically. Wait for its DOM rather
      // than consuming the edit request before the editor has mounted.
      const observer = new MutationObserver(() => {
        if (focusEditor()) { observer.disconnect(); setEditRequest(null); }
      });
      if (pane) observer.observe(pane, { childList: true, subtree: true });
      const frame = window.requestAnimationFrame(() => {
        setMobileEditing(true);
        if (focusEditor()) { observer.disconnect(); setEditRequest(null); }
      });
      return () => { observer.disconnect(); window.cancelAnimationFrame(frame); };
    }
  }, [editRequest, note?.id]);

  const showItemMenu = (target: NotesItemTarget, trigger: HTMLElement, x?: number, y?: number) => {
    if (contextBusyRef.current || renamingItem) return;
    if (x === undefined && y === undefined && itemMenu?.anchor.trigger === trigger) { setItemMenu(null);return; }
    const rect = trigger.getBoundingClientRect();
    setActionError("");
    setItemMenu({ target, anchor: { x: x ?? rect.left, y: y ?? rect.bottom, trigger } });
  };
  const rowContextMenu = (event: ReactMouseEvent<HTMLElement>, target: NotesItemTarget) => {
    const element = event.target as HTMLElement;
    if (keepsNativeContextMenu(element, {
      pointerType: (event.nativeEvent as PointerEvent).pointerType,
      hasSelection: hasSelectionWithin(element),
      defaultPrevented: event.defaultPrevented,
    })) return;
    event.preventDefault(); event.stopPropagation();
    const trigger = element.closest("button") ?? event.currentTarget.querySelector("button") ?? event.currentTarget;
    showItemMenu(target, trigger, event.clientX || undefined, event.clientY || undefined);
  };
  const rowMenuKey = (event: ReactKeyboardEvent<HTMLElement>, target: NotesItemTarget) => {
    if (isContextMenuKey(event)) {
      event.preventDefault(); event.stopPropagation(); showItemMenu(target, event.currentTarget);
    }
  };
  const closeItemMenu = (restoreFocus: boolean) => {
    if (restoreFocus && itemMenu?.anchor.trigger.isConnected) itemMenu.anchor.trigger.focus({ preventScroll: true });
    setItemMenu(null);
  };
  const runContextAction = async (action: () => Promise<unknown>) => {
    if (contextBusyRef.current) return;
    contextBusyRef.current = true; setContextBusy(true); setActionError("");
    try { await action(); }
    catch (error) { setActionError(error instanceof Error ? error.message : "Unable to update this item."); }
    finally { contextBusyRef.current = false; setContextBusy(false); }
  };
  const cancelRenameItem = () => {
    const target = renamingItem;
    setRenamingItem(null);
    if (target) window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(target.kind === "note"
        ? `[data-note-row="${target.item.id}"]` : `[data-notebook-row="${target.item.id}"] .notes-nav-item`)?.focus({ preventScroll: true });
    });
  };
  const renameItem = async (title: string): Promise<string | null> => {
    if (!renamingItem) return null;
    const target = renamingItem;
    const revision = renameRevision.current;
    try {
      if (target.kind === "notebook") {
        const listing = await updateNotebookRequest(target.item.id, { title });
        setNotebooks(listing.notebooks);
      } else {
        const id = target.item.id;
        if (!(await drafts.saveNote(id))) return "Save or resolve this note's unsaved edits before renaming it.";
        // The open editor must keep the version of the body it actually shows.
        // Fetch/register is safe only for a note without a mounted editor.
        let version = loadedVersionRef.current;
        if (loadedNoteIdRef.current !== id) {
          const detail = await fetchNote(id);
          drafts.register(detail);
          version = detail.contentVersion;
        }
        drafts.edit(id, version, { title });
        if (activeNoteIdRef.current === id) setDraftTitle(title);
        if (!(await drafts.saveNote(id))) return "The rename could not be saved. Your edits are retained; retry or resolve the conflict in the note.";
      }
      if (renameRevision.current === revision) cancelRenameItem();
      refreshList();
      return null;
    } catch (error) { return error instanceof Error ? error.message : "Unable to rename this item."; }
  };

  const moveInitialValue = movingItem?.kind === "note" ? encodeHome(movingItem.item)
    : movingItem?.item.parentNotebookId ?? "";
  const moveOptions: NotesMoveOption[] = movingItem?.kind === "note" ? [
    { value: "personal:", label: "Inbox", group: "Personal (only you)" },
    ...notebookRows.map(({ notebook, path }) => ({ value: `personal:${notebook.id}`, label: path, group: "Personal (only you)" })),
    ...homeOptions.filter(board => board.canEdit).flatMap(board => [
      { value: `board:${board.boardId}:`, label: `${board.title} — whole board`, group: "Boards" },
      ...board.buckets.map(bucket => ({ value: `board:${board.boardId}:${bucket.id}`, label: `${board.title} · ${bucket.title}`, group: "Boards" })),
    ]),
  ] : [
    { value: "", label: "Top level", group: "Personal notebooks" },
    ...notebookRows.filter(({ notebook }) => movingItem && notebook.id !== movingItem.item.id && !notebookAncestors(notebooks, notebook.id).includes(movingItem.item.id))
      .map(({ notebook, path }) => ({ value: notebook.id, label: path, group: "Personal notebooks" })),
  ];
  const moveWarning = (value: string) => {
    if (movingItem?.kind !== "note") return null;
    const target = movingItem.item;
    if (value.startsWith("personal:") && target.home.kind === "board") return `This note leaves ${target.home.boardTitle}. Only you will be able to see it.`;
    const [, boardId] = value.split(":");
    if (value.startsWith("board:") && (target.home.kind === "personal" || target.home.boardId !== boardId)) {
      return `Everyone with access to ${homeOptions.find(board => board.boardId === boardId)?.title ?? "this board"} will be able to see this note.`;
    }
    return null;
  };
  const moveItem = async (value: string): Promise<string | null> => {
    if (!movingItem) return null;
    const target = movingItem;
    if (target.kind === "notebook") {
      const listing = await updateNotebookRequest(target.item.id, { parentNotebookId: value || null });
      setNotebooks(listing.notebooks); setInboxCount(listing.inboxCount);
      expand([], value ? [...notebookAncestors(listing.notebooks, value), value] : []);
      return null;
    }
    if (target.item.wiki) return "Move wiki pages with the wiki space action.";
    if (!(await drafts.saveNote(target.item.id))) return "Save or resolve this note's unsaved edits before moving it.";
    const [kind, first, second] = value.split(":");
    const body: UpdateNoteRequest = kind === "personal"
      ? { home: { boardId: null }, notebookId: first || null }
      : { home: { boardId: first, bucketId: second || null } };
    const updated = await applyUpdateTo(Promise.resolve(target.item.id), body, OWNED.home, { refreshList: true });
    return updated ? null : "Unable to move the note. Check your access and try again.";
  };

  let contextActions: ContextMenuAction[] = [];
  const menuTarget = itemMenu?.target;
  const smallIcon = (Icon: typeof Pencil) => <Icon className="h-3.5 w-3.5" aria-hidden="true" />;
  if (menuTarget?.kind === "note") {
    const target = menuTarget.item;
    const editable = target.canEdit && !target.deletedAt && !target.wiki?.spaceArchived && !drafts.isBlocked(target.id);
    const rename = () => {
      setRenamingItem({ kind: "note", item: { ...target, title: activeNoteIdRef.current === target.id ? draftTitle : target.title } });
    };
    contextActions = [
      { label: editable ? "Edit" : "Open", icon: smallIcon(Pencil), run: () => { selectNote(target.id); if (editable) setEditRequest(target.id); } },
      ...(!target.deletedAt ? [
        { label: "Rename…", icon: smallIcon(Pencil), disabled: !editable, run: rename },
        ...(!target.wiki ? [{ label: "Move to…", icon: smallIcon(Folder), disabled: !editable, run: () => setMovingItem(menuTarget) }] : [{ label: "Open in wiki", icon: smallIcon(FileText), run: () => { wikiRouter.push(target.wiki!.canonicalHref); } }, { label: "History", icon: smallIcon(FileText), run: () => { wikiRouter.push(`${target.wiki!.canonicalHref}?view=history`); } }]),
        { label: target.pinned ? "Unpin" : "Pin", icon: smallIcon(target.pinned ? PinOff : Pin), disabled: !editable, separator: true,
          run: () => void runContextAction(() => applyUpdateTo(Promise.resolve(target.id), { pinned: !target.pinned }, OWNED.pinned, { refreshList: true })) },
        { label: target.archived ? "Unarchive" : "Archive", icon: smallIcon(Archive), disabled: !editable,
          run: () => void runContextAction(async () => {
            const updated = await applyUpdateTo(Promise.resolve(target.id), { archived: !target.archived }, OWNED.archived, { refreshList: true });
            if (updated) removedRowFocus.current = { id: target.id, index: notes.findIndex(item => item.id === target.id) };
          }) },
      ] : []),
      { label: "Copy link", icon: smallIcon(Link2), run: () => void runContextAction(async () => {
        await navigator.clipboard.writeText(new URL(buildNotesHref({ noteId: target.id }), window.location.origin).href);
        setNotice({ text: "Note link copied. Access permissions are unchanged." });
      }) },
      ...(!target.deletedAt ? [{ label: "Move to trash", icon: smallIcon(Trash2), disabled: !editable, danger: true, separator: true,
        run: () => void runContextAction(() => handleTrash(target)) }] : []),
    ];
  } else if (menuTarget?.kind === "notebook") {
    const target = menuTarget.item;
    contextActions = [
      { label: "New note here", icon: smallIcon(Plus), run: () => { chooseFilter({ kind: "notebook", notebookId: target.id }); handleCreateNote({ notebookId: target.id }); } },
      { label: "New subfolder…", icon: smallIcon(FolderPlus), run: () => startNewNotebook(target.id) },
      { label: "Rename…", icon: smallIcon(Pencil), separator: true, run: () => setRenamingItem(menuTarget) },
      { label: "Move to…", icon: smallIcon(Folder), run: () => setMovingItem(menuTarget) },
      { label: "Delete folder…", icon: smallIcon(Trash2), danger: true, separator: true, run: () => void runContextAction(() => handleDeleteNotebook(target)) },
    ];
  }

  // --- Folder selection ----------------------------------------------------------------

  // Choosing a folder shows it: a running search ends, and boards and
  // notebooks open to show what is inside.
  const chooseFilter = (next: NotesFilter) => {
    setRenamingItem(null);
    removedRowFocus.current = null;
    if (searchQuery.trim() || isSearching) {
      onClearSearch();
      setDebouncedSearch("");
    }

    setFilter(next);
    setListPages(1);
    setActionError("");
    setIsRenamingNotebook(false);
    setMobilePane("list");

    if (next.kind === "board") {
      expand([next.boardId], []);
    } else if (next.kind === "notebook") {
      expand([], [...notebookAncestors(notebooks, next.notebookId), next.notebookId]);
    }
  };

  const isFilterActive = (candidate: NotesFilter) => !isSearching && filterKey(candidate) === filterKey(filter);

  const listTitle = (() => {
    if (isSearching) {
      return `Results for “${debouncedSearch.trim()}”`;
    }

    switch (filter.kind) {
      case "inbox":
        return "Inbox";
      case "pinned":
        return "Pinned";
      case "notebook":
        return notebookRows.find((row) => row.notebook.id === filter.notebookId)?.path ?? "Notebook";
      case "board": {
        const board = homeOptions.find((option) => option.boardId === filter.boardId);
        const bucket = board?.buckets.find((item) => item.id === filter.bucketId);
        return bucket ? `${board?.title} · ${bucket.title}` : board?.title ?? "Board";
      }
      case "tag":
        return `#${filter.name}`;
      case "archived":
        return "Archive";
      case "trash":
        return "Trash";
      default:
        return "All notes";
    }
  })();

  const canCreateHere =
    filter.kind !== "archived" &&
    filter.kind !== "trash" &&
    !(filter.kind === "board" && !homeOptions.find((option) => option.boardId === filter.boardId)?.canEdit);

  const isTrashed = Boolean(note?.deletedAt);
  const supportedFormat = useNoteFormatSupport(note?.content ?? [], note?.contentFormatVersion ?? 1);
  const canEditNote = Boolean(note?.canEdit) && !note?.wiki?.spaceArchived && supportedFormat && !isTrashed && !drafts.isBlocked(note?.id ?? "");
  const linkedTaskIds = useMemo(() => new Set(note?.linkedTasks.map((task) => task.id) ?? []), [note?.linkedTasks]);
  const saveState: NoteSaveState = isDraft && note ? drafts.newNoteStatus(note.id) : drafts.statusOf(note?.id);

  const mobileChildNotebooks = selectedNotebook ? notebooks.filter(item => item.parentNotebookId === selectedNotebook.id) : [];
  const mobileChildBoard = filter.kind === "board" && !filter.bucketId ? homeOptions.find(item => item.boardId === filter.boardId) : null;
  const goUpMobileFolder = () => {
    if (selectedNotebook?.parentNotebookId) chooseFilter({ kind: "notebook", notebookId: selectedNotebook.parentNotebookId });
    else if (filter.kind === "board" && filter.bucketId) chooseFilter({ kind: "board", boardId: filter.boardId, bucketId: null });
    else {
      setMobileFolderLocation(selectedNotebook ? "personal" : filter.kind === "board" ? "boards" : "root");
      setMobilePane("nav");
    }
  };
  const finishMobileEditing = () => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    if (note) void drafts.saveNote(note.id);
    setMobileEditing(false);
    setMobileFormatting(false);
  };

  // --- Column resizing -----------------------------------------------------------------

  const frameRef = useRef<HTMLDivElement | null>(null);
  const gridRef = useRef<HTMLDivElement | null>(null);
  const [frameWidth, setFrameWidth] = useState(0);
  const dragRef = useRef<{
    column: keyof NotesColumnWidths;
    pointerId: number;
    startX: number;
    startWidth: number;
    width: number;
    target: HTMLElement;
  } | null>(null);

  const effectiveWidths = useMemo(
    () => (frameWidth > 0 ? getEffectiveNotesColumnWidths(prefs.widths, frameWidth, mobilePane) : prefs.widths),
    [frameWidth, mobilePane, prefs.widths],
  );
  const layoutMode = isPhone ? "single" : getNotesLayoutMode(frameWidth || NOTES_LAYOUT.wideMin);
  const visibleColumns = getVisibleNotesColumns(layoutMode, mobilePane);

  const endDrag = useCallback((commit: boolean) => {
    const drag = dragRef.current;

    if (!drag) {
      return;
    }

    dragRef.current = null;
    document.body.classList.remove("notes-resizing");
    drag.target.removeAttribute("data-dragging");

    try {
      drag.target.releasePointerCapture(drag.pointerId);
    } catch {
      // Already released.
    }

    if (commit) {
      updateNotesUiPrefs(viewerId, (current) => ({ ...current, widths: { ...current.widths, [drag.column]: drag.width } }));
    } else {
      gridRef.current?.style.setProperty(`--notes-${drag.column}-width`, `${drag.startWidth}px`);
    }
  }, [viewerId]);

  useEffect(() => {
    const frame = frameRef.current;

    if (!frame) {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const width = Math.round(entries[0]?.contentRect.width ?? frame.clientWidth);
      setFrameWidth(width);

      // A breakpoint that hides the dragged column ends the drag.
      const drag = dragRef.current;

      if (drag && !getVisibleNotesColumns(getNotesLayoutMode(width), mobilePane)[drag.column]) {
        endDrag(false);
      }
    });

    observer.observe(frame);
    return () => observer.disconnect();
  }, [endDrag, mobilePane]);

  useEffect(() => () => endDrag(false), [endDrag]);

  const startDrag = (column: keyof NotesColumnWidths) => (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    event.preventDefault();
    const target = event.currentTarget;
    target.setPointerCapture(event.pointerId);
    target.setAttribute("data-dragging", "true");
    document.body.classList.add("notes-resizing");
    dragRef.current = {
      column,
      pointerId: event.pointerId,
      startX: event.clientX,
      startWidth: effectiveWidths[column],
      width: effectiveWidths[column],
      target,
    };
  };

  const moveDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;

    if (!drag || drag.pointerId !== event.pointerId) {
      return;
    }

    const frameWidthNow = Math.round(frameRef.current?.getBoundingClientRect().width ?? frameWidth);
    const bounds = getNotesColumnBounds(drag.column, effectiveWidths, frameWidthNow, mobilePane);
    const width = Math.round(Math.min(Math.max(drag.startWidth + event.clientX - drag.startX, bounds.min), bounds.max));
    drag.width = width;
    // Live width without re-rendering the editor on every pointer move.
    gridRef.current?.style.setProperty(`--notes-${drag.column}-width`, `${width}px`);
  };

  const setColumnWidth = (column: keyof NotesColumnWidths, width: number) => {
    const bounds = getNotesColumnBounds(column, effectiveWidths, frameWidth, mobilePane);
    const next = Math.round(Math.min(Math.max(width, bounds.min), bounds.max));
    updateNotesUiPrefs(viewerId, (current) => ({ ...current, widths: { ...current.widths, [column]: next } }));
  };

  const separatorKeyDown = (column: keyof NotesColumnWidths) => (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 64 : 16;
    const bounds = getNotesColumnBounds(column, effectiveWidths, frameWidth, mobilePane);
    const current = effectiveWidths[column];
    const next =
      event.key === "ArrowLeft"
        ? current - step
        : event.key === "ArrowRight"
          ? current + step
          : event.key === "Home"
            ? bounds.min
            : event.key === "End"
              ? bounds.max
              : null;

    if (next !== null) {
      event.preventDefault();
      setColumnWidth(column, next);
    }
  };

  const separator = (column: keyof NotesColumnWidths, label: string) => {
    const bounds = getNotesColumnBounds(column, effectiveWidths, frameWidth, mobilePane);
    return (
      <div
        className="notes-separator"
        data-column={column}
        role="separator"
        aria-orientation="vertical"
        aria-label={label}
        aria-valuenow={effectiveWidths[column]}
        aria-valuemin={bounds.min}
        aria-valuemax={bounds.max}
        tabIndex={visibleColumns[column] ? 0 : -1}
        title="Drag to resize; double-click to reset"
        onPointerDown={startDrag(column)}
        onPointerMove={moveDrag}
        onPointerUp={() => endDrag(true)}
        onPointerCancel={() => endDrag(false)}
        onLostPointerCapture={() => endDrag(true)}
        onDoubleClick={() => setColumnWidth(column, NOTES_LAYOUT[column].default)}
        onKeyDown={separatorKeyDown(column)}
      />
    );
  };

  const gridStyle = {
    "--notes-sidebar-width": `${effectiveWidths.sidebar}px`,
    "--notes-list-width": `${effectiveWidths.list}px`,
    "--notes-reading-scale": prefs.readingScale / 100,
  } as CSSProperties;

  // --- Rendering ------------------------------------------------------------------------

  const navItem = (
    candidate: NotesFilter,
    label: string,
    Icon: typeof Inbox,
    options: {
      count?: number;
      depth?: number;
      // Rows in the notebook and board trees keep a chevron column.
      tree?: boolean;
      expandable?: { expanded: boolean; onToggle: () => void };
    } = {},
  ) => {
    const active = isFilterActive(candidate);
    const bucketContext = candidate.kind === "board"
      ? findNotesBucketContext(bucketContexts, candidate.boardId, candidate.bucketId)
      : undefined;
    const depth = options.depth ?? 0;
    const notebook = candidate.kind === "notebook" ? notebooks.find(item => item.id === candidate.notebookId) : null;
    const rowTarget: NotesItemTarget | null = notebook ? { kind: "notebook", item: notebook } : null;
    const renaming = rowTarget && renamingItem?.kind === "notebook" && renamingItem.item.id === rowTarget.item.id;

    return (
      <div className="notes-nav-row" style={depth ? { paddingInlineStart: `${depth * 14}px` } : undefined}
        data-notebook-row={notebook?.id} onContextMenu={rowTarget ? event => rowContextMenu(event, rowTarget) : undefined}>
        {options.expandable ? (
          <button
            type="button"
            className="notes-nav-toggle"
            aria-label={options.expandable.expanded ? `Collapse ${label}` : `Expand ${label}`}
            aria-expanded={options.expandable.expanded}
            onClick={options.expandable.onToggle}
          >
            {options.expandable.expanded ? (
              <ChevronDown className="h-3 w-3" aria-hidden="true" />
            ) : (
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
            )}
          </button>
        ) : options.tree ? (
          <span className="notes-nav-toggle-spacer" aria-hidden="true" />
        ) : null}
        {renaming && notebook ? <InlineNameField key={notebook.id} initialValue={notebook.title}
          placeholder="Notebook name" label="Rename folder" className="notes-row-rename" onSubmit={renameItem} onCancel={cancelRenameItem} /> : <button
          type="button"
          className="notes-nav-item"
          data-active={active}
          data-notes-context={bucketContext ? "bucket" : undefined}
          style={notesBucketStyle(bucketContext)}
          aria-current={active ? "true" : undefined}
          onClick={() => chooseFilter(candidate)}
          onKeyDown={rowTarget ? event => rowMenuKey(event, rowTarget) : undefined}
        >
          {bucketContext ? <NoteContextMark context={bucketContext} /> : <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
          <span className="truncate">{label}</span>
          {options.count ? <span className="notes-nav-count">{options.count}</span> : null}
        </button>}
        {rowTarget && !renaming ? <button type="button" className="notes-icon-button notes-row-actions"
          aria-label={`Folder actions for ${label}`} aria-haspopup="menu" disabled={contextBusy}
          aria-expanded={itemMenu?.target.kind === "notebook" && itemMenu.target.item.id === notebook?.id}
          onClick={event => showItemMenu(rowTarget, event.currentTarget)}><MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" /></button> : null}
      </div>
    );
  };

  const saveLabel: Record<NoteSaveState, string> = {
    idle: "",
    pending: "Editing…",
    saving: "Saving…",
    saved: "Saved",
    error: "Couldn't save — will retry on the next change",
    conflict: "Not saved",
  };

  const listCountLabel = isListLoading && notes.length === 0 ? "" : `${notes.length}${hasMoreNotes ? "+" : ""}`;
  // Desktop controls take Taskboard's shared classes; the phone keeps its own.
  const desktopClass = (className: string) => (isPhone ? "" : ` ${className}`);
  const homeSelectOptions = (
    <>
      <optgroup label="Personal (only you)">
        <option value="personal:">Inbox</option>
        {notebookRows.map(({ notebook, path }) => (
          <option key={notebook.id} value={`personal:${notebook.id}`}>
            {path}
          </option>
        ))}
      </optgroup>
      {homeOptions.map((board) => (
        <optgroup key={board.boardId} label={board.canEdit ? board.title : `${board.title} (read-only)`}>
          <option value={`board:${board.boardId}:`} disabled={!board.canEdit}>
            {board.title} — whole board
          </option>
          {board.buckets.map((bucket) => (
            <option key={bucket.id} value={`board:${board.boardId}:${bucket.id}`} disabled={!board.canEdit}>
              {board.title} · {bucket.title}
            </option>
          ))}
        </optgroup>
      ))}
    </>
  );
  // Where a note lives, shown on desktop rows only when the list mixes homes.
  const rowContext = (item: NoteSummary) => {
    const place = item.home.kind === "personal"
      ? item.notebookId ? notebookPaths.get(item.notebookId) ?? "Personal" : "Inbox"
      : homeLabel(item);
    if (isSearching) return place;
    if (filter.kind === "notebook" || filter.kind === "inbox") return null;
    if (filter.kind === "board") return filter.bucketId || item.home.kind !== "board" ? null : item.home.bucketTitle;
    return place;
  };

  // Note properties: the phone's Note details sheet, or the desktop strip.
  const renderNoteProperties = (note: NoteDetail) => {
  const labelField = (className: string) => <>
    <input
      className={className}
      value={labelDraft}
      placeholder={note.home.kind === "board" ? "Add label" : "Add tag"}
      aria-label={note.home.kind === "board" ? "Add label" : "Add tag"}
      list="notes-label-suggestions"
      maxLength={60}
      onChange={(event) => setLabelDraft(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === ",") {
          event.preventDefault();
          void addLabel();
        }
      }}
      onBlur={() => void addLabel()}
    />
    <datalist id="notes-label-suggestions">
      {(note.home.kind === "board" ? boardLabelSuggestions : tags.map((tag) => tag.name)).map(
        (label) => (
          <option key={label} value={label} />
        ),
      )}
    </datalist>
  </>;
  const linkPicker = (onPicked?: () => void) => (
    <TaskLinkPicker
      key={note.id}
      isPhone={isPhone}
      boards={homeOptions}
      initialBoardId={
        noteBoardId && homeOptions.some((board) => board.boardId === noteBoardId)
          ? noteBoardId
          : homeOptions.some((board) => board.boardId === linkableTasksBoardId)
            ? linkableTasksBoardId
            : homeOptions[0].boardId
      }
      shellBoardId={linkableTasksBoardId}
      shellTasks={linkableTasks}
      excludeIds={linkedTaskIds}
      onPick={(taskId) => {
        void runLinkChange((noteId) => linkNoteTaskRequest(noteId, taskId), "Unable to link the task.");
        onPicked?.();
      }}
    />
  );
  return isPhone ? <div ref={detailsPanelRef} className="notes-meta" role={mobileDetails ? "dialog" : undefined} aria-label="Note details" data-section={detailsSection}>
    <header className="notes-mobile-details-header">
      {detailsSection !== "overview" ? <button type="button" className="notes-icon-button" aria-label="Back to note details" onClick={() => setDetailsSection("overview")}><ArrowLeft aria-hidden="true" /></button> : null}
      <strong>{detailsSection === "overview" ? "Note details" : detailsSection === "home" ? "Home" : detailsSection === "tags" ? "Tags & labels" : detailsSection === "links" ? "Linked tasks" : "Attachments"}</strong>
      <button type="button" className="notes-icon-button" aria-label="Close note details" onClick={() => { setMobileDetails(false); detailsButtonRef.current?.focus(); }}><X aria-hidden="true" /></button>
    </header>
    <div className="notes-mobile-details-overview">
      {[["home", "Home", Folder], ["tags", note.home.kind === "board" ? "Labels" : "Tags", Tag], ["links", "Linked tasks", Link2], ["attachments", "Attachments", Paperclip]].map(([key, title, Icon]) => {
        const RowIcon = Icon as typeof Folder;
        return <button type="button" key={String(key)} onClick={() => setDetailsSection(String(key))}><RowIcon aria-hidden="true" /><span>{String(title)}</span><ChevronRight aria-hidden="true" /></button>;
      })}
    </div>
    {canEditNote ? <button type="button" className="ui-button" aria-pressed={note.pinned} onClick={() => void applyUpdate({ pinned: !note.pinned }, OWNED.pinned, { refreshList: true })}>{note.pinned ? "Unpin note" : "Pin note"}</button> : null}
    <label className="notes-meta-row" data-detail="home">
      <span className="notes-meta-label">Home</span>
      {note.wiki ? <Link href={note.wiki.canonicalHref}>{note.wiki.spaceTitle} ↗</Link> : <select className="notes-select" value={encodeHome(note)} disabled={!canEditNote} onChange={(event) => void handleHomeChange(event.target.value)}>
        {homeSelectOptions}
      </select>}
    </label>

    <div className="notes-meta-row" data-detail="tags">
      <span className="notes-meta-label">{note.home.kind === "board" ? "Labels" : "Tags"}</span>
      <div className="notes-chip-row">
        {note.labels.map((label) => (
          <span key={label} className="notes-chip">
            <span className="notes-chip-text" title={label}>{label}</span>
            {canEditNote ? (
              <button type="button" aria-label={`Remove ${label}`} onClick={() => void removeLabel(label)}>
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            ) : null}
          </span>
        ))}
        {canEditNote ? labelField("notes-chip-input") : null}
      </div>
    </div>

    <div className="notes-meta-row" data-detail="links">
      <span className="notes-meta-label">Linked to</span>
      <div className="notes-chip-row">
        {note.linkedTasks.map((task) => (
          <span key={task.id} className="notes-chip notes-task-chip" data-status={task.status}>
            <Link
              href={`/?boardId=${encodeURIComponent(task.boardId)}&taskId=${encodeURIComponent(task.id)}`}
              title={`${task.boardTitle}${task.bucketTitle ? ` · ${task.bucketTitle}` : ""}`}
            >
              {task.title}
            </Link>
            {canEditNote ? (
              <button
                type="button"
                aria-label={`Unlink ${task.title}`}
                onClick={() =>
                  void runLinkChange((noteId) => unlinkNoteTaskRequest(noteId, task.id), "Unable to unlink the task.")
                }
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            ) : null}
          </span>
        ))}
        {note.linkedTasks.length === 0 && !canEditNote ? (
          <span className="notes-meta-empty">No linked tasks</span>
        ) : null}
      </div>
    </div>
    {canEditNote && homeOptions.length > 0 ? (
      <div className="notes-meta-row" data-detail="links">
        <span className="notes-meta-label" aria-hidden="true" />
        {linkPicker()}
      </div>
    ) : null}
    <div data-detail="attachments"><MobileNoteAttachments key={note.id} noteId={note.id} attachments={note.attachments} canEdit={canEditNote} onUpload={file => note.wiki ? drafts.runExclusive(note.id, () => uploadFile(file)) : uploadFile(file)} onRemove={async id => {
      if (note.wiki) await drafts.runExclusive(note.id, () => deleteNoteAttachmentRequest(note.id, id));
      else await deleteNoteAttachmentRequest(note.id, id);
      setNote(current => current?.id === note.id ? { ...current, attachments: current.attachments.filter(file => file.id !== id) } : current);
    }} /></div>
  </div> : <NotePropertyStrip
    key={editorNoteId ?? note.id}
    homeContext={noteBucketContext(bucketContexts, note)}
    home={note.wiki ? <Link href={note.wiki.canonicalHref}>{note.wiki.spaceTitle} ↗</Link> : <select aria-label="Home" className="notes-select notes-strip-select ui-select ed-field" value={encodeHome(note)}
      disabled={!canEditNote} onChange={(event) => void handleHomeChange(event.target.value)}>{homeSelectOptions}</select>}
    labelNoun={note.home.kind === "board" ? "label" : "tag"}
    labels={note.labels}
    canEdit={canEditNote}
    onRemoveLabel={(label) => void removeLabel(label)}
    labelInput={labelField("notes-chip-input ui-inline-input ed-field")}
    onLabelPopupClose={() => void addLabel()}
    linkedTasks={note.linkedTasks}
    onUnlink={(taskId) => void runLinkChange((noteId) => unlinkNoteTaskRequest(noteId, taskId), "Unable to unlink the task.")}
    renderPicker={homeOptions.length > 0 ? (done) => linkPicker(done) : null}
  />;
  };

  return (
    <div className={`notes-frame ${linen.root}`} ref={frameRef} data-editor-scale={isPhone ? undefined : "true"}>
      <div
        className="notes-workspace"
        ref={gridRef}
        style={gridStyle}
        data-pane={mobilePane}
        data-mobile-details={mobileDetails ? "true" : undefined}
        data-testid="notes-workspace"
      >
        <nav className="notes-sidebar notes-desktop-folders pretty-scrollbar" aria-label="Notes folders">
          <button
            type="button"
            className="notes-new-button ui-button ui-button-primary"
            onClick={() => handleCreateNote({})}
          >
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            New note
          </button>

          <div className="notes-nav-group">
            {navItem({ kind: "all" }, "All notes", FileText)}
            {navItem({ kind: "inbox" }, "Inbox", Inbox, { count: inboxCount })}
            {navItem({ kind: "pinned" }, "Pinned", Pin)}
          </div>

          <div className="notes-nav-group">
            <div className="notes-nav-heading">
              <span>Notebooks</span>
              <button
                type="button"
                className="notes-icon-button"
                aria-label="New notebook"
                title="New notebook"
                onClick={() => startNewNotebook(null)}
              >
                <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </div>
            {newNotebookParent && newNotebookParent.parentId === null ? (
              <InlineNameField
                className="notes-inline-name"
                placeholder="Notebook name"
                label="New notebook name"
                onSubmit={createNotebook}
                onCancel={() => setNewNotebookParent(null)}
              />
            ) : null}
            {notebookRows.length === 0 && !newNotebookParent ? (
              <p className="notes-nav-empty">No notebooks yet</p>
            ) : null}
            {visibleNotebookRows.map(({ notebook, depth, hasChildren }) => (
              <div key={notebook.id}>
                {navItem({ kind: "notebook", notebookId: notebook.id }, notebook.title, Folder, {
                  count: notebook.noteCount,
                  depth,
                  tree: true,
                  expandable: hasChildren
                    ? {
                        expanded: expandedNotebooks.has(notebook.id),
                        onToggle: () => toggleExpanded("notebook", notebook.id),
                      }
                    : undefined,
                })}
                {newNotebookParent?.parentId === notebook.id ? (
                  <InlineNameField
                    className="notes-inline-name"
                    placeholder="Notebook name"
                    label={`New notebook inside ${notebook.title}`}
                    style={{ paddingInlineStart: `${(depth + 1) * 14}px` }}
                    onSubmit={createNotebook}
                    onCancel={() => setNewNotebookParent(null)}
                  />
                ) : null}
              </div>
            ))}
          </div>

          <div className="notes-nav-group">
            <div className="notes-nav-heading">
              <span>Boards</span>
            </div>
            {homeOptions.map((board) => {
              const expanded = expandedBoards.has(board.boardId);
              return (
                <div key={board.boardId}>
                  {navItem({ kind: "board", boardId: board.boardId, bucketId: null }, board.title, LayoutGrid, {
                    tree: true,
                    expandable:
                      board.buckets.length > 0
                        ? { expanded, onToggle: () => toggleExpanded("board", board.boardId) }
                        : undefined,
                  })}
                  {expanded
                    ? board.buckets.map((bucket) => (
                        <div key={bucket.id}>
                          {navItem(
                            { kind: "board", boardId: board.boardId, bucketId: bucket.id },
                            bucket.title,
                            ListChecks,
                            { depth: 1, tree: true },
                          )}
                        </div>
                      ))
                    : null}
                </div>
              );
            })}
          </div>

          {tags.length > 0 ? (
            <div className="notes-nav-group">
              <div className="notes-nav-heading">
                <span>Tags</span>
              </div>
              {tags.map((tag) => (
                <div key={tag.name}>{navItem({ kind: "tag", name: tag.name }, tag.name, Tag, { count: tag.noteCount })}</div>
              ))}
            </div>
          ) : null}

          <div className="notes-nav-group">
            {navItem({ kind: "archived" }, "Archive", Archive)}
            {navItem({ kind: "trash" }, "Trash", Trash2)}
          </div>
        </nav>

        {isPhone ? <nav className="notes-sidebar notes-phone-folders pretty-scrollbar" aria-label="Phone notes folders">
          <MobileNoteFolders location={mobileFolderLocation} onLocation={setMobileFolderLocation}
            notebooks={notebooks} boards={homeOptions} tags={tags} onChoose={chooseFilter}
            onBack={() => setMobilePane("list")} onNewNotebook={() => startNewNotebook(null)} />
          {newNotebookParent ? <InlineNameField className="notes-inline-name" label="New notebook name" placeholder="Notebook name"
            onSubmit={createNotebook} onCancel={() => setNewNotebookParent(null)} /> : null}
          <button type="button" className="notes-mobile-new" aria-label="New note here" onClick={() => handleCreateNote()}><Pencil aria-hidden="true" /></button>
        </nav> : null}

        {separator("sidebar", "Resize the folders column")}

        <section className="notes-list-pane" aria-label="Notes list" data-notes-context={listContext ? "bucket" : undefined} style={notesBucketStyle(listContext)}>
          <header className="notes-pane-header">
            <button
              type="button"
              className={`notes-icon-button notes-show-folders${isPhone && !selectedNotebook && filter.kind !== "board" ? " notes-mobile-location-button" : ""}`}
              aria-label="Show folders"
              onClick={() => isPhone ? goUpMobileFolder() : setMobilePane("nav")}
            >
              {isPhone && !selectedNotebook && filter.kind !== "board" ? <Folder className="h-4 w-4" aria-hidden="true" /> : <ArrowLeft className="h-4 w-4" aria-hidden="true" />}
              {isPhone && !selectedNotebook && filter.kind !== "board" ? <><span>{listTitle}</span><ChevronDown className="h-4 w-4" aria-hidden="true" /></> : null}
            </button>
            <NoteContextMark context={listContext} />
            {isRenamingNotebook && selectedNotebook && !isSearching ? (
              <InlineNameField
                className="notes-inline-name notes-pane-rename"
                initialValue={selectedNotebook.title}
                placeholder="Notebook name"
                label="Rename notebook"
                onSubmit={renameNotebook}
                onCancel={() => setIsRenamingNotebook(false)}
              />
            ) : (
              <h2 className={isPhone && !selectedNotebook && filter.kind !== "board" ? "sr-only" : "notes-pane-title truncate"} title={listTitle}>
                {isPhone && selectedNotebook && !isSearching ? selectedNotebook.title : listTitle}
              </h2>
            )}
            {listCountLabel ? (
              <span className="notes-pane-count" aria-label={`${listCountLabel} notes`}>
                {listCountLabel}{isPhone ? ` ${notes.length === 1 ? "note" : "notes"}` : ""}
              </span>
            ) : null}
            {selectedNotebook && !isSearching && !isRenamingNotebook ? isPhone ? <MobileFolderActions onRename={() => setIsRenamingNotebook(true)} onCreate={() => startNewNotebook(selectedNotebook.id)} onDelete={() => void handleDeleteNotebook()} /> : (
              <div className="notes-pane-actions">
                <button
                  type="button"
                  className="notes-icon-button"
                  title="Rename notebook"
                  aria-label="Rename notebook"
                  onClick={() => setIsRenamingNotebook(true)}
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="notes-icon-button"
                  title="New notebook inside"
                  aria-label="New notebook inside this one"
                  onClick={() => startNewNotebook(selectedNotebook.id)}
                >
                  <FolderPlus className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="notes-icon-button"
                  title="Delete notebook"
                  aria-label="Delete notebook"
                  onClick={() => void handleDeleteNotebook()}
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : null}
            {canCreateHere ? (
              <button
                type="button"
                className="notes-icon-button notes-list-create"
                aria-label="New note here"
                title="New note here"
                onClick={() => handleCreateNote()}
              >
                <Plus className="h-4 w-4" aria-hidden="true" />
              </button>
            ) : null}
          </header>

          {notice && !selectedNoteId ? <p className="notes-notice">{notice.text}</p> : null}
          {listError ? <p className="notes-error">{listError}</p> : null}

          {isPhone && selectedNotebook && !isSearching ? <p className="notes-mobile-path">{listTitle}</p> : null}
          {isPhone && newNotebookParent ? <InlineNameField className="notes-inline-name" label="New notebook name" placeholder="Notebook name"
            onSubmit={createNotebook} onCancel={() => setNewNotebookParent(null)} /> : null}

          <div className="notes-list pretty-scrollbar" role="list" aria-busy={isListLoading}>
            {isPhone && !isSearching && (mobileChildNotebooks.length || mobileChildBoard?.buckets.length) ? <>
              <MobileNoteFolderRows notebooks={notebooks} boards={homeOptions}
                parentNotebookId={selectedNotebook?.id} boardId={mobileChildBoard?.boardId} onChoose={chooseFilter} />
              <p className="notes-mobile-section">Notes</p>
            </> : null}
            {isListLoading && notes.length === 0 ? <p className="notes-empty">Loading…</p> : null}
            {!isListLoading && notes.length === 0 && !listError ? (
              <div className="notes-empty">
                <p>
                  {isSearching
                    ? "No notes match your search."
                    : filter.kind === "trash"
                      ? "The trash is empty."
                      : "No notes here yet."}
                </p>
                {canCreateHere && !isSearching ? (
                  <button type="button" className="ui-button notes-empty-action" onClick={() => handleCreateNote()}>
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    New note
                  </button>
                ) : null}
              </div>
            ) : null}
            {notes.map((item, index) => {
              const active = item.id === selectedNoteId;
              const bucketContext = noteBucketContext(bucketContexts, item);
              const context = isPhone ? null : rowContext(item);
              return (
                <div key={item.id} role="listitem" className="notes-list-row"
                  onContextMenu={!isPhone ? event => rowContextMenu(event, { kind: "note", item }) : undefined}>
                  {isPhone && !isSearching && filter.kind !== "trash" && (index === 0 || notes[index - 1].pinned !== item.pinned) ? <p className="notes-mobile-section">{item.pinned ? "Pinned" : "Recent"}</p> : null}
                  {renamingItem?.kind === "note" && renamingItem.item.id === item.id ? <InlineNameField
                    key={item.id} initialValue={renamingItem.item.title} placeholder="Note title" label="Rename note" maxLength={300}
                    className="notes-row-rename" onSubmit={renameItem} onCancel={cancelRenameItem} /> : <button
                    type="button"
                    className="notes-list-item"
                    data-active={active}
                    data-notes-context={bucketContext ? "bucket" : undefined}
                    style={notesBucketStyle(bucketContext)}
                    data-note-row={item.id}
                    aria-current={active ? "true" : undefined}
                    onClick={() => selectNote(item.id)}
                    onKeyDown={event => rowMenuKey(event, { kind: "note", item })}
                  >
                    {isPhone ? <>
                      <span className="notes-list-title">
                        <NoteContextMark context={bucketContext} labelled />
                        {item.pinned ? <Pin className="h-3 w-3 shrink-0" aria-label="Pinned" /> : null}
                        <span className="truncate">{item.displayTitle}</span>
                        <time className="notes-mobile-updated" dateTime={item.updatedAt}>{formatUpdated(item.updatedAt)}</time>
                      </span>
                      {bucketContext ? <span className="notes-mobile-preview-line">
                        <span className="notes-mobile-bucket-label" aria-hidden="true">{bucketContext.title}</span>
                        {item.snippet ? <span className="notes-list-snippet">{item.snippet}</span> : null}
                      </span> : item.snippet ? <span className="notes-list-snippet">{item.snippet}</span> : null}
                    </> : <>
                      {/* Desktop rows are two lines: title and date, then where it lives and a preview. */}
                      <span className="notes-list-title">
                        {item.pinned ? <Pin className="h-3 w-3 shrink-0" aria-label="Pinned" /> : null}
                        <span className="truncate">{item.displayTitle}</span>
                        <time className="notes-list-date" dateTime={item.updatedAt}>{formatUpdated(item.updatedAt)}</time>
                      </span>
                      <span className="notes-list-line">
                        {context ? <span className="notes-list-context"><NoteContextMark context={bucketContext} /><span className="notes-context-text">{context}</span></span> : null}
                        <span className={`notes-list-preview${item.snippet || context ? "" : " notes-list-preview-empty"}`}>{item.snippet || (context ? "" : "No text")}</span>
                        {item.linkedTaskCount > 0 ? (
                          <span className="notes-list-links" title={`${item.linkedTaskCount} linked task(s)`}>
                            <Link2 className="h-3 w-3" aria-hidden="true" />
                            {item.linkedTaskCount}
                          </span>
                        ) : null}
                      </span>
                    </>}
                  </button>}
                  {!isPhone && renamingItem?.item.id !== item.id ? <button type="button"
                    className="notes-icon-button notes-row-actions notes-list-row-actions" aria-label={`Note actions for ${item.displayTitle}`}
                    aria-haspopup="menu" aria-expanded={itemMenu?.target.kind === "note" && itemMenu.target.item.id === item.id}
                    disabled={contextBusy} onClick={event => showItemMenu({ kind: "note", item }, event.currentTarget)}>
                    <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" /></button> : null}
                </div>
              );
            })}
            {hasMoreNotes ? (
              listLimit < LIST_MAX ? (
                <button
                  type="button"
                  className="ui-button notes-load-more"
                  disabled={isListLoading}
                  onClick={() => setListPages((pages) => pages + 1)}
                >
                  Show more notes
                </button>
              ) : (
                <p className="notes-empty">Showing the newest {LIST_MAX}. Search to find older notes.</p>
              )
            ) : null}
          </div>
          {isPhone && canCreateHere ? <button type="button" className="notes-mobile-new" aria-label="New note here" onClick={() => handleCreateNote()}><Pencil aria-hidden="true" /></button> : null}
        </section>

        {separator("list", "Resize the note list")}

        <section className="notes-editor-pane" aria-label="Note" data-notes-context={editorContext ? "bucket" : undefined} style={notesBucketStyle(editorContext)}>
          {!note ? (
            <div className="notes-editor-empty">
              {noteError ? <p className="notes-error">{noteError}</p> : null}
              {selectedNoteId && !noteError ? <p>Opening note…</p> : null}
              {!selectedNoteId ? (
                <>
                  <p>Select a note, or start a new one.</p>
                  <button
                    type="button"
                    className="ui-button ui-button-primary notes-empty-action"
                    onClick={() => handleCreateNote()}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                    New note
                  </button>
                </>
              ) : null}
              <button type="button" className="ui-button notes-back-to-list" onClick={() => setMobilePane("list")}>
                <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
                Back to notes
              </button>
            </div>
          ) : (
            <article className="notes-editor-shell" data-testid="note-editor-pane">
              <header className="notes-editor-toolbar">
                <button
                  type="button"
                  className="notes-icon-button notes-back-to-list"
                  aria-label="Back to notes"
                  onClick={() => {
                    void drafts.saveNote(note.id);
                    setMobilePane("list");
                  }}
                >
                  <ArrowLeft className="h-4 w-4" aria-hidden="true" />
                </button>
                <input
                  ref={isPhone ? undefined : element => { titleInputRef.current = element; }}
                  className="notes-title-input"
                  value={draftTitle}
                  placeholder={note.displayTitle && !note.title ? note.displayTitle : "Untitled note"}
                  aria-label="Note title"
                  autoFocus={isDraft && !isPhone}
                  disabled={!canEditNote || lockedNoteId === note.id || renameLockedNoteId === note.id}
                  maxLength={300}
                  onChange={(event) => handleTitleChange(event.target.value)}
                  onBlur={() => void drafts.saveNote(note.id)}
                  onKeyDown={(event: ReactKeyboardEvent<HTMLInputElement>) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      void drafts.saveNote(note.id);
                      setFocusBodyRequest((value) => value + 1);
                    }
                  }}
                />
                <span className="notes-save-state" aria-live="polite">
                  {isPhone && saveState === "error" ? "Couldn't save" : saveLabel[saveState]}
                </span>
                {isPhone ? <>
                  <button ref={readingButtonRef} type="button" className="notes-icon-button" aria-label={mobileEditing ? "Formatting" : "Reading text size"}
                    aria-pressed={mobileEditing ? mobileFormatting : readingSettings}
                    aria-haspopup={mobileEditing ? undefined : "dialog"} aria-expanded={mobileEditing ? undefined : readingSettings}
                    onPointerDown={event => { if (mobileEditing) event.preventDefault(); }}
                    onClick={() => mobileEditing ? setMobileFormatting(current => !current) : setReadingSettings(current => !current)}>Aa</button>
                  {mobileEditing ? <button type="button" className="notes-mobile-done" onClick={finishMobileEditing}>Done</button>
                    : canEditNote ? <button type="button" className="notes-icon-button" aria-label="Edit note" onClick={() => { setMobileEditing(true); setReadingSettings(false); setFocusBodyRequest(current => current + 1); }}><Pencil aria-hidden="true" /></button> : null}
                </> : null}
                {canEditNote ? (
                  <button
                    type="button"
                    className="notes-icon-button notes-toolbar-pin"
                    aria-label={note.pinned ? "Unpin note" : "Pin note"}
                    aria-pressed={note.pinned}
                    title={note.pinned ? "Unpin" : "Pin"}
                    onClick={() => void applyUpdate({ pinned: !note.pinned }, OWNED.pinned, { refreshList: true })}
                  >
                    {note.pinned ? (
                      <PinOff className="h-4 w-4" aria-hidden="true" />
                    ) : (
                      <Pin className="h-4 w-4" aria-hidden="true" />
                    )}
                  </button>
                ) : null}
                {/* A draft has nothing to export, convert, archive, or trash yet. */}
                {isDraft ? null : (
                  <NoteActionsMenu
                    isPhone={isPhone}
                    onDetails={isPhone ? openDetails : undefined}
                    onOpen={isPhone ? () => { setMobileDetails(false); setReadingSettings(false); } : undefined}
                    isTrashed={isTrashed}
                    canEdit={Boolean(note.canEdit) && !note.wiki?.spaceArchived && !drafts.isBlocked(note.id)}
                    canDeleteForever={note.wiki ? note.wiki.canDeletePermanently : note.canEdit}
                    isArchived={note.archived}
                    onConvert={openConvert}
                    onArchive={() => void applyUpdate({ archived: !note.archived }, OWNED.archived, { refreshList: true })}
                    onExport={() => void handleExportMarkdown()}
                    onTrash={() => void handleTrash()}
                    onRestore={() => void handleRestore()}
                    onDeleteForever={() => void handleDeleteForever()}
                  />
                )}
              </header>

              {isPhone && saveState === "error" ? <div className="notes-conflict" role="alert"><span>Your edits are kept in this tab. Try saving again.</span><button type="button" className="ui-button" onClick={() => { if (isDraft) void drafts.flushNewNote(note.id); else void drafts.saveNote(note.id); }}>Retry save</button></div> : null}
              {saveState === "conflict" ? (
                <div className="notes-conflict" role="alert">
                  <span>This note changed since you opened it, so your last edits were not saved.</span>
                  <button type="button" className="ui-button" onClick={() => void handleReloadNote()}>
                    Reload theirs
                  </button>
                  <button type="button" className="ui-button" onClick={() => void drafts.keepMine(note.id)}>
                    Keep mine
                  </button>
                </div>
              ) : null}
              {noteError ? <p className="notes-error">{noteError}</p> : null}
              {notice ? (
                <p className="notes-notice">
                  {notice.text}{" "}
                  {notice.href ? (
                    <Link href={notice.href} className="notes-inline-link">
                      {notice.hrefLabel}
                    </Link>
                  ) : null}
                </p>
              ) : null}
              {isTrashed ? (
                <p className="notes-notice">In the trash. Restore it to edit, or delete it forever.</p>
              ) : !note.canEdit ? (
                <p className="notes-notice">Read-only. You can view this note but not change it.</p>
              ) : null}

              {!isDraft ? <WikiNotesActions note={note} onChanged={openLoadedNote} onBusy={busy => setLockedNoteId(busy ? note.id : null)} /> : null}
              {renderNoteProperties(note)}

              {isConvertOpen ? (
                <div className="notes-convert" role="group" aria-label="Create a task from this note">
                  <label className="notes-meta-row">
                    <span className={`notes-meta-label${desktopClass("ed-label")}`}>New task in</span>
                    <select
                      className={`notes-select${desktopClass("ui-select ed-field")}`}
                      value={convertBucketValue}
                      onChange={(event) => setConvertBucketValue(event.target.value)}
                    >
                      {editableBucketOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="notes-convert-actions">
                    <button
                      type="button"
                      className="ui-button ui-button-primary"
                      disabled={!convertBucketValue}
                      onClick={() => void handleConvert()}
                    >
                      Create task
                    </button>
                    <button type="button" className="ui-button" onClick={() => setIsConvertOpen(false)}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : null}

              <div className="notes-editor-body pretty-scrollbar" data-mobile-formatting={isPhone && mobileEditing && mobileFormatting} onFocusCapture={event => {
                if (isPhone && canEditNote && (event.target.closest(".bn-editor") || event.target.classList.contains("notes-mobile-title"))) {
                  setMobileEditing(true); setReadingSettings(false);
                }
              }}>
                {isPhone ? <>
                  <h1 className="sr-only">{draftTitle || note.displayTitle || "Untitled note"}</h1>
                  <p className="notes-mobile-path"><NoteContextMark context={editorContext} />{note.home.kind === "personal" ? (notebookRows.find(row => row.notebook.id === note.notebookId)?.path ?? "Personal · Inbox") : homeLabel(note)}</p>
                  <textarea ref={element => { titleInputRef.current = element; }} className="notes-mobile-title" rows={1} aria-label="Note title" autoFocus={isDraft}
                    value={draftTitle} placeholder={note.displayTitle && !note.title ? note.displayTitle : "Untitled note"}
                    disabled={!canEditNote || lockedNoteId === note.id || renameLockedNoteId === note.id} maxLength={300}
                    onChange={event => handleTitleChange(event.target.value)} onBlur={() => void drafts.saveNote(note.id)}
                    onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); setFocusBodyRequest(value => value + 1); } }} />
                </> : null}
                <NoteEditor
                  key={`${editorNoteId}:${editorKey}`}
                  initialBlocks={note.content}
                  contentFormatVersion={note.contentFormatVersion ?? 1}
                  wikiContext={note.wiki ? { spaceId: note.wiki.spaceId, noteId: note.id } : undefined}
                  editable={canEditNote && lockedNoteId !== note.id && renameLockedNoteId !== note.id}
                  onChange={handleContentChange}
                  uploadFile={canEditNote ? uploadFile : undefined}
                  focusRequest={focusBodyRequest}
                  mobile={isPhone}
                  mobileFormatting={mobileFormatting && mobileEditing}
                  onCloseMobileFormatting={() => setMobileFormatting(false)}
                />
                {isPhone ? <button ref={detailsButtonRef} type="button" className="notes-mobile-details-link" aria-label="Note details" aria-expanded={mobileDetails} onClick={() => mobileDetails ? setMobileDetails(false) : openDetails()}>Details, tags & linked tasks <ChevronRight aria-hidden="true" /></button> : null}
              </div>
              {isPhone && readingSettings && !mobileEditing ? <section ref={readingPanelRef} className="notes-reading-settings" role="dialog" aria-label="Reading text size">
                <div><span>Text size</span><button type="button" className="notes-icon-button" aria-label="Close text size" onClick={() => { setReadingSettings(false); readingButtonRef.current?.focus(); }}><X aria-hidden="true" /></button></div>
                <div><button type="button" aria-label="Smaller text" disabled={prefs.readingScale <= 100} onClick={() => updateNotesUiPrefs(viewerId, current => ({ ...current, readingScale: current.readingScale - 10 }))}>A−</button><input type="range" aria-label="Note text size" min={100} max={160} step={10} value={prefs.readingScale}
                  onChange={event => updateNotesUiPrefs(viewerId, current => ({ ...current, readingScale: Number(event.target.value) }))} /><button type="button" aria-label="Larger text" disabled={prefs.readingScale >= 160} onClick={() => updateNotesUiPrefs(viewerId, current => ({ ...current, readingScale: current.readingScale + 10 }))}>A+</button></div>
                <div><output>{prefs.readingScale}%</output><button type="button" onClick={() => updateNotesUiPrefs(viewerId, current => ({ ...current, readingScale: 100 }))}>Reset</button></div>
              </section> : null}
              <footer className="notes-editor-footer">
                {note.home.kind === "board" ? `On ${homeLabel(note)}` : "Personal — only you can see this note"}
                {isDraft ? " · New note, saved once you start typing" : null}
                {!isDraft && note.updatedByDisplayName ? ` · Last edited by ${note.updatedByDisplayName}` : ""}
                {isDraft ? null : ` · ${formatUpdated(note.updatedAt)}`}
              </footer>
            </article>
          )}
        </section>
      </div>
      {itemMenu ? <ContextMenu classNames={NOTES_CONTEXT_MENU_CLASSES} anchor={itemMenu.anchor} label={itemMenu.target.kind === "note" ? "Note actions" : "Folder actions"}
        actions={contextActions} onClose={closeItemMenu} /> : null}
      {movingItem ? <NotesMoveDialog title={`Move ${movingItem.kind === "note" ? "note" : "folder"}`}
        initialValue={moveInitialValue} options={moveOptions} warning={moveWarning} onMove={moveItem} onClose={() => setMovingItem(null)} /> : null}
      {confirmDialog}
    </div>
  );
}
