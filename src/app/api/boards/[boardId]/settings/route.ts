import { NextRequest, NextResponse } from "next/server";
import { parseBoardPrivacySettingsPatchBody } from "@/lib/board-privacy-policy";
import { BoardAccessError } from "@/lib/board-access";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import {
  getBoardPrivacySettings,
  updateBoardPrivacySettings,
} from "@/lib/taskboard-store";

type RouteContext = {
  params: Promise<{
    boardId: string;
  }>;
};

function boardSettingsErrorResponse(error: unknown) {
  const message =
    error instanceof Error ? error.message : "Unable to process board settings.";
  const status =
    error instanceof BoardAccessError
      ? error.status
      : message === "Board not found."
        ? 404
        : message === "Taskboard board privacy access is required." ||
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

    return NextResponse.json(await getBoardPrivacySettings(user, boardId));
  } catch (error) {
    return boardSettingsErrorResponse(error);
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
    const { boardId } = await context.params;
    const input = parseBoardPrivacySettingsPatchBody(
      await request.json().catch(() => null),
    );
    const result = await updateBoardPrivacySettings(user, boardId, input);

    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return boardSettingsErrorResponse(error);
  }
}
