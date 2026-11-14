// Portable discovery contracts. Authorization belongs to the store, not these validators.
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";
import { isUuid } from "@/lib/notes-model";
import { WikiRuleError } from "@/lib/notes-errors";

export const maxWikiTopics = 1000;
export const maxWikiTopicDepth = 4;
export const maxWikiPageTopics = 100;
export const maxWikiMentionIds = 100;
export const maxWikiTopicTitleLength = 120;
export type WikiTopic = {
  id: string; spaceId: string; parentTopicId: string | null; title: string;
  sortOrder: string; pageCount: number;
  // Includes trash and archived pages, for an accurate delete confirmation.
  assignedPageCount: number;
};
export type WikiTopicTree = { topics: WikiTopic[]; topicsVersion: number };
export type WikiPageTopics = { spaceId: string; topics: WikiTopic[] };
export type WikiTopicMutation = { expectedTopicsVersion: number; title?: string; parentTopicId?: string | null; beforeTopicId?: string | null };
export type CreateWikiTopicInput = WikiTopicMutation & { title: string };
export type DeleteWikiTopicInput = { expectedTopicsVersion: number };
export type CreateWikiTopicResult = { topic: WikiTopic; topicsVersion: number };
export type SetWikiPageTopicsInput = { sourceSpaceId: string; expectedTopicIds: string[]; topicIds: string[] };
export type WikiMentionResolution =
  | { noteId: string; state: "readable"; title: string; href: string; spaceId: string; spaceTitle: string; archived: boolean }
  | { noteId: string; state: "restricted" };
export type WikiSnippetPart = { text: string; match: boolean };
export type WikiSearchHit = { id: string; title: string; href: string; spaceId: string; spaceTitle: string; updatedAt: string; archived: boolean; snippet: WikiSnippetPart[] };
export type WikiSearchInput = { q: string; spaceId?: string; topicId?: string; includeDescendants?: boolean; includeArchivedSpaces?: boolean; limit?: number; offset?: number };
export type WikiPagination = { limit?: number; offset?: number };
export type WikiSearchResult = { pages: WikiSearchHit[]; limit: number; offset: number; hasMore: boolean };
export type WikiBacklinks = WikiSearchResult;
export interface WikiDiscoveryStore {
  listWikiTopics(user: TaskboardUserIdentity, spaceId: string): Promise<WikiTopicTree>;
  createWikiTopic(user: TaskboardUserIdentity, spaceId: string, input: CreateWikiTopicInput): Promise<CreateWikiTopicResult>;
  updateWikiTopic(user: TaskboardUserIdentity, spaceId: string, topicId: string, input: WikiTopicMutation): Promise<WikiTopicTree>;
  deleteWikiTopic(user: TaskboardUserIdentity, spaceId: string, topicId: string, input: DeleteWikiTopicInput): Promise<WikiTopicTree>;
  getWikiPageTopics(user: TaskboardUserIdentity, noteId: string): Promise<WikiPageTopics>;
  setWikiPageTopics(user: TaskboardUserIdentity, noteId: string, input: SetWikiPageTopicsInput): Promise<WikiPageTopics>;
  resolveWikiMentions(user: TaskboardUserIdentity, input: { noteIds: string[] }): Promise<WikiMentionResolution[]>;
  searchWikiPages(user: TaskboardUserIdentity, input: WikiSearchInput): Promise<WikiSearchResult>;
  listWikiBacklinks(user: TaskboardUserIdentity, noteId: string, input: WikiPagination): Promise<WikiBacklinks>;
}
export function invalidDiscovery(message = "Invalid wiki request."): never { throw new WikiRuleError("invalid_wiki_request", message, 400); }
export function canonicalWikiId(value: unknown): string {
  if (!isUuid(value)) invalidDiscovery("Expected a valid UUID.");
  return value.toLowerCase();
}
export function normalizeWikiIdSet(value: unknown, maximum = maxWikiPageTopics): string[] {
  if (!Array.isArray(value) || value.length > maximum) invalidDiscovery(`Supply at most ${maximum} IDs.`);
  return [...new Set(value.map(canonicalWikiId))].sort();
}
export function normalizeWikiTopicTitle(value: unknown): string {
  if (typeof value !== "string") invalidDiscovery("Topic title is required.");
  const title = value.replace(/\s+/g, " ").trim();
  if (!title || title.length > maxWikiTopicTitleLength) invalidDiscovery("Topic title must be 1–120 characters.");
  return title;
}
export function wikiInteger(value: unknown, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) invalidDiscovery("Integer outside the allowed range.");
  return value;
}
export function normalizeWikiPagination(input: WikiPagination) {
  return { limit: wikiInteger(input.limit ?? 30, 1, 100), offset: wikiInteger(input.offset ?? 0, 0, 100000) };
}
export function normalizeWikiTopicMutation(input: WikiTopicMutation, create = false): WikiTopicMutation {
  const result: WikiTopicMutation = { expectedTopicsVersion: wikiInteger(input.expectedTopicsVersion, 1, 2147483647) };
  if (create || input.title !== undefined) result.title = normalizeWikiTopicTitle(input.title);
  for (const key of ["parentTopicId", "beforeTopicId"] as const) if (input[key] !== undefined) result[key] = input[key] === null ? null : canonicalWikiId(input[key]);
  if (!create && Object.keys(result).length === 1) invalidDiscovery("Supply a topic setting to update.");
  return result;
}
