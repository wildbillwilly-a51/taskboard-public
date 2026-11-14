import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import {
  addTeamBoardMemberGrant,
  listTeamBoardMemberGrants,
} from "@/lib/taskboard-store";

type RouteContext = {
  params: Promise<{
    teamId: string;
    boardId: string;
  }>;
};

function teamBoardMemberGrantErrorResponse(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Unable to process team board member grants.";
  const status =
    message === "Team not found." ||
    message === "Team board not found." ||
    message === "User not found."
      ? 404
      : message === "Team access is required." ||
          message === "Team management access is required." ||
          message === "Team board access is required." ||
          message === "Taskboard user is disabled."
        ? 403
        : message === "Board member grant already exists."
          ? 409
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
    return NextResponse.json(await listTeamBoardMemberGrants(user, teamId, boardId));
  } catch (error) {
    return teamBoardMemberGrantErrorResponse(error);
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
    const { teamId, boardId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      userId?: string;
      role?: unknown;
    };
    const grant = await addTeamBoardMemberGrant(user, teamId, boardId, {
      userId: body.userId ?? "",
      role: body.role,
    });

    return NextResponse.json({ ok: true, grant });
  } catch (error) {
    return teamBoardMemberGrantErrorResponse(error);
  }
}
