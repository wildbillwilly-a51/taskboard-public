import { NextRequest, NextResponse } from "next/server";
import { explicitBoardIdErrorResponse } from "@/lib/board-route";
import { normalizeBulkTaskImportSubmission } from "@/lib/bulk-task-import";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import {
  bulkImportNativeTasks,
  getBoardFromDatabase,
} from "@/lib/taskboard-store";

export async function POST(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const user = await requireTaskboardUserFromHeaders(request);

  try {
    const body = (await request.json()) as unknown;
    const boardIdError =
      body && typeof body === "object"
        ? explicitBoardIdErrorResponse(request, body as { boardId?: unknown })
        : explicitBoardIdErrorResponse(request);
    if (boardIdError) {
      return boardIdError;
    }

    const { submission, warnings } = normalizeBulkTaskImportSubmission(body);
    const importResult = await bulkImportNativeTasks(user, submission);

    return NextResponse.json({
      ok: true,
      createdTaskCount: importResult.createdTaskCount,
      createdBucketCount: importResult.createdBucketCount,
      warnings: [...warnings, ...importResult.warnings],
      board: await getBoardFromDatabase(user),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Bulk task import could not be completed.",
      },
      { status: 400 },
    );
  }
}
