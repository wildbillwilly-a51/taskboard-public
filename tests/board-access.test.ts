import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import { NextRequest } from "next/server";
import type { PoolClient } from "pg";
import {
  assertBoardAccess,
  buildAccessibleBoardSummaries,
  isValidBoardId,
  resolveEffectiveBoardAccess,
  type AccessibleBoardCandidate,
  type BoardAccessBoardRow,
} from "../src/lib/board-access";
import { explicitBoardIdErrorResponse, getBoardContextFromRequest } from "../src/lib/board-route";
import type { TaskboardUserIdentity } from "../src/lib/taskboard-request";

const board: BoardAccessBoardRow = {
  id: "10000000-0000-4000-8000-000000000001",
  owner_user_id: "20000000-0000-4000-8000-000000000001",
  board_type: "personal",
  owner_team_id: null,
  team_member_default_access: null,
  personal_visibility: "private",
  personal_visibility_team_id: null,
};
const memberBoard: AccessibleBoardCandidate = {
  id: "10000000-0000-4000-8000-000000000002",
  owner_user_id: "20000000-0000-4000-8000-000000000002",
  board_type: "personal",
  owner_team_id: null,
  team_member_default_access: null,
  title: "Shared Board",
  description: "Visible through board_members.",
  ownerDisplayName: "Shared Owner",
};
const teamId = "40000000-0000-4000-8000-000000000001";
const teamBoard: AccessibleBoardCandidate = {
  id: "10000000-0000-4000-8000-000000000003",
  owner_user_id: null,
  board_type: "team",
  owner_team_id: teamId,
  team_member_default_access: "viewer",
  title: "Team Board",
  description: "Visible through team membership.",
  ownerDisplayName: null,
  ownerTeamName: "Operations",
};
const teamEditorBoard: AccessibleBoardCandidate = {
  ...teamBoard,
  id: "10000000-0000-4000-8000-000000000004",
  team_member_default_access: "editor",
};
const currentBoard: AccessibleBoardCandidate = {
  ...board,
  title: "Personal Board",
  description: "Current personal board.",
  ownerDisplayName: "Personal Owner",
};

function user(overrides: Partial<TaskboardUserIdentity> = {}): TaskboardUserIdentity {
  return {
    id: "30000000-0000-4000-8000-000000000001",
    authMode: "authelia",
    authProvider: "authelia",
    email: "user@example.test",
    displayName: "Test User",
    role: "standard",
    isDisabled: false,
    isReservedLocalAdmin: false,
    ...overrides,
  };
}

type BoardMemberRole = "owner" | "editor" | "viewer";
type TeamMemberRole = "manager" | "member";
type MockAccessGrant =
  | BoardMemberRole
  | {
      boardMemberRole?: BoardMemberRole | null;
      teamMemberRole?: TeamMemberRole | null;
      teamArchivedAt?: string | null;
      ownerIsDisabled?: boolean | null;
      appPermissionAllowed?: boolean;
      sameTeamPersonalAccess?: boolean;
    };

function normalizeMockAccessGrant(grant: MockAccessGrant | null | undefined) {
  if (typeof grant === "string") {
    return {
      boardMemberRole: grant,
      teamMemberRole: null,
      teamArchivedAt: null,
      ownerIsDisabled: false,
      sameTeamPersonalAccess: false,
    };
  }

  return {
    boardMemberRole: grant?.boardMemberRole ?? null,
    teamMemberRole: grant?.teamMemberRole ?? null,
    teamArchivedAt: grant?.teamArchivedAt ?? null,
    ownerIsDisabled: grant?.ownerIsDisabled ?? false,
    appPermissionAllowed: grant?.appPermissionAllowed ?? false,
    sameTeamPersonalAccess: grant?.sameTeamPersonalAccess ?? false,
  };
}

function canMockSameTeamPersonalAccess(values: unknown[], grant: ReturnType<typeof normalizeMockAccessGrant>) {
  return (
    values[4] === true &&
    grant.appPermissionAllowed &&
    values[5] === "personal" &&
    values[6] === "team_visible" &&
    typeof values[7] === "string" &&
    grant.sameTeamPersonalAccess
  );
}

async function withSameTeamPersonalBoardFlag<T>(
  value: "enabled" | undefined,
  callback: () => Promise<T>,
) {
  const previous = process.env.TASKBOARD_SAME_TEAM_PERSONAL_BOARD_VIEW;

  if (value === undefined) {
    delete process.env.TASKBOARD_SAME_TEAM_PERSONAL_BOARD_VIEW;
  } else {
    process.env.TASKBOARD_SAME_TEAM_PERSONAL_BOARD_VIEW = value;
  }

  try {
    return await callback();
  } finally {
    if (previous === undefined) {
      delete process.env.TASKBOARD_SAME_TEAM_PERSONAL_BOARD_VIEW;
    } else {
      process.env.TASKBOARD_SAME_TEAM_PERSONAL_BOARD_VIEW = previous;
    }
  }
}

function memberClient(grant: MockAccessGrant | null) {
  return {
    async query(_sql: string, values: unknown[]) {
      const normalizedGrant = normalizeMockAccessGrant(grant);
      assert.equal(values[0], board.id);
      assert.equal(values[2], null);
      assert.equal(values[3], board.owner_user_id);
      return {
        rows: [
          {
            board_member_role: normalizedGrant.boardMemberRole,
            team_member_role: normalizedGrant.teamMemberRole,
            team_archived_at: normalizedGrant.teamArchivedAt,
            owner_is_disabled: normalizedGrant.ownerIsDisabled,
            same_team_personal_access: canMockSameTeamPersonalAccess(values, normalizedGrant),
          },
        ],
      };
    },
  } as unknown as PoolClient;
}

function teamAccessClient(boardId: string, grant: MockAccessGrant | null) {
  return {
    async query(_sql: string, values: unknown[]) {
      const normalizedGrant = normalizeMockAccessGrant(grant);
      assert.deepEqual(values, [
        boardId,
        "30000000-0000-4000-8000-000000000001",
        teamId,
        null,
        values[4],
        "team",
        null,
        null,
      ]);
      return {
        rows: [
          {
            board_member_role: normalizedGrant.boardMemberRole,
            team_member_role: normalizedGrant.teamMemberRole,
            team_archived_at: normalizedGrant.teamArchivedAt,
            owner_is_disabled: normalizedGrant.ownerIsDisabled,
            same_team_personal_access: canMockSameTeamPersonalAccess(values, normalizedGrant),
          },
        ],
      };
    },
  } as unknown as PoolClient;
}

