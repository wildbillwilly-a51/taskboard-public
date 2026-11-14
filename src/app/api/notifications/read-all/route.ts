import { NextRequest, NextResponse } from "next/server";
import { explicitBoardIdErrorResponse } from "@/lib/board-route";
import { isDatabaseConfigured } from "@/lib/db";
import { markAllTaskNotificationsRead } from "@/lib/taskboard-store";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";

export async function POST(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const user = await requireTaskboardUserFromHeaders(request);
  const body = (await request.json().catch(() => null)) as { boardId?: unknown } | null;
  const boardIdError = explicitBoardIdErrorResponse(request, body ?? undefined);
  if (boardIdError) {
    return boardIdError;
  }

  try {
    await markAllTaskNotificationsRead(user);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to update notifications." },
      { status: 400 },
    );
  }
}
