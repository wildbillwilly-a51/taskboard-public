import { NextRequest, NextResponse } from "next/server";
import { BoardAccessError } from "@/lib/board-access";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { listPersonalBoardMemberCandidates } from "@/lib/taskboard-store";

type RouteContext = {
  params: Promise<{
    boardId: string;
  }>;
};

function personalBoardMemberCandidateErrorResponse(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Unable to search personal board member candidates.";
  const status =
    error instanceof BoardAccessError
      ? error.status
      : message === "Board not found."
        ? 404
        : message === "Personal board sharing access is required." ||
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
    const { boardId } = await context.params;
    const q = request.nextUrl.searchParams.get("q") ?? "";

    return NextResponse.json({
      candidates: await listPersonalBoardMemberCandidates(user, boardId, q),
    });
  } catch (error) {
    return personalBoardMemberCandidateErrorResponse(error);
  }
}
