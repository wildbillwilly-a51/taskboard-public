// Shared Notes types and pure rules. No database or server imports, so the
// client and unit tests can use it.

import type { BoardAccessMetadata } from "@/lib/board-access";
import type { TaskStatus } from "@/lib/taskboard-data";
import type { WikiMetadata } from "@/lib/wiki-model";
import type { FolioNoteMetadata } from "@/lib/folio-model";

export const maxNoteTitleLength = 300;
export const maxNoteContentJsonBytes = 1024 * 1024;
export const maxNoteMarkdownLength = 1024 * 1024;
export const maxNoteTextLength = 512 * 1024;
export const maxNoteLabelLength = 60;
export const maxNoteLabelsPerNote = 30;
export const maxNotebookTitleLength = 120;
export const maxNotebookDepth = 8;
export const noteTrashRetentionMs = 30 * 24 * 60 * 60 * 1000;
export const noteSnippetLength = 200;

export type NoteHome =
  | { kind: "personal" }
  | {
      kind: "board";
      boardId: string;
      boardTitle: string;
      bucketId: string | null;
      bucketTitle: string | null;
    };

export type NoteSummary = {
  features?: import('./folio-features-model').FolioFeatures;
  folio?: FolioNoteMetadata;
  legacy?: {kind:"personal"|"board"|"wiki";placement:string;canAdopt:boolean;favorite?:boolean};
  wiki?: WikiMetadata;
  id: string;
  title: string;
  displayTitle: string;
  snippet: string;
  home: NoteHome;
  notebookId: string | null;
  // Board labels for a board note, the owner's tags for a personal note.
  labels: string[];
  pinned: boolean;
  archived: boolean;
  deletedAt: string | null;
  purgeAfterAt: string | null;
  ownerUserId: string;
  ownerDisplayName: string | null;
  updatedByDisplayName: string | null;
  createdAt: string;
  updatedAt: string;
  canEdit: boolean;
  linkedTaskCount: number;
  attachmentCount: number;
};

export type NoteLinkedTask = {
  id: string;
  title: string;
  status: TaskStatus;
  boardId: string;
  boardTitle: string;
  bucketId: string | null;
  bucketTitle: string | null;
  archived: boolean;
};

export type NoteAttachment = {
  id: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
};

export type NoteDetail = NoteSummary & {
  contentFormatVersion?: number;
  content: unknown[];
  contentMarkdown: string;
  contentVersion: number;
  linkedTasks: NoteLinkedTask[];
  taskReferenceIds?:string[];
  attachments: NoteAttachment[];
};

export type Notebook = {
  id: string;
  title: string;
  parentNotebookId: string | null;
  sortOrder: number;
  noteCount: number;
};

export type NoteHomeBoardOption = {
  boardId: string;
  title: string;
  canEdit: boolean;
  isPersonalBoard: boolean;
  buckets: Array<{ id: string; title: string; color?: string | null }>;
};

export type NoteTagSummary = {
  name: string;
  noteCount: number;
};

export type NoteListStatus = "active" | "archived" | "trash";

export type NoteListFilters = {
  wikiSpaceId?: string;
  scope: "personal" | "board" | "all";
  boardId?: string;
  bucketId?: string;
  // "inbox" lists personal notes outside any notebook.
  notebookId?: string;
  label?: string;
  query?: string;
  status: NoteListStatus;
  pinnedOnly?: boolean;
  limit: number;
  offset: number;
};

export type NoteContentInput = {
  formatVersion?: number;
  // BlockNote document (an array of blocks), stored as-is.
  blocks: unknown[];
  markdown: string;
  text: string;
};

export type NoteAccess = {
  canRead: boolean;
  canEdit: boolean;
};

const noAccess: NoteAccess = { canRead: false, canEdit: false };

// A personal note belongs to its owner alone, even for admins. A board note
// follows the board: viewers read, editors and above edit.
export function resolveNoteAccess(args: {
  userId: string | undefined;
  userIsDisabled?: boolean;
  ownerUserId: string;
  boardId: string | null;
  boardAccess: BoardAccessMetadata | null;
}): NoteAccess {
  if (!args.userId || args.userIsDisabled) {
    return noAccess;
  }

  if (!args.boardId) {
    return args.ownerUserId === args.userId ? { canRead: true, canEdit: true } : noAccess;
  }

  if (!args.boardAccess || args.boardAccess.boardId !== args.boardId) {
    return noAccess;
  }

  return {
    canRead: args.boardAccess.canRead,
    canEdit: args.boardAccess.canEdit,
  };
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

export function normalizeNoteTitle(value: unknown) {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    throw new Error("Note title must be text.");
  }

  const title = value.replace(/\s+/g, " ").trim();

  if (title.length > maxNoteTitleLength) {
    throw new Error(`Note title must be ${maxNoteTitleLength} characters or fewer.`);
  }

  return title;
}

