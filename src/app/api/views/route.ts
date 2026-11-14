import { NextRequest, NextResponse } from "next/server";
import { boardRouteErrorResponse, getBoardContextFromRequest } from "@/lib/board-route";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { createViewPreset, getBoardStateFromDatabase } from "@/lib/taskboard-store";
import type { ViewFilters, ViewLayoutMode } from "@/lib/taskboard-data";

export async function POST(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const body = (await request.json()) as {
    name?: string;
    layoutMode?: ViewLayoutMode;
    filters?: ViewFilters;
    boardId?: string;
  };
  const user = await requireTaskboardUserFromHeaders(request);
  const boardContext = getBoardContextFromRequest(request, body);

  try {
    const viewId = await createViewPreset(
      user,
      {
        name: body.name ?? "",
        layoutMode: body.layoutMode ?? "board",
        filters: body.filters ?? {},
      },
      boardContext,
    );

    return NextResponse.json({
      ok: true,
      viewId,
      ...(await getBoardStateFromDatabase(user, boardContext)),
    });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to create view.");
  }
}
