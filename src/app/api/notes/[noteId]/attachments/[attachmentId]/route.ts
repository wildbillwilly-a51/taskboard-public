import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { notesRouteErrorResponse, persistenceUnavailableResponse, permanentNoteDeleteOption } from "@/lib/notes-route";
import { deleteNoteAttachment, getNoteAttachmentDownload } from "@/lib/notes-store";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import {safeInlineNoteMedia} from '@/lib/folio-file-preview';
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    noteId: string;
    attachmentId: string;
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return persistenceUnavailableResponse();
  }

  const { noteId, attachmentId } = await context.params;
  const user = await requireTaskboardUserFromHeaders(request);
  const disposition = request.nextUrl.searchParams.get("disposition") === "inline" ? "inline" : "attachment";

  try {
    const attachment = await getNoteAttachmentDownload(user, noteId, attachmentId);
    const safeDisposition=disposition==='inline'&&safeInlineNoteMedia(attachment.mimeType,attachment.content)?'inline':'attachment';
    const content = new ReadableStream({
      start(controller) {
        controller.enqueue(attachment.content);
        controller.close();
      },
    });

    return new NextResponse(content, {
      headers: {
        "Content-Type": safeDisposition==='inline'?attachment.mimeType:'application/octet-stream',
        "Content-Length": String(attachment.sizeBytes),
        "Content-Disposition": `${safeDisposition}; filename*=UTF-8''${encodeURIComponent(attachment.displayName)}`,
        "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'self'",
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return notesRouteErrorResponse(error, "Unable to download attachment.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return persistenceUnavailableResponse();
  }

  const { noteId, attachmentId } = await context.params;
  const user = await requireTaskboardUserFromHeaders(request);

  try {
    await deleteNoteAttachment(user, noteId, attachmentId, { permanent: permanentNoteDeleteOption(request.nextUrl.searchParams) });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return notesRouteErrorResponse(error, "Unable to delete attachment.");
  }
}
