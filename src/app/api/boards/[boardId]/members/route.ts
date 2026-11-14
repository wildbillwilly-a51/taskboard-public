import { NextRequest, NextResponse } from "next/server";
import { BoardAccessError } from "@/lib/board-access";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import {
  addPersonalBoardMember,
  listPersonalBoardMembers,
} from "@/lib/taskboard-store";

type RouteContext = {
  params: Promise<{
    boardId: string;
  }>;
};

function personalBoardMemberErrorResponse(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Unable to process personal board members.";
  const status =
    error instanceof BoardAccessError
      ? error.status
      : message === "Board not found." ||
          message === "User not found." ||
          message === "Board member grant not found."
        ? 404
        : message === "Personal board sharing access is required." ||
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
    const { boardId } = await context.params;
    return NextResponse.json(await listPersonalBoardMembers(user, boardId));
  } catch (error) {
    return personalBoardMemberErrorResponse(error);
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
    const { boardId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      userId?: string;
      role?: unknown;
    };
    const member = await addPersonalBoardMember(user, boardId, {
      userId: body.userId ?? "",
      role: body.role,
    });

    return NextResponse.json({ ok: true, member });
  } catch (error) {
    return personalBoardMemberErrorResponse(error);
  }
}
