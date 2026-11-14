import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { listTeamMemberCandidates } from "@/lib/taskboard-store";

type RouteContext = {
  params: Promise<{
    teamId: string;
  }>;
};

function teamMemberCandidateErrorResponse(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Unable to search team member candidates.";
  const status =
    message === "Team not found."
      ? 404
      : message === "Team member management access is required." ||
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
    const q = request.nextUrl.searchParams.get("q") ?? "";

    return NextResponse.json({
      candidates: await listTeamMemberCandidates(user, teamId, q),
    });
  } catch (error) {
    return teamMemberCandidateErrorResponse(error);
  }
}
