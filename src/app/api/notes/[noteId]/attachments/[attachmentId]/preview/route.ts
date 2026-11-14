import { NextRequest, NextResponse } from "next/server";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { getNoteAttachmentDownload } from "@/lib/notes-store";
import { notesRouteErrorResponse } from "@/lib/notes-route";
import { safeFilePreview } from "@/lib/folio-file-preview";
export const runtime = "nodejs";
export async function GET(
  r: NextRequest,
  c: { params: Promise<{ noteId: string; attachmentId: string }> },
) {
  try {
    const { noteId, attachmentId } = await c.params,
      file = await getNoteAttachmentDownload(
        await requireTaskboardUserFromHeaders(r),
        noteId,
        attachmentId,
      ),
      preview = safeFilePreview(file.displayName, file.mimeType, file.content);
    if (r.nextUrl.searchParams.get("metadata") === "1")
      return NextResponse.json(
        {
          kind: preview.kind,
          ...(preview.kind === "text"
            ? { text: new TextDecoder().decode(file.content) }
            : {}),
        },
        { headers: { "Cache-Control": "private, no-store" } },
      );
    if (!["image", "pdf"].includes(preview.kind))
      return new NextResponse(null, { status: 415 });
    return new NextResponse(new Uint8Array(file.content), {
      headers: {
        "Content-Type": preview.mime,
        "Content-Disposition":
          "inline; filename*=UTF-8''" + encodeURIComponent(file.displayName),
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy":
          "sandbox; default-src 'none'; frame-ancestors 'self'",
      },
    });
  } catch (e) {
    return notesRouteErrorResponse(e, "Unable to preview this file.");
  }
}
