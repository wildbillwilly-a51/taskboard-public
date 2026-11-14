import type { TaskboardUserRole } from "@/lib/auth";

export type TeamMemberRole = "manager" | "member";
export type TeamBoardDefaultAccess = "viewer" | "editor";
export type TeamBoardMemberGrantRole = "owner" | "editor" | "viewer";

export type TeamActor = {
  id?: string;
  role?: TaskboardUserRole;
  isDisabled?: boolean;
};

export type TeamAccessContext = {
  actorMembershipRole?: TeamMemberRole | null;
  isArchived?: boolean;
};

export type TeamMetadataInput = {
  name?: unknown;
  description?: unknown;
};

export type TeamPersonalBoardVisibilityInput = {
  enabled?: unknown;
};

export type TeamAuditAction =
  | "team.created"
  | "team.updated"
  | "team.personal_board_view_policy_changed"
  | "team.member.added"
  | "team.member.role_changed"
  | "team.member.removed"
  | "team_board.created"
  | "team_board.updated"
  | "team_board.default_access_changed"
  | "team_board.member_grant.added"
  | "team_board.member_grant.changed"
  | "team_board.member_grant.removed";

export type TeamAuditEventDraft = {
  action: TeamAuditAction;
  previousValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
};

const validTeamMemberRoles = new Set<TeamMemberRole>(["manager", "member"]);
const validTeamBoardDefaultAccess = new Set<TeamBoardDefaultAccess>(["viewer", "editor"]);
const validTeamBoardMemberGrantRoles = new Set<TeamBoardMemberGrantRole>([
  "owner",
  "editor",
  "viewer",
]);

function isActiveActor(actor: TeamActor) {
  return Boolean(actor.id && !actor.isDisabled);
}

export function isValidTeamMemberRole(value: unknown): value is TeamMemberRole {
  return typeof value === "string" && validTeamMemberRoles.has(value as TeamMemberRole);
}

export function isValidTeamBoardDefaultAccess(
  value: unknown,
): value is TeamBoardDefaultAccess {
  return (
    typeof value === "string" &&
    validTeamBoardDefaultAccess.has(value as TeamBoardDefaultAccess)
  );
}

export function isValidTeamBoardMemberGrantRole(
  value: unknown,
): value is TeamBoardMemberGrantRole {
  return (
    typeof value === "string" &&
    validTeamBoardMemberGrantRoles.has(value as TeamBoardMemberGrantRole)
  );
}

export function normalizeTeamName(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("Team name is required.");
  }

  const name = value.trim();

  if (!name) {
    throw new Error("Team name is required.");
  }

  return name;
}

export function normalizeTeamDescription(value: unknown) {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value !== "string") {
    throw new Error("Team description must be a string.");
  }

  return value.trim();
}

export function normalizeTeamBoardTitle(value: unknown) {
  if (typeof value !== "string") {
    throw new Error("Team board title is required.");
  }

  const title = value.trim();

  if (!title) {
    throw new Error("Team board title is required.");
  }

  return title;
}

export function normalizeTeamBoardDescription(value: unknown) {
  return normalizeTeamDescription(value);
}

export function normalizeTeamBoardDefaultAccess(value: unknown): TeamBoardDefaultAccess {
  if (value === undefined || value === null || value === "") {
    return "viewer";
  }

  if (!isValidTeamBoardDefaultAccess(value)) {
    throw new Error("Team board default access must be viewer or editor.");
  }

  return value;
}

export function normalizeTeamPersonalBoardVisibilityEnabled(value: unknown) {
  if (typeof value !== "boolean") {
    throw new Error("Personal board visibility enabled must be a boolean.");
  }

  return value;
}

export function canCreateTeam(actor: TeamActor) {
  return isActiveActor(actor) && (actor.role === "admin" || actor.role === "manager");
}

export function canViewTeam(actor: TeamActor, context: TeamAccessContext) {
  if (!isActiveActor(actor)) {
    return false;
  }

  if (actor.role === "admin") {
    return true;
  }

  return Boolean(context.actorMembershipRole);
}

