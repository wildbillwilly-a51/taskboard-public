import { NextRequest, NextResponse } from "next/server";

import { boardRouteErrorResponse, getBoardContextFromRequest } from "@/lib/board-route";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { createNativeCalendarEntry } from "@/lib/taskboard-store";

export async function POST(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const body = (await request.json()) as {
    boardId?: string;
    title?: string;
    startAt?: string;
    endAt?: string;
    allDay?: boolean;
    location?: string;
    description?: string;
    color?: string;
    bucketId?: string | null;
  };
  const user = await requireTaskboardUserFromHeaders(request);
  const boardContext = getBoardContextFromRequest(request, body);

  if (!body.title?.trim() || !body.startAt || !body.endAt) {
    return NextResponse.json(
      { error: "title, startAt, and endAt are required." },
      { status: 400 },
    );
  }

  try {
    const result = await createNativeCalendarEntry(user, {
      title: body.title,
      startAt: body.startAt,
      endAt: body.endAt,
      allDay: Boolean(body.allDay),
      location: body.location,
      description: body.description,
      color: body.color,
      bucketId: body.bucketId,
    }, boardContext);

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to create calendar entry.");
  }
}
