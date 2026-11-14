import type { NextRequest } from "next/server";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";
import { isUuid, maxNoteTitleLength, normalizeNoteContent, type NoteDetail } from "@/lib/notes-model";
import {
  normalizeWikiDescription, normalizeWikiSlug, normalizeWikiSpaceTitle, maxWikiSlugLength,
  type CreateWikiPageInput, type CreateWikiSpaceInput, type UpdateWikiSpaceInput,
  type WikiPageDetail, type WikiPageList, type WikiPageListInput,
  type WikiSpaceSummary, type WikiVersionDetail, type WikiVersionList,
} from "@/lib/wiki-model";
import { assertWikiEmptyBody, assertWikiFields, invalidWikiRequest, readWikiBody, wikiJson, wikiRouteErrorResponse, wikiUnavailableResponse } from "@/lib/wiki-route";

type Actor = TaskboardUserIdentity;
type VersionInput = { expectedVersion: number };
type PageTarget = VersionInput & { spaceId: string };
type Pagination = { limit?: number; offset?: number };

// This port describes section 5.6; implementations own all authorization,
// transactions and file effects. No database runtime is imported here.
export interface WikiApiStore {
  listWikiSpaces(user: Actor, input: { includeArchived?: boolean }): Promise<WikiSpaceSummary[]>;
  createWikiSpace(user: Actor, input: CreateWikiSpaceInput): Promise<WikiSpaceSummary>;
  getWikiSpace(user: Actor, input: { spaceId?: string; slug?: string }): Promise<WikiSpaceSummary>;
  updateWikiSpace(user: Actor, id: string, input: UpdateWikiSpaceInput): Promise<WikiSpaceSummary>;
  removeWikiSpace(user: Actor, id: string): Promise<void>;
  listWikiPages(user: Actor, input: WikiPageListInput): Promise<WikiPageList>;
  createWikiPage(user: Actor, id: string, input: CreateWikiPageInput): Promise<WikiPageDetail>;
  getWikiPage(user: Actor, id: string): Promise<WikiPageDetail>;
  promoteNoteToWiki(user: Actor, id: string, input: PageTarget): Promise<WikiPageDetail>;
  moveWikiPage(user: Actor, id: string, input: PageTarget & { sourceSpaceId: string }): Promise<WikiPageDetail>;
  copyWikiPageToPersonal(user: Actor, id: string, input: VersionInput): Promise<NoteDetail>;
  listWikiVersions(user: Actor, id: string, input: Pagination): Promise<WikiVersionList>;
  getWikiVersion(user: Actor, id: string, versionId: string): Promise<WikiVersionDetail>;
  restoreWikiVersion(user: Actor, id: string, versionId: string, input: VersionInput): Promise<WikiPageDetail>;
}

export type WikiRouteContext = { params: Promise<{ spaceId?: string; noteId?: string; versionId?: string }> };
export type WikiApiPorts = {
  store: WikiApiStore;
  requireUser(request: NextRequest): Promise<Actor>;
  isDatabaseConfigured(): boolean;
};

function uuid(value: unknown, field: string): string {
  if (!isUuid(value)) invalidWikiRequest(`${field} must be a valid UUID.`);
  return value;
}

function version(body: Record<string, unknown>): VersionInput {
  const expectedVersion = body.expectedVersion;
  if (typeof expectedVersion !== "number" || !Number.isSafeInteger(expectedVersion) || expectedVersion < 1) {
    invalidWikiRequest("expectedVersion must be a positive integer.");
  }
  return { expectedVersion };
}

function query(request: Request, allowed: string[]) {
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) {
    if (!allowed.includes(key) || params.getAll(key).length !== 1) invalidWikiRequest("Unknown or repeated query parameter.");
  }
  return params;
}

function flag(params: URLSearchParams, key: string) {
  const value = params.get(key);
  if (value !== null && value !== "1") invalidWikiRequest(`${key} must be 1 when supplied.`);
  return value === "1";
}