function memberMapClient(rolesByBoardId: Record<string, MockAccessGrant | null>) {
  return {
    async query(_sql: string, values: unknown[]) {
      const grant = normalizeMockAccessGrant(rolesByBoardId[String(values[0])] ?? null);
      return {
        rows: [
          {
            board_member_role: grant.boardMemberRole,
            team_member_role: grant.teamMemberRole,
            team_archived_at: grant.teamArchivedAt,
            owner_is_disabled: grant.ownerIsDisabled,
            same_team_personal_access: canMockSameTeamPersonalAccess(values, grant),
          },
        ],
      };
    },
  } as unknown as PoolClient;
}

async function assertExplicitBoardIdRejected(response: Response) {
  assert.equal(response.status, 400);
  const body = (await response.json()) as { error?: string };
  assert.match(body.error ?? "", /Explicit boardId is not supported/);
}

test("global admin has no implicit board-content access and honors explicit grants", async () => {
  for (const role of [null, "viewer", "editor", "owner"] as const) {
    const access = await resolveEffectiveBoardAccess(memberClient(role), user({role: "admin"}), board);
    assert.equal(access.level, role ?? "none");
    assert.equal(access.source, role ? "board_member" : null);
    assert.equal(access.isGlobalAdmin, false);
    assert.equal(access.canRead, role !== null);
    assert.equal(access.canEdit, role === "editor" || role === "owner");
    assert.equal(access.canManage, role === "owner");
  }
  const own = await resolveEffectiveBoardAccess(memberClient(null), user({role:"admin",id:board.owner_user_id!}), board);
  assert.equal(own.level, "owner");
});

test("board owner receives owner access", async () => {
  const access = await resolveEffectiveBoardAccess(
    memberClient(null),
    user({ id: board.owner_user_id ?? undefined }),
    board,
  );

  assert.equal(access.level, "owner");
  assert.equal(access.source, "owner");
  assert.equal(access.canManage, true);
});

test("board member roles map to effective access capabilities", async () => {
  const viewer = await resolveEffectiveBoardAccess(memberClient("viewer"), user(), board);
  assert.equal(viewer.level, "viewer");
  assert.equal(viewer.source, "board_member");
  assert.equal(viewer.canRead, true);
  assert.equal(viewer.canEdit, false);
  assert.throws(() => assertBoardAccess(viewer, "edit"), /do not have access/);

  const editor = await resolveEffectiveBoardAccess(memberClient("editor"), user(), board);
  assert.equal(editor.level, "editor");
  assert.equal(editor.canEdit, true);
  assert.equal(editor.canManage, false);
  assert.throws(() => assertBoardAccess(editor, "manage"), /do not have access/);

  const memberOwner = await resolveEffectiveBoardAccess(memberClient("owner"), user(), board);
  assert.equal(memberOwner.level, "owner");
  assert.equal(memberOwner.canManage, true);
});

test("team managers receive owner access on active team boards", async () => {
  const access = await resolveEffectiveBoardAccess(
    teamAccessClient(teamBoard.id, { teamMemberRole: "manager" }),
    user(),
    teamBoard,
  );

  assert.equal(access.level, "owner");
  assert.equal(access.source, "team_manager");
  assert.equal(access.canManage, true);
});

test("team members receive default viewer and editor access on active team boards", async () => {
  const viewer = await resolveEffectiveBoardAccess(
    teamAccessClient(teamBoard.id, { teamMemberRole: "member" }),
    user(),
    teamBoard,
  );
  assert.equal(viewer.level, "viewer");
  assert.equal(viewer.source, "team_default");
  assert.equal(viewer.canRead, true);
  assert.equal(viewer.canEdit, false);

  const editor = await resolveEffectiveBoardAccess(
    teamAccessClient(teamEditorBoard.id, { teamMemberRole: "member" }),
    user(),
    teamEditorBoard,
  );
  assert.equal(editor.level, "editor");
  assert.equal(editor.source, "team_default");
  assert.equal(editor.canEdit, true);
  assert.equal(editor.canManage, false);
});

test("explicit board member grants can strengthen but not restrict team access", async () => {
  const strengthened = await resolveEffectiveBoardAccess(
    teamAccessClient(teamBoard.id, {
      boardMemberRole: "editor",
      teamMemberRole: "member",
    }),
    user(),
    teamBoard,
  );
  assert.equal(strengthened.level, "editor");
  assert.equal(strengthened.source, "board_member");

  const defaultEditorNotRestricted = await resolveEffectiveBoardAccess(
    teamAccessClient(teamEditorBoard.id, {
      boardMemberRole: "viewer",
      teamMemberRole: "member",
    }),
    user(),
    teamEditorBoard,
  );
  assert.equal(defaultEditorNotRestricted.level, "editor");
  assert.equal(defaultEditorNotRestricted.source, "team_default");

  const managerNotRestricted = await resolveEffectiveBoardAccess(
    teamAccessClient(teamBoard.id, {
      boardMemberRole: "viewer",
      teamMemberRole: "manager",
    }),
    user(),
    teamBoard,
  );
  assert.equal(managerNotRestricted.level, "owner");
  assert.equal(managerNotRestricted.source, "team_manager");
});

test("archived teams do not grant team manager or default access", async () => {
  const access = await resolveEffectiveBoardAccess(
    teamAccessClient(teamBoard.id, {
      teamMemberRole: "manager",
      teamArchivedAt: "2026-07-02T00:00:00.000Z",
    }),
    user(),
    teamBoard,
  );

  assert.equal(access.level, "none");
  assert.equal(access.source, null);
});

test("disabled and unrelated users receive no access", async () => {
  const disabled = await resolveEffectiveBoardAccess(
    memberClient("owner"),
    user({ isDisabled: true }),
    board,
  );
  assert.equal(disabled.level, "none");
  assert.equal(disabled.canRead, false);
  assert.throws(() => assertBoardAccess(disabled, "read"), /do not have access/);

  const unrelated = await resolveEffectiveBoardAccess(memberClient(null), user(), board);
  assert.equal(unrelated.level, "none");
  assert.equal(unrelated.source, null);
  assert.throws(() => assertBoardAccess(unrelated, "read"), /do not have access/);
});

