import { NextRequest, NextResponse } from "next/server";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import {
  readNotesJsonBody,
  assertNotesRequestFields,
  notesRouteErrorResponse,
} from "@/lib/notes-route";
import { manageFolioShares } from "@/lib/folio-share-store";
import type { FolioShareMode } from "@/lib/folio-features-model";
export const runtime = "nodejs";
export async function GET(r: NextRequest) {
  try {
    return NextResponse.json(
      await manageFolioShares(
        await requireTaskboardUserFromHeaders(r),
        r.nextUrl.searchParams.get("noteId") ?? "",
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return notesRouteErrorResponse(e, "Unable to load sharing.");
  }
}
export async function POST(r: NextRequest) {
  try {
    const user = await requireTaskboardUserFromHeaders(r),
      b = await readNotesJsonBody(r);
    assertNotesRequestFields(b, ["noteId", "action", "mode"]);
    if (typeof b.noteId !== "string" || typeof b.action !== "string")
      throw Error("Choose a note and sharing action.");
    return NextResponse.json(
      await manageFolioShares(
        user,
        b.noteId,
        b.action,
        b.mode as FolioShareMode,
      ),
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return notesRouteErrorResponse(e, "Unable to change sharing.");
  }
}
