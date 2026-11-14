import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import {
  notesRouteErrorResponse,
  persistenceUnavailableResponse,
  readNotesJsonBody,
} from "@/lib/notes-route";
import { createNotebook, listNotebooks } from "@/lib/notes-store";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";

export async function GET(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return persistenceUnavailableResponse();
  }

  const user = await requireTaskboardUserFromHeaders(request);

  try {
    return NextResponse.json({ ok: true, ...(await listNotebooks(user)) });
  } catch (error) {
    return notesRouteErrorResponse(error, "Unable to load notebooks.");
  }
}

export async function POST(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return persistenceUnavailableResponse();
  }

  const user = await requireTaskboardUserFromHeaders(request);

  try {
    const body = await readNotesJsonBody(request);
    const notebook = await createNotebook(user, {
      title: body.title,
      parentNotebookId: body.parentNotebookId,
    });

    return NextResponse.json({ ok: true, notebook, ...(await listNotebooks(user)) });
  } catch (error) {
    return notesRouteErrorResponse(error, "Unable to create notebook.");
  }
}
