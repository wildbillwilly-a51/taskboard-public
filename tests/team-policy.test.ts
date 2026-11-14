import assert from "node:assert/strict";
import test from "node:test";
import {
  assertActiveTeamManagerWouldRemain,
  assertCanCreateTeam,
  assertCanManageTeam,
  assertCanManageTeamMembers,
  assertCanManageTeamPersonalBoardVisibility,
  assertCanViewTeam,
  evaluateTeamPersonalBoardVisibilityUpdate,
  canCreateTeam,
  canManageTeamPersonalBoardVisibility,
  canManageTeam,
  canViewTeam,
  evaluateTeamMetadataUpdate,
  isValidTeamBoardDefaultAccess,
  isValidTeamBoardMemberGrantRole,
  isValidTeamMemberRole,
  normalizeTeamBoardDefaultAccess,
  normalizeTeamBoardDescription,
  normalizeTeamBoardTitle,
  normalizeTeamPersonalBoardVisibilityEnabled,
  normalizeTeamName,
  type TeamActor,
  type TeamAccessContext,
} from "../src/lib/team-policy";

const admin: TeamActor = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "admin",
  isDisabled: false,
};

const appManager: TeamActor = {
  id: "00000000-0000-4000-8000-000000000002",
  role: "manager",
  isDisabled: false,
};

const standardUser: TeamActor = {
  id: "00000000-0000-4000-8000-000000000003",
  role: "standard",
  isDisabled: false,
};

const disabledAdmin: TeamActor = {
  ...admin,
  isDisabled: true,
};

const memberContext: TeamAccessContext = {
  actorMembershipRole: "member",
  isArchived: false,
};

const managerContext: TeamAccessContext = {
  actorMembershipRole: "manager",
  isArchived: false,
};

test("app admins and managers can create teams but standard and disabled users cannot", () => {
  assert.equal(canCreateTeam(admin), true);
  assert.equal(canCreateTeam(appManager), true);
  assert.equal(canCreateTeam(standardUser), false);
  assert.equal(canCreateTeam(disabledAdmin), false);

  assert.doesNotThrow(() => assertCanCreateTeam(admin));
  assert.throws(() => assertCanCreateTeam(standardUser), /manager or admin access/);
  assert.throws(() => assertCanCreateTeam(disabledAdmin), /manager or admin access/);
});

test("team visibility allows admins and members but not unrelated users", () => {
  assert.equal(canViewTeam(admin, { actorMembershipRole: null }), true);
  assert.equal(canViewTeam(standardUser, memberContext), true);
  assert.equal(canViewTeam(standardUser, { actorMembershipRole: null }), false);
  assert.equal(canViewTeam(disabledAdmin, managerContext), false);

  assert.doesNotThrow(() => assertCanViewTeam(standardUser, memberContext));
  assert.throws(
    () => assertCanViewTeam(standardUser, { actorMembershipRole: null }),
    /Team access is required/,
  );
});

test("team management allows admins and team managers only", () => {
  assert.equal(canManageTeam(admin, { actorMembershipRole: null }), true);
  assert.equal(canManageTeam(standardUser, managerContext), true);
  assert.equal(canManageTeam(appManager, memberContext), false);
  assert.equal(canManageTeam(standardUser, memberContext), false);
  assert.equal(canManageTeam(standardUser, { ...managerContext, isArchived: true }), false);

  assert.doesNotThrow(() => assertCanManageTeamMembers(standardUser, managerContext));
  assert.throws(
    () => assertCanManageTeam(appManager, memberContext),
    /Team management access is required/,
  );
});

test("team metadata updates are trimmed and produce audit drafts", () => {
  const result = evaluateTeamMetadataUpdate(
    standardUser,
    managerContext,
    { name: "Operations", description: "Current" },
    { name: "  Ops  ", description: "  Updated  " },
  );

  assert.equal(result.name, "Ops");
  assert.equal(result.description, "Updated");
  assert.equal(result.auditEvents.length, 1);
  assert.equal(result.auditEvents[0].action, "team.updated");
  assert.deepEqual(result.auditEvents[0].previousValues, {
    name: "Operations",
    description: "Current",
  });
  assert.deepEqual(result.auditEvents[0].newValues, {
    name: "Ops",
    description: "Updated",
  });

  assert.throws(
    () =>
      evaluateTeamMetadataUpdate(
        standardUser,
        memberContext,
        { name: "Operations", description: "" },
        { name: "Ops" },
      ),
    /Team management access is required/,
  );
});

