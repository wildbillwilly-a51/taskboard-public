import { NextRequest, NextResponse } from "next/server";
import { assertNotesRequestFields, notesRouteErrorResponse, readNotesJsonBody } from "@/lib/notes-route";
import { isOfflineWorkBetaUser } from "@/lib/offline-notes-config";
import { parseOfflineWorkSave, readOfflineWork, saveOfflineWork } from "@/lib/offline-work-store";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";

function reply(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export async function GET(request: NextRequest) {
  try {
    const user = await requireTaskboardUserFromHeaders(request);
    if (!user.id || !isOfflineWorkBetaUser(user)) return reply({ error: "Offline Board and Calendar are unavailable for this account." }, 404);
    return reply(await readOfflineWork({ ...user, id: user.id }));
  } catch (error) {
    return notesRouteErrorResponse(error, "Could not load offline Board and Calendar.");
  }
}

export async function POST(request: NextRequest) {
  if (request.headers.get("sec-fetch-site") === "cross-site"
    || !request.headers.get("content-type")?.startsWith("application/json"))
    return reply({ error: "Offline edits require same-site JSON." }, 403);
  try {
    const user = await requireTaskboardUserFromHeaders(request);
    if (!user.id || !isOfflineWorkBetaUser(user)) return reply({ error: "Offline Board and Calendar are unavailable for this account." }, 404);
    const body = await readNotesJsonBody(request);
    assertNotesRequestFields(body, ["ownerId","operationId","itemId","kind","version","patch"]);
    if (body.ownerId !== user.id) return reply({ error: "Sign in to the account that saved the edit." }, 404);
    const result = await saveOfflineWork({ ...user, id: user.id }, parseOfflineWorkSave(body));
    return reply(result, result.kind === "conflict" ? 409 : 200);
  } catch (error) {
    return notesRouteErrorResponse(error, "Could not synchronize this edit.");
  }
}
