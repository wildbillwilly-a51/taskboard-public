import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { boardRouteErrorResponse } from "@/lib/board-route";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { saveSelectedBoardPreference } from "@/lib/taskboard-store";

export async function PUT(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const user = await requireTaskboardUserFromHeaders(request);
    const body = (await request.json()) as { boardId?: unknown };

    if (!Object.prototype.hasOwnProperty.call(body, "boardId")) {
      return NextResponse.json(
        { error: "boardId must be a UUID string or null." },
        { status: 400 },
      );
    }

    if (body.boardId !== null && typeof body.boardId !== "string") {
      return NextResponse.json(
        { error: "boardId must be a UUID string or null." },
        { status: 400 },
      );
    }

    return NextResponse.json(await saveSelectedBoardPreference(user, body.boardId));
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to save selected board.");
  }
}
