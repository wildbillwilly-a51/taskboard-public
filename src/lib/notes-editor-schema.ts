"use client";

import { BlockNoteSchema, defaultBlockSpecs, defaultInlineContentSpecs, defaultStyleSpecs } from "@blocknote/core";
import { pageMentionSpec } from "@/components/notes/page-mention-spec";
import { assertNoteContentFormat, pageMentionHref, projectPageMentionsToLinks } from "@/lib/notes-content-format";
import { getBlocksPlainText, isUuid, type NoteContentInput } from "@/lib/notes-model";

export const notesEditorSchema = BlockNoteSchema.create({
  blockSpecs: defaultBlockSpecs,
  inlineContentSpecs: { ...defaultInlineContentSpecs, pageMention: pageMentionSpec },
  styleSpecs: defaultStyleSpecs,
});
export const notesEditorInventory = {
  blockTypes: Object.keys(notesEditorSchema.blockSchema),
  inlineContentTypes: Object.keys(notesEditorSchema.inlineContentSchema),
  styleTypes: Object.keys(notesEditorSchema.styleSchema),
};
// BlockNote 0.56 emits an own `content: undefined` on content:none atoms.
// Remove that runtime-only key in a copy before enforcing the exact wire shape.
// Other mention fields (including defined content) must still be rejected.
function persistedBlocks(blocks: unknown): unknown {
  if (Array.isArray(blocks)) return blocks.map(persistedBlocks);
  if (blocks && typeof blocks === "object") {
    const node = blocks as Record<string, unknown>;
    return Object.fromEntries(Object.entries(node).filter(([key, value]) => !(node.type === "pageMention" && key === "content" && value === undefined)).map(([key, value]) => [key, persistedBlocks(value)]));
  }
  return blocks;
}
function assertEditorContent(blocks: unknown, formatVersion: number): asserts blocks is unknown[] {
  assertNoteContentFormat(blocks, formatVersion, notesEditorInventory);
  // The checkpoint server guard deliberately does not maintain BlockNote's default
  // schema. Check inline content inside ordinary links against that real schema
  // too, before the parser could silently discard an unknown nested inline type.
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (node.type === "link" && Array.isArray(node.content)) {
      assertNoteContentFormat([{ type: "paragraph", content: node.content }], formatVersion, notesEditorInventory);
    }
    Object.values(node).forEach(visit);
  };
  visit(blocks);
}
export function canRenderNoteContent(blocks: unknown, formatVersion = 1): boolean {
  try { assertEditorContent(persistedBlocks(blocks), formatVersion); return true; }
  catch { return false; }
}
export function serializeNoteContent(blocks: unknown[], formatVersion: number, toMarkdown: (blocks: unknown[]) => string): NoteContentInput {
  const content = persistedBlocks(blocks);
  assertEditorContent(content, formatVersion);
  return { blocks: content, formatVersion, markdown: toMarkdown(projectPageMentionsToLinks(content)), text: getBlocksPlainText(content) };
}

// Normalize both BlockNote's private clipboard flavor and external HTML before
// parsing. Only a validated ID survives; clipboard labels are never trusted.
export function normalizePageMentionClipboard(html: string, wiki: boolean): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  for (const element of doc.querySelectorAll('[data-inline-content-type="pageMention"]')) {
    const id = element.getAttribute("data-note-id");
    if (!isUuid(id)) { element.replaceWith(doc.createTextNode("Wiki page")); continue; }
    if (wiki) {
      const atom = doc.createElement("span");
      atom.setAttribute("data-inline-content-type", "pageMention");
      atom.setAttribute("data-note-id", id.toLowerCase());
      atom.textContent = "Wiki page";
      element.replaceWith(atom);
    } else {
      const link = doc.createElement("a");
      link.href = pageMentionHref(id); link.textContent = "Wiki page";
      element.replaceWith(link);
    }
  }
  return doc.body.innerHTML;
}
