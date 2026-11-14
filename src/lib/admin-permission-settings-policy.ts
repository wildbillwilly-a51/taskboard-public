import type { TaskboardUserRole } from "@/lib/auth";
import { assertAdminActor } from "@/lib/admin-user-policy";

export type PersonalBoardVisibilitySetting = "private" | "team_visible";

export type AdminPermissionSettingsActor = {
  id?: string;
  role?: TaskboardUserRole;
  isDisabled?: boolean;
};

export type AdminPermissionSettings = {
  sameTeamPersonalBoardVisibilityAllowed: boolean;
  defaultPersonalBoardVisibility: PersonalBoardVisibilitySetting;
  managersCanConfigureTeamPersonalBoardVisibility: boolean;
  usersCanMakeBoardsPrivate: boolean;
  adminsCanViewPrivateBoards: boolean;
  updatedAt?: string;
};

export type AdminPermissionSettingsPatchInput = Partial<
  Omit<AdminPermissionSettings, "updatedAt">
>;

export type AdminPermissionSettingsAuditEventDraft = {
  action: "app.permission_settings.changed";
  previousValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
};

const allowedPatchKeys = new Set([
  "sameTeamPersonalBoardVisibilityAllowed",
  "defaultPersonalBoardVisibility",
  "managersCanConfigureTeamPersonalBoardVisibility",
  "usersCanMakeBoardsPrivate",
  "adminsCanViewPrivateBoards",
]);
const validPersonalBoardVisibility = new Set<PersonalBoardVisibilitySetting>([
  "private",
  "team_visible",
]);

function assertBoolean(value: unknown, key: string): asserts value is boolean {
  if (typeof value !== "boolean") {
    throw new Error(`${key} must be a boolean.`);
  }
}

function assertDefaultPersonalBoardVisibility(
  value: unknown,
): asserts value is PersonalBoardVisibilitySetting {
  if (typeof value !== "string" || !validPersonalBoardVisibility.has(value as PersonalBoardVisibilitySetting)) {
    throw new Error("defaultPersonalBoardVisibility must be private or team_visible.");
  }
}

export function parseAdminPermissionSettingsPatchBody(
  body: unknown,
): AdminPermissionSettingsPatchInput {
  if (!body || Array.isArray(body) || typeof body !== "object") {
    throw new Error("Request body must be a JSON object.");
  }

  const input = body as Record<string, unknown>;
  const keys = Object.keys(input);

  for (const key of keys) {
    if (!allowedPatchKeys.has(key)) {
      throw new Error(`Unknown permission setting: ${key}.`);
    }
  }

  const parsed: AdminPermissionSettingsPatchInput = {};

  if ("sameTeamPersonalBoardVisibilityAllowed" in input) {
    assertBoolean(
      input.sameTeamPersonalBoardVisibilityAllowed,
      "sameTeamPersonalBoardVisibilityAllowed",
    );
    parsed.sameTeamPersonalBoardVisibilityAllowed =
      input.sameTeamPersonalBoardVisibilityAllowed;
  }

  if ("defaultPersonalBoardVisibility" in input) {
    assertDefaultPersonalBoardVisibility(input.defaultPersonalBoardVisibility);
    parsed.defaultPersonalBoardVisibility = input.defaultPersonalBoardVisibility;
  }

  if ("managersCanConfigureTeamPersonalBoardVisibility" in input) {
    assertBoolean(
      input.managersCanConfigureTeamPersonalBoardVisibility,
      "managersCanConfigureTeamPersonalBoardVisibility",
    );
    parsed.managersCanConfigureTeamPersonalBoardVisibility =
      input.managersCanConfigureTeamPersonalBoardVisibility;
  }

  if ("usersCanMakeBoardsPrivate" in input) {
    assertBoolean(input.usersCanMakeBoardsPrivate, "usersCanMakeBoardsPrivate");
    parsed.usersCanMakeBoardsPrivate = input.usersCanMakeBoardsPrivate;
  }

  if ("adminsCanViewPrivateBoards" in input) {
    assertBoolean(input.adminsCanViewPrivateBoards, "adminsCanViewPrivateBoards");
    parsed.adminsCanViewPrivateBoards = input.adminsCanViewPrivateBoards;
  }

  return parsed;
}

export function evaluateAdminPermissionSettingsUpdate(
  actor: AdminPermissionSettingsActor,
  current: AdminPermissionSettings,
  input: AdminPermissionSettingsPatchInput,
) {
  assertAdminActor(actor);

  const next: AdminPermissionSettings = {
    ...current,
    ...input,
  };
  const previousValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};

  for (const key of allowedPatchKeys) {
    const settingKey = key as keyof AdminPermissionSettingsPatchInput;
    if (input[settingKey] !== undefined && input[settingKey] !== current[settingKey]) {
      previousValues[settingKey] = current[settingKey];
      newValues[settingKey] = input[settingKey];
    }
  }

  const auditEvents: AdminPermissionSettingsAuditEventDraft[] =
    Object.keys(newValues).length > 0
      ? [
          {
            action: "app.permission_settings.changed",
            previousValues,
            newValues,
          },
        ]
      : [];

  return {
    settings: next,
    auditEvents,
  };
}
