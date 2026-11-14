import { NextRequest, NextResponse } from "next/server";
import { explicitBoardIdErrorResponse } from "@/lib/board-route";
import { isDatabaseConfigured } from "@/lib/db";
import { getTaskNotifications } from "@/lib/taskboard-store";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";

export async function GET(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const user = await requireTaskboardUserFromHeaders(request);

  try {
    const boardIdError = explicitBoardIdErrorResponse(request);
    if (boardIdError) {
      return boardIdError;
    }

    const notifications = await getTaskNotifications(user);
    return NextResponse.json(notifications);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to load notifications." },
      { status: 400 },
    );
  }
}
