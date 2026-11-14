import { NextRequest, NextResponse } from "next/server";
import { boardRouteErrorResponse } from "@/lib/board-route";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { getLiveStateForUser } from "@/lib/taskboard-store";

// Polled by open pages (use-live-board-revision.ts): the shown board's
// revision, the board list's token (and the list when it changed), and on
// request the Notes token. Read-only. A board the viewer can no longer open
// is reported in its channel; the other channels still answer.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  try {
    const user = await requireTaskboardUserFromHeaders(request);
    const state = await getLiveStateForUser(user, {
      boardId: params.get("boardId"),
      boardsToken: params.get("boards"),
      notes: params.get("notes") === "1",
    });

    if (!state) {
      return NextResponse.json({ error: "Persistence is unavailable." }, { status: 503 });
    }

    return NextResponse.json(state, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to check for changes.");
  }
}
