import { NextRequest, NextResponse } from "next/server";
import { TaskboardAuthenticationError } from "@/lib/taskboard-auth-errors";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { createTeam, listTeams } from "@/lib/taskboard-store";

function teamErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to process team request.";
  const status = error instanceof TaskboardAuthenticationError ? error.status :
    message === "Taskboard team creation requires manager or admin access." ||
    message === "Taskboard user is disabled."
      ? 403
      : message === "Active team name is already in use."
        ? 409
        : 400;

  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const user = await requireTaskboardUserFromHeaders(request);
    return NextResponse.json({ teams: await listTeams(user) });
  } catch (error) {
    return teamErrorResponse(error);
  }
}

export async function POST(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const user = await requireTaskboardUserFromHeaders(request);
    const body = (await request.json().catch(() => ({}))) as {
      name?: unknown;
      description?: unknown;
    };
    const team = await createTeam(user, {
      name: body.name,
      description: body.description,
    });

    return NextResponse.json({ ok: true, team });
  } catch (error) {
    return teamErrorResponse(error);
  }
}
