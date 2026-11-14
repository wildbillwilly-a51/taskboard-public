import { NextRequest, NextResponse } from "next/server";
import { BoardAccessError } from "@/lib/board-access";
import { SubtaskRuleError, subtaskRuleDatabaseError } from "@/lib/subtask-rule";
import type { BoardContextOptions } from "@/lib/taskboard-store";
import { TaskboardAuthenticationError } from "@/lib/taskboard-auth-errors";

const invalidExplicitBoardId = "__invalid_explicit_board_id__";

export function getBoardContextFromRequest(
  request: NextRequest,
  body?: { boardId?: unknown },
): BoardContextOptions {
  if (request.nextUrl.searchParams.has("boardId")) {
    return {
      boardId: request.nextUrl.searchParams.get("boardId") ?? invalidExplicitBoardId,
    };
  }

  if (body && Object.prototype.hasOwnProperty.call(body, "boardId")) {
    return {
      boardId: typeof body.boardId === "string" ? body.boardId : invalidExplicitBoardId,
    };
  }

  return {
    boardId: undefined,
  };
}

export function getBoardContextFromFormData(
  request: NextRequest,
  formData: FormData,
): BoardContextOptions {
  if (request.nextUrl.searchParams.has("boardId")) {
    return {
      boardId: request.nextUrl.searchParams.get("boardId") ?? invalidExplicitBoardId,
    };
  }

  if (formData.has("boardId")) {
    const formBoardId = formData.get("boardId");
    return {
      boardId: typeof formBoardId === "string" ? formBoardId : invalidExplicitBoardId,
    };
  }

  return { boardId: undefined };
}

export function explicitBoardIdErrorResponse(
  request: NextRequest,
  body?: { boardId?: unknown },
) {
  const hasQueryBoardId = request.nextUrl.searchParams.has("boardId");
  const hasBodyBoardId = Boolean(body && Object.prototype.hasOwnProperty.call(body, "boardId"));

  if (!hasQueryBoardId && !hasBodyBoardId) {
    return null;
  }

  return NextResponse.json(
    { error: "Explicit boardId is not supported for this route yet." },
    { status: 400 },
  );
}

export function boardRouteErrorResponse(error: unknown, fallbackMessage: string) {
  if (error instanceof TaskboardAuthenticationError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  // Only a page opened before subtasks were simplified still offers subtask
  // detail, so the fix is to reload it.
  const subtaskRule = error instanceof SubtaskRuleError ? error : subtaskRuleDatabaseError(error);
  if (subtaskRule) {
    return NextResponse.json({ error: `${subtaskRule.message} Reload Taskboard to continue.`, code: "subtask_rule" }, { status: 400 });
  }

  if (error instanceof BoardAccessError) {
    return NextResponse.json(
      { error: error.message },
      { status: error.status },
    );
  }

  return NextResponse.json(
    { error: error instanceof Error ? error.message : fallbackMessage },
    { status: 400 },
  );
}
