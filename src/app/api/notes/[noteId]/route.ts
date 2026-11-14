import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import {
  notesRouteErrorResponse,
  persistenceUnavailableResponse,
  readNotesJsonBody,
  assertNotesRequestFields,
  permanentNoteDeleteOption,
} from "@/lib/notes-route";
import { deleteNotePermanently, getNote, trashNote, updateNote } from "@/lib/notes-store";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{
    noteId: string;
  }>;
};

export async function GET(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return persistenceUnavailableResponse();
  }

  const { noteId } = await context.params;
  try {
    const user = await requireTaskboardUserFromHeaders(request);
    return NextResponse.json({ ok: true, note: await getNote(user, noteId) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return notesRouteErrorResponse(error, "Unable to load note.");
  }
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return persistenceUnavailableResponse();
  }

  const { noteId } = await context.params;
  try {
    const user = await requireTaskboardUserFromHeaders(request);
    const body = await readNotesJsonBody(request);
    assertNotesRequestFields(body, ["title", "content", "expectedVersion", "pinned", "archived", "notebookId", "labels", "home", "folioPageState"]);
    // Preserve property presence, including explicit null/no-op home requests,
    // so core can reject the entire mixed edit atomically for a wiki page.
    const note = await updateNote(user, noteId, body);

    return NextResponse.json({ ok: true, note }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return notesRouteErrorResponse(error, "Unable to save note.");
  }
}

// Moves the note to the trash; ?permanent=1 deletes a note already in the trash.
export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return persistenceUnavailableResponse();
  }

  const { noteId } = await context.params;
  try {
    const user = await requireTaskboardUserFromHeaders(request);
    if (permanentNoteDeleteOption(request.nextUrl.searchParams)) {
      await deleteNotePermanently(user, noteId);
    } else {
      await trashNote(user, noteId);
    }

    return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return notesRouteErrorResponse(error, "Unable to delete note.");
  }
}
