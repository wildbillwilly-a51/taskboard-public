// Pure, lossless version/mention boundary. Default schema inventory comes from the editor.
import { isUuid } from "@/lib/notes-model";
import { WikiRuleError } from "@/lib/notes-errors";
export const ordinaryNoteContentFormatVersion = 1;
export const currentWikiContentFormatVersion = 2;
export const supportedNoteContentFormatVersions = [1, 2] as const;
export type NoteSchemaInventory = { blockTypes: readonly string[]; inlineContentTypes: readonly string[]; styleTypes?: readonly string[] };
export type PageMention = { type: "pageMention"; props: { noteId: string } };
function unsupported(): never { throw new WikiRuleError("wiki_format_unsupported", "This document format is not supported. Its content has been preserved.", 409); }
export function isCanonicalPageMention(value: unknown): value is PageMention {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const node = value as Record<string, unknown>;
  if (node.type !== "pageMention" || Object.keys(node).sort().join() !== "props,type" || !node.props || typeof node.props !== "object" || Array.isArray(node.props)) return false;
  const props = node.props as Record<string, unknown>;
  return Object.keys(props).join() === "noteId" && isUuid(props.noteId) && props.noteId === props.noteId.toLowerCase();
}
export function pageMentionHref(noteId: string) {
  if (!isUuid(noteId)) unsupported();
  return `/wiki/_/${noteId.toLowerCase()}`;
}
// Traverse arbitrary defaults without changing or maintaining a duplicate schema.
// Mentions are legal only in inline arrays (including table cells), never props,
// block children, link labels or arbitrary nested metadata.
export function assertNoteContentFormat(blocks: unknown, formatVersion: number, inventory?: NoteSchemaInventory): asserts blocks is unknown[] {
  if (!supportedNoteContentFormatVersions.some((v) => v === formatVersion) || !Array.isArray(blocks)) unsupported();
  let budget = 100000;
  type Role = "block" | "inline" | "linkText" | "table" | "row" | "cell" | "other";
  const walk = (value: unknown, role: Role, depth: number): void => {
    if (--budget < 0 || depth > 100) unsupported();
    if (Array.isArray(value)) { value.forEach((v) => walk(v, role, depth + 1)); return; }
    if (!value || typeof value !== "object") return;
    const node = value as Record<string, unknown>;
    if (node.type === "pageMention") {
      if (formatVersion !== 2 || role !== "inline" || !isCanonicalPageMention(node)) unsupported();
      return;
    }
    if (inventory && (role === "block" || role === "inline" || role === "linkText")) {
      const types = role === "block" ? inventory.blockTypes : inventory.inlineContentTypes;
      if (typeof node.type !== "string" || !types.includes(node.type)) unsupported();
      if (role === "linkText" && node.type !== "text") unsupported();
      if (inventory.styleTypes && node.styles && typeof node.styles === "object" && Object.keys(node.styles).some((s) => !inventory.styleTypes!.includes(s))) unsupported();
    }
    for (const [key, child] of Object.entries(node)) {
      let next: Role = "other";
      if (role === "block" && key === "children") next = "block";
      if (role === "inline" && node.type === "link" && key === "content") next = "linkText";
      if ((role === "block" || (role === "cell" && node.type === "tableCell")) && key === "content") next = Array.isArray(child) ? "inline" : "table";
      if (role === "table" && node.type === "tableContent" && key === "rows") next = "row";
      // Table cell arrays are inline content; object cells carry their own content.
      if (role === "row" && key === "cells" && Array.isArray(child)) {
        child.forEach((cell) => walk(cell, Array.isArray(cell) ? "inline" : "cell", depth + 1));
      } else walk(child, next, depth + 1);
    }
  };
  walk(blocks, "block", 0);
}
export function extractPageMentionIds(blocks: unknown): string[] {
  const ids = new Set<string>();
  const walk = (v: unknown): void => {
    if (isCanonicalPageMention(v)) { ids.add(v.props.noteId); return; }
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(blocks); return [...ids].sort();
}
export function projectPageMentionsToLinks(blocks: unknown[]): unknown[] {
  const walk = (v: unknown): unknown => {
    if (isCanonicalPageMention(v)) return { type: "link", href: pageMentionHref(v.props.noteId), content: [{ type: "text", text: "Wiki page", styles: {} }] };
    if (v && typeof v === "object" && (v as { type?: unknown }).type === "pageMention") unsupported();
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, child]) => [k, walk(child)]));
    return v;
  };
  return walk(blocks) as unknown[];
}
