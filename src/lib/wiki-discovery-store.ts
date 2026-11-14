import "server-only";
import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";
import { requireActor, withClient, toIso, type Actor } from "@/lib/notes-store-context";
import { requireNote, noteSelectSql, getNoteRowAccess, type DbNoteRow } from "@/lib/notes-store-access";
import { FOLIO_REVISION_SCOPE } from "@/lib/folio-model";
import { listAccessibleBoardsWithClient } from "@/lib/taskboard-store";
import { buildNoteSearchQuery, getNoteDisplayTitle } from "@/lib/notes-model";
import { buildWikiPageHref } from "@/lib/wiki-model";
import { WikiRuleError } from "@/lib/notes-errors";
import { requireTopicSpace, topicFilterIds } from "@/lib/wiki-topics-store";
import { canonicalWikiId, invalidDiscovery, normalizeWikiIdSet, normalizeWikiPagination, type WikiMentionResolution, type WikiPagination, type WikiSearchHit, type WikiSearchInput, type WikiSnippetPart } from "@/lib/wiki-discovery-model";

type HitRow = { id: string; title: string; content_text: string; updated_at: Date; space_id: string; space_title: string; slug: string; archived: boolean };
function fields(input: unknown, allowed: string[]) {
  if(!input || typeof input!=="object" || Array.isArray(input) || Object.keys(input).some(key=>!allowed.includes(key)))invalidDiscovery();
}
const select = `SELECT n.id,n.title,n.content_text,n.updated_at,s.id AS space_id,s.title AS space_title,s.slug,(s.archived_at IS NOT NULL) AS archived
  FROM notes n JOIN wiki_spaces s ON s.id=n.wiki_space_id`;
