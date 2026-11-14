import { NextRequest, NextResponse } from "next/server";
import { boardRouteErrorResponse, getBoardContextFromRequest } from "@/lib/board-route";
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
  const user = await requireTaskboardUserFromHeaders(request);
  const boardContext = getBoardContextFromRequest(request);
  const dispositionParam = request.nextUrl.searchParams.get("disposition");
  const disposition = dispositionParam === "inline" ? "inline" : "attachment";

  try {
    const attachment = await getTaskAttachmentDownload(user, taskId, attachmentId, boardContext);
    const content = new ReadableStream({
      start(controller) {
        controller.enqueue(attachment.content);
        controller.close();
      },
    });

    return new NextResponse(content, {
      headers: {
        "Content-Type": attachment.mimeType || "application/octet-stream",
        "Content-Length": String(attachment.sizeBytes),
        "Content-Disposition": `${disposition}; filename*=UTF-8''${encodeURIComponent(attachment.displayName)}`,
        "Cache-Control": "private, no-store",
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
  const user = await requireTaskboardUserFromHeaders(request);

  try {
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
  const user = await requireTaskboardUserFromHeaders(request);
  const boardContext = getBoardContextFromRequest(request);

  try {
    await deleteTaskAttachment(user, taskId, attachmentId, boardContext);
    return NextResponse.json({ ok: true, ...(await getBoardStateFromDatabase(user, boardContext)) });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to delete attachment.");
  }
}
