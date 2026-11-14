// Pure contracts shared by stores, HTTP adapters and the editor.
import type { NoteAttachment, NoteContentInput, NoteDetail, NoteSummary } from "@/lib/notes-model";
import { isUuid } from "@/lib/notes-model";
import { WikiRuleError } from "@/lib/notes-errors";
import { extractPageMentionIds } from "@/lib/notes-content-format";

export type WikiMetadata = {
  spaceId: string; spaceSlug: string; spaceTitle: string; spaceArchived: boolean;
  canonicalHref: string; canManage: boolean; canDeletePermanently: boolean;
};
export type WikiSpaceSummary = {
  id: string; boardId: string; boardTitle: string; slug: string; title: string;
  description: string; homeNoteId: string | null; archivedAt: string | null;
  createdAt: string; updatedAt: string; canEdit: boolean; canManage: boolean;
  pageCount: number; trashCount: number;
};
export type WikiPageSummary = NoteSummary & { wiki: WikiMetadata };
export type WikiPageDetail = NoteDetail & { wiki: WikiMetadata; contentFormatVersion: number };
export type WikiVersionKind = "start" | "edit" | "restore" | "import";
export type WikiVersionSummary = {
  id: string; versionNumber: number; kind: WikiVersionKind; title: string;
  authorUserId: string | null; authorDisplayName: string | null; startedAt: string; savedAt: string;
};
export type WikiVersionDetail = WikiVersionSummary & {
  content: unknown[]; contentMarkdown: string; contentFormatVersion: number;
  attachments: Array<NoteAttachment & { available: boolean; removed: boolean }>;
  unavailableAttachmentIds: string[];
};
export type WikiPageListInput = {
  topicId?: string; includeDescendants?: boolean;
  spaceId?: string; q?: string; status?: "active" | "archived" | "trash";
  limit?: number; offset?: number; includeArchivedSpaces?: boolean;
};
export type WikiPageList = { pages: WikiPageSummary[]; limit: number; offset: number; hasMore: boolean };
export type WikiVersionList = { versions: WikiVersionSummary[]; limit: number; offset: number; hasMore: boolean };
export type CreateWikiSpaceInput = { boardId: string; title: string; description?: string; slug?: string };
export type UpdateWikiSpaceInput = { title?: string; description?: string; archived?: boolean; homeNoteId?: string | null };
export type CreateWikiPageInput = { title?: string; content?: NoteContentInput };

export const wikiContentFormatVersion = 2;
export const maxWikiSpaceTitleLength = 120;
export const maxWikiSpaceDescriptionLength = 2000;
export const maxWikiSlugLength = 80;

export function normalizeWikiSlug(value: string, fallback = "space"): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase()
    .replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, maxWikiSlugLength).replace(/-$/g, "") || fallback;
}
export function normalizeWikiSpaceTitle(value: unknown): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maxWikiSpaceTitleLength)
    throw new WikiRuleError("invalid_wiki_request", "Space title must be 1–120 characters.", 400);
  return value.trim();
}
export function normalizeWikiDescription(value: unknown): string {
  if (value === undefined) return "";
  if (typeof value !== "string" || value.length > maxWikiSpaceDescriptionLength)
    throw new WikiRuleError("invalid_wiki_request", "Description must be at most 2,000 characters.", 400);
  return value;
}
export function parseWikiPageId(segment: string): string | null {
  const id = segment.slice(0, 36);
  return isUuid(id) && (segment.length === 36 || segment[36] === "-") ? id.toLowerCase() : null;
}
export function buildWikiPageHref(spaceSlug: string, noteId: string, displayTitle: string): string {
  return `/wiki/${encodeURIComponent(spaceSlug)}/${noteId}-${normalizeWikiSlug(displayTitle, "page")}`;
}
export function canCoalesceWikiVersion(latest: Pick<WikiVersionSummary, "kind" | "authorUserId" | "startedAt" | "savedAt"> | null,
  incoming: { kind: WikiVersionKind; authorUserId: string|null; savedAt: string; fileCheckpoint?: boolean }): boolean {
  if (!latest || incoming.fileCheckpoint || latest.kind !== "edit" || incoming.kind !== "edit" || latest.authorUserId !== incoming.authorUserId) return false;
  const gap = Date.parse(incoming.savedAt) - Date.parse(latest.savedAt);
  const elapsed = Date.parse(incoming.savedAt) - Date.parse(latest.startedAt);
  return gap >= 0 && gap < 600_000 && elapsed >= 0 && elapsed < 3_600_000;
}
export function resolveWikiCapabilities(access: { canRead: boolean; canEdit: boolean; canManage: boolean }, archived: boolean, trashed = false) {
  return { canRead: access.canRead, canEdit: access.canEdit && !archived,
    canManage: access.canManage, canDeletePermanently: access.canManage && !archived && trashed };
}
// URL inventory walks all nested block/table/inline shapes, but only URL fields.
export function extractWikiLinkTargets(blocks: unknown, trustedOrigin: string): string[] {
  const ids = new Set<string>(extractPageMentionIds(blocks));
  const origin = new URL(trustedOrigin).origin;
  const visit = (value: unknown, key?: string) => {
    if (typeof value === "string" && (key === "href" || key === "url")) {
      if (!value.startsWith("/") && !/^https?:\/\//i.test(value)) return;
      try {
        const url = new URL(value, origin);
        if (url.origin !== origin) return;
        const segments = url.pathname.split("/");
          const id = segments.length === 4 && segments[1] === "wiki" ? parseWikiPageId(decodeURIComponent(segments[3]))
            : ["/notes","/folio"].includes(url.pathname) ? url.searchParams.get("note") : null;
        if (isUuid(id)) ids.add(id.toLowerCase());
      } catch { /* Malformed links are not index candidates. */ }
    } else if (Array.isArray(value)) value.forEach((entry) => visit(entry));
    else if (value && typeof value === "object") Object.entries(value).forEach(([k, v]) => visit(v, k));
  };
  visit(blocks);
  return [...ids].sort();
}
