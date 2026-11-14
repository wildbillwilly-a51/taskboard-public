import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { notesRouteErrorResponse, persistenceUnavailableResponse } from "@/lib/notes-route";
import { listTaskLinkedNotes } from "@/lib/notes-store";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

// Notes linked to the task that the signed-in user can read.
export async function GET(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return persistenceUnavailableResponse();
  }

  const { taskId } = await context.params;
  const user = await requireTaskboardUserFromHeaders(request);

  try {
    return NextResponse.json({ ok: true, notes: await listTaskLinkedNotes(user, taskId) });
  } catch (error) {
    return notesRouteErrorResponse(error, "Unable to load linked notes.");
  }
}
