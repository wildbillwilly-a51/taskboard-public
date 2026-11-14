import { NextRequest, NextResponse } from "next/server";
import { boardRouteErrorResponse, getBoardContextFromRequest } from "@/lib/board-route";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import {
  deleteViewPreset,
  getBoardStateFromDatabase,
  updateViewPreset,
} from "@/lib/taskboard-store";
import type { ViewFilters, ViewLayoutMode } from "@/lib/taskboard-data";

type RouteContext = {
  params: Promise<{
    viewId: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const { viewId } = await context.params;
  const user = await requireTaskboardUserFromHeaders(request);
  const body = (await request.json()) as {
    name?: string;
    layoutMode?: ViewLayoutMode;
    filters?: ViewFilters;
    hiddenFields?: string[];
    displayOptions?: Record<string, boolean | string | number>;
    boardId?: string;
  };
  const boardContext = getBoardContextFromRequest(request, body);

  try {
    await updateViewPreset(user, viewId, body, boardContext);
    return NextResponse.json({ ok: true, ...(await getBoardStateFromDatabase(user, boardContext)) });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to update view.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const { viewId } = await context.params;
  const user = await requireTaskboardUserFromHeaders(request);
  const boardContext = getBoardContextFromRequest(request);

  try {
    await deleteViewPreset(user, viewId, boardContext);
    return NextResponse.json({ ok: true, ...(await getBoardStateFromDatabase(user, boardContext)) });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to delete view.");
  }
}
