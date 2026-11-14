import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import {
  clampNoteListLimit,
  clampNoteListOffset,
  type NoteListFilters,
  type NoteListStatus,
  isUuid,
} from "@/lib/notes-model";
import {
  notesRouteErrorResponse,
  persistenceUnavailableResponse,
  readNotesJsonBody,
  assertNotesRequestFields,
} from "@/lib/notes-route";
import { createNote, listNotes } from "@/lib/notes-store";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";

const scopes = new Set<NoteListFilters["scope"]>(["personal", "board", "all"]);
const statuses = new Set<NoteListStatus>(["active", "archived", "trash"]);
export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return persistenceUnavailableResponse();
  }

  try {
  const user = await requireTaskboardUserFromHeaders(request);
  const params = request.nextUrl.searchParams;
  const scope = (params.get("scope") ?? "all") as NoteListFilters["scope"];
  const status = (params.get("status") ?? "active") as NoteListStatus;

  if (!scopes.has(scope)) {
    return NextResponse.json({ error: "scope must be personal, board, or all." }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }

  if (!statuses.has(status)) {
    return NextResponse.json({ error: "status must be active, archived, or trash." }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }

  const wikiSpaceId = params.get("wikiSpaceId") ?? undefined;
  if (wikiSpaceId !== undefined && (
    !isUuid(wikiSpaceId) || params.getAll("wikiSpaceId").length !== 1 || scope === "personal"
    || params.has("notebookId") || params.has("bucketId")
    || ["scope", "status", "boardId"].some((key) => params.getAll(key).length > 1)
    || params.has("boardId") && !isUuid(params.get("boardId"))
  )) {
    return NextResponse.json({ error: "Invalid or inconsistent wiki space filters.", code: "invalid_wiki_request" }, { status: 400, headers: { "Cache-Control": "private, no-store" } });
  }

    const notes = await listNotes(user, {
      scope,
      status,
      wikiSpaceId,
      boardId: params.get("boardId") ?? undefined,
      bucketId: params.get("bucketId") ?? undefined,
      notebookId: params.get("notebookId") ?? undefined,
      label: params.get("label")?.trim() || undefined,
      query: params.get("q") ?? undefined,
      pinnedOnly: params.get("pinned") === "1",
      limit: clampNoteListLimit(params.get("limit")),
      offset: clampNoteListOffset(params.get("offset")),
    });

    return NextResponse.json({ ok: true, notes }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return notesRouteErrorResponse(error, "Unable to load notes.");
  }
}

export async function POST(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return persistenceUnavailableResponse();
  }

  try {
    const user = await requireTaskboardUserFromHeaders(request);
    const body = await readNotesJsonBody(request);
    assertNotesRequestFields(body, ["title", "content", "boardId", "bucketId", "notebookId", "labels", "linkTaskId"]);
    const note = await createNote(user, {
      title: body.title,
      content: body.content,
      boardId: body.boardId,
      bucketId: body.bucketId,
      notebookId: body.notebookId,
      labels: body.labels,
      linkTaskId: body.linkTaskId,
    });

    return NextResponse.json({ ok: true, note }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return notesRouteErrorResponse(error, "Unable to create note.");
  }
}
