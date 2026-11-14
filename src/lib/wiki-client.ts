// The browser adapter uses the core DTOs and the existing Notes conflict class.
import { trackBoardWrite } from "@/components/use-live-board-revision";
import { NoteRequestError, NoteSaveConflictError } from "@/lib/notes-client";
import type { NoteDetail } from "@/lib/notes-model";
import type { CreateWikiPageInput, CreateWikiSpaceInput, UpdateWikiSpaceInput, WikiPageDetail, WikiPageList, WikiPageListInput, WikiSpaceSummary, WikiVersionDetail, WikiVersionList } from "@/lib/wiki-model";

export class WikiRequestError extends NoteRequestError {
  constructor(message: string, status: number, public code?: string) { super(message, status); }
}
async function request<T>(url: string, method = "GET", body?: unknown): Promise<T> {
  const send = async () => {
    const response = await fetch(url, { method, cache: "no-store", ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    const payload = await response.json();
    if (!response.ok) {
      if (response.status === 409 && payload.code === "note_conflict") throw new NoteSaveConflictError(payload.error, payload.currentVersion);
      throw new WikiRequestError(payload.error || "Wiki request failed.", response.status, payload.code);
    }
    if (payload.ok !== true) throw new Error("Invalid wiki response.");
    return payload as T;
  };
  return method === "GET" ? send() : trackBoardWrite(send());
}
export async function fetchWikiSpaces(includeArchived = false) { return (await request<{ spaces: WikiSpaceSummary[] }>(`/api/wiki/spaces${includeArchived ? "?includeArchived=1" : ""}`)).spaces; }
export async function createWikiSpaceRequest(input: CreateWikiSpaceInput) { return (await request<{ space: WikiSpaceSummary }>("/api/wiki/spaces", "POST", input)).space; }
export async function updateWikiSpaceRequest(id: string, input: UpdateWikiSpaceInput) { return (await request<{ space: WikiSpaceSummary }>(`/api/wiki/spaces/${id}`, "PATCH", input)).space; }
export async function removeWikiSpaceRequest(id: string) { await request(`/api/wiki/spaces/${id}`, "DELETE"); }
export async function fetchWikiPages(input: WikiPageListInput = {}) {
  const params = new URLSearchParams();
  Object.entries(input).forEach(([key, value]) => { if (value !== undefined && !(key === "includeArchivedSpaces" && value === false)) params.set(key, typeof value === "boolean" ? (value ? "1" : "0") : String(value)); });
  return request<WikiPageList>(`/api/wiki/pages?${params}`);
}
export async function fetchWikiPage(id: string) { return (await request<{ note: WikiPageDetail }>(`/api/wiki/pages/${id}`)).note; }
export async function createWikiPageRequest(spaceId: string, input: CreateWikiPageInput) { return (await request<{ note: WikiPageDetail }>(`/api/wiki/spaces/${spaceId}/pages`, "POST", input)).note; }
export async function promoteNoteToWikiRequest(id: string, spaceId: string, expectedVersion: number) { return (await request<{ note: WikiPageDetail }>(`/api/wiki/pages/${id}/add`, "POST", { spaceId, expectedVersion })).note; }
export async function moveWikiPageRequest(id: string, spaceId: string, sourceSpaceId: string, expectedVersion: number) { return (await request<{ note: WikiPageDetail }>(`/api/wiki/pages/${id}/move`, "POST", { spaceId, sourceSpaceId, expectedVersion })).note; }
export async function copyWikiPageRequest(id: string, expectedVersion: number) { return (await request<{ note: NoteDetail }>(`/api/wiki/pages/${id}/copy`, "POST", { expectedVersion })).note; }
export function fetchWikiVersions(id: string, offset = 0) { return request<WikiVersionList>(`/api/wiki/pages/${id}/versions?limit=50&offset=${offset}`); }
export async function fetchWikiVersion(id: string, versionId: string) { return (await request<{ version: WikiVersionDetail }>(`/api/wiki/pages/${id}/versions/${versionId}`)).version; }
export async function restoreWikiVersionRequest(id: string, versionId: string, expectedVersion: number) { return (await request<{ note: WikiPageDetail }>(`/api/wiki/pages/${id}/versions/${versionId}/restore`, "POST", { expectedVersion })).note; }
