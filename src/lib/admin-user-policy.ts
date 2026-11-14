import type { TaskboardAuthProvider, TaskboardUserRole } from "@/lib/auth";

export type AdminActor = {
  id?: string;
  role?: TaskboardUserRole;
  isDisabled?: boolean;
};

export type AdminManagedUser = {
  id: string;
  role: TaskboardUserRole;
  isDisabled: boolean;
  isReservedLocalAdmin: boolean;
  authProvider: TaskboardAuthProvider;
};

export type AdminUserUpdateInput = {
  role?: TaskboardUserRole;
  isDisabled?: boolean;
};

export type AdminAuditEventDraft = {
  action: "user.role_changed" | "user.disabled_changed";
  previousValues: Record<string, unknown>;
  newValues: Record<string, unknown>;
};

const validRoles = new Set<TaskboardUserRole>(["standard", "manager", "admin"]);

export function assertAdminActor(actor: AdminActor) {
  if (!actor.id || actor.role !== "admin" || actor.isDisabled) {
    throw new Error("Taskboard admin access is required.");
  }
}

export function evaluateAdminUserUpdate(
  actor: AdminActor,
  target: AdminManagedUser,
  input: AdminUserUpdateInput,
) {
  assertAdminActor(actor);

  if (input.role !== undefined && !validRoles.has(input.role)) {
    throw new Error("Invalid user role.");
  }

  if (input.isDisabled !== undefined && typeof input.isDisabled !== "boolean") {
    throw new Error("Invalid disabled state.");
  }

  if (target.isReservedLocalAdmin) {
    if (input.role !== undefined && input.role !== target.role) {
      throw new Error("Reserved local admin cannot be demoted.");
    }

    if (input.isDisabled !== undefined && input.isDisabled !== target.isDisabled) {
      throw new Error("Reserved local admin cannot be disabled.");
    }
  }

  if (actor.id === target.id) {
    if (input.role !== undefined && input.role !== "admin") {
      throw new Error("Admins cannot demote their own account.");
    }

    if (input.isDisabled === true && !target.isDisabled) {
      throw new Error("Admins cannot disable their own account.");
    }
  }

  const next = {
    role: input.role ?? target.role,
    isDisabled: input.isDisabled ?? target.isDisabled,
  };
  const auditEvents: AdminAuditEventDraft[] = [];

  if (next.role !== target.role) {
    auditEvents.push({
      action: "user.role_changed",
      previousValues: { role: target.role },
      newValues: { role: next.role },
    });
  }

  if (next.isDisabled !== target.isDisabled) {
    auditEvents.push({
      action: "user.disabled_changed",
      previousValues: { isDisabled: target.isDisabled },
      newValues: { isDisabled: next.isDisabled },
    });
  }

  return {
    role: next.role,
    isDisabled: next.isDisabled,
    auditEvents,
  };
}
