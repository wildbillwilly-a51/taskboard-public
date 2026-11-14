import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import {
  notesRouteErrorResponse,
  persistenceUnavailableResponse,
  readNotesJsonBody,
} from "@/lib/notes-route";
import { linkNoteToTask } from "@/lib/notes-store";
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
    const body = await readNotesJsonBody(request);
    return NextResponse.json({ ok: true, note: await linkNoteToTask(user, noteId, body.taskId) });
  } catch (error) {
    return notesRouteErrorResponse(error, "Unable to link the task.");
  }
}
