import assert from "node:assert/strict";
import test from "node:test";
import {
  buildBoardPickerSections,
  type BoardPickerSectionId,
} from "../src/components/board-picker-sections";
import type { AccessibleBoardSummary } from "../src/lib/board-access";

const currentUserId = "user-current";

function board(overrides: Partial<AccessibleBoardSummary> = {}): AccessibleBoardSummary {
  return {
    boardId: "board-personal",
    title: "Personal Board",
    description: "Owned planning board",
    boardType: "personal",
    ownerUserId: currentUserId,
    ownerDisplayName: "Current User",
    visibility: "private",
    accessLevel: "owner",
    canRead: true,
    canEdit: true,
    canManage: true,
    source: "owner",
    isPersonalBoard: true,
    isTeammatePersonalBoard: false,
    isTeamBoard: false,
    isPrivate: true,
    isTeamVisible: false,
    accessReason: "owner",
    isCurrentBoard: false,
    ...overrides,
  };
}

function sectionIds(boards: AccessibleBoardSummary[], showAdminAccess = false) {
  return buildBoardPickerSections(boards, { showAdminAccess }).sections.map(
    (section) => section.id,
  );
}

function firstBoardIdInSection(
  boards: AccessibleBoardSummary[],
  sectionId: BoardPickerSectionId,
  showAdminAccess = false,
) {
  const result = buildBoardPickerSections(boards, { showAdminAccess });
  const section = result.sections.find((candidate) => candidate.id === sectionId);
  return section?.groups[0]?.boards[0]?.board.boardId ?? null;
}

test("owned personal boards are grouped under My boards", () => {
  const owned = board({ boardId: "owned-personal", isCurrentBoard: true });

  assert.deepEqual(sectionIds([owned]), ["my_boards"]);
  assert.equal(firstBoardIdInSection([owned], "my_boards"), "owned-personal");
});

test("team boards are grouped under Team boards even with explicit grants", () => {
  const teamBoard = board({
    boardId: "team-board",
    title: "Operations Board",
    boardType: "team",
    ownerUserId: null,
    ownerTeamId: "team-ops",
    ownerTeamName: "Operations",
    teamMemberDefaultAccess: "viewer",
    accessLevel: "editor",
    canManage: false,
    source: "board_member",
    isPersonalBoard: false,
    isTeamBoard: true,
    isPrivate: false,
    accessReason: "board_member",
  });

  assert.deepEqual(sectionIds([teamBoard]), ["team_boards"]);
  assert.equal(firstBoardIdInSection([teamBoard], "team_boards"), "team-board");
});

test("same-team personal boards are grouped under Team member boards", () => {
  const teammateBoard = board({
    boardId: "teammate-personal",
    title: "Teammate Planning",
    ownerUserId: "teammate",
    ownerDisplayName: "Team Mate",
    visibility: "team_visible",
    visibilityTeamId: "team-ops",
    visibilityTeamName: "Operations",
    accessLevel: "viewer",
    canEdit: false,
    canManage: false,
    source: "same_team_personal",
    isPersonalBoard: false,
    isTeammatePersonalBoard: true,
    isPrivate: false,
    isTeamVisible: true,
    accessReason: "same_team_personal",
  });

  assert.deepEqual(sectionIds([teammateBoard]), ["team_member_boards"]);
  assert.equal(
    firstBoardIdInSection([teammateBoard], "team_member_boards"),
    "teammate-personal",
  );
});

test("explicit personal board member grants are grouped under Shared with me", () => {
  const shared = board({
    boardId: "shared-personal",
    ownerUserId: "other-user",
    ownerDisplayName: "Other User",
    accessLevel: "viewer",
    canEdit: false,
    canManage: false,
    source: "board_member",
    isPersonalBoard: false,
    isTeammatePersonalBoard: true,
    accessReason: "board_member",
  });

  assert.deepEqual(sectionIds([shared]), ["shared_with_me"]);
  assert.equal(firstBoardIdInSection([shared], "shared_with_me"), "shared-personal");
});

test("admin-only foreign boards are hidden by default and can be shown", () => {
  const adminOnly = board({
    boardId: "admin-only",
    ownerUserId: "other-user",
    ownerDisplayName: "Other User",
    accessLevel: "admin",
    source: "admin",
    isPersonalBoard: false,
    isTeammatePersonalBoard: true,
    accessReason: "admin",
  });

  const hidden = buildBoardPickerSections([adminOnly]);
  assert.deepEqual(hidden.sections.map((section) => section.id), []);
  assert.equal(hidden.hiddenAdminBoardCount, 1);

  const visible = buildBoardPickerSections([adminOnly], { showAdminAccess: true });
  assert.deepEqual(visible.sections.map((section) => section.id), ["admin_access"]);
  assert.equal(visible.sections[0]?.defaultCollapsed, true);
});

