import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { getTeamBoardDetail, updateTeamBoard } from "@/lib/taskboard-store";

type RouteContext = {
  params: Promise<{
    teamId: string;
    boardId: string;
  }>;
};

function teamBoardErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to process team board.";
  const status =
    message === "Team not found." || message === "Team board not found."
      ? 404
      : message === "Team access is required." ||
          message === "Team management access is required." ||
          message === "Team board access is required." ||
          message === "Taskboard user is disabled."
        ? 403
        : 400;

  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const user = await requireTaskboardUserFromHeaders(request);
    const { teamId, boardId } = await context.params;
    return NextResponse.json({ board: await getTeamBoardDetail(user, teamId, boardId) });
  } catch (error) {
    return teamBoardErrorResponse(error);
  }
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
    const { teamId, boardId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      title?: unknown;
      name?: unknown;
      description?: unknown;
      teamMemberDefaultAccess?: unknown;
      defaultAccess?: unknown;
      team_member_default_access?: unknown;
    };
    const board = await updateTeamBoard(user, teamId, boardId, {
      title: body.title ?? body.name,
      description: body.description,
      teamMemberDefaultAccess:
        body.teamMemberDefaultAccess ?? body.defaultAccess ?? body.team_member_default_access,
    });

    return NextResponse.json({ ok: true, board });
  } catch (error) {
    return teamBoardErrorResponse(error);
  }
}
