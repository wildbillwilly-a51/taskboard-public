import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { addTeamMember, listTeamMembers } from "@/lib/taskboard-store";

type RouteContext = {
  params: Promise<{
    teamId: string;
  }>;
};

function teamMemberErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to process team members.";
  const status =
    message === "Team not found." || message === "User not found."
      ? 404
      : message === "Team access is required." ||
          message === "Team member management access is required." ||
          message === "Taskboard user is disabled."
        ? 403
        : message === "User is already a team member."
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
    return NextResponse.json({ members: await listTeamMembers(user, teamId) });
  } catch (error) {
    return teamMemberErrorResponse(error);
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
      userId?: string;
      role?: unknown;
    };
    const member = await addTeamMember(user, teamId, {
      userId: body.userId ?? "",
      role: body.role,
    });

    return NextResponse.json({ ok: true, member });
  } catch (error) {
    return teamMemberErrorResponse(error);
  }
}
