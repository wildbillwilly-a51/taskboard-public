import { NextRequest, NextResponse } from "next/server";
import { parseAdminAuditEventFilters } from "@/lib/admin-audit-policy";
import { isDatabaseConfigured } from "@/lib/db";
import { requireAdminTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { listAdminAuditEvents } from "@/lib/taskboard-store";

function adminAuditErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to load audit events.";
  const status = message === "Taskboard admin access is required." ? 403 : 400;
  return NextResponse.json({ error: message }, { status });
}

export async function GET(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const admin = await requireAdminTaskboardUserFromHeaders(request);
    const filters = parseAdminAuditEventFilters(request.nextUrl.searchParams);
    return NextResponse.json(await listAdminAuditEvents(admin, filters));
  } catch (error) {
    return adminAuditErrorResponse(error);
  }
}
