import { NextRequest, NextResponse } from "next/server";

import { boardRouteErrorResponse, getBoardContextFromRequest } from "@/lib/board-route";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import {
  softDeleteNativeCalendarEntry,
  updateNativeCalendarEntry,
} from "@/lib/taskboard-store";

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
    expectedUpdatedAt?: string;
    title?: string;
    startAt?: string;
    endAt?: string;
    allDay?: boolean;
    location?: string;
    description?: string;
    color?: string;
  };

  if (
    typeof body.expectedUpdatedAt !== "string" ||
    typeof body.title !== "string" ||
    typeof body.startAt !== "string" ||
    typeof body.endAt !== "string" ||
    typeof body.allDay !== "boolean" ||
    typeof body.color !== "string"
  ) {
    return NextResponse.json(
      { error: "expectedUpdatedAt, title, startAt, endAt, allDay, and color are required." },
      { status: 400 },
    );
  }

  const user = await requireTaskboardUserFromHeaders(request);
  const boardContext = getBoardContextFromRequest(request, body);

  try {
    const calendarEntry = await updateNativeCalendarEntry(user, entryId, {
      expectedUpdatedAt: body.expectedUpdatedAt,
      title: body.title,
      startAt: body.startAt,
      endAt: body.endAt,
      allDay: body.allDay,
      location: body.location,
      description: body.description,
      color: body.color,
    }, boardContext);

    return NextResponse.json({ ok: true, calendarEntry });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to update calendar entry.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const { entryId } = await context.params;
  const body = (await request.json().catch(() => ({}))) as {
    boardId?: string;
    expectedUpdatedAt?: string;
  };

  if (typeof body.expectedUpdatedAt !== "string") {
    return NextResponse.json(
      { error: "expectedUpdatedAt is required." },
      { status: 400 },
    );
  }

  const user = await requireTaskboardUserFromHeaders(request);
  const boardContext = getBoardContextFromRequest(request, body);

  try {
    const result = await softDeleteNativeCalendarEntry(user, entryId, {
      expectedUpdatedAt: body.expectedUpdatedAt,
    }, boardContext);

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to delete calendar entry.");
  }
}
