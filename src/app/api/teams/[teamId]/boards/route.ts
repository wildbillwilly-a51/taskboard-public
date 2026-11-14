import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { createTeamBoard, listTeamBoards } from "@/lib/taskboard-store";

type RouteContext = {
  params: Promise<{
    teamId: string;
  }>;
};

function teamBoardErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to process team boards.";
  const status =
    message === "Team not found."
      ? 404
      : message === "Team access is required." ||
          message === "Team management access is required." ||
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
    const { teamId } = await context.params;
    return NextResponse.json({ boards: await listTeamBoards(user, teamId) });
  } catch (error) {
    return teamBoardErrorResponse(error);
  }
}

export async function POST(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const user = await requireTaskboardUserFromHeaders(request);
    const { teamId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      title?: unknown;
      name?: unknown;
      description?: unknown;
      teamMemberDefaultAccess?: unknown;
      defaultAccess?: unknown;
      team_member_default_access?: unknown;
    };
    const board = await createTeamBoard(user, teamId, {
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
