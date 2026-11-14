import type { PoolClient } from "pg";
import { isSameTeamPersonalBoardViewEnabled, isTeamLifecycleManagersEnabled } from "@/lib/taskboard-config";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";
import { isUuid } from "@/lib/uuid";

export type BoardAccessLevel = "none" | "viewer" | "editor" | "owner" | "admin";
export type BoardAccessSource =
  | "owner"
  | "board_member"
  | "admin"
  | "team_manager"
  | "team_default"
  | "same_team_personal";
export type BoardType = "personal" | "team";
export type TeamMemberDefaultAccess = "viewer" | "editor";
export type PersonalBoardVisibility = "private" | "team_visible";

export type BoardAccessMetadata = {
  boardId: string;
  level: BoardAccessLevel;
  canRead: boolean;
  canEdit: boolean;
  canManage: boolean;
  // Archive, delete, restore and purge tasks. Equals canEdit except on team
  // boards with manager-only lifecycle, where only team managers and admins have it.
  canManageLifecycle: boolean;
  isGlobalAdmin: boolean;
  source: BoardAccessSource | null;
};

export type BoardAccessBoardRow = {
  id: string;
  owner_user_id: string | null;
  owner_is_disabled?: boolean | null;
  board_type?: BoardType | null;
  owner_team_id?: string | null;
  team_member_default_access?: TeamMemberDefaultAccess | null;
  personal_visibility?: PersonalBoardVisibility | null;
  personal_visibility_team_id?: string | null;
};

export type AccessibleBoardSummary = {
  boardId: string;
  title: string;
  description: string;
  boardType: BoardType;
  ownerUserId: string | null;
  ownerDisplayName: string | null;
  ownerTeamId?: string;
  ownerTeamName?: string;
  teamMemberDefaultAccess?: TeamMemberDefaultAccess;
  visibility?: PersonalBoardVisibility;
  visibilityTeamId?: string;
  visibilityTeamName?: string;
  accessLevel: Exclude<BoardAccessLevel, "none">;
  canRead: true;
  canEdit: boolean;
  canManage: boolean;
  source: BoardAccessSource;
  isPersonalBoard: boolean;
  isTeammatePersonalBoard: boolean;
  isTeamBoard: boolean;
  isPrivate: boolean;
  isTeamVisible: boolean;
  accessReason: BoardAccessSource;
  isCurrentBoard: boolean;
};

export type AccessibleBoardCandidate = BoardAccessBoardRow & {
  title: string;
  description: string;
  ownerDisplayName: string | null;
  ownerTeamName?: string | null;
  personalVisibilityTeamName?: string | null;
};

const accessRank: Record<BoardAccessLevel, number> = {
  none: 0,
  viewer: 1,
  editor: 2,
  owner: 3,
  admin: 4,
};

type BoardAccessGrant = {
  level: Exclude<BoardAccessLevel, "none">;
  source: BoardAccessSource;
};

function getBoardType(board: BoardAccessBoardRow): BoardType {
  return board.board_type === "team" ? "team" : "personal";
}

function getStrongestGrant(grants: BoardAccessGrant[]) {
  let strongest: BoardAccessGrant | null = null;

  for (const grant of grants) {
    if (!strongest || accessRank[grant.level] > accessRank[strongest.level]) {
      strongest = grant;
    }
  }

  return strongest;
}

export class BoardAccessError extends Error {
  status: number;
  code:
    | "invalid_board_id"
    | "board_not_found"
    | "board_access_denied"
    | "board_lifecycle_denied"
    | "calendar_schedule_conflict"
    | "note_attachment_unavailable";

  constructor(
    code: BoardAccessError["code"],
    message: string,
    status: number,
  ) {
    super(message);
    this.name = "BoardAccessError";
    this.code = code;
    this.status = status;
  }
}

export function isValidBoardId(value: string) {
  return isUuid(value);
}

export function buildBoardAccessMetadata(args: {
  boardId: string;
  level: BoardAccessLevel;
  source: BoardAccessSource | null;
  canManageLifecycle?: boolean;
}): BoardAccessMetadata {
  const rank = accessRank[args.level];
  const canEdit = rank >= accessRank.editor;
  return {
    boardId: args.boardId,
    level: args.level,
    canRead: rank >= accessRank.viewer,
    canEdit,
    canManage: rank >= accessRank.owner,
    canManageLifecycle: canEdit && (args.canManageLifecycle ?? true),
    isGlobalAdmin: args.level === "admin",
    source: args.source,
  };
}

