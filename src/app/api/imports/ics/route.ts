import { NextRequest, NextResponse } from "next/server";
import { explicitBoardIdErrorResponse } from "@/lib/board-route";
import { parseIcsEvents } from "@/lib/ics-import";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import {
  getBoardFromDatabase,
  importIcsEvents,
} from "@/lib/taskboard-store";

const maxIcsFileBytes = 2 * 1024 * 1024;

export async function POST(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const user = await requireTaskboardUserFromHeaders(request);
  const formData = await request.formData();
  if (request.nextUrl.searchParams.has("boardId") || formData.has("boardId")) {
    return (
      explicitBoardIdErrorResponse(request, { boardId: formData.get("boardId") }) ??
      NextResponse.json(
        { error: "Explicit boardId is not supported for this route yet." },
        { status: 400 },
      )
    );
  }

  const file = formData.get("file");
  const fromDateValue = formData.get("fromDate");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "An .ics file is required." }, { status: 400 });
  }

  if (!file.name.toLowerCase().endsWith(".ics")) {
    return NextResponse.json({ error: "Only .ics files can be imported." }, { status: 400 });
  }

  if (file.size > maxIcsFileBytes) {
    return NextResponse.json({ error: "The .ics file must be 2 MB or smaller." }, { status: 400 });
  }

  const fromDate = parseImportFromDate(typeof fromDateValue === "string" ? fromDateValue : null);

  if (!fromDate) {
    return NextResponse.json({ error: "fromDate must be a valid date." }, { status: 400 });
  }

  try {
    const parsed = parseIcsEvents(await file.text(), fromDate);
    const importResult = await importIcsEvents(user, {
      fileName: file.name,
      events: parsed.events,
    });

    return NextResponse.json({
      ok: true,
      created: importResult.created,
      updated: importResult.updated,
      skippedPast: parsed.skippedPast,
      skippedRecurring: parsed.skippedRecurring,
      skippedUnsupported: parsed.skippedUnsupported,
      errors: parsed.errors,
      bucketId: importResult.bucketId,
      board: await getBoardFromDatabase(user),
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The .ics file could not be imported.",
      },
      { status: 400 },
    );
  }
}

function parseImportFromDate(value: string | null) {
  if (!value) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
