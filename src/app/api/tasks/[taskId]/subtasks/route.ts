import { NextRequest, NextResponse } from "next/server";
import { boardRouteErrorResponse, getBoardContextFromRequest } from "@/lib/board-route";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { createSubtask, getBoardStateFromDatabase } from "@/lib/taskboard-store";
import { SubtaskRuleError } from "@/lib/subtask-rule";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

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
    title?: string;
  };
  const boardContext = getBoardContextFromRequest(request, body);
  const title = body.title?.trim();

  // A new subtask has a title and nothing else; say so rather than drop
  // anything sent with it.
  if (Object.keys(body).some((key) => key !== "boardId" && key !== "title")) {
    return boardRouteErrorResponse(new SubtaskRuleError(), "Unable to create subtask.");
  }

  if (!title) {
    return NextResponse.json({ error: "title is required." }, { status: 400 });
  }

  try {
    const subtaskId = await createSubtask(user, {
      parentTaskId: taskId,
      title,
    }, boardContext);

    return NextResponse.json({
      ok: true,
      subtaskId,
      ...(await getBoardStateFromDatabase(user, boardContext)),
    });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to create subtask.");
  }
}
