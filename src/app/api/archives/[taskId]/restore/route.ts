import { NextRequest, NextResponse } from "next/server";
import { boardRouteErrorResponse, getBoardContextFromRequest } from "@/lib/board-route";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import {
  getArchiveItems,
  getBoardStateFromDatabase,
  restoreArchiveItem,
} from "@/lib/taskboard-store";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const { taskId } = await context.params;

  try {
    const user = await requireTaskboardUserFromHeaders(request);
    const boardContext = getBoardContextFromRequest(request);
    const restoredTaskId = await restoreArchiveItem(user, taskId, boardContext);

    return NextResponse.json({
      ok: true,
      taskId: restoredTaskId,
      ...(await getBoardStateFromDatabase(user, boardContext)),
      archives: await getArchiveItems(user, boardContext),
    });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to restore archive item.");
  }
}
