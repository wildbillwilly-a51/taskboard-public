import { NextResponse } from "next/server";
import { TaskboardAuthenticationError } from "@/lib/taskboard-auth-errors";
import { BoardAccessError } from "@/lib/board-access";
import { NoteConflictError, NotesNotFoundError, WikiRuleError } from "@/lib/notes-errors";
import { maxNoteContentJsonBytes, maxNoteMarkdownLength, maxNoteTextLength } from "@/lib/notes-model";

// Leave room for JSON escaping while bounding raw input, including chunked
// requests. Semantic content limits are checked separately, as in Notes.
export const maxNotesRequestBodyBytes = maxNoteContentJsonBytes + 6 * (maxNoteMarkdownLength + maxNoteTextLength) + 65_536;
export class RouteJsonError extends Error {}

export async function readRouteJsonBody(request: Request): Promise<Record<string, unknown>> {
  const length = request.headers.get("content-length");
  if (length && Number(length) > maxNotesRequestBodyBytes) throw new RouteJsonError("The request body is too large.");
  const reader = request.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (reader) {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > maxNotesRequestBodyBytes) {
          await reader.cancel();
          throw new RouteJsonError("The request body is too large.");
        }
        chunks.push(value);
      }
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    const body: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
    if (!body || typeof body !== "object" || Array.isArray(body)) throw new RouteJsonError("The request body must be a JSON object.");
    return body as Record<string, unknown>;
  } catch (error) {
    if (error instanceof RouteJsonError) throw error;
    throw new RouteJsonError("The request body must be JSON.");
  } finally {
    reader?.releaseLock();
  }
}

export function wikiJson(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "private, no-store" } });
}

export function wikiUnavailableResponse(message = "Wiki is temporarily unavailable. Please retry.") {
  return wikiJson({ error: message, code: "wiki_temporarily_unavailable" }, 503);
}

// Codes identify infrastructure failures, never permissions. Pool acquisition
// errors have no code in pg; match only its known messages, never expose them.
export function isWikiTransientError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { code, message } = error as { code?: string; message?: string };
  return typeof code === "string" && (code.startsWith("08") || [
    "40001", "40P01", "53300", "53400", "55P03", "57014", "57P01", "57P02", "57P03",
    "ECONNREFUSED", "ECONNRESET", "ETIMEDOUT", "EPIPE", "ENETUNREACH", "EHOSTUNREACH", "EAI_AGAIN",
  ].includes(code)) || [
    "timeout exceeded when trying to connect", "Connection terminated due to connection timeout",
    "Connection terminated unexpectedly", "Connection terminated",
  ].includes(message ?? "");
}

export function wikiRouteErrorResponse(error: unknown) {
  if (error instanceof TaskboardAuthenticationError) return wikiJson({ error: error.code === "account_disabled" ? "This account is disabled." : "Sign in to continue.", code: error.code }, error.status);
  if (error instanceof NoteConflictError) {
    return wikiJson({ error: error.message, code: "note_conflict", currentVersion: error.currentVersion }, 409);
  }
  if (error instanceof NotesNotFoundError || error instanceof WikiRuleError && error.status === 404) {
    return wikiJson({ error: "Wiki resource not found.", code: "wiki_not_found" }, 404);
  }
  if (error instanceof WikiRuleError) {
    return wikiJson({ error: error.message, code: error.code }, error.status);
  }
  if (error instanceof BoardAccessError) {
    if (error.status === 404 || error.code === "board_not_found") {
      return wikiJson({ error: "Wiki resource not found.", code: "wiki_not_found" }, 404);
    }
    if (error.code === "note_attachment_unavailable") {
      return wikiJson({ error: "A required attachment is unavailable.", code: error.code }, 409);
    }
    if (error.status === 403) {
      return wikiJson({ error: "This wiki is read-only for this action.", code: "wiki_read_only" }, 403);
    }
    return wikiJson({ error: "Invalid wiki request.", code: "invalid_wiki_request" }, 400);
  }
  if (error instanceof RouteJsonError) {
    return wikiJson({ error: error.message, code: "invalid_wiki_request" }, 400);
  }
  if (isWikiTransientError(error)) return wikiUnavailableResponse();
  return wikiJson({ error: "Unable to complete the wiki request.", code: undefined }, 500);
}

export function invalidWikiRequest(message: string): never {
  throw new WikiRuleError("invalid_wiki_request", message, 400);
}

export async function assertWikiEmptyBody(request: Request) {
  // The Node adapter supplies an IncomingMessage stream even for a DELETE
  // with no bytes. Stream presence is not evidence of a body payload.
  const reader = request.body?.getReader();
  if (!reader) return;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return;
      if (value.byteLength) {
        await reader.cancel();
        invalidWikiRequest("Space deletion does not accept a body.");
      }
    }
  } finally { reader.releaseLock(); }
}

export function assertWikiFields(body: Record<string, unknown>, allowed: readonly string[], required: readonly string[] = []) {
  if (Object.keys(body).some((key) => !allowed.includes(key))) invalidWikiRequest("Unknown or immutable request field.");
  if (required.some((key) => !Object.hasOwn(body, key))) invalidWikiRequest("A required request field is missing.");
}

export async function readWikiBody(request: Request, allowed: readonly string[], required: readonly string[] = []) {
  const body = await readRouteJsonBody(request);
  assertWikiFields(body, allowed, required);
  return body;
}