export function normalizeNoteContent(value: unknown): NoteContentInput {
  if (!value || typeof value !== "object") {
    throw new Error("Note content is required.");
  }

  const content = value as Partial<Record<keyof NoteContentInput, unknown>>;
  if (content.formatVersion !== undefined && (typeof content.formatVersion !== "number" || !Number.isSafeInteger(content.formatVersion) || content.formatVersion < 1)) {
    throw new Error("Content format version must be a positive integer.");
  }

  if (!Array.isArray(content.blocks)) {
    throw new Error("Note content must be a list of blocks.");
  }

  const serialized = JSON.stringify(content.blocks);

  if (new TextEncoder().encode(serialized).length > maxNoteContentJsonBytes) {
    throw new Error("This note is too large to save (1 MB limit).");
  }

  const markdown = content.markdown ?? "";
  const text = content.text ?? "";

  if (typeof markdown !== "string" || typeof text !== "string") {
    throw new Error("Note content text must be text.");
  }

  if (markdown.length > maxNoteMarkdownLength || text.length > maxNoteTextLength) {
    throw new Error("This note is too large to save (1 MB limit).");
  }

  return {
    ...(content.formatVersion === undefined ? {} : { formatVersion: content.formatVersion as number }),
    blocks: JSON.parse(serialized) as unknown[],
    markdown,
    text,
  };
}

export const emptyNoteContent: NoteContentInput = { blocks: [], markdown: "", text: "" };

export function normalizeNoteLabels(value: unknown) {
  if (value === undefined || value === null) {
    return [];
  }

  if (!Array.isArray(value)) {
    throw new Error("Labels must be a list.");
  }

  const seen = new Set<string>();
  const labels: string[] = [];

  for (const entry of value) {
    if (typeof entry !== "string") {
      throw new Error("Each label must be text.");
    }

    const label = entry.replace(/\s+/g, " ").trim();

    if (!label) {
      continue;
    }

    if (label.length > maxNoteLabelLength) {
      throw new Error(`Labels must be ${maxNoteLabelLength} characters or fewer.`);
    }

    const key = label.toLowerCase();

    if (!seen.has(key)) {
      seen.add(key);
      labels.push(label);
    }
  }

  if (labels.length > maxNoteLabelsPerNote) {
    throw new Error(`A note can have at most ${maxNoteLabelsPerNote} labels.`);
  }

  return labels;
}

export function normalizeNotebookTitle(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("Notebook name is required.");
  }

  const title = value.replace(/\s+/g, " ").trim();

  if (!title) {
    throw new Error("Notebook name is required.");
  }

  if (title.length > maxNotebookTitleLength) {
    throw new Error(`Notebook names must be ${maxNotebookTitleLength} characters or fewer.`);
  }

  return title;
}

// Builds a prefix tsquery ("plan:* & q4:*") from free text. Only letters,
// digits, and underscores survive, so the result is always valid syntax.
export function buildNoteSearchQuery(value: string | null | undefined) {
  const tokens = (value ?? "").toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
  const unique = Array.from(new Set(tokens)).slice(0, 8);
  return unique.length > 0 ? unique.map((token) => `${token}:*`).join(" & ") : null;
}

export function getNoteDisplayTitle(title: string, text: string) {
  if (title.trim()) {
    return title.trim();
  }

  const firstLine = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  return firstLine ? firstLine.slice(0, 120) : "Untitled note";
}

export function getNoteSnippet(title: string, text: string) {
  let body = text.trim();

  // A note without a title shows its first line as the title; skip it here.
  if (!title.trim()) {
    const newline = body.search(/\r?\n/);
    body = newline >= 0 ? body.slice(newline + 1) : "";
  }

  return body.replace(/\s+/g, " ").trim().slice(0, noteSnippetLength);
}

// Plain text of a BlockNote document, one block per line, for search and
// untitled-note titles. Tolerates unknown block and inline shapes.
export function getBlocksPlainText(blocks: unknown): string {
  const lines: string[] = [];

  const inlineText = (content: unknown): string => {
    if (typeof content === "string") {
      return content;
    }

    if (Array.isArray(content)) {
      return content.map(inlineText).join("");
    }

    if (!content || typeof content !== "object") {
      return "";
    }

    const node = content as { type?: unknown; text?: unknown; content?: unknown; rows?: unknown; cells?: unknown };
    if (node.type === "pageMention") return "";

    if (typeof node.text === "string") {
      return node.text;
    }

    if (node.type === "tableContent" && Array.isArray(node.rows)) {
      return node.rows
        .map((row) =>
          Array.isArray((row as { cells?: unknown }).cells)
            ? ((row as { cells: unknown[] }).cells).map(inlineText).join(" ")
            : "",
        )
        .join(" ");
    }

    return inlineText(node.content);
  };

  const walk = (value: unknown) => {
    if (!Array.isArray(value)) {
      return;
    }

    for (const block of value) {
      if (!block || typeof block !== "object") {
        continue;
      }

      const typed = block as { type?: unknown; content?: unknown; children?: unknown };
      if (typed.type === "pageMention") continue;
      const text = inlineText(typed.content).trim();

      if (text) {
        lines.push(text);
      }

      walk(typed.children);
    }
  };

  walk(blocks);
  return lines.join("\n").slice(0, maxNoteTextLength);
}

export function clampNoteListLimit(value: unknown, fallback = 100) {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return Math.min(Math.floor(parsed), 500);
}

export function clampNoteListOffset(value: unknown) {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(Math.floor(parsed), 100_000) : 0;
}
