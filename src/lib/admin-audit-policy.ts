import type { TaskboardUserRole } from "@/lib/auth";
import { isUuid } from "@/lib/uuid";

export type AdminAuditActor = {
  id?: string;
  role?: TaskboardUserRole;
  isDisabled?: boolean;
};

export type AdminAuditEventFilters = {
  limit: number;
  offset: number;
  action?: string;
  actorUserId?: string;
  targetUserId?: string;
  targetTeamId?: string;
  targetBoardId?: string;
  from?: string;
  to?: string;
};

export const defaultAdminAuditLimit = 100;
export const maxAdminAuditLimit = 200;

const sensitiveKeyPattern =
  /password|hash|token|cookie|secret|credential|code|local_password_hash|token_hash|code_hash|auth_secret/i;

export function assertAdminAuditActor(actor: AdminAuditActor) {
  if (!actor.id || actor.role !== "admin" || actor.isDisabled) {
    throw new Error("Taskboard admin access is required.");
  }
}

export function redactAuditValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((item) => redactAuditValue(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      sensitiveKeyPattern.test(key) ? "[redacted]" : redactAuditValue(item),
    ]),
  );
}

function parseBoundedInteger(value: string | null, fallback: number, max?: number) {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return max ? Math.min(parsed, max) : parsed;
}

function optionalUuid(params: URLSearchParams, key: string) {
  const value = params.get(key)?.trim();
  if (!value) {
    return undefined;
  }

  if (!isUuid(value)) {
    throw new Error(`${key} must be a UUID.`);
  }

  return value;
}

function optionalDate(params: URLSearchParams, key: string) {
  const value = params.get(key)?.trim();
  if (!value) {
    return undefined;
  }

  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    throw new Error(`${key} must be a valid date.`);
  }

  return new Date(timestamp).toISOString();
}

export function parseAdminAuditEventFilters(params: URLSearchParams): AdminAuditEventFilters {
  const action = params.get("action")?.trim() || undefined;

  return {
    limit: parseBoundedInteger(params.get("limit"), defaultAdminAuditLimit, maxAdminAuditLimit),
    offset: parseBoundedInteger(params.get("offset"), 0),
    action,
    actorUserId: optionalUuid(params, "actorUserId"),
    targetUserId: optionalUuid(params, "targetUserId"),
    targetTeamId: optionalUuid(params, "targetTeamId"),
    targetBoardId: optionalUuid(params, "targetBoardId"),
    from: optionalDate(params, "from"),
    to: optionalDate(params, "to"),
  };
}
