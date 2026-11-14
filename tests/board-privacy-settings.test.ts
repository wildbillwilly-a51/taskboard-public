import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildBoardPrivacyGateStatus,
  canPatchBoardPrivacySettings,
  canViewBoardPrivacySettings,
  evaluateBoardPrivacySettingsUpdate,
  parseBoardPrivacySettingsPatchBody,
} from "../src/lib/board-privacy-policy";

const ownerId = "00000000-0000-4000-8000-000000000001";
const otherUserId = "00000000-0000-4000-8000-000000000002";
const teamId = "00000000-0000-4000-8000-000000000003";
const unrelatedTeamId = "00000000-0000-4000-8000-000000000004";
const personalBoard = {
  id: "00000000-0000-4000-8000-000000000005",
  boardType: "personal" as const,
  ownerUserId: ownerId,
  personalVisibility: "private" as const,
  personalVisibilityTeamId: null,
};
const teamBoard = {
  ...personalBoard,
  boardType: "team" as const,
  ownerUserId: null,
};

test("board privacy patch body is strict and normalizes private/team_visible states", () => {
  assert.deepEqual(
    parseBoardPrivacySettingsPatchBody({
      personalVisibility: "private",
      personalVisibilityTeamId: teamId,
    }),
    {
      personalVisibility: "private",
      personalVisibilityTeamId: null,
    },
  );
  assert.deepEqual(
    parseBoardPrivacySettingsPatchBody({
      personalVisibility: "team_visible",
      personalVisibilityTeamId: teamId,
    }),
    {
      personalVisibility: "team_visible",
      personalVisibilityTeamId: teamId,
    },
  );

  assert.throws(
    () => parseBoardPrivacySettingsPatchBody({ unknown: true }),
    /Unknown board privacy setting/,
  );
  assert.throws(
    () =>
      parseBoardPrivacySettingsPatchBody({
        personalVisibility: "public",
        personalVisibilityTeamId: teamId,
      }),
    /personalVisibility must be private or team_visible/,
  );
  assert.throws(
    () => parseBoardPrivacySettingsPatchBody({ personalVisibility: "team_visible" }),
    /team_visible boards require personalVisibilityTeamId/,
  );
  assert.throws(
    () =>
      parseBoardPrivacySettingsPatchBody({
        personalVisibility: "team_visible",
        personalVisibilityTeamId: "not-a-uuid",
      }),
    /personalVisibilityTeamId must be a valid UUID/,
  );
  assert.throws(
    () => parseBoardPrivacySettingsPatchBody(null),
    /Request body must include personalVisibility/,
  );
});

test("board privacy settings are visible only to the actual owner, including admins", () => {
  assert.equal(
    canViewBoardPrivacySettings(
      { id: ownerId, role: "standard", isDisabled: false },
      personalBoard,
    ),
    true,
  );
  assert.equal(
    canViewBoardPrivacySettings(
      { id: otherUserId, role: "admin", isDisabled: false },
      personalBoard,
    ),
    false,
  );
  assert.equal(
    canViewBoardPrivacySettings(
      { id: otherUserId, role: "standard", isDisabled: false },
      personalBoard,
    ),
    false,
  );
  assert.equal(
    canViewBoardPrivacySettings(
      { id: otherUserId, role: "manager", isDisabled: false },
      personalBoard,
    ),
    false,
  );
  assert.equal(
    canViewBoardPrivacySettings(
      { id: ownerId, role: "standard", isDisabled: true },
      personalBoard,
    ),
    false,
  );
});

test("owners need the privacy gate; only an admin owning the board may bypass that gate", () => {
  assert.equal(
    canPatchBoardPrivacySettings({
      actor: { id: ownerId, role: "standard", isDisabled: false },
      board: personalBoard,
      usersCanMakeBoardsPrivate: true,
    }),
    true,
  );
  assert.equal(
    canPatchBoardPrivacySettings({
      actor: { id: ownerId, role: "standard", isDisabled: false },
      board: personalBoard,
      usersCanMakeBoardsPrivate: false,
    }),
    false,
  );
  assert.equal(
    canPatchBoardPrivacySettings({
      actor: { id: otherUserId, role: "admin", isDisabled: false },
      board: personalBoard,
      usersCanMakeBoardsPrivate: false,
    }),
    false,
  );
});

