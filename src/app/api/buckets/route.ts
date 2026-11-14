import { NextRequest, NextResponse } from "next/server";
import { boardRouteErrorResponse, getBoardContextFromRequest } from "@/lib/board-route";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { createBucket, getBoardStateFromDatabase } from "@/lib/taskboard-store";

export async function POST(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const body = (await request.json()) as {
    boardId?: string;
    title?: string;
  };
  const boardContext = getBoardContextFromRequest(request, body);

  const title = body.title?.trim();
  const user = await requireTaskboardUserFromHeaders(request);

  if (!title) {
    return NextResponse.json({ error: "title is required." }, { status: 400 });
  }

  try {
    const bucketId = await createBucket(user, { title }, boardContext);

    return NextResponse.json({
      ok: true,
      bucketId,
      ...(await getBoardStateFromDatabase(user, boardContext)),
    });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to create bucket.");
  }
}
