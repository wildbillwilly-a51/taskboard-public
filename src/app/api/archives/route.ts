import { NextRequest, NextResponse } from "next/server";
import { boardRouteErrorResponse, getBoardContextFromRequest } from "@/lib/board-route";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { getArchiveItems } from "@/lib/taskboard-store";

export async function GET(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const user = await requireTaskboardUserFromHeaders(request);
    const boardContext = getBoardContextFromRequest(request);
    return NextResponse.json({ items: await getArchiveItems(user, boardContext) });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to load archives.");
  }
}
