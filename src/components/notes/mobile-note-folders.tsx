"use client";

import { Archive, ArrowLeft, ChevronRight, FileText, Folder, FolderPlus, Inbox, LayoutGrid, Pin, Tag, Trash2 } from "lucide-react";
import type { Notebook, NoteHomeBoardOption, NoteTagSummary } from "@/lib/notes-model";
import type { NotesFilter } from "./notes-workspace";
import { notesBucketContext, notesBucketStyle } from "@/lib/notes-bucket-context";
import { NoteContextMark } from "./note-context-mark";

export type MobileFolderLocation = "root" | "personal" | "boards";

export function MobileNoteFolderRows({ notebooks, boards, parentNotebookId, boardId, onChoose }: {
  notebooks: Notebook[];
  boards: NoteHomeBoardOption[];
  parentNotebookId?: string | null;
  boardId?: string;
  onChoose: (filter: NotesFilter) => void;
}) {
  if (boardId) {
    const board = boards.find(item => item.boardId === boardId);
    return board?.buckets.map(bucket => {
      const context = notesBucketContext(board, bucket);
      return <button className="notes-mobile-folder-row" type="button" key={bucket.id}
      data-notes-context="bucket" style={notesBucketStyle(context)}
      onClick={() => onChoose({ kind: "board", boardId, bucketId: bucket.id })}>
      <NoteContextMark context={context} /><span>{bucket.title}</span><ChevronRight aria-hidden="true" />
    </button>;
    });
  }
  return notebooks.filter(item => item.parentNotebookId === parentNotebookId).map(notebook => {
    const children = notebooks.filter(item => item.parentNotebookId === notebook.id).length;
    return <button type="button" className="notes-mobile-folder-row" key={notebook.id}
      onClick={() => onChoose({ kind: "notebook", notebookId: notebook.id })}>
      <Folder aria-hidden="true" /><span>{notebook.title}</span>
      <small>{children ? `${children} ${children === 1 ? "folder" : "folders"}` : `${notebook.noteCount} ${notebook.noteCount === 1 ? "note" : "notes"}`}</small>
      <ChevronRight aria-hidden="true" />
    </button>;
  });
}

export function MobileNoteFolders({ location, onLocation, notebooks, boards, tags, onChoose, onBack, onNewNotebook }: {
  location: MobileFolderLocation;
  onLocation: (value: MobileFolderLocation) => void;
  notebooks: Notebook[];
  boards: NoteHomeBoardOption[];
  tags: NoteTagSummary[];
  onChoose: (filter: NotesFilter) => void;
  onBack: () => void;
  onNewNotebook: () => void;
}) {
  const title = location === "root" ? "Folders" : location === "personal" ? "Personal notebooks" : "Board notes";
  const row = (label: string, Icon: typeof Folder, action: () => void) => <button type="button" className="notes-mobile-folder-row" onClick={action}>
    <Icon aria-hidden="true" /><span>{label}</span><ChevronRight aria-hidden="true" />
  </button>;
  return <div className="notes-mobile-folders">
    <header className="notes-mobile-folder-location">
      <button type="button" className="notes-icon-button" aria-label={location === "root" ? "Back to notes" : "Back to folders"}
        onClick={location === "root" ? onBack : () => onLocation("root")}><ArrowLeft aria-hidden="true" /></button>
      <h2>{title}</h2>
      {location === "personal" ? <button type="button" className="notes-icon-button" aria-label="New notebook" onClick={onNewNotebook}><FolderPlus aria-hidden="true" /></button> : null}
    </header>
    {location === "root" ? <>
      {row("All notes", FileText, () => onChoose({ kind: "all" }))}
      {row("Inbox", Inbox, () => onChoose({ kind: "inbox" }))}
      {row("Pinned", Pin, () => onChoose({ kind: "pinned" }))}
      <p className="notes-mobile-section">Folders</p>
      {row("Personal notebooks", Folder, () => onLocation("personal"))}
      {row("Board notes", LayoutGrid, () => onLocation("boards"))}
      {tags.length ? <p className="notes-mobile-section">Tags</p> : null}
      {tags.map(tag => <div key={tag.name}>{row(tag.name, Tag, () => onChoose({ kind: "tag", name: tag.name }))}</div>)}
      <p className="notes-mobile-section">Review</p>
      {row("Archive", Archive, () => onChoose({ kind: "archived" }))}
      {row("Trash", Trash2, () => onChoose({ kind: "trash" }))}
    </> : location === "personal" ? <>
      <MobileNoteFolderRows notebooks={notebooks} boards={boards} parentNotebookId={null} onChoose={onChoose} />
      {!notebooks.length ? <p className="notes-empty">No notebooks yet</p> : null}
    </> : boards.map(board => <button type="button" className="notes-mobile-folder-row" key={board.boardId}
      onClick={() => onChoose({ kind: "board", boardId: board.boardId, bucketId: null })}>
      <LayoutGrid aria-hidden="true" /><span>{board.title}</span><ChevronRight aria-hidden="true" />
    </button>)}
  </div>;
}
