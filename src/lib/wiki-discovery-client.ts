import { trackBoardWrite } from "@/components/use-live-board-revision";
import { WikiRequestError } from "@/lib/wiki-client";
import { NoteSaveConflictError } from "@/lib/notes-client";
import type { CreateWikiTopicInput, CreateWikiTopicResult, DeleteWikiTopicInput, SetWikiPageTopicsInput, WikiBacklinks, WikiMentionResolution, WikiPageTopics, WikiPagination, WikiSearchInput, WikiSearchResult, WikiTopicMutation, WikiTopicTree } from "@/lib/wiki-discovery-model";

async function request<T>(url: string, method: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const send = async () => {
    const response = await fetch(url, { method, cache: "no-store", signal,
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    const payload = await response.json();
    if (!response.ok) {
      if (response.status === 409 && payload.code === "note_conflict") throw new NoteSaveConflictError(payload.error, payload.currentVersion);
      throw new WikiRequestError(payload.error || "Wiki request failed.", response.status, payload.code);
    }
    if (payload.ok !== true) throw new Error("Invalid wiki response.");
    const { ok: _ok, ...result } = payload;
    void _ok;
    return result as T;
  };
  return method === "GET" || url === "/api/wiki/mentions/resolve" ? send() : trackBoardWrite(send());
}
function query(input: object) {
  const params = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => {
    if (value !== undefined && !(key === "includeArchivedSpaces" && value === false)) params.set(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value));
  });
  return params.toString();
}
const topicsUrl = (spaceId: string) => `/api/wiki/spaces/${encodeURIComponent(spaceId)}/topics`;
export function fetchWikiTopics(spaceId: string, signal?: AbortSignal) { return request<WikiTopicTree>(topicsUrl(spaceId), "GET", undefined, signal); }
export function createWikiTopicRequest(spaceId: string, input: CreateWikiTopicInput, signal?: AbortSignal) { return request<CreateWikiTopicResult>(topicsUrl(spaceId), "POST", input, signal); }
export function updateWikiTopicRequest(spaceId: string, topicId: string, input: WikiTopicMutation, signal?: AbortSignal) { return request<WikiTopicTree>(`${topicsUrl(spaceId)}/${encodeURIComponent(topicId)}`, "PATCH", input, signal); }
export function deleteWikiTopicRequest(spaceId: string, topicId: string, input: DeleteWikiTopicInput, signal?: AbortSignal) { return request<WikiTopicTree>(`${topicsUrl(spaceId)}/${encodeURIComponent(topicId)}`, "DELETE", input, signal); }
export function fetchWikiPageTopics(noteId: string, signal?: AbortSignal) { return request<WikiPageTopics>(`/api/wiki/pages/${encodeURIComponent(noteId)}/topics`, "GET", undefined, signal); }
export function setWikiPageTopicsRequest(noteId: string, input: SetWikiPageTopicsInput, signal?: AbortSignal) { return request<WikiPageTopics>(`/api/wiki/pages/${encodeURIComponent(noteId)}/topics`, "PUT", input, signal); }
export async function resolveWikiMentionsRequest(input: { noteIds: string[] }, signal?: AbortSignal) { return (await request<{ mentions: WikiMentionResolution[] }>("/api/wiki/mentions/resolve", "POST", input, signal)).mentions; }
export function searchWikiPagesRequest(input: WikiSearchInput, signal?: AbortSignal) { return request<WikiSearchResult>(`/api/wiki/search?${query(input)}`, "GET", undefined, signal); }
export function fetchWikiBacklinks(noteId: string, input: WikiPagination = {}, signal?: AbortSignal) { return request<WikiBacklinks>(`/api/wiki/pages/${encodeURIComponent(noteId)}/backlinks?${query(input)}`, "GET", undefined, signal); }
