import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { removeTeamMember, updateTeamMember } from "@/lib/taskboard-store";

type RouteContext = {
  params: Promise<{
    teamId: string;
    userId: string;
  }>;
};

function teamMemberErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to process team member.";
  const status =
    message === "Team not found." || message === "Team member not found."
      ? 404
      : message === "Team member management access is required." ||
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
    const { teamId, userId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      role?: unknown;
    };
    const member = await updateTeamMember(user, teamId, userId, {
      role: body.role,
    });

    return NextResponse.json({ ok: true, member });
  } catch (error) {
    return teamMemberErrorResponse(error);
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
    const { teamId, userId } = await context.params;
    return NextResponse.json(await removeTeamMember(user, teamId, userId));
  } catch (error) {
    return teamMemberErrorResponse(error);
  }
}
