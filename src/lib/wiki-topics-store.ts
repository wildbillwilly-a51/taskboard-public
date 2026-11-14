import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";
import { requireActor, withClient, withTransaction, type Actor } from "@/lib/notes-store-context";
import { getBoardAccess, requireNote } from "@/lib/notes-store-access";
import { WikiRuleError } from "@/lib/notes-errors";
import { canonicalWikiId, invalidDiscovery, maxWikiTopics, maxWikiTopicDepth, normalizeWikiIdSet, normalizeWikiTopicMutation, wikiInteger,
  type CreateWikiTopicInput, type DeleteWikiTopicInput, type SetWikiPageTopicsInput, type WikiTopic, type WikiTopicMutation, type WikiTopicTree } from "@/lib/wiki-discovery-model";

const missing = () => new WikiRuleError("wiki_not_found", "Wiki resource not found.", 404);
const conflict = () => new WikiRuleError("wiki_topics_conflict", "Topics changed. Refresh them before applying your changes.", 409);
function fields(input: unknown, allowed: string[]) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) invalidDiscovery();
}
export async function requireTopicSpace(client: PoolClient, actor: Actor, spaceId: string, manage = false) {
  spaceId = canonicalWikiId(spaceId);
  if (manage) await client.query("SELECT id FROM wiki_spaces WHERE id=$1 FOR UPDATE", [spaceId]);
  const row = (await client.query<{ id: string; board_id: string; archived_at: Date | null; topics_version: number }>("SELECT id,board_id,archived_at,topics_version FROM wiki_spaces WHERE id=$1", [spaceId])).rows[0];
  const access = row && await getBoardAccess(client, actor, row.board_id, new Map());
  if (!row || !access?.canRead) throw missing();
  if (manage && (!access.canManage || row.archived_at)) throw new WikiRuleError("wiki_read_only", "This space is read-only for this action.", 403);
  return row;
}
type TopicRow = { id: string; space_id: string; parent_topic_id: string | null; title: string; sort_order: string; page_count: string; assigned_page_count: string };
function count(value: string) { const number = Number(value); if (!Number.isSafeInteger(number) || number < 0) throw new Error("Topic count out of range."); return number; }
const topicRowsSql = `SELECT t.id,t.space_id,t.parent_topic_id,t.title,t.sort_order::text, count(n.id) FILTER (WHERE n.deleted_at IS NULL AND n.archived_at IS NULL)::text AS page_count,
    count(n.id)::text AS assigned_page_count FROM wiki_topics t LEFT JOIN wiki_page_topics p ON p.topic_id=t.id
    LEFT JOIN notes n ON n.id=p.note_id AND n.wiki_space_id=t.space_id WHERE t.space_id=$1
    GROUP BY t.id ORDER BY t.parent_topic_id NULLS FIRST,t.sort_order,t.id`;
