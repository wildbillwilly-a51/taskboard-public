"use client";
import { BlockNoteEditor } from "@blocknote/core";
import { useState } from "react";
import { notesEditorSchema, notesEditorInventory, canRenderNoteContent, serializeNoteContent } from "@/lib/notes-editor-schema";
import { defaults, mentionDocument } from "./documents";

export default function Probe() {
  const [result, setResult] = useState<unknown>();
  return <section><button onClick={() => {
    const editor = BlockNoteEditor.create({ schema: notesEditorSchema, initialContent: [...defaults, ...mentionDocument] as never });
    const blocks = editor.document;
    const content = serializeNoteContent(blocks, 2, projected => editor.blocksToMarkdownLossy(projected as never));
    setResult({ inventory: notesEditorInventory, supported: canRenderNoteContent(blocks, 2), content, html: editor.blocksToHTMLLossy(blocks), internal: editor.blocksToFullHTML(blocks) });
  }}>Schema round trip</button><pre data-testid="probe" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(result ?? null)}</pre></section>;
}
