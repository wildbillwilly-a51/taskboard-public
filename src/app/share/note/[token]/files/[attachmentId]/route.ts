import { NextRequest, NextResponse } from "next/server";
import {
  readSharedFolioFile,
  removeSharedFolioFile,
} from "@/lib/folio-share-store";
import { safeFilePreview, safeInlineNoteMedia } from "@/lib/folio-file-preview";
import { noteShareHeaders } from "@/lib/folio-share-model";
import { notesRouteErrorResponse } from "@/lib/notes-route";
export const runtime = "nodejs";
type C = { params: Promise<{ token: string; attachmentId: string }> };
export async function GET(r: NextRequest, c: C) {
  try {
    const p = await c.params,
      f = await readSharedFolioFile(p.token, p.attachmentId),
      preview = safeFilePreview(f.name, f.mime, f.bytes);
    if (r.nextUrl.searchParams.get("metadata") === "1")
      return NextResponse.json(
        {
          kind: preview.kind,
          ...(preview.kind === "text"
            ? { text: new TextDecoder().decode(f.bytes) }
            : {}),
        },
        { headers: noteShareHeaders },
      );
    const inline =
      r.nextUrl.searchParams.get("preview") === "1" &&
      safeInlineNoteMedia(f.mime, f.bytes);
    return new NextResponse(new Uint8Array(f.bytes), {
      headers: {
        ...noteShareHeaders,
        "Content-Type": inline ? preview.mime : "application/octet-stream",
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(f.name)}`,
        "Content-Security-Policy":
          "sandbox; default-src 'none'; frame-ancestors 'self'",
      },
    });
  } catch (e) {
    return notesRouteErrorResponse(e, "File unavailable.");
  }
}
export async function DELETE(_r: NextRequest, c: C) {
  try {
    const p = await c.params;
    return NextResponse.json(
      await removeSharedFolioFile(
        p.token,
        p.attachmentId,
        Number(_r.nextUrl.searchParams.get("expectedVersion")),
      ),
      { headers: noteShareHeaders },
    );
  } catch (e) {
    return notesRouteErrorResponse(e, "Unable to remove this file.");
  }
}
