import { NextRequest, NextResponse } from "next/server";
import { boardRouteErrorResponse } from "@/lib/board-route";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { getBoardRevisionForUser } from "@/lib/taskboard-store";

// Polled by open pages (use-live-board-revision.ts) to learn whether the board
// changed since they loaded it. Returns one number and nothing else.
export async function GET(request: NextRequest) {
  const boardId = request.nextUrl.searchParams.get("boardId");

  if (!boardId) {
    return NextResponse.json({ error: "boardId is required." }, { status: 400 });
  }

  try {
    const user = await requireTaskboardUserFromHeaders(request);
    const revision = await getBoardRevisionForUser(user, boardId);

    if (revision === null) {
      return NextResponse.json({ error: "Persistence is unavailable." }, { status: 503 });
    }

    return NextResponse.json({ revision }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to check the board.");
  }
}
