import { NextRequest, NextResponse } from "next/server";

import { boardRouteErrorResponse, getBoardContextFromRequest } from "@/lib/board-route";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import type { CalendarTaskScheduleScope } from "@/lib/calendar-resize";
import { updateCalendarTaskSchedule } from "@/lib/taskboard-store";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const { taskId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    boardId?: string;
    expectedStartAt?: string;
    expectedEndAt?: string;
    startAt?: string;
    endAt?: string;
    scope?: CalendarTaskScheduleScope;
  };

  if (
    typeof body.expectedStartAt !== "string" ||
    typeof body.expectedEndAt !== "string" ||
    typeof body.startAt !== "string" ||
    typeof body.endAt !== "string" ||
    (body.scope !== "single" && body.scope !== "series")
  ) {
    return NextResponse.json(
      { error: "expectedStartAt, expectedEndAt, startAt, endAt, and scope are required." },
      { status: 400 },
    );
  }

  const user = await requireTaskboardUserFromHeaders(request);
  const boardContext = getBoardContextFromRequest(request, body);

  try {
    const updates = await updateCalendarTaskSchedule(user, taskId, {
      expectedStartAt: body.expectedStartAt,
      expectedEndAt: body.expectedEndAt,
      startAt: body.startAt,
      endAt: body.endAt,
      scope: body.scope,
    }, boardContext);

    return NextResponse.json({ ok: true, scope: body.scope, updates });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to resize calendar task.");
  }
}
