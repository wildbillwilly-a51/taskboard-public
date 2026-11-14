import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { notesRouteErrorResponse, persistenceUnavailableResponse } from "@/lib/notes-route";
import { listNoteTags } from "@/lib/notes-store";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";

// The signed-in user's personal note tags with active note counts.
export async function GET(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return persistenceUnavailableResponse();
  }

  const user = await requireTaskboardUserFromHeaders(request);

  try {
    return NextResponse.json({ ok: true, tags: await listNoteTags(user) });
  } catch (error) {
    return notesRouteErrorResponse(error, "Unable to load tags.");
  }
}