export function canManageTeam(actor: TeamActor, context: TeamAccessContext) {
  if (!isActiveActor(actor)) {
    return false;
  }

  if (actor.role === "admin") {
    return true;
  }

  return !context.isArchived && context.actorMembershipRole === "manager";
}

export function canManageTeamMembers(actor: TeamActor, context: TeamAccessContext) {
  return canManageTeam(actor, context);
}

export function canManageTeamPersonalBoardVisibility(actor: TeamActor) {
  return isActiveActor(actor) && actor.role === "admin";
}

export function assertCanCreateTeam(actor: TeamActor) {
  if (!canCreateTeam(actor)) {
    throw new Error("Taskboard team creation requires manager or admin access.");
  }
}

export function assertCanViewTeam(actor: TeamActor, context: TeamAccessContext) {
  if (!canViewTeam(actor, context)) {
    throw new Error("Team access is required.");
  }
}

export function assertCanManageTeam(actor: TeamActor, context: TeamAccessContext) {
  if (!canManageTeam(actor, context)) {
    throw new Error("Team management access is required.");
  }
}

export function assertCanManageTeamMembers(actor: TeamActor, context: TeamAccessContext) {
  if (!canManageTeamMembers(actor, context)) {
    throw new Error("Team member management access is required.");
  }
}

export function assertCanManageTeamPersonalBoardVisibility(actor: TeamActor) {
  if (!canManageTeamPersonalBoardVisibility(actor)) {
    throw new Error("Taskboard admin access is required.");
  }
}

export function assertActiveTeamManagerWouldRemain(args: {
  targetUserIsDisabled: boolean;
  targetCurrentRole: TeamMemberRole;
  targetNextRole: TeamMemberRole | null;
  activeManagerCount: number;
  actor: TeamActor;
  isArchivingTeam?: boolean;
}) {
  const removingActiveManager =
    !args.targetUserIsDisabled &&
    args.targetCurrentRole === "manager" &&
    args.targetNextRole !== "manager";

  if (!removingActiveManager) {
    return;
  }

  if (args.activeManagerCount > 1) {
    return;
  }

  if (args.isArchivingTeam && args.actor.role === "admin") {
    return;
  }

  throw new Error("A team must have at least one active manager.");
}

export function evaluateTeamMetadataUpdate(
  actor: TeamActor,
  context: TeamAccessContext,
  current: { name: string; description: string },
  input: TeamMetadataInput,
) {
  assertCanManageTeam(actor, context);

  const nextName = input.name === undefined ? current.name : normalizeTeamName(input.name);
  const nextDescription =
    input.description === undefined
      ? current.description
      : normalizeTeamDescription(input.description);
  const auditEvents: TeamAuditEventDraft[] = [];
  const previousValues: Record<string, unknown> = {};
  const newValues: Record<string, unknown> = {};

  if (nextName !== current.name) {
    previousValues.name = current.name;
    newValues.name = nextName;
  }

  if (nextDescription !== current.description) {
    previousValues.description = current.description;
    newValues.description = nextDescription;
  }

  if (Object.keys(newValues).length > 0) {
    auditEvents.push({
      action: "team.updated",
      previousValues,
      newValues,
    });
  }

  return {
    name: nextName,
    description: nextDescription,
    auditEvents,
  };
}

export function evaluateTeamPersonalBoardVisibilityUpdate(
  actor: TeamActor,
  context: TeamAccessContext,
  current: { personalBoardViewEnabled: boolean },
  input: TeamPersonalBoardVisibilityInput,
) {
  assertCanManageTeamPersonalBoardVisibility(actor);

  if (context.isArchived) {
    throw new Error("Archived teams cannot change personal board visibility.");
  }

  const enabled = normalizeTeamPersonalBoardVisibilityEnabled(input.enabled);
  const auditEvents: TeamAuditEventDraft[] = [];

  if (enabled !== current.personalBoardViewEnabled) {
    auditEvents.push({
      action: "team.personal_board_view_policy_changed",
      previousValues: { personalBoardViewEnabled: current.personalBoardViewEnabled },
      newValues: { personalBoardViewEnabled: enabled },
    });
  }

  return {
    enabled,
    auditEvents,
  };
}
