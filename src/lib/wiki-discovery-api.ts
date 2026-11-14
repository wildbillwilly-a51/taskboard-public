import type { NextRequest } from "next/server";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";
import { canonicalWikiId, invalidDiscovery, normalizeWikiIdSet, normalizeWikiPagination, normalizeWikiTopicMutation, wikiInteger, type CreateWikiTopicInput, type WikiDiscoveryStore, type WikiTopicMutation } from "@/lib/wiki-discovery-model";
import { readWikiBody, wikiJson, wikiRouteErrorResponse, wikiUnavailableResponse } from "@/lib/wiki-route";
export type WikiDiscoveryContext = { params: Promise<{ spaceId?: string; topicId?: string; noteId?: string }> };
type Ports = { store: WikiDiscoveryStore; requireUser(request: NextRequest): Promise<TaskboardUserIdentity>; isDatabaseConfigured(): boolean };
function query(request: Request, allowed: string[]) {
  const params = new URL(request.url).searchParams;
  for (const key of params.keys()) if (!allowed.includes(key) || params.getAll(key).length !== 1) invalidDiscovery("Unknown or repeated query parameter.");
  return params;
}
function page(params: URLSearchParams) {
  for (const key of ["limit", "offset"]) if (params.has(key) && !/^\d+$/.test(params.get(key)!)) invalidDiscovery();
  return normalizeWikiPagination({ ...(params.has("limit") ? { limit: Number(params.get("limit")) } : {}), ...(params.has("offset") ? { offset: Number(params.get("offset")) } : {}) });
}
function flag(params: URLSearchParams, key: string, defaultValue = false, allowZero = false) {
  const value = params.get(key); if (value === null) return defaultValue;
  if (value !== "1" && !(allowZero && value === "0")) invalidDiscovery();
  return value === "1";
}
export function createWikiDiscoveryApiHandlers(ports: Ports) {
  function handler(run: (user: TaskboardUserIdentity, request: NextRequest, params: Awaited<WikiDiscoveryContext["params"]>) => Promise<object>, status = 200) {
    return async (request: NextRequest, context?: WikiDiscoveryContext) => {
      try {
        if (!ports.isDatabaseConfigured()) return wikiUnavailableResponse();
        const user = await ports.requireUser(request), params = (await context?.params) ?? {};
        for (const key of Object.keys(params) as Array<keyof typeof params>) params[key] = canonicalWikiId(params[key]);
        return wikiJson({ ok: true, ...await run(user, request, params) }, status);
      } catch (error) { return wikiRouteErrorResponse(error); }
    };
  }
  const store = ports.store;
  return {
    listTopics: handler(async (user, request, { spaceId }) => { query(request, []); return store.listWikiTopics(user, canonicalWikiId(spaceId)); }),
    createTopic: handler(async (user, request, { spaceId }) => {
      query(request, []); const body = await readWikiBody(request, ["title", "parentTopicId", "beforeTopicId", "expectedTopicsVersion"], ["title", "expectedTopicsVersion"]);
      return store.createWikiTopic(user, canonicalWikiId(spaceId), normalizeWikiTopicMutation(body as WikiTopicMutation, true) as CreateWikiTopicInput);
    }, 201),
    updateTopic: handler(async (user, request, { spaceId, topicId }) => {
      query(request, []); const body = await readWikiBody(request, ["title", "parentTopicId", "beforeTopicId", "expectedTopicsVersion"], ["expectedTopicsVersion"]);
      return store.updateWikiTopic(user, canonicalWikiId(spaceId), canonicalWikiId(topicId), normalizeWikiTopicMutation(body as WikiTopicMutation));
    }),
    deleteTopic: handler(async (user, request, { spaceId, topicId }) => {
      query(request, []); const body = await readWikiBody(request, ["expectedTopicsVersion"], ["expectedTopicsVersion"]);
      return store.deleteWikiTopic(user, canonicalWikiId(spaceId), canonicalWikiId(topicId), { expectedTopicsVersion: wikiInteger(body.expectedTopicsVersion, 1, 2147483647) });
    }),
    getPageTopics: handler(async (user, request, { noteId }) => { query(request, []); return store.getWikiPageTopics(user, canonicalWikiId(noteId)); }),
    setPageTopics: handler(async (user, request, { noteId }) => {
      query(request, []); const body = await readWikiBody(request, ["sourceSpaceId", "expectedTopicIds", "topicIds"], ["sourceSpaceId", "expectedTopicIds", "topicIds"]);
      return store.setWikiPageTopics(user, canonicalWikiId(noteId), { sourceSpaceId: canonicalWikiId(body.sourceSpaceId), expectedTopicIds: normalizeWikiIdSet(body.expectedTopicIds), topicIds: normalizeWikiIdSet(body.topicIds) });
    }),
    resolveMentions: handler(async (user, request) => {
      query(request, []); const body = await readWikiBody(request, ["noteIds"], ["noteIds"]);
      return { mentions: await store.resolveWikiMentions(user, { noteIds: normalizeWikiIdSet(body.noteIds) }) };
    }),
    backlinks: handler(async (user, request, { noteId }) => store.listWikiBacklinks(user, canonicalWikiId(noteId), page(query(request, ["limit", "offset"])) )),
    search: handler(async (user, request) => {
      const params = query(request, ["q", "spaceId", "topicId", "includeDescendants", "includeArchivedSpaces", "limit", "offset"]), q = params.get("q") ?? "";
      if (q.length > 200 || params.has("topicId") && !params.has("spaceId")) invalidDiscovery();
      return store.searchWikiPages(user, { q, ...page(params), ...(params.has("spaceId") ? { spaceId: canonicalWikiId(params.get("spaceId")) } : {}),
        ...(params.has("topicId") ? { topicId: canonicalWikiId(params.get("topicId")) } : {}), includeDescendants: flag(params, "includeDescendants", true, true), includeArchivedSpaces: flag(params, "includeArchivedSpaces") });
    }),
  };
}
