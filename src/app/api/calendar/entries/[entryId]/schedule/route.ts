import { NextRequest, NextResponse } from "next/server";

import { boardRouteErrorResponse, getBoardContextFromRequest } from "@/lib/board-route";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { updateNativeCalendarEntrySchedule } from "@/lib/taskboard-store";

type RouteContext = {
  params: Promise<{
    entryId: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const { entryId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    boardId?: string;
    expectedStartAt?: string;
    expectedEndAt?: string;
    startAt?: string;
    endAt?: string;
  };

  if (
    typeof body.expectedStartAt !== "string" ||
    typeof body.expectedEndAt !== "string" ||
    typeof body.startAt !== "string" ||
    typeof body.endAt !== "string"
  ) {
    return NextResponse.json(
      { error: "expectedStartAt, expectedEndAt, startAt, and endAt are required." },
      { status: 400 },
    );
  }

  const user = await requireTaskboardUserFromHeaders(request);
  const boardContext = getBoardContextFromRequest(request, body);

  try {
    const update = await updateNativeCalendarEntrySchedule(user, entryId, {
      expectedStartAt: body.expectedStartAt,
      expectedEndAt: body.expectedEndAt,
      startAt: body.startAt,
      endAt: body.endAt,
    }, boardContext);

    return NextResponse.json({ ok: true, ...update });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to resize calendar entry.");
  }
}
