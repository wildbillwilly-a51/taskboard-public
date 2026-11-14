import type { FolioListing, FolioSpace, FolioView } from "./folio-model";
import type { NoteDetail } from "./notes-model";
import { NoteRequestError, NoteSaveConflictError } from "./notes-client";
export async function folioRequest<T>(
  query: Record<string, string | number> = {},
  body?: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<T> {
  const params = new URLSearchParams(
    Object.entries(query).map(([k, v]) => [k, String(v)]),
  );
  const response = await fetch(`/api/folio?${params}`, {
    method: body ? "POST" : "GET",
    cache: "no-store",
    signal,
    ...(body
      ? {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  const value = await response.json();
  if (!response.ok) {
    if (value.code === "note_conflict")
      throw new NoteSaveConflictError(value.error, value.currentVersion);
    throw new NoteRequestError(
      value.error ?? "Unable to load Folio.",
      response.status,
    );
  }
  return value as T;
}
export const fetchFolioLibrary = (signal?: AbortSignal) =>
  folioRequest<{ spaces: FolioSpace[]; rootSpaceId: string }>(
    {},
    undefined,
    signal,
  );
export const fetchFolioNotes = (
  view: FolioView,
  q = "",
  offset = 0,
  signal?: AbortSignal,
) =>
  folioRequest<FolioListing>(
    {
      action: "list",
      view: view.kind,
      ...(view.kind === "space" ? { spaceId: view.spaceId } : {}),
      q,
      offset,
    },
    undefined,
    signal,
  );
export const createFolioNoteRequest = async () =>
  (await folioRequest<{ note: NoteDetail }>({}, { action: "createNote" })).note;
