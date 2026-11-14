import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { notesRouteErrorResponse, persistenceUnavailableResponse } from "@/lib/notes-route";
import { listNoteHomeOptions } from "@/lib/notes-store";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";

// The boards and buckets a note can live in, as the Notes sidebar shows them.
// The page loads them once; open pages reload them when Notes change.
export async function GET(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return persistenceUnavailableResponse();
  }

  const user = await requireTaskboardUserFromHeaders(request);

  try {
    return NextResponse.json({ ok: true, homeOptions: await listNoteHomeOptions(user) });
  } catch (error) {
    return notesRouteErrorResponse(error, "Unable to load note folders.");
  }
}
