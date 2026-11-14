import { NextRequest, NextResponse } from "next/server";
import { BoardAccessError } from "@/lib/board-access";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import {
  removePersonalBoardMember,
  updatePersonalBoardMember,
} from "@/lib/taskboard-store";

type RouteContext = {
  params: Promise<{
    boardId: string;
    userId: string;
  }>;
};

function personalBoardMemberErrorResponse(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Unable to process personal board member.";
  const status =
    error instanceof BoardAccessError
      ? error.status
      : message === "Board not found." || message === "Board member grant not found."
        ? 404
        : message === "Personal board sharing access is required." ||
            message === "Taskboard user is disabled."
          ? 403
          : 400;

  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const user = await requireTaskboardUserFromHeaders(request);
    const { boardId, userId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      role?: unknown;
    };
    const member = await updatePersonalBoardMember(user, boardId, userId, {
      role: body.role,
    });

    return NextResponse.json({ ok: true, member });
  } catch (error) {
    return personalBoardMemberErrorResponse(error);
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const user = await requireTaskboardUserFromHeaders(request);
    const { boardId, userId } = await context.params;
    return NextResponse.json(await removePersonalBoardMember(user, boardId, userId));
  } catch (error) {
    return personalBoardMemberErrorResponse(error);
  }
}
