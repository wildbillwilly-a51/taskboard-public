import { NextResponse } from "next/server";
import { TaskboardAuthenticationError } from "@/lib/taskboard-auth-errors";
import { boardRouteErrorResponse } from "@/lib/board-route";
import { NoteConflictError, NotesNotFoundError, WikiRuleError } from "@/lib/notes-errors";
import { subtaskRuleDatabaseError } from "@/lib/subtask-rule";
import { isWikiTransientError, readRouteJsonBody, RouteJsonError, wikiRouteErrorResponse, wikiUnavailableResponse } from "@/lib/wiki-route";

export function persistenceUnavailableResponse() {
  return NextResponse.json(
    { error: "Persistence is temporarily unavailable." },
    { status: 503, headers: { "Cache-Control": "private, no-store" } },
  );
}

export function notesRouteErrorResponse(error: unknown, fallbackMessage: string) {
  const privateJson = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
  if (error instanceof WikiRuleError || error instanceof TaskboardAuthenticationError) return wikiRouteErrorResponse(error);
  if (isWikiTransientError(error)) return wikiUnavailableResponse("Persistence is temporarily unavailable. Please retry.");
  if (error instanceof RouteJsonError) return privateJson({ error: error.message }, 400);
  if (error instanceof NoteConflictError) {
    return privateJson(
      { error: error.message, code: "note_conflict", currentVersion: error.currentVersion },
      409,
    );
  }

  if (error instanceof NotesNotFoundError) {
    return privateJson({ error: error.message }, 404);
  }

  // Preserve legacy Notes validation errors, but never echo raw SQL errors.
  error = subtaskRuleDatabaseError(error) ?? error;
  if (error && typeof error === "object" && "severity" in error) {
    return privateJson({ error: fallbackMessage }, 500);
  }
  const response = boardRouteErrorResponse(error, fallbackMessage);
  response.headers.set("Cache-Control", "private, no-store");
  return response;
}

export { RouteJsonError as NotesRequestError };

export const readNotesJsonBody = readRouteJsonBody;

export function assertNotesRequestFields(body: Record<string, unknown>, allowed: readonly string[]) {
  if (Object.keys(body).some((key) => !allowed.includes(key))) {
    throw new WikiRuleError("invalid_wiki_request", "Unknown or unsupported Notes request field.", 400);
  }
}

export function permanentNoteDeleteOption(params: URLSearchParams) {
  const values = params.getAll("permanent");
  if (values.length > 1 || values.length === 1 && values[0] !== "1") {
    throw new WikiRuleError("invalid_wiki_request", "permanent must be 1 when supplied.", 400);
  }
  return values.length === 1;
}