test("accessible board summaries include the current owned board without team fields", async () => {
  const boards = await buildAccessibleBoardSummaries({
    client: memberMapClient({}),
    user: user({ id: currentBoard.owner_user_id ?? undefined }),
    userId: currentBoard.owner_user_id ?? "",
    currentBoardId: currentBoard.id,
    candidates: [currentBoard],
  });

  assert.equal(boards.length, 1);
  assert.deepEqual(Object.keys(boards[0]).sort(), [
    "accessLevel",
    "accessReason",
    "boardType",
    "boardId",
    "canEdit",
    "canManage",
    "canRead",
    "description",
    "isCurrentBoard",
    "isPrivate",
    "isPersonalBoard",
    "isTeamVisible",
    "isTeammatePersonalBoard",
    "isTeamBoard",
    "ownerDisplayName",
    "ownerUserId",
    "source",
    "title",
    "visibility",
  ].sort());
  assert.equal(boards[0].boardId, currentBoard.id);
  assert.equal(boards[0].accessLevel, "owner");
  assert.equal(boards[0].source, "owner");
  assert.equal(boards[0].accessReason, "owner");
  assert.equal(boards[0].boardType, "personal");
  assert.equal(boards[0].visibility, "private");
  assert.equal(boards[0].isCurrentBoard, true);
  assert.equal(boards[0].isPersonalBoard, true);
  assert.equal(boards[0].isTeammatePersonalBoard, false);
  assert.equal(boards[0].isTeamBoard, false);
  assert.equal(boards[0].isPrivate, true);
  assert.equal(boards[0].isTeamVisible, false);
  assert.equal(boards[0].canRead, true);
  assert.equal(boards[0].canEdit, true);
  assert.equal(boards[0].canManage, true);
});

test("accessible board summaries map board member access levels", async () => {
  const viewerBoards = await buildAccessibleBoardSummaries({
    client: memberMapClient({ [memberBoard.id]: "viewer" }),
    user: user(),
    userId: "30000000-0000-4000-8000-000000000001",
    currentBoardId: currentBoard.id,
    candidates: [memberBoard],
  });
  assert.equal(viewerBoards[0].accessLevel, "viewer");
  assert.equal(viewerBoards[0].source, "board_member");
  assert.equal(viewerBoards[0].canRead, true);
  assert.equal(viewerBoards[0].canEdit, false);
  assert.equal(viewerBoards[0].canManage, false);

  const editorBoards = await buildAccessibleBoardSummaries({
    client: memberMapClient({ [memberBoard.id]: "editor" }),
    user: user(),
    userId: "30000000-0000-4000-8000-000000000001",
    currentBoardId: currentBoard.id,
    candidates: [memberBoard],
  });
  assert.equal(editorBoards[0].accessLevel, "editor");
  assert.equal(editorBoards[0].canEdit, true);
  assert.equal(editorBoards[0].canManage, false);

  const ownerBoards = await buildAccessibleBoardSummaries({
    client: memberMapClient({ [memberBoard.id]: "owner" }),
    user: user(),
    userId: "30000000-0000-4000-8000-000000000001",
    currentBoardId: currentBoard.id,
    candidates: [memberBoard],
  });
  assert.equal(ownerBoards[0].accessLevel, "owner");
  assert.equal(ownerBoards[0].canManage, true);
});

test("accessible board summaries include eligible team boards with team metadata", async () => {
  const boards = await buildAccessibleBoardSummaries({
    client: memberMapClient({
      [teamBoard.id]: { teamMemberRole: "member" },
      [teamEditorBoard.id]: {
        boardMemberRole: "viewer",
        teamMemberRole: "member",
      },
    }),
    user: user({ id: currentBoard.owner_user_id ?? undefined }),
    userId: currentBoard.owner_user_id ?? "",
    currentBoardId: currentBoard.id,
    candidates: [currentBoard, teamBoard, teamEditorBoard],
  });

  assert.equal(boards.length, 3);
  assert.equal(boards[0].boardId, currentBoard.id);
  assert.equal(boards[0].isCurrentBoard, true);
  assert.equal(boards[0].isPersonalBoard, true);

  assert.equal(boards[1].boardType, "team");
  assert.equal(boards[1].ownerUserId, null);
  assert.equal(boards[1].ownerDisplayName, null);
  assert.equal(boards[1].ownerTeamId, teamId);
  assert.equal(boards[1].ownerTeamName, "Operations");
  assert.equal(boards[1].teamMemberDefaultAccess, "viewer");
  assert.equal(boards[1].accessLevel, "viewer");
  assert.equal(boards[1].source, "team_default");
  assert.equal(boards[1].canEdit, false);
  assert.equal(boards[1].isTeamBoard, true);

  assert.equal(boards[2].accessLevel, "editor");
  assert.equal(boards[2].source, "team_default");
  assert.equal(boards[2].canEdit, true);
});

test("accessible board summaries avoid duplicates across team and explicit access paths", async () => {
  const boards = await buildAccessibleBoardSummaries({
    client: memberMapClient({
      [teamBoard.id]: {
        boardMemberRole: "editor",
        teamMemberRole: "manager",
      },
    }),
    user: user(),
    userId: "30000000-0000-4000-8000-000000000001",
    currentBoardId: currentBoard.id,
    candidates: [teamBoard, teamBoard],
  });

  assert.equal(boards.length, 1);
  assert.equal(boards[0].boardId, teamBoard.id);
  assert.equal(boards[0].accessLevel, "owner");
  assert.equal(boards[0].source, "team_manager");
});

test("admin board summaries deduplicate only actually accessible boards", async () => {
  const admin = user({role: "admin", id:currentBoard.owner_user_id!});
  const boards = await buildAccessibleBoardSummaries({client:memberMapClient({[memberBoard.id]:"viewer"}),user:admin,userId:admin.id!,currentBoardId:currentBoard.id,candidates:[currentBoard,memberBoard,teamBoard,currentBoard]});
  assert.deepEqual(boards.map(item => [item.boardId,item.accessLevel,item.source]), [[currentBoard.id,"owner","owner"],[memberBoard.id,"viewer","board_member"]]);
  assert.equal(boards[0].isCurrentBoard,true);
});

