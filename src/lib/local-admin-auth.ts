import "server-only";

import {
  getReservedLocalAdminLoginRecord,
  setReservedLocalAdminPasswordHash,
} from "@/lib/taskboard-store";
import { hashLocalPassword, verifyLocalPassword } from "@/lib/local-password";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";

function normalizeUsername(username: string | undefined) {
  return username?.trim().toLowerCase() ?? "";
}

function identityFromAdminRecord(
  admin: NonNullable<Awaited<ReturnType<typeof getReservedLocalAdminLoginRecord>>>,
): TaskboardUserIdentity {
  return {
    id: admin.id,
    authMode: "password",
    authProvider: "local",
    email: admin.email,
    displayName: admin.display_name,
    username: admin.username ?? undefined,
    role: admin.role,
    isDisabled: admin.is_disabled,
    isReservedLocalAdmin: admin.is_reserved_local_admin,
  };
}

export async function authenticateReservedLocalAdmin(args: {
  username?: string;
  password: string;
  allowLegacyPasswordMigration: boolean;
  requireUsername: boolean;
}) {
  const admin = await getReservedLocalAdminLoginRecord();

  if (!admin || admin.is_disabled || !admin.is_reserved_local_admin) {
    return null;
  }

  const suppliedUsername = normalizeUsername(args.username);
  const storedUsername = normalizeUsername(admin.username ?? "");
  const usernameMatches =
    !args.requireUsername && !suppliedUsername
      ? true
      : suppliedUsername === storedUsername || suppliedUsername === admin.email.toLowerCase();

  if (!usernameMatches) {
    return null;
  }

  if (admin.local_password_hash) {
    const isValid = await verifyLocalPassword(args.password, admin.local_password_hash);
    return isValid ? identityFromAdminRecord(admin) : null;
  }

  const legacyPassword = process.env.TASKBOARD_APP_PASSWORD?.trim() ?? "";

  if (!args.allowLegacyPasswordMigration || !legacyPassword || args.password !== legacyPassword) {
    return null;
  }

  const passwordHash = await hashLocalPassword(args.password);
  await setReservedLocalAdminPasswordHash(admin.id, passwordHash);

  return identityFromAdminRecord({
    ...admin,
    local_password_hash: passwordHash,
  });
}
