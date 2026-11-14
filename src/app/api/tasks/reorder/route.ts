import { NextRequest, NextResponse } from "next/server";
import { boardRouteErrorResponse, getBoardContextFromRequest } from "@/lib/board-route";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { moveRootTask } from "@/lib/taskboard-store";

export async function POST(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const body = (await request.json()) as {
    boardId?: string;
    taskId?: string;
    targetBucketId?: string;
    targetIndex?: number;
  };
  const boardContext = getBoardContextFromRequest(request, body);
  const user = await requireTaskboardUserFromHeaders(request);

  if (!body.taskId || !body.targetBucketId || typeof body.targetIndex !== "number") {
    return NextResponse.json(
      { error: "taskId, targetBucketId, and targetIndex are required." },
      { status: 400 },
    );
  }

  try {
    await moveRootTask({
      user,
      taskId: body.taskId,
      targetBucketId: body.targetBucketId,
      targetIndex: body.targetIndex,
      boardId: boardContext.boardId,
    });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to reorder task.");
  }

  return NextResponse.json({ ok: true });
}
