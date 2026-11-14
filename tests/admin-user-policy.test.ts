import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAdminActor,
  evaluateAdminUserUpdate,
  type AdminActor,
  type AdminManagedUser,
} from "../src/lib/admin-user-policy";

const admin: AdminActor = {
  id: "00000000-0000-0000-0000-000000000001",
  role: "admin",
  isDisabled: false,
};

const standardUser: AdminManagedUser = {
  id: "00000000-0000-0000-0000-000000000002",
  role: "standard",
  isDisabled: false,
  isReservedLocalAdmin: false,
  authProvider: "authelia",
};

const reservedAdmin: AdminManagedUser = {
  id: "00000000-0000-0000-0000-000000000003",
  role: "admin",
  isDisabled: false,
  isReservedLocalAdmin: true,
  authProvider: "local",
};

test("admin can list users but standard user cannot", () => {
  assert.doesNotThrow(() => assertAdminActor(admin));
  assert.throws(
    () =>
      assertAdminActor({
        id: "00000000-0000-0000-0000-000000000004",
        role: "standard",
        isDisabled: false,
      }),
    /admin access is required/,
  );
});

test("admin can change non-reserved user role and audit event is written", () => {
  const result = evaluateAdminUserUpdate(admin, standardUser, { role: "manager" });

  assert.equal(result.role, "manager");
  assert.equal(result.auditEvents.length, 1);
  assert.equal(result.auditEvents[0].action, "user.role_changed");
  assert.deepEqual(result.auditEvents[0].previousValues, { role: "standard" });
  assert.deepEqual(result.auditEvents[0].newValues, { role: "manager" });
});

test("admin can disable and enable non-reserved user with audit events", () => {
  const disabled = evaluateAdminUserUpdate(admin, standardUser, { isDisabled: true });

  assert.equal(disabled.isDisabled, true);
  assert.equal(disabled.auditEvents.length, 1);
  assert.equal(disabled.auditEvents[0].action, "user.disabled_changed");
  assert.deepEqual(disabled.auditEvents[0].previousValues, { isDisabled: false });
  assert.deepEqual(disabled.auditEvents[0].newValues, { isDisabled: true });

  const enabled = evaluateAdminUserUpdate(
    admin,
    { ...standardUser, isDisabled: true },
    { isDisabled: false },
  );

  assert.equal(enabled.isDisabled, false);
  assert.equal(enabled.auditEvents[0].action, "user.disabled_changed");
});

test("reserved local admin cannot be disabled or demoted", () => {
  assert.throws(
    () => evaluateAdminUserUpdate(admin, reservedAdmin, { isDisabled: true }),
    /Reserved local admin cannot be disabled/,
  );
  assert.throws(
    () => evaluateAdminUserUpdate(admin, reservedAdmin, { role: "manager" }),
    /Reserved local admin cannot be demoted/,
  );
});

test("admin cannot disable or demote self", () => {
  const self: AdminManagedUser = {
    ...standardUser,
    id: admin.id ?? "",
    role: "admin",
  };

  assert.throws(
    () => evaluateAdminUserUpdate(admin, self, { isDisabled: true }),
    /cannot disable their own account/,
  );
  assert.throws(
    () => evaluateAdminUserUpdate(admin, self, { role: "manager" }),
    /cannot demote their own account/,
  );
});