function pagination(params: URLSearchParams, maximum: number) {
  const integer = (key: string, fallback: number, min: number, max: number) => {
    const value = params.get(key);
    if (value === null) return fallback;
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) {
      invalidWikiRequest(`${key} must be an integer between ${min} and ${max}.`);
    }
    return Number(value);
  };
  return { limit: integer("limit", 100, 1, maximum), offset: integer("offset", 0, 0, 100_000) };
}

function pageQuery(request: Request, spaceId?: string): WikiPageListInput {
  const params = query(request, ["q", "status", "limit", "offset", "topicId", "includeDescendants", ...(spaceId ? [] : ["spaceId", "includeArchivedSpaces"])]);
  if(params.has("includeDescendants") && !["0","1"].includes(params.get("includeDescendants")!))invalidWikiRequest("includeDescendants must be 0 or 1.");
  if(params.has("topicId") && !spaceId && !params.has("spaceId"))invalidWikiRequest("A topic requires a space.");
  const status = params.get("status") ?? "active";
  if (status !== "active" && status !== "archived" && status !== "trash") invalidWikiRequest("Invalid page status.");
  return {
    ...pagination(params, 500), status,
    ...(params.has("topicId") ? {topicId:uuid(params.get("topicId"),"topicId")} : {}),
    ...(params.has("includeDescendants") ? {includeDescendants:params.get("includeDescendants")!=="0"} : {}),
    ...(spaceId ? { spaceId } : params.has("spaceId") ? { spaceId: uuid(params.get("spaceId"), "spaceId") } : {}),
    ...(params.has("q") ? { q: params.get("q")! } : {}),
    includeArchivedSpaces: flag(params, "includeArchivedSpaces"),
  };
}

