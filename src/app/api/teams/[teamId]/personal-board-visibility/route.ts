import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import {
  getTeamPersonalBoardVisibilityImpact,
  updateTeamPersonalBoardVisibility,
} from "@/lib/taskboard-store";

type RouteContext = {
  params: Promise<{
    teamId: string;
  }>;
};

function parsePersonalBoardVisibilityBody(body: unknown) {
  if (!body || Array.isArray(body) || typeof body !== "object") {
    throw new Error("Request body must include only enabled.");
  }

  const keys = Object.keys(body);
  if (
    keys.length !== 1 ||
    keys[0] !== "enabled" ||
    typeof (body as { enabled?: unknown }).enabled !== "boolean"
  ) {
    throw new Error("Request body must include only enabled.");
  }

  return body as { enabled: boolean };
}

function teamPersonalBoardVisibilityErrorResponse(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : "Unable to process team personal board visibility.";
  const status =
    message === "Team not found."
      ? 404
      : message === "Taskboard admin access is required." ||
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
    const personalBoardVisibilityImpact = await getTeamPersonalBoardVisibilityImpact(
      user,
      teamId,
    );

    return NextResponse.json({ personalBoardVisibilityImpact });
  } catch (error) {
    return teamPersonalBoardVisibilityErrorResponse(error);
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
    const body = parsePersonalBoardVisibilityBody(await request.json().catch(() => null));
    const result = await updateTeamPersonalBoardVisibility(user, teamId, {
      enabled: body.enabled,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return teamPersonalBoardVisibilityErrorResponse(error);
  }
}
