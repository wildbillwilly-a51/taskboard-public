import { NextRequest, NextResponse } from "next/server";
import { explicitBoardIdErrorResponse } from "@/lib/board-route";
import { isDatabaseConfigured } from "@/lib/db";
import { updateTaskNotification } from "@/lib/taskboard-store";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";

type RouteContext = {
  params: Promise<{
    notificationId: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const { notificationId } = await context.params;
  const user = await requireTaskboardUserFromHeaders(request);
  const body = (await request.json()) as {
    action?: "read" | "dismiss";
    boardId?: unknown;
  };
  const boardIdError = explicitBoardIdErrorResponse(request, body);
  if (boardIdError) {
    return boardIdError;
  }

  if (body.action !== "read" && body.action !== "dismiss") {
    return NextResponse.json(
      { error: "Provide action = read or dismiss." },
      { status: 400 },
    );
  }

  try {
    await updateTaskNotification(user, notificationId, body.action);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update notification." },
      { status: 400 },
    );
  }
}
