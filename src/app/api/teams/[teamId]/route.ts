import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { getTeamDetail, updateTeam } from "@/lib/taskboard-store";

type RouteContext = {
  params: Promise<{
    teamId: string;
  }>;
};

function teamErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to process team request.";
  const status =
    message === "Team not found."
      ? 404
      : message === "Team access is required." ||
          message === "Team management access is required." ||
          message === "Taskboard user is disabled."
        ? 403
        : message === "Active team name is already in use."
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
    const { teamId } = await context.params;
    return NextResponse.json({ team: await getTeamDetail(user, teamId) });
  } catch (error) {
    return teamErrorResponse(error);
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
    const { teamId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      name?: unknown;
      description?: unknown;
    };
    const team = await updateTeam(user, teamId, {
      name: body.name,
      description: body.description,
    });

    return NextResponse.json({ ok: true, team });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
