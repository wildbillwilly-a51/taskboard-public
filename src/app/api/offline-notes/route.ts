import { NextRequest, NextResponse } from "next/server";
import { assertNotesRequestFields, notesRouteErrorResponse, readNotesJsonBody } from "@/lib/notes-route";
import { isOfflineNotesBetaUser } from "@/lib/offline-notes-config";
import { parseOfflineSave, readOfflineNotes, saveOfflineNote } from "@/lib/offline-notes-store";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireTaskboardUserFromHeaders(request);
    if (!isOfflineNotesBetaUser(user)) return reply({ error: "Offline Notes is unavailable for this account." }, 404);
    return reply(await readOfflineNotes({ ...user, id: user.id }));
  } catch (error) {
    return notesRouteErrorResponse(error, "Unable to load offline notes.");
  }
}

export async function POST(request: NextRequest) {
  if (request.headers.get("sec-fetch-site") === "cross-site"
    || !request.headers.get("content-type")?.startsWith("application/json")) {
    return reply({ error: "Offline Notes accepts same-site JSON saves." }, 403);
  }
  try {
    const user = await requireTaskboardUserFromHeaders(request);
    if (!isOfflineNotesBetaUser(user)) return reply({ error: "Offline Notes is unavailable for this account." }, 404);
    const body = await readNotesJsonBody(request);
    assertNotesRequestFields(body, ["ownerId", "operationId", "noteId", "expectedVersion", "title", "content"]);
    if (body.ownerId !== user.id) return reply({ error: "Sign in to the account that saved the note." }, 404);
    const result = await saveOfflineNote({ ...user, id: user.id }, parseOfflineSave(body));
    return reply(result, result.kind === "conflict" ? 409 : 200);
  } catch (error) {
    return notesRouteErrorResponse(error, "Unable to synchronize note.");
  }
}