export function assertBoardAccess(
  access: BoardAccessMetadata,
  required: "read" | "edit" | "manage",
) {
  if (required === "read" && access.canRead) {
    return;
  }
  if (required === "edit" && access.canEdit) {
    return;
  }
  if (required === "manage" && access.canManage) {
    return;
  }

  throw new BoardAccessError(
    "board_access_denied",
    "You do not have access to this board.",
    403,
  );
}

export function assertBoardLifecycleAccess(access: BoardAccessMetadata, action: string) {
  assertBoardAccess(access, "edit");
  if (!access.canManageLifecycle) {
    throw new BoardAccessError(
      "board_lifecycle_denied",
      `Only a team manager can ${action} on this board.`,
      403,
    );
  }
}

export async function resolveEffectiveBoardAccess(
  client: PoolClient,
  user: TaskboardUserIdentity,
  board: BoardAccessBoardRow,
): Promise<BoardAccessMetadata> {
  if (user.isDisabled || !user.id) {
    return buildBoardAccessMetadata({
      boardId: board.id,
      level: "none",
      source: null,
    });
  }

  // System administration never grants access to board content. Resolve the
  // same ownership, explicit grants and team policy for every signed-in user.
  const boardType = getBoardType(board);
  const grants: BoardAccessGrant[] = [];

  if (boardType === "personal" && board.owner_user_id === user.id) {
    grants.push({
      level: "owner",
      source: "owner",
    });
  }

  const accessResult = await client.query<{
    board_member_role: "owner" | "editor" | "viewer" | null;
    team_member_role: "manager" | "member" | null;
    team_archived_at: string | null;
    owner_is_disabled: boolean | null;
    same_team_personal_access: boolean;
  }>(
    `
      SELECT
        board_members.role AS board_member_role,
        team_members.role AS team_member_role,
        teams.archived_at::text AS team_archived_at,
        owner_user.is_disabled AS owner_is_disabled,
        (
          $5::boolean
          AND context.board_type = 'personal'
          AND context.personal_visibility = 'team_visible'
          AND context.personal_visibility_team_id IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM app_permission_settings
            WHERE app_permission_settings.id = 1
              AND app_permission_settings.same_team_personal_board_visibility_allowed IS TRUE
          )
          AND context.owner_user_id IS NOT NULL
          AND context.owner_user_id <> context.user_id
          AND owner_user.is_disabled IS FALSE
          AND EXISTS (
            SELECT 1
            FROM teams shared_teams
            INNER JOIN team_members viewer_members
              ON viewer_members.team_id = shared_teams.id
              AND viewer_members.user_id = context.user_id
            INNER JOIN team_members owner_members
              ON owner_members.team_id = shared_teams.id
              AND owner_members.user_id = context.owner_user_id
            WHERE shared_teams.id = context.personal_visibility_team_id
              AND shared_teams.archived_at IS NULL
              AND shared_teams.personal_board_view_enabled IS TRUE
          )
        ) AS same_team_personal_access
      FROM (
        SELECT
          $1::uuid AS board_id,
          $2::uuid AS user_id,
          $3::uuid AS team_id,
          $4::uuid AS owner_user_id,
          $6::text AS board_type,
          $7::text AS personal_visibility,
          $8::uuid AS personal_visibility_team_id
      ) context
      LEFT JOIN board_members
        ON board_members.board_id = context.board_id
        AND board_members.user_id = context.user_id
      LEFT JOIN teams
        ON teams.id = context.team_id
      LEFT JOIN team_members
        ON team_members.team_id = context.team_id
        AND team_members.user_id = context.user_id
      LEFT JOIN users owner_user
        ON owner_user.id = context.owner_user_id
      LIMIT 1
    `,
    [
      board.id,
      user.id,
      board.owner_team_id ?? null,
      board.owner_user_id ?? null,
      isSameTeamPersonalBoardViewEnabled(),
      boardType,
      board.personal_visibility ?? null,
      board.personal_visibility_team_id ?? null,
    ],
  );
  const accessRow = accessResult.rows[0];
  const teamCanGrantAccess =
    boardType === "team" && Boolean(board.owner_team_id) && !accessRow?.team_archived_at;
  const sameTeamPersonalCanGrantAccess =
    boardType === "personal" &&
    Boolean(board.owner_user_id) &&
    board.owner_user_id !== user.id &&
    accessRow?.owner_is_disabled === false &&
    accessRow.same_team_personal_access;

  if (teamCanGrantAccess && accessRow?.team_member_role === "manager") {
    grants.push({
      level: "owner",
      source: "team_manager",
    });
  }

  if (accessRow?.board_member_role) {
    grants.push({
      level: accessRow.board_member_role,
      source: "board_member",
    });
  }

  if (
    teamCanGrantAccess &&
    accessRow?.team_member_role &&
    board.team_member_default_access
  ) {
    grants.push({
      level: board.team_member_default_access,
      source: "team_default",
    });
  }

  if (sameTeamPersonalCanGrantAccess) {
    grants.push({
      level: "viewer",
      source: "same_team_personal",
    });
  }

  const strongestGrant = getStrongestGrant(grants);

  if (!strongestGrant) {
    return buildBoardAccessMetadata({
      boardId: board.id,
      level: "none",
      source: null,
    });
  }

  // Checked from team membership itself: an explicit board-owner grant does
  // not make someone a manager of the owning team.
  const isTeamManager = teamCanGrantAccess && accessRow?.team_member_role === "manager";

  return buildBoardAccessMetadata({
    boardId: board.id,
    level: strongestGrant.level,
    source: strongestGrant.source,
    canManageLifecycle: boardType === "team" && isTeamLifecycleManagersEnabled() ? isTeamManager : true,
  });
}

