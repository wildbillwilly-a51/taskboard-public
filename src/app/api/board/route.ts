import { NextRequest, NextResponse } from "next/server";
import { boardRouteErrorResponse, getBoardContextFromRequest } from "@/lib/board-route";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { getBoardStateFromDatabase, loadTaskboardState, updateBoard } from "@/lib/taskboard-store";

export async function GET(request: NextRequest) {
  try {
    const user = await requireTaskboardUserFromHeaders(request);
    const state = await loadTaskboardState(user, getBoardContextFromRequest(request));

    return NextResponse.json(state);
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to load board.");
  }
}

export async function PATCH(request: NextRequest) {
  const user = await requireTaskboardUserFromHeaders(request);
  const body = (await request.json()) as {
    boardId?: string;
    title?: string;
    description?: string;
  };
  const boardContext = getBoardContextFromRequest(request, body);

  try {
    await updateBoard(user, {
      title: typeof body.title === "string" ? body.title : undefined,
      description: typeof body.description === "string" ? body.description : undefined,
    }, boardContext);

    return NextResponse.json({ ok: true, ...(await getBoardStateFromDatabase(user, boardContext)) });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to update board.");
  }
}
