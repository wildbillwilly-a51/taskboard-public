import {
  isUuid,
  maxNotebookDepth,
  normalizeNotebookTitle,
} from "@/lib/notes-model";
import type { NoteSummary } from "@/lib/notes-model";
import { folioConnectionLabel } from "./folio-navigation";

export type FolioSpaceKind = "personal" | "shared" | "board" | "task";
export const FOLIO_REVISION_SCOPE = "00000000-0000-4000-8000-000000000014";
export type FolioAudience = "public" | "personal";
export type FolioPageState = {
  bannerAttachmentId: string | null;
  notesListVisible: boolean;
  notesListPosition: "before" | "after";
};
export const defaultFolioPageState: Readonly<FolioPageState> = Object.freeze({
  bannerAttachmentId: null,
  notesListVisible: true,
  notesListPosition: "after",
});
export type FolioSpace = {
  id: string;
  kind: FolioSpaceKind;
  title: string;
  parentId: string | null;
  ownerUserId: string | null;
  boardId: string | null;
  taskId: string | null;
  root: boolean;
  archived: boolean;
  pageNoteId: string | null;
  canManage: boolean;
  canDelete?: boolean;
  legacyNotebookId?: string | null;
  boardType?: "personal" | "team";
  boardTitle?: string;
  boardOwnerUserId?: string | null;
  boardOwnerDisplayName?: string | null;
  boardOwnerTeamName?: string | null;
};
export const maxFolioSpaceSelection = 500;

export type FolioSpaceBatchChange =
  | { parentId: string | null; share?: boolean }
  | { archived: true }
  | { remove: true };

export type FolioConnection = Pick<
  FolioSpace,
  "id" | "kind" | "title" | "parentId" | "boardType" | "boardTitle" | "boardOwnerUserId" | "boardOwnerDisplayName" | "boardOwnerTeamName"
> & { path: string; taskId?: string | null; boardId?: string | null };
export type FolioNoteMetadata = {
  kind: "document" | "space_page";
  audience: FolioAudience;
  unconnected: boolean;
  favorite: boolean;
  connections: FolioConnection[];
  pageSpaceId: string | null;
  pageState: FolioPageState;
};
export type FolioView =
  | { kind: "home" }
  | { kind: "unconnected" | "favorites" | "trash" | "archive" | "search" }
  | { kind: "space"; spaceId: string };
export type FolioNavigation = {
  view: FolioView;
  noteId: string | null;
  editing: boolean;
  expanded: string[];
  boardsExpanded: boolean;
};
export const defaultFolioNavigation: FolioNavigation = {
  view: { kind: "home" },
  noteId: null,
  editing: false,
  expanded: [],
  boardsExpanded: false,
};
export type FolioListing = {
  notes: NoteSummary[];
  hasMore: boolean;
  offset: number;
};

// This takes the COMPLETE active connection set, never the viewer projection.
export function deriveFolioPlacement(
  connections: ReadonlyArray<{ kind: FolioSpaceKind }>,
) {
  return {
    unconnected: connections.length === 0,
    audience:
      connections.length === 0 || connections.some((c) => c.kind !== "personal")
        ? ("public" as const)
        : ("personal" as const),
  };
}

export function canReadFolioDocument(args: {
  actorId?: string;
  disabled?: boolean;
  ownerId: string;
  audience: FolioAudience;
}) {
  return Boolean(
    args.actorId &&
      !args.disabled &&
      (args.audience === "public" || args.actorId === args.ownerId),
  );
}

export function folioSpacePath(spaces: readonly FolioSpace[], id: string, viewerId?: string) {
  const byId = new Map(spaces.map((space) => [space.id, space]));
  const parts: string[] = [],
    seen = new Set<string>();
  let space = byId.get(id);
  while (space && !seen.has(space.id)) {
    seen.add(space.id);
    parts.unshift(viewerId && space.kind === "board" ? folioConnectionLabel(space, viewerId) : space.title);
    space = space.parentId ? byId.get(space.parentId) : undefined;
  }
  return parts.join(" / ");
}

export function folioDescendants(spaces: readonly FolioSpace[], id: string) {
  const found = new Set([id]);
  for (let changed = true; changed; ) {
    changed = false;
    for (const space of spaces)
      if (space.parentId && found.has(space.parentId) && !found.has(space.id)) {
        found.add(space.id);
        changed = true;
      }
  }
  return found;
}

export function normalizeFolioPageState(value: unknown): FolioPageState {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid space page settings.");
  const v = value as Record<string, unknown>;
  if (
    Object.keys(v).some(
      (k) =>
        ![
          "bannerAttachmentId",
          "notesListVisible",
          "notesListPosition",
        ].includes(k),
    ) ||
    (v.bannerAttachmentId !== null && !isUuid(v.bannerAttachmentId)) ||
    typeof v.notesListVisible !== "boolean" ||
    !["before", "after"].includes(String(v.notesListPosition))
  ) {
    throw new Error("Invalid space page settings.");
  }
  return {
    bannerAttachmentId: v.bannerAttachmentId as string | null,
    notesListVisible: v.notesListVisible,
    notesListPosition: v.notesListPosition as "before" | "after",
  };
}

export function normalizeFolioSpaceTitle(value: unknown) {
  try {
    return normalizeNotebookTitle(value);
  } catch (error) {
    throw new Error(
      error instanceof Error
        ? error.message
            .replaceAll("Notebook", "Space")
            .replaceAll("notebook", "space")
        : "Invalid space name.",
    );
  }
}
export const maxFolioSpaceDepth = maxNotebookDepth;

// Login-scoped keys separate fresh sign-in from ordinary route/module returns.
// The key is an opaque session identifier, never a session credential.
export function folioNavigationKey(userId: string, sessionKey: string) {
  return `taskboard-folio:${userId}:${sessionKey}:v1`;
}
export function parseFolioNavigation(raw: string | null): FolioNavigation {
  try {
    if (!raw) return { ...defaultFolioNavigation, expanded: [] };
    const v = JSON.parse(raw) as Partial<FolioNavigation>;
    const kinds = [
      "home",
      "unconnected",
      "favorites",
      "trash",
      "archive",
      "search",
      "space",
    ];
    if (
      !v.view ||
      !kinds.includes(v.view.kind) ||
      (v.view.kind === "space" && !isUuid(v.view.spaceId)) ||
      (v.noteId != null && !isUuid(v.noteId))
    )
      throw new Error("Invalid navigation");
    return {
      view: v.view,
      noteId: v.noteId ?? null,
      editing: v.editing === true,
      expanded: Array.isArray(v.expanded)
        ? v.expanded.filter(isUuid).slice(0, 500)
        : [],
      boardsExpanded: v.boardsExpanded === true,
    };
  } catch {
    return { ...defaultFolioNavigation, expanded: [] };
  }
}
