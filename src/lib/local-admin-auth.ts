import "server-only";

import {
  getReservedLocalAdminLoginRecord,
  setReservedLocalAdminPasswordHash,
} from "@/lib/taskboard-store";
import { hashLocalPassword, maximumLocalPasswordLength, verifyLocalPassword } from "@/lib/local-password";
import { admitLocalLogin, clearLocalLoginAttempts } from "@/lib/local-login-attempts";
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
  if (typeof args.password !== "string" || !args.password || args.password.length > maximumLocalPasswordLength
    || (args.username !== undefined && typeof args.username !== "string")) return null;
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

  if (!usernameMatches || !admitLocalLogin(admin.id)) {
    return null;
  }

  if (admin.local_password_hash) {
    const isValid = await verifyLocalPassword(args.password, admin.local_password_hash);
    if (isValid) clearLocalLoginAttempts(admin.id);
    return isValid ? identityFromAdminRecord(admin) : null;
  }

  const legacyPassword = process.env.TASKBOARD_APP_PASSWORD?.trim() ?? "";

  if (!args.allowLegacyPasswordMigration || !legacyPassword || args.password !== legacyPassword) {
    return null;
  }

  const passwordHash = await hashLocalPassword(args.password);
  await setReservedLocalAdminPasswordHash(admin.id, passwordHash);
  clearLocalLoginAttempts(admin.id);

  return identityFromAdminRecord({
    ...admin,
    local_password_hash: passwordHash,
  });
}
