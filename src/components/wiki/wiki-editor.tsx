"use client";

import NoteEditor, { type NoteEditorProps } from "@/components/notes/note-editor";
import { WikiEditorView } from "./wiki-editor-view";

// Keep the editor and its adapter in the same lazy chunk. Home/navigation
// should not eagerly load BlockNote just to render their action menus.
export default function WikiEditor(props: NoteEditorProps) {
  return <NoteEditor {...props} editorView={WikiEditorView} />;
}
