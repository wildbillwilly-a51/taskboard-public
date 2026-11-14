import { TaskboardAuthenticationError } from "@/lib/taskboard-auth-errors";
import "server-only";
import { getPool } from "@/lib/db";
import { taskPushDeviceCookie } from "@/lib/task-push-device-cookie";

import type { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { headers } from "next/headers";
import {
  AUTH_COOKIE_NAME,
  getAuthMode,
  isExternalAuthOnly,
  readExternalAuthIdentity,
  verifySessionCookieValue,
  type TaskboardAuthProvider,
  type TaskboardAuthMode,
  type TaskboardUserRole,
} from "@/lib/auth";
import {
  getOrCreateExternalTaskboardUser,
  getTaskboardUserForSession,
} from "@/lib/taskboard-store";

export type TaskboardUserIdentity = {
  // Trusted service identity: never provision or synchronize login profiles.
  profileReadOnly?: boolean;
  id?: string;
  authMode: TaskboardAuthMode;
  authProvider?: TaskboardAuthProvider;
  email: string;
  displayName: string;
  username?: string;
  role?: TaskboardUserRole;
  isDisabled?: boolean;
  isReservedLocalAdmin?: boolean;
};

export type TaskboardCurrentUser = {
  id?: string;
  email: string;
  displayName: string;
  username?: string;
  role?: TaskboardUserRole;
  authProvider?: TaskboardAuthProvider;
  isReservedLocalAdmin?: boolean;
};

export function resolveTaskboardUserFromHeaders(
  requestHeaders: Pick<Headers, "get">,
): TaskboardUserIdentity | null {
  if (!isExternalAuthOnly()) {
    return null;
  }

  const identity = readExternalAuthIdentity(requestHeaders);

  if (!identity) {
    return null;
  }

  return {
    authMode: "authelia",
    authProvider: "authelia",
    email: identity.email,
    displayName: identity.displayName,
    username: identity.username,
    role: "standard",
    isDisabled: false,
    isReservedLocalAdmin: false,
  };
}

async function resolveTaskboardUserFromCookieValue(cookieValue: string | undefined, required = false) {
  const session = await verifySessionCookieValue(cookieValue);

  if (!session) {
    return null;
  }

  if (isExternalAuthOnly() && (session.authProvider !== "local" || !session.reservedAdmin)) {
    return null;
  }

  const user = await getTaskboardUserForSession(session);
  if (required && !user) {
    // The legacy session lookup intentionally returns null for disabled accounts.
    // Only the required-identity API path distinguishes a verified disabled session.
    const row = (await getPool()?.query<{is_disabled:boolean}>("SELECT is_disabled FROM users WHERE id=$1",[session.userId]))?.rows[0];
    if (row?.is_disabled) throw new TaskboardAuthenticationError("account_disabled", "Taskboard user is disabled.");
  }
  return user;
}

export async function getCurrentTaskboardUser() {
  const requestHeaders = await headers();
  const cookieStore = await cookies();
  const sessionUser = await resolveTaskboardUserFromCookieValue(
    cookieStore.get(AUTH_COOKIE_NAME)?.value,
  );

  const headerUser = sessionUser ? null : resolveTaskboardUserFromHeaders(requestHeaders);
  const user = sessionUser ?? (headerUser && isExternalAuthOnly()
    ? await getOrCreateExternalTaskboardUser(headerUser) : headerUser);
  const deviceId = cookieStore.get(taskPushDeviceCookie)?.value;
  if (process.env.TASKBOARD_WEB_PUSH_ENABLED === "true" && user?.id && deviceId &&
      /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(deviceId)) {
    // An account signed in on this browser cannot inherit another account's alerts.
    await getPool()?.query("DELETE FROM task_push_devices WHERE id = $1 AND user_id <> $2", [deviceId, user.id]);
  }
  return user;
}

export async function requireTaskboardUserFromHeaders(
  request: NextRequest | { headers: Pick<Headers, "get">; cookies?: { get(name: string): { value: string } | undefined } },
): Promise<TaskboardUserIdentity> {
  const sessionUser = await resolveTaskboardUserFromCookieValue(
    request.cookies?.get(AUTH_COOKIE_NAME)?.value,
    // Preserve the established external-header fallback when a different
    // authenticated identity arrives with a stale disabled browser cookie.
    !(isExternalAuthOnly() && readExternalAuthIdentity(request.headers)),
  );

  if (sessionUser) {
    return sessionUser;
  }

  const identity = resolveTaskboardUserFromHeaders(request.headers);

  if (!identity) {
    throw new TaskboardAuthenticationError("authentication_required",
      isExternalAuthOnly() ? `Taskboard ${getAuthMode()} mode requires forwarded user identity headers.`
        : "Sign in to Taskboard.",
    );
  }

  if (isExternalAuthOnly()) {
    const externalUser = await getOrCreateExternalTaskboardUser(identity);

    if (!externalUser) {
      throw new TaskboardAuthenticationError("account_disabled", "Taskboard user is disabled.");
    }

    return externalUser;
  }

  return identity;
}

function assertAdminUser(user: TaskboardUserIdentity | null): asserts user is TaskboardUserIdentity & { id: string; role: "admin" } {
  if (!user?.id || user.role !== "admin" || user.isDisabled) {
    throw new Error("Taskboard admin access is required.");
  }
}

export async function getCurrentAdminTaskboardUser() {
  const user = await getCurrentTaskboardUser();

  if (!user?.id || user.role !== "admin" || user.isDisabled) {
    return null;
  }

  return user;
}

export async function requireAdminTaskboardUserFromHeaders(
  request: NextRequest | { headers: Pick<Headers, "get">; cookies?: { get(name: string): { value: string } | undefined } },
) {
  const user = await requireTaskboardUserFromHeaders(request);
  assertAdminUser(user);
  return user;
}

export function getTaskboardPublicOrigin(args: {
  headers: Pick<Headers, "get">;
  fallbackOrigin: string;
}) {
  const forwardedProto = args.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
  const forwardedHost = args.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const hostHeader = args.headers.get("host")?.split(",")[0]?.trim();
  const fallbackUrl = new URL(args.fallbackOrigin);
  const fallbackProtocol = fallbackUrl.protocol.replace(/:$/, "");
  const fallbackHost = fallbackUrl.host;
  const configuredHost = process.env.TASKBOARD_HOST?.trim();
  const host = forwardedHost || hostHeader || fallbackHost;
  const resolvedHost =
    configuredHost &&
    (host === "0.0.0.0:3000" ||
      host === "127.0.0.1:3000" ||
      host === "localhost:3000" ||
      host === "0.0.0.0" ||
      host === "127.0.0.1" ||
      host === "localhost")
      ? configuredHost
      : host;
  const protocol =
    forwardedProto ||
    (process.env.AUTH_COOKIE_SECURE === "true" ? "https" : fallbackProtocol);

  return `${protocol}://${resolvedHost}`;
}
