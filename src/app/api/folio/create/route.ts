import { NextRequest, NextResponse } from "next/server";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { readNotesJsonBody, notesRouteErrorResponse } from "@/lib/notes-route";
import { createTemplateNote } from "@/lib/folio-template-store";
export const runtime = "nodejs";
export async function POST(r: NextRequest) {
  try {
    return NextResponse.json(
      {
        note: await createTemplateNote(
          await requireTaskboardUserFromHeaders(r),
          await readNotesJsonBody(r),
        ),
      },
      { headers: { "Cache-Control": "private, no-store" } },
    );
  } catch (e) {
    return notesRouteErrorResponse(e, "Unable to create this note.");
  }
}
