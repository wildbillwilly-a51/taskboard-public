import type { TaskboardUserRole } from "@/lib/auth";
import { isUuid } from "@/lib/uuid";

export type PersonalBoardVisibilitySetting = "private" | "team_visible";

export type BoardPrivacyActor = {
  id?: string;
  role?: TaskboardUserRole;
  isDisabled?: boolean;
};

export type BoardPrivacyBoard = {
  id: string;
  boardType: "personal" | "team";
  ownerUserId: string | null;
  personalVisibility: PersonalBoardVisibilitySetting;
  personalVisibilityTeamId: string | null;
};

export type BoardPrivacySettingsInput = {
  personalVisibility: PersonalBoardVisibilitySetting;
  personalVisibilityTeamId: string | null;
};

export type BoardPrivacyAuditEventDraft = {
  action: "board.privacy_changed";
  previousValues: {
    personalVisibility: PersonalBoardVisibilitySetting;
    personalVisibilityTeamId: string | null;
  };
  newValues: {
    personalVisibility: PersonalBoardVisibilitySetting;
    personalVisibilityTeamId: string | null;
  };
};

export type BoardPrivacySettingsTeam = {
  id: string;
  name: string;
  personalBoardViewEnabled: boolean;
};

export type BoardPrivacyGateStatus = {
  envGate: "enabled" | "not_enabled";
  globalSettingEnabled: boolean;
  selectedTeamPolicyEnabled: boolean | null;
  ownerInSelectedTeam: boolean | null;
  boardMarkedTeamVisible: boolean;
  effectiveVisibleToTeammates: boolean;
  reason: string;
};

export type BoardPrivacySettingsResponse = {
  board: {
    id: string;
    title: string;
    boardType: "personal";
    ownerUserId: string;
    personalVisibility: PersonalBoardVisibilitySetting;
    personalVisibilityTeamId: string | null;
    personalVisibilityTeamName: string | null;
  };
  eligibleTeams: BoardPrivacySettingsTeam[];
  gates: BoardPrivacyGateStatus;
  impactPreview: {
    affectedUsers: number;
  } | null;
};

const validVisibility = new Set<PersonalBoardVisibilitySetting>([
  "private",
  "team_visible",
]);

export function canViewBoardPrivacySettings(
  actor: BoardPrivacyActor,
  board: BoardPrivacyBoard,
) {
  if (!actor.id || actor.isDisabled) {
    return false;
  }

  return board.boardType === "personal" && board.ownerUserId === actor.id;
}

export function canPatchBoardPrivacySettings(args: {
  actor: BoardPrivacyActor;
  board: BoardPrivacyBoard;
  usersCanMakeBoardsPrivate: boolean;
}) {
  if (!canViewBoardPrivacySettings(args.actor, args.board)) {
    return false;
  }

  if (args.actor.role === "admin") {
    return true;
  }

  return args.usersCanMakeBoardsPrivate;
}

