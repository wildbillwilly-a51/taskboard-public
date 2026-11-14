import { NextRequest, NextResponse } from "next/server";
import { boardRouteErrorResponse, getBoardContextFromRequest } from "@/lib/board-route";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { createTaskNote, getBoardStateFromDatabase } from "@/lib/taskboard-store";

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

  try {
    const body = (await request.json()) as { boardId?: string; body?: unknown };
    const boardContext = getBoardContextFromRequest(request, body);
    if (typeof body.body !== "string" || !body.body.trim()) {
      throw new Error("Note text is required.");
    }

    await createTaskNote(user, taskId, body.body, boardContext);
    return NextResponse.json({ ok: true, ...(await getBoardStateFromDatabase(user, boardContext)) });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to create note.");
  }
}
