import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { requireAdminTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { listAdminUsers } from "@/lib/taskboard-store";

function adminUserErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to load users.";
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
    return NextResponse.json({ users: await listAdminUsers(admin) });
  } catch (error) {
    return adminUserErrorResponse(error);
  }
}