test("accessible board summaries filter unrelated and disabled users", async () => {
  const unrelatedBoards = await buildAccessibleBoardSummaries({
    client: memberMapClient({}),
    user: user(),
    userId: "30000000-0000-4000-8000-000000000001",
    currentBoardId: currentBoard.id,
    candidates: [memberBoard],
  });
  assert.equal(unrelatedBoards.length, 0);

  const disabledBoards = await buildAccessibleBoardSummaries({
    client: memberMapClient({ [memberBoard.id]: "owner" }),
    user: user({ isDisabled: true }),
    userId: "30000000-0000-4000-8000-000000000001",
    currentBoardId: currentBoard.id,
    candidates: [memberBoard],
  });
  assert.equal(disabledBoards.length, 0);
});

test("same-team membership does not grant access to personal boards", async () => {
  const teammatePersonalBoard: AccessibleBoardCandidate = {
    ...memberBoard,
    id: "10000000-0000-4000-8000-000000000005",
    title: "Teammate Personal Board",
  };

  const boards = await buildAccessibleBoardSummaries({
    client: memberMapClient({
      [teamBoard.id]: { teamMemberRole: "member" },
    }),
    user: user(),
    userId: "30000000-0000-4000-8000-000000000001",
    currentBoardId: currentBoard.id,
    candidates: [teammatePersonalBoard],
  });

  assert.equal(boards.length, 0);
});

test("same-team personal board access requires global flag and opted-in shared team", async () => {
  const teammatePersonalBoard: AccessibleBoardCandidate = {
    ...memberBoard,
    id: "10000000-0000-4000-8000-000000000005",
    title: "Teammate Personal Board",
    personal_visibility: "team_visible",
    personal_visibility_team_id: teamId,
    personalVisibilityTeamName: "Operations",
  };

  await withSameTeamPersonalBoardFlag(undefined, async () => {
    const access = await resolveEffectiveBoardAccess(
      memberMapClient({
        [teammatePersonalBoard.id]: { sameTeamPersonalAccess: true },
      }),
      user(),
      teammatePersonalBoard,
    );

    assert.equal(access.level, "none");
    assert.equal(access.source, null);
  });

  await withSameTeamPersonalBoardFlag("enabled", async () => {
    const teamNotOptedIn = await resolveEffectiveBoardAccess(
      memberMapClient({
        [teammatePersonalBoard.id]: {
          appPermissionAllowed: true,
          sameTeamPersonalAccess: false,
          teamMemberRole: "member",
        },
      }),
      user(),
      teammatePersonalBoard,
    );

    assert.equal(teamNotOptedIn.level, "none");

    const memberAccess = await resolveEffectiveBoardAccess(
      memberMapClient({
        [teammatePersonalBoard.id]: {
          appPermissionAllowed: true,
          sameTeamPersonalAccess: true,
          teamMemberRole: "member",
        },
      }),
      user(),
      teammatePersonalBoard,
    );

    assert.equal(memberAccess.level, "viewer");
    assert.equal(memberAccess.source, "same_team_personal");
    assert.equal(memberAccess.canRead, true);
    assert.equal(memberAccess.canEdit, false);
    assert.throws(() => assertBoardAccess(memberAccess, "edit"), /do not have access/);

    const managerAccess = await resolveEffectiveBoardAccess(
      memberMapClient({
        [teammatePersonalBoard.id]: {
          appPermissionAllowed: true,
          sameTeamPersonalAccess: true,
          teamMemberRole: "manager",
        },
      }),
      user(),
      teammatePersonalBoard,
    );

    assert.equal(managerAccess.level, "viewer");
    assert.equal(managerAccess.source, "same_team_personal");
    assert.equal(managerAccess.canManage, false);
  });
});

test("same-team personal board access requires every Phase 2L-A gate", async () => {
  const teammatePersonalBoard: AccessibleBoardCandidate = {
    ...memberBoard,
    id: "10000000-0000-4000-8000-000000000009",
    title: "Teammate Personal Board",
    personal_visibility: "team_visible",
    personal_visibility_team_id: teamId,
  };

  await withSameTeamPersonalBoardFlag("enabled", async () => {
    const globalOff = await resolveEffectiveBoardAccess(
      memberMapClient({
        [teammatePersonalBoard.id]: {
          appPermissionAllowed: false,
          sameTeamPersonalAccess: true,
        },
      }),
      user(),
      teammatePersonalBoard,
    );
    assert.equal(globalOff.level, "none");

    const teamOff = await resolveEffectiveBoardAccess(
      memberMapClient({
        [teammatePersonalBoard.id]: {
          appPermissionAllowed: true,
          sameTeamPersonalAccess: false,
        },
      }),
      user(),
      teammatePersonalBoard,
    );
    assert.equal(teamOff.level, "none");

    const privateBoard = await resolveEffectiveBoardAccess(
      memberMapClient({
        [teammatePersonalBoard.id]: {
          appPermissionAllowed: true,
          sameTeamPersonalAccess: true,
        },
      }),
      user(),
      { ...teammatePersonalBoard, personal_visibility: "private", personal_visibility_team_id: null },
    );
    assert.equal(privateBoard.level, "none");

    const missingAssociatedTeam = await resolveEffectiveBoardAccess(
      memberMapClient({
        [teammatePersonalBoard.id]: {
          appPermissionAllowed: true,
          sameTeamPersonalAccess: true,
        },
      }),
      user(),
      { ...teammatePersonalBoard, personal_visibility_team_id: null },
    );
    assert.equal(missingAssociatedTeam.level, "none");

    const wrongAssociatedTeam = await resolveEffectiveBoardAccess(
      memberMapClient({
        [teammatePersonalBoard.id]: {
          appPermissionAllowed: true,
          sameTeamPersonalAccess: false,
        },
      }),
      user(),
      teammatePersonalBoard,
    );
    assert.equal(wrongAssociatedTeam.level, "none");

    const allGates = await resolveEffectiveBoardAccess(
      memberMapClient({
        [teammatePersonalBoard.id]: {
          appPermissionAllowed: true,
          sameTeamPersonalAccess: true,
        },
      }),
      user(),
      teammatePersonalBoard,
    );
    assert.equal(allGates.level, "viewer");
    assert.equal(allGates.source, "same_team_personal");
    assert.equal(allGates.canEdit, false);
  });
});

