import { NextRequest, NextResponse } from "next/server";
import { withSharedFolioUpload } from "@/lib/folio-share-store";
import { boundedMultipart } from "@/lib/folio-upload-route";
import { notesRouteErrorResponse } from "@/lib/notes-route";
import { noteShareHeaders } from "@/lib/folio-share-model";
export const runtime = "nodejs";
export async function POST(
  r: NextRequest,
  c: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await c.params;
    const length = r.headers.get("content-length"),
      reservation = length === null ? 26 * 1024 * 1024 : Number(length);
    return await withSharedFolioUpload(token, reservation, async (upload) => {
      const form = await boundedMultipart(r, reservation),
        files = form.getAll("files");
      if (files.length !== 1 || !(files[0] instanceof File))
        throw Error("Select one file.");
      const f = files[0];
      if (f.size > 25 * 1024 * 1024) throw Error("File exceeds 25 MB.");
      return NextResponse.json(
        await upload(
          {
            name: f.name,
            type: f.type,
            bytes: new Uint8Array(await f.arrayBuffer()),
          },
          Number(form.get("expectedVersion")),
        ),
        { headers: noteShareHeaders },
      );
    });
  } catch (e) {
    return notesRouteErrorResponse(e, "Unable to attach this file.");
  }
}
