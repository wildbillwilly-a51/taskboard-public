import { NextRequest, NextResponse } from "next/server";
import { saveSharedFolio } from "@/lib/folio-share-store";
import { readNotesJsonBody, notesRouteErrorResponse } from "@/lib/notes-route";
import {
  noteShareHeaders,
  type PublicFolioSave,
} from "@/lib/folio-share-model";
export const runtime = "nodejs";
export async function POST(
  r: NextRequest,
  c: { params: Promise<{ token: string }> },
) {
  try {
    return NextResponse.json(
      await saveSharedFolio(
        (await c.params).token,
        (await readNotesJsonBody(r)) as unknown as PublicFolioSave,
      ),
      { headers: noteShareHeaders },
    );
  } catch (e) {
    return notesRouteErrorResponse(e, "Unable to save this shared note.");
  }
}
