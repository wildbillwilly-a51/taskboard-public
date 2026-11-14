import { NextRequest, NextResponse } from "next/server";
import { isExternalAuthOnly } from "@/lib/auth";
import { isDatabaseConfigured } from "@/lib/db";
import { requireAdminTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { TaskboardAuthenticationError } from "@/lib/taskboard-auth-errors";
import { createAdminLocalUser, listAdminUsers } from "@/lib/taskboard-store";

function adminUserErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to load users.";
  const status = error instanceof TaskboardAuthenticationError ? error.status
    : message === "Taskboard admin access is required." ? 403 : 400;
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: NextRequest) {
  if (isExternalAuthOnly()) return NextResponse.json({ error: "Local accounts are unavailable in this mode." }, { status: 404 });
  if (!isDatabaseConfigured()) return NextResponse.json({ error: "Persistence is unavailable." }, { status: 503 });
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return NextResponse.json({ error: "Expected a JSON request." }, { status: 415 });
  }
  try {
    const admin = await requireAdminTaskboardUserFromHeaders(request);
    const body = await request.json();
    const user = await createAdminLocalUser(admin, {
      username: body?.username, email: body?.email, displayName: body?.displayName, password: body?.password,
    });
    return NextResponse.json({ ok: true, user }, { status: 201 });
  } catch (error) {
    return adminUserErrorResponse(error);
  }
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
