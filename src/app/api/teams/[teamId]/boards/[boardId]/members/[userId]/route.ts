import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import {
  removeTeamBoardMemberGrant,
  updateTeamBoardMemberGrant,
} from "@/lib/taskboard-store";

type RouteContext = {
  params: Promise<{
    teamId: string;
    boardId: string;
    userId: string;
  }>;
};

function teamBoardMemberGrantErrorResponse(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Unable to process team board member grant.";
  const status =
    message === "Team not found." ||
    message === "Team board not found." ||
    message === "Board member grant not found."
      ? 404
      : message === "Team management access is required." ||
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
    const { teamId, boardId, userId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      role?: unknown;
    };
    const grant = await updateTeamBoardMemberGrant(user, teamId, boardId, userId, {
      role: body.role,
    });

    return NextResponse.json({ ok: true, grant });
  } catch (error) {
    return teamBoardMemberGrantErrorResponse(error);
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
    const { teamId, boardId, userId } = await context.params;
    return NextResponse.json(await removeTeamBoardMemberGrant(user, teamId, boardId, userId));
  } catch (error) {
    return teamBoardMemberGrantErrorResponse(error);
  }
}