async function tree(client: PoolClient, spaceId: string): Promise<WikiTopicTree> {
  // Version and tree share one statement snapshot, even while a manager commits.
  const row = (await client.query<{topics_version:number;topics:TopicRow[]}>(`SELECT s.topics_version,
    (SELECT COALESCE(jsonb_agg(q ORDER BY q.parent_topic_id NULLS FIRST,q.sort_order::numeric,q.id),'[]'::jsonb) FROM (${topicRowsSql}) q) AS topics FROM wiki_spaces s WHERE s.id=$1`,[spaceId])).rows[0];
  if(!row)throw missing();
  return { topicsVersion:row.topics_version, topics:row.topics.map(r => ({ id: r.id, spaceId: r.space_id, parentTopicId: r.parent_topic_id, title: r.title, sortOrder: r.sort_order, pageCount: count(r.page_count), assignedPageCount: count(r.assigned_page_count) })) };
}
async function topics(client:PoolClient,spaceId:string):Promise<WikiTopic[]> { return (await tree(client,spaceId)).topics; }
export async function listWikiTopics(user: TaskboardUserIdentity, spaceId: string) {
  const actor = requireActor(user);
  return withClient(async client => { const row = await requireTopicSpace(client, actor, spaceId); return tree(client, row.id); });
}
function checkVersion(expected: number, actual: number) { wikiInteger(expected, 1, 2147483647); if (expected !== actual) throw conflict(); }
async function bump(client: PoolClient, spaceId: string) {
  const row = (await client.query<{ topics_version: number }>("UPDATE wiki_spaces SET topics_version=topics_version+1,updated_at=clock_timestamp() WHERE id=$1 AND topics_version<2147483647 RETURNING topics_version", [spaceId])).rows[0];
  if (!row) throw conflict();
  return row.topics_version;
}
function validateParent(all: WikiTopic[], id: string, parentId: string | null) {
  if (parentId && !all.some(t => t.id === parentId)) invalidDiscovery("Parent must belong to this space.");
  const parents = new Map(all.map(t => [t.id, t.id === id ? parentId : t.parentTopicId])); parents.set(id, parentId);
  for (const start of parents.keys()) {
    const seen = new Set<string>(); let current: string | null = start;
    while (current) {
      if (seen.has(current)) invalidDiscovery("Topics cannot contain a cycle.");
      seen.add(current); if (seen.size > maxWikiTopicDepth) invalidDiscovery("Topics can nest at most four levels.");
      current = parents.get(current) ?? null;
    }
  }
}
// Decimal arithmetic stays in PostgreSQL. Rebalance only when a midpoint cannot fit.
async function sortOrder(client: PoolClient, spaceId: string, all: WikiTopic[], id: string, parentId: string | null, beforeId: string | null) {
  const siblings = all.filter(t => t.parentTopicId === parentId && t.id !== id);
  const index = beforeId === null ? siblings.length : siblings.findIndex(t => t.id === beforeId);
  if (index < 0) invalidDiscovery("The before topic must be a sibling under the selected parent.");
  const midpoint = async () => {
    const lo = index > 0 ? siblings[index - 1].sortOrder : null, hi = index < siblings.length ? siblings[index].sortOrder : null;
    return (await client.query<{ value: string; fits: boolean }>(`SELECT value::text, (abs(value)<10000000000 AND ($1::numeric IS NULL OR value>$1::numeric) AND ($2::numeric IS NULL OR value<$2::numeric)) AS fits
      FROM (SELECT round(CASE WHEN $1::numeric IS NULL AND $2::numeric IS NULL THEN 1024 WHEN $1::numeric IS NULL THEN $2::numeric-1024 WHEN $2::numeric IS NULL THEN $1::numeric+1024 ELSE ($1::numeric+$2::numeric)/2 END,10) AS value) s`, [lo, hi])).rows[0];
  };
  let result = await midpoint();
  if (!result.fits) {
    for (const [i, sibling] of siblings.entries()) { sibling.sortOrder = String((i + 1) * 1024); await client.query("UPDATE wiki_topics SET sort_order=$2 WHERE id=$1 AND space_id=$3", [sibling.id, sibling.sortOrder, spaceId]); }
    result = await midpoint();
  }
  return result.value;
}
async function mutation<T>(run: (client: PoolClient) => Promise<T>) {
  try { return await withTransaction(run); } catch (error) {
    const pg = error as { code?: string; constraint?: string };
    if (pg.code === "23505" && pg.constraint === "wiki_topics_sibling_name_key") throw new WikiRuleError("wiki_topic_name_exists", "A topic with this name already exists here.", 409);
    throw error;
  }
}
export async function createWikiTopic(user: TaskboardUserIdentity, spaceId: string, raw: CreateWikiTopicInput) {
  fields(raw,["title","parentTopicId","beforeTopicId","expectedTopicsVersion"]);
  const actor = requireActor(user), input = normalizeWikiTopicMutation(raw, true);
  return mutation(async client => {
    const row = await requireTopicSpace(client, actor, spaceId, true); checkVersion(input.expectedTopicsVersion, row.topics_version);
    const all = await topics(client, row.id), id = randomUUID(), parent = input.parentTopicId ?? null;
    if (all.length >= maxWikiTopics) invalidDiscovery("A space can have at most 1,000 topics.");
    validateParent(all, id, parent);
    const order = await sortOrder(client, row.id, all, id, parent, input.beforeTopicId ?? null);
    await client.query("INSERT INTO wiki_topics(id,space_id,parent_topic_id,title,sort_order) VALUES($1,$2,$3,$4,$5)", [id, row.id, parent, input.title, order]);
    const topicsVersion = await bump(client, row.id);
    return { topic: (await topics(client, row.id)).find(t => t.id === id)!, topicsVersion };
  });
}
export async function updateWikiTopic(user: TaskboardUserIdentity, spaceId: string, topicId: string, raw: WikiTopicMutation) {
  fields(raw,["title","parentTopicId","beforeTopicId","expectedTopicsVersion"]);
  const actor = requireActor(user), input = normalizeWikiTopicMutation(raw); topicId = canonicalWikiId(topicId);
  return mutation(async client => {
    const row = await requireTopicSpace(client, actor, spaceId, true), all = await topics(client, row.id), topic = all.find(t => t.id === topicId);
    if (!topic) throw missing(); checkVersion(input.expectedTopicsVersion, row.topics_version);
    const parent = input.parentTopicId === undefined ? topic.parentTopicId : input.parentTopicId, title = input.title ?? topic.title;
    validateParent(all, topicId, parent);
    const siblings = all.filter(t => t.parentTopicId === topic.parentTopicId), next = siblings[siblings.findIndex(t => t.id === topicId) + 1]?.id ?? null;
    const reposition = parent !== topic.parentTopicId || (input.beforeTopicId !== undefined && input.beforeTopicId !== next);
    if (input.beforeTopicId === topicId) invalidDiscovery("A topic cannot be ordered before itself.");
    const order = reposition ? await sortOrder(client, row.id, all, topicId, parent, input.beforeTopicId ?? null) : topic.sortOrder;
    if (!reposition && title === topic.title) return tree(client, row.id);
    await client.query("UPDATE wiki_topics SET parent_topic_id=$2,title=$3,sort_order=$4 WHERE id=$1", [topicId, parent, title, order]);
    await bump(client,row.id); return tree(client, row.id);
  });
}
export async function deleteWikiTopic(user: TaskboardUserIdentity, spaceId: string, topicId: string, input: DeleteWikiTopicInput) {
  fields(input,["expectedTopicsVersion"]);
  const actor = requireActor(user); topicId = canonicalWikiId(topicId);
  return mutation(async client => {
    const row = await requireTopicSpace(client, actor, spaceId, true), all = await topics(client, row.id);
    if (!all.some(t => t.id === topicId)) throw missing(); checkVersion(input.expectedTopicsVersion, row.topics_version);
    if (all.some(t => t.parentTopicId === topicId)) throw new WikiRuleError("wiki_topic_has_children", "Move or delete the child topics first.", 409);
    await client.query("DELETE FROM wiki_topics WHERE id=$1", [topicId]);
    await bump(client,row.id); return tree(client, row.id);
  });
}
async function pageTopics(client: PoolClient, spaceId: string, noteId: string) {
  const ids = new Set((await client.query<{ topic_id: string }>("SELECT topic_id FROM wiki_page_topics WHERE note_id=$1", [noteId])).rows.map(r => r.topic_id));
  return { spaceId, topics: (await topics(client, spaceId)).filter(t => ids.has(t.id)) };
}
export async function getWikiPageTopics(user: TaskboardUserIdentity, noteId: string) {
  const actor = requireActor(user); noteId = canonicalWikiId(noteId);
  return withClient(async client => { const { row } = await requireNote(client, actor, noteId, "read", new Map(), { allowDeleted: true }); if (!row.wiki_space_id) throw missing(); return pageTopics(client, row.wiki_space_id, noteId); });
}
export async function setWikiPageTopics(user: TaskboardUserIdentity, noteId: string, input: SetWikiPageTopicsInput) {
  fields(input,["sourceSpaceId","expectedTopicIds","topicIds"]);
  const actor = requireActor(user); noteId = canonicalWikiId(noteId);
  const source = canonicalWikiId(input.sourceSpaceId), expected = normalizeWikiIdSet(input.expectedTopicIds), desired = normalizeWikiIdSet(input.topicIds);
  return withTransaction(async client => {
    const { row } = await requireNote(client, actor, noteId, "edit", new Map(), { lock: true });
    if (!row.wiki_space_id) throw missing();
    if (row.wiki_space_id !== source) throw new WikiRuleError("wiki_home_conflict", "The page moved to another space.", 409);
    const current = (await client.query<{ topic_id: string }>("SELECT topic_id FROM wiki_page_topics WHERE note_id=$1 ORDER BY topic_id", [noteId])).rows.map(r => r.topic_id);
    if (current.join() !== expected.join()) throw conflict();
    const valid = (await client.query("SELECT id FROM wiki_topics WHERE space_id=$1 AND id=ANY($2::uuid[])", [source, desired])).rowCount;
    if (valid !== desired.length) invalidDiscovery("Every assigned topic must belong to this space.");
    if (current.join() !== desired.join()) {
      await client.query("DELETE FROM wiki_page_topics WHERE note_id=$1", [noteId]);
      await client.query("INSERT INTO wiki_page_topics(note_id,topic_id) SELECT $1,unnest($2::uuid[])", [noteId, desired]);
      await client.query("UPDATE notes SET updated_at=clock_timestamp(),updated_by_user_id=$2 WHERE id=$1", [noteId, actor.id]);
    }
    return pageTopics(client, source, noteId);
  });
}
// Reused by ranked search and legacy topic browsing, on the caller's one client.
export async function topicFilterIds(client: PoolClient, actor: Actor, spaceId: string | undefined, topicId: string | undefined, descendants = true) {
  if (typeof descendants !== "boolean") invalidDiscovery();
  if (topicId === undefined) return null;
  if (!spaceId) invalidDiscovery("A topic filter requires a space.");
  await requireTopicSpace(client, actor, spaceId); topicId = canonicalWikiId(topicId);
  if (!(await client.query("SELECT 1 FROM wiki_topics WHERE id=$1 AND space_id=$2", [topicId, spaceId])).rowCount) throw missing();
  if (!descendants) return [topicId];
  return (await client.query<{ id: string }>(`WITH RECURSIVE subtree(id,depth) AS (
    SELECT id,1 FROM wiki_topics WHERE id=$1 AND space_id=$2 UNION ALL
    SELECT t.id,s.depth+1 FROM wiki_topics t JOIN subtree s ON t.parent_topic_id=s.id WHERE t.space_id=$2 AND s.depth<4)
    SELECT id FROM subtree`, [topicId, spaceId])).rows.map(r => r.id);
}
