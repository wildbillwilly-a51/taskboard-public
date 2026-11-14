"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type MouseEvent,
  type KeyboardEvent,
} from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  Folder,
  Home,
  Info,
  LayoutGrid,
  Link2,
  ListChecks,
  MoreHorizontal,
  Plus,
  Search,
  Star,
  Trash2,
  X,
} from "lucide-react";
import { ContextMenu, type ContextMenuAction, type ContextMenuAnchor } from "@/components/ui/context-menu";
import { useModalOutsideDismiss } from "@/components/use-modal-outside-dismiss";
import { offlineNotesPath } from "@/lib/offline-notes-model";
import dialogStyles from "./folio-features.module.css";
import { hasSelectionWithin, isContextMenuKey, keepsNativeContextMenu } from "@/lib/context-menu-request";
import type { NotesWorkspaceProps } from "./notes-workspace";
import {
  useNoteDrafts,
  isNewNoteDraftId,
  startNewNote,
  noteDraftStore,
} from "./use-note-drafts";
import {
  fetchNote,
  updateNoteRequest,
  trashNoteRequest,
  restoreNoteRequest,
  deleteNoteForeverRequest,
  uploadNoteAttachmentRequest,
  uploadNoteAttachmentsRequest,
  deleteNoteAttachmentRequest,
  getNoteAttachmentUrl,
  isNoteUnavailableError,
} from "@/lib/notes-client";
import {
  fetchFolioLibrary,
  fetchFolioNotes,
  folioRequest,
} from "@/lib/folio-client";
import {
  defaultFolioNavigation,
  defaultFolioPageState,
  folioNavigationKey,
  folioSpacePath,
  parseFolioNavigation,
  type FolioSpace,
  type FolioNavigation,
  type FolioView,
  type FolioPageState,
  type FolioSpaceBatchChange,
} from "@/lib/folio-model";
import type {
  NoteDetail,
  NoteContentInput,
  NoteSummary,
} from "@/lib/notes-model";
import { MobileNoteAttachments } from "./mobile-note-attachments";
import { useConfirm } from "@/components/ui/confirm-dialog";
import linen from "./notes-linen.module.css";
import styles from "./folio.module.css";
import {
  getEffectiveNotesColumnWidths,
  type NotesColumnWidths,
} from "@/lib/notes-layout";
import { canDeleteFolioSpace, createFolioBranchLoader, folioBoardDescriptor, folioConnectionLabel, toggleFolioExpanded } from "@/lib/folio-navigation";
import { useNotesUiPrefs, updateNotesUiPrefs } from "./notes-ui-prefs";
import { copyNoteBlockIds, noteOutline, sectionHref } from "@/lib/note-outline";
import {FolioPeople} from './folio-people';
import {FolioNoteTools} from './folio-note-tools';
import {FolioCreateDialog} from './folio-create-dialog';
import {FolioDiscoveryDialog} from './folio-discovery-dialog';
import { FolioBulkSpaceForm, FolioShareNotice, FolioSpaceLocation } from "./folio-space-management";
import {featureRequest,discoverNotes} from '@/lib/folio-feature-client';

const NoteEditor = dynamic(() => import("./note-editor"), {
  ssr: false,
  loading: () => <p className="notes-editor-loading">Loading editor…</p>,
});
const FolioHistory = dynamic(() => import("./folio-history"), {
  ssr: false,
  loading: () => <p role="status">Loading history…</p>,
});
type FolioMenuTarget = { kind: "note"; item: NoteSummary } | { kind: "space"; item: FolioSpace };
const menuClasses = {
  menu: "notes-context-menu", heading: "notes-context-heading",
  item: "notes-menu-item ui-menu-item ed-menu-item", danger: "notes-menu-danger",
  separated: "notes-context-separated",
};
const date = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
const listDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { dateStyle: "medium" });
const emptyDraft = (
  id: string,
  userId: string,
  connections: FolioSpace[],
): NoteDetail => ({
  id,
  title: "",
  displayTitle: "Untitled note",
  snippet: "",
  home: { kind: "personal" },
  notebookId: null,
  labels: [],
  pinned: false,
  archived: false,
  deletedAt: null,
  purgeAfterAt: null,
  ownerUserId: userId,
  ownerDisplayName: null,
  updatedByDisplayName: null,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  canEdit: true,
  linkedTaskCount: 0,
  attachmentCount: 0,
  content: [],
  contentMarkdown: "",
  contentVersion: 1,
  contentFormatVersion: 2,
  linkedTasks: [],
  attachments: [],
  folio: {
    kind: "document",
    audience:
      connections.length && connections.every((s) => s.kind === "personal")
        ? "personal"
        : "public",
    unconnected: !connections.length,
    favorite: false,
    connections: connections.map((s) => ({ ...s, path: s.title })),
    pageSpaceId: null,
    pageState: { ...defaultFolioPageState },
  },
});

function FolioDialog({
  title,
  onClose,
  children,
  returnFocus,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  returnFocus?: HTMLElement | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useModalOutsideDismiss(ref, onClose);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const previous = returnFocus ?? document.activeElement;
    // React autoFocus calls focus() during mounting, while this native dialog
    // is still closed. Declare the native target before showModal instead so
    // the dialog focusing algorithm owns the handoff, within the opening commit.
    node.querySelector<HTMLElement>("[data-dialog-initial-focus]")?.setAttribute("autofocus", "");
    node.showModal();
    return () => {
      const ownedFocus = node.contains(document.activeElement);
      node.close();
      if (ownedFocus && previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true });
    };
    // The opening origin belongs to this dialog instance, not later rerenders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <dialog
      ref={ref}
      className={`taskboard-shell ${dialogStyles.surface} ${dialogStyles.dialog} ${styles.dialog}`}
      data-editor-scale="true"
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClose();
      }}
    >
      <header>
        <h2 className="ed-title">{title}</h2>
        <button
          type="button"
          className="ui-button ed-button ed-icon-button"
          aria-label="Close dialog"
          onClick={onClose}
        >
          <X />
        </button>
      </header>
      {children}
    </dialog>
  );
}