test("same-team personal board access preserves stronger grants and global roles", async () => {
  const teammatePersonalBoard: AccessibleBoardCandidate = {
    ...memberBoard,
    id: "10000000-0000-4000-8000-000000000006",
    title: "Teammate Personal Board",
    personal_visibility: "team_visible",
    personal_visibility_team_id: teamId,
  };

  await withSameTeamPersonalBoardFlag("enabled", async () => {
    const ownerAccess = await resolveEffectiveBoardAccess(
      memberMapClient({}),
      user({ id: currentBoard.owner_user_id ?? undefined }),
      currentBoard,
    );
    assert.equal(ownerAccess.level, "owner");
    assert.equal(ownerAccess.source, "owner");

    const adminAccess = await resolveEffectiveBoardAccess(
      memberMapClient({}),
      user({ role: "admin" }),
      teammatePersonalBoard,
    );
    assert.equal(adminAccess.level, "none");
    assert.equal(adminAccess.source, null);

    const editorGrant = await resolveEffectiveBoardAccess(
      memberMapClient({
        [teammatePersonalBoard.id]: {
          boardMemberRole: "editor",
          appPermissionAllowed: true,
          sameTeamPersonalAccess: true,
        },
      }),
      user(),
      teammatePersonalBoard,
    );
    assert.equal(editorGrant.level, "editor");
    assert.equal(editorGrant.source, "board_member");

    const ownerGrant = await resolveEffectiveBoardAccess(
      memberMapClient({
        [teammatePersonalBoard.id]: {
          boardMemberRole: "owner",
          appPermissionAllowed: true,
          sameTeamPersonalAccess: true,
        },
      }),
      user(),
      teammatePersonalBoard,
    );
    assert.equal(ownerGrant.level, "owner");
    assert.equal(ownerGrant.source, "board_member");

    const viewerGrantDoesNotRestrict = await resolveEffectiveBoardAccess(
      memberMapClient({
        [teammatePersonalBoard.id]: {
          boardMemberRole: "viewer",
          appPermissionAllowed: true,
          sameTeamPersonalAccess: true,
        },
      }),
      user(),
      teammatePersonalBoard,
    );
    assert.equal(viewerGrantDoesNotRestrict.level, "viewer");
    assert.equal(viewerGrantDoesNotRestrict.source, "board_member");
  });
});

test("same-team personal board access excludes disabled and inactive cases", async () => {
  const teammatePersonalBoard: AccessibleBoardCandidate = {
    ...memberBoard,
    id: "10000000-0000-4000-8000-000000000007",
    title: "Teammate Personal Board",
    personal_visibility: "team_visible",
    personal_visibility_team_id: teamId,
  };

  await withSameTeamPersonalBoardFlag("enabled", async () => {
    const disabledViewer = await resolveEffectiveBoardAccess(
      memberMapClient({
        [teammatePersonalBoard.id]: { sameTeamPersonalAccess: true },
      }),
      user({ isDisabled: true }),
      teammatePersonalBoard,
    );
    assert.equal(disabledViewer.level, "none");

    const disabledOwner = await resolveEffectiveBoardAccess(
      memberMapClient({
        [teammatePersonalBoard.id]: {
          ownerIsDisabled: true,
          appPermissionAllowed: true,
          sameTeamPersonalAccess: true,
        },
      }),
      user(),
      teammatePersonalBoard,
    );
    assert.equal(disabledOwner.level, "none");

    const unrelated = await resolveEffectiveBoardAccess(
      memberMapClient({}),
      user(),
      teammatePersonalBoard,
    );
    assert.equal(unrelated.level, "none");

    const archivedOrRemovedTeam = await resolveEffectiveBoardAccess(
      memberMapClient({
        [teammatePersonalBoard.id]: {
          teamArchivedAt: "2026-07-03T00:00:00.000Z",
          sameTeamPersonalAccess: false,
        },
      }),
      user(),
      teammatePersonalBoard,
    );
    assert.equal(archivedOrRemovedTeam.level, "none");
  });
});

test("accessible board summaries include teammate personal boards only when enabled", async () => {
  const teammatePersonalBoard: AccessibleBoardCandidate = {
    ...memberBoard,
    id: "10000000-0000-4000-8000-000000000008",
    title: "Teammate Personal Board",
    personal_visibility: "team_visible",
    personal_visibility_team_id: teamId,
    personalVisibilityTeamName: "Operations",
  };

  await withSameTeamPersonalBoardFlag(undefined, async () => {
    const boards = await buildAccessibleBoardSummaries({
      client: memberMapClient({
        [teammatePersonalBoard.id]: { sameTeamPersonalAccess: true },
      }),
      user: user(),
      userId: "30000000-0000-4000-8000-000000000001",
      currentBoardId: currentBoard.id,
      candidates: [teammatePersonalBoard],
    });

    assert.equal(boards.length, 0);
  });

  await withSameTeamPersonalBoardFlag("enabled", async () => {
    const boards = await buildAccessibleBoardSummaries({
      client: memberMapClient({
        [teammatePersonalBoard.id]: { sameTeamPersonalAccess: true },
      }),
      user: user(),
      userId: "30000000-0000-4000-8000-000000000001",
      currentBoardId: currentBoard.id,
      candidates: [teammatePersonalBoard],
    });

    assert.equal(boards.length, 0);
  });

  await withSameTeamPersonalBoardFlag("enabled", async () => {
    const boards = await buildAccessibleBoardSummaries({
      client: memberMapClient({
        [teammatePersonalBoard.id]: {
          appPermissionAllowed: true,
          sameTeamPersonalAccess: true,
        },
      }),
      user: user(),
      userId: "30000000-0000-4000-8000-000000000001",
      currentBoardId: currentBoard.id,
      candidates: [teammatePersonalBoard, teammatePersonalBoard],
    });

    assert.equal(boards.length, 1);
    assert.equal(boards[0].boardType, "personal");
    assert.equal(boards[0].visibility, "team_visible");
    assert.equal(boards[0].visibilityTeamId, teamId);
    assert.equal(boards[0].visibilityTeamName, "Operations");
    assert.equal(boards[0].accessLevel, "viewer");
    assert.equal(boards[0].source, "same_team_personal");
    assert.equal(boards[0].accessReason, "same_team_personal");
    assert.equal(boards[0].canRead, true);
    assert.equal(boards[0].canEdit, false);
    assert.equal(boards[0].canManage, false);
    assert.equal(boards[0].isPersonalBoard, false);
    assert.equal(boards[0].isTeammatePersonalBoard, true);
    assert.equal(boards[0].isTeamBoard, false);
    assert.equal(boards[0].isPrivate, false);
    assert.equal(boards[0].isTeamVisible, true);
  });
});