export async function buildAccessibleBoardSummaries(args: {
  client: PoolClient;
  user: TaskboardUserIdentity;
  userId: string;
  currentBoardId: string;
  candidates: AccessibleBoardCandidate[];
}): Promise<AccessibleBoardSummary[]> {
  const boards: AccessibleBoardSummary[] = [];
  const seenBoardIds = new Set<string>();

  for (const candidate of args.candidates) {
    if (seenBoardIds.has(candidate.id)) {
      continue;
    }

    seenBoardIds.add(candidate.id);
    const access = await resolveEffectiveBoardAccess(args.client, args.user, candidate);

    if (!access.canRead || access.level === "none" || !access.source) {
      continue;
    }

    const boardType = getBoardType(candidate);

    boards.push({
      boardId: candidate.id,
      title: candidate.title,
      description: candidate.description,
      boardType,
      ownerUserId: candidate.owner_user_id,
      ownerDisplayName: candidate.ownerDisplayName,
      ...(candidate.owner_team_id ? { ownerTeamId: candidate.owner_team_id } : {}),
      ...(candidate.ownerTeamName ? { ownerTeamName: candidate.ownerTeamName } : {}),
      ...(candidate.team_member_default_access
        ? { teamMemberDefaultAccess: candidate.team_member_default_access }
        : {}),
      ...(candidate.personal_visibility
        ? { visibility: candidate.personal_visibility }
        : {}),
      ...(candidate.personal_visibility_team_id
        ? { visibilityTeamId: candidate.personal_visibility_team_id }
        : {}),
      ...(candidate.personalVisibilityTeamName
        ? { visibilityTeamName: candidate.personalVisibilityTeamName }
        : {}),
      accessLevel: access.level,
      canRead: true,
      canEdit: access.canEdit,
      canManage: access.canManage,
      source: access.source,
      isPersonalBoard: boardType === "personal" && candidate.owner_user_id === args.userId,
      isTeammatePersonalBoard: boardType === "personal" && candidate.owner_user_id !== args.userId,
      isTeamBoard: boardType === "team",
      isPrivate: boardType === "personal" && candidate.personal_visibility !== "team_visible",
      isTeamVisible: boardType === "personal" && candidate.personal_visibility === "team_visible",
      accessReason: access.source,
      isCurrentBoard: candidate.id === args.currentBoardId,
    });
  }

  return boards;
}
