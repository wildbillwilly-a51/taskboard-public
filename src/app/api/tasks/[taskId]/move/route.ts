import { NextRequest, NextResponse } from "next/server";
import { boardRouteErrorResponse, getBoardContextFromRequest } from "@/lib/board-route";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { getBoardStateFromDatabase, moveSubtask } from "@/lib/taskboard-store";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

// Moves a subtask to a new parent and position within its own task.
export async function POST(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const { taskId } = await context.params;
  const user = await requireTaskboardUserFromHeaders(request);
  const body = (await request.json()) as {
    boardId?: string;
    parentTaskId?: string;
    targetIndex?: number;
  };
  const boardContext = getBoardContextFromRequest(request, body);

  if (!body.parentTaskId || typeof body.targetIndex !== "number") {
    return NextResponse.json({ error: "parentTaskId and targetIndex are required." }, { status: 400 });
  }

  try {
    await moveSubtask(user, { taskId, parentTaskId: body.parentTaskId, targetIndex: body.targetIndex }, boardContext);

    return NextResponse.json({
      ok: true,
      taskId,
      ...(await getBoardStateFromDatabase(user, boardContext)),
    });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to move subtask.");
  }
}
