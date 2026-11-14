import type { TaskboardUserRole } from "@/lib/auth";

export type PersonalBoardSharingActor = {
  id?: string;
  role?: TaskboardUserRole;
  isDisabled?: boolean;
};

export type PersonalBoardSharingBoard = {
  id: string;
  boardType: "personal" | "team";
  ownerUserId: string | null;
};

export type PersonalBoardMemberGrantRole = "viewer" | "editor";
export type PersonalBoardMemberAuditAction =
  | "personal_board.member_grant.added"
  | "personal_board.member_grant.changed"
  | "personal_board.member_grant.removed";

const validPersonalBoardGrantRoles = new Set<PersonalBoardMemberGrantRole>([
  "viewer",
  "editor",
]);

export function isValidPersonalBoardMemberGrantRole(
  value: unknown,
): value is PersonalBoardMemberGrantRole {
  return typeof value === "string" && validPersonalBoardGrantRoles.has(value as PersonalBoardMemberGrantRole);
}

export function normalizePersonalBoardMemberGrantRole(
  value: unknown,
): PersonalBoardMemberGrantRole {
  if (!isValidPersonalBoardMemberGrantRole(value)) {
    throw new Error("Personal board member grant role must be viewer or editor.");
  }

  return value;
}

export function canManagePersonalBoardShares(
  actor: PersonalBoardSharingActor,
  board: PersonalBoardSharingBoard,
) {
  if (actor.isDisabled || !actor.id || board.boardType !== "personal" || !board.ownerUserId) {
    return false;
  }

  return board.ownerUserId === actor.id;
}

export function assertCanManagePersonalBoardShares(
  actor: PersonalBoardSharingActor,
  board: PersonalBoardSharingBoard,
) {
  if (board.boardType !== "personal") {
    throw new Error("Personal board sharing is available only for personal boards.");
  }

  if (!board.ownerUserId) {
    throw new Error("Board owner is unavailable.");
  }

  if (!canManagePersonalBoardShares(actor, board)) {
    throw new Error("Personal board sharing access is required.");
  }
}
