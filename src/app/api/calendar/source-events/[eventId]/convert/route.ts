import { NextRequest, NextResponse } from "next/server";

import { BoardAccessError } from "@/lib/board-access";
import { explicitBoardIdErrorResponse } from "@/lib/board-route";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import {
  CalendarSourceConversionError,
  convertPersonalBoardImportedCalendarEventToTask,
  type CalendarSourceConversionScope,
} from "@/lib/taskboard-store";

type RouteContext = {
  params: Promise<{
    eventId: string;
  }>;
};

async function readConversionBody(request: NextRequest) {
  const body = await request.json().catch(() => null) as {
    boardId?: unknown;
    bucketId?: unknown;
    scope?: unknown;
  } | null;

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false as const, body: null };
  }

  const keys = Object.keys(body);
  const scope = body.scope;
  const bucketId = typeof body.bucketId === "string" ? body.bucketId.trim() : "";
  const ok =
    keys.every((key) => key === "bucketId" || key === "scope") &&
    Boolean(bucketId) &&
    (scope === "occurrence" || scope === "series");

  if (!ok) {
    return { ok: false as const, body };
  }

  return {
    ok: true as const,
    body,
    bucketId,
    scope: scope as CalendarSourceConversionScope,
  };
}

export async function POST(request: NextRequest, context: RouteContext) {
  const parsedBody = await readConversionBody(request);
  const explicitBoardIdError = explicitBoardIdErrorResponse(
    request,
    parsedBody.body ?? undefined,
  );

  if (explicitBoardIdError) {
    return explicitBoardIdError;
  }

  if (!parsedBody.ok) {
    return NextResponse.json(
      { error: "Provide a destination bucketId and an occurrence or series scope." },
      { status: 400 },
    );
  }

  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const { eventId } = await context.params;
    const user = await requireTaskboardUserFromHeaders(request);
    const result = await convertPersonalBoardImportedCalendarEventToTask(user, eventId, {
      bucketId: parsedBody.bucketId,
      scope: parsedBody.scope,
    });

    return NextResponse.json({
      ok: true,
      taskId: result.taskId,
      alreadyConverted: result.alreadyConverted,
      sourceEventId: result.sourceEventId,
    });
  } catch (error) {
    if (error instanceof BoardAccessError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    if (error instanceof CalendarSourceConversionError) {
      return NextResponse.json(
        { error: error.message },
        { status: error.status },
      );
    }

    if (error instanceof Error && error.message.includes("requires forwarded user identity")) {
      return NextResponse.json(
        { error: "Authentication is required." },
        { status: 401 },
      );
    }

    if (error instanceof Error && error.message.includes("user is disabled")) {
      return NextResponse.json(
        { error: "Taskboard user is disabled." },
        { status: 403 },
      );
    }

    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unable to convert calendar source event." },
      { status: 400 },
    );
  }
}
