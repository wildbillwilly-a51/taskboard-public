import { NextRequest, NextResponse } from "next/server";
import { boardRouteErrorResponse, getBoardContextFromRequest } from "@/lib/board-route";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { getBoardStateFromDatabase, reorderBuckets } from "@/lib/taskboard-store";

export async function POST(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const body = (await request.json()) as {
    boardId?: string;
    bucketIds?: unknown;
  };
  const boardContext = getBoardContextFromRequest(request, body);
  const user = await requireTaskboardUserFromHeaders(request);

  if (!Array.isArray(body.bucketIds)) {
    return NextResponse.json({ error: "bucketIds must be an array." }, { status: 400 });
  }

  try {
    await reorderBuckets(
      user,
      body.bucketIds.filter((bucketId): bucketId is string => typeof bucketId === "string"),
      boardContext,
    );

    return NextResponse.json({
      ok: true,
      ...(await getBoardStateFromDatabase(user, boardContext)),
    });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to reorder buckets.");
  }
}