export function createWikiApiHandlers(ports: WikiApiPorts) {
  const store = ports.store;
  function handler(run: (user: Actor, request: NextRequest, params: Awaited<WikiRouteContext["params"]>) => Promise<unknown>, status = 200) {
    return async (request: NextRequest, context?: WikiRouteContext) => {
      try {
        if (!ports.isDatabaseConfigured()) return wikiUnavailableResponse();
        const user = await ports.requireUser(request);
        // Next supplies a context without params for static routes too.
        const params = (context ? await context.params : undefined) ?? {};
        // Do not dispatch malformed path ids, including a version on another page.
        for (const [key, value] of Object.entries(params)) uuid(value, key);
        return wikiJson({ ok: true, ...await run(user, request, params) as object }, status);
      } catch (error) {
        return wikiRouteErrorResponse(error);
      }
    };
  }
  return {
    listSpaces: handler(async (user, request) => {
      const params = query(request, ["includeArchived"]);
      return { spaces: await store.listWikiSpaces(user, { includeArchived: flag(params, "includeArchived") }) };
    }),
    createSpace: handler(async (user, request) => {
      const body = await readWikiBody(request, ["boardId", "title", "description", "slug"], ["boardId", "title"]);
      const input: CreateWikiSpaceInput = { boardId: uuid(body.boardId, "boardId"), title: normalizeWikiSpaceTitle(body.title) };
      if (Object.hasOwn(body, "description")) input.description = normalizeWikiDescription(body.description);
      if (Object.hasOwn(body, "slug")) {
        if (typeof body.slug !== "string" || !body.slug.trim() || body.slug.length > maxWikiSlugLength) invalidWikiRequest("Invalid space slug.");
        input.slug = normalizeWikiSlug(body.slug, "");
        if (!input.slug) invalidWikiRequest("Space slug must contain ASCII letters or digits.");
      }
      return { space: await store.createWikiSpace(user, input) };
    }, 201),
    getSpace: handler(async (user, request, { spaceId }) => {
      query(request, []);
      return { space: await store.getWikiSpace(user, { spaceId: uuid(spaceId, "spaceId") }) };
    }),
    updateSpace: handler(async (user, request, { spaceId }) => {
      const body = await readWikiBody(request, ["title", "description", "archived", "homeNoteId"]);
      if (!Object.keys(body).length) invalidWikiRequest("Supply a space setting to update.");
      const input: UpdateWikiSpaceInput = {};
      if (Object.hasOwn(body, "title")) input.title = normalizeWikiSpaceTitle(body.title);
      if (Object.hasOwn(body, "description")) input.description = normalizeWikiDescription(body.description);
      if (Object.hasOwn(body, "archived")) {
        if (typeof body.archived !== "boolean") invalidWikiRequest("archived must be boolean.");
        input.archived = body.archived;
      }
      if (Object.hasOwn(body, "homeNoteId")) input.homeNoteId = body.homeNoteId === null ? null : uuid(body.homeNoteId, "homeNoteId");
      return { space: await store.updateWikiSpace(user, uuid(spaceId, "spaceId"), input) };
    }),
    removeSpace: handler(async (user, request, { spaceId }) => {
      query(request, []);
      await assertWikiEmptyBody(request);
      await store.removeWikiSpace(user, uuid(spaceId, "spaceId"));
      return {};
    }),
    listPages: handler(async (user, request) => store.listWikiPages(user, pageQuery(request))),
    listSpacePages: handler(async (user, request, { spaceId }) => store.listWikiPages(user, pageQuery(request, uuid(spaceId, "spaceId")))),
    createPage: handler(async (user, request, { spaceId }) => {
      const body = await readWikiBody(request, ["title", "content"]);
      const input: CreateWikiPageInput = {};
      if (Object.hasOwn(body, "title")) {
        if (typeof body.title !== "string" || body.title.length > maxNoteTitleLength) invalidWikiRequest("Invalid page title.");
        input.title = body.title;
      }
      if (Object.hasOwn(body, "content")) {
        if (!body.content || typeof body.content !== "object" || Array.isArray(body.content)) invalidWikiRequest("Invalid page content.");
        const content = body.content as Record<string, unknown>;
        assertWikiFields(content, ["blocks", "markdown", "text", "formatVersion"], ["blocks", "markdown", "text"]);
        if (typeof content.markdown !== "string" || typeof content.text !== "string") invalidWikiRequest("Invalid content text.");
        try { input.content = normalizeNoteContent(body.content); }
        catch { invalidWikiRequest("Invalid page content or content limit exceeded."); }
      }
      return { note: await store.createWikiPage(user, uuid(spaceId, "spaceId"), input) };
    }, 201),
    getPage: handler(async (user, request, { noteId }) => {
      query(request, []);
      return { note: await store.getWikiPage(user, uuid(noteId, "noteId")) };
    }),
    addPage: handler(async (user, request, { noteId }) => {
      const body = await readWikiBody(request, ["spaceId", "expectedVersion"], ["spaceId", "expectedVersion"]);
      return { note: await store.promoteNoteToWiki(user, uuid(noteId, "noteId"), { ...version(body), spaceId: uuid(body.spaceId, "spaceId") }) };
    }),
    movePage: handler(async (user, request, { noteId }) => {
      const body = await readWikiBody(request, ["spaceId", "sourceSpaceId", "expectedVersion"], ["spaceId", "sourceSpaceId", "expectedVersion"]);
      return { note: await store.moveWikiPage(user, uuid(noteId, "noteId"), {
        ...version(body), spaceId: uuid(body.spaceId, "spaceId"), sourceSpaceId: uuid(body.sourceSpaceId, "sourceSpaceId"),
      }) };
    }),
    copyPage: handler(async (user, request, { noteId }) => {
      const body = await readWikiBody(request, ["expectedVersion"], ["expectedVersion"]);
      return { note: await store.copyWikiPageToPersonal(user, uuid(noteId, "noteId"), version(body)) };
    }, 201),
    listVersions: handler(async (user, request, { noteId }) => ({
      ...await store.listWikiVersions(user, uuid(noteId, "noteId"), pagination(query(request, ["limit", "offset"]), 100)),
    })),
    getVersion: handler(async (user, request, { noteId, versionId }) => {
      query(request, []);
      return { version: await store.getWikiVersion(user, uuid(noteId, "noteId"), uuid(versionId, "versionId")) };
    }),
    restoreVersion: handler(async (user, request, { noteId, versionId }) => {
      const body = await readWikiBody(request, ["expectedVersion"], ["expectedVersion"]);
      return { note: await store.restoreWikiVersion(user, uuid(noteId, "noteId"), uuid(versionId, "versionId"), version(body)) };
    }),
  };
}
