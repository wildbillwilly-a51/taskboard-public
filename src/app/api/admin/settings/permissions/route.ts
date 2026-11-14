import { NextRequest, NextResponse } from "next/server";
import { isSameTeamPersonalBoardViewEnabled } from "@/lib/taskboard-config";
import { parseAdminPermissionSettingsPatchBody } from "@/lib/admin-permission-settings-policy";
import { isDatabaseConfigured } from "@/lib/db";
import { requireAdminTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import {
  getAdminPermissionSettings,
  updateAdminPermissionSettings,
} from "@/lib/taskboard-store";

function envGateStatus() {
  return isSameTeamPersonalBoardViewEnabled() ? "enabled" : "not_enabled";
}

function permissionSettingsErrorResponse(error: unknown) {
  const message =
    error instanceof Error
      ? error.message
      : "Unable to process permission settings.";
  const status =
    message === "Taskboard admin access is required." ||
    message === "Taskboard user is disabled."
      ? 403
      : 400;

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
    const settings = await getAdminPermissionSettings(admin);

    return NextResponse.json({
      settings,
      sameTeamPersonalBoardVisibilityEnvGate: envGateStatus(),
    });
  } catch (error) {
    return permissionSettingsErrorResponse(error);
  }
}

export async function PATCH(request: NextRequest) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  try {
    const admin = await requireAdminTaskboardUserFromHeaders(request);
    const input = parseAdminPermissionSettingsPatchBody(
      await request.json().catch(() => null),
    );
    const result = await updateAdminPermissionSettings(admin, input);

    return NextResponse.json({
      ok: true,
      ...result,
      sameTeamPersonalBoardVisibilityEnvGate: envGateStatus(),
    });
  } catch (error) {
    return permissionSettingsErrorResponse(error);
  }
}