test("board ids must be UUIDs before explicit board lookup", () => {
  assert.equal(isValidBoardId(board.id), true);
  assert.equal(isValidBoardId("not-a-uuid"), false);
  assert.equal(isValidBoardId(""), false);
});

test("explicit malformed board ids are preserved for validation", () => {
  assert.equal(
    getBoardContextFromRequest(new NextRequest("http://taskboard.test/api/board?boardId="))
      .boardId,
    "",
  );

  assert.equal(
    typeof getBoardContextFromRequest(new NextRequest("http://taskboard.test/api/board"), {
      boardId: 123,
    }).boardId,
    "string",
  );

  assert.equal(
    getBoardContextFromRequest(new NextRequest("http://taskboard.test/api/board")).boardId,
    undefined,
  );
});

test("explicit board id rejection helper preserves omitted-board behavior", async () => {
  const omitted = explicitBoardIdErrorResponse(
    new NextRequest("http://taskboard.test/api/imports/bulk"),
  );
  assert.equal(omitted, null);

  await assertExplicitBoardIdRejected(
    explicitBoardIdErrorResponse(
      new NextRequest("http://taskboard.test/api/imports/bulk?boardId=10000000-0000-4000-8000-000000000001"),
    )!,
  );

  await assertExplicitBoardIdRejected(
    explicitBoardIdErrorResponse(
      new NextRequest("http://taskboard.test/api/imports/bulk"),
      { boardId: board.id },
    )!,
  );
});

test("personal-board-only route handlers reject explicit board ids", () => {
  const probe = `
    import path from "node:path";
    import { pathToFileURL } from "node:url";
    import { NextRequest } from "next/server";

    const boardId = ${JSON.stringify(board.id)};

    async function importRoute(modulePath) {
      return import(pathToFileURL(path.join(process.cwd(), modulePath)).href);
    }

    function makeRequest(url, body) {
      if (body === undefined) {
        return new NextRequest(url);
      }
      return new NextRequest(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
    }

    async function expectRejected(modulePath, handlerName, request) {
      const route = await importRoute(modulePath);
      const handler =
        route[handlerName] ??
        route.default?.[handlerName] ??
        route["module.exports"]?.[handlerName];
      if (typeof handler !== "function") {
        console.error(JSON.stringify({ modulePath, handlerName, keys: Object.keys(route) }));
        process.exit(1);
      }
      const response = await handler(request);
      const body = await response.json().catch(() => ({}));
      if (response.status !== 400 || !String(body.error ?? "").includes("Explicit boardId is not supported")) {
        console.error(JSON.stringify({ modulePath, handlerName, status: response.status, body }));
        process.exit(1);
      }
    }

    async function expectStatus(modulePath, handlerName, request, expectedStatus) {
      const route = await importRoute(modulePath);
      const handler =
        route[handlerName] ??
        route.default?.[handlerName] ??
        route["module.exports"]?.[handlerName];
      if (typeof handler !== "function") {
        console.error(JSON.stringify({ modulePath, handlerName, keys: Object.keys(route) }));
        process.exit(1);
      }
      const response = await handler(request);
      if (response.status !== expectedStatus) {
        const body = await response.json().catch(() => ({}));
        console.error(JSON.stringify({ modulePath, handlerName, expectedStatus, status: response.status, body }));
        process.exit(1);
      }
    }


    await expectStatus(
      "src/app/api/boards/accessible/route.ts",
      "GET",
      makeRequest("http://taskboard.test/api/boards/accessible"),
      503,
    );
    await expectStatus(
      "src/app/api/boards/selected/route.ts",
      "PUT",
      makeRequest("http://taskboard.test/api/boards/selected", { boardId }),
      503,
    );
  `;

  execFileSync(process.execPath, ["--conditions", "react-server", "--import", "tsx", "--eval", probe], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: "",
    },
    stdio: "pipe",
  });
});

