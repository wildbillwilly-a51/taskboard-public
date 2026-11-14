import type { CSSProperties } from "react";
import type { NoteHome, NoteHomeBoardOption } from "./notes-model";

export type NotesBucketContext = { color: string; label: string; title: string };
export type NotesBucketContexts = ReadonlyMap<string, ReadonlyMap<string, NotesBucketContext>>;

// Same six-digit colour contract and null fallback as Board. Unknown homes
// stay neutral; only an accessible bucket supplies identity colour.
export function notesBucketContext(
  board: NoteHomeBoardOption,
  bucket: NoteHomeBoardOption["buckets"][number],
): NotesBucketContext {
  return {
    color: typeof bucket.color === "string" && /^#[0-9a-f]{6}$/i.test(bucket.color) ? bucket.color : "#64748b",
    label: `${board.title} · ${bucket.title}`,
    title: bucket.title,
  };
}

export function buildNotesBucketContexts(boards: NoteHomeBoardOption[]): NotesBucketContexts {
  return new Map(boards.map(board => [board.boardId,
    new Map(board.buckets.map(bucket => [bucket.id, notesBucketContext(board, bucket)])),
  ]));
}

export function findNotesBucketContext(
  contexts: NotesBucketContexts,
  boardId: string | null | undefined,
  bucketId: string | null | undefined,
) {
  return boardId && bucketId ? contexts.get(boardId)?.get(bucketId) : undefined;
}

export function noteBucketContext(contexts: NotesBucketContexts, note: { home: NoteHome; wiki?: object }) {
  return !note.wiki && note.home.kind === "board"
    ? findNotesBucketContext(contexts, note.home.boardId, note.home.bucketId)
    : undefined;
}

export function notesBucketStyle(context: NotesBucketContext | undefined): CSSProperties | undefined {
  return context ? { "--notes-context-color": context.color } as CSSProperties : undefined;
}
