import { NextRequest, NextResponse } from "next/server";
import { readSharedFolio } from "@/lib/folio-share-store";
import { notesRouteErrorResponse } from "@/lib/notes-route";
import { noteShareHeaders } from "@/lib/folio-share-model";
export const runtime = "nodejs";
export async function GET(
  _r: NextRequest,
  c: { params: Promise<{ token: string }> },
) {
  try {
    return NextResponse.json(await readSharedFolio((await c.params).token), {
      headers: noteShareHeaders,
    });
  } catch (e) {
    return notesRouteErrorResponse(e, "This shared note is unavailable.");
  }
}
