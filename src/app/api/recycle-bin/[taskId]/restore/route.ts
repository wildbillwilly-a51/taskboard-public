import { NextRequest, NextResponse } from "next/server";
import { boardRouteErrorResponse, getBoardContextFromRequest } from "@/lib/board-route";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import {
  getBoardStateFromDatabase,
  getRecycleBinItems,
  restoreRecycleBinItem,
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
    const restoredTaskId = await restoreRecycleBinItem(user, taskId, boardContext);

    return NextResponse.json({
      ok: true,
      taskId: restoredTaskId,
      ...(await getBoardStateFromDatabase(user, boardContext)),
      recycleBin: await getRecycleBinItems(user, boardContext),
    });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to restore recycle-bin item.");
  }
}
