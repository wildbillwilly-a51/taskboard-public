import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import {
  notesRouteErrorResponse,
  persistenceUnavailableResponse,
  readNotesJsonBody,
} from "@/lib/notes-route";
import { convertNoteToTask } from "@/lib/notes-store";
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
    const result = await convertNoteToTask(user, noteId, {
      boardId: body.boardId,
      bucketId: body.bucketId,
      title: body.title,
      timeZone: body.timeZone,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return notesRouteErrorResponse(error, "Unable to create a task from the note.");
  }
}