test("frontend board switching plumbing keeps active board context explicit", () => {
  const source = readFileSync("src/components/taskboard.tsx", "utf8");
  const pickerSource = readFileSync("src/components/board-picker-sections.ts", "utf8");

  assert.match(source, /const \[currentBoardId, setCurrentBoardId\] = useState\(initialCurrentBoardId\)/);
  assert.match(source, /const \[personalBoardId\] = useState\(initialPersonalBoardId\)/);
  assert.match(source, /const response = await persistLoadBoard\(accessibleBoard\.boardId\)/);
  assert.match(source, /setCurrentBoardId\(response\.board\.id\)/);
  assert.match(source, /persistInitialBoardSelection/);
  assert.match(source, /persistSelectedBoardPreference\([\s\S]*initialBoard\.id === personalBoardId \? null : initialBoard\.id/);
  assert.match(source, /persistSelectedBoardPreference\([\s\S]*response\.board\.id === personalBoardId \? null : response\.board\.id/);
  assert.match(source, /fetch\("\/api\/boards\/selected"/);
  assert.match(source, /buildBoardPickerSections\(accessibleBoards/);
  assert.match(pickerSource, /Teammate personal/);
  assert.match(pickerSource, /board\.isTeammatePersonalBoard/);
  assert.match(source, /appendBoardIdToRequest\(input, options\.boardId\)/);

  const supportedCoreCalls = [
    "persistCreateBucket(trimmedTitle, activeBoardRequestOptions)",
    "persistUpdateBucket(bucketId, { title: trimmedTitle }, activeBoardRequestOptions)",
    "persistReorderBuckets(nextBoard.buckets.map((bucket) => bucket.id), activeBoardRequestOptions)",
    "persistDeleteBucket(bucketId, activeBoardRequestOptions)",
    "persistUpdateTask(",
    "persistDeleteTask(taskId, activeBoardRequestOptions)",
    "persistArchiveTask(taskId, activeBoardRequestOptions)",
    "persistCreateChecklistItem(taskId, label, activeBoardRequestOptions)",
    "persistUpdateChecklistItem(itemId, patch, activeBoardRequestOptions)",
    "persistDeleteChecklistItem(itemId, activeBoardRequestOptions)",
    "persistUploadTaskAttachments(taskId, files, activeBoardRequestOptions)",
    "persistCreateTaskNote(taskId, body, activeBoardRequestOptions)",
    "persistFetchRecycleBin(activeBoardRequestOptions)",
    "persistRestoreRecycleBinTask(taskId, activeBoardRequestOptions)",
    "persistFetchArchives(activeBoardRequestOptions)",
    "persistRestoreArchiveTask(taskId, activeBoardRequestOptions)",
  ];

  for (const expectedCall of supportedCoreCalls) {
    assert.ok(source.includes(expectedCall), `missing active board context for ${expectedCall}`);
  }

  assert.match(
    source,
    /persistCreateTask\(\s*bucketId,\s*trimmedTitle,\s*activeBoardRequestOptions,\s*workItemType/,
    "task creation should keep the active-board request context before work-item fields",
  );

  assert.match(source, /requirePersonalBoardAction\("Import"\)/);
  assert.match(source, /persistenceEnabled && isPersonalActiveBoard/);
  assert.match(source, /requireEditableBoard\("You can view this board, but you do not have permission to create tasks\."\)/);
  assert.match(source, /isBucketDragDisabled=\{isTaskSearchActive \|\| !currentBoardPermissions\.canEdit\}/);
});

test("frontend viewer board UI disables mutation controls", () => {
  const source = readFileSync("src/components/taskboard.tsx", "utf8");

  assert.match(source, /const isReadOnlyBoard = !currentBoardPermissions\.canEdit/);
  assert.match(source, /data-testid="board-read-only-indicator"/);
  assert.match(source, /const canMutateTask = canEditBoard && !isReadOnlyImport/);
  assert.match(source, /canCreateTask = canEditBoard && Boolean\(emptyStateNewTaskBucket\)/);
  assert.match(source, /disabled=\{!canMutateTask\}/);
  assert.match(source, /disabled=\{!canEditBoard\}/);
  assert.match(source, /canEditBoard=\{canMutateTask\}/);
  assert.match(source, /Read-only board\. Task edits are disabled for viewer access\./);
  assert.match(source, /Read-only board\. Task creation is disabled for viewer access\./);
  assert.match(source, /setMutationError\("You can view this board, but you do not have permission to move items\."\)/);
});

test("main page deep-link board id uses access-controlled initial board loading", () => {
  const source = readFileSync("src/app/page.tsx", "utf8");

  assert.match(source, /searchParams\?: Promise<HomeSearchParams>/);
  assert.match(source, /requestedBoardId = getFirstSearchParamValue\(resolvedSearchParams\.boardId\)/);
  assert.match(source, /if \(requestedBoardId !== undefined\)/);
  assert.match(source, /loadTaskboardState\(user, \{ boardId: requestedBoardId \}\)/);
  assert.match(source, /loadPreferredTaskboardState\(user\)/);
  assert.match(source, /persistInitialBoardSelection = true/);
  assert.match(source, /error instanceof BoardAccessError/);
  assert.match(source, /loadTaskboardState\(user\)/);
  assert.match(source, /persistInitialBoardSelection = false/);
  assert.match(source, /withCurrentBoard\(await listAccessibleBoards\(user\), state\.board\.id\)/);
  assert.match(source, /initialPersonalBoardId=\{accessibleBoardState\.personalBoardId\}/);
  assert.match(source, /initialBoardNotice=\{initialBoardNotice\}/);
  assert.match(source, /persistInitialBoardSelection=\{persistInitialBoardSelection\}/);
});

test("selected-board preference schema and store helpers are additive and access validated", () => {
  const schema = readFileSync("db/baseline/schema.sql", "utf8");
  const boardAccess = readFileSync("src/lib/board-access.ts", "utf8");
  const store = readFileSync("src/lib/taskboard-store.ts", "utf8");
  const baseline = readFileSync("src/lib/schema-baseline.ts", "utf8");
  const route = readFileSync("src/app/api/boards/selected/route.ts", "utf8");
  const teamVisibilityRoute = readFileSync(
    "src/app/api/teams/[teamId]/personal-board-visibility/route.ts",
    "utf8",
  );
  const teamPolicy = readFileSync("src/lib/team-policy.ts", "utf8");

  assert.match(schema, /last_selected_board_id UUID/);
  assert.match(schema, /FOREIGN KEY \(last_selected_board_id\) REFERENCES boards\(id\) ON DELETE SET NULL/);
  assert.match(schema, /CREATE TABLE app_permission_settings/);
  assert.match(schema, /same_team_personal_board_visibility_allowed BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(schema, /default_personal_board_visibility TEXT NOT NULL DEFAULT 'private'/);
  assert.match(schema, /personal_board_view_enabled BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(schema, /personal_visibility TEXT/);
  assert.match(schema, /personal_visibility_team_id UUID REFERENCES teams\(id\) ON DELETE SET NULL/);
  assert.match(schema, /personal_visibility = 'private' AND personal_visibility_team_id IS NULL/);
  assert.match(schema, /personal_visibility = 'team_visible' AND personal_visibility_team_id IS NOT NULL/);
  assert.match(store, /export async function loadPreferredTaskboardState/);
  assert.match(store, /fetchPreferredBoardStateForUser/);
  assert.match(store, /last_selected_board_id/);
  assert.match(store, /clearStaleSelectedBoardPreferenceForUser/);
  assert.match(
    store,
    /if \(options\.boardId === null \|\| options\.boardId === undefined\) \{[\s\S]*clearStaleSelectedBoardPreferenceForUser\(client, user, userId\)/,
  );
  assert.match(
    store,
    /resolveBoardContext\([\s\S]*\{ \.\.\.user, id: userId \},[\s\S]*\{ boardId: preferredBoardId \},[\s\S]*"read"/,
  );
  assert.match(store, /catch \(error\) \{[\s\S]*if \(error instanceof BoardAccessError\)/);
  assert.match(store, /clearSelectedBoardPreferenceByUserId\(client, userId\)/);
  assert.match(store, /resolveBoardContext\([\s\S]*client,[\s\S]*user,[\s\S]*\{ boardId: normalizedBoardId \},[\s\S]*"read"/);
  assert.match(store, /const selectedBoardId = board\.id === personalBoard\.id \? null : board\.id/);
  assert.match(store, /isSameTeamPersonalBoardViewEnabled/);
  assert.match(store, /sameTeamPersonalBoardViewEnabled/);
  assert.match(baseline, /CREATE TABLE IF NOT EXISTS app_permission_settings/);
  assert.match(baseline, /same_team_personal_board_visibility_allowed BOOLEAN NOT NULL DEFAULT FALSE/);
  assert.match(baseline, /default_personal_board_visibility TEXT NOT NULL DEFAULT 'private'/);
  assert.match(baseline, /ALTER TABLE boards ADD COLUMN IF NOT EXISTS personal_visibility TEXT/);
  assert.match(baseline, /personal_visibility = 'private'/);
  assert.match(store, /WHERE boards\.id = \$1/);
  assert.match(store, /boards\.personal_visibility = 'team_visible'/);
  assert.match(store, /boards\.personal_visibility_team_id IS NOT NULL/);
  assert.match(store, /app_permission_settings\.same_team_personal_board_visibility_allowed IS TRUE/);
  assert.match(store, /owner_members\.user_id = boards\.owner_user_id/);
  assert.match(store, /shared_teams\.archived_at IS NULL/);
  assert.match(store, /shared_teams\.personal_board_view_enabled IS TRUE/);
  assert.match(baseline, /ALTER TABLE teams ADD COLUMN IF NOT EXISTS personal_board_view_enabled/);
  assert.match(baseline, /UPDATE teams SET personal_board_view_enabled = FALSE/);
  assert.match(store, /export async function updateTeamPersonalBoardVisibility/);
  assert.match(store, /calculateTeamPersonalBoardVisibilityImpact/);
  assert.match(boardAccess, /shared_teams\.personal_board_view_enabled IS TRUE/);
  assert.match(boardAccess, /context\.personal_visibility = 'team_visible'/);
  assert.match(boardAccess, /context\.personal_visibility_team_id IS NOT NULL/);
  assert.match(boardAccess, /app_permission_settings\.same_team_personal_board_visibility_allowed IS TRUE/);

  assert.match(route, /export async function PUT/);
  assert.match(route, /requireTaskboardUserFromHeaders\(request\)/);
  assert.match(route, /saveSelectedBoardPreference\(user, body\.boardId\)/);
  assert.match(route, /boardId must be a UUID string or null/);

  assert.match(teamVisibilityRoute, /export async function GET/);
  assert.match(teamVisibilityRoute, /export async function PATCH/);
  assert.match(teamVisibilityRoute, /parsePersonalBoardVisibilityBody/);
  assert.match(teamVisibilityRoute, /getTeamPersonalBoardVisibilityImpact/);
  assert.match(teamVisibilityRoute, /updateTeamPersonalBoardVisibility/);
  assert.match(teamVisibilityRoute, /Request body must include only enabled/);
  assert.match(teamPolicy, /assertCanManageTeamPersonalBoardVisibility/);
  assert.match(teamPolicy, /Taskboard admin access is required/);
  assert.match(teamPolicy, /team\.personal_board_view_policy_changed/);
});

test("teams page exposes normal open-board links for team boards", () => {
  const source = readFileSync("src/components/teams-page.tsx", "utf8");

  assert.ok(source.includes('href={`/?boardId=${encodeURIComponent(board.boardId)}`}'));
  assert.match(source, /Open board/);
  assert.match(source, /ExternalLink/);
});

test("team-board member grant APIs are scoped to team boards and audit changes", () => {
  const collectionRoute = readFileSync(
    "src/app/api/teams/[teamId]/boards/[boardId]/members/route.ts",
    "utf8",
  );
  const itemRoute = readFileSync(
    "src/app/api/teams/[teamId]/boards/[boardId]/members/[userId]/route.ts",
    "utf8",
  );
  const store = readFileSync("src/lib/taskboard-store.ts", "utf8");

  assert.match(collectionRoute, /listTeamBoardMemberGrants/);
  assert.match(collectionRoute, /addTeamBoardMemberGrant/);
  assert.match(itemRoute, /updateTeamBoardMemberGrant/);
  assert.match(itemRoute, /removeTeamBoardMemberGrant/);
  assert.match(collectionRoute, /Board member grant already exists/);

  assert.match(store, /getTeamBoardRowForTeam\(client, team\.id, boardId/);
  assert.match(store, /assertCanViewTeam\(actorWithId/);
  assert.match(store, /assertCanManageTeam\(actorWithId/);
  assert.match(store, /Board member grants require an existing team member/);
  assert.match(store, /Disabled users cannot be granted board access/);
  assert.match(store, /Board member grants must strengthen the user's team default access/);
  assert.match(store, /team_board\.member_grant\.added/);
  assert.match(store, /team_board\.member_grant\.changed/);
  assert.match(store, /team_board\.member_grant\.removed/);
  assert.match(store, /targetBoardId: board\.id/);
  assert.match(store, /DELETE FROM board_members\s+USING boards/);
  assert.match(store, /reason: "team_member_removed"/);
});

test("teams page renders compact team-board member grant management", () => {
  const source = readFileSync("src/components/teams-page.tsx", "utf8");

  assert.match(source, /type TeamBoardMemberGrant/);
  assert.match(source, /boardGrantsByBoardId/);
  assert.match(source, /fetchTeamBoardGrants/);
  assert.match(source, /addBoardGrant/);
  assert.match(source, /updateBoardGrant/);
  assert.match(source, /removeBoardGrant/);
  assert.match(source, /Explicit member grants/);
  assert.match(source, /Removing a grant reverts to that default/);
  assert.match(source, /member\.teamRole === "member"/);
  assert.match(source, /!member\.isDisabled/);
  assert.match(source, /Add grant/);
});

test("teams page renders admin-only same-team personal-board visibility controls", () => {
  const source = readFileSync("src/components/teams-page.tsx", "utf8");

  assert.match(source, /type TeamPersonalBoardVisibilityImpact/);
  assert.match(source, /loadPersonalBoardVisibilityImpact/);
  assert.match(source, /updatePersonalBoardVisibility/);
  assert.match(source, /personal-board-visibility/);
  assert.match(source, /canTogglePersonalBoardVisibility = currentUser\.role === "admin"/);
  assert.match(source, /Personal board visibility/);
  assert.match(source, /Preview impact/);
  assert.match(source, /affectedUsers/);
  assert.match(source, /Visibility pairs/);
  assert.match(source, /await confirm\(\{/);
  assert.match(source, /view each other's personal boards as read-only/);
});
