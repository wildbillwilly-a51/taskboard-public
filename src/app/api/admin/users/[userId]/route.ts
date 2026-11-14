import { NextRequest, NextResponse } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { requireAdminTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { updateAdminUser } from "@/lib/taskboard-store";
import type { TaskboardUserRole } from "@/lib/auth";

type RouteContext = {
  params: Promise<{
    userId: string;
  }>;
};

function adminUserErrorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : "Unable to update user.";
  const status = message === "Taskboard admin access is required." ? 403 : 400;
  return NextResponse.json({ error: message }, { status });
}

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const admin = await requireAdminTaskboardUserFromHeaders(request);
    const { userId } = await context.params;
    const body = (await request.json().catch(() => ({}))) as {
      role?: TaskboardUserRole;
      isDisabled?: boolean;
    };
    const user = await updateAdminUser(admin, userId, {
      role: body.role,
      isDisabled: body.isDisabled,
    });

    return NextResponse.json({ ok: true, user });
  } catch (error) {
    return adminUserErrorResponse(error);
  }
}
