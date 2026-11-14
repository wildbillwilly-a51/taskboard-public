import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { notesRouteErrorResponse, persistenceUnavailableResponse } from "@/lib/notes-route";
import { uploadNoteAttachments } from "@/lib/notes-store";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { maxTaskAttachmentSizeBytes, type TaskAttachmentUploadInput } from "@/lib/taskboard-store";
import {boundedMultipart} from '@/lib/folio-upload-route';

type RouteContext = {
  params: Promise<{
    noteId: string;
  }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return persistenceUnavailableResponse();
  }

  const { noteId } = await context.params;
  const user = await requireTaskboardUserFromHeaders(request);

  try {
    const formData = await boundedMultipart(request,51*1024*1024);
    const files = formData.getAll("files").filter((value): value is File => value instanceof File);
    if(files.length>10||files.reduce((n,f)=>n+f.size,0)>50*1024*1024)return NextResponse.json({error:'Choose up to 10 files totaling no more than 50 MB.'},{status:400});

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

    const attachments = await uploadNoteAttachments(user, noteId, uploads);
    return NextResponse.json({ ok: true, attachments });
  } catch (error) {
    return notesRouteErrorResponse(error, "Unable to upload attachments.");
  }
}