test("current admin-only board remains visible while other admin boards stay hidden", () => {
  const currentAdminOnly = board({
    boardId: "current-admin-only",
    ownerUserId: "other-user",
    ownerDisplayName: "Other User",
    accessLevel: "admin",
    source: "admin",
    isPersonalBoard: false,
    isTeammatePersonalBoard: true,
    accessReason: "admin",
  });
  const hiddenAdminOnly = {
    ...currentAdminOnly,
    boardId: "hidden-admin-only",
    title: "Hidden Admin Board",
  };

  const result = buildBoardPickerSections([currentAdminOnly, hiddenAdminOnly], {
    currentBoardId: "current-admin-only",
  });

  assert.deepEqual(result.sections.map((section) => section.id), ["admin_access"]);
  assert.equal(result.hiddenAdminBoardCount, 1);
  assert.equal(result.visibleBoardCount, 1);
  assert.equal(
    result.sections[0]?.groups[0]?.boards[0]?.board.boardId,
    "current-admin-only",
  );
  assert.ok(result.sections[0]?.groups[0]?.boards[0]?.badges.includes("Current"));
});

test("owned boards remain in My boards even when source is admin", () => {
  const ownedAsAdmin = board({
    boardId: "owned-admin-source",
    accessLevel: "admin",
    source: "admin",
    accessReason: "admin",
  });

  assert.deepEqual(sectionIds([ownedAsAdmin], true), ["my_boards"]);
});

test("duplicate boards are suppressed by section precedence", () => {
  const adminVersion = board({
    boardId: "duplicate-board",
    ownerUserId: "other-user",
    ownerDisplayName: "Other User",
    accessLevel: "admin",
    source: "admin",
    isPersonalBoard: false,
    isTeammatePersonalBoard: true,
    accessReason: "admin",
  });
  const explicitVersion = {
    ...adminVersion,
    accessLevel: "editor" as const,
    canManage: false,
    source: "board_member" as const,
    accessReason: "board_member" as const,
  };

  assert.deepEqual(sectionIds([adminVersion, explicitVersion], true), ["shared_with_me"]);
  assert.equal(
    firstBoardIdInSection([adminVersion, explicitVersion], "shared_with_me", true),
    "duplicate-board",
  );
});

test("current board override controls ordering and Current badge", () => {
  const first = board({ boardId: "first", title: "First" });
  const second = board({ boardId: "second", title: "Second" });
  const result = buildBoardPickerSections([first, second], {
    currentBoardId: "second",
  });
  const items = result.sections[0]?.groups[0]?.boards ?? [];

  assert.equal(items[0]?.board.boardId, "second");
  assert.equal(items[0]?.isCurrentBoard, true);
  assert.ok(items[0]?.badges.includes("Current"));
});

test("search matches title, owner, team, access, source, and visibility labels", () => {
  const teamBoard = board({
    boardId: "search-team",
    title: "Platform Roadmap",
    description: "Quarterly work",
    boardType: "team",
    ownerUserId: null,
    ownerTeamId: "team-platform",
    ownerTeamName: "Platform Engineering",
    accessLevel: "viewer",
    canEdit: false,
    canManage: false,
    source: "team_default",
    isPersonalBoard: false,
    isTeamBoard: true,
    isPrivate: false,
    accessReason: "team_default",
  });
  const visiblePersonal = board({
    boardId: "visible-personal",
    title: "Visible Personal",
    ownerUserId: "teammate",
    ownerDisplayName: "Sensitive Owner",
    visibility: "team_visible",
    visibilityTeamName: "Platform Engineering",
    accessLevel: "viewer",
    canEdit: false,
    canManage: false,
    source: "same_team_personal",
    isPersonalBoard: false,
    isTeammatePersonalBoard: true,
    isPrivate: false,
    isTeamVisible: true,
    accessReason: "same_team_personal",
  });

  for (const query of [
    "roadmap",
    "sensitive owner",
    "platform engineering",
    "viewer",
    "team default",
    "team visible",
    "read-only",
  ]) {
    const result = buildBoardPickerSections([teamBoard, visiblePersonal], {
      searchQuery: query,
    });

    assert.ok(result.visibleBoardCount > 0, `expected query "${query}" to match`);
  }
});

test("helper only returns boards supplied by the accessible-board API", () => {
  const suppliedBoards = [
    board({ boardId: "owned-a", title: "Owned A" }),
    board({ boardId: "owned-b", title: "Owned B" }),
  ];
  const result = buildBoardPickerSections(suppliedBoards);
  const returnedIds = result.sections.flatMap((section) =>
    section.groups.flatMap((group) => group.boards.map((item) => item.board.boardId)),
  );

  assert.deepEqual(returnedIds.sort(), ["owned-a", "owned-b"]);
  assert.equal(result.totalBoardCount, 2);
});
