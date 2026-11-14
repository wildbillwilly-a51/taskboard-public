import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { notesRouteErrorResponse, persistenceUnavailableResponse } from "@/lib/notes-route";
import { getBoardNoteCounts } from "@/lib/notes-store";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";

// Active note counts for a board: board-level notes and notes per bucket.
export async function GET(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return persistenceUnavailableResponse();
  }

  const user = await requireTaskboardUserFromHeaders(request);
  const boardId = request.nextUrl.searchParams.get("boardId");

  if (!boardId) {
    return NextResponse.json({ error: "boardId is required." }, { status: 400 });
  }

  try {
    return NextResponse.json({ ok: true, ...(await getBoardNoteCounts(user, boardId)) });
  } catch (error) {
    return notesRouteErrorResponse(error, "Unable to load note counts.");
  }
}
