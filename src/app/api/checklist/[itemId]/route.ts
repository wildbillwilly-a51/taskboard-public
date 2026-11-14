import { NextRequest, NextResponse } from "next/server";
import { boardRouteErrorResponse, getBoardContextFromRequest } from "@/lib/board-route";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import {
  deleteChecklistItem,
  getBoardStateFromDatabase,
  updateChecklistItem,
} from "@/lib/taskboard-store";

type RouteContext = {
  params: Promise<{
    itemId: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const { itemId } = await context.params;
  const user = await requireTaskboardUserFromHeaders(request);
  const body = (await request.json()) as {
    boardId?: string;
    label?: string;
    done?: boolean;
  };
  const boardContext = getBoardContextFromRequest(request, body);

  if (typeof body.label !== "string" && typeof body.done !== "boolean") {
    return NextResponse.json(
      { error: "Provide label and/or done." },
      { status: 400 },
    );
  }

  try {
    await updateChecklistItem(user, itemId, {
      label: typeof body.label === "string" ? body.label.trim() : undefined,
      done: body.done,
    }, boardContext);

    return NextResponse.json({ ok: true, ...(await getBoardStateFromDatabase(user, boardContext)) });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to update checklist item.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const { itemId } = await context.params;
  const user = await requireTaskboardUserFromHeaders(request);
  const boardContext = getBoardContextFromRequest(request);

  try {
    await deleteChecklistItem(user, itemId, boardContext);

    return NextResponse.json({ ok: true, ...(await getBoardStateFromDatabase(user, boardContext)) });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to delete checklist item.");
  }
}
