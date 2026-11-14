import { createWikiFixture, fixtureNote, ids, type Scenario } from "../wiki-ui/state";
import type { WikiPageTopics, WikiSearchHit, WikiTopic, WikiTopicMutation } from "../../../src/lib/wiki-discovery-model";
import { normalizeWikiIdSet, normalizeWikiTopicMutation } from "../../../src/lib/wiki-discovery-model";
export const topicIds = ["70000000-0000-4000-8000-000000000001", "70000000-0000-4000-8000-000000000002", "70000000-0000-4000-8000-000000000003"];
export function fixtureTopics(): WikiTopic[] { return topicIds.map((id, index) => ({ id, spaceId: ids.space, parentTopicId: index === 1 ? topicIds[0] : null, title: ["Operations", "Daily routines", "Decisions"][index], sortOrder: String(index), pageCount: index === 0 ? 1 : 0, assignedPageCount: index === 0 ? 3 : 0 })); }
export function fixtureHit(): WikiSearchHit { const note = fixtureNote(); return { id: note.id, title: note.title, href: note.wiki.canonicalHref, spaceId: ids.space, spaceTitle: "Team handbook", updatedAt: note.updatedAt, archived: false, snippet: [{ text: "Safe <img src=x onerror=alert(1)> ", match: false }, { text: "knowledge", match: true }] }; }
export function createP2Fixture(scenario: Scenario = "manager") {
  const base = createWikiFixture(scenario);
  let topics = fixtureTopics(), version = 1, selected = [topicIds[0]], conflict = false, revoked = false;
  const requests: Array<{ method: string; path: string; body: unknown }> = [];
  const assignments = (): WikiPageTopics => ({ spaceId: base.note.wiki.spaceId, topics: base.note.wiki.spaceId === ids.space ? topics.filter(topic => selected.includes(topic.id)) : [] });
  const ok = (body: object) => ({ status: 200, body: { ok: true, ...body } });
  const fail = (code: string, error: string, status = 409) => ({ status, body: { code, error } });
  return {
    base, requests, get topics() { return topics; }, get selected() { return selected; },
    conflict() { conflict = true; }, deleteTopicExternally(id: string) { topics = topics.filter(topic => topic.id !== id); version++; }, revoke() { revoked = true; base.revoke(); },
    async handle(method: string, url: URL, body?: unknown) {
      const path = url.pathname; requests.push({ method, path, body });
      if (revoked && path !== "/api/live") return fail("wiki_not_found", "Page unavailable.", 404);
      if (path === "/api/wiki/search") { if (url.searchParams.get("q") === "no-match") return ok({ pages: [], limit: 30, offset: 0, hasMore: false }); return ok({ pages: [fixtureHit()], limit: Number(url.searchParams.get("limit") || 30), offset: Number(url.searchParams.get("offset") || 0), hasMore: false }); }
      if (path.endsWith("/backlinks")) return ok({ pages: [{ ...fixtureHit(), id: "30000000-0000-4000-8000-000000000099", title: "Linked procedure", archived: true }], limit: 30, offset: 0, hasMore: false });
      if (path === `/api/wiki/pages/${ids.note}/topics`) {
        if (method === "GET") return ok(assignments());
        const input = body as { sourceSpaceId: string; expectedTopicIds: string[]; topicIds: string[] };
        if (!base.note.canEdit || base.note.wiki.spaceArchived) return fail("wiki_read_only", "Read only", 403);
        if (input.sourceSpaceId !== ids.space) return fail("wiki_home_conflict", "Page moved");
        if (conflict) { conflict = false; selected = [topicIds[2]]; return fail("wiki_topics_conflict", "Assignments changed elsewhere."); }
        if (JSON.stringify(normalizeWikiIdSet(input.expectedTopicIds)) !== JSON.stringify([...selected].sort())) return fail("wiki_topics_conflict", "Assignments changed elsewhere.");
        selected = normalizeWikiIdSet(input.topicIds); return ok(assignments());
      }
      if (path === `/api/wiki/spaces/${ids.other}/topics` && method === "GET") return ok({ topics: [], topicsVersion: 1 });
      if (path.startsWith(`/api/wiki/spaces/${ids.space}/topics`)) {
        if (method === "GET") return ok({ topics, topicsVersion: version });
        if (scenario !== "manager") return fail("wiki_read_only", "Manager required", 403);
        const input = body as WikiTopicMutation;
        if (input.expectedTopicsVersion !== version) return fail("wiki_topics_conflict", "Topics changed elsewhere");
        const id = path.split("/")[6];
        if (method === "DELETE") { if (topics.some(topic => topic.parentTopicId === id)) return fail("wiki_topic_has_children", "Move children first"); topics = topics.filter(topic => topic.id !== id); selected = selected.filter(item => item !== id); version++; return ok({ topics, topicsVersion: version }); }
        const normalized = normalizeWikiTopicMutation(input, method === "POST");
        if (topics.some(topic => topic.id !== id && topic.parentTopicId === (normalized.parentTopicId ?? null) && topic.title.toLowerCase() === normalized.title?.toLowerCase())) return fail("wiki_topic_name_exists", "Topic name already exists");
        if (method === "POST") { const topic = { ...fixtureTopics()[0], id: `70000000-0000-4000-8000-${String(topics.length + 1).padStart(12, "0")}`, title: normalized.title!, parentTopicId: normalized.parentTopicId ?? null, assignedPageCount: 0, pageCount: 0 }; topics.push(topic); version++; return ok({ topic, topicsVersion: version }); }
        topics = topics.map(topic => topic.id === id ? { ...topic, title: normalized.title ?? topic.title, parentTopicId: normalized.parentTopicId ?? null } : topic); version++; return ok({ topics, topicsVersion: version });
      }
      return base.handle(method, url, body);
    },
  };
}
