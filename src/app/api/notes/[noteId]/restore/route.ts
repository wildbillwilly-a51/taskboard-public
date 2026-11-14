import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { notesRouteErrorResponse, persistenceUnavailableResponse } from "@/lib/notes-route";
import { restoreNote } from "@/lib/notes-store";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";

type RouteContext = {
  params: Promise<{
    noteId: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return persistenceUnavailableResponse();
  }

  const { noteId } = await context.params;
  const user = await requireTaskboardUserFromHeaders(request);

  try {
    return NextResponse.json({ ok: true, note: await restoreNote(user, noteId) });
  } catch (error) {
    return notesRouteErrorResponse(error, "Unable to restore note.");
  }
}