export function FolioWorkspace({
  initialNoteId,
  initialSpaceId,
  createOnOpen,
  initialLinkTaskId,
  initialBoardId,
  viewerId = "",
  sessionKey = "browser",
  createRequest = 0,
  searchQuery = "",
  isPhone = false,
  offlineNotesAvailable = false,
}: NotesWorkspaceProps & {
  initialSpaceId?: string | null;
  sessionKey?: string;
  viewerId?: string;
  createRequest?: number;
  searchQuery?: string;
  onClearSearch?: () => void;
  isPhone?: boolean;
  offlineNotesAvailable?: boolean;
}) {
  const [featureDialog,setFeatureDialog]=useState<'create'|'search'|'due'|null>(null);
  const [dueCount,setDueCount]=useState(0);
  const attachmentDetails=useRef<HTMLDetailsElement>(null);
  useEffect(()=>{const key=(e:globalThis.KeyboardEvent)=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setFeatureDialog('search');}};document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key);},[]);
  const [nav, setNav] = useState<FolioNavigation>({
    ...defaultFolioNavigation,
    expanded: [],
  });
  const [ready, setReady] = useState(false),
    [spaces, setSpaces] = useState<FolioSpace[]>([]),
    [notes, setNotes] = useState<NoteSummary[]>([]);
  const [rootId, setRootId] = useState<string | null>(null),
    [note, setNote] = useState<NoteDetail | null>(null),
    [hasMore, setHasMore] = useState(false);
  const [pane, setPane] = useState<"nav" | "list" | "note">("list"),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(false);
  const [epoch, setEpoch] = useState(0),
    [editorEpoch, setEditorEpoch] = useState(0),
    [picker, setPicker] = useState<NoteDetail | null>(null),
    [history, setHistory] = useState<string | null>(null);
  useEffect(()=>{if(!ready)return;const c=new AbortController();void discoverNotes({due:true},c.signal).then(r=>setDueCount(r.notes.length)).catch(()=>{});return()=>c.abort();},[ready,epoch]);
  useEffect(()=>{if(note&&!isNewNoteDraftId(note.id))void featureRequest('/api/folio/discovery',{action:'view',noteId:note.id}).catch(()=>{});},[note?.id]);
  const [pickerReturnFocus, setPickerReturnFocus] = useState<HTMLElement | null>(null);
  const [spaceForm, setSpaceForm] = useState<{
    id?: string;
    personal: boolean;
    parentId: string | null;
    title: string;
  } | null>(null);
  const [bulkSpaceTrigger, setBulkSpaceTrigger] = useState<HTMLButtonElement | null>(null);
  const [itemMenu, setItemMenu] = useState<{ target: FolioMenuTarget; anchor: ContextMenuAnchor } | null>(null);
  const busyRef = useRef(false);
  const removedRowFocus = useRef<{id: string; index: number} | null>(null);
  useEffect(() => {
    const pending = removedRowFocus.current;
    if (!pending || notes.some(row => row.id === pending.id)) return;
    removedRowFocus.current = null;
    if (document.activeElement !== document.body) return;
    const rows = frameRef.current?.querySelectorAll<HTMLButtonElement>("[data-note-row] > .notes-list-item");
    (rows?.[Math.min(pending.index, rows.length - 1)] ?? frameRef.current?.querySelector<HTMLButtonElement>('[aria-label="New note here"]'))?.focus({preventScroll:true});
  }, [notes]);
  const [tag, setTag] = useState("");
  const [copied, setCopied] = useState<string | null>(null);
  const [adoptionTarget, setAdoptionTarget] = useState<{ spaceId: string; note: NoteDetail } | null>(null),
    [reading, setReading] = useState(false),
    [formatting, setFormatting] = useState(false);
  const [pageNotes, setPageNotes] = useState<NoteSummary[]>([]),
    [pageMore, setPageMore] = useState(false);
  const [boardPages, setBoardPages] = useState<
    Record<string, { offset: number; hasMore: boolean }>
  >({});
  const prefs = useNotesUiPrefs(viewerId);
  const widths = prefs.widths;
  const setWidths = (update: (value: NotesColumnWidths) => NotesColumnWidths) =>
    updateNotesUiPrefs(viewerId, (p) => ({ ...p, widths: update(p.widths) }));
  const frameRef = useRef<HTMLDivElement>(null),
    [frameWidth, setFrameWidth] = useState(1440);
  const mobileTitleRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const field = mobileTitleRef.current;
    if (!field) return;
    const resize = () => {
      field.style.height = "0px";
      field.style.height = `${field.scrollHeight}px`;
    };
    resize();
    let width = field.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width !== field.clientWidth) {
        width = field.clientWidth;
        resize();
      }
    });
    observer.observe(field);
    return () => observer.disconnect();
  }, [note?.title, isPhone, pane, prefs.readingScale, nav.editing]);
  useEffect(() => {
    const node = frameRef.current;
    if (!node) return;
    const observer = new ResizeObserver((entries) =>
      setFrameWidth(entries[0].contentRect.width),
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const effectiveWidths = getEffectiveNotesColumnWidths(
    widths,
    frameWidth,
    pane,
  );
  const current = useRef(note);
  const boardLoader = useRef(createFolioBranchLoader());
  const [boardLoading, setBoardLoading] = useState<Record<string, boolean>>({});
  useEffect(() => {
    current.current = note;
  }, [note]);
  const selection = useRef(0),
    revision = useRef<string | null>(null),
    initialized = useRef(false),
    createSeen = useRef(createRequest);
  const key = folioNavigationKey(viewerId, sessionKey),
    { confirm, dialog } = useConfirm();
  const drafts = useNoteDrafts({
    onSaved: (saved) => {
      setNotes((rows) => rows.map((n) => (n.id === saved.id ? saved : n)));
      if (current.current?.id === saved.id)
        setNote((old) =>
          old?.id === saved.id
            ? {
                ...saved,
                title: drafts.latestOf(saved.id).title ?? saved.title,
                content:
                  drafts.latestOf(saved.id).content?.blocks ?? saved.content,
                contentMarkdown:
                  drafts.latestOf(saved.id).content?.markdown ??
                  saved.contentMarkdown,
              }
            : old,
        );
    },
    onCreated: (draftId, saved) => {
      if (current.current?.id === draftId) {
        setNote((old) =>
          old?.id === draftId
            ? {
                ...saved,
                title: old.title,
                content: old.content,
                contentMarkdown: old.contentMarkdown,
              }
            : old,
        );
        setNav((n) => ({ ...n, noteId: saved.id }));
      }
      setEpoch((n) => n + 1);
    },
  });
  const refreshLibrary = useCallback(async () => {
    const value = await fetchFolioLibrary();
    setSpaces(value.spaces);
    setRootId(value.rootSpaceId);
    return value;
  }, []);
  const install = useCallback((detail: NoteDetail, remount = true) => {
    noteDraftStore.suspend(
      detail.id,
      !detail.canEdit || Boolean(detail.deletedAt),
    );
    const pending = noteDraftStore.register(detail);
    setNote({
      ...detail,
      ...(pending?.title !== undefined ? { title: pending.title } : {}),
      ...(pending?.content
        ? {
            content: pending.content.blocks,
            contentMarkdown: pending.content.markdown,
          }
        : {}),
    });
    if (remount) setEditorEpoch((n) => n + 1);
  }, []);
  const run = async (action: () => Promise<unknown>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Unable to update Folio.");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };
  const openNote = async (id: string, editing = false, remembered = false) => {
    setHistory(null);
    setItemMenu(null);
    setPicker(null);
    setAdoptionTarget(null);
    if (current.current && isNewNoteDraftId(current.current.id))
      drafts.leaveNewNote(current.current.id);
    const token = ++selection.current;
    setError("");
    setLoading(true);
    setNav((n) => ({ ...n, noteId: id, editing }));
    setPane("note");
    if (current.current?.id !== id) setNote(null);
    try {
      const detail = await fetchNote(id);
      if (token !== selection.current) return;
      install(detail);
      return detail;
    } catch (e) {
      if (token === selection.current) {
        setError(e instanceof Error ? e.message : "Unable to open note.");
        setNote(null);
        if (remembered && isNoteUnavailableError(e))
          setNav({ ...defaultFolioNavigation, expanded: [] });
      }
    } finally {
      if (token === selection.current) setLoading(false);
    }
  };
  const selectView = (view: FolioView) => {
    setHistory(null);
    setItemMenu(null);
    setPicker(null);
    setAdoptionTarget(null);
    if (current.current && isNewNoteDraftId(current.current.id))
      drafts.leaveNewNote(current.current.id);
    selection.current++;
    setNote(null);
    setError("");
    setNav((n) => ({
      ...n,
      view,
      noteId: null,
      editing: false,
    }));
    setPane(view.kind === "home" && isPhone ? "note" : "list");
  };
  const create = () => {
    setHistory(null);
    setItemMenu(null);
    setPicker(null);
    setAdoptionTarget(null);
    if (current.current && isNewNoteDraftId(current.current.id))
      drafts.leaveNewNote(current.current.id);
    // New note always starts in Unconnected. Placement is an explicit choice.
    const targets: FolioSpace[] = [];
    const id = startNewNote({
      kind: "folio",
    });
    selection.current++;
    setNote(emptyDraft(id, viewerId, targets));
    setNav((n) => ({ ...n, noteId: id, editing: true }));
    setPane("note");
    setError("");
    setEditorEpoch((n) => n + 1);
  };
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const library = await refreshLibrary();
        if (cancelled) return;
        let restored = parseFolioNavigation(sessionStorage.getItem(key));
        const rememberedView = restored.view;
        if (
          rememberedView.kind === "space" &&
          !library.spaces.some((s) => s.id === rememberedView.spaceId)
        )
          restored = { ...restored, view: { kind: "home" } };
        // A browser-tab draft is recovered from the same store as Notes.
        const raw = sessionStorage.getItem(key);
        try {
          const candidate = raw ? JSON.parse(raw) : null;
          if (
            isNewNoteDraftId(candidate?.noteId) &&
            drafts.newNoteSnapshot(candidate.noteId)
          )
            restored = { ...restored, noteId: candidate.noteId };
        } catch {}
        if (initialSpaceId)
          restored = {
            ...restored,
            view: { kind: "space", spaceId: initialSpaceId },
            noteId: null,
          };
        if (initialNoteId) restored = { ...restored, noteId: initialNoteId };
        if (
          initialBoardId &&
          !initialNoteId &&
          !initialSpaceId &&
          !initialLinkTaskId
        ) {
          const target = library.spaces.find(
            (s) => s.kind === "board" && s.boardId === initialBoardId,
          );
          if (target)
            restored = {
              ...restored,
              view: { kind: "space", spaceId: target.id },
              noteId: null,
            };
        }
        if (initialLinkTaskId && initialBoardId) {
          const target = await folioRequest<{ id: string }>({
            action: "taskTarget",
            taskId: initialLinkTaskId,
          });
          const refreshed = await refreshLibrary();
          library.spaces = refreshed.spaces;
          restored = {
            ...restored,
            view: { kind: "space", spaceId: target.id },
            noteId: null,
          };
        }
        setNav(restored);
        setReady(true);
        if (restored.noteId) {
          if (isNewNoteDraftId(restored.noteId)) {
            const snapshot = drafts.newNoteSnapshot(restored.noteId);
            if (snapshot) {
              const targets: FolioSpace[] = [];
              setNote({
                ...emptyDraft(restored.noteId, viewerId, targets),
                title: snapshot.typed.title ?? "",
                content: snapshot.typed.content?.blocks ?? [],
              });
              setPane("note");
            }
          } else
            await openNote(restored.noteId, restored.editing, !initialNoteId);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Unable to load Folio.");
          setReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Login/deep-link initialization runs once per mounted workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  useEffect(() => {
    if (ready) sessionStorage.setItem(key, JSON.stringify(nav));
  }, [key, nav, ready]);
  useEffect(() => {
    if (!ready) return;
    if (!initialized.current) {
      initialized.current = true;
      if (!createOnOpen) return;
    } else if (createSeen.current === createRequest) return;
    createSeen.current = createRequest;
    create();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, createRequest]);
  const query = searchQuery;
  useEffect(
    () => () => {
      const selected = current.current;
      if (selected && isNewNoteDraftId(selected.id))
        drafts.releaseNewNote(selected.id);
    },
    [drafts],
  );
  const listingView: FolioView = query ? { kind: "search" } : nav.view;
  const viewKey = JSON.stringify(listingView);
  useEffect(() => {
    if (!ready) return;
    const controller = new AbortController();
    let live = true;
    const timer = setTimeout(
      () => {
        setLoading(true);
        void fetchFolioNotes(listingView, query, 0, controller.signal)
          .then((result) => {
            if (live) {
              setNotes(result.notes);
              setHasMore(result.hasMore);
            }
          })
          .catch((e) => {
            if (live && !controller.signal.aborted) setError(e.message);
          })
          .finally(() => {
            if (live) setLoading(false);
          });
      },
      query ? 180 : 0,
    );
    return () => {
      live = false;
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, viewKey, query, epoch]);
  useEffect(() => {
    if (!ready || nav.view.kind !== "space" || nav.noteId) return;
    const id = nav.view.spaceId,
      token = ++selection.current;
    const controller = new AbortController();
    void folioRequest<{ note: NoteDetail }>(
      { action: "page", spaceId: id },
      undefined,
      controller.signal,
    )
      .then((v) => {
        if (token === selection.current) install(v.note);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [ready, nav.view, nav.noteId, install]);
  useEffect(() => {
    if (!ready) return;
    let live = true,
      pending = false;
    const check = async () => {
      if (pending || document.hidden) return;
      pending = true;
      try {
        const value = await folioRequest<{ revision: string }>({
          action: "revision",
        });
        if (!live) return;
        if (revision.current !== null && revision.current !== value.revision) {
          const library = await refreshLibrary();
          if (!live) return;
          setNav((n) =>
            n.view.kind === "space" &&
            !library.spaces.some(
              (s) => s.id === (n.view as { spaceId: string }).spaceId,
            )
              ? { ...n, view: { kind: "home" } }
              : n,
          );
          setEpoch((n) => n + 1);
          const selected = current.current;
          if (selected && !isNewNoteDraftId(selected.id)) {
            try {
              const fresh = await fetchNote(selected.id);
              if (!live || current.current?.id !== selected.id) return;
              if (!fresh.canEdit || fresh.deletedAt) {
                drafts.suspend(fresh.id);
                setNav((n) => ({ ...n, editing: false }));
              } else if (drafts.isBlocked(fresh.id))
                drafts.suspend(fresh.id, false);
              if (drafts.isIdle(selected.id)) {
                if (fresh.contentVersion !== selected.contentVersion)
                  install(fresh);
                else
                  setNote((old) =>
                    old?.id === fresh.id ? { ...old, ...fresh } : old,
                  );
              } else
                setNote((old) =>
                  old?.id === fresh.id
                    ? {
                        ...old,
                        folio: fresh.folio,
                        wiki: fresh.wiki,
                        contentFormatVersion: fresh.contentFormatVersion,
                        legacy: fresh.legacy,
                        canEdit: fresh.canEdit,
                        deletedAt: fresh.deletedAt,
                        archived: fresh.archived,
                        linkedTasks: fresh.linkedTasks,
                        taskReferenceIds: fresh.taskReferenceIds,
                        labels: fresh.labels,
                      }
                    : old,
                );
            } catch (e) {
              if (
                isNoteUnavailableError(e) &&
                current.current?.id === selected.id
              ) {
                drafts.suspend(selected.id);
                setNote(null);
                setNav((n) => ({ ...n, noteId: null, editing: false }));
                setError(
                  "This note is no longer available. Any unsaved edits are kept in this tab.",
                );
              }
            }
          }
        }
        revision.current = value.revision;
      } catch {
        /* Retain the current document during temporary network failure. */
      } finally {
        pending = false;
      }
    };
    void check();
    const timer = setInterval(() => void check(), 6000);
    window.addEventListener("focus", check);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener("focus", check);
    };
  }, [ready, refreshLibrary, install, drafts]);
  const selectedSpaceId = nav.view.kind === "space" ? nav.view.spaceId : null;
  const space = spaces.find((s) => s.id === selectedSpaceId);
  const legacyNotebook = note?.notebookId
    ? spaces.find((s) => s.legacyNotebookId === note.notebookId)
    : undefined;
  const legacyPlacement = legacyNotebook
    ? folioSpacePath(spaces, legacyNotebook.id)
    : note?.legacy?.placement;
  const title = query
    ? "Search"
    : (space?.title ??
      (
        {
          home: "Folio",
          favorites: "Favorites",
          unconnected: "Unconnected",
          archive: "Archive",
          trash: "Trash",
          search: "Search",
        } as Record<string, string>
      )[nav.view.kind]);
  const isDraft = Boolean(note && isNewNoteDraftId(note.id));
  const canEdit = Boolean(
    note?.canEdit &&
      !note.deletedAt &&
      !note.archived &&
      nav.editing &&
      !busy &&
      !drafts.isBlocked(note.id),
  );
  const page = note?.folio?.kind === "space_page";
  const [contentsHost, setContentsHost] = useState<HTMLSpanElement | null>(null);
  const [contentsRailHost, setContentsRailHost] = useState<HTMLDivElement | null>(null);
  const [information, setInformation] = useState<{ noteId: string; trigger: HTMLElement } | null>(null);
  const pageSpaceId = note?.folio?.pageSpaceId;
  useEffect(() => {
    if (!pageSpaceId) return;
    const controller = new AbortController();
    void fetchFolioNotes(
      { kind: "space", spaceId: pageSpaceId },
      "",
      0,
      controller.signal,
    )
      .then((v) => {
        setPageNotes(v.notes);
        setPageMore(v.hasMore);
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message);
      });
    return () => controller.abort();
  }, [pageSpaceId, epoch]);
  useEffect(() => {
    if (isPhone && nav.view.kind === "home" && !nav.noteId)
      requestAnimationFrame(() => setPane("note"));
  }, [isPhone, nav.view.kind, nav.noteId]);
  const status = note
    ? isDraft
      ? drafts.newNoteStatus(note.id)
      : drafts.statusOf(note.id)
    : "idle";
  const updateFields = (fields: {
    title?: string;
    content?: NoteContentInput;
  }) => {
    if (!note || !canEdit) return;
    setNote((n) =>
      n
        ? {
            ...n,
            ...(fields.title !== undefined ? { title: fields.title } : {}),
            ...(fields.content
              ? {
                  content: fields.content.blocks,
                  contentMarkdown: fields.content.markdown,
                }
              : {}),
          }
        : n,
    );
    if (isDraft) drafts.editNewNote(note.id, fields);
    else drafts.edit(note.id, note.contentVersion, fields);
  };
  const noteAction = async (
    action: (id: string, version: number) => Promise<NoteDetail | void>,
    remount = false,
  ) => {
    if (!note) return;
    const selectedId = note.id;
    const actual = isDraft ? await drafts.createNewNote(selectedId) : note;
    if (!actual)
      throw new Error(
        "Unable to create the note. Your draft is kept in this tab.",
      );
    await drafts.runExclusive(
      actual.id,
      async (version) => {
        const result = await action(actual.id, version);
        if (result) {
          drafts.install(result);
          if (
            current.current?.id === actual.id ||
            current.current?.id === selectedId
          ) {
            install(result, remount);
            setNav((n) => ({ ...n, noteId: page ? n.noteId : result.id }));
          }
        }
      },
      { readOnly: Boolean(actual.deletedAt || !actual.canEdit) },
    );
    setEpoch((n) => n + 1);
  };
  const targetNoteAction = async (
    target: NoteSummary,
    action: (fresh: NoteDetail) => Promise<NoteDetail | void>,
    removing = false,
  ) => {
    const focusedRow = document.activeElement?.closest<HTMLElement>("[data-note-row]");
    const seed = await fetchNote(target.id);
    drafts.register(seed);
    await drafts.runExclusive(target.id, async () => {
      const fresh = await fetchNote(target.id);
      const result = await action(fresh);
      if (result) {
        drafts.install(result);
        drafts.suspend(result.id, Boolean(result.deletedAt || !result.canEdit));
        setNotes(rows => rows.map(row => row.id === result.id ? result : row));
        if (current.current?.id === result.id) install(result, false);
        setPicker(old => old?.id === result.id ? result : old);
      }
      const leavesList = removing || Boolean(result && (
        (nav.view.kind === "trash" && !result.deletedAt) ||
        (nav.view.kind === "archive" ? !result.archived : result.archived) ||
        (nav.view.kind === "favorites" && !(result.folio?.favorite ?? result.legacy?.favorite))
      ));
      if (leavesList) {
        if (focusedRow?.dataset.noteRow === target.id || document.activeElement === document.body)
          removedRowFocus.current = {id: target.id, index: Math.max(0, notes.findIndex(row => row.id === target.id))};
        setNotes(rows => rows.filter(row => row.id !== target.id));
      }
      if (removing) {
        drafts.forget(target.id);
        if (current.current?.id === target.id) {
          selection.current++;
          setHistory(null);
          setNote(null);
          setNav(n => ({ ...n, noteId: null, editing: false }));
        }
      }
    }, { readOnly: Boolean(seed.deletedAt || !seed.canEdit) });
    setEpoch(n => n + 1);
  };
  const copyLink = async (path: string, id: string) => {
    await navigator.clipboard.writeText(new URL(path, window.location.origin).href);
    setCopied(id);
  };
  const openTarget = async (target: NoteSummary, editing = false) => {
    if (current.current?.id === target.id) {
      setNav(n => ({ ...n, editing }));
      setPane("note");
      return current.current;
    }
    return openNote(target.id, editing);
  };
  const noteMenuActions = (target: NoteSummary): ContextMenuAction[] => {
    const isPage = target.folio?.kind === "space_page";
    const items: ContextMenuAction[] = [
      { label: "Open note", focus: "handoff", run: () => { void openTarget(target); } },
        { label: "Version history", focus: "handoff", run: () => { void run(async () => {
        const opened = await openTarget(target);
        if (!opened) return;
        const token = selection.current;
        await targetNoteAction(target, async () => {
          if (token === selection.current && current.current?.id === target.id) {
            setHistory(target.id); setPane("note");
          }
        });
      }); } },
      { label: copied === target.id ? "Link copied" : "Copy link", run: () => { void run(() => copyLink(`/folio?note=${target.id}`, target.id)); } },
      { label: "Export Markdown", run: () => { void run(() => targetNoteAction(target, async fresh => {
        const url = URL.createObjectURL(new Blob([`# ${fresh.title}\n\n${fresh.contentMarkdown}`], { type: "text/markdown" }));
        const a = document.createElement("a"); a.href = url;
        a.download = `${fresh.displayTitle.replace(/[^a-z0-9 _-]/gi, "_")}.md`;
        a.click(); URL.revokeObjectURL(url);
      })); } },
    ];
    if (!target.deletedAt && !isPage) items.push({
      label: (target.folio?.favorite ?? target.legacy?.favorite) ? "Remove favorite" : "Add favorite",
      run: () => { void run(() => targetNoteAction(target, async fresh => (
        await folioRequest<{note: NoteDetail}>({}, { action: "favorite", noteId: fresh.id,
          favorite: !(target.folio?.favorite ?? target.legacy?.favorite) })
      ).note)); },
    });
    if (target.canEdit && !target.deletedAt && !target.archived) items.splice(1, 0,
      { label: "Edit", focus: "handoff", run: () => { void run(async () => { await openTarget(target, true); }); } },
      ...(!isPage ? [{ label: "Connect to…", focus: "handoff" as const, run: (trigger: HTMLElement) => { void run(async () => {
        const opened = await openTarget(target); if (opened) { setPickerReturnFocus(trigger); setPicker(opened); }
      }); } }] : []),
    );
    if (!isPage && target.canEdit) {
      if (target.deletedAt) items.push({ label: "Restore note", separator: true,
        run: () => { void run(() => targetNoteAction(target, fresh => {
          if (!fresh.canEdit || !fresh.deletedAt || fresh.folio?.kind === "space_page") throw new Error("Reload this note before restoring.");
          return restoreNoteRequest(fresh.id);
        })); } },
        { label: "Delete forever", danger: true, focus: "handoff", run: () => { void run(async () => {
          if (await confirm({ title: "Delete note forever?", body: "This removes the note and its files permanently.", confirmLabel: "Delete forever", tone: "danger" }))
            await targetNoteAction(target, async fresh => {
              if (!fresh.canEdit || !fresh.deletedAt || fresh.folio?.kind === "space_page") throw new Error("Reload this note before deleting.");
              await deleteNoteForeverRequest(fresh.id);
            }, true);
        }); } });
      else items.push({ label: target.archived ? "Unarchive note" : "Archive note", separator: true,
        run: () => { void run(() => targetNoteAction(target, fresh => {
          if (!fresh.canEdit || fresh.deletedAt || fresh.folio?.kind === "space_page") throw new Error("This note can no longer be changed.");
          return updateNoteRequest(fresh.id, { archived: !target.archived, expectedVersion: fresh.contentVersion });
        })); } },
        { label: "Move to Trash", danger: true, focus: "handoff", run: () => { void run(async () => {
          if (await confirm({ title: "Move note to Trash?", body: "The note disappears from all its spaces. You can restore it from Trash.", confirmLabel: "Move to Trash", tone: "danger" }))
            await targetNoteAction(target, async fresh => {
              if (!fresh.canEdit || fresh.deletedAt || fresh.folio?.kind === "space_page") throw new Error("This note can no longer be changed.");
              await trashNoteRequest(fresh.id);
            }, true);
        }); } });
    }
    return items.map(item => ({ ...item, disabled: busy }));
  };
  const updatePage = async (state: FolioPageState) =>
    noteAction((id, version) =>
      updateNoteRequest(id, {
        folioPageState: state,
        expectedVersion: version,
      }),
    );
  const upload = async (file: File) => {
    let url = "";
    await noteAction(async (id) => {
      const files = await uploadNoteAttachmentRequest(id, file);
      if (!files[0]) throw new Error("No file was uploaded.");
      url = getNoteAttachmentUrl(id, files[0].id);
      return fetchNote(id);
    });
    return url;
  };
  const connect = async (targetId: string, add: boolean) => {
    const target = picker ?? note;
    if (!target) return;
    if (target.legacy && add) {
      setPicker(null);
      setAdoptionTarget({ spaceId: targetId, note: target });
      return;
    }
    return run(async () => {
      const operation = async (id: string) => {
        const result = await folioRequest<{note: NoteDetail | null; unavailable: boolean}>(
          {}, { action: "connect", noteId: id, spaceId: targetId, add });
        if (result.unavailable) {
          drafts.suspend(id);
          if (current.current?.id === id) {
            selection.current++;
            setNote(null);
            setNav(n => ({ ...n, noteId: null, editing: false }));
          }
          setPicker(null);
          return;
        }
        if (result.note) setPicker(old => old?.id === target.id ? result.note : old);
        return result.note ?? undefined;
      };
      if (isNewNoteDraftId(target.id)) await noteAction(operation);
      else await targetNoteAction(target, fresh => operation(fresh.id));
    });
  };
  const loadBoardTasks = (target: FolioSpace) => {
    if (target.kind !== "board" || !target.boardId) return;
    void boardLoader.current(target.id, async () => {
      setBoardLoading(old => ({...old,[target.id]:true}));
      try {
        const result = await folioRequest<{ spaces: FolioSpace[]; hasMore: boolean }>({ action: "tasks", boardId: target.boardId! });
        setSpaces(old => [...old.filter(item => item.kind !== "task" || item.parentId !== target.id), ...result.spaces]);
        setBoardPages(old => ({ ...old, [target.id]: { offset: result.spaces.length, hasMore: result.hasMore } }));
        // A response populates data only; it never reopens a collapsed branch.
      } finally { setBoardLoading(old => ({...old,[target.id]:false})); }
    }).catch(e => setError(e instanceof Error ? e.message : "Unable to load board tasks."));
  };
  const setSpaceExpanded = (target: FolioSpace, open: boolean) => {
    setNav(value => ({ ...value, expanded: toggleFolioExpanded(value.expanded, target.id, open) }));
    if (open) loadBoardTasks(target);
  };
  const selectSpace = (target: FolioSpace) => {
    selectView({kind: "space", spaceId: target.id});
    setSpaceExpanded(target, true);
  };
  const spaceRows = (
    kind: "personal" | "shared" | "board",
    parentId: string | null,
    depth = 0,
    visited = new Set<string>(),
  ): ReactNode =>
    spaces
      .filter(
        (s) =>
          s.kind === (kind === "board" && parentId ? "task" : kind) &&
          s.parentId === parentId &&
          !s.archived,
      )
      .map((s) => {
        if (visited.has(s.id) || depth > 8) return null;
        const expanded = nav.expanded.includes(s.id),
          children = spaces.some((c) => c.parentId === s.id && !c.archived),
          branch = new Set([...visited, s.id]);
        return (
          <div key={s.id}>
            <div className="notes-nav-row" data-space-row={s.id} data-space-kind={s.kind} style={{ paddingLeft: depth * 12 }} {...menuEvents({ kind: "space", item: s })}>
              {children || s.kind === "board" ? <button
                type="button" className={`notes-icon-button ${styles.disclosure}`}
                aria-label={`${expanded ? "Collapse" : "Expand"} ${s.title}${folioBoardDescriptor(s, viewerId) ? ` — ${folioBoardDescriptor(s, viewerId)}` : ""}`}
                aria-expanded={expanded}
                onClick={() => setSpaceExpanded(s, !expanded)}
                onKeyDown={event => {
                  if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                    event.preventDefault(); setSpaceExpanded(s, event.key === "ArrowRight");
                  }
                }}>
                {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </button> : <span className={styles.disclosureSpacer} />}
              <button type="button" className="notes-nav-item"
                data-active={space?.id === s.id} data-space-kind={s.kind}
                title={`${s.title}${folioBoardDescriptor(s, viewerId) ? ` — ${folioBoardDescriptor(s, viewerId)}` : ""}`}
                aria-label={`${s.title}${folioBoardDescriptor(s, viewerId) ? ` — ${folioBoardDescriptor(s, viewerId)}` : ""}`}
                onClick={() => selectSpace(s)}
                onKeyDown={event => {
                  if ((children || s.kind === "board") && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
                    event.preventDefault(); setSpaceExpanded(s, event.key === "ArrowRight");
                  }
                }}>
                <span className={styles.spaceIcon}>{s.kind === "board" ? <LayoutGrid size={14} /> : s.kind === "task" ? <FileText size={14} /> : <Folder size={14} />}</span>
                <span className={styles.spaceName}><span className="truncate">{s.title}</span>
                  {s.kind === "board" ? <small>{folioBoardDescriptor(s, viewerId)}</small> : null}
                </span>
              </button>
              {menuButton({ kind: "space", item: s }, `Space actions for ${folioConnectionLabel(s, viewerId)}`, "notes-row-actions")}
            </div>
            {expanded && boardLoading[s.id] ? <span className={styles.boardLoading} role="status">Loading tasks…</span> : null}
            {expanded ? spaceRows(kind, s.id, depth + 1, branch) : null}
            {expanded && s.kind === "board" && boardPages[s.id]?.hasMore ? (
              <button
                className="notes-nav-item"
                disabled={busy || boardLoading[s.id]}
                onClick={() =>
                  void run(() => boardLoader.current(s.id, async () => {
                    setBoardLoading(old => ({...old,[s.id]:true}));
                    try {
                    const result = await folioRequest<{
                      spaces: FolioSpace[];
                      hasMore: boolean;
                    }>({
                      action: "tasks",
                      boardId: s.boardId!,
                      offset: boardPages[s.id].offset,
                    });
                    setSpaces((old) => [
                      ...old.filter(
                        (x) => !result.spaces.some((y) => x.id === y.id),
                      ),
                      ...result.spaces,
                    ]);
                    setBoardPages((old) => ({
                      ...old,
                      [s.id]: {
                        offset: old[s.id].offset + result.spaces.length,
                        hasMore: result.hasMore,
                      },
                    }));
                    } finally { setBoardLoading(old => ({...old,[s.id]:false})); }
                  }))
                }
              >
                More tasks…
              </button>
            ) : null}
          </div>
        );
      });
  const navItem = (view: FolioView, label: string, icon: ReactNode) => (
    <button
      type="button"
      className="notes-nav-item" data-folio-view={view.kind}
      data-active={JSON.stringify(nav.view) === JSON.stringify(view)}
      onClick={() => selectView(view)}
    >
      {icon}
      {label}
    </button>
  );
  const newSpace = (personal: boolean, parentId: string | null) =>
    setSpaceForm({ personal, parentId, title: "" });
  const managedSpace = spaceForm?.id ? spaces.find(s => s.id === spaceForm.id) : undefined;
  const sharingSpace = managedSpace?.kind === "personal" && (
    spaceForm?.parentId === null || spaces.some(s => s.id === spaceForm?.parentId && s.kind === "shared")
  );
  function affectsSpace(target: string, ids: readonly string[], includeDescendants: boolean) {
    if (!includeDescendants) return ids.includes(target);
    const selected = new Set(ids);
    const byId = new Map(spaces.map(s => [s.id, s]));
    const seen = new Set<string>();
    for (let id: string | null = target; id && !seen.has(id); id = byId.get(id)?.parentId ?? null) {
      if (selected.has(id)) return true;
      seen.add(id);
    }
    return false;
  }
  const saveAffectedSpacePage = async (ids: readonly string[], includeDescendants: boolean) => {
    const selected = current.current;
    if (
      selected?.folio?.kind === "space_page" &&
      selected.folio.pageSpaceId &&
      !drafts.isIdle(selected.id) &&
      affectsSpace(selected.folio.pageSpaceId, ids, includeDescendants) &&
      !(await drafts.saveNote(selected.id))
    ) throw new Error(
      "Save or resolve the space page edits before changing its space. Your text is kept in this tab.",
    );
  };
  const saveSpace = async () => {
    if (!spaceForm) return;
    await run(async () => {
      if (spaceForm.id && sharingSpace) await saveAffectedSpacePage([spaceForm.id], true);
      const value = spaceForm.id
        ? await folioRequest(
            {},
            {
              action: "manageSpace",
              spaceId: spaceForm.id,
              title: spaceForm.title,
              parentId: spaceForm.parentId,
              share: sharingSpace,
            },
          )
        : await folioRequest<{ id: string }>(
            {},
            { action: "createSpace", ...spaceForm },
          );
      const id = spaceForm.id ?? (value as { id: string }).id;
      setSpaceForm(null);
      await refreshLibrary();
      selectView({ kind: "space", spaceId: id });
      setEpoch((n) => n + 1);
    });
  };
  const saveBulkSpaces = (spaceIds: string[], change: FolioSpaceBatchChange) => {
    void run(async () => {
      const archiving = "archived" in change;
      const removing = "remove" in change;
      if (archiving || removing || ("share" in change && change.share))
        await saveAffectedSpacePage(spaceIds, !removing);
      await folioRequest({}, { action: "manageSpaces", spaceIds, ...change });
      setBulkSpaceTrigger(null);
      if ((archiving || removing) && nav.view.kind === "space" && affectsSpace(nav.view.spaceId, spaceIds, archiving))
        selectView({ kind: "home" });
      setEpoch(n => n + 1);
      await refreshLibrary();
    });
  };
  const manageSpace = async (s: FolioSpace, input: Record<string, unknown>) => {
    let committed = false;
    await run(async () => {
      if (input.remove || input.archived === true)
        await saveAffectedSpacePage([s.id], input.archived === true);
      const row = document.activeElement?.closest<HTMLElement>("[data-space-row]");
      const rows = [...(frameRef.current?.querySelectorAll<HTMLElement>("[data-space-row]") ?? [])];
      const index = Math.max(0, rows.findIndex(item => item.dataset.spaceRow === s.id));
      const ownsFocus = row?.dataset.spaceRow === s.id || document.activeElement === document.body;
      await folioRequest(
        {},
        { action: "manageSpace", spaceId: s.id, ...input },
      );
      committed = true;
      await refreshLibrary();
      selectView(
        input.remove ? { kind: "home" } : { kind: "space", spaceId: s.id },
      );
      setEpoch((n) => n + 1);
      if (ownsFocus && (input.remove || input.archived === true)) requestAnimationFrame(() => {
        if (document.activeElement !== document.body) return;
        const remaining = frameRef.current?.querySelectorAll<HTMLElement>("[data-space-row] > .notes-nav-item");
        (remaining?.[Math.min(index, remaining.length - 1)] ?? frameRef.current?.querySelector<HTMLElement>('[aria-label="New shared space"]'))?.focus({preventScroll:true});
      });
      else if (input.remove) requestAnimationFrame(() => {
        frameRef.current?.querySelector<HTMLElement>('[aria-label="New note here"]')?.focus({preventScroll:true});
      });
    });
    return committed;
  };
  const deleteSpace = async (target: FolioSpace) => {
    if (!canDeleteFolioSpace(target) || busyRef.current) return;
    const form = spaceForm?.id === target.id ? spaceForm : null;
    // The management form is a native modal. Close it before opening the
    // confirmation portal, then restore its unsaved fields if deletion cancels.
    if (form) setSpaceForm(null);
    const accepted = await confirm({title:"Delete space?",
      body:`Delete “${target.title}” and its space page permanently, including the page’s attachments. Notes keep their other spaces or go to Unconnected.${target.legacyNotebookId ? " Older notebook notes move up within Personal." : ""} Subspaces move up one level.`,
      confirmLabel:"Delete space",tone:"danger"});
    if (!accepted) { if (form) setSpaceForm(form); return; }
    if (!(await manageSpace(target,{remove:true})) && form) setSpaceForm(form);
  };
  const spaceMenuActions = (target: FolioSpace): ContextMenuAction[] => {
    const items: ContextMenuAction[] = [
      { label: "Open space", focus: "handoff", run: () => selectSpace(target) },
      { label: "Copy link", run: () => { void run(() => copyLink(`/folio?space=${target.id}`, target.id)); } },
    ];
    // Boards and tasks are connection targets, managed in their own modules.
    if (target.canManage && (target.kind === "shared" || target.kind === "personal")) {
      if (!target.archived) items.push({ label: "New subspace", separator: true, focus: "handoff", run: () => newSpace(target.kind === "personal", target.id) });
      if (!target.root) {
        items.push({ label: "Rename or move", focus: "handoff", run: () => setSpaceForm({id:target.id,personal:target.kind === "personal",parentId:target.parentId,title:target.title}) });
        if (target.kind === "shared") items.push({ label: target.archived ? "Restore space" : "Archive space", run: () => { void manageSpace(target, {archived: !target.archived}); } });
      }
    }
    if (canDeleteFolioSpace(target)) items.push({label:"Delete space",separator:true,danger:true,focus:"handoff",run:()=>{void deleteSpace(target);}});
    return items.map(item => ({...item, disabled: busy}));
  };
  const closeItemMenu = (restore: boolean) => {
    if (restore && itemMenu?.anchor.trigger.isConnected) itemMenu.anchor.trigger.focus({preventScroll:true});
    setItemMenu(null);
  };
  const showItemMenu = (target: FolioMenuTarget, trigger: HTMLElement, point?: {x:number;y:number}) => {
    const rect = trigger.getBoundingClientRect();
    setItemMenu({target,anchor:{trigger,x:point?.x ?? rect.left,y:point?.y ?? rect.bottom + 4}});
  };
  const menuEvents = (target: FolioMenuTarget) => ({
    onContextMenu: (event: MouseEvent<HTMLElement>) => {
      if (keepsNativeContextMenu(event.target, {defaultPrevented:event.defaultPrevented,hasSelection:hasSelectionWithin(event.target),pointerType: "pointerType" in event.nativeEvent ? String(event.nativeEvent.pointerType) : undefined})) return;
      event.preventDefault(); event.stopPropagation();
      const trigger = (event.target as HTMLElement).closest<HTMLButtonElement>("button") ?? event.currentTarget.querySelector<HTMLButtonElement>("button")!;
      showItemMenu(target, trigger, {x:event.clientX,y:event.clientY});
    },
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (!isContextMenuKey(event) || keepsNativeContextMenu(event.target, {defaultPrevented:event.defaultPrevented,hasSelection:hasSelectionWithin(event.target)})) return;
      event.preventDefault(); event.stopPropagation();
      showItemMenu(target, event.target as HTMLElement);
    },
  });
  const menuButton = (target: FolioMenuTarget, label: string, className = "") => (
    <button type="button" className={`notes-icon-button ${className}`} aria-label={label} title={label}
      {...menuEvents(target)} aria-haspopup="menu" aria-expanded={itemMenu?.target.kind === target.kind && itemMenu.target.item.id === target.item.id}
      disabled={busy} onClick={event => showItemMenu(target, event.currentTarget)}
      onKeyDown={event => {
        if (isContextMenuKey(event) || event.key === "ArrowDown") {
          event.preventDefault();event.stopPropagation();showItemMenu(target,event.currentTarget);
        }
      }}><MoreHorizontal size={16} /></button>
  );
  const noteLinks = (
    <div className={styles.pageList}>
      <header>
        <h3>Notes in this space</h3>
        {canEdit ? (
          <>
            <button
              className="ui-button ed-button"
              onClick={() =>
                void run(() =>
                  updatePage({
                    ...note!.folio!.pageState,
                    notesListPosition:
                      note!.folio!.pageState.notesListPosition === "after"
                        ? "before"
                        : "after",
                  }),
                )
              }
            >
              Move{" "}
              {note!.folio!.pageState.notesListPosition === "after"
                ? "above"
                : "below"}
            </button>
            <button
              className="notes-icon-button"
              aria-label="Remove notes list"
              onClick={() =>
                void run(() =>
                  updatePage({
                    ...note!.folio!.pageState,
                    notesListVisible: false,
                  }),
                )
              }
            >
              <X size={14} />
            </button>
          </>
        ) : null}
      </header>
      {pageNotes.length ? (
        pageNotes.map((n) => (
          <div key={n.id}>
            <a
              href={`/folio?note=${n.id}`}
              onClick={(event) => {
                event.preventDefault();
                void openNote(n.id);
              }}
            >
              {n.displayTitle}
            </a>
            <small>
              {n.updatedByDisplayName ?? n.ownerDisplayName ?? "Someone"} ·{" "}
              {date(n.updatedAt)}<FolioPeople people={n.features?.people}/>
            </small>
          </div>
        ))
      ) : (
        <p>
          No notes yet. Connect an existing note or create a new one and choose
          its connections.
        </p>
      )}
      {pageMore ? (
        <button
          className="ui-button ed-button"
          onClick={() =>
            void run(async () => {
              if (!pageSpaceId) return;
              const v = await fetchFolioNotes(
                { kind: "space", spaceId: pageSpaceId },
                "",
                pageNotes.length,
              );
              setPageNotes((old) => [...old, ...v.notes]);
              setPageMore(v.hasMore);
            })
          }
        >
          More notes
        </button>
      ) : null}
    </div>
  );
  async function loadMore() {
    await run(async () => {
      const result = await fetchFolioNotes(listingView, query, notes.length);
      setNotes((old) => [
        ...old,
        ...result.notes.filter((n) => !old.some((o) => o.id === n.id)),
      ]);
      setHasMore(result.hasMore);
    });
  }
  const resize = (column: "sidebar" | "list", start: number) => {
    const original = widths[column];
    const move = (event: PointerEvent) =>
      setWidths((w) => ({
        ...w,
        [column]: Math.min(
          column === "sidebar" ? 360 : 500,
          Math.max(
            column === "sidebar" ? 180 : 220,
            original + event.clientX - start,
          ),
        ),
      }));
    const end = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      document.body.classList.remove("notes-resizing");
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end, { once: true });
    document.body.classList.add("notes-resizing");
  };
  const separator = (column: "sidebar" | "list") => (
    <div
      className="notes-separator"
      data-column={column}
      role="separator"
      aria-label={`Resize ${column}`}
      aria-orientation="vertical"
      aria-valuenow={widths[column]}
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        resize(column, e.clientX);
      }}
      onKeyDown={(e) => {
        if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
          e.preventDefault();
          setWidths((w) => ({
            ...w,
            [column]: Math.min(
              column === "sidebar" ? 360 : 500,
              Math.max(
                column === "sidebar" ? 180 : 220,
                w[column] + (e.key === "ArrowRight" ? 10 : -10),
              ),
            ),
          }));
        }
      }}
    />
  );
  return (
    <div
      className={`notes-frame ${linen.root} ${styles.root}`}
      ref={frameRef}
      data-editor-scale={isPhone ? undefined : "true"}
    >
      <div
        className="notes-workspace"
        data-pane={pane}
        data-testid="folio-workspace"
        data-history={Boolean(history && note?.id === history)}
        style={
          {
            "--notes-sidebar-width": `${effectiveWidths.sidebar}px`,
            "--notes-list-width": `${effectiveWidths.list}px`,
            "--notes-reading-scale": prefs.readingScale / 100,
          } as CSSProperties
        }
      >
        <nav className={styles.paneNavigation} aria-label="Folio navigation">
          <button type="button" className="ui-button ed-button" aria-label="Browse spaces" aria-current={pane === "nav" ? "location" : undefined}
            onClick={() => { setHistory(null); setPane("nav"); }}>
            <Folder size={16} aria-hidden="true" /><span>Spaces</span>
          </button>
          <ChevronRight size={14} aria-hidden="true" />
          <button type="button" className="ui-button ed-button" aria-label={title === "Folio" ? "Show recent notes" : `Show notes in ${title}`}
            title={title} aria-current={pane === "list" ? "location" : undefined}
            onClick={() => { setHistory(null); setPane("list"); }}>
            <span>{title === "Folio" ? "Recent notes" : title}</span>
          </button>
          {note || nav.view.kind === "home" ? <>
            <ChevronRight size={14} aria-hidden="true" />
            <button type="button" className="ui-button ed-button" aria-label={page ? "Show space page" : note ? `Show note ${note.title || "Untitled note"}` : "Show Folio home"}
              title={page ? "Space page" : note?.title || "Folio home"} aria-current={pane === "note" ? "location" : undefined}
              onClick={() => { setHistory(null); setPane("note"); }}>
              <span>{page ? "Space page" : note?.title || "Folio home"}</span>
            </button>
          </> : null}
        </nav>
        <nav
          className="notes-sidebar pretty-scrollbar"
          aria-label="Folio spaces"
        >
          <button
            type="button"
            className="notes-new-button ui-button ui-button-primary"
            disabled={!ready || busy}
            onClick={create}
          >
            <Plus size={14} />
            New note
          </button>
          <div className="notes-nav-group"><button type="button" className="notes-nav-item" disabled={!ready} onClick={()=>setFeatureDialog('create')}>Templates / Import Markdown</button>
          <button type="button" className="notes-nav-item" disabled={!ready} onClick={()=>setFeatureDialog('search')}><Search size={14}/> Find notes <small>Ctrl K</small></button>
          <button type="button" className="notes-nav-item" disabled={!ready} onClick={()=>setFeatureDialog('due')}>Review due{dueCount?` (${dueCount}${dueCount===40?'+':''})`:''}</button>
          {!isPhone ? <button type="button" className="notes-nav-item" disabled={!ready} onClick={event => {
            if (busyRef.current) return;
            setError("");
            setBulkSpaceTrigger(event.currentTarget);
          }}><ListChecks size={14} /> Manage spaces</button> : null}
          </div>
          <div className="notes-nav-group">
            {navItem({ kind: "home" }, "Home", <Home size={14} />)}
            {navItem({ kind: "favorites" }, "Favorites", <Star size={14} />)}
          </div>
          <div className="notes-nav-group">
            <div className="notes-nav-heading" data-folio-tone="personal">
              <span>Personal</span>
              <button
                className="notes-icon-button"
                aria-label="New Personal space"
                onClick={() => newSpace(true, rootId)}
              >
                <Plus size={14} />
              </button>
            </div>
            {spaceRows("personal", null)}
            {offlineNotesAvailable ? (
              <a className="notes-nav-item" href={offlineNotesPath}>
                <Download size={14} /> Offline Notes
              </a>
            ) : null}
          </div>
          <div className="notes-nav-group">
            <div className="notes-nav-heading" data-folio-tone="shared">
              <span>Folio</span>
              <button
                className="notes-icon-button"
                aria-label="New shared space"
                onClick={() => newSpace(false, null)}
              >
                <Plus size={14} />
              </button>
            </div>
            {spaceRows("shared", null)}
            {navItem(
              { kind: "unconnected" },
              "Unconnected",
              <Link2 size={14} />,
            )}
          </div>
          <div className={styles.bottom}>
            <div className="notes-nav-group">
              {navItem({ kind: "archive" }, "Archive", <Folder size={14} />)}
              {navItem({ kind: "trash" }, "Trash", <FileText size={14} />)}
            </div>
            <button
              type="button"
              className="notes-nav-item" data-folio-tone="board"
              aria-expanded={nav.boardsExpanded}
              onClick={() =>
                setNav((n) => ({ ...n, boardsExpanded: !n.boardsExpanded }))
              }
            >
              {nav.boardsExpanded ? (
                <ChevronDown size={14} />
              ) : (
                <ChevronRight size={14} />
              )}
              <LayoutGrid size={14} />
              Boards
            </button>
            {nav.boardsExpanded ? spaceRows("board", null) : null}
          </div>
        </nav>
        {separator("sidebar")}
        <section className="notes-list-pane" aria-label="Notes list" data-folio-tone={space?.kind ?? "shared"}>
          <header className="notes-pane-header">
            <h2 className="notes-pane-title truncate">{title}</h2>
            <span className="notes-pane-count">
              {notes.length}
              {hasMore ? "+" : ""}
            </span>
            <button
              className="notes-icon-button"
              aria-label="New note here"
              onClick={create}
            >
              <Plus size={15} />
            </button>
          </header>
          {space ? (
            <div className={styles.spaceTools}>
              <button
                className="ui-button ed-button"
                onClick={() => {
                  setNav((n) => ({ ...n, noteId: null }));
                  setPane("note");
                }}
              >
                Space page
              </button>
              <div className={styles.spaceActions}>
                {canDeleteFolioSpace(space) ? <button type="button" className={`notes-icon-button ${styles.spaceDelete}`}
                  disabled={busy} title={`Delete space ${space.title}`} aria-label={`Delete space ${space.title}`}
                  onClick={()=>{void deleteSpace(space);}}><Trash2 size={15}/></button> : null}
                {menuButton({ kind: "space", item: space }, "Manage space")}
              </div>
            </div>
          ) : null}
          <div className="notes-list pretty-scrollbar" aria-busy={loading}>
            {nav.view.kind === "archive" && !query
              ? spaces
                  .filter(
                    (s) =>
                      s.archived &&
                      !spaces.some((p) => p.id === s.parentId && p.archived) &&
                      (s.kind === "task" ||
                        s.kind === "shared" ||
                        s.kind === "personal" ||
                        s.kind === "board"),
                  )
                  .map((s) => (
                    <div className={styles.archiveRow} key={s.id}>
                      <button
                        className="notes-list-item"
                        onClick={() =>
                          selectView({ kind: "space", spaceId: s.id })
                        }
                      >
                        <span className="notes-list-title">{s.title}</span>
                        <small>
                          Archived{" "}
                          {s.kind === "board"
                            ? "board"
                            : s.kind === "task"
                              ? "task"
                              : "space"}
                        </small>
                      </button>
                      <button
                        className="ui-button ed-button"
                        disabled={busy || s.kind === "board"}
                        onClick={() =>
                          s.kind === "task"
                            ? void run(async () => {
                                await folioRequest(
                                  {},
                                  { action: "restoreTaskSpace", spaceId: s.id },
                                );
                                await refreshLibrary();
                                setEpoch((n) => n + 1);
                              })
                            : void manageSpace(s, { archived: false })
                        }
                      >
                        Restore
                      </button>
                    </div>
                  ))
              : null}
            {notes.map((n) => (
              <div className="notes-list-row" data-note-row={n.id} key={n.id} {...menuEvents({ kind: "note", item: n })}>
                <button
                  type="button"
                  className={`notes-list-item ${styles.noteListItem}`}
                  data-active={note?.id === n.id}
                  onClick={() => void openNote(n.id)}
                >
                  <span className="notes-list-title">
                    {n.pinned ? <Star size={12} /> : <FileText size={12} />}
                    <span className="truncate" title={n.displayTitle}>
                      {n.displayTitle}
                    </span>
                  </span>
                  <span style={{display:'flex',alignItems:'center',minWidth:0}}><time
                    className={styles.noteDate}
                    dateTime={n.updatedAt}
                    title={date(n.updatedAt)}
                  >
                    {listDate(n.updatedAt)}
                  </time><FolioPeople people={n.features?.people}/></span>
                </button>
                {menuButton({ kind: "note", item: n }, `Note actions for ${n.displayTitle}`, "notes-row-actions notes-list-row-actions")}
              </div>
            ))}
            {!notes.length ? (
              <p className="notes-nav-empty">
                {loading
                  ? "Loading…"
                  : query
                    ? "No matching notes."
                    : "No notes here yet."}
              </p>
            ) : null}
            {hasMore ? (
              <button
                className="ui-button ed-button"
                disabled={busy}
                onClick={() => void loadMore()}
              >
                Load more
              </button>
            ) : null}
          </div>
        </section>
        {separator("list")}
        <section
          className="notes-editor-pane"
          aria-label={page ? "Space page" : "Note"}
        >
          {error ? (
            <p className="notes-error" role="alert">
              {error}{" "}
              <button
                onClick={() => {
                  setEpoch((n) => n + 1);
                  void run(refreshLibrary);
                }}
              >
                Retry
              </button>
            </p>
          ) : null}
          {history && note?.id === history ? (
            <FolioHistory
              key={note.id}
              noteId={note.id}
              isPhone={isPhone}
              canRestore={note.canEdit && !note.deletedAt && !note.archived}
              onClose={() => {
                setHistory(null);
                requestAnimationFrame(() =>
                  frameRef.current
                    ?.querySelector<HTMLElement>(
                      'button[aria-label="Note actions"]',
                    )
                    ?.focus(),
                );
              }}
              onRestore={async (snapshot) => {
                if (
                  !(await confirm({
                    title: `Restore version ${snapshot.version}?`,
                    body: "This restores the note’s content and page settings as a new revision. Current connections and newer current files are kept.",
                    confirmLabel: "Restore version",
                  }))
                )
                  return;
                setBusy(true);
                try {
                  await noteAction(
                    async (id, version) =>
                      (
                        await folioRequest<{ note: NoteDetail }>(
                          {},
                          {
                            action: "restoreVersion",
                            noteId: id,
                            versionId: snapshot.id,
                            expectedVersion: version,
                            expectedSnapshotToken: snapshot.token,
                          },
                        )
                      ).note,
                    true,
                  );
                  setHistory(null);
                } finally {
                  setBusy(false);
                }
              }}
            />
          ) : note ? (
            <article className="notes-editor-shell" data-testid="folio-editor">
              <header className="notes-editor-toolbar" {...(!isDraft ? menuEvents({kind:"note",item:note}) : {})}>
                <span ref={setContentsHost} style={{ position: "relative", display: "inline-flex", flex: "none" }} />
                <span className={styles.toolbarSpacer} />
                {!isDraft&&note.canEdit&&!note.archived&&!note.deletedAt?<button type="button" className="ui-button ed-button" onClick={()=>{setNav(n=>({...n,editing:true}));requestAnimationFrame(()=>{if(attachmentDetails.current){attachmentDetails.current.open=true;attachmentDetails.current.scrollIntoView({block:'nearest',behavior:'smooth'});attachmentDetails.current.querySelector<HTMLInputElement>('input[type="file"]')?.click();}});}}>Attach files</button>:null}
                <span className="notes-save-state" aria-live="polite">
                  {status === "saving"
                    ? "Saving…"
                    : status === "pending"
                      ? "Unsaved"
                      : status === "saved"
                        ? "Saved"
                        : status === "error"
                          ? "Couldn't save"
                          : status === "conflict"
                            ? "Conflict"
                            : ""}
                </span>
                {note.canEdit && !note.deletedAt && !note.archived ? (
                  <button
                    className={`ui-button ed-button ${styles.editAction}`}
                    disabled={busy}
                    aria-pressed={nav.editing}
                    onClick={() =>
                      void run(async () => {
                        if (
                          nav.editing &&
                          !isDraft &&
                          !(await drafts.saveNote(note.id))
                        )
                          throw new Error("Resolve your unsaved edits first.");
                        setNav((n) => ({ ...n, editing: !n.editing }));
                      })
                    }
                  >
                    {nav.editing ? "Read" : "Edit"}
                  </button>
                ) : null}
                {isPhone ? (
                  <button
                    className="notes-icon-button"
                    aria-label={
                      nav.editing ? "Formatting" : "Reading text size"
                    }
                    onPointerDown={(e) => {
                      if (nav.editing) e.preventDefault();
                    }}
                    onClick={() =>
                      nav.editing ? setFormatting((v) => !v) : setReading(true)
                    }
                  >
                    Aa
                  </button>
                ) : null}
                {!page && !isDraft && !note.deletedAt ? (
                  <button
                    className="notes-icon-button"
                    disabled={busy}
                    aria-label={
                      (note.folio?.favorite ?? note.legacy?.favorite)
                        ? "Remove favorite"
                        : "Add favorite"
                    }
                    aria-pressed={note.folio?.favorite ?? note.legacy?.favorite}
                    onClick={() =>
                      void run(() =>
                        noteAction(
                          async (id) =>
                            (
                              await folioRequest<{ note: NoteDetail }>(
                                {},
                                {
                                  action: "favorite",
                                  noteId: id,
                                  favorite: !(
                                    note.folio?.favorite ??
                                    note.legacy?.favorite
                                  ),
                                },
                              )
                            ).note,
                        ),
                      )
                    }
                  >
                    <Star
                      size={16}
                      fill={
                        (note.folio?.favorite ?? note.legacy?.favorite)
                          ? "currentColor"
                          : "none"
                      }
                    />
                  </button>
                ) : null}
                {!isDraft ? menuButton({ kind: "note", item: note }, "Note actions") : null}
              </header>
              {status === "error" || status === "conflict" ? (
                <div className="notes-conflict" role="alert">
                  <span>Your unsaved edits are kept in this tab.</span>
                  <button
                    className="ui-button ed-button"
                    onClick={() =>
                      void run(async () => {
                        if (isDraft) await drafts.createNewNote(note.id);
                        else if (!(await drafts.saveNote(note.id)))
                          throw new Error("The note could not be saved.");
                      })
                    }
                  >
                    Retry save
                  </button>
                  {status === "conflict" ? (
                    <>
                      <button
                        className="ui-button ed-button"
                        onClick={() =>
                          void run(async () => {
                            if (
                              await confirm({
                                title: "Reload saved version?",
                                body: "This replaces your local unsaved text with the current saved note.",
                                confirmLabel: "Reload",
                              })
                            ) {
                              const fresh = await fetchNote(note.id);
                              drafts.forget(note.id);
                              install(fresh);
                            }
                          })
                        }
                      >
                        Reload theirs
                      </button>
                      <button
                        className="ui-button ed-button"
                        onClick={() =>
                          void run(async () => {
                            if (!(await drafts.keepMine(note.id)))
                              throw new Error(
                                "Unable to save. Your edits are kept.",
                              );
                          })
                        }
                      >
                        Keep mine
                      </button>
                    </>
                  ) : null}
                </div>
              ) : null}
              {note.deletedAt ? (
                <p className="notes-notice">
                  In Trash. Restore this note to edit it.
                </p>
              ) : note.archived ? (
                <p className="notes-notice">
                  Archived. Unarchive this note to edit it.
                </p>
              ) : !note.canEdit ? (
                <p className="notes-notice">
                  This space is archived. Restore it to edit its page.
                </p>
              ) : null}
              <div
                className="notes-editor-body pretty-scrollbar"
                data-mobile-formatting={isPhone && formatting && nav.editing}
              >
                <div className={styles.readingLayout}>
                  <div className={styles.railSlot} ref={setContentsRailHost} />
                  <div className={styles.articleContent} data-space-page={page || undefined}>
                  <header className={styles.documentHeader}>
                    {canEdit ? <textarea ref={mobileTitleRef} className={styles.documentTitle} aria-label={page ? "Space page title" : "Note title"} rows={1} value={note.title} maxLength={300} placeholder="Untitled note" onChange={e => updateFields({title: e.target.value.replace(/\r?\n/g, " ")})} /> : <h1 className={styles.documentTitle}>{note.title || "Untitled note"}</h1>}
              <div className={styles.properties}>
                {!page ? (
                  <>
                    <div className={styles.connections}>
                      <span>Connect to:</span>
                      {note.legacy ? (
                        <span
                          className={styles.chip}
                          title="Existing organization; unchanged until you connect this note"
                        >
                          {legacyPlacement}
                        </span>
                      ) : null}
                      {note.folio?.connections.map((c) => (
                        <span className={styles.chip} key={c.id} title={c.path} data-space-kind={c.kind}>
                          {folioConnectionLabel(c, viewerId)}
                          {canEdit ? (
                            <button
                              aria-label={`Disconnect ${folioConnectionLabel(c, viewerId)}`}
                              disabled={busy}
                              onClick={() => void connect(c.id, false)}
                            >
                              <X size={12} />
                            </button>
                          ) : null}
                        </span>
                      ))}
                      {canEdit ? (
                        <button
                          className="ui-button ed-button"
                          onClick={event => { setPickerReturnFocus(event.currentTarget); setPicker(note); }}
                        >
                          <Plus size={13} />
                          Connect
                        </button>
                      ) : null}
                    </div>
                    <small>
                      {note.legacy
                        ? note.legacy.kind === "personal"
                          ? "Personal · Only you"
                          : "Existing board access"
                        : note.folio?.audience === "personal"
                          ? (note.features?.linkSharing?'Personal · Link sharing enabled':"Personal · Only you")
                          : (note.features?.linkSharing?'Shared · Everyone · Link sharing enabled':"Public · Everyone")}
                      {note.folio?.unconnected ? " · Unconnected" : ""}
                    </small>

                  </>
                ) : (
                  <small>
                    Space page ·{" "}
                    {note.folio?.audience === "personal"
                      ? "Only you"
                      : "Shared"}
                  </small>
                )}
                <div className={styles.metaRow}>
                  <span>{isDraft ? "New note" : `Last edited by ${note.updatedByDisplayName ?? note.ownerDisplayName ?? "Someone"} · ${date(note.updatedAt)}`}</span>
                  <button type="button" className="notes-icon-button" aria-label={page ? "Space information" : "Note information"} title="Information and keywords" onClick={event => setInformation({noteId: note.id, trigger: event.currentTarget})}><Info size={15} /></button>
                </div>
              </div>
                  </header>
                {!isDraft&&note.folio?<FolioNoteTools key={note.id} note={note} viewerId={viewerId} onOpen={id=>void openNote(id)} onFeatures={features=>{setNote(old=>old?.id===note.id?{...old,features}:old);setEpoch(e=>e+1);}}/>:null}
                {page && note.folio?.pageState.bannerAttachmentId ? (
                  <div className={styles.banner}>
                    <Image
                      unoptimized
                      width={1600}
                      height={480}
                      src={getNoteAttachmentUrl(
                        note.id,
                        note.folio.pageState.bannerAttachmentId,
                      )}
                      alt="Space banner"
                    />
                    {canEdit ? (
                      <button
                        className="ui-button ed-button"
                        onClick={() =>
                          void run(() =>
                            updatePage({
                              ...note.folio!.pageState,
                              bannerAttachmentId: null,
                            }),
                          )
                        }
                      >
                        Remove banner
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {page && canEdit ? (
                  <div className={styles.pageControls}>
                    <label className="ui-button ed-button">
                      {note.folio?.pageState.bannerAttachmentId
                        ? "Change banner"
                        : "Add banner"}
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/gif,image/avif"
                        hidden
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          e.target.value = "";
                          if (file)
                            void run(async () => {
                              await noteAction(async (id) => {
                                const files = await uploadNoteAttachmentRequest(
                                  id,
                                  file,
                                );
                                const fresh = await fetchNote(id);
                                return updateNoteRequest(id, {
                                  folioPageState: {
                                    ...fresh.folio!.pageState,
                                    bannerAttachmentId: files[0].id,
                                  },
                                  expectedVersion: fresh.contentVersion,
                                });
                              });
                            });
                        }}
                      />
                    </label>
                    {!note.folio?.pageState.notesListVisible ? (
                      <button
                        className="ui-button ed-button"
                        onClick={() =>
                          void run(() =>
                            updatePage({
                              ...note.folio!.pageState,
                              notesListVisible: true,
                            }),
                          )
                        }
                      >
                        Restore notes list
                      </button>
                    ) : null}
                  </div>
                ) : null}
                {page &&
                note.folio?.pageState.notesListVisible &&
                note.folio.pageState.notesListPosition === "before"
                  ? noteLinks
                  : null}
                <div className="notes-editor-view">
                  <NoteEditor
                    key={editorEpoch}
                    initialBlocks={note.content}
                    editable={canEdit}
                    contentFormatVersion={note.contentFormatVersion ?? 2}
                    mobile={isPhone}
                    mobileFormatting={formatting && nav.editing}
                    onCloseMobileFormatting={() => setFormatting(false)}
                    wikiContext={
                      note.wiki
                        ? { spaceId: note.wiki.spaceId, noteId: note.id }
                        : undefined
                    }
                    authenticatedMentions={Boolean(note.folio)}
                    contents={{ noteId: note.id, viewerId, host: contentsHost, railHost: contentsRailHost, mobile: isPhone, editing: nav.editing,
                      copySection: async (blockId, content) => {
                        let href = "";
                        await noteAction(async (id, version) => {
                          let fresh = await fetchNote(id);
                          if (!noteOutline(fresh.content, true).some(h => h.id === blockId)) {
                            // Explicit copy action may persist IDs generated for an
                            // older document. Reading/outline navigation never saves.
                            if (!fresh.canEdit || fresh.deletedAt || fresh.archived)
                              throw new Error("This older section needs an editor to save its link first.");
                            if (!noteOutline(content.blocks, true).some(h => h.id === blockId))
                              throw new Error("This section is no longer available.");
                            const normalized = !nav.editing ? { ...content, blocks: copyNoteBlockIds(fresh.content, content.blocks), markdown: fresh.contentMarkdown } : content;
                            fresh = await updateNoteRequest(id, { content: normalized, expectedVersion: version });
                          }
                          if (!noteOutline(fresh.content, true).some(h => h.id === blockId))
                            throw new Error("This section is no longer available.");
                          href = sectionHref(fresh.id, blockId);
                          return fresh;
                        });
                        if (!href) throw new Error("Unable to save this section link.");
                        return href;
                      },
                    }}
                    onChange={(content) => updateFields({ content })}
                    uploadFile={upload}
                  />
                </div>
                {page && spaces.some(s => s.parentId === pageSpaceId && !s.archived) ? <nav className={styles.subspaces} aria-label="Subspaces"><h2>Subspaces</h2>{spaces.filter(s => s.parentId === pageSpaceId && !s.archived).map(s => <button key={s.id} type="button" onClick={() => selectView({kind: "space", spaceId: s.id})}><Folder size={15} />{s.title}<ChevronRight size={14} /></button>)}</nav> : null}
                {page &&
                note.folio?.pageState.notesListVisible &&
                note.folio.pageState.notesListPosition === "after"
                  ? noteLinks
                  : null}
                {!isDraft ? (
                    <details ref={attachmentDetails} className={styles.files}>
                    <summary>Attachments ({note.attachments.length})</summary>
                    <MobileNoteAttachments
                      noteId={note.id}
                      attachments={note.attachments}
                      canEdit={canEdit}
                      onUpload={upload}
                        onUploadMany={async files=>{await noteAction(async id=>{await uploadNoteAttachmentsRequest(id,files);return fetchNote(id);});}}
                      onRemove={async (id) => {
                        await noteAction(async (noteId) => {
                          await deleteNoteAttachmentRequest(noteId, id);
                          return fetchNote(noteId);
                        });
                      }}
                    />
                  </details>
                ) : null}
                  </div>
                </div>
              </div>

            </article>
          ) : nav.view.kind === "home" && !query ? (
            <div className={styles.home}>
              <span className={styles.eyebrow}>Your knowledge, connected</span>
              <h1>Folio</h1>
              <p>
                Write a note. Connect it to a space, board, or task. Find it
                wherever it belongs.
              </p>
              <div className={styles.homeSpaces}>
                <button
                  className="ui-button ed-button ui-button-primary"
                  onClick={create}
                >
                  <Plus size={15} />
                  New note
                </button>
                <button
                  className="ui-button ed-button notes-back-to-list"
                  onClick={() => setPane("nav")}
                >
                  Browse spaces
                </button>
                <button
                  className="ui-button ed-button notes-back-to-list"
                  onClick={() => setPane("list")}
                >
                  Recent notes
                </button>
              </div>
              <div className={styles.homeStats}>
                <div>
                  <strong>
                    {
                      spaces.filter((s) => s.kind === "shared" && !s.archived)
                        .length
                    }
                  </strong>
                  <span>Shared spaces</span>
                </div>
                <div>
                  <strong>
                    {notes.length}
                    {hasMore ? "+" : ""}
                  </strong>
                  <span>Recent notes</span>
                </div>
              </div>
              <h2>Explore spaces</h2>
              <div className={styles.homeSpaces}>
                {spaces
                  .filter(
                    (s) => s.kind === "shared" && !s.parentId && !s.archived,
                  )
                  .map((s) => (
                    <button
                      className="ui-button ed-button"
                      key={s.id}
                      onClick={() =>
                        selectView({ kind: "space", spaceId: s.id })
                      }
                    >
                      <Folder size={16} />
                      {s.title}
                    </button>
                  ))}
                <button
                  className="ui-button ed-button"
                  onClick={() => newSpace(false, null)}
                >
                  <Plus size={16} />
                  New space
                </button>
              </div>
              <h2>Recent activity</h2>
              {notes.slice(0, 8).map((n) => (
                <button
                  className={styles.activity}
                  key={n.id}
                  onClick={() => void openNote(n.id)}
                >
                  <FileText size={15} />
                  <span>
                    {n.displayTitle}
                    <small>
                      {n.updatedByDisplayName ??
                        n.ownerDisplayName ??
                        "Someone"}{" "}
                      edited · {date(n.updatedAt)}
                    </small>
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <div className="notes-editor-empty">
              <p>
                {loading ? "Opening…" : "Select a note or open a space page."}
              </p>
              <button
                className="ui-button ed-button notes-back-to-list"
                onClick={() => setPane("list")}
              >
                Back to notes
              </button>
            </div>
          )}
        </section>
      </div>
      {featureDialog==='create'?<FolioCreateDialog spaces={spaces} onClose={()=>setFeatureDialog(null)} onCreated={(created,destination)=>{selectView(destination?{kind:'space',spaceId:destination}:{kind:'unconnected'});void openNote(created.id,true);setEpoch(e=>e+1);}}/>:featureDialog?<FolioDiscoveryDialog spaces={spaces} initialMode={featureDialog==='due'?'due':'recent'} initialQuery={searchQuery} onClose={()=>setFeatureDialog(null)} onOpen={id=>void openNote(id)}/>:null}
      {picker ? (
        <ConnectionPicker
          viewerId={viewerId}
          returnFocus={pickerReturnFocus}
          spaces={spaces}
          selected={picker.folio?.connections.map((c) => c.id) ?? []}
          disabled={busy}
          onClose={() => setPicker(null)}
          onSelect={(id) => void connect(id, true)}
          errorMessage={error}
          onDisconnect={(id) => void connect(id, false)}
          onSpaces={(targets) =>
            setSpaces((old) => [
              ...old.filter((s) => !targets.some((t) => s.id === t.id)),
              ...targets,
            ])
          }
        />
      ) : null}
      {information && note?.id === information.noteId ? <FolioDialog title={page ? "Space information" : "Note information"} returnFocus={information.trigger} onClose={() => setInformation(null)}>
        <p>Created {date(note.createdAt)} · {note.ownerDisplayName ?? "Someone"}</p>
        <p>Last edited {date(note.updatedAt)} · {note.updatedByDisplayName ?? note.ownerDisplayName ?? "Someone"}</p>
        <h3>Keywords</h3>
                    <div className={styles.connections}>
                      <span>Tags</span>
                      {note.labels.map((label) => (
                        <span className={styles.chip} key={label}>
                          {label}
                          {canEdit ? (
                            <button
                              aria-label={`Remove tag ${label}`}
                              onClick={() =>
                                void run(() =>
                                  noteAction((id, version) =>
                                    updateNoteRequest(id, {
                                      labels: note.labels.filter(
                                        (t) => t !== label,
                                      ),
                                      expectedVersion: version,
                                    }),
                                  ),
                                )
                              }
                            >
                              <X size={12} />
                            </button>
                          ) : null}
                        </span>
                      ))}
                      {canEdit ? (
                        <form
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (tag.trim())
                              void run(async () => {
                                await noteAction((id, version) =>
                                  updateNoteRequest(id, {
                                    labels: [
                                      ...new Set([...note.labels, tag.trim()]),
                                    ],
                                    expectedVersion: version,
                                  }),
                                );
                                setTag("");
                              });
                          }}
                        >
                          <input
                            className="ed-field"
                            data-dialog-initial-focus
                            aria-label="Add keyword tag"
                            placeholder="Add keyword…"
                            value={tag}
                            maxLength={80}
                            onChange={(e) => setTag(e.target.value)}
                          />
                        </form>
                      ) : null}
                    </div>
        {page ? <details><summary>Recent note updates</summary>{[...pageNotes].sort((a,b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0,8).map(n => <p key={n.id}>{n.displayTitle}<br />{n.updatedByDisplayName ?? n.ownerDisplayName ?? "Someone"} · {date(n.updatedAt)}</p>)}{!pageNotes.length ? <p>No connected note updates yet.</p> : null}</details> : null}
      </FolioDialog> : null}
      {adoptionTarget ? (
        <FolioDialog
          title="Connect existing note"
          onClose={() => setAdoptionTarget(null)}
        >
          <p>
            {adoptionTarget.note.legacy?.kind === "personal" &&
            spaces.find((s) => s.id === adoptionTarget.spaceId)?.kind === "personal"
              ? "This note will use Folio connections and stay in your Personal library."
              : "This changes the note’s existing access. Its Folio connections will make it visible and editable to everyone signed in to Taskboard."}
          </p>
          <p>
            Its current location is preserved as a connection. The note keeps
            its content, files, history, and task references.
          </p>
          <button
            className="ui-button ed-button ui-button-primary"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await targetNoteAction(
                  adoptionTarget.note, async (fresh) =>
                    (
                      await folioRequest<{ note: NoteDetail }>(
                        {},
                        {
                          action: "adoptLegacy",
                          noteId: fresh.id,
                          spaceId: adoptionTarget.spaceId,
                          expectedVersion: fresh.contentVersion,
                        },
                      )
                    ).note,
                );
                setAdoptionTarget(null);
                await refreshLibrary();
              })
            }
          >
            Connect note
          </button>
          {error ? <p role="alert">{error}</p> : null}
        </FolioDialog>
      ) : null}
      {reading ? (
        <FolioDialog
          title="Reading text size"
          onClose={() => setReading(false)}
        >
          <label>
            Text size <output>{prefs.readingScale}%</output>
            <input
              type="range"
              aria-label="Note text size"
              min={100}
              max={160}
              step={10}
              value={prefs.readingScale}
              onChange={(e) =>
                updateNotesUiPrefs(viewerId, (p) => ({
                  ...p,
                  readingScale: Number(e.target.value),
                }))
              }
            />
          </label>
          <button
            className="ui-button ed-button"
            onClick={() =>
              updateNotesUiPrefs(viewerId, (p) => ({ ...p, readingScale: 100 }))
            }
          >
            Reset
          </button>
        </FolioDialog>
      ) : null}
      {bulkSpaceTrigger ? (
        <FolioDialog
          title="Manage spaces"
          returnFocus={bulkSpaceTrigger}
          onClose={() => { if (!busyRef.current) setBulkSpaceTrigger(null); }}
        >
          <FolioBulkSpaceForm spaces={spaces} busy={busy} error={error} onSubmit={saveBulkSpaces} />
        </FolioDialog>
      ) : null}
      {spaceForm ? (
        <FolioDialog
          title={spaceForm.id ? "Manage space" : "Create space"}
          onClose={() => { if (!busyRef.current) setSpaceForm(null); }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void saveSpace();
            }}
          >
            <label>
              Name
              <input
                className="ed-field"
                data-dialog-initial-focus
                required
                maxLength={120}
                value={spaceForm.title}
                onChange={(e) =>
                  setSpaceForm((f) => (f ? { ...f, title: e.target.value } : f))
                }
              />
            </label>
            <FolioSpaceLocation
              spaces={spaces}
              selectedIds={spaceForm.id ? [spaceForm.id] : []}
              scope={spaceForm.personal ? spaceForm.id ? "both" : "personal" : "shared"}
              value={spaceForm.parentId}
              onChange={parentId => setSpaceForm(f => f ? { ...f, parentId } : f)}
              disabled={busy}
            />
            {sharingSpace ? <FolioShareNotice /> : null}
            {error ? <p role="alert">{error}</p> : null}
            <div className={styles.spaceFormActions}>
              <button className="ui-button ed-button ui-button-primary" disabled={busy || !spaceForm.title.trim()}>
                {busy ? "Saving…" : sharingSpace ? "Move to Folio" : "Save space"}
              </button>
              {managedSpace && canDeleteFolioSpace(managedSpace) ? <button type="button"
                className={`ui-button ed-button ${styles.spaceDelete}`} disabled={busy}
                onClick={()=>{void deleteSpace(managedSpace);}}><Trash2 size={14}/>Delete space</button> : null}
            </div>
          </form>
        </FolioDialog>
      ) : null}
      {itemMenu ? <ContextMenu anchor={itemMenu.anchor} label={itemMenu.target.kind === "note" ? "Note actions" : "Space actions"}
        classNames={menuClasses} onClose={closeItemMenu} showCloseButton
        actions={
          // eslint-disable-next-line react-hooks/refs -- Builders only return event callbacks; refs are read when invoked.
          itemMenu.target.kind === "note" ? noteMenuActions(
          note?.id === itemMenu.target.item.id ? note : notes.find(row => row.id === itemMenu.target.item.id) ?? itemMenu.target.item
        // eslint-disable-next-line react-hooks/refs -- Space callbacks likewise run only after activation.
        ) : spaceMenuActions(spaces.find(row => row.id === itemMenu.target.item.id) ?? itemMenu.target.item)}
        portalTarget={itemMenu.anchor.trigger.closest<HTMLElement>("dialog[open], .notes-frame")} /> : null}
      {dialog}
    </div>
  );
}

function ConnectionPicker({
  viewerId,
  returnFocus,
  spaces,
  selected,
  disabled,
  onClose,
  onSelect,
  onDisconnect,
  errorMessage,
  onSpaces,
}: {
  viewerId: string;
  returnFocus: HTMLElement | null;
  spaces: FolioSpace[];
  selected: string[];
  disabled: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onDisconnect: (id: string) => void;
  errorMessage?: string;
  onSpaces: (s: FolioSpace[]) => void;
}) {
  const [tab, setTab] = useState<"spaces" | "boards">("spaces"),
    [parent, setParent] = useState<string | null>(null),
    [q, setQ] = useState(""),
    [tasks, setTasks] = useState<FolioSpace[]>([]),
    [hasMore, setHasMore] = useState(false),
    [offset, setOffset] = useState(0),
    [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const target = spaces.find((s) => s.id === parent);
  const parentBoard = target?.kind === "board" ? target.boardId : null;
  useEffect(() => {
    if (!parentBoard && !q.trim()) return;
    const controller = new AbortController();
    const timer = setTimeout(
      () => {
        setLoading(true);
        setError("");
        void folioRequest<{ spaces: FolioSpace[]; hasMore: boolean }>(
          q.trim()
            ? { action: "targets", q: q.trim() }
            : { action: "tasks", boardId: parentBoard!, q: "" },
          undefined,
          controller.signal,
        )
          .then((v) => {
            if (controller.signal.aborted) return;
            setTasks(v.spaces);
            setHasMore(v.hasMore);
            setOffset(v.spaces.length);
            onSpaces(v.spaces);
          })
          .catch((e) => {
            if (!controller.signal.aborted) setError(e.message);
          })
          .finally(() => {
            if (!controller.signal.aborted) setLoading(false);
          });
      },
      q ? 160 : 0,
    );
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parentBoard, q]);
  const rows =
    parentBoard || q.trim()
      ? tasks
      : spaces.filter(
          (s) =>
            !s.archived &&
            (tab === "boards"
              ? s.kind === "board"
              : s.kind === "personal" || s.kind === "shared") &&
            (q
              ? s.title.toLocaleLowerCase().includes(q.toLocaleLowerCase())
              : s.parentId === parent),
        );
  const choose = (id: string) => {
    onSelect(id);
    if (q.trim()) {
      setQ("");
      setTasks([]);
      setHasMore(false);
      setLoading(Boolean(parentBoard));
    }
  };
  return (
    <FolioDialog title="Connect to" onClose={onClose} returnFocus={returnFocus}>
      <p>Connect this note to a space, board, or task.</p>
      <div className={styles.connections}>
        {selected.map((id) => {
          const s = spaces.find((s) => s.id === id);
          return s ? (
            <span className={styles.chip} key={id}>
              {folioConnectionLabel(s, viewerId)}
              <button
                disabled={disabled}
                aria-label={`Disconnect ${folioConnectionLabel(s, viewerId)}`}
                onClick={() => onDisconnect(id)}
              >
                <X size={12} />
              </button>
            </span>
          ) : null;
        })}
      </div>
      <div className={styles.pickerTabs}>
        <button
          className="ui-button ed-button"
          aria-pressed={tab === "spaces"}
          onClick={() => {
            setTab("spaces");
            setParent(null);
            setQ("");
          }}
        >
          Spaces
        </button>
        <button
          className="ui-button ed-button"
          aria-pressed={tab === "boards"}
          onClick={() => {
            setTab("boards");
            setParent(null);
            setQ("");
          }}
        >
          Boards &amp; tasks
        </button>
      </div>
      <label className={styles.search}>
        <Search size={15} />
        <input
          className="ed-field"
          data-dialog-initial-focus
          type="search"
          aria-label="Find a connection"
          placeholder={"Start typing a space, board, or task name…"}
          value={q}
          maxLength={300}
          onChange={(e) => {
            setQ(e.target.value);
            setTasks([]);
            setHasMore(false);
            setLoading(Boolean(e.target.value.trim() || parentBoard));
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !disabled && !loading) {
              const first = rows.find((s) => !selected.includes(s.id));
              if (first) {
                e.preventDefault();
                choose(first.id);
              }
            }
          }}
        />
      </label>
      {parent ? (
        <button
          className="ui-button ed-button"
          onClick={() => {
            setParent(target?.parentId ?? null);
            setQ("");
          }}
        >
          <ArrowLeft size={14} />
          Back
        </button>
      ) : null}
      {target ? (
        <div className={styles.pickerRow}>
          <strong>{folioConnectionLabel(target, viewerId)}</strong>
          <button
            className="ui-button ed-button"
            disabled={disabled || selected.includes(target.id)}
            onClick={() => choose(target.id)}
          >
            {selected.includes(target.id) ? "Connected" : "Connect here"}
          </button>
        </div>
      ) : null}
      <div className={styles.pickerResults} aria-busy={loading}>
        {rows.map((s) => (
          <div className={styles.pickerRow} key={s.id}>
            <button
              className={styles.pickerName}
              onClick={() => {
                setParent(s.id);
                setQ("");
              }}
            >
              <Folder size={15} />
              <span>
                {s.title}
                {s.kind === "board" || s.kind === "task" ? <small>{folioBoardDescriptor(s, viewerId)}</small> : q ? (
                  <small>
                    {s.kind === "shared"
                      ? "Space"
                      : s.kind === "personal"
                        ? "Personal"
                        : "Task"}{" "}
                    · {folioSpacePath(spaces, s.id, viewerId)}
                  </small>
                ) : null}
              </span>
              {s.kind !== "task" ? <ChevronRight size={14} /> : null}
            </button>
            <button
              className="ui-button ed-button"
              disabled={disabled || selected.includes(s.id)}
              onClick={() => choose(s.id)}
            >
              {selected.includes(s.id) ? "Connected" : "Connect"}
            </button>
          </div>
        ))}
        {!rows.length ? (
          <p>{loading ? "Loading…" : "No matching connections."}</p>
        ) : null}
        {(parentBoard || q.trim()) && hasMore ? (
          <button
            className="ui-button ed-button"
            disabled={loading}
            onClick={() => {
              setLoading(true);
              void folioRequest<{ spaces: FolioSpace[]; hasMore: boolean }>(
                q.trim()
                  ? { action: "targets", q: q.trim(), offset }
                  : { action: "tasks", boardId: parentBoard!, q: "", offset },
              )
                .then((v) => {
                  setTasks((old) => [...old, ...v.spaces]);
                  setOffset((n) => n + v.spaces.length);
                  setHasMore(v.hasMore);
                  onSpaces(v.spaces);
                })
                .catch((e) => setError(e.message))
                .finally(() => setLoading(false));
            }}
          >
            More connections
          </button>
        ) : null}
      </div>
      <small>
        To create a space, use + beside Personal or Folio in the sidebar and
        choose its location.
      </small>
      {error || errorMessage ? (
        <p role="alert">{error || errorMessage}</p>
      ) : null}
    </FolioDialog>
  );
}