test("team personal-board visibility policy is admin-only and audited on change", () => {
  assert.equal(canManageTeamPersonalBoardVisibility(admin), true);
  assert.equal(canManageTeamPersonalBoardVisibility(appManager), false);
  assert.equal(canManageTeamPersonalBoardVisibility(standardUser), false);
  assert.equal(canManageTeamPersonalBoardVisibility(disabledAdmin), false);

  assert.doesNotThrow(() => assertCanManageTeamPersonalBoardVisibility(admin));
  assert.throws(
    () => assertCanManageTeamPersonalBoardVisibility(appManager),
    /Taskboard admin access is required/,
  );

  assert.equal(normalizeTeamPersonalBoardVisibilityEnabled(true), true);
  assert.equal(normalizeTeamPersonalBoardVisibilityEnabled(false), false);
  assert.throws(
    () => normalizeTeamPersonalBoardVisibilityEnabled("true"),
    /Personal board visibility enabled must be a boolean/,
  );

  const changed = evaluateTeamPersonalBoardVisibilityUpdate(
    admin,
    { actorMembershipRole: null, isArchived: false },
    { personalBoardViewEnabled: false },
    { enabled: true },
  );

  assert.equal(changed.enabled, true);
  assert.equal(changed.auditEvents.length, 1);
  assert.equal(changed.auditEvents[0].action, "team.personal_board_view_policy_changed");
  assert.deepEqual(changed.auditEvents[0].previousValues, {
    personalBoardViewEnabled: false,
  });
  assert.deepEqual(changed.auditEvents[0].newValues, {
    personalBoardViewEnabled: true,
  });

  const noOp = evaluateTeamPersonalBoardVisibilityUpdate(
    admin,
    { actorMembershipRole: null, isArchived: false },
    { personalBoardViewEnabled: true },
    { enabled: true },
  );
  assert.equal(noOp.auditEvents.length, 0);

  assert.throws(
    () =>
      evaluateTeamPersonalBoardVisibilityUpdate(
        standardUser,
        managerContext,
        { personalBoardViewEnabled: false },
        { enabled: true },
      ),
    /Taskboard admin access is required/,
  );

  assert.throws(
    () =>
      evaluateTeamPersonalBoardVisibilityUpdate(
        admin,
        { actorMembershipRole: null, isArchived: true },
        { personalBoardViewEnabled: false },
        { enabled: true },
      ),
    /Archived teams cannot change personal board visibility/,
  );
});

test("team names and member roles are validated", () => {
  assert.equal(normalizeTeamName("  Research  "), "Research");
  assert.throws(() => normalizeTeamName("   "), /Team name is required/);
  assert.equal(isValidTeamMemberRole("manager"), true);
  assert.equal(isValidTeamMemberRole("member"), true);
  assert.equal(isValidTeamMemberRole("owner"), false);
});

test("team board metadata and default access are validated", () => {
  assert.equal(normalizeTeamBoardTitle("  Roadmap  "), "Roadmap");
  assert.equal(normalizeTeamBoardDescription("  Planning  "), "Planning");
  assert.equal(normalizeTeamBoardDefaultAccess(undefined), "viewer");
  assert.equal(normalizeTeamBoardDefaultAccess(""), "viewer");
  assert.equal(normalizeTeamBoardDefaultAccess("viewer"), "viewer");
  assert.equal(normalizeTeamBoardDefaultAccess("editor"), "editor");
  assert.equal(isValidTeamBoardDefaultAccess("viewer"), true);
  assert.equal(isValidTeamBoardDefaultAccess("editor"), true);
  assert.equal(isValidTeamBoardDefaultAccess("owner"), false);

  assert.throws(() => normalizeTeamBoardTitle("   "), /Team board title is required/);
  assert.throws(
    () => normalizeTeamBoardDefaultAccess("owner"),
    /Team board default access must be viewer or editor/,
  );
});

test("team board member grant roles are validated", () => {
  assert.equal(isValidTeamBoardMemberGrantRole("viewer"), true);
  assert.equal(isValidTeamBoardMemberGrantRole("editor"), true);
  assert.equal(isValidTeamBoardMemberGrantRole("owner"), true);
  assert.equal(isValidTeamBoardMemberGrantRole("manager"), false);
  assert.equal(isValidTeamBoardMemberGrantRole("admin"), false);
});

test("last active team manager cannot be removed or demoted", () => {
  assert.throws(
    () =>
      assertActiveTeamManagerWouldRemain({
        actor: admin,
        targetUserIsDisabled: false,
        targetCurrentRole: "manager",
        targetNextRole: "member",
        activeManagerCount: 1,
      }),
    /at least one active manager/,
  );

  assert.doesNotThrow(() =>
    assertActiveTeamManagerWouldRemain({
      actor: admin,
      targetUserIsDisabled: false,
      targetCurrentRole: "manager",
      targetNextRole: "member",
      activeManagerCount: 2,
    }),
  );

  assert.doesNotThrow(() =>
    assertActiveTeamManagerWouldRemain({
      actor: admin,
      targetUserIsDisabled: true,
      targetCurrentRole: "manager",
      targetNextRole: null,
      activeManagerCount: 0,
    }),
  );

  assert.doesNotThrow(() =>
    assertActiveTeamManagerWouldRemain({
      actor: admin,
      targetUserIsDisabled: false,
      targetCurrentRole: "manager",
      targetNextRole: null,
      activeManagerCount: 1,
      isArchivingTeam: true,
    }),
  );
});
