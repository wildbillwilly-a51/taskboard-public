"use client";
import dynamic from "next/dynamic";
import { isWikiDocumentSupported, useWikiFormatInventory } from "./wiki-format";
import type { WikiEditorContext } from "@/lib/notes-editor-contract";
const PublicNoteBody = dynamic(() => import("@/components/public-note-body"), { ssr: false, loading: () => <p role="status">Loading document…</p> });
export function maskUnavailableFiles(content: unknown[], unavailableIds: string[]): unknown[] {
  const unavailable = (url: unknown) => typeof url === "string" && unavailableIds.some(id => url.includes(`/attachments/${id}`));
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== "object") return value;
    const node = value as Record<string, unknown>;
    if (unavailable((node.props as Record<string, unknown> | undefined)?.url)) return { type: "paragraph", content: [{ type: "text", text: "File unavailable", styles: {} }] };
    if (unavailable(node.href)) return { type: "text", text: "File unavailable", styles: {} };
    return Object.fromEntries(Object.entries(node).map(([key, child]) => [key, walk(child)]));
  };
  return walk(content) as unknown[];
}
export function WikiReader({ content, format = 1, unavailableIds = [], wikiContext }: { content: unknown[]; format?: number; unavailableIds?: string[]; wikiContext?: WikiEditorContext }) {
  const inventory = useWikiFormatInventory();
  if (!inventory) return <p role="status">Loading document schema…</p>;
  if (!isWikiDocumentSupported(content, format, inventory)) return <p role="alert">This content format is not supported. The original document is preserved.</p>;
  return <div className="wiki-document"><PublicNoteBody content={maskUnavailableFiles(content, unavailableIds)} contentFormatVersion={format} wikiContext={wikiContext} /></div>;
}
