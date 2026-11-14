import { NextRequest, NextResponse } from "next/server";
import { boardRouteErrorResponse, getBoardContextFromRequest } from "@/lib/board-route";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import {
  createMaintenanceLocation,
  getBoardStateFromDatabase,
} from "@/lib/taskboard-store";

export async function POST(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const body = (await request.json()) as { boardId?: string; name?: string };
  const name = body.name?.trim();
  if (!name) {
    return NextResponse.json({ error: "name is required." }, { status: 400 });
  }

  const user = await requireTaskboardUserFromHeaders(request);
  const boardContext = getBoardContextFromRequest(request, body);
  try {
    const locationId = await createMaintenanceLocation(user, name, boardContext);
    return NextResponse.json({
      ok: true,
      locationId,
      ...(await getBoardStateFromDatabase(user, boardContext)),
    });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to create maintenance location.");
  }
}
