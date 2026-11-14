import type { NoteDetail } from "../../../src/lib/notes-model";
import type { WikiPageDetail, WikiSpaceSummary, WikiVersionDetail } from "../../../src/lib/wiki-model";
import { buildWikiPageHref } from "../../../src/lib/wiki-model";

export const ids = { space: "10000000-0000-4000-8000-000000000001", other: "10000000-0000-4000-8000-000000000002", board: "20000000-0000-4000-8000-000000000001", note: "30000000-0000-4000-8000-000000000001", version: "40000000-0000-4000-8000-000000000001", file: "50000000-0000-4000-8000-000000000001", missing: "50000000-0000-4000-8000-000000000002" };
const date = "2026-11-03T12:00:00.000Z";
export type Scenario = "manager" | "editor" | "viewer" | "archived" | "trash" | "moved" | "missing" | "ordinary";
export function fixtureSpace(scenario: Scenario = "manager"): WikiSpaceSummary {
  return { id: ids.space, boardId: ids.board, boardTitle: "Example team", slug: "handbook", title: "Team handbook", description: "Shared procedures and decisions", homeNoteId: null, archivedAt: scenario === "archived" ? date : null, createdAt: date, updatedAt: date, canEdit: scenario !== "viewer" && scenario !== "archived", canManage: scenario === "manager" || scenario === "trash" || scenario === "archived", pageCount: 1, trashCount: scenario === "trash" ? 1 : 0 };
}
export function fixtureNote(scenario: Scenario = "manager"): WikiPageDetail {
  const space = fixtureSpace(scenario);
  const slug = scenario === "moved" ? "operations" : space.slug;
  return { id: ids.note, title: "Welcome to the handbook", displayTitle: "Welcome to the handbook", snippet: "A shared place for team knowledge.", home: { kind: "board", boardId: ids.board, boardTitle: space.boardTitle, bucketId: null, bucketTitle: null }, notebookId: null, labels: ["Guide"], pinned: false, archived: false, deletedAt: scenario === "trash" ? date : null, purgeAfterAt: scenario === "trash" ? "2026-12-03T12:00:00.000Z" : null, ownerUserId: "60000000-0000-4000-8000-000000000001", ownerDisplayName: "Example writer", updatedByDisplayName: "Example writer", createdAt: date, updatedAt: date, canEdit: space.canEdit, linkedTaskCount: 0, attachmentCount: 1, content: [
    { id: "intro", type: "paragraph", content: [{ type: "text", text: "A shared place for team knowledge.", styles: {} }], children: [] },
    { id: "table", type: "table", content: { type: "tableContent", rows: [{ cells: [[{ type: "text", text: "Procedure", styles: {} }], [{ type: "text", text: "Owner", styles: {} }]] }, { cells: [[{ type: "text", text: "Review handbook", styles: {} }], [{ type: "text", text: "Example team", styles: {} }]] }] }, children: [] },
  ], contentMarkdown: "A shared place for team knowledge.", contentVersion: 1, contentFormatVersion: 1, linkedTasks: [], attachments: [{ id: ids.file, originalName: "guide.txt", sizeBytes: 32, mimeType: "text/plain", createdAt: date }], wiki: { spaceId: space.id, spaceSlug: slug, spaceTitle: space.title, spaceArchived: Boolean(space.archivedAt), canonicalHref: buildWikiPageHref(slug, ids.note, "Welcome to the handbook"), canManage: space.canManage, canDeletePermanently: scenario === "trash" } };
}
export function fixtureVersion(): WikiVersionDetail {
  return { id: ids.version, versionNumber: 1, kind: "start", title: "Original welcome", authorUserId: null, authorDisplayName: null, startedAt: date, savedAt: date, content: [{ type: "paragraph", content: [{ type: "text", text: "Original document body", styles: {} }] }, { type: "file", props: { url: `/api/notes/${ids.note}/attachments/${ids.missing}`, name: "lost.txt" } }], contentMarkdown: "Original document body", contentFormatVersion: 1, attachments: [{ id: ids.file, originalName: "guide.txt", sizeBytes: 32, mimeType: "text/plain", createdAt: date, available: true, removed: true }], unavailableAttachmentIds: [ids.missing] };
}
// This fake validates the browser boundary only. It cannot establish DB safety.
export function createWikiFixture(scenario: Scenario = "manager") {
  let note = fixtureNote(scenario);
  let revoked = false, conflict = false, failSave = false, ordinary = scenario === "ordinary";
  let token = 1;
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const versions = [fixtureVersion()];
  let spaces = [fixtureSpace(scenario), { ...fixtureSpace(scenario), id: ids.other, slug: "operations", title: "Operations", boardTitle: "Operations team", boardId: "20000000-0000-4000-8000-000000000002", pageCount: 0 }];
  const fields = (body: unknown, allowed: string[]) => {
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw new Error(`Unexpected fixture request fields: ${Object.keys(body ?? {}).join(",")}`);
  };
  return {
    requests, get note() { return note; }, setConflict(value = true) { conflict = value; }, setFailSave(value = true) { failSave = value; },
    revoke(value = true) { revoked = value; token++; }, archive(value = true) { note = { ...note, canEdit: !value && scenario !== "viewer", wiki: { ...note.wiki, spaceArchived: value } }; token++; },
    externalEdit(title: string) { note = { ...note, title, displayTitle: title, contentVersion: note.contentVersion + 1, wiki: { ...note.wiki, canonicalHref: buildWikiPageHref(note.wiki.spaceSlug, note.id, title) } }; token++; },
    async handle(method: string, url: URL, body?: unknown) {
      const path = url.pathname;
      const allowedQuery = path === "/api/live" ? ["notes", "boards", "boardId"] : path === "/api/wiki/spaces" ? ["includeArchived"] : path === "/api/wiki/pages" ? ["spaceId", "q", "status", "limit", "offset", "includeArchivedSpaces"] : path === "/api/notes" ? ["scope", "status", "boardId", "bucketId", "notebookId", "label", "q", "pinned", "limit", "wikiSpaceId"] : path.endsWith("/versions") ? ["limit", "offset"] : ["permanent", "disposition"];
      if ([...url.searchParams.keys()].some(key => !allowedQuery.includes(key))) throw new Error(`Unexpected fixture query field on ${path}`);
      requests.push({ method, path, body });
      const ok = (payload = {}, status = 200) => ({ status, body: { ok: true, ...payload } });
      const error = (status: number, code: string, message: string) => ({ status, body: { error: message, code, ...(code === "note_conflict" ? { currentVersion: note.contentVersion + 1 } : {}) } });
      if (path === "/api/live" && method === "GET") return ok({ notes: { token: String(token) }, boards: { token: String(token), boards: [], personalBoardId: null } });
      if (revoked) return error(404, "wiki_not_found", "Page unavailable.");
      if (path === "/api/notes" && method === "GET") return ok({ notes: [ordinary ? { ...note, wiki: undefined } : note] });
      if (path === "/api/notes/homes" && method === "GET") return ok({ homeOptions: [{ boardId: ids.board, title: "Example team", canEdit: true, isPersonalBoard: false, buckets: [] }] });
      if (path === "/api/notes/notebooks" && method === "GET") return ok({ notebooks: [], inboxCount: 0 });
      if (path === "/api/notes/tags" && method === "GET") return ok({ tags: [] });
      if (path === `/api/boards/${ids.board}/labels` && method === "GET") return ok({ labels: [] });
      if (path === `/api/notes/${note.id}` && method === "GET") return ok({ note: ordinary ? { ...note, wiki: undefined } : note });
      if (path === "/api/wiki/spaces" && method === "GET") return ok({ spaces });
      if (path === "/api/wiki/spaces" && method === "POST") { fields(body, ["boardId", "title", "description", "slug"]); const input = body as { title: string; boardId: string; description: string }; const space = { ...spaces[0], ...input, id: ids.other, slug: "new-space" }; spaces = [...spaces, space]; return ok({ space }, 201); }
      if (path === "/api/wiki/pages" && method === "GET") return ok({ pages: [note], limit: 100, offset: 0, hasMore: false });
      if (path === `/api/wiki/pages/${note.id}` && method === "GET") return ok({ note });
      if (path.endsWith("/versions") && method === "GET") return ok({ versions: versions.map(version => ({ id: version.id, versionNumber: version.versionNumber, kind: version.kind, title: version.title, authorUserId: version.authorUserId, authorDisplayName: version.authorDisplayName, startedAt: version.startedAt, savedAt: version.savedAt })), limit: 50, offset: 0, hasMore: false });
      if (path.endsWith(`/versions/${ids.version}`) && method === "GET") return ok({ version: versions[0] });
      if (path.includes("/attachments/") && method === "GET") return { status: 200, body: "Synthetic file bytes" };
      if (method !== "GET" && (!note.canEdit || note.wiki.spaceArchived) && !path.endsWith("/copy")) return error(403, "wiki_read_only", "Space is read only.");
      if (path === `/api/notes/${note.id}` && method === "PATCH") {
        fields(body, ["title", "content", "expectedVersion"]);
        const input = body as { title?: string; content?: { blocks: unknown[]; markdown: string }; expectedVersion: number };
        if (failSave) return error(503, "wiki_temporarily_unavailable", "Save unavailable.");
        if (conflict || input.expectedVersion !== note.contentVersion) return error(409, "note_conflict", "Changed elsewhere.");
        note = { ...note, ...(input.title === undefined ? {} : { title: input.title, displayTitle: input.title || "Untitled note" }), ...(input.content ? { content: input.content.blocks, contentMarkdown: input.content.markdown } : {}), contentVersion: note.contentVersion + 1 };
        note.wiki = { ...note.wiki, canonicalHref: buildWikiPageHref(note.wiki.spaceSlug, note.id, note.displayTitle) }; token++; return ok({ note });
      }
      if (path.endsWith("/restore") && path.includes("/versions/") && method === "POST") { fields(body, ["expectedVersion"]); if ((body as { expectedVersion: number }).expectedVersion !== note.contentVersion || conflict) return error(409, "note_conflict", "Changed elsewhere."); const version = versions[0]; note = { ...note, title: version.title, displayTitle: version.title, content: version.content, contentMarkdown: version.contentMarkdown, contentVersion: note.contentVersion + 1 }; token++; return ok({ note }); }
      if (path.endsWith("/add") && method === "POST") { fields(body, ["spaceId", "expectedVersion"]); if ((body as { expectedVersion: number }).expectedVersion !== note.contentVersion) return error(409, "note_conflict", "Changed elsewhere."); ordinary = false; note = { ...note, contentVersion: note.contentVersion + 1 }; return ok({ note }); }
      if (path.endsWith("/copy") && method === "POST") { fields(body, ["expectedVersion"]); if ((body as { expectedVersion: number }).expectedVersion !== note.contentVersion) return error(409, "note_conflict", "Changed elsewhere."); const copy = { ...note, id: "30000000-0000-4000-8000-000000000002", home: { kind: "personal" }, wiki: undefined } as NoteDetail; return ok({ note: copy }, 201); }
      if (path.endsWith("/move") && method === "POST") { fields(body, ["spaceId", "sourceSpaceId", "expectedVersion"]); const input = body as { spaceId: string; sourceSpaceId: string; expectedVersion: number }; if (input.sourceSpaceId !== note.wiki.spaceId || input.expectedVersion !== note.contentVersion) return error(409, "wiki_home_conflict", "Page moved."); const space = spaces.find(space => space.id === input.spaceId)!; note = { ...note, wiki: { ...note.wiki, spaceId: space.id, spaceSlug: space.slug, spaceTitle: space.title, canonicalHref: buildWikiPageHref(space.slug, note.id, note.displayTitle) } }; return ok({ note }); }
      if (path === `/api/notes/${note.id}` && method === "DELETE") { if (url.searchParams.get("permanent") === "1" && !note.wiki.canDeletePermanently) return error(403, "wiki_read_only", "Manager required."); note = { ...note, deletedAt: date }; return ok(); }
      if (path === `/api/notes/${note.id}/restore` && method === "POST") { note = { ...note, deletedAt: null, wiki: { ...note.wiki, canDeletePermanently: false } }; return ok({ note }); }
      if (path.includes("/attachments/") && method === "DELETE") { if (url.searchParams.get("permanent") && !note.wiki.canManage) return error(403, "wiki_read_only", "Manager required."); note = { ...note, attachments: note.attachments.filter(file => !path.endsWith(file.id)) }; return ok(); }
      if (path.endsWith("/attachments") && method === "POST") { const attachment = { ...note.attachments[0], id: "50000000-0000-4000-8000-000000000003", originalName: "upload.txt" }; note = { ...note, attachments: [...note.attachments, attachment] }; token++; return ok({ attachments: note.attachments }); }
      if (/^\/api\/wiki\/spaces\/[^/]+\/pages$/.test(path) && method === "POST") { fields(body, ["title", "content"]); return ok({ note }, 201); }
      if (/^\/api\/wiki\/spaces\/[^/]+$/.test(path) && method === "PATCH") { fields(body, ["title", "description", "archived", "homeNoteId"]); return ok({ space: { ...spaces[0], ...(body as object) } }); }
      throw new Error(`Unexpected fixture endpoint: ${method} ${path}`);
    },
  };
}
