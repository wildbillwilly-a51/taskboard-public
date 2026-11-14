import { NextRequest, NextResponse } from "next/server";
import { boardRouteErrorResponse, getBoardContextFromRequest } from "@/lib/board-route";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import {
  createRootTask,
  getBoardStateFromDatabase,
} from "@/lib/taskboard-store";

export async function POST(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const body = (await request.json()) as {
    boardId?: string;
    bucketId?: string;
    title?: string;
    workItemType?: "task" | "maintenance_outage";
    timeZone?: unknown;
  };
  const boardContext = getBoardContextFromRequest(request, body);

  const title = body.title?.trim();

  if (!body.bucketId || !title) {
    return NextResponse.json(
      { error: "bucketId and title are required." },
      { status: 400 },
    );
  }

  if (body.workItemType && body.workItemType !== "task" && body.workItemType !== "maintenance_outage") {
    return NextResponse.json({ error: "workItemType is invalid." }, { status: 400 });
  }

  try {
    const user = await requireTaskboardUserFromHeaders(request);
    const taskId = await createRootTask(user, {
      bucketId: body.bucketId,
      title,
      workItemType: body.workItemType ?? "task",
      timeZone: typeof body.timeZone === "string" ? body.timeZone.slice(0, 64) : undefined,
    }, boardContext);

    return NextResponse.json({
      ok: true,
      taskId,
      ...(await getBoardStateFromDatabase(user, boardContext)),
    });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to create task.");
  }
}
