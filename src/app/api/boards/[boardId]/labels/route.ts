import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { notesRouteErrorResponse, persistenceUnavailableResponse } from "@/lib/notes-route";
import { listBoardLabels } from "@/lib/notes-store";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";

type RouteContext = {
  params: Promise<{
    boardId: string;
  }>;
};

// The board's label names (read-only). Labels are still created by saving a
// task or note with a new label.
export async function GET(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return persistenceUnavailableResponse();
  }

  const { boardId } = await context.params;
  const user = await requireTaskboardUserFromHeaders(request);

  try {
    return NextResponse.json({ ok: true, labels: await listBoardLabels(user, boardId) });
  } catch (error) {
    return notesRouteErrorResponse(error, "Unable to load labels.");
  }
}
