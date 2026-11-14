import { NextRequest, NextResponse } from "next/server";
import { boardRouteErrorResponse, getBoardContextFromRequest } from "@/lib/board-route";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { deleteTaskNote, getBoardStateFromDatabase, updateTaskNote } from "@/lib/taskboard-store";

type RouteContext = {
  params: Promise<{
    taskId: string;
    noteId: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const { taskId, noteId } = await context.params;
  const user = await requireTaskboardUserFromHeaders(request);

  try {
    const body = (await request.json()) as { boardId?: string; body?: unknown };
    const boardContext = getBoardContextFromRequest(request, body);
    if (typeof body.body !== "string") {
      throw new Error("Note text is required.");
    }

    await updateTaskNote(user, taskId, noteId, body.body, boardContext);
    return NextResponse.json({ ok: true, ...(await getBoardStateFromDatabase(user, boardContext)) });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to update note.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const { taskId, noteId } = await context.params;
  const user = await requireTaskboardUserFromHeaders(request);
  const boardContext = getBoardContextFromRequest(request);

  try {
    await deleteTaskNote(user, taskId, noteId, boardContext);
    return NextResponse.json({ ok: true, ...(await getBoardStateFromDatabase(user, boardContext)) });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to delete note.");
  }
}