export function parseBoardPrivacySettingsPatchBody(
  body: unknown,
): BoardPrivacySettingsInput {
  if (!body || Array.isArray(body) || typeof body !== "object") {
    throw new Error("Request body must include personalVisibility and personalVisibilityTeamId.");
  }

  const input = body as Record<string, unknown>;
  const keys = Object.keys(input);
  const allowedKeys = new Set(["personalVisibility", "personalVisibilityTeamId"]);

  for (const key of keys) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Unknown board privacy setting: ${key}.`);
    }
  }

  if (!validVisibility.has(input.personalVisibility as PersonalBoardVisibilitySetting)) {
    throw new Error("personalVisibility must be private or team_visible.");
  }

  const personalVisibility =
    input.personalVisibility as PersonalBoardVisibilitySetting;
  const personalVisibilityTeamId = input.personalVisibilityTeamId;

  if (personalVisibility === "private") {
    if (
      personalVisibilityTeamId !== undefined &&
      personalVisibilityTeamId !== null &&
      personalVisibilityTeamId !== "" &&
      (typeof personalVisibilityTeamId !== "string" ||
        !isUuid(personalVisibilityTeamId.trim()))
    ) {
      throw new Error("personalVisibilityTeamId must be a valid UUID.");
    }

    return {
      personalVisibility,
      personalVisibilityTeamId: null,
    };
  }

  if (typeof personalVisibilityTeamId !== "string" || !personalVisibilityTeamId.trim()) {
    throw new Error("team_visible boards require personalVisibilityTeamId.");
  }

  const trimmedTeamId = personalVisibilityTeamId.trim();

  if (!isUuid(trimmedTeamId)) {
    throw new Error("personalVisibilityTeamId must be a valid UUID.");
  }

  return {
    personalVisibility,
    personalVisibilityTeamId: trimmedTeamId,
  };
}

export function evaluateBoardPrivacySettingsUpdate(args: {
  actor: BoardPrivacyActor;
  board: BoardPrivacyBoard;
  usersCanMakeBoardsPrivate: boolean;
  eligibleTeamIds: Set<string>;
  input: BoardPrivacySettingsInput;
}) {
  if (args.board.boardType !== "personal") {
    throw new Error("Board settings are available only for personal boards.");
  }

  if (!canPatchBoardPrivacySettings(args)) {
    throw new Error("Taskboard board privacy access is required.");
  }

  if (
    args.input.personalVisibility === "team_visible" &&
    (!args.input.personalVisibilityTeamId ||
      !args.eligibleTeamIds.has(args.input.personalVisibilityTeamId))
  ) {
    throw new Error("Selected team is not eligible for this personal board.");
  }

  const previousValues = {
    personalVisibility: args.board.personalVisibility,
    personalVisibilityTeamId: args.board.personalVisibilityTeamId,
  };
  const newValues = {
    personalVisibility: args.input.personalVisibility,
    personalVisibilityTeamId:
      args.input.personalVisibility === "private"
        ? null
        : args.input.personalVisibilityTeamId,
  };
  const changed =
    previousValues.personalVisibility !== newValues.personalVisibility ||
    previousValues.personalVisibilityTeamId !== newValues.personalVisibilityTeamId;
  const auditEvents: BoardPrivacyAuditEventDraft[] = changed
    ? [
        {
          action: "board.privacy_changed",
          previousValues,
          newValues,
        },
      ]
    : [];

  return {
    changed,
    settings: newValues,
    auditEvents,
  };
}

export function buildBoardPrivacyGateStatus(args: {
  envGate: "enabled" | "not_enabled";
  globalSettingEnabled: boolean;
  boardMarkedTeamVisible: boolean;
  selectedTeamPolicyEnabled: boolean | null;
  ownerInSelectedTeam: boolean | null;
}): BoardPrivacyGateStatus {
  const effectiveVisibleToTeammates =
    args.envGate === "enabled" &&
    args.globalSettingEnabled &&
    args.boardMarkedTeamVisible &&
    args.selectedTeamPolicyEnabled === true &&
    args.ownerInSelectedTeam === true;
  let reason = "Visible read-only to active members of the selected team.";

  if (!args.boardMarkedTeamVisible) {
    reason = "Not visible to teammates because this board is private.";
  } else if (args.envGate !== "enabled") {
    reason = "Not visible to teammates because the runtime env gate is off.";
  } else if (!args.globalSettingEnabled) {
    reason = "Not visible to teammates because the global permission setting is off.";
  } else if (args.ownerInSelectedTeam !== true) {
    reason = "Not visible to teammates because the board owner is not an active member of the selected team.";
  } else if (args.selectedTeamPolicyEnabled !== true) {
    reason = "Not visible to teammates because the selected team policy is off.";
  }

  return {
    ...args,
    effectiveVisibleToTeammates,
    reason,
  };
}
