// Stateful HTTP contract fake only. This does not establish database safety.
import { randomUUID } from "node:crypto";
import { NoteConflictError, NotesNotFoundError, WikiRuleError } from "@/lib/notes-errors";
import type { NoteDetail, NoteListFilters } from "@/lib/notes-model";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";
import { buildWikiPageHref, type WikiPageDetail, type WikiSpaceSummary, type WikiVersionDetail } from "@/lib/wiki-model";
import type { WikiApiStore } from "@/lib/wiki-api-handlers";

export const ids = {
  board: "11111111-1111-4111-8111-111111111111",
  space: "22222222-2222-4222-8222-222222222222",
  otherSpace: "33333333-3333-4333-8333-333333333333",
  note: "44444444-4444-4444-8444-444444444444",
  version: "55555555-5555-4555-8555-555555555555",
  attachment: "66666666-6666-4666-8666-666666666666",
  actor: "77777777-7777-4777-8777-777777777777",
  task: "88888888-8888-4888-8888-888888888888",
};
const now = "2026-11-03T12:00:00.000Z";
export type FakeRole = "manager" | "editor" | "viewer" | "outsider";
export function fakeIdentity(role: FakeRole = "manager"): TaskboardUserIdentity {
  return { id: ids.actor, authMode: "authelia", authProvider: "authelia", email: `${role}@example.invalid`, username: role, displayName: role, role: "standard", isDisabled: false };
}
export function fakeSpace(id: string = ids.space): WikiSpaceSummary {
  return { id, boardId: ids.board, boardTitle: "Synthetic team board", slug: id === ids.space ? "guide" : "other", title: "Guide", description: "Synthetic only", homeNoteId: null, archivedAt: null, createdAt: now, updatedAt: now, canEdit: true, canManage: true, pageCount: 1, trashCount: 0 };
}
export function fakePage(id: string = ids.note): WikiPageDetail {
  return {
    id, title: "Welcome", displayTitle: "Welcome", snippet: "Hello", home: { kind: "board", boardId: ids.board, boardTitle: "Synthetic team board", bucketId: null, bucketTitle: null },
    notebookId: null, labels: [], pinned: false, archived: false, deletedAt: null, purgeAfterAt: null,
    ownerUserId: ids.actor, ownerDisplayName: "Creator", updatedByDisplayName: "manager", createdAt: now, updatedAt: now, canEdit: true, linkedTaskCount: 0, attachmentCount: 1,
    wiki: { spaceId: ids.space, spaceSlug: "guide", spaceTitle: "Guide", spaceArchived: false, canonicalHref: buildWikiPageHref("guide", id, "Welcome"), canManage: true, canDeletePermanently: false },
    content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }], contentMarkdown: "Hello", contentVersion: 1, contentFormatVersion: 1,
    linkedTasks: [], attachments: [{ id: ids.attachment, originalName: "guide.txt", mimeType: "text/plain", sizeBytes: 5, createdAt: now }],
  };
}

