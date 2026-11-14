import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { notesRouteErrorResponse, persistenceUnavailableResponse } from "@/lib/notes-route";
import { unlinkNoteFromTask } from "@/lib/notes-store";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";

type RouteContext = {
  params: Promise<{
    noteId: string;
    taskId: string;
  }>;
};

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return persistenceUnavailableResponse();
  }

  const { noteId, taskId } = await context.params;
  const user = await requireTaskboardUserFromHeaders(request);

  try {
    return NextResponse.json({ ok: true, note: await unlinkNoteFromTask(user, noteId, taskId) });
  } catch (error) {
    return notesRouteErrorResponse(error, "Unable to unlink the task.");
  }
}