async function boards(client: PoolClient, actor: Actor) { return (await listAccessibleBoardsWithClient(client, actor)).boards.map(b => b.boardId); }
function hit(row: HitRow, snippet: WikiSnippetPart[]): WikiSearchHit {
  const title = getNoteDisplayTitle(row.title, row.content_text);
  return { id: row.id, title, href: buildWikiPageHref(row.slug, row.id, title), spaceId: row.space_id, spaceTitle: row.space_title, updatedAt: toIso(row.updated_at)!, archived: row.archived, snippet };
}
function plain(text: string): WikiSnippetPart[] { const value = text.replace(/\s+/g, " ").trim().slice(0, 200); return value ? [{ text: value, match: false }] : []; }
// Markers are generated per returned slice and checked against source text. No HTML
// is emitted or trusted; angle brackets in authored text remain ordinary text.
async function snippets(client: PoolClient, rows: HitRow[], query: string | null): Promise<WikiSnippetPart[][]> {
  if (!query || !rows.length) return rows.map(r => plain(r.content_text));
  let start: string, stop: string;
  do { const token = randomUUID().replaceAll("-", ""); start = `WIKISTART${token}X`; stop = `WIKISTOP${token}X`; }
  while (rows.some(r => r.content_text.includes(start) || r.content_text.includes(stop)));
  const options = `StartSel=${start}, StopSel=${stop}, MaxWords=35, MinWords=15, MaxFragments=2, FragmentDelimiter=" … "`;
  // Headline normally strips XML tags, even though these are literal authored
  // text. Escape before headline, then decode once into text segments, never HTML.
  const escaped = rows.map(r => r.content_text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;"));
  const decode = (text: string) => text.replace(/&(amp|lt|gt);/g, (_, entity: string) => ({ amp: "&", lt: "<", gt: ">" })[entity]!);
  const results = (await client.query<{ headline: string }>("SELECT ts_headline('simple',body,to_tsquery('simple',$2),$3) AS headline FROM unnest($1::text[]) WITH ORDINALITY AS t(body,ord) ORDER BY ord", [escaped, query, options])).rows;
  return results.map(({ headline }, index) => {
    if (!rows[index].content_text.trim()) return [];
    const parts: WikiSnippetPart[] = []; let remaining = headline, match = false;
    while (remaining) {
      const marker = match ? stop : start, at = remaining.indexOf(marker);
      if (at < 0) { parts.push({ text: decode(remaining), match }); break; }
      if (at) parts.push({ text: decode(remaining.slice(0, at)), match });
      remaining = remaining.slice(at + marker.length); match = !match;
    }
    return parts;
  });
}
export async function resolveWikiMentions(user: TaskboardUserIdentity, input: { noteIds: string[] }): Promise<WikiMentionResolution[]> {
  fields(input,["noteIds"]);
  const actor = requireActor(user), ids = normalizeWikiIdSet(input.noteIds);
  return withClient(async client => {
    const rows = (await client.query<DbNoteRow>(`${noteSelectSql} WHERE notes.id=ANY($1::uuid[]) AND notes.deleted_at IS NULL
      AND (notes.wiki_space_id IS NOT NULL OR notes.folio_kind IS NOT NULL)`, [ids])).rows;
    const byId = new Map<string,WikiMentionResolution>(),cache=new Map();
    for(const row of rows){
      const access=await getNoteRowAccess(client,actor,row,cache);if(!access.canRead)continue;
      const title=getNoteDisplayTitle(row.title,row.content_text);
      // Folio documents can have several (or hidden) placements. A mention
      // resolves the note, and never discloses any of those connection paths.
      byId.set(row.id,{noteId:row.id,state:'readable',title,
        href:row.folio_kind?`/folio?note=${row.id}`:buildWikiPageHref(row.space_slug!,row.id,title),
        spaceId:row.folio_kind?FOLIO_REVISION_SCOPE:row.wiki_space_id!,spaceTitle:row.folio_kind?'Folio':row.space_title!,
        archived:Boolean(row.archived_at||row.space_archived_at||row.folio_kind==='space_page'&&!access.canEdit)});
    }
    return ids.map(noteId=>byId.get(noteId)??{noteId,state:'restricted'});
  });
}
export async function searchWikiPages(user: TaskboardUserIdentity, input: WikiSearchInput) {
  fields(input,["q","spaceId","topicId","includeDescendants","includeArchivedSpaces","limit","offset"]);
  const actor = requireActor(user), { limit, offset } = normalizeWikiPagination(input);
  if (typeof input.q !== "string" || input.q.length > 200) invalidDiscovery("Search must be at most 200 characters.");
  if (input.spaceId !== undefined) canonicalWikiId(input.spaceId);
  for (const flag of [input.includeArchivedSpaces, input.includeDescendants]) if (flag !== undefined && typeof flag !== "boolean") invalidDiscovery();
  return withClient(async client => {
    if (input.spaceId) await requireTopicSpace(client, actor, input.spaceId);
    const ids = await topicFilterIds(client, actor, input.spaceId, input.topicId, input.includeDescendants ?? true);
    const params: unknown[] = [await boards(client, actor)], where = ["n.board_id=ANY($1::uuid[])", "n.deleted_at IS NULL", "n.archived_at IS NULL"];
    const param = (value: unknown) => { params.push(value); return `$${params.length}`; };
    // Explicit archived-space navigation remains readable, as in listWikiPages.
    if (!input.includeArchivedSpaces && !input.spaceId) where.push("s.archived_at IS NULL");
    if (input.spaceId) where.push(`s.id=${param(input.spaceId)}`);
    if (ids) where.push(`EXISTS(SELECT 1 FROM wiki_page_topics p WHERE p.note_id=n.id AND p.topic_id=ANY(${param(ids)}::uuid[]))`);
    const query = buildNoteSearchQuery(input.q), q = query ? param(query) : null;
    if (q) where.push(`n.search_vector @@ to_tsquery('simple',${q})`);
    const rows = (await client.query<HitRow>(`${select} WHERE ${where.join(" AND ")} ORDER BY ${q ? `ts_rank(n.search_vector,to_tsquery('simple',${q})) DESC,` : ""}n.updated_at DESC,n.id LIMIT ${param(limit + 1)} OFFSET ${param(offset)}`, params)).rows;
    const slice = rows.slice(0, limit), parts = await snippets(client, slice, query);
    return { pages: slice.map((r, i) => hit(r, parts[i])), limit, offset, hasMore: rows.length > limit };
  });
}
export async function listWikiBacklinks(user: TaskboardUserIdentity, noteId: string, input: WikiPagination = {}) {
  fields(input,["limit","offset"]);
  const actor = requireActor(user), { limit, offset } = normalizeWikiPagination(input); noteId = canonicalWikiId(noteId);
  return withClient(async client => {
    const { row } = await requireNote(client, actor, noteId, "read", new Map(), { allowDeleted: true });
    if (!row.wiki_space_id) throw new WikiRuleError("wiki_not_found", "Wiki resource not found.", 404);
    const rows = (await client.query<HitRow>(`${select} WHERE n.id<>$1 AND n.board_id=ANY($2::uuid[]) AND n.deleted_at IS NULL AND n.archived_at IS NULL
      AND EXISTS(SELECT 1 FROM note_links l WHERE l.source_note_id=n.id AND l.target_note_id=$1)
      ORDER BY n.updated_at DESC,n.id LIMIT $3 OFFSET $4`, [noteId, await boards(client, actor), limit + 1, offset])).rows;
    return { pages: rows.slice(0, limit).map(r => hit(r, plain(r.content_text))), limit, offset, hasMore: rows.length > limit };
  });
}