export class WikiApiStub implements WikiApiStore {
  spaces = new Map([[ids.space as string, fakeSpace()], [ids.otherSpace as string, fakeSpace(ids.otherSpace)]]);
  notes = new Map<string, NoteDetail>([[ids.note, fakePage()]]);
  versions = new Map<string, Array<WikiVersionDetail>>([[ids.note, [{
    id: ids.version, versionNumber: 1, kind: "start", title: "Welcome", authorUserId: ids.actor, authorDisplayName: "manager", startedAt: now, savedAt: now,
    content: fakePage().content, contentMarkdown: "Hello", contentFormatVersion: 1,
    attachments: fakePage().attachments.map(file => ({ ...file, available: true, removed: false })), unavailableAttachmentIds: [],
  }]]]);
  calls: Array<{ name: string; args: unknown[] }> = [];
  record(name: string, ...args: unknown[]) { this.calls.push({ name, args: structuredClone(args) }); }
  read(user: TaskboardUserIdentity) {
    if (user.username === "outsider") throw new NotesNotFoundError("Private title must never escape.");
  }
  space(user: TaskboardUserIdentity, id: string, write = false, manage = false) {
    this.read(user);
    const value = this.spaces.get(id);
    if (!value) throw new NotesNotFoundError();
    if (write && (user.username === "viewer" || manage && user.username !== "manager" || value.archivedAt)) throw new WikiRuleError("wiki_read_only", "Read-only space.", 403);
    return value;
  }
  page(user: TaskboardUserIdentity, id: string, write = false): WikiPageDetail {
    this.read(user);
    const value = this.notes.get(id);
    if (!value?.wiki) throw new NotesNotFoundError();
    this.space(user, value.wiki.spaceId, write);
    return value as WikiPageDetail;
  }
  expected(note: NoteDetail, version: number) {
    if (note.contentVersion !== version) throw new NoteConflictError(note.contentVersion);
  }
  view(user: TaskboardUserIdentity, value: NoteDetail): NoteDetail {
    const note = structuredClone(value);
    if (note.wiki) {
      const space = this.space(user, note.wiki.spaceId);
      note.canEdit = user.username !== "viewer" && !space.archivedAt;
      note.wiki.spaceArchived = !!space.archivedAt;
      note.wiki.canManage = user.username === "manager";
      note.wiki.canDeletePermanently = note.wiki.canManage && !!note.deletedAt && !space.archivedAt;
    }
    return note;
  }
  async listWikiSpaces(user: TaskboardUserIdentity, input: Parameters<WikiApiStore["listWikiSpaces"]>[1]) {
    this.record("listWikiSpaces", input); this.read(user);
    return [...this.spaces.values()].filter(s => input.includeArchived || !s.archivedAt).map(s => ({ ...s, canEdit: user.username !== "viewer" && !s.archivedAt, canManage: user.username === "manager" }));
  }
  async createWikiSpace(user: TaskboardUserIdentity, input: Parameters<WikiApiStore["createWikiSpace"]>[1]) {
    this.record("createWikiSpace", input); this.read(user);
    if (user.username !== "manager") throw new WikiRuleError("wiki_read_only", "Manage access required.", 403);
    if ([...this.spaces.values()].some(s => s.boardId === input.boardId)) throw new WikiRuleError("wiki_space_exists", "Board already has a space.", 409);
    const space = { ...fakeSpace(randomUUID()), ...input, slug: input.slug ?? "new", description: input.description ?? "" };
    this.spaces.set(space.id, space); return structuredClone(space);
  }
  async getWikiSpace(user: TaskboardUserIdentity, input: Parameters<WikiApiStore["getWikiSpace"]>[1]) {
    this.record("getWikiSpace", input); return structuredClone(this.space(user, input.spaceId!));
  }
  async updateWikiSpace(user: TaskboardUserIdentity, id: string, input: Parameters<WikiApiStore["updateWikiSpace"]>[2]) {
    this.record("updateWikiSpace", id, input);
    const space = this.space(user, id);
    if (user.username !== "manager" || space.archivedAt && !(Object.keys(input).length === 1 && input.archived === false)) throw new WikiRuleError("wiki_read_only", "Read-only space.", 403);
    if (input.homeNoteId && this.page(user, input.homeNoteId).wiki.spaceId !== id) throw new WikiRuleError("invalid_wiki_request", "Invalid home page.", 400);
    const { archived, ...settings } = input;
    Object.assign(space, settings, archived === undefined ? {} : { archivedAt: archived ? now : null });
    return structuredClone(space);
  }
  async removeWikiSpace(user: TaskboardUserIdentity, id: string) {
    this.record("removeWikiSpace", id); this.space(user, id, true, true);
    if ([...this.notes.values()].some(n => n.wiki?.spaceId === id)) throw new WikiRuleError("wiki_space_not_empty", "Space contains pages.", 409);
    this.spaces.delete(id);
  }
  async listWikiPages(user: TaskboardUserIdentity, input: Parameters<WikiApiStore["listWikiPages"]>[1]) {
    this.record("listWikiPages", input); this.read(user);
    if (input.spaceId) this.space(user, input.spaceId);
    const all = [...this.notes.values()].filter(n => n.wiki && (!input.spaceId || n.wiki.spaceId === input.spaceId)
      && (input.spaceId || input.includeArchivedSpaces || !this.spaces.get(n.wiki.spaceId)?.archivedAt)
      && (input.status === "trash" ? !!n.deletedAt : !n.deletedAt && n.archived === (input.status === "archived"))
      && (!input.q || n.title.toLowerCase().includes(input.q.toLowerCase())));
    const limit = input.limit ?? 100, offset = input.offset ?? 0;
    return { pages: all.slice(offset, offset + limit).map(n => this.view(user, n) as WikiPageDetail), limit, offset, hasMore: all.length > offset + limit };
  }
  async createWikiPage(user: TaskboardUserIdentity, id: string, input: Parameters<WikiApiStore["createWikiPage"]>[2]) {
    this.record("createWikiPage", id, input); const space = this.space(user, id, true);
    const note = fakePage(randomUUID());
    note.title = input.title ?? ""; note.wiki.spaceId = id; note.wiki.spaceSlug = space.slug;
    note.content = input.content?.blocks ?? []; note.contentMarkdown = input.content?.markdown ?? "";
    this.notes.set(note.id, note); return structuredClone(note);
  }
  async getWikiPage(user: TaskboardUserIdentity, id: string) {
    this.record("getWikiPage", id); return this.view(user, this.page(user, id)) as WikiPageDetail;
  }
  async promoteNoteToWiki(user: TaskboardUserIdentity, id: string, input: Parameters<WikiApiStore["promoteNoteToWiki"]>[2]) {
    this.record("promoteNoteToWiki", id, input); const space = this.space(user, input.spaceId, true);
    const note = this.notes.get(id); if (!note || note.wiki) throw new WikiRuleError("invalid_wiki_request", "Not an ordinary note.", 400);
    this.expected(note, input.expectedVersion);
    if (note.home.kind !== "board" || note.home.boardId !== space.boardId) throw new WikiRuleError("invalid_wiki_request", "Same board required.", 400);
    note.wiki = { ...fakePage().wiki, spaceId: space.id }; note.contentVersion++;
    return structuredClone(note) as WikiPageDetail;
  }
  async moveWikiPage(user: TaskboardUserIdentity, id: string, input: Parameters<WikiApiStore["moveWikiPage"]>[2]) {
    this.record("moveWikiPage", id, input); const note = this.page(user, id, true);
    this.expected(note, input.expectedVersion);
    if (note.wiki.spaceId !== input.sourceSpaceId) throw new WikiRuleError("wiki_home_conflict", "Page moved.", 409);
    const space = this.space(user, input.spaceId, true);
    note.wiki.spaceId = space.id; note.wiki.spaceSlug = space.slug;
    note.wiki.canonicalHref = buildWikiPageHref(space.slug, note.id, note.title);
    return structuredClone(note);
  }
  async copyWikiPageToPersonal(user: TaskboardUserIdentity, id: string, input: Parameters<WikiApiStore["copyWikiPageToPersonal"]>[2]) {
    this.record("copyWikiPageToPersonal", id, input); const source = this.page(user, id);
    this.expected(source, input.expectedVersion);
    if (source.deletedAt) throw new NotesNotFoundError();
    const note: NoteDetail = { ...structuredClone(source), id: randomUUID(), home: { kind: "personal" }, contentVersion: 1, pinned: false, archived: false, deletedAt: null, labels: [], linkedTasks: [], linkedTaskCount: 0, canEdit: true };
    delete note.wiki; this.notes.set(note.id, note); return structuredClone(note);
  }
  async listWikiVersions(user: TaskboardUserIdentity, id: string, input: Parameters<WikiApiStore["listWikiVersions"]>[2]) {
    this.record("listWikiVersions", id, input); this.page(user, id);
    const all = [...this.versions.get(id) ?? []].reverse(); const limit = input.limit ?? 100, offset = input.offset ?? 0;
    return { versions: all.slice(offset, offset + limit).map(v => ({ id: v.id, versionNumber: v.versionNumber, kind: v.kind, title: v.title, authorUserId: v.authorUserId, authorDisplayName: v.authorDisplayName, startedAt: v.startedAt, savedAt: v.savedAt })), limit, offset, hasMore: all.length > offset + limit };
  }
  async getWikiVersion(user: TaskboardUserIdentity, id: string, versionId: string) {
    this.record("getWikiVersion", id, versionId); this.page(user, id);
    const value = this.versions.get(id)?.find(v => v.id === versionId);
    if (!value) throw new NotesNotFoundError("Private version title."); return structuredClone(value);
  }
  async restoreWikiVersion(user: TaskboardUserIdentity, id: string, versionId: string, input: Parameters<WikiApiStore["restoreWikiVersion"]>[3]) {
    this.record("restoreWikiVersion", id, versionId, input); const note = this.page(user, id, true);
    this.expected(note, input.expectedVersion); const snapshot = await this.getWikiVersion(user, id, versionId);
    note.title = snapshot.title; note.content = snapshot.content; note.contentMarkdown = snapshot.contentMarkdown; note.contentVersion++;
    this.versions.get(id)!.push({ ...snapshot, id: randomUUID(), versionNumber: this.versions.get(id)!.length + 1, kind: "restore" });
    return structuredClone(note);
  }
  async listNotes(user: TaskboardUserIdentity, input: NoteListFilters) {
    this.record("listNotes", input);
    if (input.wikiSpaceId) {
      const space = this.space(user, input.wikiSpaceId);
      if (input.boardId && input.boardId !== space.boardId) throw new WikiRuleError("invalid_wiki_request", "Mismatched board filter.", 400);
    }
    this.read(user); return [...this.notes.values()].filter(n => !input.wikiSpaceId || n.wiki?.spaceId === input.wikiSpaceId).map(n => this.view(user, n));
  }
  async createNote(user: TaskboardUserIdentity, input: Record<string, unknown>) {
    this.record("createNote", input); this.read(user); const note: NoteDetail = { ...fakePage(randomUUID()), title: String(input.title ?? ""), home: { kind: "personal" } }; delete note.wiki; this.notes.set(note.id, note); return structuredClone(note);
  }
  async getNote(user: TaskboardUserIdentity, id: string) {
    this.read(user); const note = this.notes.get(id); if (!note) throw new NotesNotFoundError(); return this.view(user, note);
  }
  async updateNote(user: TaskboardUserIdentity, id: string, input: Record<string, unknown>) {
    this.record("updateNote", id, input); const note = this.page(user, id, true);
    if (Object.hasOwn(input, "home") || Object.hasOwn(input, "notebookId")) throw new WikiRuleError("wiki_home_change_forbidden", "Wiki home cannot be changed through Notes.", 409);
    if (input.title !== undefined || input.content !== undefined) { this.expected(note, Number(input.expectedVersion)); note.contentVersion++; }
    if (input.title !== undefined) note.title = String(input.title); return this.view(user, note);
  }
  async trashNote(user: TaskboardUserIdentity, id: string) { this.record("trashNote", id); this.page(user, id, true).deletedAt = now; }
  async restoreNote(user: TaskboardUserIdentity, id: string) { this.record("restoreNote", id); const note = this.page(user, id, true); note.deletedAt = null; return this.view(user, note); }
  async deleteNotePermanently(user: TaskboardUserIdentity, id: string) { this.record("deleteNotePermanently", id); const note = this.page(user, id, true); if (user.username !== "manager") throw new WikiRuleError("wiki_read_only", "Manage required.", 403); if (!note.deletedAt) throw new WikiRuleError("invalid_wiki_request", "Trash first.", 400); this.notes.delete(id); }
  async deleteNoteAttachment(user: TaskboardUserIdentity, id: string, attachmentId: string, input: { permanent?: boolean } = {}) {
    this.record("deleteNoteAttachment", id, attachmentId, input); const note = this.page(user, id, true);
    if (input.permanent && user.username !== "manager") throw new WikiRuleError("wiki_read_only", "Manage required.", 403);
    note.attachments = note.attachments.filter(f => f.id !== attachmentId); note.attachmentCount = note.attachments.length;
  }
  async getNoteAttachmentDownload(user: TaskboardUserIdentity, id: string, attachmentId: string) {
    this.record("getNoteAttachmentDownload", id, attachmentId); this.page(user, id);
    if (attachmentId !== ids.attachment) throw new NotesNotFoundError();
    return { content: new TextEncoder().encode("Hello"), mimeType: "text/plain", displayName: "guide.txt", sizeBytes: 5 };
  }
  async uploadNoteAttachments(user: TaskboardUserIdentity, id: string) { this.record("uploadNoteAttachments", id); return this.page(user, id, true).attachments; }
  async linkNoteToTask(user: TaskboardUserIdentity, id: string) { this.record("linkNoteToTask", id); return this.page(user, id, true); }
  async unlinkNoteFromTask(user: TaskboardUserIdentity, id: string) { this.record("unlinkNoteFromTask", id); return this.page(user, id, true); }
  async convertNoteToTask(user: TaskboardUserIdentity, id: string) { this.record("convertNoteToTask", id); this.page(user, id, true); return { taskId: ids.task, boardId: ids.board, note: await this.getNote(user, id) }; }
}
export const sandboxStore = new WikiApiStub();
