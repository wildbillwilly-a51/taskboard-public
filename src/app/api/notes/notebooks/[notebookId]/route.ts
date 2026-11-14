import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import {
  notesRouteErrorResponse,
  persistenceUnavailableResponse,
  readNotesJsonBody,
} from "@/lib/notes-route";
import { deleteNotebook, listNotebooks, updateNotebook } from "@/lib/notes-store";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";

type RouteContext = {
  params: Promise<{
    notebookId: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return persistenceUnavailableResponse();
  }

  const { notebookId } = await context.params;
  const user = await requireTaskboardUserFromHeaders(request);

  try {
    const body = await readNotesJsonBody(request);
    await updateNotebook(user, notebookId, {
      title: body.title,
      parentNotebookId: body.parentNotebookId,
      sortOrder: body.sortOrder,
    });

    return NextResponse.json({ ok: true, ...(await listNotebooks(user)) });
  } catch (error) {
    return notesRouteErrorResponse(error, "Unable to update notebook.");
  }
}

// Deletes the notebook only; its notes and child notebooks move up a level.
export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return persistenceUnavailableResponse();
  }

  const { notebookId } = await context.params;
  const user = await requireTaskboardUserFromHeaders(request);

  try {
    await deleteNotebook(user, notebookId);
    return NextResponse.json({ ok: true, ...(await listNotebooks(user)) });
  } catch (error) {
    return notesRouteErrorResponse(error, "Unable to delete notebook.");
  }
}
