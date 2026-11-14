import { NextRequest, NextResponse } from "next/server";
import { boardRouteErrorResponse, getBoardContextFromRequest } from "@/lib/board-route";
import { verifiedPreview } from "@/lib/public-task-share-content";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import {
  deleteTaskAttachment,
  getBoardStateFromDatabase,
  getTaskAttachmentDownload,
  updateTaskAttachmentDisplayName,
} from "@/lib/taskboard-store";

type RouteContext = {
  params: Promise<{
    taskId: string;
    attachmentId: string;
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const { taskId, attachmentId } = await context.params;
  const boardContext = getBoardContextFromRequest(request);
  const dispositionParam = request.nextUrl.searchParams.get("disposition");

  try {
    const user = await requireTaskboardUserFromHeaders(request);
    const attachment = await getTaskAttachmentDownload(user, taskId, attachmentId, boardContext);
    const inline = dispositionParam === "inline" && verifiedPreview(attachment.mimeType, attachment.content) !== "none";
    const disposition = inline ? "inline" : "attachment";
    const content = new ReadableStream({
      start(controller) {
        controller.enqueue(attachment.content);
        controller.close();
      },
    });

    return new NextResponse(content, {
      headers: {
        "Content-Type": inline ? attachment.mimeType : "application/octet-stream",
        "Content-Length": String(attachment.content.byteLength),
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(attachment.displayName)}`,
        "Cache-Control": "private, no-store",
        "Content-Security-Policy": "sandbox; default-src 'none'; frame-ancestors 'self'",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to download attachment.");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const { taskId, attachmentId } = await context.params;

  try {
    const user = await requireTaskboardUserFromHeaders(request);
    const body = (await request.json()) as { boardId?: string; displayName?: unknown };
    const boardContext = getBoardContextFromRequest(request, body);
    if (typeof body.displayName !== "string") {
      throw new Error("displayName is required.");
    }

    await updateTaskAttachmentDisplayName(user, taskId, attachmentId, body.displayName, boardContext);
    return NextResponse.json({ ok: true, ...(await getBoardStateFromDatabase(user, boardContext)) });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to rename attachment.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const { taskId, attachmentId } = await context.params;
  const boardContext = getBoardContextFromRequest(request);

  try {
    const user = await requireTaskboardUserFromHeaders(request);
    await deleteTaskAttachment(user, taskId, attachmentId, boardContext);
    return NextResponse.json({ ok: true, ...(await getBoardStateFromDatabase(user, boardContext)) });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to delete attachment.");
  }
}
