import { NextRequest, NextResponse } from "next/server";
import { boardRouteErrorResponse, getBoardContextFromFormData } from "@/lib/board-route";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import {
  getBoardStateFromDatabase,
  maxTaskAttachmentSizeBytes,
  uploadTaskAttachments,
  type TaskAttachmentUploadInput,
} from "@/lib/taskboard-store";

type RouteContext = {
  params: Promise<{
    taskId: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const { taskId } = await context.params;
  const user = await requireTaskboardUserFromHeaders(request);

  try {
    const formData = await request.formData();
    const boardContext = getBoardContextFromFormData(request, formData);
    const files = formData
      .getAll("files")
      .filter((value): value is File => value instanceof File);

    if (files.length === 0) {
      return NextResponse.json({ error: "Select at least one file." }, { status: 400 });
    }

    const uploads: TaskAttachmentUploadInput[] = [];

    for (const file of files) {
      if (!file.name.trim()) {
        return NextResponse.json({ error: "Each attachment must have a filename." }, { status: 400 });
      }

      if (file.size > maxTaskAttachmentSizeBytes) {
        return NextResponse.json(
          { error: `"${file.name}" exceeds the 25 MB per-file limit.` },
          { status: 400 },
        );
      }

      uploads.push({
        originalName: file.name,
        mimeType: file.type || "application/octet-stream",
        sizeBytes: file.size,
        buffer: new Uint8Array(await file.arrayBuffer()),
      });
    }

    await uploadTaskAttachments(user, taskId, uploads, boardContext);

    return NextResponse.json({ ok: true, ...(await getBoardStateFromDatabase(user, boardContext)) });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to upload attachments.");
  }
}