test("board privacy update enforces eligible owner teams and audit only on changes", () => {
  const eligibleTeamIds = new Set([teamId]);
  const changed = evaluateBoardPrivacySettingsUpdate({
    actor: { id: ownerId, role: "standard", isDisabled: false },
    board: personalBoard,
    usersCanMakeBoardsPrivate: true,
    eligibleTeamIds,
    input: {
      personalVisibility: "team_visible",
      personalVisibilityTeamId: teamId,
    },
  });

  assert.equal(changed.changed, true);
  assert.deepEqual(changed.settings, {
    personalVisibility: "team_visible",
    personalVisibilityTeamId: teamId,
  });
  assert.equal(changed.auditEvents.length, 1);
  assert.equal(changed.auditEvents[0].action, "board.privacy_changed");
  assert.deepEqual(changed.auditEvents[0].previousValues, {
    personalVisibility: "private",
    personalVisibilityTeamId: null,
  });
  assert.deepEqual(changed.auditEvents[0].newValues, {
    personalVisibility: "team_visible",
    personalVisibilityTeamId: teamId,
  });

  const noOp = evaluateBoardPrivacySettingsUpdate({
    actor: { id: ownerId, role: "standard", isDisabled: false },
    board: personalBoard,
    usersCanMakeBoardsPrivate: true,
    eligibleTeamIds,
    input: {
      personalVisibility: "private",
      personalVisibilityTeamId: null,
    },
  });
  assert.equal(noOp.changed, false);
  assert.equal(noOp.auditEvents.length, 0);

  assert.throws(
    () =>
      evaluateBoardPrivacySettingsUpdate({
        actor: { id: ownerId, role: "standard", isDisabled: false },
        board: personalBoard,
        usersCanMakeBoardsPrivate: true,
        eligibleTeamIds,
        input: {
          personalVisibility: "team_visible",
          personalVisibilityTeamId: unrelatedTeamId,
        },
      }),
    /Selected team is not eligible/,
  );
});

test("board privacy update rejects non-owner grants, team managers, disabled users, and team boards", () => {
  const eligibleTeamIds = new Set([teamId]);
  const input = {
    personalVisibility: "team_visible" as const,
    personalVisibilityTeamId: teamId,
  };

  for (const actor of [
    { id: otherUserId, role: "standard" as const, isDisabled: false },
    { id: otherUserId, role: "manager" as const, isDisabled: false },
    { id: ownerId, role: "standard" as const, isDisabled: true },
  ]) {
    assert.throws(
      () =>
        evaluateBoardPrivacySettingsUpdate({
          actor,
          board: personalBoard,
          usersCanMakeBoardsPrivate: true,
          eligibleTeamIds,
          input,
        }),
      /Taskboard board privacy access is required/,
    );
  }

  assert.throws(
    () =>
      evaluateBoardPrivacySettingsUpdate({
        actor: { id: ownerId, role: "admin", isDisabled: false },
        board: teamBoard,
        usersCanMakeBoardsPrivate: true,
        eligibleTeamIds,
        input,
      }),
    /only for personal boards/,
  );
});

test("board privacy gates explain closed and open states without exposing raw env", () => {
  assert.deepEqual(
    buildBoardPrivacyGateStatus({
      envGate: "not_enabled",
      globalSettingEnabled: true,
      boardMarkedTeamVisible: true,
      selectedTeamPolicyEnabled: true,
      ownerInSelectedTeam: true,
    }),
    {
      envGate: "not_enabled",
      globalSettingEnabled: true,
      boardMarkedTeamVisible: true,
      selectedTeamPolicyEnabled: true,
      ownerInSelectedTeam: true,
      effectiveVisibleToTeammates: false,
      reason: "Not visible to teammates because the runtime env gate is off.",
    },
  );

  assert.equal(
    buildBoardPrivacyGateStatus({
      envGate: "enabled",
      globalSettingEnabled: true,
      boardMarkedTeamVisible: true,
      selectedTeamPolicyEnabled: true,
      ownerInSelectedTeam: true,
    }).effectiveVisibleToTeammates,
    true,
  );
});

test("board privacy route, store, audit page, and taskboard UI are wired narrowly", () => {
  const route = readFileSync("src/app/api/boards/[boardId]/settings/route.ts", "utf8");
  const store = readFileSync("src/lib/taskboard-store.ts", "utf8");
  const component = readFileSync("src/components/taskboard.tsx", "utf8");
  const auditPage = readFileSync("src/components/admin-audit-page.tsx", "utf8");

  assert.match(route, /export async function GET/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /parseBoardPrivacySettingsPatchBody/);
  assert.match(route, /getBoardPrivacySettings/);
  assert.match(route, /updateBoardPrivacySettings/);
  assert.doesNotMatch(route, /process\.env/);

  assert.match(store, /export async function getBoardPrivacySettings/);
  assert.match(store, /export async function updateBoardPrivacySettings/);
  assert.match(store, /boards\.personal_visibility/);
  assert.match(store, /boards\.personal_visibility_team_id/);
  assert.match(store, /team_members\.user_id = \$1/);
  assert.match(store, /users_can_make_boards_private/);
  assert.match(store, /target_board_id, action, previous_values, new_values/);
  assert.match(store, /policyResult\.auditEvents/);
  assert.doesNotMatch(store, /local_password_hash AS/);
  assert.doesNotMatch(store, /token_hash AS/);

  assert.match(component, /aria-label="Share board"/);
  assert.match(component, /Who can see this board/);
  assert.match(component, /Teammates can only view a team-visible board after an administrator turns/);
  assert.match(component, /persistLoadBoardPrivacySettings/);
  assert.match(component, /persistUpdateBoardPrivacySettings/);
  assert.match(component, /currentAccessibleBoard\.ownerUserId === currentUser\.id/);
  assert.doesNotMatch(component, /sectioned board picker/i);

  assert.match(auditPage, /board\.privacy_changed/);
});
