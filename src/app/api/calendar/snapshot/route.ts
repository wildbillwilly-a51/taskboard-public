import { NextRequest, NextResponse } from "next/server";
import { boardRouteErrorResponse } from "@/lib/board-route";
import { mapImportedCalendarSourceEvents } from "@/lib/calendar-source-events";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { getCalendarSnapshotForUser } from "@/lib/taskboard-store";

// The calendar data for one board, loaded by open pages when the board's
// revision moved: native entries and, with imported=1, the person's imported
// Imported events. The revision tells the page what the data covers.
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const boardId = params.get("boardId");

  if (!boardId) {
    return NextResponse.json({ error: "boardId is required." }, { status: 400 });
  }

  try {
    const user = await requireTaskboardUserFromHeaders(request);
    const snapshot = await getCalendarSnapshotForUser(user, boardId, { imported: params.get("imported") === "1" });

    if (!snapshot) {
      return NextResponse.json({ error: "Persistence is unavailable." }, { status: 503 });
    }

    return NextResponse.json(
      {
        boardId: snapshot.boardId,
        revision: snapshot.revision,
        calendarEntries: snapshot.calendarEntries,
        sourceEvents: mapImportedCalendarSourceEvents(snapshot.importedRows),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to load the calendar.");
  }
}
