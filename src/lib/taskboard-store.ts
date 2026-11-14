import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { mutationUUID, mutationDate, copyRecurringAttachment, inMutationBatch, writeMutationAttachment, guardMutationAttachment } from "@/lib/taskboard-mutation-effects";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import type { TaskboardSession } from "@/lib/auth";
import { hashLocalPassword, validateLocalPassword } from "@/lib/local-password";
import { isAccountEmail } from "@/lib/account-email";
import { getPool, isDatabaseConfigured } from "@/lib/db";
import { applyFrozenBaseline } from "@/lib/schema-baseline";
import { taskReminderBase, taskReminderEligible, taskReminderTrigger } from "@/lib/task-reminder-sql";
import { BASELINE_SQL_CHECKSUM, initializeSchema, migrationChecksum, readSchemaStatus, type SchemaStatus } from "@/lib/schema-migrations";
import { getStartOfTodayInTimeZone } from "@/lib/task-schedule";
import { readBoardRevision, readNoteDependencyRevisions } from "@/lib/board-revision-schema";
import { applyAttendeeChanges, type AttendeeChange } from "@/lib/outage-people";
import {
  evaluateAdminUserUpdate,
  assertAdminActor,
  type AdminUserUpdateInput,
} from "@/lib/admin-user-policy";
import {
  evaluateAdminPermissionSettingsUpdate,
  type AdminPermissionSettingsPatchInput,
} from "@/lib/admin-permission-settings-policy";
import {
  assertAdminAuditActor,
  redactAuditValue,
  type AdminAuditEventFilters,
} from "@/lib/admin-audit-policy";
import {
  assertActiveTeamManagerWouldRemain,
  assertCanCreateTeam,
  assertCanManageTeam,
  assertCanManageTeamMembers,
  assertCanManageTeamPersonalBoardVisibility,
  assertCanViewTeam,
  evaluateTeamPersonalBoardVisibilityUpdate,
  evaluateTeamMetadataUpdate,
  normalizeTeamBoardDefaultAccess,
  normalizeTeamBoardDescription,
  normalizeTeamBoardTitle,
  isValidTeamBoardMemberGrantRole,
  isValidTeamMemberRole,
  normalizeTeamDescription,
  normalizeTeamName,
  type TeamAuditAction,
  type TeamBoardDefaultAccess,
  type TeamBoardMemberGrantRole,
  type TeamMemberRole,
} from "@/lib/team-policy";
import {
  BoardAccessError,
  assertBoardAccess,
  assertBoardLifecycleAccess,
  buildBoardAccessMetadata,
  buildAccessibleBoardSummaries,
  isValidBoardId,
  resolveEffectiveBoardAccess,
  type AccessibleBoardSummary,
  type BoardAccessMetadata,
} from "@/lib/board-access";
import {
  buildBoardPrivacyGateStatus,
  canViewBoardPrivacySettings,
  evaluateBoardPrivacySettingsUpdate,
  type BoardPrivacySettingsInput,
  type BoardPrivacySettingsResponse,
  type BoardPrivacySettingsTeam,
  type PersonalBoardVisibilitySetting,
} from "@/lib/board-privacy-policy";
import {
  canManagePersonalBoardShares,
  normalizePersonalBoardMemberGrantRole,
  type PersonalBoardMemberAuditAction,
} from "@/lib/personal-board-sharing-policy";
import type { TaskboardAuthProvider, TaskboardUserRole } from "@/lib/auth";
import { isSameTeamPersonalBoardViewEnabled } from "@/lib/taskboard-config";
import type { ParsedIcsEvent } from "@/lib/ics-import";
import type {
  BulkTaskImportSubmission,
  BulkTaskImportTask,
} from "@/lib/bulk-task-import";
import { isUuid } from "@/lib/uuid";
import type {
  TaskboardCurrentUser,
  TaskboardUserIdentity,
} from "@/lib/taskboard-request";
import type { ImportedCalendarSourceRow } from "@/lib/calendar-source-events";
import { assertSubtaskPatch, SUBTASK_COLOR, SUBTASK_ICON, SubtaskRuleError } from "@/lib/subtask-rule";
import {
  getEffectiveCalendarTaskResizeRange,
  type CalendarTaskScheduleScope,
  type CalendarTaskScheduleUpdate,
} from "@/lib/calendar-resize";
import {
  type ArchiveItem,
  defaultViewPresets,
  seedBoard,
  type Board,
  type Bucket,
  type BucketIcon,
  type CalendarEntry,
  type RecycleBinItem,
  type Task,
  type TaskAttachment,
  type TaskAttachmentPreviewKind,
  type TaskIcon,
  type TaskNote,
  type TaskNotification,
  type TaskNotificationKind,
  type TaskRecurrenceFrequency,
  type TaskRecurrenceMode,
  type TaskRecurrenceRule,
  type TaskReminderConfig,
  type TaskStatus,
  type ViewFilters,
  type ViewLayoutMode,
  type ViewPreset,
} from "@/lib/taskboard-data";

type DbBoardRow = {
  id: string;
  owner_user_id: string | null;
  owner_is_disabled?: boolean | null;
  board_type: "personal" | "team";
  owner_team_id: string | null;
  team_member_default_access: "viewer" | "editor" | null;
  personal_visibility: "private" | "team_visible" | null;
  personal_visibility_team_id: string | null;
  title: string;
  description: string;
};

type DbAccessibleBoardRow = DbBoardRow & {
  owner_display_name: string | null;
  owner_team_name: string | null;
  personal_visibility_team_name: string | null;
  created_at: string;
};

type DbUserAuthRow = {
  id: string;
  email: string;
  username: string | null;
  display_name: string;
  role: TaskboardUserRole;
  is_disabled: boolean;
  is_reserved_local_admin: boolean;
  local_password_hash: string | null;
  auth_provider: TaskboardAuthProvider;
};

type SessionUserRow = Omit<DbUserAuthRow, "local_password_hash"> & { session_version: number };

type DbAdminUserRow = {
  id: string;
  email: string;
  username: string | null;
  display_name: string;
  role: TaskboardUserRole;
  is_disabled: boolean;
  is_reserved_local_admin: boolean;
  auth_provider: TaskboardAuthProvider;
  created_at: string;
  updated_at: string;
};

type DbAdminAuditEventRow = {
  id: string;
  action: string;
  previous_values: unknown;
  new_values: unknown;
  created_at: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_username: string | null;
  actor_display_name: string | null;
  target_user_id: string | null;
  target_user_email: string | null;
  target_user_username: string | null;
  target_user_display_name: string | null;
  target_team_id: string | null;
  target_team_name: string | null;
  target_board_id: string | null;
  target_board_title: string | null;
};

type DbAppPermissionSettingsRow = {
  same_team_personal_board_visibility_allowed: boolean;
  default_personal_board_visibility: "private" | "team_visible";
  managers_can_configure_team_personal_board_visibility: boolean;
  users_can_make_boards_private: boolean;
  admins_can_view_private_boards: boolean;
  updated_at: string;
};

type DbBoardPrivacySettingsRow = {
  id: string;
  title: string;
  board_type: "personal" | "team";
  owner_user_id: string | null;
  personal_visibility: PersonalBoardVisibilitySetting | null;
  personal_visibility_team_id: string | null;
  personal_visibility_team_name: string | null;
  selected_team_policy_enabled: boolean | null;
  owner_in_selected_team: boolean | null;
};

type DbBoardPrivacyEligibleTeamRow = {
  id: string;
  name: string;
  personal_board_view_enabled: boolean;
};

type DbTeamAccessRow = {
  id: string;
  name: string;
  description: string;
  personal_board_view_enabled: boolean;
  actor_membership_role: TeamMemberRole | null;
  member_count: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
};

type DbTeamMemberRow = {
  user_id: string;
  email: string;
  username: string | null;
  display_name: string;
  app_role: TaskboardUserRole;
  is_disabled: boolean;
  team_role: TeamMemberRole;
  created_at: string;
  updated_at: string;
};

type DbTeamMemberCandidateRow = {
  id: string;
  email: string;
  username: string | null;
  display_name: string;
};

type DbTeamBoardMemberGrantRow = {
  user_id: string;
  email: string;
  username: string | null;
  display_name: string;
  app_role: TaskboardUserRole;
  is_disabled: boolean;
  is_reserved_local_admin: boolean;
  auth_provider: TaskboardAuthProvider;
  team_role: TeamMemberRole;
  explicit_role: TeamBoardMemberGrantRole;
  created_at: string;
  updated_at: string;
};

type DbPersonalBoardMemberGrantRow = {
  user_id: string;
  email: string;
  username: string | null;
  display_name: string;
  app_role: TaskboardUserRole;
  is_disabled: boolean;
  is_reserved_local_admin: boolean;
  auth_provider: TaskboardAuthProvider;
  explicit_role: "owner" | "editor" | "viewer";
  created_at: string;
  updated_at: string;
};

type DbTeamBoardRow = {
  id: string;
  owner_team_id: string;
  owner_team_name: string;
  title: string;
  description: string;
  team_member_default_access: TeamBoardDefaultAccess;
  created_at: string;
  updated_at: string;
};

type DbBucketRow = {
  id: string;
  title: string;
  color: string | null;
  icon: BucketIcon | null;
  is_collapsed: boolean;
};

type DbTaskRow = {
  id: string;
  bucket_id: string | null;
  parent_task_id: string | null;
  title: string;
  summary: string;
  next_action: string;
  notes: string;
  status: TaskStatus;
  completed_at: string | null;
  created_at: string | null;
  color: string | null;
  icon: TaskIcon | null;
  start_at: string | null;
  end_at: string | null;
  all_day: boolean;
  due_at: string | null;
  recurrence_rule: unknown;
  recurrence_series_id: string | null;
  reminder_offset_minutes: number | null;
  overdue_reminder_enabled: boolean;
  sort_order: string;
  source_type: string | null;
  is_read_only_import: boolean;
  import_sync_status: string | null;
  import_raw_payload: unknown;
  work_item_type: "task" | "maintenance_outage";
  outage_location_id: string | null;
  outage_location_name: string | null;
  outage_owner_name: string | null;
  outage_attendees: unknown;
};

type DbMaintenanceLocationRow = {
  id: string;
  name: string;
  is_active: boolean;
};

type DbTaskSeriesRow = {
  id: string;
  board_id: string;
  bucket_id: string | null;
  parent_task_id: string | null;
  title: string;
  summary: string;
  next_action: string;
  notes: string;
  status: TaskStatus;
  color: string | null;
  icon: TaskIcon | null;
  start_at: string | null;
  end_at: string | null;
  all_day: boolean;
  due_at: string | null;
  sort_order: string;
  source_type: string | null;
  is_read_only_import: boolean;
  recurrence_rule: unknown;
  recurrence_series_id: string | null;
  reminder_offset_minutes: number | null;
  overdue_reminder_enabled: boolean;
};

type DbTaskNotificationRow = {
  id: string;
  task_id: string;
  kind: TaskNotificationKind;
  due_at_snapshot: string;
  trigger_at: string;
  title_snapshot: string;
  read_at: string | null;
  bucket_title: string | null;
  provider_label: string | null;
};

type DbRecycleBinRow = {
  id: string;
  title: string;
  source_type: string | null;
  is_read_only_import: boolean;
  deleted_at: string;
  purge_after_at: string;
  recycle_original_bucket_title: string | null;
  parent_title?: string | null;
  original_bucket_exists: boolean;
  attachment_count: string;
  subtask_count: string;
};

type DbArchiveRow = {
  id: string;
  title: string;
  source_type: string | null;
  is_read_only_import: boolean;
  archived_at: string;
  completed_at: string | null;
  archive_original_bucket_title: string | null;
  original_bucket_exists: boolean;
  attachment_count: string;
  subtask_count: string;
};

type DbChecklistRow = {
  id: string;
  task_id: string;
  label: string;
  is_done: boolean;
  sort_order: string;
};

type DbTaskLabelRow = {
  task_id: string;
  label_name: string;
};

type DbTaskAttachmentRow = {
  id: string;
  task_id: string;
  note_id: string | null;
  original_name: string;
  display_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

type DbTaskNoteRow = {
  id: string;
  task_id: string;
  body: string;
  note_type: "primary" | "working";
  created_at: string;
  updated_at: string | null;
  author_name: string | null;
  editor_name: string | null;
};

type DbViewPresetRow = {
  id: string;
  name: string;
  layout_mode: ViewLayoutMode;
  filters: ViewFilters;
  hidden_fields: string[];
  display_options: Record<string, boolean | string | number>;
};

type ImportedEventRow = {
  id: string;
  task_id: string | null;
  external_event_id: string | null;
  raw_payload: unknown;
  task_is_read_only_import: boolean | null;
  sync_status: string;
  task_deleted_at: string | null;
  task_purge_after_at: string | null;
  task_archived_at: string | null;
};

type DbImportedCalendarSourceEventRow = {
  id: string;
  provider: string;
  external_event_id: string | null;
  title: string;
  starts_at: string | Date | null;
  ends_at: string | Date | null;
  location: string;
  sync_status: string;
  task_id: string | null;
  linked_task_is_read_only_import: boolean | null;
  is_recurring: boolean;
};

type DbCalendarEntryRow = {
  id: string;
  board_id: string;
  title: string;
  starts_at: string | Date;
  ends_at: string | Date;
  all_day: boolean;
  location: string;
  description: string;
  color: string;
  linked_task_id: string | null;
  updated_at: string | Date;
};

type DbCalendarSourceConversionEventRow = {
  id: string;
  board_id: string;
  task_id: string | null;
  provider: string;
  external_event_id: string | null;
  title: string;
  starts_at: string | Date | null;
  ends_at: string | Date | null;
  location: string;
  raw_payload: unknown;
  sync_status: string;
  board_type: "personal" | "team";
  owner_user_id: string | null;
  owner_is_disabled: boolean | null;
};

type ImportTaskRow = {
  id: string;
  is_read_only_import: boolean;
  deleted_at: string | null;
};

type DbAttachmentRecordRow = {
  id: string;
  task_id: string;
  board_id: string;
  note_id?: string | null;
  uploaded_by_user_id?: string;
  original_name: string;
  display_name: string;
  stored_name: string;
  mime_type: string;
  size_bytes: number;
  created_at: string;
};

export class CalendarSourceConversionError extends Error {
  status: number;
  code:
    | "source_event_not_found"
    | "source_event_not_convertible"
    | "linked_task_not_convertible"
    | "bucket_not_found"
    | "invalid_conversion_scope";

  constructor(
    code: CalendarSourceConversionError["code"],
    message: string,
    status: number,
  ) {
    super(message);
    this.name = "CalendarSourceConversionError";
    this.code = code;
    this.status = status;
  }
}

export type CalendarSourceConversionResult = {
  taskId: string;
  alreadyConverted: boolean;
  sourceEventId: string;
};

export type CalendarSourceConversionScope = "occurrence" | "series";

export type TaskAttachmentUploadInput = {
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  buffer: Uint8Array;
  mutationSource?: string;
};

export type TaskAttachmentDownloadRecord = {
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  content: Uint8Array;
};

export type TaskboardRuntimeState = {
  board: Board;
  boardAccess: BoardAccessMetadata;
  currentUser: TaskboardCurrentUser;
  persistenceEnabled: boolean;
};

export type BoardContextOptions = {
  boardId?: string | null;
};

type BoardAccessRequirement = "read" | "edit" | "manage";

export type IcsImportResult = {
  created: number;
  updated: number;
  bucketId: string;
  touchedTaskIds: string[];
};

const recycleBinRetentionMs = 30 * 24 * 60 * 60 * 1000;
let databaseReadyPromise: Promise<SchemaStatus> | null = null;

const taskStatuses = new Set<TaskStatus>(["todo", "active", "waiting", "done"]);
const recurrenceFrequencies = new Set<TaskRecurrenceFrequency>([
  "daily",
  "weekly",
  "monthly",
  "weekday",
  "custom",
]);
const recurrenceModes = new Set<TaskRecurrenceMode>(["on_schedule", "after_completion"]);
const reminderOffsets = new Set<number>([0, 15, 60, 1440, 2880, 10080]);
const taskIcons = new Set<TaskIcon>([
  "flag",
  "calendar",
  "sparkles",
  "rocket",
  "layers",
  "message",
  "bolt",
  "checklist",
  "check",
  "kanban",
  "folder",
  "server",
  "database",
  "cloud",
  "terminal",
  "wrench",
  "settings",
  "shield",
  "bell",
  "alarm",
  "file",
  "spreadsheet",
  "mail",
  "phone",
  "users",
  "briefcase",
  "target",
  "alert",
  "bug",
  "hammer",
  "hard-drive",
  "network",
  "git-branch",
  "package",
  "archive",
  "clock",
  "megaphone",
  "bookmark",
  "star",
  "pin",
  "lightbulb",
]);
const bucketIcons = new Set<BucketIcon>([
  "sun",
  "brain",
  "inbox",
  "kanban",
  "folder",
  "server",
  "database",
  "wrench",
  "settings",
  "shield",
  "bell",
  "file",
  "users",
  "briefcase",
  "target",
  "archive",
  "megaphone",
  "lightbulb",
  "network",
]);
const layoutModes = new Set<ViewLayoutMode>(["board", "agenda", "focus", "list"]);
const colorPattern = /^#[0-9a-f]{6}$/i;
const taskAttachmentUploadRoot = path.join(process.cwd(), "uploads", "task-attachments");
export const maxTaskAttachmentSizeBytes = 25 * 1024 * 1024;
export const legacyOwnerEmail = "owner@taskboard.local";
export const legacyOwnerDisplayName = "Taskboard Owner";
export const defaultReservedLocalAdminUsername = "admin";
export const fallbackReservedLocalAdminUsername = "taskboard-admin";

export async function loadTaskboardState(
  user: TaskboardUserIdentity,
  options: BoardContextOptions = {},
): Promise<TaskboardRuntimeState> {
  if (!isDatabaseConfigured()) {
    return {
      board: seedBoard,
      boardAccess: getFallbackBoardAccess(user, seedBoard.id),
      currentUser: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        username: user.username,
        role: user.role,
        authProvider: user.authProvider,
        isReservedLocalAdmin: user.isReservedLocalAdmin,
      },
      persistenceEnabled: false,
    };
  }

  try {
    await ensureDatabaseReady();
    const boardState = await getBoardStateFromDatabase(user, options);

    return {
      board: boardState?.board ?? seedBoard,
      boardAccess: boardState?.boardAccess ?? getFallbackBoardAccess(user, seedBoard.id),
      currentUser: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        username: user.username,
        role: user.role,
        authProvider: user.authProvider,
        isReservedLocalAdmin: user.isReservedLocalAdmin,
      },
      persistenceEnabled: Boolean(boardState),
    };
  } catch (error) {
    if (options.boardId !== null && options.boardId !== undefined && error instanceof BoardAccessError) {
      throw error;
    }

    console.error("Failed to load board from database, falling back to seed data.", error);

    return {
      board: seedBoard,
      boardAccess: getFallbackBoardAccess(user, seedBoard.id),
      currentUser: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        username: user.username,
        role: user.role,
        authProvider: user.authProvider,
        isReservedLocalAdmin: user.isReservedLocalAdmin,
      },
      persistenceEnabled: false,
    };
  }
}

function getFallbackBoardAccess(user: TaskboardUserIdentity, boardId: string) {
  const isAdmin = user.role === "admin" && !user.isDisabled;
  return buildBoardAccessMetadata({
    boardId,
    level: isAdmin ? "admin" : "owner",
    source: isAdmin ? "admin" : "owner",
  });
}

export async function ensureDatabaseReady() {
  if (!databaseReadyPromise) {
    databaseReadyPromise = ensureSchemaAndSeed().catch((error) => {
      databaseReadyPromise = null;
      throw error;
    });
  }

  return databaseReadyPromise;
}

export async function getDatabaseSchemaStatus() {
  await ensureDatabaseReady();
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  const status = await readSchemaStatus(pool);
  if (!status.schemaReady) databaseReadyPromise = null;
  return status;
}

export async function getOrCreateUserRecord(
  client: PoolClient,
  user: TaskboardUserIdentity,
) {
  const existingUser = user.id
    ? await client.query<{ id: string; is_reserved_local_admin: boolean }>(
        `
          SELECT id, is_reserved_local_admin
          FROM users
          WHERE id = $1
          LIMIT 1
        `,
        [user.id],
      )
    : await client.query<{ id: string; is_reserved_local_admin: boolean }>(
        `
          SELECT id, is_reserved_local_admin
          FROM users
          WHERE email = $1
          LIMIT 1
        `,
        [user.email],
      );

  if (existingUser.rows[0]) {
    if (user.profileReadOnly) return existingUser.rows[0].id;
    if (!existingUser.rows[0].is_reserved_local_admin) {
      await client.query(
        `
          UPDATE users
          SET
            email = $2,
            display_name = $3,
            username = COALESCE(NULLIF($4, ''), username),
            auth_provider = $5,
            updated_at = NOW()
          WHERE id = $1
        `,
        [
          existingUser.rows[0].id,
          user.email,
          user.displayName,
          user.username ?? "",
          user.authProvider ?? (user.authMode === "password" ? "local" : "authelia"),
        ],
      );
    }
    return existingUser.rows[0].id;
  }

  if (user.profileReadOnly) throw new Error("Pinned service user is unavailable.");
  const userId = user.id ?? randomUUID();
  await client.query(
    `
      INSERT INTO users (id, email, username, display_name, role, auth_provider)
      VALUES ($1, $2, NULLIF($3, ''), $4, $5, $6)
    `,
    [
      userId,
      user.email,
      user.username ?? "",
      user.displayName,
      user.role ?? "standard",
      user.authProvider ?? (user.authMode === "password" ? "local" : "authelia"),
    ],
  );

  return userId;
}

async function createPersonalBoardForUser(
  client: PoolClient,
  userId: string,
  user: TaskboardUserIdentity,
) {
  const boardId = randomUUID();
  const boardTitle =
    user.isReservedLocalAdmin || (user.authMode === "password" && !user.id)
      ? seedBoard.title
      : `${user.displayName}'s Board`;

  await client.query(
    `
      INSERT INTO boards (
        id, owner_user_id, board_type, personal_visibility, title, description, created_by_user_id, updated_by_user_id
      )
      VALUES ($1, $2, 'personal', 'private', $3, $4, $2, $2)
    `,
    [boardId, userId, boardTitle, seedBoard.description],
  );

  await client.query(
    `
      INSERT INTO board_members (board_id, user_id, role)
      VALUES ($1, $2, 'owner')
    `,
    [boardId, userId],
  );

  for (const view of defaultViewPresets) {
    await client.query(
      `
        INSERT INTO view_presets (id, board_id, user_id, name, layout_mode, filters, hidden_fields, display_options)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)
      `,
      [
        randomUUID(),
        boardId,
        userId,
        view.name,
        view.layoutMode,
        JSON.stringify(view.filters),
        JSON.stringify(view.hiddenFields),
        JSON.stringify(view.displayOptions),
      ],
    );
  }

  await seedBoardBucketsAndTasks(client, boardId);

  return boardId;
}

async function ensureUserBoardRow(
  client: PoolClient,
  user: TaskboardUserIdentity,
): Promise<DbBoardRow> {
  const userId = await getOrCreateUserRecord(client, user);
  const board = await getBoardRowForUserId(client, userId);

  if (board) {
    return board;
  }

  const boardId = await createPersonalBoardForUser(client, userId, user);
  return {
    id: boardId,
    owner_user_id: userId,
    board_type: "personal",
    owner_team_id: null,
    team_member_default_access: null,
    personal_visibility: "private",
    personal_visibility_team_id: null,
    title: user.isReservedLocalAdmin || (user.authMode === "password" && !user.id) ? seedBoard.title : `${user.displayName}'s Board`,
    description: seedBoard.description,
  };
}

function normalizeBoardId(boardId: string | null | undefined) {
  if (boardId === null || boardId === undefined) {
    return null;
  }

  const trimmed = boardId.trim();

  if (!isValidBoardId(trimmed)) {
    throw new BoardAccessError(
      "invalid_board_id",
      "boardId must be a valid UUID.",
      400,
    );
  }

  return trimmed;
}

export async function getBoardRowById(client: PoolClient, boardId: string) {
  const result = await client.query<DbBoardRow>(
    `
      SELECT
        boards.id,
        boards.owner_user_id,
        owners.is_disabled AS owner_is_disabled,
        boards.board_type,
        boards.owner_team_id,
        boards.team_member_default_access,
        boards.personal_visibility,
        boards.personal_visibility_team_id,
        boards.title,
        boards.description
      FROM boards
      LEFT JOIN users owners ON owners.id = boards.owner_user_id
      WHERE boards.id = $1
      LIMIT 1
    `,
    [boardId],
  );

  return result.rows[0] ?? null;
}

async function resolveBoardContext(
  client: PoolClient,
  user: TaskboardUserIdentity,
  options: BoardContextOptions,
  requiredAccess: BoardAccessRequirement,
) {
  const explicitBoardId = normalizeBoardId(options.boardId);
  const board = explicitBoardId
    ? await getBoardRowById(client, explicitBoardId)
    : await ensureUserBoardRow(client, user);

  if (!board) {
    throw new BoardAccessError(
      "board_not_found",
      "Board not found.",
      404,
    );
  }

  const boardAccess = await resolveEffectiveBoardAccess(client, user, {
    id: board.id,
    owner_user_id: board.owner_user_id,
    owner_is_disabled: board.owner_is_disabled,
    board_type: board.board_type,
    owner_team_id: board.owner_team_id,
    team_member_default_access: board.team_member_default_access,
    personal_visibility: board.personal_visibility,
    personal_visibility_team_id: board.personal_visibility_team_id,
  });
  assertBoardAccess(boardAccess, requiredAccess);

  return {
    board,
    boardAccess,
  };
}

function taskboardUserIdentityFromRow(
  row: Omit<DbUserAuthRow, "local_password_hash">,
  authMode: TaskboardUserIdentity["authMode"],
): TaskboardUserIdentity {
  return {
    id: row.id,
    authMode,
    authProvider: row.auth_provider,
    email: row.email,
    displayName: row.display_name,
    username: row.username ?? undefined,
    role: row.role,
    isDisabled: row.is_disabled,
    isReservedLocalAdmin: row.is_reserved_local_admin,
  };
}

async function getUserAuthRowById(client: PoolClient, userId: string) {
  const result = await client.query<DbUserAuthRow>(
    `
      SELECT id, email, username, display_name, role, is_disabled, is_reserved_local_admin, local_password_hash, auth_provider
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId],
  );

  return result.rows[0] ?? null;
}

async function getReservedLocalAdminAuthRow(client: PoolClient) {
  const result = await client.query<DbUserAuthRow>(
    `
      SELECT id, email, username, display_name, role, is_disabled, is_reserved_local_admin, local_password_hash, auth_provider
      FROM users
      WHERE is_reserved_local_admin = TRUE
      ORDER BY created_at ASC
      LIMIT 1
    `,
  );

  return result.rows[0] ?? null;
}

export async function getTaskboardUserForSession(session: TaskboardSession) {
  await ensureDatabaseReady();
  const result = await getPool()?.query<SessionUserRow>(
    `SELECT id, email, username, display_name, role, is_disabled, is_reserved_local_admin, auth_provider, session_version
     FROM users WHERE id = $1 AND NOT is_disabled`,
    [session.userId],
  );
  const user = result?.rows[0];
  if (!user || user.auth_provider !== session.authProvider
    || user.is_reserved_local_admin !== session.reservedAdmin || user.session_version !== (session.version ?? 0)) {
    return null;
  }
  return {
    ...taskboardUserIdentityFromRow(user, user.auth_provider === "authelia" ? "authelia" : "password"),
    profileReadOnly: true,
  };
}

export async function getLocalAccountForLogin(username: string) {
  await ensureDatabaseReady();
  const result = await getPool()?.query<{ id: string; local_password_hash: string; session_version: number }>(
    `SELECT id, local_password_hash, session_version FROM users
     WHERE username = $1 AND auth_provider = 'local' AND NOT is_reserved_local_admin AND NOT is_disabled
       AND local_password_hash IS NOT NULL`,
    [username],
  );
  return result?.rows[0] ?? null;
}

export async function getOrCreateOidcAccount(identity: {
  issuer: string; subject: string; email: string | null; displayName: string;
}) {
  await ensureDatabaseReady();
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // Serialize concurrent first sign-ins before the user row exists.
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
      [JSON.stringify(["oidc", identity.issuer, identity.subject])]);
    type Account = { id: string; is_disabled: boolean; session_version: number };
    const result = await client.query<Account>(
      `SELECT id, is_disabled, session_version FROM users
       WHERE auth_provider = 'oidc' AND oidc_issuer = $1 AND oidc_subject = $2`,
      [identity.issuer, identity.subject],
    );

    let account = result.rows[0];
    if (!account && identity.email) {
      const id = randomUUID();
      const inserted = await client.query<Account>(
        `INSERT INTO users (id, email, display_name, auth_provider, oidc_issuer, oidc_subject)
         VALUES ($1, $2, $3, 'oidc', $4, $5) RETURNING id, is_disabled, session_version`,
        [id, identity.email, identity.displayName, identity.issuer, identity.subject],
      );
      account = inserted.rows[0];
      await createPersonalBoardForUser(client, id, {
        id, authMode: "password", authProvider: "oidc", email: identity.email, displayName: identity.displayName,
      });
    }
    await client.query("COMMIT");
    return !account || account.is_disabled ? null : { id: account.id, version: account.session_version };
  } catch (error) {
    await client.query("ROLLBACK");
    if (isUserLoginConflict(error)) return null;
    throw error;
  } finally {
    client.release();
  }
}

export async function getOrCreateExternalTaskboardUser(user: TaskboardUserIdentity) {
  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    return user;
  }

  const client = await pool.connect();

  try {
    const userId = await getOrCreateUserRecord(client, {
      ...user,
      authMode: "authelia",
      authProvider: "authelia",
    });
    const row = await getUserAuthRowById(client, userId);

    if (!row || row.is_disabled) {
      return null;
    }

    return taskboardUserIdentityFromRow(row, "authelia");
  } finally {
    client.release();
  }
}

function mapAdminUserRow(row: DbAdminUserRow) {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    role: row.role,
    isDisabled: row.is_disabled,
    isReservedLocalAdmin: row.is_reserved_local_admin,
    authProvider: row.auth_provider,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export type AdminUserListItem = ReturnType<typeof mapAdminUserRow>;

function mapAuditUser(
  id: string | null,
  email: string | null,
  username: string | null,
  displayName: string | null,
) {
  if (!id) {
    return null;
  }

  return {
    id,
    email: email ?? "",
    username,
    displayName: displayName ?? "Deleted user",
  };
}

function mapAdminAuditEventRow(row: DbAdminAuditEventRow) {
  return {
    id: row.id,
    action: row.action,
    createdAt: new Date(row.created_at).toISOString(),
    actor: mapAuditUser(
      row.actor_id,
      row.actor_email,
      row.actor_username,
      row.actor_display_name,
    ),
    targetUser: mapAuditUser(
      row.target_user_id,
      row.target_user_email,
      row.target_user_username,
      row.target_user_display_name,
    ),
    targetTeam: row.target_team_id
      ? {
          id: row.target_team_id,
          name: row.target_team_name ?? "Deleted team",
        }
      : null,
    targetBoard: row.target_board_id
      ? {
          id: row.target_board_id,
          title: row.target_board_title ?? "Deleted board",
        }
      : null,
    previousValues: redactAuditValue(row.previous_values),
    newValues: redactAuditValue(row.new_values),
  };
}

export type AdminAuditEventListItem = ReturnType<typeof mapAdminAuditEventRow>;

function mapAppPermissionSettingsRow(row: DbAppPermissionSettingsRow) {
  return {
    sameTeamPersonalBoardVisibilityAllowed:
      row.same_team_personal_board_visibility_allowed,
    defaultPersonalBoardVisibility: row.default_personal_board_visibility,
    managersCanConfigureTeamPersonalBoardVisibility:
      row.managers_can_configure_team_personal_board_visibility,
    usersCanMakeBoardsPrivate: row.users_can_make_boards_private,
    adminsCanViewPrivateBoards: row.admins_can_view_private_boards,
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export type AdminPermissionSettings = ReturnType<typeof mapAppPermissionSettingsRow>;

async function getAdminUserRowById(client: PoolClient, userId: string) {
  const result = await client.query<DbAdminUserRow>(
    `
      SELECT id, email, username, display_name, role, is_disabled, is_reserved_local_admin, auth_provider, created_at, updated_at
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId],
  );

  return result.rows[0] ?? null;
}

async function getAppPermissionSettingsRow(client: PoolClient, options?: { forUpdate?: boolean }) {
  const result = await client.query<DbAppPermissionSettingsRow>(
    `
      SELECT
        same_team_personal_board_visibility_allowed,
        default_personal_board_visibility,
        managers_can_configure_team_personal_board_visibility,
        users_can_make_boards_private,
        admins_can_view_private_boards,
        updated_at::text AS updated_at
      FROM app_permission_settings
      WHERE id = 1
      ${options?.forUpdate ? "FOR UPDATE" : ""}
    `,
  );

  const row = result.rows[0];
  if (!row) {
    throw new Error("Permission settings are unavailable.");
  }

  return row;
}

export async function listAdminUsers(actor: TaskboardUserIdentity) {
  assertAdminActor(actor);
  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();

  try {
    const result = await client.query<DbAdminUserRow>(`
      SELECT id, email, username, display_name, role, is_disabled, is_reserved_local_admin, auth_provider, created_at, updated_at
      FROM users
      ORDER BY is_reserved_local_admin DESC, created_at ASC, email ASC
    `);

    return result.rows.map(mapAdminUserRow);
  } finally {
    client.release();
  }
}

function isUserLoginConflict(error: unknown) {
  return typeof error === "object" && error !== null
    && "code" in error && error.code === "23505"
    && "constraint" in error && (error.constraint === "users_email_key" || error.constraint === "users_username_unique");
}

export async function createAdminLocalUser(
  actor: TaskboardUserIdentity,
  input: { username?: unknown; email?: unknown; displayName?: unknown; password?: unknown },
) {
  assertAdminActor(actor);
  const username = typeof input.username === "string" ? input.username.trim().toLowerCase() : "";
  const email = typeof input.email === "string" ? input.email.trim().toLowerCase() : "";
  const displayName = typeof input.displayName === "string" ? input.displayName.trim() : "";
  if (!/^[a-z0-9._-]{3,64}$/.test(username)) throw new Error("Enter a username of 3–64 letters, numbers, dots, underscores, or hyphens.");
  if (!isAccountEmail(email)) throw new Error("Enter a valid email address.");
  if (!displayName || displayName.length > 120) throw new Error("Enter a display name of up to 120 characters.");
  validateLocalPassword(input.password);

  await ensureDatabaseReady();
  const pool = getPool();
  if (!pool) throw new Error("DATABASE_URL is not configured.");
  const passwordHash = await hashLocalPassword(input.password);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const id = randomUUID();
    const { rows: [user] } = await client.query<DbAdminUserRow>(
      `INSERT INTO users (id, email, username, display_name, local_password_hash, auth_provider)
       VALUES ($1, $2, $3, $4, $5, 'local')
       RETURNING id, email, username, display_name, role, is_disabled, is_reserved_local_admin, auth_provider, created_at, updated_at`,
      [id, email, username, displayName, passwordHash],
    );
    await createPersonalBoardForUser(client, id, { id, authMode: "password", authProvider: "local", email, username, displayName });
    await client.query(
      `INSERT INTO admin_audit_events (id, actor_user_id, target_user_id, action, new_values)
       VALUES ($1, $2, $3, 'user.created', $4::jsonb)`,
      [randomUUID(), actor.id, id, JSON.stringify({ username, email })],
    );
    await client.query("COMMIT");
    return mapAdminUserRow(user);
  } catch (error) {
    await client.query("ROLLBACK");
    if (isUserLoginConflict(error)) {
      throw new Error("That username or email address is already in use.");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function getAdminPermissionSettings(actor: TaskboardUserIdentity) {
  assertAdminActor(actor);
  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();

  try {
    return mapAppPermissionSettingsRow(await getAppPermissionSettingsRow(client));
  } finally {
    client.release();
  }
}

export async function updateAdminPermissionSettings(
  actor: TaskboardUserIdentity,
  input: AdminPermissionSettingsPatchInput,
) {
  assertAdminActor(actor);
  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();
  await client.query("BEGIN");

  try {
    const current = mapAppPermissionSettingsRow(
      await getAppPermissionSettingsRow(client, { forUpdate: true }),
    );
    const policyResult = evaluateAdminPermissionSettingsUpdate(actor, current, input);
    let settings = current;

    if (policyResult.auditEvents.length > 0) {
      const updateResult = await client.query<DbAppPermissionSettingsRow>(
        `
          UPDATE app_permission_settings
          SET
            same_team_personal_board_visibility_allowed = $1,
            default_personal_board_visibility = $2,
            managers_can_configure_team_personal_board_visibility = $3,
            users_can_make_boards_private = $4,
            admins_can_view_private_boards = $5,
            updated_at = NOW()
          WHERE id = 1
          RETURNING
            same_team_personal_board_visibility_allowed,
            default_personal_board_visibility,
            managers_can_configure_team_personal_board_visibility,
            users_can_make_boards_private,
            admins_can_view_private_boards,
            updated_at::text AS updated_at
        `,
        [
          policyResult.settings.sameTeamPersonalBoardVisibilityAllowed,
          policyResult.settings.defaultPersonalBoardVisibility,
          policyResult.settings.managersCanConfigureTeamPersonalBoardVisibility,
          policyResult.settings.usersCanMakeBoardsPrivate,
          policyResult.settings.adminsCanViewPrivateBoards,
        ],
      );
      settings = mapAppPermissionSettingsRow(updateResult.rows[0] ?? (await getAppPermissionSettingsRow(client)));

      for (const event of policyResult.auditEvents) {
        await client.query(
          `
            INSERT INTO admin_audit_events (
              id, actor_user_id, action, previous_values, new_values
            )
            VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)
          `,
          [
            randomUUID(),
            actor.id,
            event.action,
            JSON.stringify(event.previousValues),
            JSON.stringify(event.newValues),
          ],
        );
      }
    }

    await client.query("COMMIT");
    return {
      settings,
      changed: policyResult.auditEvents.length > 0,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getBoardPrivacySettingsRow(
  client: PoolClient,
  boardId: string,
  options?: { forUpdate?: boolean },
) {
  const result = await client.query<DbBoardPrivacySettingsRow>(
    `
      SELECT
        boards.id,
        boards.title,
        boards.board_type,
        boards.owner_user_id,
        boards.personal_visibility,
        boards.personal_visibility_team_id,
        visibility_teams.name AS personal_visibility_team_name,
        visibility_teams.personal_board_view_enabled AS selected_team_policy_enabled,
        EXISTS (
          SELECT 1
          FROM team_members owner_members
          INNER JOIN teams owner_teams
            ON owner_teams.id = owner_members.team_id
            AND owner_teams.archived_at IS NULL
          WHERE owner_members.team_id = boards.personal_visibility_team_id
            AND owner_members.user_id = boards.owner_user_id
        ) AS owner_in_selected_team
      FROM boards
      LEFT JOIN teams visibility_teams
        ON visibility_teams.id = boards.personal_visibility_team_id
        AND visibility_teams.archived_at IS NULL
      WHERE boards.id = $1
      LIMIT 1
      ${options?.forUpdate ? "FOR UPDATE OF boards" : ""}
    `,
    [boardId],
  );

  return result.rows[0] ?? null;
}

async function getBoardPrivacyEligibleTeams(
  client: PoolClient,
  ownerUserId: string,
): Promise<BoardPrivacySettingsTeam[]> {
  const result = await client.query<DbBoardPrivacyEligibleTeamRow>(
    `
      SELECT
        teams.id,
        teams.name,
        teams.personal_board_view_enabled
      FROM team_members
      INNER JOIN teams
        ON teams.id = team_members.team_id
        AND teams.archived_at IS NULL
      INNER JOIN users
        ON users.id = team_members.user_id
        AND users.is_disabled IS FALSE
      WHERE team_members.user_id = $1
      ORDER BY LOWER(teams.name) ASC, teams.created_at ASC, teams.id ASC
    `,
    [ownerUserId],
  );

  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    personalBoardViewEnabled: row.personal_board_view_enabled,
  }));
}

async function getBoardPrivacyImpactPreview(
  client: PoolClient,
  teamId: string | null,
  ownerUserId: string,
) {
  if (!teamId) {
    return null;
  }

  const result = await client.query<{ affected_users: string }>(
    `
      SELECT COUNT(*)::text AS affected_users
      FROM team_members
      INNER JOIN teams
        ON teams.id = team_members.team_id
        AND teams.archived_at IS NULL
      INNER JOIN users
        ON users.id = team_members.user_id
        AND users.is_disabled IS FALSE
      WHERE team_members.team_id = $1
        AND team_members.user_id <> $2
    `,
    [teamId, ownerUserId],
  );

  return {
    affectedUsers: Number(result.rows[0]?.affected_users ?? "0"),
  };
}

function mapBoardPrivacySettingsResponse(args: {
  row: DbBoardPrivacySettingsRow;
  settings: AdminPermissionSettings;
  eligibleTeams: BoardPrivacySettingsTeam[];
  impactPreview: { affectedUsers: number } | null;
}): BoardPrivacySettingsResponse {
  if (!args.row.owner_user_id) {
    throw new Error("Board owner is unavailable.");
  }

  const personalVisibility = args.row.personal_visibility ?? "private";
  const selectedTeam =
    args.row.personal_visibility_team_id
      ? args.eligibleTeams.find((team) => team.id === args.row.personal_visibility_team_id)
      : null;
  const gates = buildBoardPrivacyGateStatus({
    envGate: isSameTeamPersonalBoardViewEnabled() ? "enabled" : "not_enabled",
    globalSettingEnabled: args.settings.sameTeamPersonalBoardVisibilityAllowed,
    boardMarkedTeamVisible: personalVisibility === "team_visible",
    selectedTeamPolicyEnabled:
      selectedTeam?.personalBoardViewEnabled ??
      args.row.selected_team_policy_enabled ??
      null,
    ownerInSelectedTeam:
      args.row.personal_visibility_team_id ? args.row.owner_in_selected_team === true : null,
  });

  return {
    board: {
      id: args.row.id,
      title: args.row.title,
      boardType: "personal",
      ownerUserId: args.row.owner_user_id,
      personalVisibility,
      personalVisibilityTeamId: args.row.personal_visibility_team_id,
      personalVisibilityTeamName:
        selectedTeam?.name ?? args.row.personal_visibility_team_name ?? null,
    },
    eligibleTeams: args.eligibleTeams,
    gates,
    impactPreview: args.impactPreview,
  };
}

async function assertCanViewBoardPrivacySettings(
  actor: TaskboardUserIdentity,
  board: DbBoardPrivacySettingsRow,
) {
  if (!canViewBoardPrivacySettings(actor, {
    id: board.id, boardType: board.board_type, ownerUserId: board.owner_user_id,
    personalVisibility: board.personal_visibility ?? "private",
    personalVisibilityTeamId: board.personal_visibility_team_id,
  })) throw new BoardAccessError("board_not_found", "Board not found.", 404);
}

export async function getBoardPrivacySettings(
  actor: TaskboardUserIdentity,
  boardId: string,
): Promise<BoardPrivacySettingsResponse> {
  await ensureDatabaseReady();

  const normalizedBoardId = normalizeBoardId(boardId);
  if (!normalizedBoardId) {
    throw new BoardAccessError("invalid_board_id", "boardId must be a valid UUID.", 400);
  }

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();

  try {
    await getOrCreateUserRecord(client, actor);
    const row = await getBoardPrivacySettingsRow(client, normalizedBoardId);

    if (!row) {
      throw new Error("Board not found.");
    }

    await assertCanViewBoardPrivacySettings(actor, row);

    const settings = mapAppPermissionSettingsRow(await getAppPermissionSettingsRow(client));
    const eligibleTeams = await getBoardPrivacyEligibleTeams(client, row.owner_user_id ?? "");
    const impactPreview = await getBoardPrivacyImpactPreview(
      client,
      row.personal_visibility_team_id,
      row.owner_user_id ?? "",
    );

    return mapBoardPrivacySettingsResponse({
      row,
      settings,
      eligibleTeams,
      impactPreview,
    });
  } finally {
    client.release();
  }
}

export async function updateBoardPrivacySettings(
  actor: TaskboardUserIdentity,
  boardId: string,
  input: BoardPrivacySettingsInput,
) {
  await ensureDatabaseReady();

  const normalizedBoardId = normalizeBoardId(boardId);
  if (!normalizedBoardId) {
    throw new BoardAccessError("invalid_board_id", "boardId must be a valid UUID.", 400);
  }

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();
  await client.query("BEGIN");

  try {
    const actorId = await getOrCreateUserRecord(client, actor);
    const row = await getBoardPrivacySettingsRow(client, normalizedBoardId, {
      forUpdate: true,
    });

    if (!row) {
      throw new Error("Board not found.");
    }

    await assertCanViewBoardPrivacySettings({ ...actor, id: actorId }, row);

    const settings = mapAppPermissionSettingsRow(
      await getAppPermissionSettingsRow(client, { forUpdate: true }),
    );
    const eligibleTeams = await getBoardPrivacyEligibleTeams(client, row.owner_user_id ?? "");
    const policyResult = evaluateBoardPrivacySettingsUpdate({
      actor: { ...actor, id: actorId },
      board: {
        id: row.id,
        boardType: row.board_type,
        ownerUserId: row.owner_user_id,
        personalVisibility: row.personal_visibility ?? "private",
        personalVisibilityTeamId: row.personal_visibility_team_id,
      },
      usersCanMakeBoardsPrivate: settings.usersCanMakeBoardsPrivate,
      eligibleTeamIds: new Set(eligibleTeams.map((team) => team.id)),
      input,
    });
    let updatedRow = row;

    if (policyResult.changed) {
      const updateResult = await client.query<DbBoardPrivacySettingsRow>(
        `
          UPDATE boards
          SET
            personal_visibility = $2,
            personal_visibility_team_id = $3,
            updated_by_user_id = $4,
            updated_at = NOW()
          WHERE id = $1
          RETURNING
            id,
            title,
            board_type,
            owner_user_id,
            personal_visibility,
            personal_visibility_team_id,
            NULL::text AS personal_visibility_team_name,
            NULL::boolean AS selected_team_policy_enabled,
            NULL::boolean AS owner_in_selected_team
        `,
        [
          row.id,
          policyResult.settings.personalVisibility,
          policyResult.settings.personalVisibilityTeamId,
          actorId,
        ],
      );
      updatedRow =
        (await getBoardPrivacySettingsRow(client, updateResult.rows[0]?.id ?? row.id)) ??
        updateResult.rows[0] ??
        row;

      for (const event of policyResult.auditEvents) {
        await client.query(
          `
            INSERT INTO admin_audit_events (
              id, actor_user_id, target_board_id, action, previous_values, new_values
            )
            VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
          `,
          [
            randomUUID(),
            actorId,
            row.id,
            event.action,
            JSON.stringify(event.previousValues),
            JSON.stringify(event.newValues),
          ],
        );
      }
    }

    const impactPreview = await getBoardPrivacyImpactPreview(
      client,
      updatedRow.personal_visibility_team_id,
      updatedRow.owner_user_id ?? "",
    );
    const response = mapBoardPrivacySettingsResponse({
      row: updatedRow,
      settings,
      eligibleTeams,
      impactPreview,
    });

    await client.query("COMMIT");

    return {
      settings: response,
      changed: policyResult.changed,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function mapPersonalBoardMemberCandidateRow(row: DbTeamMemberCandidateRow) {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
  };
}

async function mapPersonalBoardMemberGrantRow(
  client: PoolClient,
  board: DbBoardPrivacySettingsRow,
  row: DbPersonalBoardMemberGrantRow,
) {
  const access = await resolveEffectiveBoardAccess(
    client,
    {
      id: row.user_id,
      authMode: row.auth_provider === "authelia" ? "authelia" : "password",
      authProvider: row.auth_provider,
      email: row.email,
      username: row.username ?? undefined,
      displayName: row.display_name,
      role: row.app_role,
      isDisabled: row.is_disabled,
      isReservedLocalAdmin: row.is_reserved_local_admin,
    },
    {
      id: board.id,
      owner_user_id: board.owner_user_id,
      board_type: "personal",
      owner_team_id: null,
      team_member_default_access: null,
      personal_visibility: board.personal_visibility ?? "private",
      personal_visibility_team_id: board.personal_visibility_team_id,
    },
  );

  return {
    userId: row.user_id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    role: row.explicit_role,
    canRead: access.canRead,
    canEdit: access.canEdit,
    canManage: access.canManage,
    source: access.source,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export type PersonalBoardMemberCandidate = ReturnType<typeof mapPersonalBoardMemberCandidateRow>;
export type PersonalBoardMemberGrant = Awaited<ReturnType<typeof mapPersonalBoardMemberGrantRow>>;

async function insertPersonalBoardMemberAuditEvent(
  client: PoolClient,
  args: {
    actorUserId: string;
    targetUserId: string;
    targetBoardId: string;
    action: PersonalBoardMemberAuditAction;
    previousValues?: Record<string, unknown>;
    newValues?: Record<string, unknown>;
  },
) {
  await client.query(
    `
      INSERT INTO admin_audit_events (
        id, actor_user_id, target_user_id, target_board_id, action, previous_values, new_values
      )
      VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)
    `,
    [
      randomUUID(),
      args.actorUserId,
      args.targetUserId,
      args.targetBoardId,
      args.action,
      JSON.stringify(args.previousValues ?? {}),
      JSON.stringify(args.newValues ?? {}),
    ],
  );
}

function assertPersonalBoardSharingActor(actor: TaskboardUserIdentity) {
  if (actor.isDisabled) {
    throw new Error("Taskboard user is disabled.");
  }
}

async function getPersonalBoardForSharing(
  client: PoolClient,
  actor: TaskboardUserIdentity,
  boardId: string,
  options?: { forUpdate?: boolean },
) {
  const row = await getBoardPrivacySettingsRow(client, boardId, options);

  if (!row) {
    throw new BoardAccessError("board_not_found", "Board not found.", 404);
  }

  if (!canManagePersonalBoardShares(actor, {
    id: row.id, boardType: row.board_type, ownerUserId: row.owner_user_id,
  })) throw new BoardAccessError("board_not_found", "Board not found.", 404);

  return row;
}

async function listPersonalBoardMemberGrantRows(client: PoolClient, boardId: string) {
  const result = await client.query<DbPersonalBoardMemberGrantRow>(
    `
      SELECT
        users.id AS user_id,
        users.email,
        users.username,
        users.display_name,
        users.role AS app_role,
        users.is_disabled,
        users.is_reserved_local_admin,
        users.auth_provider,
        board_members.role AS explicit_role,
        board_members.created_at::text AS created_at,
        board_members.updated_at::text AS updated_at
      FROM board_members
      INNER JOIN users ON users.id = board_members.user_id
      INNER JOIN boards ON boards.id = board_members.board_id
      WHERE board_members.board_id = $1
        AND boards.board_type = 'personal'
      ORDER BY
        CASE board_members.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END,
        users.is_disabled ASC,
        LOWER(users.display_name) ASC,
        users.email ASC,
        users.id ASC
    `,
    [boardId],
  );

  return result.rows;
}

export async function listPersonalBoardMembers(
  actor: TaskboardUserIdentity,
  boardId: string,
) {
  await ensureDatabaseReady();

  const normalizedBoardId = normalizeBoardId(boardId);
  if (!normalizedBoardId) {
    throw new BoardAccessError("invalid_board_id", "boardId must be a valid UUID.", 400);
  }

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();

  try {
    assertPersonalBoardSharingActor(actor);
    const actorId = await getOrCreateUserRecord(client, actor);
    const actorWithId = { ...actor, id: actorId };
    const board = await getPersonalBoardForSharing(client, actorWithId, normalizedBoardId);
    const rows = await listPersonalBoardMemberGrantRows(client, board.id);
    const members: PersonalBoardMemberGrant[] = [];

    for (const row of rows) {
      members.push(await mapPersonalBoardMemberGrantRow(client, board, row));
    }

    return {
      board: {
        id: board.id,
        title: board.title,
        ownerUserId: board.owner_user_id,
      },
      members,
    };
  } finally {
    client.release();
  }
}

export async function listPersonalBoardMemberCandidates(
  actor: TaskboardUserIdentity,
  boardId: string,
  query: string,
) {
  const search = query.trim();

  if (search.length < 2) {
    throw new Error("Search query must be at least 2 characters.");
  }

  await ensureDatabaseReady();

  const normalizedBoardId = normalizeBoardId(boardId);
  if (!normalizedBoardId) {
    throw new BoardAccessError("invalid_board_id", "boardId must be a valid UUID.", 400);
  }

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();

  try {
    assertPersonalBoardSharingActor(actor);
    const actorId = await getOrCreateUserRecord(client, actor);
    const actorWithId = { ...actor, id: actorId };
    const board = await getPersonalBoardForSharing(client, actorWithId, normalizedBoardId);

    const result = await client.query<DbTeamMemberCandidateRow>(
      `
        SELECT
          users.id,
          users.email,
          users.username,
          users.display_name
        FROM users
        LEFT JOIN board_members
          ON board_members.board_id = $1
          AND board_members.user_id = users.id
        WHERE users.is_disabled = FALSE
          AND users.id <> $2
          AND board_members.user_id IS NULL
          AND (
            users.email ILIKE $3
            OR users.username ILIKE $3
            OR users.display_name ILIKE $3
          )
        ORDER BY
          LOWER(users.display_name) ASC,
          users.email ASC,
          users.id ASC
        LIMIT 10
      `,
      [board.id, board.owner_user_id, `%${search}%`],
    );

    return result.rows.map(mapPersonalBoardMemberCandidateRow);
  } finally {
    client.release();
  }
}

export async function addPersonalBoardMember(
  actor: TaskboardUserIdentity,
  boardId: string,
  input: { userId: string; role: unknown },
) {
  assertValidUuid(input.userId, "userId");
  const role = normalizePersonalBoardMemberGrantRole(input.role);

  await ensureDatabaseReady();

  const normalizedBoardId = normalizeBoardId(boardId);
  if (!normalizedBoardId) {
    throw new BoardAccessError("invalid_board_id", "boardId must be a valid UUID.", 400);
  }

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();
  await client.query("BEGIN");

  try {
    assertPersonalBoardSharingActor(actor);
    const actorId = await getOrCreateUserRecord(client, actor);
    const actorWithId = { ...actor, id: actorId };
    const board = await getPersonalBoardForSharing(client, actorWithId, normalizedBoardId, {
      forUpdate: true,
    });

    if (input.userId === board.owner_user_id) {
      throw new Error("Board owner cannot be granted explicit board access.");
    }

    const target = await getAdminUserRowById(client, input.userId);
    if (!target) {
      throw new Error("User not found.");
    }
    if (target.is_disabled) {
      throw new Error("Disabled users cannot be granted board access.");
    }

    const result = await client.query<DbPersonalBoardMemberGrantRow>(
      `
        INSERT INTO board_members (board_id, user_id, role)
        VALUES ($1, $2, $3)
        RETURNING
          user_id,
          $4::text AS email,
          $5::text AS username,
          $6::text AS display_name,
          $7::text AS app_role,
          $8::boolean AS is_disabled,
          $9::boolean AS is_reserved_local_admin,
          $10::text AS auth_provider,
          role AS explicit_role,
          created_at::text AS created_at,
          updated_at::text AS updated_at
      `,
      [
        board.id,
        input.userId,
        role,
        target.email,
        target.username,
        target.display_name,
        target.role,
        target.is_disabled,
        target.is_reserved_local_admin,
        target.auth_provider,
      ],
    );

    await insertPersonalBoardMemberAuditEvent(client, {
      actorUserId: actorId,
      targetUserId: input.userId,
      targetBoardId: board.id,
      action: "personal_board.member_grant.added",
      newValues: { role },
    });

    const member = await mapPersonalBoardMemberGrantRow(client, board, result.rows[0]);

    await client.query("COMMIT");
    return member;
  } catch (error) {
    await client.query("ROLLBACK");
    if (isUniqueViolation(error)) {
      throw new Error("Board member grant already exists.");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function updatePersonalBoardMember(
  actor: TaskboardUserIdentity,
  boardId: string,
  targetUserId: string,
  input: { role: unknown },
) {
  assertValidUuid(targetUserId, "userId");
  const role = normalizePersonalBoardMemberGrantRole(input.role);

  await ensureDatabaseReady();

  const normalizedBoardId = normalizeBoardId(boardId);
  if (!normalizedBoardId) {
    throw new BoardAccessError("invalid_board_id", "boardId must be a valid UUID.", 400);
  }

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();
  await client.query("BEGIN");

  try {
    assertPersonalBoardSharingActor(actor);
    const actorId = await getOrCreateUserRecord(client, actor);
    const actorWithId = { ...actor, id: actorId };
    const board = await getPersonalBoardForSharing(client, actorWithId, normalizedBoardId, {
      forUpdate: true,
    });

    const grantResult = await client.query<DbPersonalBoardMemberGrantRow>(
      `
        SELECT
          users.id AS user_id,
          users.email,
          users.username,
          users.display_name,
          users.role AS app_role,
          users.is_disabled,
          users.is_reserved_local_admin,
          users.auth_provider,
          board_members.role AS explicit_role,
          board_members.created_at::text AS created_at,
          board_members.updated_at::text AS updated_at
        FROM board_members
        INNER JOIN users ON users.id = board_members.user_id
        WHERE board_members.board_id = $1 AND board_members.user_id = $2
        FOR UPDATE OF board_members
        LIMIT 1
      `,
      [board.id, targetUserId],
    );
    const grant = grantResult.rows[0];

    if (!grant) {
      throw new Error("Board member grant not found.");
    }
    if (grant.is_disabled) {
      throw new Error("Disabled users cannot be granted board access.");
    }

    if (grant.explicit_role === role) {
      await client.query("COMMIT");
      return await mapPersonalBoardMemberGrantRow(client, board, grant);
    }

    const updateResult = await client.query<DbPersonalBoardMemberGrantRow>(
      `
        UPDATE board_members
        SET role = $3, updated_at = NOW()
        WHERE board_id = $1 AND user_id = $2
        RETURNING
          user_id,
          $4::text AS email,
          $5::text AS username,
          $6::text AS display_name,
          $7::text AS app_role,
          $8::boolean AS is_disabled,
          $9::boolean AS is_reserved_local_admin,
          $10::text AS auth_provider,
          role AS explicit_role,
          created_at::text AS created_at,
          updated_at::text AS updated_at
      `,
      [
        board.id,
        targetUserId,
        role,
        grant.email,
        grant.username,
        grant.display_name,
        grant.app_role,
        grant.is_disabled,
        grant.is_reserved_local_admin,
        grant.auth_provider,
      ],
    );

    await insertPersonalBoardMemberAuditEvent(client, {
      actorUserId: actorId,
      targetUserId,
      targetBoardId: board.id,
      action: "personal_board.member_grant.changed",
      previousValues: { role: grant.explicit_role },
      newValues: { role },
    });

    const member = await mapPersonalBoardMemberGrantRow(client, board, updateResult.rows[0]);

    await client.query("COMMIT");
    return member;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function removePersonalBoardMember(
  actor: TaskboardUserIdentity,
  boardId: string,
  targetUserId: string,
) {
  assertValidUuid(targetUserId, "userId");

  await ensureDatabaseReady();

  const normalizedBoardId = normalizeBoardId(boardId);
  if (!normalizedBoardId) {
    throw new BoardAccessError("invalid_board_id", "boardId must be a valid UUID.", 400);
  }

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();
  await client.query("BEGIN");

  try {
    assertPersonalBoardSharingActor(actor);
    const actorId = await getOrCreateUserRecord(client, actor);
    const actorWithId = { ...actor, id: actorId };
    const board = await getPersonalBoardForSharing(client, actorWithId, normalizedBoardId, {
      forUpdate: true,
    });

    const grantResult = await client.query<{ role: "owner" | "editor" | "viewer" }>(
      `
        DELETE FROM board_members
        WHERE board_id = $1 AND user_id = $2
        RETURNING role
      `,
      [board.id, targetUserId],
    );
    const removed = grantResult.rows[0];

    if (!removed) {
      throw new Error("Board member grant not found.");
    }

    await insertPersonalBoardMemberAuditEvent(client, {
      actorUserId: actorId,
      targetUserId,
      targetBoardId: board.id,
      action: "personal_board.member_grant.removed",
      previousValues: { role: removed.role },
    });

    await client.query("COMMIT");
    return { ok: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function listAdminAuditEvents(
  actor: TaskboardUserIdentity,
  filters: AdminAuditEventFilters,
) {
  assertAdminAuditActor(actor);
  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const whereClauses: string[] = [];
  const values: unknown[] = [];

  function addFilter(clause: string, value: unknown) {
    values.push(value);
    whereClauses.push(clause.replace("?", `$${values.length}`));
  }

  if (filters.action) {
    addFilter("audit.action = ?", filters.action);
  }
  if (filters.actorUserId) {
    addFilter("audit.actor_user_id = ?", filters.actorUserId);
  }
  if (filters.targetUserId) {
    addFilter("audit.target_user_id = ?", filters.targetUserId);
  }
  if (filters.targetTeamId) {
    addFilter("audit.target_team_id = ?", filters.targetTeamId);
  }
  if (filters.targetBoardId) {
    addFilter("audit.target_board_id = ?", filters.targetBoardId);
  }
  if (filters.from) {
    addFilter("audit.created_at >= ?", filters.from);
  }
  if (filters.to) {
    addFilter("audit.created_at <= ?", filters.to);
  }

  values.push(filters.limit + 1);
  const limitParam = `$${values.length}`;
  values.push(filters.offset);
  const offsetParam = `$${values.length}`;
  const whereSql = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const poolClient = await pool.connect();

  try {
    const result = await poolClient.query<DbAdminAuditEventRow>(
      `
        SELECT
          audit.id,
          audit.action,
          audit.previous_values,
          audit.new_values,
          audit.created_at::text AS created_at,
          actor.id AS actor_id,
          actor.email AS actor_email,
          actor.username AS actor_username,
          actor.display_name AS actor_display_name,
          target_user.id AS target_user_id,
          target_user.email AS target_user_email,
          target_user.username AS target_user_username,
          target_user.display_name AS target_user_display_name,
          target_team.id AS target_team_id,
          target_team.name AS target_team_name,
          target_board.id AS target_board_id,
          target_board.title AS target_board_title
        FROM admin_audit_events audit
        LEFT JOIN users actor ON actor.id = audit.actor_user_id
        LEFT JOIN users target_user ON target_user.id = audit.target_user_id
        LEFT JOIN teams target_team ON target_team.id = audit.target_team_id
        LEFT JOIN boards target_board ON target_board.id = audit.target_board_id
        ${whereSql}
        ORDER BY audit.created_at DESC, audit.id DESC
        LIMIT ${limitParam}
        OFFSET ${offsetParam}
      `,
      values,
    );

    const rows = result.rows.slice(0, filters.limit);

    return {
      events: rows.map(mapAdminAuditEventRow),
      pagination: {
        limit: filters.limit,
        offset: filters.offset,
        hasMore: result.rows.length > filters.limit,
      },
    };
  } finally {
    poolClient.release();
  }
}

export async function updateAdminUser(
  actor: TaskboardUserIdentity,
  targetUserId: string,
  input: AdminUserUpdateInput,
) {
  assertAdminActor(actor);
  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();
  await client.query("BEGIN");

  try {
    const targetResult = await client.query<DbAdminUserRow>(
      `
        SELECT id, email, username, display_name, role, is_disabled, is_reserved_local_admin, auth_provider, created_at, updated_at
        FROM users
        WHERE id = $1
        FOR UPDATE
      `,
      [targetUserId],
    );
    const target = targetResult.rows[0];

    if (!target) {
      throw new Error("User not found.");
    }

    const policyResult = evaluateAdminUserUpdate(
      actor,
      {
        id: target.id,
        role: target.role,
        isDisabled: target.is_disabled,
        isReservedLocalAdmin: target.is_reserved_local_admin,
        authProvider: target.auth_provider,
      },
      input,
    );

    let updated = target;

    if (policyResult.auditEvents.length > 0) {
      const updateResult = await client.query<DbAdminUserRow>(
        `
          UPDATE users
          SET role = $2, is_disabled = $3, updated_at = NOW(),
              session_version = session_version + CASE WHEN $3 AND NOT is_disabled THEN 1 ELSE 0 END
          WHERE id = $1
          RETURNING id, email, username, display_name, role, is_disabled, is_reserved_local_admin, auth_provider, created_at, updated_at
        `,
        [target.id, policyResult.role, policyResult.isDisabled],
      );
      updated = updateResult.rows[0] ?? target;

      for (const event of policyResult.auditEvents) {
        await client.query(
          `
            INSERT INTO admin_audit_events (
              id, actor_user_id, target_user_id, action, previous_values, new_values
            )
            VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb)
          `,
          [
            randomUUID(),
            actor.id,
            target.id,
            event.action,
            JSON.stringify(event.previousValues),
            JSON.stringify(event.newValues),
          ],
        );
      }
    }

    await client.query("COMMIT");
    return mapAdminUserRow(updated);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

function mapTeamRow(row: DbTeamAccessRow, actor: TaskboardUserIdentity & { id: string }) {
  const context = {
    actorMembershipRole: row.actor_membership_role,
    isArchived: Boolean(row.archived_at),
  };

  return {
    id: row.id,
    name: row.name,
    description: row.description,
    personalBoardViewEnabled: row.personal_board_view_enabled,
    actorRole: row.actor_membership_role,
    memberCount: Number(row.member_count ?? "0"),
    archivedAt: row.archived_at ? new Date(row.archived_at).toISOString() : null,
    canManage: actor.role === "admin" || row.actor_membership_role === "manager",
    canManageMembers: actor.role === "admin" || row.actor_membership_role === "manager",
    canView: actor.role === "admin" || Boolean(context.actorMembershipRole),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapTeamMemberRow(row: DbTeamMemberRow) {
  return {
    userId: row.user_id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    appRole: row.app_role,
    isDisabled: row.is_disabled,
    teamRole: row.team_role,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapTeamMemberCandidateRow(row: DbTeamMemberCandidateRow) {
  return {
    id: row.id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
  };
}

async function mapTeamBoardMemberGrantRow(
  client: PoolClient,
  board: DbTeamBoardRow,
  row: DbTeamBoardMemberGrantRow,
) {
  const access = await resolveEffectiveBoardAccess(
    client,
    {
      id: row.user_id,
      authMode: row.auth_provider === "authelia" ? "authelia" : "password",
      authProvider: row.auth_provider,
      email: row.email,
      username: row.username ?? undefined,
      displayName: row.display_name,
      role: row.app_role,
      isDisabled: row.is_disabled,
      isReservedLocalAdmin: row.is_reserved_local_admin,
    },
    {
      id: board.id,
      owner_user_id: null,
      board_type: "team",
      owner_team_id: board.owner_team_id,
      team_member_default_access: board.team_member_default_access,
    },
  );

  return {
    userId: row.user_id,
    email: row.email,
    username: row.username,
    displayName: row.display_name,
    teamRole: row.team_role,
    explicitRole: row.explicit_role,
    teamMemberDefaultAccess: board.team_member_default_access,
    effectiveAccessLevel: access.level,
    canRead: access.canRead,
    canEdit: access.canEdit,
    canManage: access.canManage,
    source: access.source,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

async function mapTeamBoardRow(
  client: PoolClient,
  actor: TaskboardUserIdentity,
  row: DbTeamBoardRow,
) {
  const access = await resolveEffectiveBoardAccess(client, actor, {
    id: row.id,
    owner_user_id: null,
    board_type: "team",
    owner_team_id: row.owner_team_id,
    team_member_default_access: row.team_member_default_access,
  });

  return {
    boardId: row.id,
    teamId: row.owner_team_id,
    teamName: row.owner_team_name,
    title: row.title,
    description: row.description,
    boardType: "team" as const,
    teamMemberDefaultAccess: row.team_member_default_access,
    accessLevel: access.level,
    canRead: access.canRead,
    canEdit: access.canEdit,
    canManage: access.canManage,
    source: access.source,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

export type TeamListItem = ReturnType<typeof mapTeamRow>;
export type TeamMemberListItem = ReturnType<typeof mapTeamMemberRow>;
export type TeamMemberCandidate = ReturnType<typeof mapTeamMemberCandidateRow>;
export type TeamBoardMemberGrant = Awaited<ReturnType<typeof mapTeamBoardMemberGrantRow>>;
export type TeamBoardSummary = Awaited<ReturnType<typeof mapTeamBoardRow>>;

function assertValidUuid(value: string, label: string) {
  if (!isValidBoardId(value)) {
    throw new Error(`${label} must be a valid UUID.`);
  }
}

function isUniqueViolation(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

async function getTeamActorId(
  client: PoolClient,
  actor: TaskboardUserIdentity,
): Promise<string> {
  if (actor.isDisabled) {
    throw new Error("Taskboard user is disabled.");
  }

  return await getOrCreateUserRecord(client, actor);
}

async function getTeamAccessRowForActor(
  client: PoolClient,
  actor: TaskboardUserIdentity & { id: string },
  teamId: string,
  options: { forUpdate?: boolean } = {},
) {
  assertValidUuid(teamId, "teamId");

  const result = await client.query<DbTeamAccessRow>(
    `
      SELECT
        teams.id,
        teams.name,
        teams.description,
        teams.personal_board_view_enabled,
        actor_membership.role AS actor_membership_role,
        (
          SELECT COUNT(*)::text
          FROM team_members all_members
          WHERE all_members.team_id = teams.id
        ) AS member_count,
        teams.archived_at::text AS archived_at,
        teams.created_at::text AS created_at,
        teams.updated_at::text AS updated_at
      FROM teams
      LEFT JOIN team_members actor_membership
        ON actor_membership.team_id = teams.id
        AND actor_membership.user_id = $2
      WHERE teams.id = $1
        AND ($3::boolean OR actor_membership.user_id IS NOT NULL)
      ${options.forUpdate ? "FOR UPDATE OF teams" : ""}
    `,
    [teamId, actor.id, actor.role === "admin"],
  );

  return result.rows[0] ?? null;
}

async function insertTeamAuditEvent(
  client: PoolClient,
  args: {
    actorUserId: string;
    targetUserId?: string | null;
    targetTeamId: string;
    targetBoardId?: string | null;
    action: TeamAuditAction;
    previousValues?: Record<string, unknown>;
    newValues?: Record<string, unknown>;
  },
) {
  await client.query(
    `
      INSERT INTO admin_audit_events (
        id, actor_user_id, target_user_id, target_team_id, target_board_id, action, previous_values, new_values
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8::jsonb)
    `,
    [
      randomUUID(),
      args.actorUserId,
      args.targetUserId ?? null,
      args.targetTeamId,
      args.targetBoardId ?? null,
      args.action,
      JSON.stringify(args.previousValues ?? {}),
      JSON.stringify(args.newValues ?? {}),
    ],
  );
}

export async function getTeamPersonalBoardVisibilityImpact(
  actor: TaskboardUserIdentity,
  teamId: string,
) {
  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();

  try {
    const actorId = await getTeamActorId(client, actor);
    const actorWithId = { ...actor, id: actorId };
    assertCanManageTeamPersonalBoardVisibility(actorWithId);

    const team = await getTeamAccessRowForActor(client, actorWithId, teamId);

    if (!team) {
      throw new Error("Team not found.");
    }

    return await calculateTeamPersonalBoardVisibilityImpact(client, team.id);
  } finally {
    client.release();
  }
}

async function calculateTeamPersonalBoardVisibilityImpact(client: PoolClient, teamId: string) {
  const result = await client.query<{
    affected_users: string;
    affected_personal_boards: string;
    visibility_pairs: string;
    tasks: string;
    notes: string;
    attachments: string;
    imported_events: string;
    notifications: string;
  }>(
    `
      WITH active_member_boards AS (
        SELECT DISTINCT
          users.id AS user_id,
          boards.id AS board_id
        FROM team_members
        INNER JOIN teams
          ON teams.id = team_members.team_id
          AND teams.archived_at IS NULL
        INNER JOIN users
          ON users.id = team_members.user_id
          AND users.is_disabled = FALSE
        INNER JOIN boards
          ON boards.owner_user_id = users.id
          AND boards.board_type = 'personal'
        WHERE team_members.team_id = $1
      ),
      board_counts AS (
        SELECT
          active_member_boards.board_id,
          (SELECT COUNT(*)::bigint FROM tasks WHERE tasks.board_id = active_member_boards.board_id) AS tasks,
          (SELECT COUNT(*)::bigint FROM task_notes WHERE task_notes.board_id = active_member_boards.board_id) AS notes,
          (SELECT COUNT(*)::bigint FROM task_attachments WHERE task_attachments.board_id = active_member_boards.board_id) AS attachments,
          (SELECT COUNT(*)::bigint FROM imported_events WHERE imported_events.board_id = active_member_boards.board_id) AS imported_events,
          (SELECT COUNT(*)::bigint FROM task_notifications WHERE task_notifications.board_id = active_member_boards.board_id) AS notifications
        FROM active_member_boards
      ),
      visibility_pairs AS (
        SELECT viewer.user_id AS viewer_user_id, owner.board_id AS owner_board_id
        FROM active_member_boards viewer
        INNER JOIN active_member_boards owner
          ON owner.user_id <> viewer.user_id
      )
      SELECT
        (SELECT COUNT(DISTINCT user_id)::text FROM active_member_boards) AS affected_users,
        (SELECT COUNT(DISTINCT board_id)::text FROM active_member_boards) AS affected_personal_boards,
        (SELECT COUNT(*)::text FROM visibility_pairs) AS visibility_pairs,
        COALESCE((SELECT SUM(tasks)::text FROM board_counts), '0') AS tasks,
        COALESCE((SELECT SUM(notes)::text FROM board_counts), '0') AS notes,
        COALESCE((SELECT SUM(attachments)::text FROM board_counts), '0') AS attachments,
        COALESCE((SELECT SUM(imported_events)::text FROM board_counts), '0') AS imported_events,
        COALESCE((SELECT SUM(notifications)::text FROM board_counts), '0') AS notifications
    `,
    [teamId],
  );
  const row = result.rows[0];

  return {
    affectedUsers: Number(row?.affected_users ?? "0"),
    affectedPersonalBoards: Number(row?.affected_personal_boards ?? "0"),
    visibilityPairs: Number(row?.visibility_pairs ?? "0"),
    tasks: Number(row?.tasks ?? "0"),
    notes: Number(row?.notes ?? "0"),
    attachments: Number(row?.attachments ?? "0"),
    importedEvents: Number(row?.imported_events ?? "0"),
    notifications: Number(row?.notifications ?? "0"),
  };
}

export async function updateTeamPersonalBoardVisibility(
  actor: TaskboardUserIdentity,
  teamId: string,
  input: { enabled?: unknown },
) {
  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();
  await client.query("BEGIN");

  try {
    const actorId = await getTeamActorId(client, actor);
    const actorWithId = { ...actor, id: actorId };
    const team = await getTeamAccessRowForActor(client, actorWithId, teamId, {
      forUpdate: true,
    });

    if (!team) {
      throw new Error("Team not found.");
    }

    const policyResult = evaluateTeamPersonalBoardVisibilityUpdate(
      actorWithId,
      {
        actorMembershipRole: team.actor_membership_role,
        isArchived: Boolean(team.archived_at),
      },
      { personalBoardViewEnabled: team.personal_board_view_enabled },
      input,
    );

    let updated = team;

    if (policyResult.auditEvents.length > 0) {
      const updateResult = await client.query<DbTeamAccessRow>(
        `
          UPDATE teams
          SET personal_board_view_enabled = $2,
              updated_by_user_id = $3,
              updated_at = NOW()
          WHERE id = $1
          RETURNING
            id,
            name,
            description,
            personal_board_view_enabled,
            $4::text AS actor_membership_role,
            $5::text AS member_count,
            archived_at::text AS archived_at,
            created_at::text AS created_at,
            updated_at::text AS updated_at
        `,
        [
          team.id,
          policyResult.enabled,
          actorId,
          team.actor_membership_role,
          team.member_count ?? "0",
        ],
      );
      updated = updateResult.rows[0] ?? team;

      for (const event of policyResult.auditEvents) {
        await insertTeamAuditEvent(client, {
          actorUserId: actorId,
          targetTeamId: team.id,
          action: event.action,
          previousValues: event.previousValues,
          newValues: event.newValues,
        });
      }
    }

    const impact = await calculateTeamPersonalBoardVisibilityImpact(client, team.id);

    await client.query("COMMIT");
    return {
      team: mapTeamRow(updated, actorWithId),
      personalBoardVisibilityImpact: impact,
      changed: policyResult.auditEvents.length > 0,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function countActiveTeamManagers(client: PoolClient, teamId: string) {
  const result = await client.query<{ count: string }>(
    `
      SELECT COUNT(*)::text AS count
      FROM team_members
      INNER JOIN users ON users.id = team_members.user_id
      WHERE team_members.team_id = $1
        AND team_members.role = 'manager'
        AND users.is_disabled = FALSE
    `,
    [teamId],
  );

  return Number(result.rows[0]?.count ?? "0");
}

const boardGrantRank: Record<TeamBoardMemberGrantRole | TeamBoardDefaultAccess, number> = {
  viewer: 1,
  editor: 2,
  owner: 3,
};

function assertValidTeamBoardGrantRole(value: unknown): TeamBoardMemberGrantRole {
  if (!isValidTeamBoardMemberGrantRole(value)) {
    throw new Error("Board member grant role must be owner, editor, or viewer.");
  }

  return value;
}

function assertGrantStrengthensTeamAccess(args: {
  role: TeamBoardMemberGrantRole;
  teamRole: TeamMemberRole;
  teamMemberDefaultAccess: TeamBoardDefaultAccess;
}) {
  const baselineRole = args.teamRole === "manager" ? "owner" : args.teamMemberDefaultAccess;

  if (boardGrantRank[args.role] <= boardGrantRank[baselineRole]) {
    throw new Error("Board member grants must strengthen the user's team default access.");
  }
}

export async function listTeams(actor: TaskboardUserIdentity) {
  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();

  try {
    const actorId = await getTeamActorId(client, actor);
    const actorWithId = { ...actor, id: actorId };
    assertCanViewTeam(actorWithId, {
      actorMembershipRole: actorWithId.role === "admin" ? null : "member",
      isArchived: false,
    });

    const result = await client.query<DbTeamAccessRow>(
      `
        SELECT
          teams.id,
          teams.name,
          teams.description,
          teams.personal_board_view_enabled,
          actor_membership.role AS actor_membership_role,
          COUNT(all_members.user_id)::text AS member_count,
          teams.archived_at::text AS archived_at,
          teams.created_at::text AS created_at,
          teams.updated_at::text AS updated_at
        FROM teams
        LEFT JOIN team_members actor_membership
          ON actor_membership.team_id = teams.id
          AND actor_membership.user_id = $1
        LEFT JOIN team_members all_members
          ON all_members.team_id = teams.id
        WHERE teams.archived_at IS NULL
          AND ($2::boolean OR actor_membership.user_id IS NOT NULL)
        GROUP BY teams.id, actor_membership.role
        ORDER BY LOWER(BTRIM(teams.name)) ASC, teams.created_at ASC, teams.id ASC
      `,
      [actorId, actor.role === "admin"],
    );

    return result.rows.map((row) => mapTeamRow(row, actorWithId));
  } finally {
    client.release();
  }
}

export async function createTeam(
  actor: TaskboardUserIdentity,
  input: { name: unknown; description?: unknown },
) {
  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();
  await client.query("BEGIN");

  try {
    const actorId = await getTeamActorId(client, actor);
    const actorWithId = { ...actor, id: actorId };
    assertCanCreateTeam(actorWithId);

    const teamId = randomUUID();
    const name = normalizeTeamName(input.name);
    const description = normalizeTeamDescription(input.description);

    const result = await client.query<DbTeamAccessRow>(
      `
        WITH inserted_team AS (
          INSERT INTO teams (
            id, name, description, created_by_user_id, updated_by_user_id
          )
          VALUES ($1, $2, $3, $4, $4)
          RETURNING id, name, description, personal_board_view_enabled, archived_at, created_at, updated_at
        ),
        inserted_member AS (
          INSERT INTO team_members (team_id, user_id, role, added_by_user_id)
          VALUES ($1, $4, 'manager', $4)
          RETURNING role
        )
        SELECT
          inserted_team.id,
          inserted_team.name,
          inserted_team.description,
          inserted_team.personal_board_view_enabled,
          inserted_member.role AS actor_membership_role,
          '1'::text AS member_count,
          inserted_team.archived_at::text AS archived_at,
          inserted_team.created_at::text AS created_at,
          inserted_team.updated_at::text AS updated_at
        FROM inserted_team, inserted_member
      `,
      [teamId, name, description, actorId],
    );

    await insertTeamAuditEvent(client, {
      actorUserId: actorId,
      targetTeamId: teamId,
      action: "team.created",
      newValues: { name, description },
    });

    await client.query("COMMIT");
    return mapTeamRow(result.rows[0], actorWithId);
  } catch (error) {
    await client.query("ROLLBACK");
    if (isUniqueViolation(error)) {
      throw new Error("Active team name is already in use.");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function getTeamDetail(actor: TaskboardUserIdentity, teamId: string) {
  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();

  try {
    const actorId = await getTeamActorId(client, actor);
    const actorWithId = { ...actor, id: actorId };
    const team = await getTeamAccessRowForActor(client, actorWithId, teamId);

    if (!team) {
      throw new Error("Team not found.");
    }

    assertCanViewTeam(actorWithId, {
      actorMembershipRole: team.actor_membership_role,
      isArchived: Boolean(team.archived_at),
    });

    return mapTeamRow(team, actorWithId);
  } finally {
    client.release();
  }
}

export async function updateTeam(
  actor: TaskboardUserIdentity,
  teamId: string,
  input: { name?: unknown; description?: unknown },
) {
  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();
  await client.query("BEGIN");

  try {
    const actorId = await getTeamActorId(client, actor);
    const actorWithId = { ...actor, id: actorId };
    const team = await getTeamAccessRowForActor(client, actorWithId, teamId, {
      forUpdate: true,
    });

    if (!team) {
      throw new Error("Team not found.");
    }

    const policyResult = evaluateTeamMetadataUpdate(
      actorWithId,
      {
        actorMembershipRole: team.actor_membership_role,
        isArchived: Boolean(team.archived_at),
      },
      {
        name: team.name,
        description: team.description,
      },
      input,
    );

    let updated = team;

    if (policyResult.auditEvents.length > 0) {
      const updateResult = await client.query<DbTeamAccessRow>(
        `
          UPDATE teams
          SET name = $2, description = $3, updated_by_user_id = $4, updated_at = NOW()
          WHERE id = $1
          RETURNING
            id,
            name,
            description,
            personal_board_view_enabled,
            $5::text AS actor_membership_role,
            $6::text AS member_count,
            archived_at::text AS archived_at,
            created_at::text AS created_at,
            updated_at::text AS updated_at
        `,
        [
          team.id,
          policyResult.name,
          policyResult.description,
          actorId,
          team.actor_membership_role,
          team.member_count ?? "0",
        ],
      );
      updated = updateResult.rows[0] ?? team;

      for (const event of policyResult.auditEvents) {
        await insertTeamAuditEvent(client, {
          actorUserId: actorId,
          targetTeamId: team.id,
          action: event.action,
          previousValues: event.previousValues,
          newValues: event.newValues,
        });
      }
    }

    await client.query("COMMIT");
    return mapTeamRow(updated, actorWithId);
  } catch (error) {
    await client.query("ROLLBACK");
    if (isUniqueViolation(error)) {
      throw new Error("Active team name is already in use.");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function listTeamMembers(actor: TaskboardUserIdentity, teamId: string) {
  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();

  try {
    const actorId = await getTeamActorId(client, actor);
    const actorWithId = { ...actor, id: actorId };
    const team = await getTeamAccessRowForActor(client, actorWithId, teamId);

    if (!team) {
      throw new Error("Team not found.");
    }

    assertCanViewTeam(actorWithId, {
      actorMembershipRole: team.actor_membership_role,
      isArchived: Boolean(team.archived_at),
    });

    const result = await client.query<DbTeamMemberRow>(
      `
        SELECT
          users.id AS user_id,
          users.email,
          users.username,
          users.display_name,
          users.role AS app_role,
          users.is_disabled,
          team_members.role AS team_role,
          team_members.created_at::text AS created_at,
          team_members.updated_at::text AS updated_at
        FROM team_members
        INNER JOIN users ON users.id = team_members.user_id
        WHERE team_members.team_id = $1
        ORDER BY
          CASE team_members.role WHEN 'manager' THEN 0 ELSE 1 END,
          users.is_disabled ASC,
          LOWER(users.display_name) ASC,
          users.email ASC
      `,
      [team.id],
    );

    return result.rows.map(mapTeamMemberRow);
  } finally {
    client.release();
  }
}

export async function listTeamMemberCandidates(
  actor: TaskboardUserIdentity,
  teamId: string,
  query: string,
) {
  const search = query.trim();

  if (search.length < 2) {
    throw new Error("Search query must be at least 2 characters.");
  }

  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();

  try {
    const actorId = await getTeamActorId(client, actor);
    const actorWithId = { ...actor, id: actorId };
    const team = await getTeamAccessRowForActor(client, actorWithId, teamId);

    if (!team) {
      throw new Error("Team not found.");
    }

    assertCanManageTeamMembers(actorWithId, {
      actorMembershipRole: team.actor_membership_role,
      isArchived: Boolean(team.archived_at),
    });

    const result = await client.query<DbTeamMemberCandidateRow>(
      `
        SELECT
          users.id,
          users.email,
          users.username,
          users.display_name
        FROM users
        LEFT JOIN team_members
          ON team_members.team_id = $1
          AND team_members.user_id = users.id
        WHERE users.is_disabled = FALSE
          AND team_members.user_id IS NULL
          AND (
            users.email ILIKE $2
            OR users.username ILIKE $2
            OR users.display_name ILIKE $2
          )
        ORDER BY
          LOWER(users.display_name) ASC,
          users.email ASC,
          users.id ASC
        LIMIT 10
      `,
      [team.id, `%${search}%`],
    );

    return result.rows.map(mapTeamMemberCandidateRow);
  } finally {
    client.release();
  }
}

async function seedTeamBoardDefaultBuckets(client: PoolClient, boardId: string) {
  for (const [bucketIndex, bucket] of seedBoard.buckets.entries()) {
    await client.query(
      `
        INSERT INTO buckets (id, board_id, title, color, icon, sort_order, is_collapsed)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO NOTHING
      `,
      [
        stableUuid(`${boardId}:bucket:${bucket.id}`),
        boardId,
        bucket.title,
        bucket.color,
        bucket.icon,
        (bucketIndex + 1) * 1000,
        bucket.collapsed,
      ],
    );
  }
}

async function getTeamBoardRowForTeam(
  client: PoolClient,
  teamId: string,
  boardId: string,
  options: { forUpdate?: boolean } = {},
) {
  assertValidUuid(boardId, "boardId");

  const result = await client.query<DbTeamBoardRow>(
    `
      SELECT
        boards.id,
        boards.owner_team_id,
        teams.name AS owner_team_name,
        boards.title,
        boards.description,
        boards.team_member_default_access,
        boards.created_at::text AS created_at,
        boards.updated_at::text AS updated_at
      FROM boards
      INNER JOIN teams ON teams.id = boards.owner_team_id
      WHERE boards.id = $1
        AND boards.owner_team_id = $2
        AND boards.board_type = 'team'
      ${options.forUpdate ? "FOR UPDATE OF boards" : ""}
      LIMIT 1
    `,
    [boardId, teamId],
  );

  return result.rows[0] ?? null;
}

export async function listTeamBoards(actor: TaskboardUserIdentity, teamId: string) {
  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();

  try {
    const actorId = await getTeamActorId(client, actor);
    const actorWithId = { ...actor, id: actorId };
    const team = await getTeamAccessRowForActor(client, actorWithId, teamId);

    if (!team) {
      throw new Error("Team not found.");
    }

    assertCanViewTeam(actorWithId, {
      actorMembershipRole: team.actor_membership_role,
      isArchived: Boolean(team.archived_at),
    });

    const result = await client.query<DbTeamBoardRow>(
      `
        SELECT
          boards.id,
          boards.owner_team_id,
          $2::text AS owner_team_name,
          boards.title,
          boards.description,
          boards.team_member_default_access,
          boards.created_at::text AS created_at,
          boards.updated_at::text AS updated_at
        FROM boards
        WHERE boards.owner_team_id = $1
          AND boards.board_type = 'team'
        ORDER BY LOWER(boards.title) ASC, boards.created_at ASC, boards.id ASC
      `,
      [team.id, team.name],
    );

    const boards: TeamBoardSummary[] = [];
    for (const row of result.rows) {
      const summary = await mapTeamBoardRow(client, actorWithId, row);
      if (summary.canRead) {
        boards.push(summary);
      }
    }

    return boards;
  } finally {
    client.release();
  }
}

export async function createTeamBoard(
  actor: TaskboardUserIdentity,
  teamId: string,
  input: {
    title: unknown;
    description?: unknown;
    teamMemberDefaultAccess?: unknown;
  },
) {
  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();
  await client.query("BEGIN");

  try {
    const actorId = await getTeamActorId(client, actor);
    const actorWithId = { ...actor, id: actorId };
    const team = await getTeamAccessRowForActor(client, actorWithId, teamId, {
      forUpdate: true,
    });

    if (!team) {
      throw new Error("Team not found.");
    }

    assertCanManageTeam(actorWithId, {
      actorMembershipRole: team.actor_membership_role,
      isArchived: Boolean(team.archived_at),
    });

    const boardId = randomUUID();
    const title = normalizeTeamBoardTitle(input.title);
    const description = normalizeTeamBoardDescription(input.description);
    const teamMemberDefaultAccess = normalizeTeamBoardDefaultAccess(
      input.teamMemberDefaultAccess,
    );

    const result = await client.query<DbTeamBoardRow>(
      `
        INSERT INTO boards (
          id,
          owner_user_id,
          board_type,
          owner_team_id,
          team_member_default_access,
          title,
          description,
          created_by_user_id,
          updated_by_user_id
        )
        VALUES ($1, NULL, 'team', $2, $3, $4, $5, $6, $6)
        RETURNING
          id,
          owner_team_id,
          $7::text AS owner_team_name,
          title,
          description,
          team_member_default_access,
          created_at::text AS created_at,
          updated_at::text AS updated_at
      `,
      [
        boardId,
        team.id,
        teamMemberDefaultAccess,
        title,
        description,
        actorId,
        team.name,
      ],
    );

    await seedTeamBoardDefaultBuckets(client, boardId);

    await insertTeamAuditEvent(client, {
      actorUserId: actorId,
      targetTeamId: team.id,
      targetBoardId: boardId,
      action: "team_board.created",
      newValues: {
        title,
        description,
        teamMemberDefaultAccess,
      },
    });

    const summary = await mapTeamBoardRow(client, actorWithId, result.rows[0]);

    await client.query("COMMIT");
    return summary;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getTeamBoardDetail(
  actor: TaskboardUserIdentity,
  teamId: string,
  boardId: string,
) {
  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();

  try {
    const actorId = await getTeamActorId(client, actor);
    const actorWithId = { ...actor, id: actorId };
    const team = await getTeamAccessRowForActor(client, actorWithId, teamId);

    if (!team) {
      throw new Error("Team not found.");
    }

    assertCanViewTeam(actorWithId, {
      actorMembershipRole: team.actor_membership_role,
      isArchived: Boolean(team.archived_at),
    });

    const board = await getTeamBoardRowForTeam(client, team.id, boardId);
    if (!board) {
      throw new Error("Team board not found.");
    }

    const summary = await mapTeamBoardRow(client, actorWithId, board);
    if (!summary.canRead) {
      throw new Error("Team board access is required.");
    }

    return summary;
  } finally {
    client.release();
  }
}

export async function updateTeamBoard(
  actor: TaskboardUserIdentity,
  teamId: string,
  boardId: string,
  input: {
    title?: unknown;
    description?: unknown;
    teamMemberDefaultAccess?: unknown;
  },
) {
  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();
  await client.query("BEGIN");

  try {
    const actorId = await getTeamActorId(client, actor);
    const actorWithId = { ...actor, id: actorId };
    const team = await getTeamAccessRowForActor(client, actorWithId, teamId, {
      forUpdate: true,
    });

    if (!team) {
      throw new Error("Team not found.");
    }

    assertCanManageTeam(actorWithId, {
      actorMembershipRole: team.actor_membership_role,
      isArchived: Boolean(team.archived_at),
    });

    const board = await getTeamBoardRowForTeam(client, team.id, boardId, {
      forUpdate: true,
    });
    if (!board) {
      throw new Error("Team board not found.");
    }

    const title =
      input.title === undefined ? board.title : normalizeTeamBoardTitle(input.title);
    const description =
      input.description === undefined
        ? board.description
        : normalizeTeamBoardDescription(input.description);
    const teamMemberDefaultAccess =
      input.teamMemberDefaultAccess === undefined
        ? board.team_member_default_access
        : normalizeTeamBoardDefaultAccess(input.teamMemberDefaultAccess);

    const metadataPrevious: Record<string, unknown> = {};
    const metadataNext: Record<string, unknown> = {};

    if (title !== board.title) {
      metadataPrevious.title = board.title;
      metadataNext.title = title;
    }
    if (description !== board.description) {
      metadataPrevious.description = board.description;
      metadataNext.description = description;
    }

    const defaultAccessChanged =
      teamMemberDefaultAccess !== board.team_member_default_access;

    let updated = board;
    if (Object.keys(metadataNext).length > 0 || defaultAccessChanged) {
      const updateResult = await client.query<DbTeamBoardRow>(
        `
          UPDATE boards
          SET
            title = $3,
            description = $4,
            team_member_default_access = $5,
            updated_by_user_id = $6,
            updated_at = NOW()
          WHERE id = $1
            AND owner_team_id = $2
            AND board_type = 'team'
          RETURNING
            id,
            owner_team_id,
            $7::text AS owner_team_name,
            title,
            description,
            team_member_default_access,
            created_at::text AS created_at,
            updated_at::text AS updated_at
        `,
        [
          board.id,
          team.id,
          title,
          description,
          teamMemberDefaultAccess,
          actorId,
          team.name,
        ],
      );
      updated = updateResult.rows[0] ?? board;

      if (Object.keys(metadataNext).length > 0) {
        await insertTeamAuditEvent(client, {
          actorUserId: actorId,
          targetTeamId: team.id,
          targetBoardId: board.id,
          action: "team_board.updated",
          previousValues: metadataPrevious,
          newValues: metadataNext,
        });
      }

      if (defaultAccessChanged) {
        await insertTeamAuditEvent(client, {
          actorUserId: actorId,
          targetTeamId: team.id,
          targetBoardId: board.id,
          action: "team_board.default_access_changed",
          previousValues: {
            teamMemberDefaultAccess: board.team_member_default_access,
          },
          newValues: {
            teamMemberDefaultAccess,
          },
        });
      }
    }

    const summary = await mapTeamBoardRow(client, actorWithId, updated);

    await client.query("COMMIT");
    return summary;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function addTeamMember(
  actor: TaskboardUserIdentity,
  teamId: string,
  input: { userId: string; role: unknown },
) {
  assertValidUuid(input.userId, "userId");

  if (!isValidTeamMemberRole(input.role)) {
    throw new Error("Team member role must be manager or member.");
  }

  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();
  await client.query("BEGIN");

  try {
    const actorId = await getTeamActorId(client, actor);
    const actorWithId = { ...actor, id: actorId };
    const team = await getTeamAccessRowForActor(client, actorWithId, teamId, {
      forUpdate: true,
    });

    if (!team) {
      throw new Error("Team not found.");
    }

    assertCanManageTeamMembers(actorWithId, {
      actorMembershipRole: team.actor_membership_role,
      isArchived: Boolean(team.archived_at),
    });

    const target = await getAdminUserRowById(client, input.userId);
    if (!target) {
      throw new Error("User not found.");
    }
    if (target.is_disabled) {
      throw new Error("Disabled users cannot be added to teams.");
    }

    const existingResult = await client.query<{ user_id: string }>(
      `
        SELECT user_id
        FROM team_members
        WHERE team_id = $1 AND user_id = $2
        LIMIT 1
      `,
      [team.id, input.userId],
    );

    if (existingResult.rows[0]) {
      throw new Error("User is already a team member.");
    }

    const result = await client.query<DbTeamMemberRow>(
      `
        INSERT INTO team_members (team_id, user_id, role, added_by_user_id)
        VALUES ($1, $2, $3, $4)
        RETURNING
          user_id,
          $5::text AS email,
          $6::text AS username,
          $7::text AS display_name,
          $8::text AS app_role,
          $9::boolean AS is_disabled,
          role AS team_role,
          created_at::text AS created_at,
          updated_at::text AS updated_at
      `,
      [
        team.id,
        input.userId,
        input.role,
        actorId,
        target.email,
        target.username,
        target.display_name,
        target.role,
        target.is_disabled,
      ],
    );

    await insertTeamAuditEvent(client, {
      actorUserId: actorId,
      targetUserId: input.userId,
      targetTeamId: team.id,
      action: "team.member.added",
      newValues: { role: input.role },
    });

    await client.query("COMMIT");
    return mapTeamMemberRow(result.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    if (isUniqueViolation(error)) {
      throw new Error("User is already a team member.");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function updateTeamMember(
  actor: TaskboardUserIdentity,
  teamId: string,
  targetUserId: string,
  input: { role: unknown },
) {
  assertValidUuid(targetUserId, "userId");

  if (!isValidTeamMemberRole(input.role)) {
    throw new Error("Team member role must be manager or member.");
  }

  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();
  await client.query("BEGIN");

  try {
    const actorId = await getTeamActorId(client, actor);
    const actorWithId = { ...actor, id: actorId };
    const team = await getTeamAccessRowForActor(client, actorWithId, teamId, {
      forUpdate: true,
    });

    if (!team) {
      throw new Error("Team not found.");
    }

    assertCanManageTeamMembers(actorWithId, {
      actorMembershipRole: team.actor_membership_role,
      isArchived: Boolean(team.archived_at),
    });

    const memberResult = await client.query<DbTeamMemberRow>(
      `
        SELECT
          users.id AS user_id,
          users.email,
          users.username,
          users.display_name,
          users.role AS app_role,
          users.is_disabled,
          team_members.role AS team_role,
          team_members.created_at::text AS created_at,
          team_members.updated_at::text AS updated_at
        FROM team_members
        INNER JOIN users ON users.id = team_members.user_id
        WHERE team_members.team_id = $1 AND team_members.user_id = $2
        FOR UPDATE OF team_members
      `,
      [team.id, targetUserId],
    );
    const member = memberResult.rows[0];

    if (!member) {
      throw new Error("Team member not found.");
    }

    if (member.team_role === input.role) {
      await client.query("COMMIT");
      return mapTeamMemberRow(member);
    }

    assertActiveTeamManagerWouldRemain({
      actor: actorWithId,
      targetUserIsDisabled: member.is_disabled,
      targetCurrentRole: member.team_role,
      targetNextRole: input.role,
      activeManagerCount: await countActiveTeamManagers(client, team.id),
    });

    const updateResult = await client.query<DbTeamMemberRow>(
      `
        UPDATE team_members
        SET role = $3, updated_at = NOW()
        WHERE team_id = $1 AND user_id = $2
        RETURNING
          user_id,
          $4::text AS email,
          $5::text AS username,
          $6::text AS display_name,
          $7::text AS app_role,
          $8::boolean AS is_disabled,
          role AS team_role,
          created_at::text AS created_at,
          updated_at::text AS updated_at
      `,
      [
        team.id,
        targetUserId,
        input.role,
        member.email,
        member.username,
        member.display_name,
        member.app_role,
        member.is_disabled,
      ],
    );

    await insertTeamAuditEvent(client, {
      actorUserId: actorId,
      targetUserId,
      targetTeamId: team.id,
      action: "team.member.role_changed",
      previousValues: { role: member.team_role },
      newValues: { role: input.role },
    });

    await client.query("COMMIT");
    return mapTeamMemberRow(updateResult.rows[0]);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function removeTeamMember(
  actor: TaskboardUserIdentity,
  teamId: string,
  targetUserId: string,
) {
  assertValidUuid(targetUserId, "userId");
  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();
  await client.query("BEGIN");

  try {
    const actorId = await getTeamActorId(client, actor);
    const actorWithId = { ...actor, id: actorId };
    const team = await getTeamAccessRowForActor(client, actorWithId, teamId, {
      forUpdate: true,
    });

    if (!team) {
      throw new Error("Team not found.");
    }

    assertCanManageTeamMembers(actorWithId, {
      actorMembershipRole: team.actor_membership_role,
      isArchived: Boolean(team.archived_at),
    });

    const memberResult = await client.query<DbTeamMemberRow>(
      `
        SELECT
          users.id AS user_id,
          users.email,
          users.username,
          users.display_name,
          users.role AS app_role,
          users.is_disabled,
          team_members.role AS team_role,
          team_members.created_at::text AS created_at,
          team_members.updated_at::text AS updated_at
        FROM team_members
        INNER JOIN users ON users.id = team_members.user_id
        WHERE team_members.team_id = $1 AND team_members.user_id = $2
        FOR UPDATE OF team_members
      `,
      [team.id, targetUserId],
    );
    const member = memberResult.rows[0];

    if (!member) {
      throw new Error("Team member not found.");
    }

    assertActiveTeamManagerWouldRemain({
      actor: actorWithId,
      targetUserIsDisabled: member.is_disabled,
      targetCurrentRole: member.team_role,
      targetNextRole: null,
      activeManagerCount: await countActiveTeamManagers(client, team.id),
    });

    const removedGrantResult = await client.query<{
      board_id: string;
      role: TeamBoardMemberGrantRole;
    }>(
      `
        DELETE FROM board_members
        USING boards
        WHERE boards.id = board_members.board_id
          AND boards.owner_team_id = $1
          AND boards.board_type = 'team'
          AND board_members.user_id = $2
        RETURNING board_members.board_id, board_members.role
      `,
      [team.id, targetUserId],
    );

    await client.query(
      `
        DELETE FROM team_members
        WHERE team_id = $1 AND user_id = $2
      `,
      [team.id, targetUserId],
    );

    await insertTeamAuditEvent(client, {
      actorUserId: actorId,
      targetUserId,
      targetTeamId: team.id,
      action: "team.member.removed",
      previousValues: { role: member.team_role },
    });

    for (const removedGrant of removedGrantResult.rows) {
      await insertTeamAuditEvent(client, {
        actorUserId: actorId,
        targetUserId,
        targetTeamId: team.id,
        targetBoardId: removedGrant.board_id,
        action: "team_board.member_grant.removed",
        previousValues: {
          role: removedGrant.role,
          reason: "team_member_removed",
        },
      });
    }

    await client.query("COMMIT");
    return { ok: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function getTeamBoardGrantTarget(
  client: PoolClient,
  teamId: string,
  targetUserId: string,
  options: { forUpdate?: boolean } = {},
) {
  const result = await client.query<DbTeamBoardMemberGrantRow>(
    `
      SELECT
        users.id AS user_id,
        users.email,
        users.username,
        users.display_name,
        users.role AS app_role,
        users.is_disabled,
        users.is_reserved_local_admin,
        users.auth_provider,
        team_members.role AS team_role,
        'viewer'::text AS explicit_role,
        team_members.created_at::text AS created_at,
        team_members.updated_at::text AS updated_at
      FROM team_members
      INNER JOIN users ON users.id = team_members.user_id
      WHERE team_members.team_id = $1 AND team_members.user_id = $2
      ${options.forUpdate ? "FOR UPDATE OF team_members" : ""}
      LIMIT 1
    `,
    [teamId, targetUserId],
  );

  return result.rows[0] ?? null;
}

async function listTeamBoardGrantRows(client: PoolClient, boardId: string) {
  const result = await client.query<DbTeamBoardMemberGrantRow>(
    `
      SELECT
        users.id AS user_id,
        users.email,
        users.username,
        users.display_name,
        users.role AS app_role,
        users.is_disabled,
        users.is_reserved_local_admin,
        users.auth_provider,
        team_members.role AS team_role,
        board_members.role AS explicit_role,
        board_members.created_at::text AS created_at,
        board_members.updated_at::text AS updated_at
      FROM board_members
      INNER JOIN users ON users.id = board_members.user_id
      INNER JOIN boards ON boards.id = board_members.board_id
      INNER JOIN team_members
        ON team_members.team_id = boards.owner_team_id
        AND team_members.user_id = board_members.user_id
      WHERE board_members.board_id = $1
        AND boards.board_type = 'team'
      ORDER BY
        CASE board_members.role WHEN 'owner' THEN 0 WHEN 'editor' THEN 1 ELSE 2 END,
        users.is_disabled ASC,
        LOWER(users.display_name) ASC,
        users.email ASC,
        users.id ASC
    `,
    [boardId],
  );

  return result.rows;
}

export async function listTeamBoardMemberGrants(
  actor: TaskboardUserIdentity,
  teamId: string,
  boardId: string,
) {
  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();

  try {
    const actorId = await getTeamActorId(client, actor);
    const actorWithId = { ...actor, id: actorId };
    const team = await getTeamAccessRowForActor(client, actorWithId, teamId);

    if (!team) {
      throw new Error("Team not found.");
    }

    assertCanViewTeam(actorWithId, {
      actorMembershipRole: team.actor_membership_role,
      isArchived: Boolean(team.archived_at),
    });

    const board = await getTeamBoardRowForTeam(client, team.id, boardId);
    if (!board) {
      throw new Error("Team board not found.");
    }

    const summary = await mapTeamBoardRow(client, actorWithId, board);
    if (!summary.canRead) {
      throw new Error("Team board access is required.");
    }

    const rows = await listTeamBoardGrantRows(client, board.id);
    const grants: TeamBoardMemberGrant[] = [];

    for (const row of rows) {
      grants.push(await mapTeamBoardMemberGrantRow(client, board, row));
    }

    return {
      board: summary,
      grants,
    };
  } finally {
    client.release();
  }
}

export async function addTeamBoardMemberGrant(
  actor: TaskboardUserIdentity,
  teamId: string,
  boardId: string,
  input: { userId: string; role: unknown },
) {
  assertValidUuid(input.userId, "userId");
  const role = assertValidTeamBoardGrantRole(input.role);

  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();
  await client.query("BEGIN");

  try {
    const actorId = await getTeamActorId(client, actor);
    const actorWithId = { ...actor, id: actorId };
    const team = await getTeamAccessRowForActor(client, actorWithId, teamId, {
      forUpdate: true,
    });

    if (!team) {
      throw new Error("Team not found.");
    }

    assertCanManageTeam(actorWithId, {
      actorMembershipRole: team.actor_membership_role,
      isArchived: Boolean(team.archived_at),
    });

    const board = await getTeamBoardRowForTeam(client, team.id, boardId, {
      forUpdate: true,
    });
    if (!board) {
      throw new Error("Team board not found.");
    }

    const target = await getAdminUserRowById(client, input.userId);
    if (!target) {
      throw new Error("User not found.");
    }
    if (target.is_disabled) {
      throw new Error("Disabled users cannot be granted board access.");
    }

    const targetMembership = await getTeamBoardGrantTarget(client, team.id, input.userId, {
      forUpdate: true,
    });
    if (!targetMembership) {
      throw new Error("Board member grants require an existing team member.");
    }

    assertGrantStrengthensTeamAccess({
      role,
      teamRole: targetMembership.team_role,
      teamMemberDefaultAccess: board.team_member_default_access,
    });

    const result = await client.query<DbTeamBoardMemberGrantRow>(
      `
        INSERT INTO board_members (board_id, user_id, role)
        VALUES ($1, $2, $3)
        RETURNING
          user_id,
          $4::text AS email,
          $5::text AS username,
          $6::text AS display_name,
          $7::text AS app_role,
          $8::boolean AS is_disabled,
          $9::boolean AS is_reserved_local_admin,
          $10::text AS auth_provider,
          $11::text AS team_role,
          role AS explicit_role,
          created_at::text AS created_at,
          updated_at::text AS updated_at
      `,
      [
        board.id,
        input.userId,
        role,
        target.email,
        target.username,
        target.display_name,
        target.role,
        target.is_disabled,
        target.is_reserved_local_admin,
        target.auth_provider,
        targetMembership.team_role,
      ],
    );

    await insertTeamAuditEvent(client, {
      actorUserId: actorId,
      targetUserId: input.userId,
      targetTeamId: team.id,
      targetBoardId: board.id,
      action: "team_board.member_grant.added",
      newValues: { role },
    });

    const grant = await mapTeamBoardMemberGrantRow(client, board, result.rows[0]);

    await client.query("COMMIT");
    return grant;
  } catch (error) {
    await client.query("ROLLBACK");
    if (isUniqueViolation(error)) {
      throw new Error("Board member grant already exists.");
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function updateTeamBoardMemberGrant(
  actor: TaskboardUserIdentity,
  teamId: string,
  boardId: string,
  targetUserId: string,
  input: { role: unknown },
) {
  assertValidUuid(targetUserId, "userId");
  const role = assertValidTeamBoardGrantRole(input.role);

  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();
  await client.query("BEGIN");

  try {
    const actorId = await getTeamActorId(client, actor);
    const actorWithId = { ...actor, id: actorId };
    const team = await getTeamAccessRowForActor(client, actorWithId, teamId, {
      forUpdate: true,
    });

    if (!team) {
      throw new Error("Team not found.");
    }

    assertCanManageTeam(actorWithId, {
      actorMembershipRole: team.actor_membership_role,
      isArchived: Boolean(team.archived_at),
    });

    const board = await getTeamBoardRowForTeam(client, team.id, boardId, {
      forUpdate: true,
    });
    if (!board) {
      throw new Error("Team board not found.");
    }

    const grantResult = await client.query<DbTeamBoardMemberGrantRow>(
      `
        SELECT
          users.id AS user_id,
          users.email,
          users.username,
          users.display_name,
          users.role AS app_role,
          users.is_disabled,
          users.is_reserved_local_admin,
          users.auth_provider,
          team_members.role AS team_role,
          board_members.role AS explicit_role,
          board_members.created_at::text AS created_at,
          board_members.updated_at::text AS updated_at
        FROM board_members
        INNER JOIN users ON users.id = board_members.user_id
        INNER JOIN team_members
          ON team_members.team_id = $1
          AND team_members.user_id = board_members.user_id
        WHERE board_members.board_id = $2 AND board_members.user_id = $3
        FOR UPDATE OF board_members
        LIMIT 1
      `,
      [team.id, board.id, targetUserId],
    );
    const grant = grantResult.rows[0];

    if (!grant) {
      throw new Error("Board member grant not found.");
    }
    if (grant.is_disabled) {
      throw new Error("Disabled users cannot be granted board access.");
    }

    assertGrantStrengthensTeamAccess({
      role,
      teamRole: grant.team_role,
      teamMemberDefaultAccess: board.team_member_default_access,
    });

    if (grant.explicit_role === role) {
      await client.query("COMMIT");
      return await mapTeamBoardMemberGrantRow(client, board, grant);
    }

    const updateResult = await client.query<DbTeamBoardMemberGrantRow>(
      `
        UPDATE board_members
        SET role = $3, updated_at = NOW()
        WHERE board_id = $1 AND user_id = $2
        RETURNING
          user_id,
          $4::text AS email,
          $5::text AS username,
          $6::text AS display_name,
          $7::text AS app_role,
          $8::boolean AS is_disabled,
          $9::boolean AS is_reserved_local_admin,
          $10::text AS auth_provider,
          $11::text AS team_role,
          role AS explicit_role,
          created_at::text AS created_at,
          updated_at::text AS updated_at
      `,
      [
        board.id,
        targetUserId,
        role,
        grant.email,
        grant.username,
        grant.display_name,
        grant.app_role,
        grant.is_disabled,
        grant.is_reserved_local_admin,
        grant.auth_provider,
        grant.team_role,
      ],
    );

    await insertTeamAuditEvent(client, {
      actorUserId: actorId,
      targetUserId,
      targetTeamId: team.id,
      targetBoardId: board.id,
      action: "team_board.member_grant.changed",
      previousValues: { role: grant.explicit_role },
      newValues: { role },
    });

    const mapped = await mapTeamBoardMemberGrantRow(client, board, updateResult.rows[0]);

    await client.query("COMMIT");
    return mapped;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function removeTeamBoardMemberGrant(
  actor: TaskboardUserIdentity,
  teamId: string,
  boardId: string,
  targetUserId: string,
) {
  assertValidUuid(targetUserId, "userId");
  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();
  await client.query("BEGIN");

  try {
    const actorId = await getTeamActorId(client, actor);
    const actorWithId = { ...actor, id: actorId };
    const team = await getTeamAccessRowForActor(client, actorWithId, teamId, {
      forUpdate: true,
    });

    if (!team) {
      throw new Error("Team not found.");
    }

    assertCanManageTeam(actorWithId, {
      actorMembershipRole: team.actor_membership_role,
      isArchived: Boolean(team.archived_at),
    });

    const board = await getTeamBoardRowForTeam(client, team.id, boardId, {
      forUpdate: true,
    });
    if (!board) {
      throw new Error("Team board not found.");
    }

    const grantResult = await client.query<{ role: TeamBoardMemberGrantRole }>(
      `
        DELETE FROM board_members
        WHERE board_id = $1 AND user_id = $2
        RETURNING role
      `,
      [board.id, targetUserId],
    );
    const removed = grantResult.rows[0];

    if (!removed) {
      throw new Error("Board member grant not found.");
    }

    await insertTeamAuditEvent(client, {
      actorUserId: actorId,
      targetUserId,
      targetTeamId: team.id,
      targetBoardId: board.id,
      action: "team_board.member_grant.removed",
      previousValues: { role: removed.role },
    });

    await client.query("COMMIT");
    return { ok: true };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getReservedLocalAdminLoginRecord() {
  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    return null;
  }

  const client = await pool.connect();

  try {
    return await getReservedLocalAdminAuthRow(client);
  } finally {
    client.release();
  }
}

export async function getReservedLocalAdminSetupStatus() {
  const admin = await getReservedLocalAdminLoginRecord();
  return {
    required: !admin?.local_password_hash,
  };
}

export async function setReservedLocalAdminPasswordHash(userId: string, passwordHash: string) {
  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  await pool.query(
    `
      UPDATE users
      SET local_password_hash = $2, updated_at = NOW()
      WHERE id = $1 AND is_reserved_local_admin = TRUE
    `,
    [userId, passwordHash],
  );
}

export async function setupReservedLocalAdmin(args: {
  username: string;
  displayName: string;
  passwordHash: string;
}) {
  await ensureDatabaseReady();

  const pool = getPool();
  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const normalizedUsername = args.username.trim().toLowerCase();
  const displayName = args.displayName.trim() || legacyOwnerDisplayName;
  const client = await pool.connect();

  await client.query("BEGIN");

  try {
    const existingUsername = await client.query<{ id: string }>(
      `
        SELECT id
        FROM users
        WHERE LOWER(username) = $1 AND is_reserved_local_admin = FALSE
        LIMIT 1
      `,
      [normalizedUsername],
    );

    if (existingUsername.rows[0]) {
      throw new Error("Username is already in use.");
    }

    let admin = await getReservedLocalAdminAuthRow(client);

    if (!admin) {
      const legacyOwner = await client.query<DbUserAuthRow>(
        `
          SELECT id, email, username, display_name, role, is_disabled, is_reserved_local_admin, local_password_hash, auth_provider
          FROM users
          WHERE email = $1
          LIMIT 1
        `,
        [legacyOwnerEmail],
      );
      admin = legacyOwner.rows[0] ?? null;
    }

    const adminId = admin?.id ?? stableUuid("seed-user");
    await client.query(
      `
        INSERT INTO users (
          id, email, username, display_name, role, is_disabled,
          is_reserved_local_admin, local_password_hash, auth_provider, updated_at
        )
        VALUES ($1, $2, $3, $4, 'admin', FALSE, TRUE, $5, 'local', NOW())
        ON CONFLICT (id) DO UPDATE
        SET
          username = EXCLUDED.username,
          display_name = EXCLUDED.display_name,
          role = 'admin',
          is_disabled = FALSE,
          is_reserved_local_admin = TRUE,
          local_password_hash = EXCLUDED.local_password_hash,
          auth_provider = 'local',
          updated_at = NOW()
      `,
      [adminId, legacyOwnerEmail, normalizedUsername, displayName, args.passwordHash],
    );

    const row = await getUserAuthRowById(client, adminId);

    await client.query("COMMIT");

    if (!row) {
      throw new Error("Reserved local admin setup failed.");
    }

    return taskboardUserIdentityFromRow(
      { ...row, username: normalizedUsername, display_name: displayName },
      "password",
    );
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function getBoardFromDatabase(
  user: TaskboardUserIdentity,
  options: BoardContextOptions = {},
) {
  const state = await getBoardStateFromDatabase(user, options);
  return state?.board ?? null;
}

export async function getBoardStateFromDatabase(
  user: TaskboardUserIdentity,
  options: BoardContextOptions = {},
) {
  const pool = getPool();

  if (!pool) {
    return null;
  }

  const client = await pool.connect();

  try {
    return await fetchBoardStateForUser(client, user, options);
  } finally {
    client.release();
  }
}

// Cheap check for open pages: the board's current revision, after the same
// read-access check as loading the board, so lost access stops updates.
export async function getBoardRevisionForUser(user: TaskboardUserIdentity, boardId: string) {
  await ensureDatabaseReady();
  const pool = getPool();

  if (!pool) {
    return null;
  }

  const client = await pool.connect();

  try {
    const { board } = await resolveBoardContext(client, user, { boardId }, "read");
    return readBoardRevision(client, board.id);
  } finally {
    client.release();
  }
}

export type LiveBoardChannel =
  | { status: "ok"; revision: number }
  | { status: "forbidden" | "not_found" };

export type LiveState = {
  board?: LiveBoardChannel;
  boards: { token: string; boards?: AccessibleBoardSummary[]; personalBoardId?: string | null };
  notes?: { token: string };
};

const liveToken = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 32);

// Everything an open page polls (GET /api/live), read-only. Each channel
// stands on its own: losing access to the shown board does not stop the board
// list or Notes from updating. The board list is returned only when it
// differs from the token the page holds.
export async function getLiveStateForUser(
  user: TaskboardUserIdentity,
  options: { boardId?: string | null; boardsToken?: string | null; notes?: boolean },
): Promise<LiveState | null> {
  await ensureDatabaseReady();
  const pool = getPool();

  if (!pool) {
    return null;
  }

  if (!user.id) {
    throw new BoardAccessError("board_access_denied", "Board access is unavailable.", 403);
  }

  const client = await pool.connect();

  try {
    let board: LiveBoardChannel | undefined;

    if (options.boardId) {
      try {
        const context = await resolveBoardContext(client, user, { boardId: options.boardId }, "read");
        board = { status: "ok", revision: await readBoardRevision(client, context.board.id) };
      } catch (error) {
        if (!(error instanceof BoardAccessError)) {
          throw error;
        }
        board = { status: error.status === 403 ? "forbidden" : "not_found" };
      }
    }

    const personalBoardId = (await getBoardRowForUserId(client, user.id))?.id ?? null;
    const boards = await queryAccessibleBoards(client, user, user.id, personalBoardId);
    const boardsToken = liveToken({ boards, personalBoardId });
    const state: LiveState = {
      ...(board ? { board } : {}),
      boards: options.boardsToken === boardsToken
        ? { token: boardsToken }
        : { token: boardsToken, boards, personalBoardId },
    };

    if (options.notes) {
      const revisions = await readNoteDependencyRevisions(client, user.id, boards.map((item) => item.boardId));
      state.notes = { token: liveToken({ boardsToken, revisions }) };
    }

    return state;
  } finally {
    client.release();
  }
}

// The calendar's data for one board, for the live refresh. The revision is
// read first (see readBoardRevision), and failures throw rather than return
// an empty calendar. Imported events follow the pages' rule: only for
// the person's own personal board, and only when the page asked for them.
export async function getCalendarSnapshotForUser(
  user: TaskboardUserIdentity,
  boardId: string,
  options: { imported: boolean },
) {
  await ensureDatabaseReady();
  const pool = getPool();

  if (!pool) {
    return null;
  }

  const client = await pool.connect();

  try {
    const { board } = await resolveBoardContext(client, user, { boardId }, "read");
    const revision = await readBoardRevision(client, board.id);
    const calendarEntries = await queryCalendarEntries(client, board.id);
    const ownerEmail = user.email.trim().toLowerCase();
    const importedRows = options.imported && ownerEmail
      ? await queryPersonalImportedCalendarEvents(client, board.id, ownerEmail)
      : [];
    return { boardId: board.id, revision, calendarEntries, importedRows };
  } finally {
    client.release();
  }
}

export async function loadPreferredTaskboardState(
  user: TaskboardUserIdentity,
): Promise<TaskboardRuntimeState> {
  if (!isDatabaseConfigured()) {
    return loadTaskboardState(user);
  }

  try {
    await ensureDatabaseReady();

    const pool = getPool();

    if (!pool) {
      return loadTaskboardState(user);
    }

    const client = await pool.connect();

    try {
      const boardState = await fetchPreferredBoardStateForUser(client, user);

      return {
        board: boardState?.board ?? seedBoard,
        boardAccess: boardState?.boardAccess ?? getFallbackBoardAccess(user, seedBoard.id),
        currentUser: {
          id: user.id,
          email: user.email,
          displayName: user.displayName,
          username: user.username,
          role: user.role,
          authProvider: user.authProvider,
          isReservedLocalAdmin: user.isReservedLocalAdmin,
        },
        persistenceEnabled: Boolean(boardState),
      };
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Failed to load preferred board from database, falling back to default board.", error);
    return loadTaskboardState(user);
  }
}

function mapImportedCalendarSourceSyncStatus(value: string): ImportedCalendarSourceRow["syncStatus"] {
  return value === "stale" || value === "deleted" ? value : "active";
}

function mapImportedCalendarSourceProvider(value: string): ImportedCalendarSourceRow["provider"] {
  switch (value) {
    case "ics":
    case "google":
    case "manual":
      return value;
    default:
      return "manual";
  }
}

function colorForImportedCalendarProvider(provider: ImportedCalendarSourceRow["provider"]) {
  switch (provider) {
    case "ics":
      return "#0891b2";
    case "google":
      return "#16a34a";
    default:
      return "#64748b";
  }
}

function sourceRecordIdForImportedEvent(row: Pick<DbCalendarSourceConversionEventRow, "external_event_id" | "id">) {
  return row.external_event_id?.trim() || `imported-event:${row.id}`;
}

function buildConvertedImportedEventSummary(row: Pick<DbCalendarSourceConversionEventRow, "provider" | "location">) {
  const provider = mapImportedCalendarSourceProvider(row.provider);
  const label = provider === "ics"
    ? ".ics"
    : provider === "google" ? "Google Calendar" : "calendar";
  const location = row.location.trim();

  return location
    ? `Converted ${label} event at ${location}.`
    : `Converted ${label} event.`;
}

async function assertPersonalBoardOwnerForImportedConversion(
  client: PoolClient,
  user: TaskboardUserIdentity,
  board: Pick<DbBoardRow, "board_type" | "owner_user_id">,
) {
  const userId = await getOrCreateUserRecord(client, user);

  if (board.board_type !== "personal" || board.owner_user_id !== userId) {
    throw new BoardAccessError(
      "board_access_denied",
      "Only the personal board owner can convert imported calendar events.",
      403,
    );
  }

  return userId;
}

export async function listPersonalBoardImportedCalendarEvents(
  user: TaskboardUserIdentity,
  boardId: string,
): Promise<ImportedCalendarSourceRow[]> {
  const ownerEmail = user.email.trim().toLowerCase();

  if (!ownerEmail || !isDatabaseConfigured()) {
    return [];
  }

  try {
    await ensureDatabaseReady();

    const pool = getPool();

    if (!pool) {
      return [];
    }

    const client = await pool.connect();

    try {
      return await queryPersonalImportedCalendarEvents(client, boardId, ownerEmail);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Failed to load imported calendar source events.", error);
    return [];
  }
}

function mapCalendarEntryRow(row: DbCalendarEntryRow): CalendarEntry {
  return {
    id: row.id,
    boardId: row.board_id,
    title: row.title,
    startAt: new Date(row.starts_at).toISOString(),
    endAt: new Date(row.ends_at).toISOString(),
    allDay: row.all_day,
    location: row.location,
    description: row.description,
    color: row.color,
    updatedAt: new Date(row.updated_at).toISOString(),
    ...(row.linked_task_id ? { linkedTaskId: row.linked_task_id } : {}),
  };
}

// The board's calendar entries. Throws on failure; the page loader above turns
// that into an empty list, the live snapshot must not.
async function queryCalendarEntries(client: PoolClient, boardId: string): Promise<CalendarEntry[]> {
  const result = await client.query<DbCalendarEntryRow>(
    `
      SELECT
        id,
        board_id,
        title,
        starts_at,
        ends_at,
        all_day,
        location,
        description,
        color,
        linked_task_id,
        updated_at
      FROM calendar_entries
      WHERE board_id = $1
        AND deleted_at IS NULL
      ORDER BY starts_at ASC, updated_at DESC, id ASC
    `,
    [boardId],
  );

  return result.rows.map(mapCalendarEntryRow);
}

// Events imported for a personal board, if the board is ownerEmail's
// personal board. Throws on failure, like queryCalendarEntries.
async function queryPersonalImportedCalendarEvents(
  client: PoolClient,
  boardId: string,
  ownerEmail: string,
): Promise<ImportedCalendarSourceRow[]> {
        const result = await client.query<DbImportedCalendarSourceEventRow>(
    `
      WITH allowed_board AS (
        SELECT boards.id
        FROM boards
        INNER JOIN users owners
          ON owners.id = boards.owner_user_id
          AND owners.is_disabled IS FALSE
        WHERE
          boards.id = $1
          AND boards.board_type = 'personal'
          AND LOWER(owners.email) = $2
        LIMIT 1
      )
      SELECT
        imported_events.id,
        imported_events.provider,
        imported_events.external_event_id,
        imported_events.title,
        imported_events.starts_at,
        imported_events.ends_at,
        imported_events.location,
        imported_events.sync_status,
        imported_events.task_id,
        tasks.is_read_only_import AS linked_task_is_read_only_import,
        LOWER(COALESCE(imported_events.raw_payload->>'isRecurring', 'false')) = 'true' AS is_recurring
      FROM imported_events
      INNER JOIN allowed_board ON allowed_board.id = imported_events.board_id
      LEFT JOIN tasks
        ON tasks.id = imported_events.task_id
        AND tasks.board_id = imported_events.board_id
      WHERE imported_events.sync_status IN ('active', 'stale', 'deleted')
      ORDER BY imported_events.starts_at ASC NULLS LAST, imported_events.updated_at DESC, imported_events.id ASC
    `,
    [boardId, ownerEmail],
  );

  return result.rows.map((row) => ({
    id: row.id,
    provider: mapImportedCalendarSourceProvider(row.provider),
    externalEventId: row.external_event_id,
    title: row.title,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    location: row.location,
    syncStatus: mapImportedCalendarSourceSyncStatus(row.sync_status),
    linkedTaskId: row.task_id,
    linkedTaskIsReadOnlyImport: row.linked_task_is_read_only_import,
    isRecurring: row.is_recurring,
  }));
}

export async function listCalendarEntriesForBoard(
  user: TaskboardUserIdentity,
  boardId: string,
): Promise<CalendarEntry[]> {
  if (!isDatabaseConfigured()) {
    return [];
  }

  try {
    await ensureDatabaseReady();

    const pool = getPool();

    if (!pool) {
      return [];
    }

    const client = await pool.connect();

    try {
      const { board } = await resolveBoardContext(client, user, { boardId }, "read");
      return await queryCalendarEntries(client, board.id);
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Failed to load native calendar entries.", error);
    return [];
  }
}

export async function createNativeCalendarEntry(
  user: TaskboardUserIdentity,
  args: {
    title: string;
    startAt: string;
    endAt: string;
    allDay?: boolean;
    location?: string;
    description?: string;
    color?: string;
    bucketId?: string | null;
  },
  options: BoardContextOptions = {},
): Promise<
  | { kind: "calendar-entry"; calendarEntryId: string; calendarEntry: CalendarEntry }
  | { kind: "task"; taskId: string }
> {
  const pool = getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const title = requireNonEmptyString(args.title, "title");
  const startsAt = requireDateOrNull(args.startAt);
  const endsAt = requireDateOrNull(args.endAt);

  if (!startsAt || !endsAt) {
    throw new Error("Calendar entries require valid start and end times.");
  }

  if (new Date(endsAt).getTime() <= new Date(startsAt).getTime()) {
    throw new Error("Calendar entry end time must be after start time.");
  }

  const bucketId = args.bucketId?.trim() || null;

  if (bucketId) {
    const taskId = await createRootTask(user, {
      bucketId,
      title,
      summary: args.description?.trim() ?? "",
      startAt: startsAt,
      endAt: endsAt,
      dueAt: null,
      color: args.color ?? "#0f766e",
      icon: "calendar",
    }, options);

    if (!taskId) {
      throw new Error("Unable to create Taskboard task.");
    }

    return { kind: "task", taskId };
  }

  const client = await pool.connect();

  try {
 await client.query('BEGIN');const {board}=await resolveBoardContext(client,user,options,'edit');
    const result=await createNativeCalendarEntryInTransaction(client,user,board,args);
    await client.query('COMMIT');
    return result;
} catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function createNativeCalendarEntryInTransaction(client:PoolClient,user:TaskboardUserIdentity,board:Pick<DbBoardRow,'id'|'owner_user_id'|'board_type'>,args:{title:string;startAt:string;endAt:string;allDay?:boolean;location?:string;description?:string;color?:string;bucketId?:string|null}) {const title=requireNonEmptyString(args.title,"title");const {startAt:startsAt,endAt:endsAt}=requireNativeCalendarEntryRange(args);if(args.bucketId)throw new Error("Create a scheduled task when assigning a bucket.");

    const userId = await getOrCreateUserRecord(client, user);
    const calendarEntryId = mutationUUID();

    const entryResult = await client.query<DbCalendarEntryRow>(
      `
        INSERT INTO calendar_entries (
          id,
          board_id,
          created_by_user_id,
          updated_by_user_id,
          title,
          starts_at,
          ends_at,
          all_day,
          location,
          description,
          color
        )
        VALUES ($1, $2, $3, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING
          id,
          board_id,
          title,
          starts_at,
          ends_at,
          all_day,
          location,
          description,
          color,
          linked_task_id,
          updated_at
      `,
      [
        calendarEntryId,
        board.id,
        userId,
        title,
        startsAt,
        endsAt,
        Boolean(args.allDay),
        args.location?.trim() ?? "",
        args.description?.trim() ?? "",
        requireColor(args.color ?? "#14b8a6"),
      ],
    );

    const calendarEntry = entryResult.rows[0];

    if (!calendarEntry) {
      throw new Error("Calendar entry creation did not return the saved entry.");
    }


    return {
      kind: "calendar-entry" as const,
      calendarEntryId,
      calendarEntry: mapCalendarEntryRow(calendarEntry),
    };

}


function requireNativeCalendarEntryRange(args: { startAt: string; endAt: string }) {
  const startAt = requireDateOrNull(args.startAt);
  const endAt = requireDateOrNull(args.endAt);

  if (!startAt || !endAt) {
    throw new Error("Calendar entries require valid start and end times.");
  }

  if (Date.parse(endAt) <= Date.parse(startAt)) {
    throw new Error("Calendar entry end time must be after start time.");
  }

  return { startAt, endAt };
}

function requireCalendarEntryUpdatedAt(value: string) {
  const updatedAt = requireDateOrNull(value);

  if (!updatedAt) {
    throw new Error("expectedUpdatedAt is required.");
  }

  return updatedAt;
}

function calendarEntryUpdatedAtMatches(current: string | Date, expected: string) {
  return new Date(current).getTime() === Date.parse(expected);
}

export async function updateNativeCalendarEntry(
  user: TaskboardUserIdentity,
  calendarEntryId: string,
  args: {
    expectedUpdatedAt: string;
    title: string;
    startAt: string;
    endAt: string;
    allDay: boolean;
    location?: string;
    description?: string;
    color: string;
  },
  options: BoardContextOptions = {},
): Promise<CalendarEntry> {
 const pool=getPool();if(!pool)throw new Error('Persistence unavailable.');const client=await pool.connect();
 try { await client.query('BEGIN'); const {board}=await resolveBoardContext(client,user,options,'edit');
 const result=await updateNativeCalendarEntryInTransaction(client,user,board,calendarEntryId,args);await client.query('COMMIT');return result;
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

export async function updateNativeCalendarEntryInTransaction(client:PoolClient,user:TaskboardUserIdentity,board:Pick<DbBoardRow,'id'|'owner_user_id'|'board_type'>,calendarEntryId: string,args: {
    expectedUpdatedAt: string;
    title: string;
    startAt: string;
    endAt: string;
    allDay: boolean;
    location?: string;
    description?: string;
    color: string;
  }) {if (!isValidBoardId(calendarEntryId)) {
    throw new BoardAccessError("invalid_board_id", "Calendar entry id must be a valid UUID.", 400);
  }
const title = requireNonEmptyString(args.title, "title");
const expectedUpdatedAt = requireCalendarEntryUpdatedAt(args.expectedUpdatedAt);
const range = requireNativeCalendarEntryRange(args);
const color = requireColor(args.color);

    const userId = await getOrCreateUserRecord(client, user);
    const existingResult = await client.query<{ id: string; updated_at: string | Date }>(
      `
        SELECT id, updated_at
        FROM calendar_entries
        WHERE id = $1
          AND board_id = $2
          AND deleted_at IS NULL
          AND linked_task_id IS NULL
        FOR UPDATE
      `,
      [calendarEntryId, board.id],
    );
    const existing = existingResult.rows[0];

    if (!existing) {
      throw new BoardAccessError("board_not_found", "Calendar entry was not found.", 404);
    }

    if (!calendarEntryUpdatedAtMatches(existing.updated_at, expectedUpdatedAt)) {
      throw new BoardAccessError(
        "calendar_schedule_conflict",
        "This calendar entry changed elsewhere. Refresh and try again.",
        409,
      );
    }

    const updateResult = await client.query<DbCalendarEntryRow>(
      `
        UPDATE calendar_entries
        SET
          title = $3,
          starts_at = $4,
          ends_at = $5,
          all_day = $6,
          location = $7,
          description = $8,
          color = $9,
          updated_by_user_id = $10,
          updated_at = NOW()
        WHERE id = $1 AND board_id = $2
        RETURNING
          id,
          board_id,
          title,
          starts_at,
          ends_at,
          all_day,
          location,
          description,
          color,
          linked_task_id,
          updated_at
      `,
      [
        calendarEntryId,
        board.id,
        title,
        range.startAt,
        range.endAt,
        Boolean(args.allDay),
        args.location?.trim() ?? "",
        args.description?.trim() ?? "",
        color,
        userId,
      ],
    );
    const updatedEntry = updateResult.rows[0];

    if (!updatedEntry) {
      throw new Error("Calendar entry update did not return the saved entry.");
    }


    return mapCalendarEntryRow(updatedEntry);

}

export async function softDeleteNativeCalendarEntry(
  user: TaskboardUserIdentity,
  calendarEntryId: string,
  args: { expectedUpdatedAt: string },
  options: BoardContextOptions = {},
) {
 const pool=getPool();if(!pool)throw new Error('Persistence unavailable.');const client=await pool.connect();
 try { await client.query('BEGIN'); const {board}=await resolveBoardContext(client,user,options,'edit');
 const result=await softDeleteNativeCalendarEntryInTransaction(client,user,board,calendarEntryId,args);await client.query('COMMIT');return result;
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

export async function softDeleteNativeCalendarEntryInTransaction(client:PoolClient,user:TaskboardUserIdentity,board:Pick<DbBoardRow,'id'|'owner_user_id'|'board_type'>,calendarEntryId: string,args: { expectedUpdatedAt: string }) {if (!isValidBoardId(calendarEntryId)) {
    throw new BoardAccessError("invalid_board_id", "Calendar entry id must be a valid UUID.", 400);
  }
const expectedUpdatedAt = requireCalendarEntryUpdatedAt(args.expectedUpdatedAt);

    const userId = await getOrCreateUserRecord(client, user);
    const existingResult = await client.query<{ id: string; updated_at: string | Date }>(
      `
        SELECT id, updated_at
        FROM calendar_entries
        WHERE id = $1
          AND board_id = $2
          AND deleted_at IS NULL
          AND linked_task_id IS NULL
        FOR UPDATE
      `,
      [calendarEntryId, board.id],
    );
    const existing = existingResult.rows[0];

    if (!existing) {
      throw new BoardAccessError("board_not_found", "Calendar entry was not found.", 404);
    }

    if (!calendarEntryUpdatedAtMatches(existing.updated_at, expectedUpdatedAt)) {
      throw new BoardAccessError(
        "calendar_schedule_conflict",
        "This calendar entry changed elsewhere. Refresh and try again.",
        409,
      );
    }

    const deleteResult = await client.query<{ deleted_at: string | Date }>(
      `
        UPDATE calendar_entries
        SET
          deleted_at = NOW(),
          updated_by_user_id = $3,
          updated_at = NOW()
        WHERE id = $1 AND board_id = $2
        RETURNING deleted_at
      `,
      [calendarEntryId, board.id, userId],
    );
    const deletedAt = deleteResult.rows[0]?.deleted_at;

    if (!deletedAt) {
      throw new Error("Calendar entry deletion did not return a timestamp.");
    }


    return { calendarEntryId, deletedAt: new Date(deletedAt).toISOString() };

}

const minimumCalendarResizeDurationMs = 15 * 60 * 1000;
const dateOnlyCalendarValuePattern = /^\d{4}-\d{2}-\d{2}$/;

function requireTimedCalendarScheduleValue(value: string, fieldName: string) {
  const normalized = requireNonEmptyString(value, fieldName);

  if (dateOnlyCalendarValuePattern.test(normalized)) {
    throw new Error("All-day calendar items cannot be resized.");
  }

  const timestamp = Date.parse(normalized);

  if (!Number.isFinite(timestamp)) {
    throw new Error(`${fieldName} must be a valid date and time.`);
  }

  return new Date(timestamp).toISOString();
}

function requireTimedCalendarScheduleRange(args: { startAt: string; endAt: string }) {
  const startAt = requireTimedCalendarScheduleValue(args.startAt, "startAt");
  const endAt = requireTimedCalendarScheduleValue(args.endAt, "endAt");
  const durationMs = Date.parse(endAt) - Date.parse(startAt);

  if (durationMs < minimumCalendarResizeDurationMs) {
    throw new Error("Calendar items must be at least 15 minutes long.");
  }

  return { startAt, endAt };
}

function calendarScheduleValuesMatch(left: string, right: string) {
  return Date.parse(left) === Date.parse(right);
}

function nullableCalendarDatesMatch(left: string | null, right: string | null) {
  if (!left || !right) {
    return left === right;
  }

  return calendarScheduleValuesMatch(left, right);
}

export async function updateCalendarTaskSchedule(
  user: TaskboardUserIdentity,
  taskId: string,
  args: {
    expectedStartAt: string;
    expectedEndAt: string;
    startAt: string;
    endAt: string;
    scope: CalendarTaskScheduleScope;
  },
  options: BoardContextOptions = {},
): Promise<CalendarTaskScheduleUpdate[]> {
  if (!isValidBoardId(taskId)) {
    throw new BoardAccessError("invalid_board_id", "Task id must be a valid UUID.", 400);
  }

  const expected = requireTimedCalendarScheduleRange({
    startAt: args.expectedStartAt,
    endAt: args.expectedEndAt,
  });
  const proposed = requireTimedCalendarScheduleRange({
    startAt: args.startAt,
    endAt: args.endAt,
  });
  const pool = getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { board } = await resolveBoardContext(client, user, options, "edit");
    const taskResult = await client.query<{
      id: string;
      parent_task_id: string | null;
      status: TaskStatus;
      all_day: boolean;
      start_at: string | null;
      end_at: string | null;
      due_at: string | null;
      recurrence_rule: unknown;
      recurrence_series_id: string | null;
      is_read_only_import: boolean;
    }>(
      `
        SELECT
          id,
          parent_task_id,
          status,
          all_day,
          start_at,
          end_at,
          due_at,
          recurrence_rule,
          recurrence_series_id,
          is_read_only_import
        FROM tasks
        WHERE id = $1
          AND board_id = $2
          AND deleted_at IS NULL
          AND archived_at IS NULL
        FOR UPDATE
      `,
      [taskId, board.id],
    );
    const task = taskResult.rows[0];

    if (!task) {
      throw new BoardAccessError("board_not_found", "Calendar task was not found.", 404);
    }

    if (task.is_read_only_import) {
      throw new BoardAccessError(
        "board_access_denied",
        "Read-only imported tasks cannot be resized.",
        403,
      );
    }

    const currentRange = getEffectiveCalendarTaskResizeRange({
      allDay: task.all_day,
      dueAt: task.due_at,
      endAt: task.end_at,
      startAt: task.start_at,
    });

    if (!currentRange) {
      throw new Error("Only timed tasks can be resized.");
    }

    if (
      !calendarScheduleValuesMatch(currentRange.startAt, expected.startAt) ||
      !calendarScheduleValuesMatch(currentRange.endAt, expected.endAt)
    ) {
      throw new BoardAccessError(
        "calendar_schedule_conflict",
        "This calendar event changed elsewhere. Refresh and try again.",
        409,
      );
    }

    if (args.scope === "single") {
      await client.query(
        `
          UPDATE tasks
          SET start_at = $3, end_at = $4, updated_at = NOW()
          WHERE id = $1 AND board_id = $2
        `,
        [task.id, board.id, proposed.startAt, proposed.endAt],
      );
      await client.query("COMMIT");
      return [{ taskId: task.id, ...proposed }];
    }

    const recurrence = parseTaskRecurrenceRule(task.recurrence_rule);

    if (task.parent_task_id || !recurrence || !task.recurrence_series_id || !task.due_at) {
      throw new Error("This task does not have a complete recurring series to resize.");
    }

    const startOffsetMs = Date.parse(proposed.startAt) - Date.parse(task.due_at);
    const endOffsetMs = Date.parse(proposed.endAt) - Date.parse(task.due_at);
    const seriesResult = await client.query<{
      id: string;
      due_at: string;
    }>(
      `
        SELECT id, due_at
        FROM tasks
        WHERE board_id = $1
          AND recurrence_series_id = $2
          AND parent_task_id IS NULL
          AND deleted_at IS NULL
          AND archived_at IS NULL
          AND due_at IS NOT NULL
          AND (
            id = $3
            OR (status <> 'done' AND due_at >= $4)
          )
        ORDER BY due_at ASC, id ASC
        FOR UPDATE
      `,
      [board.id, task.recurrence_series_id, task.id, task.due_at],
    );
    const updates: CalendarTaskScheduleUpdate[] = [];

    for (const seriesTask of seriesResult.rows) {
      const dueAtMs = Date.parse(seriesTask.due_at);
      const nextRange = requireTimedCalendarScheduleRange({
        startAt: new Date(dueAtMs + startOffsetMs).toISOString(),
        endAt: new Date(dueAtMs + endOffsetMs).toISOString(),
      });

      await client.query(
        `
          UPDATE tasks
          SET start_at = $3, end_at = $4, updated_at = NOW()
          WHERE id = $1 AND board_id = $2
        `,
        [seriesTask.id, board.id, nextRange.startAt, nextRange.endAt],
      );
      updates.push({ taskId: seriesTask.id, ...nextRange });
    }

    await client.query("COMMIT");
    return updates;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateNativeCalendarEntrySchedule(
  user: TaskboardUserIdentity,
  calendarEntryId: string,
  args: {
    expectedStartAt: string;
    expectedEndAt: string;
    startAt: string;
    endAt: string;
  },
  options: BoardContextOptions = {},
) {
  if (!isValidBoardId(calendarEntryId)) {
    throw new BoardAccessError("invalid_board_id", "Calendar entry id must be a valid UUID.", 400);
  }

  const expected = requireTimedCalendarScheduleRange({
    startAt: args.expectedStartAt,
    endAt: args.expectedEndAt,
  });
  const proposed = requireTimedCalendarScheduleRange({
    startAt: args.startAt,
    endAt: args.endAt,
  });
  const pool = getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { board } = await resolveBoardContext(client, user, options, "edit");
    const userId = await getOrCreateUserRecord(client, user);
    const entryResult = await client.query<{
      id: string;
      starts_at: string;
      ends_at: string;
      all_day: boolean;
      updated_at: string | Date;
    }>(
      `
        SELECT id, starts_at, ends_at, all_day, updated_at
        FROM calendar_entries
        WHERE id = $1
          AND board_id = $2
          AND deleted_at IS NULL
        FOR UPDATE
      `,
      [calendarEntryId, board.id],
    );
    const entry = entryResult.rows[0];

    if (!entry) {
      throw new BoardAccessError("board_not_found", "Calendar entry was not found.", 404);
    }

    if (entry.all_day) {
      throw new Error("All-day calendar items cannot be resized.");
    }

    if (
      !calendarScheduleValuesMatch(entry.starts_at, expected.startAt) ||
      !calendarScheduleValuesMatch(entry.ends_at, expected.endAt)
    ) {
      throw new BoardAccessError(
        "calendar_schedule_conflict",
        "This calendar event changed elsewhere. Refresh and try again.",
        409,
      );
    }

    const updateResult = await client.query<{ updated_at: string | Date }>(
      `
        UPDATE calendar_entries
        SET
          starts_at = $3,
          ends_at = $4,
          updated_by_user_id = $5,
          updated_at = NOW()
        WHERE id = $1 AND board_id = $2
        RETURNING updated_at
      `,
      [entry.id, board.id, proposed.startAt, proposed.endAt, userId],
    );
    await client.query("COMMIT");
    const updatedAt = updateResult.rows[0]?.updated_at;

    if (!updatedAt) {
      throw new Error("Calendar entry schedule update did not return a timestamp.");
    }

    return {
      calendarEntryId: entry.id,
      ...proposed,
      // The version this change replaced: a form that was based on it can
      // move on to updatedAt, since nothing else changed in between.
      previousUpdatedAt: new Date(entry.updated_at).toISOString(),
      updatedAt: new Date(updatedAt).toISOString(),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function convertPersonalBoardImportedCalendarEventToTask(
  user: TaskboardUserIdentity,
  importedEventId: string,
  args: {
    bucketId: string;
    scope: CalendarSourceConversionScope;
  },
): Promise<CalendarSourceConversionResult> {
  const normalizedEventId = importedEventId.trim();
  const normalizedBucketId = args.bucketId.trim();

  if (!isValidBoardId(normalizedEventId)) {
    throw new BoardAccessError(
      "invalid_board_id",
      "Calendar source event id must be a valid UUID.",
      400,
    );
  }

  if (!isValidBoardId(normalizedBucketId)) {
    throw new CalendarSourceConversionError(
      "bucket_not_found",
      "Choose a valid destination bucket.",
      400,
    );
  }

  if (args.scope !== "occurrence" && args.scope !== "series") {
    throw new CalendarSourceConversionError(
      "invalid_conversion_scope",
      "Conversion scope must be occurrence or series.",
      400,
    );
  }

  await ensureDatabaseReady();

  const pool = getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const userId = await getOrCreateUserRecord(client, user);
    const eventResult = await client.query<DbCalendarSourceConversionEventRow>(
      `
        SELECT
          imported_events.id,
          imported_events.board_id,
          imported_events.task_id,
          imported_events.provider,
          imported_events.external_event_id,
          imported_events.title,
          imported_events.starts_at,
          imported_events.ends_at,
          imported_events.location,
          imported_events.raw_payload,
          imported_events.sync_status,
          boards.board_type,
          boards.owner_user_id,
          owners.is_disabled AS owner_is_disabled
        FROM imported_events
        INNER JOIN boards ON boards.id = imported_events.board_id
        LEFT JOIN users owners ON owners.id = boards.owner_user_id
        WHERE imported_events.id = $1
        LIMIT 1
        FOR UPDATE OF imported_events
      `,
      [normalizedEventId],
    );
    const event = eventResult.rows[0] ?? null;

    if (
      !event ||
      event.board_type !== "personal" ||
      event.owner_user_id !== userId ||
      event.owner_is_disabled
    ) {
      throw new CalendarSourceConversionError(
        "source_event_not_found",
        "Calendar source event not found.",
        404,
      );
    }

    if (event.sync_status !== "active") {
      throw new CalendarSourceConversionError(
        "source_event_not_convertible",
        "Inactive calendar source events cannot be converted.",
        409,
      );
    }


    const bucketResult = await client.query<{ id: string }>(
      `
        SELECT id
        FROM buckets
        WHERE id = $1 AND board_id = $2
        LIMIT 1
        FOR UPDATE
      `,
      [normalizedBucketId, event.board_id],
    );

    if (!bucketResult.rows[0]) {
      throw new CalendarSourceConversionError(
        "bucket_not_found",
        "Destination bucket not found.",
        404,
      );
    }

    const provider = mapImportedCalendarSourceProvider(event.provider);
    const sourceRecordId = sourceRecordIdForImportedEvent(event);
    const sourceEventId = event.id;
    const isRecurring = getRawPayloadBoolean(event.raw_payload, "isRecurring");
    const conversionScope: CalendarSourceConversionScope = isRecurring ? args.scope : "occurrence";
    const linkedRawPayload = mergeRawPayload(event.raw_payload, {
      taskLinkScope: conversionScope,
    });

    if (event.task_id) {
      const linkedTaskResult = await client.query<{
        id: string;
        is_read_only_import: boolean;
        deleted_at: string | null;
        archived_at: string | null;
      }>(
        `
          SELECT id, is_read_only_import, deleted_at, archived_at
          FROM tasks
          WHERE id = $1 AND board_id = $2
          LIMIT 1
          FOR UPDATE
        `,
        [event.task_id, event.board_id],
      );
      const linkedTask = linkedTaskResult.rows[0] ?? null;

      if (!linkedTask || linkedTask.deleted_at || linkedTask.archived_at) {
        throw new CalendarSourceConversionError(
          "linked_task_not_convertible",
          "Linked imported task is not available for conversion.",
          409,
        );
      }

      if (!linkedTask.is_read_only_import) {
        await client.query(
          `
            UPDATE imported_events
            SET raw_payload = $3::jsonb, updated_at = NOW()
            WHERE id = $1 AND board_id = $2
          `,
          [event.id, event.board_id, JSON.stringify(linkedRawPayload)],
        );

        await client.query("COMMIT");
        return {
          taskId: linkedTask.id,
          alreadyConverted: true,
          sourceEventId,
        };
      }

      await client.query(
        `
          UPDATE tasks
          SET bucket_id = $3, is_read_only_import = FALSE, updated_at = NOW()
          WHERE id = $1 AND board_id = $2
        `,
        [linkedTask.id, event.board_id, normalizedBucketId],
      );
      await client.query(
        `
          UPDATE imported_events
          SET raw_payload = $3::jsonb, updated_at = NOW()
          WHERE id = $1 AND board_id = $2
        `,
        [event.id, event.board_id, JSON.stringify(linkedRawPayload)],
      );


      await client.query("COMMIT");
      return {
        taskId: linkedTask.id,
        alreadyConverted: false,
        sourceEventId,
      };
    }

    const existingTaskResult = await client.query<{
      id: string;
      is_read_only_import: boolean;
      deleted_at: string | null;
      archived_at: string | null;
    }>(
      `
        SELECT id, is_read_only_import, deleted_at, archived_at
        FROM tasks
        WHERE board_id = $1 AND source_type = $2 AND source_record_id = $3
        ORDER BY created_at ASC
        LIMIT 1
        FOR UPDATE
      `,
      [event.board_id, provider, sourceRecordId],
    );
    const existingTask = existingTaskResult.rows[0] ?? null;

    if (existingTask) {
      if (existingTask.deleted_at || existingTask.archived_at) {
        throw new CalendarSourceConversionError(
          "linked_task_not_convertible",
          "Matching imported task is not available for conversion.",
          409,
        );
      }

      if (existingTask.is_read_only_import) {
        await client.query(
          `
            UPDATE tasks
            SET is_read_only_import = FALSE, updated_at = NOW()
            WHERE id = $1 AND board_id = $2
          `,
          [existingTask.id, event.board_id],
        );
      }

      await client.query(
        `
          UPDATE imported_events
          SET task_id = $2, raw_payload = $4::jsonb, updated_at = NOW()
          WHERE id = $1 AND board_id = $3
        `,
        [event.id, existingTask.id, event.board_id, JSON.stringify(linkedRawPayload)],
      );

      if (existingTask.is_read_only_import) {
        await client.query(
          `UPDATE tasks SET bucket_id = $3 WHERE id = $1 AND board_id = $2`,
          [existingTask.id, event.board_id, normalizedBucketId],
        );
      }


      await client.query("COMMIT");
      return {
        taskId: existingTask.id,
        alreadyConverted: !existingTask.is_read_only_import,
        sourceEventId,
      };
    }

    const orderResult = await client.query<{ next_order: string }>(
      `
        SELECT COALESCE(MAX(sort_order), 0)::text AS next_order
        FROM tasks
        WHERE bucket_id = $1 AND board_id = $2 AND parent_task_id IS NULL
      `,
      [normalizedBucketId, event.board_id],
    );
    const taskId = randomUUID();
    const nextOrder = Number(orderResult.rows[0]?.next_order ?? "0") + 1000;
    const startsAt = event.starts_at instanceof Date ? event.starts_at.toISOString() : event.starts_at;
    const endsAt = event.ends_at instanceof Date ? event.ends_at.toISOString() : event.ends_at;
    const summary = buildConvertedImportedEventSummary(event);

    await client.query(
      `
        INSERT INTO tasks (
          id,
          board_id,
          bucket_id,
          parent_task_id,
          title,
          summary,
          next_action,
          notes,
          status,
          color,
          icon,
          start_at,
          end_at,
          due_at,
          sort_order,
          source_type,
          source_record_id,
          is_read_only_import
        )
        VALUES ($1, $2, $3, NULL, $4, $5, '', '', 'todo', $6, 'calendar', $7, $8, NULL, $9, $10, $11, FALSE)
      `,
      [
        taskId,
        event.board_id,
        normalizedBucketId,
        requireNonEmptyString(event.title, "title"),
        summary,
        colorForImportedCalendarProvider(provider),
        startsAt,
        endsAt,
        nextOrder,
        provider,
        sourceRecordId,
      ],
    );
    await mirrorTaskSummaryToPrimaryNote(
      client,
      event.board_id,
      taskId,
      summary,
      await getFirstBoardUserId(client, event.board_id),
    );
    await ensureTaskLabels(client, event.board_id, taskId, ["Imported"]);
    await client.query(
      `
        UPDATE imported_events
        SET task_id = $2, raw_payload = $4::jsonb, updated_at = NOW()
        WHERE id = $1 AND board_id = $3
      `,
      [event.id, taskId, event.board_id, JSON.stringify(linkedRawPayload)],
    );


    await client.query("COMMIT");
    return {
      taskId,
      alreadyConverted: false,
      sourceEventId,
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function queryAccessibleBoards(
  client: PoolClient,
  user: TaskboardUserIdentity,
  userId: string,
  currentBoardId: string | null,
): Promise<AccessibleBoardSummary[]> {
  const sameTeamPersonalBoardViewEnabled = isSameTeamPersonalBoardViewEnabled();
  const result = await client.query<DbAccessibleBoardRow>(
    `
      SELECT
        boards.id,
        boards.owner_user_id,
        owners.is_disabled AS owner_is_disabled,
        boards.board_type,
        boards.owner_team_id,
        boards.team_member_default_access,
        boards.personal_visibility,
        boards.personal_visibility_team_id,
        boards.title,
        boards.description,
        boards.created_at::text AS created_at,
        owners.display_name AS owner_display_name,
        owner_teams.name AS owner_team_name,
        visibility_teams.name AS personal_visibility_team_name
    FROM boards
    LEFT JOIN users owners ON owners.id = boards.owner_user_id
    LEFT JOIN teams owner_teams ON owner_teams.id = boards.owner_team_id
    LEFT JOIN teams visibility_teams ON visibility_teams.id = boards.personal_visibility_team_id
      WHERE
        (boards.board_type = 'personal' AND boards.owner_user_id = $1)
        OR EXISTS (
          SELECT 1
          FROM board_members
          WHERE board_members.board_id = boards.id
            AND board_members.user_id = $1
        )
        OR (
          $3::boolean
          AND boards.board_type = 'personal'
          AND boards.personal_visibility = 'team_visible'
          AND boards.personal_visibility_team_id IS NOT NULL
          AND boards.owner_user_id <> $1
          AND owners.is_disabled IS FALSE
          AND EXISTS (
            SELECT 1
            FROM app_permission_settings
            WHERE app_permission_settings.id = 1
              AND app_permission_settings.same_team_personal_board_visibility_allowed IS TRUE
          )
          AND EXISTS (
            SELECT 1
            FROM teams shared_teams
            INNER JOIN team_members viewer_members
              ON viewer_members.team_id = shared_teams.id
              AND viewer_members.user_id = $1
            INNER JOIN team_members owner_members
              ON owner_members.team_id = shared_teams.id
              AND owner_members.user_id = boards.owner_user_id
            WHERE shared_teams.id = boards.personal_visibility_team_id
              AND shared_teams.archived_at IS NULL
              AND shared_teams.personal_board_view_enabled IS TRUE
          )
        )
        OR (
          boards.board_type = 'team'
          AND owner_teams.archived_at IS NULL
          AND EXISTS (
            SELECT 1
            FROM team_members
            WHERE team_members.team_id = boards.owner_team_id
              AND team_members.user_id = $1
          )
        )
      ORDER BY
        CASE WHEN boards.id = $2 THEN 0 ELSE 1 END,
        LOWER(boards.title) ASC,
        boards.created_at ASC,
        boards.id ASC
    `,
    [userId, currentBoardId, sameTeamPersonalBoardViewEnabled],
  );

  const boards = await buildAccessibleBoardSummaries({
    client,
    user,
    userId,
    currentBoardId: currentBoardId ?? "",
    candidates: result.rows.map((row) => ({
      id: row.id,
      owner_user_id: row.owner_user_id,
      owner_is_disabled: row.owner_is_disabled,
      board_type: row.board_type,
      owner_team_id: row.owner_team_id,
      team_member_default_access: row.team_member_default_access,
      personal_visibility: row.personal_visibility,
      personal_visibility_team_id: row.personal_visibility_team_id,
      title: row.title,
      description: row.description,
      ownerDisplayName: row.owner_display_name,
      ownerTeamName: row.owner_team_name,
      personalVisibilityTeamName: row.personal_visibility_team_name,
    })),
  });
  return boards;
}

// The same listing without a page load's housekeeping writes, for callers that
// already know the person's id (Notes reads it on every list and refresh).
export async function listAccessibleBoardsReadOnly(
  user: TaskboardUserIdentity & { id: string },
): Promise<{ boards: AccessibleBoardSummary[]; currentBoardId: string }> {
  await ensureDatabaseReady();
  const pool = getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();

  try {
    return await listAccessibleBoardsWithClient(client, user);
  } finally {
    client.release();
  }
}

// Read-only core for stores that already hold a client. The caller owns its
// connection and any transaction; this helper performs no pool acquisition.
export async function listAccessibleBoardsWithClient(
  client: PoolClient,
  user: TaskboardUserIdentity & { id: string },
): Promise<{ boards: AccessibleBoardSummary[]; currentBoardId: string }> {
  const personalBoardId = (await getBoardRowForUserId(client, user.id))?.id ?? null;
  return {
    boards: await queryAccessibleBoards(client, user, user.id, personalBoardId),
    currentBoardId: personalBoardId ?? "",
  };
}

export async function listAccessibleBoards(
  user: TaskboardUserIdentity,
): Promise<{ boards: AccessibleBoardSummary[]; currentBoardId: string }> {
  await ensureDatabaseReady();

  const pool = getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();

  try {
    const userId = await getOrCreateUserRecord(client, user);
    const currentBoard = await ensureUserBoardRow(client, user);
    const boards = await queryAccessibleBoards(client, user, userId, currentBoard.id);

    return {
      boards,
      currentBoardId: currentBoard.id,
    };
  } finally {
    client.release();
  }
}

export async function saveSelectedBoardPreference(
  user: TaskboardUserIdentity,
  boardId: string | null,
): Promise<{ ok: true; selectedBoardId: string | null }> {
  await ensureDatabaseReady();

  const pool = getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();

  try {
    const userId = await getOrCreateUserRecord(client, user);
    const personalBoard = await ensureUserBoardRow(client, user);
    const normalizedBoardId = normalizeBoardId(boardId);

    if (!normalizedBoardId) {
      await clearSelectedBoardPreferenceByUserId(client, userId);
      return { ok: true, selectedBoardId: null };
    }

    const { board } = await resolveBoardContext(
      client,
      user,
      { boardId: normalizedBoardId },
      "read",
    );
    const selectedBoardId = board.id === personalBoard.id ? null : board.id;

    await client.query(
      `
        UPDATE users
        SET last_selected_board_id = $2,
            updated_at = NOW()
        WHERE id = $1
      `,
      [userId, selectedBoardId],
    );

    return { ok: true, selectedBoardId };
  } finally {
    client.release();
  }
}

export async function getRecycleBinItems(
  user: TaskboardUserIdentity,
  options: BoardContextOptions = {},
) {
  const pool = getPool();

  if (!pool) {
    return [] as RecycleBinItem[];
  }

  const client = await pool.connect();

  try {
    const { board } = await resolveBoardContext(client, user, options, "read");
    await purgeExpiredRecycleBinItems(client, board.id);

    return await fetchRecycleBinItems(client, board.id);
  } finally {
    client.release();
  }
}

// Uses the caller's client; housekeeping runs once at the entry point.
async function fetchRecycleBinItems(client: PoolClient, boardId: string) {
  const result = await client.query<DbRecycleBinRow>(
    `
      SELECT
        root_tasks.id,
        root_tasks.title,
        root_tasks.source_type,
        root_tasks.is_read_only_import,
        root_tasks.deleted_at,
        root_tasks.purge_after_at,
        root_tasks.recycle_original_bucket_title,
        parent_task.title AS parent_title,
        EXISTS(
          SELECT 1
          FROM buckets
          WHERE buckets.id = root_tasks.recycle_original_bucket_id
            AND buckets.board_id = root_tasks.board_id
        ) AS original_bucket_exists,
        (
          SELECT COUNT(*)::text
          FROM task_attachments
          WHERE task_attachments.task_id IN (
            SELECT grouped.id FROM tasks grouped
            WHERE grouped.board_id = root_tasks.board_id AND grouped.recycle_group_id = root_tasks.recycle_group_id
          )
        ) AS attachment_count,
        (
          SELECT COUNT(*)::text
          FROM tasks grouped
          WHERE grouped.board_id = root_tasks.board_id
            AND grouped.recycle_group_id = root_tasks.recycle_group_id
            AND grouped.id <> root_tasks.id
        ) AS subtask_count
      FROM tasks root_tasks
      LEFT JOIN tasks parent_task ON parent_task.id = root_tasks.parent_task_id
      WHERE
        root_tasks.board_id = $1
        AND root_tasks.deleted_at IS NOT NULL
        AND root_tasks.recycle_group_id IS NOT NULL
        AND (
          root_tasks.parent_task_id IS NULL
          OR parent_task.recycle_group_id IS DISTINCT FROM root_tasks.recycle_group_id
        )
      ORDER BY root_tasks.deleted_at DESC, root_tasks.updated_at DESC
    `,
    [boardId],
  );

  return result.rows.map(mapRecycleBinRow);
}

export async function getArchiveItems(
  user: TaskboardUserIdentity,
  options: BoardContextOptions = {},
) {
  const pool = getPool();

  if (!pool) {
    return [] as ArchiveItem[];
  }

  const client = await pool.connect();

  try {
    const { board } = await resolveBoardContext(client, user, options, "read");
    await purgeExpiredRecycleBinItems(client, board.id);

    const result = await client.query<DbArchiveRow>(
      `
        SELECT
          root_tasks.id,
          root_tasks.title,
          root_tasks.source_type,
          root_tasks.is_read_only_import,
          root_tasks.archived_at,
          root_tasks.completed_at,
          root_tasks.archive_original_bucket_title,
          EXISTS(
            SELECT 1
            FROM buckets
            WHERE buckets.id = root_tasks.archive_original_bucket_id
              AND buckets.board_id = root_tasks.board_id
          ) AS original_bucket_exists,
          (
            SELECT COUNT(*)::text
            FROM task_attachments
            WHERE task_attachments.task_id IN (
              WITH RECURSIVE task_tree AS (
                SELECT id
                FROM tasks tree_root
                WHERE tree_root.id = root_tasks.id
                UNION ALL
                SELECT child.id
                FROM tasks child
                INNER JOIN task_tree ON child.parent_task_id = task_tree.id
                WHERE child.deleted_at IS NULL
              )
              SELECT id FROM task_tree
            )
          ) AS attachment_count,
          (
            SELECT COUNT(*)::text
            FROM tasks descendants
            WHERE descendants.parent_task_id IS NOT NULL
              AND descendants.id IN (
                WITH RECURSIVE task_tree AS (
                  SELECT id
                  FROM tasks tree_root
                  WHERE tree_root.id = root_tasks.id
                  UNION ALL
                  SELECT child.id
                  FROM tasks child
                  INNER JOIN task_tree ON child.parent_task_id = task_tree.id
                  WHERE child.deleted_at IS NULL
                )
                SELECT id FROM task_tree
              )
          ) AS subtask_count
        FROM tasks root_tasks
        WHERE
          root_tasks.board_id = $1
          AND root_tasks.parent_task_id IS NULL
          AND root_tasks.deleted_at IS NULL
          AND root_tasks.archived_at IS NOT NULL
        ORDER BY root_tasks.archived_at DESC, root_tasks.updated_at DESC
      `,
      [board.id],
    );

    return result.rows.map(mapArchiveRow);
  } finally {
    client.release();
  }
}

export async function getTaskNotifications(user: TaskboardUserIdentity) {
  const pool = getPool();

  if (!pool) {
    return {
      unreadCount: 0,
      items: [] as TaskNotification[],
    };
  }

  const client = await pool.connect();

  try {
    const board = await ensureUserBoardRow(client, user);
    const userId = await getOrCreateUserRecord(client, user);
    await purgeExpiredRecycleBinItems(client, board.id);
    return fetchTaskNotifications(client, userId, board.id);
  } finally {
    client.release();
  }
}

export async function updateTaskNotification(
  user: TaskboardUserIdentity,
  notificationId: string,
  action: "read" | "dismiss",
) {
  const pool = getPool();

  if (!pool) {
    return;
  }

  const client = await pool.connect();

  try {
    const board = await ensureUserBoardRow(client, user);
    const userId = await getOrCreateUserRecord(client, user);
    await purgeExpiredRecycleBinItems(client, board.id);
    await materializeTaskNotifications(client, userId, board.id);

    const updates =
      action === "dismiss"
        ? `read_at = COALESCE(read_at, NOW()), dismissed_at = COALESCE(dismissed_at, NOW())`
        : `read_at = COALESCE(read_at, NOW())`;

    const result = await client.query(
      `
        UPDATE task_notifications
        SET ${updates}
        WHERE id = $1 AND user_id = $2 AND board_id = $3
      `,
      [notificationId, userId, board.id],
    );

    if (result.rowCount === 0) {
      throw new Error("Notification not found.");
    }
  } finally {
    client.release();
  }
}

export async function markAllTaskNotificationsRead(user: TaskboardUserIdentity) {
  const pool = getPool();

  if (!pool) {
    return;
  }

  const client = await pool.connect();

  try {
    const board = await ensureUserBoardRow(client, user);
    const userId = await getOrCreateUserRecord(client, user);
    await purgeExpiredRecycleBinItems(client, board.id);
    await materializeTaskNotifications(client, userId, board.id);

    await client.query(
      `
        UPDATE task_notifications
        SET read_at = COALESCE(read_at, NOW())
        WHERE user_id = $1
          AND board_id = $2
          AND dismissed_at IS NULL
          AND read_at IS NULL
      `,
      [userId, board.id],
    );
  } finally {
    client.release();
  }
}

export async function restoreRecycleBinItem(
  user: TaskboardUserIdentity,
  taskId: string,
  options: BoardContextOptions = {},
) {
  const pool = getPool();

  if (!pool) {
    return null;
  }

  const client = await pool.connect();

  try {
    const { board, boardAccess } = await resolveBoardContext(client, user, options, "edit");
    assertBoardLifecycleAccess(boardAccess, "restore deleted tasks");
    await purgeExpiredRecycleBinItems(client, board.id);
    await client.query("BEGIN");
    await restoreRecycleBinItemInTransaction(client, user, board, taskId);
    await client.query("COMMIT");
    return taskId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}


export async function restoreRecycleBinItemInTransaction(client: PoolClient, user: TaskboardUserIdentity, board: Pick<DbBoardRow, "id" | "owner_user_id" | "board_type">, taskId: string) {
    await getOrCreateUserRecord(client, user);
    await lockTaskTree(client, board.id, taskId);

    const task = await getRecycleBinItemRecord(client, board.id, taskId);

    if (!task) {
      throw new Error("Recycle-bin item not found.");
    }

    if (task.parent_task_id) {
      await restoreRecycledSubtask(client, user, board, task.id, task.parent_task_id, task.recycle_group_id);
      return taskId;
    }

    const destinationBucketId = await resolveRestoreBucketId(
      client,
      board.id,
      task.recycle_original_bucket_id,
    );
    const orderResult = await client.query<{ next_order: string }>(
      `
        SELECT COALESCE(MAX(sort_order), 0)::text AS next_order
        FROM tasks
        WHERE
          board_id = $1
          AND bucket_id = $2
          AND parent_task_id IS NULL
          AND deleted_at IS NULL
          AND archived_at IS NULL
      `,
      [board.id, destinationBucketId],
    );
    const nextOrder = Number(orderResult.rows[0]?.next_order ?? "0") + 1000;

    await restoreRecycleGroup(client, board.id, task.recycle_group_id, destinationBucketId, { taskId, sortOrder: nextOrder });


}

// Brings back exactly one delete: its imported events first, then its tasks.
async function restoreRecycleGroup(
  client: PoolClient,
  boardId: string,
  groupId: string,
  bucketId: string | null,
  placement: { taskId: string; sortOrder: number } | null,
) {
  await client.query(
    `
      UPDATE imported_events
      SET sync_status = 'active', updated_at = NOW()
      WHERE board_id = $2
        AND task_id IN (SELECT id FROM tasks WHERE board_id = $2 AND recycle_group_id = $1)
    `,
    [groupId, boardId],
  );
  await client.query(
    `
      UPDATE tasks
      SET
        deleted_at = NULL,
        purge_after_at = NULL,
        recycle_original_bucket_id = NULL,
        recycle_original_bucket_title = NULL,
        recycle_deleted_by_user_id = NULL,
        recycle_group_id = NULL,
        bucket_id = $3,
        sort_order = CASE WHEN tasks.id = $4 THEN $5::numeric ELSE tasks.sort_order END,
        updated_at = NOW()
      WHERE board_id = $2 AND recycle_group_id = $1
    `,
    [groupId, boardId, bucketId, placement?.taskId ?? null, placement?.sortOrder ?? null],
  );
}

// A subtask returns under its parent, in the bucket its top-level task is in
// now, at its old order value among its siblings. Its parent must be live.
async function restoreRecycledSubtask(
  client: PoolClient,
  user: TaskboardUserIdentity,
  board: Pick<DbBoardRow, "id" | "owner_user_id" | "board_type">,
  taskId: string,
  parentTaskId: string,
  groupId: string,
) {
  const parentResult = await client.query<{ title: string; deleted_at: string | null; archived_at: string | null; root_bucket_id: string | null }>(
    `
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_task_id, bucket_id FROM tasks WHERE id = $1 AND board_id = $2
        UNION ALL
        SELECT tasks.id, tasks.parent_task_id, tasks.bucket_id
        FROM tasks INNER JOIN ancestors ON tasks.id = ancestors.parent_task_id
        WHERE tasks.board_id = $2
      )
      SELECT parent.title, parent.deleted_at, parent.archived_at,
        (SELECT bucket_id FROM ancestors WHERE parent_task_id IS NULL LIMIT 1) AS root_bucket_id
      FROM tasks parent
      WHERE parent.id = $1 AND parent.board_id = $2
    `,
    [parentTaskId, board.id],
  );
  const parent = parentResult.rows[0];
  if (!parent || parent.deleted_at || parent.archived_at) {
    throw new Error(`Restore "${parent?.title ?? "its parent task"}" first.`);
  }
  await restoreRecycleGroup(client, board.id, groupId, parent.root_bucket_id, null);
  await reconcileParentCompletion(client, user, board, parentTaskId, true);
  return taskId;
}

export async function restoreArchiveItem(
  user: TaskboardUserIdentity,
  taskId: string,
  options: BoardContextOptions = {},
) {
  const pool = getPool();

  if (!pool) {
    return null;
  }

  const client = await pool.connect();

  try {
    const { board, boardAccess } = await resolveBoardContext(client, user, options, "edit");
    await purgeExpiredRecycleBinItems(client, board.id);
    await client.query("BEGIN");
    if (!boardAccess.canManageLifecycle) {
      await assertOwnRecurringCompletionUndo(client, user, board.id, taskId);
    }
    await restoreArchiveItemInTransaction(client, board, taskId);

    await client.query("COMMIT");
    return taskId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Undoing your own recurring completion is not a manual restore: completing
// the occurrence archived it, so the person who completed it may take that back
// for a short while even without lifecycle access. The window is measured
// after the row lock, so waiting for the lock cannot stretch it.
async function assertOwnRecurringCompletionUndo(
  client: PoolClient,
  user: TaskboardUserIdentity,
  boardId: string,
  taskId: string,
) {
  const userId = await getOrCreateUserRecord(client, user);
  const result = await client.query<{ own_completion: boolean | null; archived_at: Date | null }>(
    `SELECT archive_archived_by_user_id = $3 AND archive_reason = 'recurring_completion' AS own_completion,
       archived_at
     FROM tasks
     WHERE id = $1 AND board_id = $2 AND parent_task_id IS NULL AND deleted_at IS NULL
     FOR UPDATE`,
    [taskId, boardId, userId],
  );
  const row = result.rows[0];
  const withinWindow = (await client.query<{ within: boolean }>(
    `SELECT $1::timestamptz > clock_timestamp() - INTERVAL '15 minutes' AS within`,
    [row?.archived_at ?? null],
  )).rows[0]?.within === true;
  if (!row?.own_completion || !withinWindow) {
    throw new BoardAccessError(
      "board_lifecycle_denied",
      "Only a team manager can restore archived tasks on this board.",
      403,
    );
  }
}

// Caller owns the transaction and has already checked edit access.
export async function restoreArchiveItemInTransaction(
  client: PoolClient,
  board: Pick<DbBoardRow, "id">,
  taskId: string,
) {
  const taskResult = await client.query<{
    id: string;
    archive_original_bucket_id: string | null;
    archived_at: string | null;
    parent_task_id: string | null;
  }>(
    `SELECT id,archive_original_bucket_id,archived_at,parent_task_id FROM tasks
     WHERE id=$1 AND board_id=$2 AND deleted_at IS NULL LIMIT 1 FOR UPDATE`,
    [taskId, board.id],
  );
  const task = taskResult.rows[0];
  if (!task || !task.archived_at || task.parent_task_id !== null) throw new Error("Archive item not found.");
  const destinationBucketId = await resolveRestoreBucketId(client, board.id, task.archive_original_bucket_id);
  const orderResult = await client.query<{ next_order: string }>(
    `SELECT COALESCE(MAX(sort_order),0)::text AS next_order FROM tasks
     WHERE board_id=$1 AND bucket_id=$2 AND parent_task_id IS NULL AND deleted_at IS NULL AND archived_at IS NULL`,
    [board.id, destinationBucketId],
  );
  const nextOrder = Number(orderResult.rows[0]?.next_order ?? "0") + 1000;
  await client.query(
    `WITH RECURSIVE task_tree AS (
       SELECT id FROM tasks WHERE id=$1 AND board_id=$2
       UNION ALL SELECT tasks.id FROM tasks INNER JOIN task_tree ON tasks.parent_task_id=task_tree.id
       WHERE tasks.deleted_at IS NULL
     ) UPDATE tasks SET archived_at=NULL,archive_original_bucket_id=NULL,archive_original_bucket_title=NULL,
       archive_archived_by_user_id=NULL,archive_reason=NULL,status=CASE WHEN tasks.id=$1 AND status='done' THEN 'todo' ELSE status END,
       reopen_status=CASE WHEN tasks.id=$1 AND status='done' THEN NULL ELSE reopen_status END,
       completed_at=CASE WHEN tasks.id=$1 AND status='done' THEN NULL ELSE completed_at END,bucket_id=$3,
       sort_order=CASE WHEN tasks.id=$1 THEN $4 ELSE tasks.sort_order END,updated_at=NOW()
     WHERE id IN (SELECT id FROM task_tree)`,
    [taskId, board.id, destinationBucketId, nextOrder],
  );
  await client.query(
    `WITH RECURSIVE task_tree AS (
       SELECT id FROM tasks WHERE id=$1 AND board_id=$2
       UNION ALL SELECT tasks.id FROM tasks INNER JOIN task_tree ON tasks.parent_task_id=task_tree.id
       WHERE tasks.deleted_at IS NULL
     ) UPDATE imported_events SET sync_status='active',updated_at=NOW()
       WHERE board_id=$2 AND task_id IN (SELECT id FROM task_tree)`,
    [taskId, board.id],
  );
  return taskId;
}

export async function permanentlyDeleteRecycleBinItem(
  user: TaskboardUserIdentity,
  taskId: string,
  options: BoardContextOptions = {},
) {
  const pool = getPool();

  if (!pool) {
    return;
  }

  const client = await pool.connect();

  try {
    const { board, boardAccess } = await resolveBoardContext(client, user, options, "edit");
    assertBoardLifecycleAccess(boardAccess, "permanently delete tasks");
    await purgeExpiredRecycleBinItems(client, board.id);
    await client.query("BEGIN");
    if (!await getRecycleBinItemRecord(client, board.id, taskId)) {
      throw new Error("Recycle-bin item not found.");
    }
    const diskKeys = await permanentlyDeleteRecycledTree(client, board.id, taskId);
    await client.query("COMMIT");
    await removeTaskAttachmentFiles(diskKeys);
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function updateBoard(
  user: TaskboardUserIdentity,
  patch: { title?: string; description?: string },
  options: BoardContextOptions = {},
) {
  const pool = getPool();

  if (!pool) {
    return;
  }

  const updates: string[] = [];
  const values: string[] = [];

  if (typeof patch.title === "string") {
    values.push(requireNonEmptyString(patch.title, "title"));
    updates.push(`title = $${values.length}`);
  }

  if (typeof patch.description === "string") {
    values.push(patch.description.trim());
    updates.push(`description = $${values.length}`);
  }

  if (updates.length === 0) {
    return;
  }

  const primaryBoard = await getBoardRowFromPool(user, options, "manage");

  if (!primaryBoard) {
    throw new Error("Board not found.");
  }

  values.push(primaryBoard.id);
  await pool.query(
    `
      UPDATE boards
      SET ${updates.join(", ")}, updated_at = NOW()
      WHERE id = $${values.length}
    `,
    values,
  );
}

export async function setBucketCollapsed(
  user: TaskboardUserIdentity,
  bucketId: string,
  collapsed: boolean,
  options: BoardContextOptions = {},
) {
  await updateBucket(user, bucketId, { collapsed }, options);
}

export async function updateBucket(
  user: TaskboardUserIdentity,
  bucketId: string,
  patch: {
    title?: string;
    collapsed?: boolean;
    color?: string;
    icon?: BucketIcon;
  },
  options: BoardContextOptions = {},
) {const pool=getPool();if(!pool)return;const client=await pool.connect();try{await client.query('BEGIN');const {board}=await resolveBoardContext(client,user,options,'edit');await updateBucketInTransaction(client,board,bucketId,patch);await client.query('COMMIT');}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}

export async function updateBucketInTransaction(client:PoolClient,board:{id:string},bucketId: string,patch: {
    title?: string;
    collapsed?: boolean;
    color?: string;
    icon?: BucketIcon;
  }) {  const updates: string[] = [];
  const values: Array<string | boolean> = [];

  if (typeof patch.title === "string") {
    values.push(requireNonEmptyString(patch.title, "title"));
    updates.push(`title = $${values.length}`);
  }

  if (typeof patch.collapsed === "boolean") {
    values.push(patch.collapsed);
    updates.push(`is_collapsed = $${values.length}`);
  }

  if (typeof patch.color === "string") {
    values.push(requireColor(patch.color));
    updates.push(`color = $${values.length}`);
  }

  if (typeof patch.icon === "string") {
    values.push(requireBucketIcon(patch.icon));
    updates.push(`icon = $${values.length}`);
  }

  if (updates.length === 0) {
    return;
  }



  values.push(bucketId);
  values.push(board.id);

  const result = await client.query(
    `
      UPDATE buckets
      SET ${updates.join(", ")}, updated_at = NOW()
      WHERE id = $${values.length - 1} AND board_id = $${values.length}
    `,
    values,
  );

  if (result.rowCount === 0) {
    throw new Error("Bucket not found.");
  }

}

export async function createBucket(
  user: TaskboardUserIdentity,
  args: { title: string },
  options: BoardContextOptions = {},
) {
  const pool = getPool();

  if (!pool) {
    return null;
  }

  const client = await pool.connect();

  try {
    const { board } = await resolveBoardContext(client, user, options, "edit");
    await purgeExpiredRecycleBinItems(client, board.id);
    await client.query("BEGIN");

    const bucketId = await createBucketInTransaction(client, board, args);
    await client.query("COMMIT");
    return bucketId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}


export async function createBucketInTransaction(client: PoolClient, board: { id: string }, args: { title: string }) {
    if (!board) {
      throw new Error("Board not found.");
    }

    const orderResult = await client.query<{ next_order: string }>(
      `
        SELECT COALESCE(MAX(sort_order), 0)::text AS next_order
        FROM buckets
        WHERE board_id = $1
      `,
      [board.id],
    );

    const bucketId = mutationUUID();
    const nextOrder = Number(orderResult.rows[0]?.next_order ?? "0") + 1000;

    await client.query(
      `
        INSERT INTO buckets (id, board_id, title, color, icon, sort_order, is_collapsed)
        VALUES ($1, $2, $3, $4, $5, $6, FALSE)
      `,
      [bucketId, board.id, requireNonEmptyString(args.title, "title"), "#64748b", "inbox", nextOrder],
    );

    return bucketId;
}

export async function reorderBuckets(
  user: TaskboardUserIdentity,
  orderedBucketIds: string[],
  options: BoardContextOptions = {},
) {
  const pool = getPool();

  if (!pool) {
    return;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { board } = await resolveBoardContext(client, user, options, "edit");

    await reorderBucketsInTransaction(client,board,orderedBucketIds);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}


export async function reorderBucketsInTransaction(client: PoolClient, board: { id:string }, orderedBucketIds:string[]) {
    const bucketResult = await client.query<{ id: string }>(
      `
        SELECT id
        FROM buckets
        WHERE board_id = $1
        ORDER BY sort_order ASC
      `,
      [board.id],
    );
    const currentBucketIds = bucketResult.rows.map((bucket) => bucket.id);
    const currentBucketIdSet = new Set(currentBucketIds);
    const submittedBucketIds: string[] = [];
    const submittedBucketIdSet = new Set<string>();

    for (const bucketId of orderedBucketIds) {
      if (!currentBucketIdSet.has(bucketId) || submittedBucketIdSet.has(bucketId)) {
        continue;
      }

      submittedBucketIds.push(bucketId);
      submittedBucketIdSet.add(bucketId);
    }

    const normalizedBucketIds = [
      ...submittedBucketIds,
      ...currentBucketIds.filter((bucketId) => !submittedBucketIdSet.has(bucketId)),
    ];

    for (const [index, bucketId] of normalizedBucketIds.entries()) {
      await client.query(
        `
          UPDATE buckets
          SET sort_order = $3, updated_at = NOW()
          WHERE id = $1 AND board_id = $2
        `,
        [bucketId, board.id, (index + 1) * 1000],
      );
    }


}

export async function deleteBucket(
  user: TaskboardUserIdentity,
  bucketId: string,
  options: BoardContextOptions = {},
) {
  const pool = getPool();

  if (!pool) {
    return;
  }

  const client = await pool.connect();

  try {
    const { board, boardAccess } = await resolveBoardContext(client, user, options, "edit");
    await purgeExpiredRecycleBinItems(client, board.id);
    await client.query("BEGIN");
    await deleteBucketInTransaction(client, user, board, bucketId, boardAccess.canManageLifecycle);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}


// Deleting a bucket recycles its tasks, so without lifecycle access only an
// empty bucket can be deleted.
export async function deleteBucketInTransaction(client: PoolClient, user: TaskboardUserIdentity, board: { id: string }, bucketId: string, canRecycleTasks = true) {
    const userId = await getOrCreateUserRecord(client, user);
    const bucketResult = await client.query<{ id: string; title: string }>(
      `
        SELECT id, title
        FROM buckets
        WHERE id = $1 AND board_id = $2
        LIMIT 1
      `,
      [bucketId, board.id],
    );
    const bucket = bucketResult.rows[0];

    if (!bucket) {
      throw new Error("Bucket not found.");
    }

    const rootTaskResult = await client.query<{ id: string }>(
      `
        SELECT id
        FROM tasks
        WHERE
          board_id = $1
          AND bucket_id = $2
          AND parent_task_id IS NULL
          AND deleted_at IS NULL
          AND archived_at IS NULL
        ORDER BY sort_order ASC
      `,
      [board.id, bucketId],
    );

    await lockRootTasks(client, board.id, rootTaskResult.rows.map((row) => row.id));
    if (rootTaskResult.rows.length > 0 && !canRecycleTasks) {
      throw new BoardAccessError(
        "board_lifecycle_denied",
        "Only a team manager can delete a bucket that still has tasks on this board.",
        403,
      );
    }
    for (const row of rootTaskResult.rows) {
      await recycleRootTaskTree(client, {
        boardId: board.id,
        taskId: row.id,
        deletedByUserId: userId,
        originalBucketId: bucket.id,
        originalBucketTitle: bucket.title,
      });
    }

    await client.query(
      `
        DELETE FROM buckets
        WHERE id = $1 AND board_id = $2
      `,
      [bucketId, board.id],
    );


}

export async function moveRootTask(args: {
  user: TaskboardUserIdentity;
  taskId: string;
  targetBucketId: string;
  targetIndex: number;
  boardId?: string | null;
}) {
  const pool = getPool();

  if (!pool) {
    return;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { board } = await resolveBoardContext(client, args.user, { boardId: args.boardId }, "edit");

    await moveRootTaskInTransaction(client,board,args);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}


export async function moveRootTaskInTransaction(client: PoolClient, board: { id:string }, args: { taskId:string; targetBucketId:string; targetIndex:number }) {
    const taskResult = await client.query<{
      id: string;
      bucket_id: string | null;
    }>(
      `
        SELECT id, bucket_id
        FROM tasks
        WHERE id = $1 AND parent_task_id IS NULL AND board_id = $2 AND deleted_at IS NULL AND archived_at IS NULL
      `,
      [args.taskId, board.id],
    );

    const task = taskResult.rows[0];

    if (!task) {
      throw new Error("Task not found for reorder.");
    }

    const sourceBucketId = task.bucket_id;
    const targetBucketId = args.targetBucketId;

    if (!sourceBucketId) {
      throw new Error("Task is missing a bucket.");
    }

    // The target bucket must belong to the same board. Locking both buckets in a
    // fixed order also serializes concurrent reorders of the same buckets.
    const bucketIdsToLock = [...new Set([sourceBucketId, targetBucketId])].sort();
    const lockedBucketResult = await client.query<{ id: string }>(
      `
        SELECT id
        FROM buckets
        WHERE board_id = $1 AND id = ANY($2::uuid[])
        ORDER BY id
        FOR UPDATE
      `,
      [board.id, bucketIdsToLock],
    );

    if (!lockedBucketResult.rows.some((row) => row.id === targetBucketId)) {
      throw new Error("Target bucket not found on this board.");
    }

    const sourceTaskIds = await getRootTaskIdsForBucket(client, board.id, sourceBucketId);
    const targetTaskIds =
      sourceBucketId === targetBucketId
        ? sourceTaskIds
        : await getRootTaskIdsForBucket(client, board.id, targetBucketId);

    const nextSourceIds = sourceTaskIds.filter((taskId) => taskId !== args.taskId);

    if (sourceBucketId === targetBucketId) {
      const insertionIndex = clamp(args.targetIndex, 0, nextSourceIds.length);
      nextSourceIds.splice(insertionIndex, 0, args.taskId);
      await writeTaskOrder(client, board.id, sourceBucketId, nextSourceIds);
    } else {
      const nextTargetIds = targetTaskIds.filter((taskId) => taskId !== args.taskId);
      const insertionIndex = clamp(args.targetIndex, 0, nextTargetIds.length);
      nextTargetIds.splice(insertionIndex, 0, args.taskId);

      await client.query(
        `
          UPDATE tasks
          SET bucket_id = $2, updated_at = NOW()
          WHERE id = $1 AND board_id = $3 AND deleted_at IS NULL AND archived_at IS NULL
        `,
        [args.taskId, targetBucketId, board.id],
      );

      await writeTaskOrder(client, board.id, sourceBucketId, nextSourceIds);
      await writeTaskOrder(client, board.id, targetBucketId, nextTargetIds);
    }


}

type CreateRootTaskArgs = {
  bucketId: string;
  title: string;
  summary?: string;
  startAt?: string | null;
  endAt?: string | null;
  dueAt?: string | null;
  color?: string;
  icon?: TaskIcon;
  workItemType?: "task" | "maintenance_outage";
  timeZone?: string;
};

export async function createRootTask(
  user: TaskboardUserIdentity,
  args: CreateRootTaskArgs,
  options: BoardContextOptions = {},
) {
  const pool = getPool();

  if (!pool) {
    return null;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { board } = await resolveBoardContext(client, user, options, "edit");

    if (!board) {
      throw new Error("Board not found.");
    }

    const taskId = await createRootTaskOnBoard(client, user, board, args);
    await client.query("COMMIT");
    return taskId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Creates a root task inside the caller's open transaction on a board whose
// edit access the caller has already checked (createRootTask, and Notes
// "Convert to task", which links the new task in the same transaction).
export async function createRootTaskOnBoard(
  client: PoolClient,
  user: TaskboardUserIdentity,
  board: { id: string },
  args: CreateRootTaskArgs,
) {
  const actorUserId = await getOrCreateUserRecord(client, user);

  const bucketResult = await client.query<{ id: string }>(
    `
      SELECT id
      FROM buckets
      WHERE id = $1 AND board_id = $2
      LIMIT 1
    `,
    [args.bucketId, board.id],
  );

  if (!bucketResult.rows[0]) {
    throw new Error("Bucket not found.");
  }

  const orderResult = await client.query<{ next_order: string }>(
    `
      SELECT COALESCE(MAX(sort_order), 0)::text AS next_order
      FROM tasks
      WHERE bucket_id = $1 AND board_id = $2 AND parent_task_id IS NULL AND deleted_at IS NULL AND archived_at IS NULL
    `,
    [args.bucketId, board.id],
  );

  const taskId = mutationUUID();
  const nextOrder = Number(orderResult.rows[0]?.next_order ?? "0") + 1000;
  // An undated task starts today as an all-day task; outages stay undated.
  const usesDefaultStart = args.startAt == null && args.workItemType !== "maintenance_outage";

  await insertNativeRootTask(client, {
    taskId,
    boardId: board.id,
    bucketId: args.bucketId,
    sortOrder: nextOrder,
    actorUserId,
    task: {
      bucket: "",
      title: requireNonEmptyString(args.title, "title"),
      summary: args.summary?.trim() ?? "",
      nextAction: "",
      note: "",
      labels: [],
      status: "todo",
      startAt: usesDefaultStart
        ? getStartOfTodayInTimeZone(mutationDate(), args.timeZone)
        : (args.startAt ?? null),
      allDay: usesDefaultStart,
      endAt: args.endAt ?? null,
      dueAt: args.dueAt ?? null,
      color: args.color,
      icon: args.icon,
      workItemType: args.workItemType,
    },
  });

  if (args.workItemType === "maintenance_outage") {
    await client.query(
      `
        INSERT INTO maintenance_outages (task_id, board_id)
        VALUES ($1, $2)
        ON CONFLICT (task_id) DO NOTHING
      `,
      [taskId, board.id],
    );
  }

  return taskId;
}

export async function createMaintenanceLocation(
  user: TaskboardUserIdentity,
  name: string,
  options: BoardContextOptions = {},
) {
  const pool = getPool();
  if (!pool) {
    return null;
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { board } = await resolveBoardContext(client, user, options, "edit");
    const normalizedName = requireNonEmptyString(name, "name").slice(0, 120);
    const existing = await client.query<{ id: string }>(
      `
        SELECT id
        FROM maintenance_locations
        WHERE board_id = $1 AND LOWER(name) = LOWER($2)
        LIMIT 1
      `,
      [board.id, normalizedName],
    );

    if (existing.rows[0]) {
      await client.query(
        `UPDATE maintenance_locations SET is_active = TRUE, updated_at = NOW() WHERE id = $1`,
        [existing.rows[0].id],
      );
      await client.query("COMMIT");
      return existing.rows[0].id;
    }

    const orderResult = await client.query<{ next_order: string }>(
      `SELECT (COALESCE(MAX(sort_order), 0) + 1000)::text AS next_order FROM maintenance_locations WHERE board_id = $1`,
      [board.id],
    );
    const locationId = randomUUID();
    await client.query(
      `
        INSERT INTO maintenance_locations (id, board_id, name, sort_order)
        VALUES ($1, $2, $3, $4)
      `,
      [locationId, board.id, normalizedName, Number(orderResult.rows[0]?.next_order ?? "1000")],
    );
    await client.query("COMMIT");
    return locationId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function bulkImportNativeTasks(
  user: TaskboardUserIdentity,
  args: BulkTaskImportSubmission,
) {
  const pool = getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();

  try {
    const board = await ensureUserBoardRow(client, user);
    const actorUserId = await getOrCreateUserRecord(client, user);
    await purgeExpiredRecycleBinItems(client, board.id);
    await client.query("BEGIN");

    if (!board) {
      throw new Error("Board not found.");
    }

    const bucketResult = await client.query<{ id: string; title: string; sort_order: string }>(
      `
        SELECT id, title, sort_order::text
        FROM buckets
        WHERE board_id = $1
        ORDER BY sort_order ASC
      `,
      [board.id],
    );

    const bucketRows = bucketResult.rows;
    const bucketByNormalizedTitle = new Map<string, { id: string; title: string }>();
    for (const bucket of bucketRows) {
      const key = normalizeBucketImportKey(bucket.title);
      if (!bucketByNormalizedTitle.has(key)) {
        bucketByNormalizedTitle.set(key, { id: bucket.id, title: bucket.title });
      }
    }

    const mappingBySource = new Map<string, string>();
    for (const mapping of args.bucketMappings ?? []) {
      const sourceKey = normalizeBucketImportKey(mapping.sourceBucket);
      if (mappingBySource.has(sourceKey)) {
        throw new Error(`Bucket "${mapping.sourceBucket}" has more than one mapping.`);
      }

      const targetBucket = bucketRows.find((bucket) => bucket.id === mapping.targetBucketId);
      if (!targetBucket) {
        throw new Error(`Bucket mapping target for "${mapping.sourceBucket}" is invalid.`);
      }

      mappingBySource.set(sourceKey, targetBucket.id);
    }

    let nextBucketOrder =
      Math.max(0, ...bucketRows.map((bucket) => Number(bucket.sort_order || "0"))) + 1000;
    const createdBucketIdBySource = new Map<string, string>();
    let createdBucketCount = 0;

    for (const newBucket of args.newBuckets ?? []) {
      const sourceKey = normalizeBucketImportKey(newBucket.sourceBucket);
      if (mappingBySource.has(sourceKey) || createdBucketIdBySource.has(sourceKey)) {
        throw new Error(`Bucket "${newBucket.sourceBucket}" has conflicting bucket decisions.`);
      }

      const existingBucket = bucketByNormalizedTitle.get(normalizeBucketImportKey(newBucket.title));
      if (existingBucket) {
        createdBucketIdBySource.set(sourceKey, existingBucket.id);
        continue;
      }

      const bucketId = randomUUID();
      await client.query(
        `
          INSERT INTO buckets (id, board_id, title, color, icon, sort_order, is_collapsed)
          VALUES ($1, $2, $3, '#64748b', 'inbox', $4, FALSE)
        `,
        [bucketId, board.id, requireNonEmptyString(newBucket.title, "title"), nextBucketOrder],
      );
      nextBucketOrder += 1000;
      createdBucketCount += 1;
      createdBucketIdBySource.set(sourceKey, bucketId);
      bucketByNormalizedTitle.set(normalizeBucketImportKey(newBucket.title), {
        id: bucketId,
        title: newBucket.title,
      });
    }

    const nextTaskSortOrderByBucket = new Map<string, number>();
    let createdTaskCount = 0;
    const touchedTaskIds: string[] = [];

    for (const task of args.tasks) {
      const resolvedBucketId = await resolveBulkImportBucketId({
        boardId: board.id,
        task,
        bucketByNormalizedTitle,
        mappingBySource,
        createdBucketIdBySource,
      });

      let nextSortOrder = nextTaskSortOrderByBucket.get(resolvedBucketId);
      if (!nextSortOrder) {
        nextSortOrder = await getNextRootTaskSortOrder(client, board.id, resolvedBucketId);
      }

      const taskId = randomUUID();
      await insertNativeRootTask(client, {
        taskId,
        boardId: board.id,
        bucketId: resolvedBucketId,
        sortOrder: nextSortOrder,
        actorUserId,
        task,
      });
      nextTaskSortOrderByBucket.set(resolvedBucketId, nextSortOrder + 1000);
      createdTaskCount += 1;
      touchedTaskIds.push(taskId);
    }

    await client.query("COMMIT");
    return {
      createdTaskCount,
      createdBucketCount,
      touchedTaskIds,
      warnings: [] as string[],
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export type UpdateTaskPatch = {
    title?: string;
    summary?: string;
    nextAction?: string;
    note?: string;
    status?: TaskStatus;
    startAt?: string | null;
    endAt?: string | null;
    allDay?: boolean;
    dueAt?: string | null;
    recurrence?: TaskRecurrenceRule | null;
    reminderOffsetMinutes?: number | null;
    overdueReminderEnabled?: boolean;
    labels?: string[];
    convertToTask?: boolean;
    color?: string;
    icon?: TaskIcon;
    bucketId?: string;
    promoteToMaintenanceOutage?: boolean;
    maintenanceOutage?: {
      locationId?: string | null;
      owner?: string;
      attendees?: string[];
      attendeeChanges?: AttendeeChange[];
    };
  };

// suppliedKeys: the fields a request named, before any were filtered out, so
// a subtask save that names a detail field is refused rather than dropped.
export async function updateTask(user: TaskboardUserIdentity, taskId: string, patch: UpdateTaskPatch, options: BoardContextOptions = {}, suppliedKeys?: readonly string[]) {
  const pool = getPool();
  if (!pool) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { board } = await resolveBoardContext(client, user, options, "edit");
    if (suppliedKeys) {
      const row = (await client.query<{ parent_task_id: string | null }>(
        `SELECT parent_task_id FROM tasks WHERE id = $1 AND board_id = $2`, [taskId, board.id])).rows[0];
      if (row?.parent_task_id) assertSubtaskPatch(Object.fromEntries(suppliedKeys.map((key) => [key, key === "status" ? patch.status ?? "todo" : true])));
    }
    await updateTaskInTransaction(client, user, board, taskId, patch);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally { client.release(); }
}

// Caller owns the transaction and must have checked edit access to this board.
export async function updateTaskInTransaction(client: PoolClient, user: TaskboardUserIdentity, board: Pick<DbBoardRow, "id" | "owner_user_id" | "board_type">, taskId: string, patch: UpdateTaskPatch, completionSource: "direct" | "children" = "direct", rollUp: { holdRecurringRoot?: boolean } = {}) {
    const actorUserId = await getOrCreateUserRecord(client, user);
    if (typeof patch.bucketId === "string") {
      await lockBucketsForRootBucketChange(client, board.id, taskId, patch.bucketId.trim());
    }
    if (typeof patch.status === "string") {
      // Serialize completion changes within a tree so simultaneous sibling
      // clicks cannot both miss the final child's completion.
      await lockTaskTree(client, board.id, taskId);
    }
    const taskResult = await client.query<{
      board_id: string;
      bucket_id: string | null;
      parent_task_id: string | null;
      title: string;
      summary: string;
      next_action: string;
      notes: string;
      status: TaskStatus;
      color: string | null;
      icon: TaskIcon | null;
      start_at: string | null;
      end_at: string | null;
      all_day: boolean;
      due_at: string | null;
      completed_at: string | null;
      recurrence_rule: unknown;
      recurrence_series_id: string | null;
      reminder_offset_minutes: number | null;
      overdue_reminder_enabled: boolean;
      source_type: string | null;
      is_read_only_import: boolean;

      work_item_type: "task" | "maintenance_outage";
    }>(
      `
        SELECT
          board_id,
          bucket_id,
          parent_task_id,
          title,
          summary,
          next_action,
          notes,
          status,
          color,
          icon,
          start_at,
          end_at,
          all_day,
          due_at,
          completed_at,
          recurrence_rule,
          recurrence_series_id,
          reminder_offset_minutes,
          overdue_reminder_enabled,
          source_type,
          is_read_only_import,
          work_item_type
        FROM tasks
        WHERE id = $1 AND board_id = $2 AND deleted_at IS NULL AND archived_at IS NULL
      `,
      [taskId, board.id],
    );

    const task = taskResult.rows[0];

    if (!task) {
      throw new Error("Task not found.");
    }

    if (task.parent_task_id !== null) assertSubtaskPatch(patch);

    if (patch.convertToTask === true && task.is_read_only_import) {
      await assertPersonalBoardOwnerForImportedConversion(client, user, board);
    }

    const updates: string[] = [];
    const values: Array<string | string[] | number | boolean | null> = [];
    const existingRecurrence = parseTaskRecurrenceRule(task.recurrence_rule);
    const nextRecurrence =
      "recurrence" in patch ? requireTaskRecurrenceRuleOrNull(patch.recurrence) : existingRecurrence ?? null;
    const nextDueAt =
      "dueAt" in patch ? requireDateOrNull(patch.dueAt ?? null) : task.due_at;
    const nextStartAt =
      "startAt" in patch ? requireDateOrNull(patch.startAt ?? null) : task.start_at;
    const nextEndAt =
      "endAt" in patch ? requireDateOrNull(patch.endAt ?? null) : task.end_at;
    let recurrenceSeriesId = task.recurrence_series_id;
    const touchesReminderFields =
      "reminderOffsetMinutes" in patch || "overdueReminderEnabled" in patch;
    let nextSummaryForPrimaryNote: string | null = null;


    if (patch.promoteToMaintenanceOutage === true) {
      if (task.parent_task_id !== null) {
        throw new Error("Only root tasks can be maintenance outages.");
      }
      if (task.is_read_only_import) {
        throw new Error("Convert the imported item to an editable task before promoting it.");
      }
      updates.push(`work_item_type = 'maintenance_outage'`);
    }

    if (typeof patch.title === "string") {
      values.push(requireNonEmptyString(patch.title, "title"));
      updates.push(`title = $${values.length}`);
    }

    if (typeof patch.summary === "string") {
      nextSummaryForPrimaryNote = patch.summary.trim();
      values.push(nextSummaryForPrimaryNote);
      updates.push(`summary = $${values.length}`);
    }

    if (typeof patch.nextAction === "string") {
      values.push(patch.nextAction.trim());
      updates.push(`next_action = $${values.length}`);
    }

    if (typeof patch.note === "string") {
      values.push(patch.note);
      updates.push(`notes = $${values.length}`);
    }

    if (typeof patch.status === "string") {
      const nextStatus = requireTaskStatus(patch.status);
      values.push(nextStatus);
      updates.push(`status = $${values.length}`);
      if (nextStatus === "done" && task.status !== "done") {
        updates.push(`completed_at = NOW()`);
      } else if (nextStatus !== "done" && task.status === "done") {
        updates.push(`completed_at = NULL`);
      }
      // When its work finishes a parent, it keeps the status it had, so
      // reopening that work brings it back. Any other real status change
      // forgets it; a save that repeats the current status keeps it.
      if (nextStatus !== task.status) {
        if (completionSource === "children" && nextStatus === "done") {
          values.push(task.status);
          updates.push(`reopen_status = $${values.length}`);
        } else {
          updates.push(`reopen_status = NULL`);
        }
      }
    }

    if ("startAt" in patch) {
      values.push(nextStartAt);
      updates.push(`start_at = $${values.length}`);
    }

    if ("endAt" in patch) {
      values.push(nextEndAt);
      updates.push(`end_at = $${values.length}`);
    }

    if ("allDay" in patch) {
      values.push(Boolean(patch.allDay));
      updates.push(`all_day = $${values.length}`);
    }

    if ("dueAt" in patch) {
      values.push(nextDueAt);
      updates.push(`due_at = $${values.length}`);
    }

    // Subtasks never recur and never have reminders. The editors save the whole
    // task, so a subtask save always carries "no recurrence" and may carry
    // "no reminder"; that is a no-op. Only a value that would give a subtask a
    // recurrence or a reminder is refused.
    if (task.parent_task_id !== null) {
      if ("recurrence" in patch && nextRecurrence) {
        throw new Error("Recurring tasks are only supported on root tasks.");
      }
      if (
        (patch.reminderOffsetMinutes !== undefined && patch.reminderOffsetMinutes !== null) ||
        patch.overdueReminderEnabled === true
      ) {
        throw new Error("Reminders are only supported on root tasks.");
      }
    }

    if ("recurrence" in patch && task.parent_task_id === null) {
      if (nextRecurrence && !nextDueAt) {
        throw new Error("Recurring tasks require a due date.");
      }
      values.push(nextRecurrence ? JSON.stringify(nextRecurrence) : null);
      updates.push(`recurrence_rule = $${values.length}::jsonb`);
      if (nextRecurrence && !recurrenceSeriesId) {
        recurrenceSeriesId = mutationUUID();
        values.push(recurrenceSeriesId);
        updates.push(`recurrence_series_id = COALESCE(recurrence_series_id, $${values.length})`);
      } else if (!nextRecurrence) {
        updates.push(`recurrence_series_id = NULL`);
        recurrenceSeriesId = null;
      }
    }

    if (touchesReminderFields && task.is_read_only_import) {
      throw new Error("Read-only imported items cannot have reminders.");
    }

    if ("reminderOffsetMinutes" in patch) {
      const nextOffset = requireReminderOffsetOrNull(patch.reminderOffsetMinutes ?? null);
      values.push(nextOffset);
      updates.push(`reminder_offset_minutes = $${values.length}`);
    }

    if ("overdueReminderEnabled" in patch) {
      values.push(Boolean(patch.overdueReminderEnabled));
      updates.push(`overdue_reminder_enabled = $${values.length}`);
    }

    if (patch.convertToTask === true) {
      updates.push(`is_read_only_import = FALSE`);
    }

    if (typeof patch.color === "string") {
      values.push(requireColor(patch.color));
      updates.push(`color = $${values.length}`);
    }

    if (typeof patch.icon === "string") {
      values.push(requireTaskIcon(patch.icon));
      updates.push(`icon = $${values.length}`);
    }

    if (typeof patch.bucketId === "string" && task.parent_task_id === null) {
      const nextBucketId = requireNonEmptyString(patch.bucketId, "bucketId");
      const bucketResult = await client.query<{ id: string }>(
        `
          SELECT id
          FROM buckets
          WHERE id = $1 AND board_id = $2
          LIMIT 1
        `,
        [nextBucketId, board.id],
      );

      if (!bucketResult.rows[0]) {
        throw new Error("Bucket not found.");
      }

      values.push(nextBucketId);
      updates.push(`bucket_id = $${values.length}`);
    }

    if (updates.length > 0) {
      values.push(taskId);

      const updateResult = await client.query(
        `
          UPDATE tasks
          SET ${updates.join(", ")}, updated_at = NOW()
          WHERE id = $${values.length} AND board_id = $${values.length + 1}
        `,
        [...values, board.id],
      );

      if (updateResult.rowCount === 0) {
        throw new Error("Task not found.");
      }
    }

    if (patch.promoteToMaintenanceOutage === true || patch.maintenanceOutage) {
      if (task.parent_task_id !== null) {
        throw new Error("Only root tasks can be maintenance outages.");
      }
      if (task.is_read_only_import) {
        throw new Error("Read-only imported items cannot be edited as maintenance outages.");
      }
      if (task.work_item_type !== "maintenance_outage" && patch.promoteToMaintenanceOutage !== true) {
        throw new Error("Promote the task before editing maintenance outage details.");
      }

      const outagePatch = patch.maintenanceOutage ?? {};
      let nextLocationId: string | null | undefined;
      if ("locationId" in outagePatch) {
        nextLocationId = outagePatch.locationId?.trim() || null;
        if (nextLocationId) {
          const locationResult = await client.query<{ id: string }>(
            `SELECT id FROM maintenance_locations WHERE id = $1 AND board_id = $2 LIMIT 1`,
            [nextLocationId, board.id],
          );
          if (!locationResult.rows[0]) {
            throw new Error("Maintenance location not found.");
          }
        }
      }

      const normalizedOwner =
        typeof outagePatch.owner === "string"
          ? outagePatch.owner.trim().slice(0, 200)
          : undefined;
      let normalizedAttendees = Array.isArray(outagePatch.attendees)
        ? [...new Set(outagePatch.attendees.map((value) => String(value).trim()).filter(Boolean))]
            .slice(0, 50)
            .map((value) => value.slice(0, 200))
        : undefined;

      if (outagePatch.attendeeChanges !== undefined) {
        const current = (await client.query<{ attendees: string[] }>("SELECT attendees FROM maintenance_outages WHERE task_id=$1 FOR UPDATE", [taskId])).rows[0]?.attendees ?? [];
        normalizedAttendees = applyAttendeeChanges(current, outagePatch.attendeeChanges);
      }

      await client.query(
        `
          INSERT INTO maintenance_outages (
            task_id,
            board_id,
            location_id,
            owner_name,
            attendees
          )
          VALUES ($1, $2, $3, $4, $5::jsonb)
          ON CONFLICT (task_id) DO UPDATE
          SET location_id = CASE WHEN $6 THEN EXCLUDED.location_id ELSE maintenance_outages.location_id END,
              owner_name = CASE WHEN $7 THEN EXCLUDED.owner_name ELSE maintenance_outages.owner_name END,
              attendees = CASE WHEN $8 THEN EXCLUDED.attendees ELSE maintenance_outages.attendees END,
              updated_at = NOW()
        `,
        [
          taskId,
          board.id,
          nextLocationId ?? null,
          normalizedOwner ?? "",
          JSON.stringify(normalizedAttendees ?? []),
          nextLocationId !== undefined,
          normalizedOwner !== undefined,
          normalizedAttendees !== undefined,
        ],
      );
    }

    if ("labels" in patch && patch.labels) {
      await client.query(
        `
          DELETE FROM task_labels
          WHERE task_id = $1
        `,
        [taskId],
      );

      for (const labelName of normalizeLabels(patch.labels)) {
        const existingLabelResult = await client.query<{ id: string }>(
          `
            SELECT id
            FROM labels
            WHERE board_id = $1 AND LOWER(name) = LOWER($2)
            LIMIT 1
          `,
          [task.board_id, labelName],
        );

        let labelId = existingLabelResult.rows[0]?.id;

        if (!labelId) {
          labelId = mutationUUID();

          await client.query(
            `
              INSERT INTO labels (id, board_id, name)
              VALUES ($1, $2, $3)
            `,
            [labelId, task.board_id, labelName],
          );
        }

        await client.query(
          `
            INSERT INTO task_labels (task_id, label_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
          `,
          [taskId, labelId],
        );
      }
    }

    if (nextSummaryForPrimaryNote !== null) {
      await mirrorTaskSummaryToPrimaryNote(
        client,
        board.id,
        taskId,
        nextSummaryForPrimaryNote,
        actorUserId,
      );
    }

    if (typeof patch.status === "string" && completionSource === "direct" &&
        (patch.status === "done" || task.status === "done")) {
      await setDescendantsCompletion(client, board.id, taskId, patch.status === "done");
    }

    const transitionedToDone =
      task.parent_task_id === null &&
      task.status !== "done" &&
      patch.status === "done";

    if (transitionedToDone && nextRecurrence && nextDueAt) {
      if (!recurrenceSeriesId) {
        recurrenceSeriesId = mutationUUID();
        await client.query(
          `
            UPDATE tasks
            SET recurrence_series_id = $2, updated_at = NOW()
            WHERE id = $1 AND board_id = $3
          `,
          [taskId, recurrenceSeriesId, board.id],
        );
      }
      await ensureNextRecurringTaskInstance(client, board.id, taskId, {
        rootBucketId: patch.bucketId?.trim() || task.bucket_id,
        currentDueAt: nextDueAt,
        currentStartAt: nextStartAt,
        recurrence: nextRecurrence,
        recurrenceSeriesId,
        reminderOffsetMinutes:
          "reminderOffsetMinutes" in patch
            ? requireReminderOffsetOrNull(patch.reminderOffsetMinutes ?? null)
            : task.reminder_offset_minutes,
        overdueReminderEnabled:
          "overdueReminderEnabled" in patch
            ? Boolean(patch.overdueReminderEnabled)
            : task.overdue_reminder_enabled,
        actorUserId,
      });
    }

    // A task marked done stays where it is until someone archives it. A
    // recurring task is the exception: its next occurrence takes its place,
    // so the finished one goes to Archives.
    if (transitionedToDone && nextRecurrence && nextDueAt) {
      const originalBucketId = patch.bucketId?.trim() || task.bucket_id;
      const bucketResult = originalBucketId
        ? await client.query<{ title: string }>(
            `
              SELECT title
              FROM buckets
              WHERE id = $1 AND board_id = $2
              LIMIT 1
            `,
            [originalBucketId, board.id],
          )
        : null;

      await archiveRootTaskTree(client, {
        boardId: board.id,
        taskId,
        archivedByUserId: actorUserId,
        originalBucketId,
        originalBucketTitle: bucketResult?.rows[0]?.title ?? null,
        reason: "recurring_completion",
      });
    }

    if (typeof patch.status === "string" && task.parent_task_id) {
      await reconcileParentCompletion(client, user, board, task.parent_task_id, rollUp.holdRecurringRoot);
    }
}

// Locks the root of a task's tree. Every change that can alter completion in
// the tree takes this lock, so concurrent edits apply one at a time. Callers
// touch the actor's user row first, so the two locks
// are always taken in the same order.
// A board move locks its buckets and then the task row. Changing a root task's
// bucket needs a key-share lock on the new bucket for the foreign key; taken
// only after the task row, that lock waits on a concurrent move while the move
// waits on the task, and Postgres aborts one as a deadlock. Taking the old and
// new bucket locks first, in id order, keeps the move's order. Key-share still
// lets bulk edits that hold shared bucket locks run side by side.
async function lockBucketsForRootBucketChange(client: PoolClient, boardId: string, taskId: string, nextBucketId: string) {
  const taskResult = await client.query<{ bucket_id: string | null }>(
    `SELECT bucket_id FROM tasks
     WHERE id = $1 AND board_id = $2 AND parent_task_id IS NULL AND deleted_at IS NULL AND archived_at IS NULL`,
    [taskId, boardId],
  );
  const currentBucketId = taskResult.rows[0]?.bucket_id;
  if (!currentBucketId || !nextBucketId || currentBucketId === nextBucketId) {
    return;
  }
  await client.query(
    `SELECT id FROM buckets
     WHERE board_id = $1 AND id::text = ANY($2::text[])
     ORDER BY id
     FOR KEY SHARE`,
    [boardId, [currentBucketId, nextBucketId]],
  );
}

export async function lockTaskTree(client: PoolClient, boardId: string, taskId: string) {
  await client.query(
    `WITH RECURSIVE ancestors AS (
       SELECT id, parent_task_id FROM tasks WHERE id = $1 AND board_id = $2
       UNION ALL
       SELECT parent.id, parent.parent_task_id FROM tasks parent
       INNER JOIN ancestors child ON parent.id = child.parent_task_id
       WHERE parent.board_id = $2
     )
     SELECT tasks.id FROM tasks
     WHERE tasks.id IN (SELECT id FROM ancestors WHERE parent_task_id IS NULL)
     FOR UPDATE`,
    [taskId, boardId],
  );
}

type CompletionActor = {
  user: TaskboardUserIdentity;
  board: Pick<DbBoardRow, "id" | "owner_user_id" | "board_type">;
};

// A parent with work under it is done exactly when all of that work is done.
// Status edits, new subtasks, moves, deletes, and restores all keep that true
// through here; a parent left with no subtasks keeps its own status. A parent
// its work finished reopens with the status it had before, so Undo and
// unticking do not turn an Active or Waiting parent into To do. Deletes
// and restores hold a recurring top-level task open: removing work must not
// complete it, archive it, and start its next occurrence.
async function reconcileParentCompletion(
  client: PoolClient,
  user: TaskboardUserIdentity,
  board: Pick<DbBoardRow, "id" | "owner_user_id" | "board_type">,
  parentTaskId: string,
  holdRecurringRoot = false,
) {
  const parentResult = await client.query<{ id: string; status: TaskStatus; reopen_status: TaskStatus | null; recurring_root: boolean; has_children: boolean; all_done: boolean }>(
    `SELECT parent.id, parent.status, parent.reopen_status,
       (parent.parent_task_id IS NULL AND parent.recurrence_rule IS NOT NULL) AS recurring_root,
       EXISTS (SELECT 1 FROM tasks child WHERE child.parent_task_id = parent.id
         AND child.board_id = $2 AND child.deleted_at IS NULL AND child.archived_at IS NULL) AS has_children,
       NOT EXISTS (SELECT 1 FROM tasks child WHERE child.parent_task_id = parent.id
         AND child.board_id = $2 AND child.deleted_at IS NULL AND child.archived_at IS NULL
         AND child.status <> 'done') AS all_done
     FROM tasks parent WHERE parent.id = $1 AND parent.board_id = $2
       AND parent.deleted_at IS NULL AND parent.archived_at IS NULL`,
    [parentTaskId, board.id],
  );
  const parent = parentResult.rows[0];
  if (!parent?.has_children || parent.all_done === (parent.status === "done")) return;
  if (holdRecurringRoot && parent.all_done && parent.recurring_root) return;
  await updateTaskInTransaction(client, user, board, parent.id,
    { status: parent.all_done ? "done" : parent.reopen_status ?? "todo" }, "children", { holdRecurringRoot });
}

// A direct completion includes all descendants. Reopening a completed
// parent clears its descendants; child roll-up never changes siblings.
async function setDescendantsCompletion(client: PoolClient, boardId: string, taskId: string, done: boolean) {
  await client.query(
    `WITH RECURSIVE descendants AS (
       SELECT id FROM tasks WHERE parent_task_id = $1 AND board_id = $2
         AND deleted_at IS NULL AND archived_at IS NULL
       UNION ALL
       SELECT child.id FROM tasks child
       INNER JOIN descendants parent ON child.parent_task_id = parent.id
       WHERE child.board_id = $2 AND child.deleted_at IS NULL AND child.archived_at IS NULL
     )
     UPDATE tasks SET status = $3,
       completed_at = CASE WHEN $3 = 'done' THEN COALESCE(completed_at, NOW()) ELSE NULL END,
       reopen_status = CASE WHEN status = $3 THEN reopen_status ELSE NULL END,
       updated_at = NOW()
     WHERE id IN (SELECT id FROM descendants)`,
    [taskId, boardId, done ? "done" : "todo"],
  );
}

// Shared links change work under the shared task, never the task itself, so
// their completion stops below it. Each ancestor in between is a subtask,
// which is done exactly when all the work inside it is done. The caller holds
// the shared tree's lock.
export async function setSharedSubtaskCompletion(client: PoolClient, boardId: string, taskId: string, done: boolean, sharedTaskId: string) {
  const row = (await client.query<{ parent_task_id: string | null; was_done: boolean }>(
    `WITH old AS (SELECT status FROM tasks WHERE id = $1 AND board_id = $2)
     UPDATE tasks SET status = $3,
       completed_at = CASE WHEN $3 = 'done' THEN COALESCE(completed_at, NOW()) ELSE NULL END,
       reopen_status = NULL, updated_at = NOW()
     WHERE id = $1 AND board_id = $2 AND parent_task_id IS NOT NULL
     RETURNING parent_task_id, (SELECT status FROM old) = 'done' AS was_done`,
    [taskId, boardId, done ? "done" : "todo"],
  )).rows[0];
  if (!row) throw new Error("Subtask not found.");
  // As for signed-in edits: ticking includes everything inside, and only
  // unticking finished work reopens it; saving To do again changes nothing.
  if (done || row.was_done) await setDescendantsCompletion(client, boardId, taskId, done);
  await reconcileSharedAncestors(client, boardId, row.parent_task_id, sharedTaskId);
}

export async function reconcileSharedAncestors(client: PoolClient, boardId: string, parentTaskId: string | null, sharedTaskId: string) {
  let current = parentTaskId;
  while (current && current !== sharedTaskId) {
    const changed = (await client.query<{ parent_task_id: string | null }>(
      `WITH target AS (
         SELECT parent.id, parent.status,
           EXISTS (SELECT 1 FROM tasks child WHERE child.parent_task_id = parent.id
             AND child.board_id = $2 AND child.deleted_at IS NULL AND child.archived_at IS NULL) AS has_children,
           NOT EXISTS (SELECT 1 FROM tasks child WHERE child.parent_task_id = parent.id
             AND child.board_id = $2 AND child.deleted_at IS NULL AND child.archived_at IS NULL
             AND child.status <> 'done') AS all_done
         FROM tasks parent WHERE parent.id = $1 AND parent.board_id = $2 AND parent.parent_task_id IS NOT NULL
       )
       UPDATE tasks SET status = CASE WHEN target.all_done THEN 'done' ELSE 'todo' END,
         completed_at = CASE WHEN target.all_done THEN COALESCE(tasks.completed_at, NOW()) ELSE NULL END,
         reopen_status = NULL, updated_at = NOW()
       FROM target
       WHERE tasks.id = target.id AND target.has_children AND target.all_done <> (target.status = 'done')
       RETURNING tasks.parent_task_id`,
      [current, boardId],
    )).rows[0];
    // An unchanged parent leaves everything above it unchanged too.
    if (!changed) return;
    current = changed.parent_task_id;
  }
}

export async function deleteTask(
  user: TaskboardUserIdentity,
  taskId: string,
  options: BoardContextOptions = {},
) {
  const pool = getPool();

  if (!pool) {
    return;
  }

  const client = await pool.connect();

  try {
    const { board, boardAccess } = await resolveBoardContext(client, user, options, "edit");
    assertBoardLifecycleAccess(boardAccess, "delete tasks");
    await purgeExpiredRecycleBinItems(client, board.id);
    await client.query("BEGIN");
    await deleteTaskInTransaction(client, user, board, taskId);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}


export async function deleteTaskInTransaction(client: PoolClient, user: TaskboardUserIdentity, board: Pick<DbBoardRow, "id" | "owner_user_id" | "board_type">, taskId: string) {
    const userId = await getOrCreateUserRecord(client, user);
    await lockTaskTree(client, board.id, taskId);
    const task = await getTaskRecordForDelete(client, board.id, taskId);

    if (!task || task.deleted_at || task.archived_at) {
      throw new Error("Task not found.");
    }

    if (task.parent_task_id) {
      // A subtask goes to the Recycle Bin with the work under it, in its
      // place, so Undo and Restore bring it back where it was.
      await recycleTaskTree(client, { boardId: board.id, taskId, deletedByUserId: userId, keepPlacement: true });
      await reconcileParentCompletion(client, user, board, task.parent_task_id, true);
      return;
    }

    await recycleRootTaskTree(client, {
      boardId: board.id,
      taskId,
      deletedByUserId: userId,
      originalBucketId: task.bucket_id ?? task.recycle_original_bucket_id ?? null,
      originalBucketTitle:
        task.bucket_title ?? task.recycle_original_bucket_title ?? null,
    });


}

export async function archiveTask(
  user: TaskboardUserIdentity,
  taskId: string,
  options: BoardContextOptions = {},
) {
  const pool = getPool();

  if (!pool) {
    return;
  }

  const client = await pool.connect();

  try {
    const { board, boardAccess } = await resolveBoardContext(client, user, options, "edit");
    assertBoardLifecycleAccess(boardAccess, "archive tasks");
    await purgeExpiredRecycleBinItems(client, board.id);
    await client.query("BEGIN");
    await archiveTaskInTransaction(client, user, board, taskId);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Caller owns the transaction and has already checked edit access. Archiving
// remains recoverable and includes the root's complete task tree.
export async function archiveTaskInTransaction(
  client: PoolClient,
  user: TaskboardUserIdentity,
  board: Pick<DbBoardRow, "id">,
  taskId: string,
) {
  const userId = await getOrCreateUserRecord(client, user);
  await lockTaskTree(client, board.id, taskId);
  await lockLiveTask(client, board.id, taskId);
  const task = await getRootTaskRecordForArchive(client, board.id, taskId);
  if (!task || task.deleted_at || task.archived_at) throw new Error("Task not found.");
  await archiveRootTaskTree(client, {
    boardId: board.id,
    taskId: task.id,
    archivedByUserId: userId,
    originalBucketId: task.bucket_id ?? task.archive_original_bucket_id ?? null,
    originalBucketTitle: task.bucket_title ?? task.archive_original_bucket_title ?? null,
    reason: "manual",
  });
  return task.id;
}

async function ensureNextRecurringTaskInstance(
  client: PoolClient,
  boardId: string,
  rootTaskId: string,
  args: {
    rootBucketId: string | null;
    currentDueAt: string;
    currentStartAt: string | null;
    recurrence: TaskRecurrenceRule;
    recurrenceSeriesId: string;
    reminderOffsetMinutes: number | null;
    overdueReminderEnabled: boolean;
    actorUserId: string;
  },
) {
  const completedAtIso = mutationDate().toISOString();
  const nextDueAt = computeNextRecurringDueAt(args.currentDueAt, args.recurrence, completedAtIso);
  const existingTask = await client.query<{ id: string }>(
    `
      SELECT id
      FROM tasks
      WHERE board_id = $1
        AND recurrence_series_id = $2
        AND parent_task_id IS NULL
        AND deleted_at IS NULL
        AND archived_at IS NULL
        AND due_at = $3
      LIMIT 1
    `,
    [boardId, args.recurrenceSeriesId, nextDueAt],
  );

  if (existingTask.rows[0]) {
    return;
  }

  const taskRows = await client.query<DbTaskSeriesRow>(
    `
      WITH RECURSIVE task_tree AS (
        SELECT
          id,
          board_id,
          bucket_id,
          parent_task_id,
          title,
          summary,
          next_action,
          notes,
          status,
          color,
          icon,
          start_at,
          end_at,
          all_day,
          due_at,
          sort_order,
          source_type,
          is_read_only_import,
          recurrence_rule,
          recurrence_series_id,
          reminder_offset_minutes,
          overdue_reminder_enabled,
          0 AS depth
        FROM tasks
        WHERE id = $1 AND board_id = $2 AND deleted_at IS NULL AND archived_at IS NULL

        UNION ALL

        SELECT
          child.id,
          child.board_id,
          child.bucket_id,
          child.parent_task_id,
          child.title,
          child.summary,
          child.next_action,
          child.notes,
          child.status,
          child.color,
          child.icon,
          child.start_at,
          child.end_at,
          child.all_day,
          child.due_at,
          child.sort_order,
          child.source_type,
          child.is_read_only_import,
          child.recurrence_rule,
          child.recurrence_series_id,
          child.reminder_offset_minutes,
          child.overdue_reminder_enabled,
          task_tree.depth + 1
        FROM tasks child
        INNER JOIN task_tree ON child.parent_task_id = task_tree.id
        WHERE child.deleted_at IS NULL AND child.archived_at IS NULL
      )
      SELECT *
      FROM task_tree
      ORDER BY depth ASC, sort_order ASC, id ASC
    `,
    [rootTaskId, boardId],
  );

  if (taskRows.rows.length === 0) {
    return;
  }

  const taskIds = taskRows.rows.map((row) => row.id);
  const checklistRows = await client.query<DbChecklistRow>(
    `
      SELECT id, task_id, label, is_done, sort_order
      FROM checklist_items
      WHERE task_id = ANY($1::uuid[])
      ORDER BY sort_order ASC, id ASC
    `,
    [taskIds],
  );
  const labelRows = await client.query<DbTaskLabelRow>(
    `
      SELECT task_labels.task_id, labels.name AS label_name
      FROM task_labels
      INNER JOIN labels ON labels.id = task_labels.label_id
      WHERE task_labels.task_id = ANY($1::uuid[])
      ORDER BY labels.name ASC
    `,
    [taskIds],
  );
  const attachmentRows = await client.query<DbAttachmentRecordRow>(
    `
      SELECT
        id,
        task_id,
        board_id,
        uploaded_by_user_id,
        original_name,
        display_name,
        stored_name,
        mime_type,
        size_bytes,
        created_at
      FROM task_attachments
      WHERE board_id = $1 AND task_id = ANY($2::uuid[])
      ORDER BY created_at ASC, id ASC
    `,
    [boardId, taskIds],
  );

  const checklistByTaskId = new Map<string, DbChecklistRow[]>();
  for (const row of checklistRows.rows) {
    const group = checklistByTaskId.get(row.task_id);
    if (group) {
      group.push(row);
    } else {
      checklistByTaskId.set(row.task_id, [row]);
    }
  }

  const labelsByTaskId = new Map<string, string[]>();
  for (const row of labelRows.rows) {
    const group = labelsByTaskId.get(row.task_id);
    if (group) {
      group.push(row.label_name);
    } else {
      labelsByTaskId.set(row.task_id, [row.label_name]);
    }
  }

  const attachmentsByTaskId = new Map<string, DbAttachmentRecordRow[]>();
  for (const row of attachmentRows.rows) {
    const group = attachmentsByTaskId.get(row.task_id);
    if (group) {
      group.push(row);
    } else {
      attachmentsByTaskId.set(row.task_id, [row]);
    }
  }

  const rootBucketId = args.rootBucketId ?? taskRows.rows[0]?.bucket_id ?? null;
  if (!rootBucketId) {
    return;
  }

  const shiftMs = new Date(nextDueAt).getTime() - new Date(args.currentDueAt).getTime();
  const nextRootSortOrder = await getNextRootTaskSortOrder(client, boardId, rootBucketId);
  const clonedTaskIds = new Map<string, string>();
  const createdAttachmentDiskKeys: string[] = [];
  const fallbackUploadedByUserId =
    attachmentRows.rows.length > 0 ? args.actorUserId : null;

  try {
    for (const row of taskRows.rows) {
      const nextTaskId = mutationUUID();
      clonedTaskIds.set(row.id, nextTaskId);

      await client.query(
        `
          INSERT INTO tasks (
            id,
            board_id,
            bucket_id,
            parent_task_id,
            title,
            summary,
            next_action,
            notes,
            status,
            color,
            icon,
            start_at,
            end_at,
            all_day,
            due_at,
            sort_order,
            source_type,
            source_record_id,
            is_read_only_import,
            recurrence_rule,
            recurrence_series_id,
            reminder_offset_minutes,
            overdue_reminder_enabled
          )
          VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, 'todo', $9, $10, $11, $12, $13, $14, $15, 'native', NULL, FALSE, $16::jsonb, $17, $18, $19
          )
        `,
        [
          nextTaskId,
          boardId,
          rootBucketId,
          row.parent_task_id ? clonedTaskIds.get(row.parent_task_id) ?? null : null,
          row.title,
          row.summary,
          row.next_action,
          row.notes,
          row.color,
          row.icon,
          shiftRecurringTaskDate(row.start_at, shiftMs),
          shiftRecurringTaskDate(row.end_at, shiftMs),
          row.all_day,
          shiftRecurringTaskDate(row.due_at, shiftMs),
          row.parent_task_id ? Number(row.sort_order) : nextRootSortOrder,
          row.parent_task_id === null ? JSON.stringify(args.recurrence) : null,
          row.parent_task_id === null ? args.recurrenceSeriesId : null,
          row.parent_task_id === null
            ? args.reminderOffsetMinutes
            : row.reminder_offset_minutes,
          row.parent_task_id === null
            ? args.overdueReminderEnabled
            : row.overdue_reminder_enabled,
        ],
      );

      // Subtasks carry no detail (see subtask-rule.ts), so only the task gets
      // a description note; the detail maps below hold the task's rows alone.
      if (row.parent_task_id === null) {
        await mirrorTaskSummaryToPrimaryNote(client,boardId,nextTaskId,row.summary,args.actorUserId);
      }
      for (const item of checklistByTaskId.get(row.id) ?? []) {
        await client.query(
          `
            INSERT INTO checklist_items (id, task_id, label, is_done, sort_order)
            VALUES ($1, $2, $3, FALSE, $4)
          `,
          [mutationUUID(), nextTaskId, item.label, item.sort_order],
        );
      }

      for (const labelName of labelsByTaskId.get(row.id) ?? []) {
        const labelRow = await client.query<{ id: string }>(
          `
            SELECT id
            FROM labels
            WHERE board_id = $1 AND LOWER(name) = LOWER($2)
            LIMIT 1
          `,
          [boardId, labelName],
        );

        const labelId = labelRow.rows[0]?.id;
        if (labelId) {
          await client.query(
            `
              INSERT INTO task_labels (task_id, label_id)
              VALUES ($1, $2)
              ON CONFLICT DO NOTHING
            `,
            [nextTaskId, labelId],
          );
        }
      }

      for (const attachment of attachmentsByTaskId.get(row.id) ?? []) {
        const nextAttachmentId = mutationUUID();
        const nextStoredName = buildTaskAttachmentDiskKey(boardId, nextTaskId, nextAttachmentId);
        await copyRecurringAttachment(attachment.stored_name, nextStoredName, getTaskAttachmentDiskPath);
        createdAttachmentDiskKeys.push(nextStoredName);

        await client.query(
          `
            INSERT INTO task_attachments (
              id,
              task_id,
              board_id,
              uploaded_by_user_id,
              original_name,
              display_name,
              stored_name,
              mime_type,
              size_bytes
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
          `,
          [
            nextAttachmentId,
            nextTaskId,
            boardId,
            attachment.uploaded_by_user_id ?? fallbackUploadedByUserId,
            attachment.original_name,
            attachment.display_name,
            nextStoredName,
            attachment.mime_type,
            attachment.size_bytes,
          ],
        );
      }
    }
  } catch (error) {
    if (!inMutationBatch()) await removeTaskAttachmentFiles(createdAttachmentDiskKeys);
    throw error;
  }
}

async function materializeTaskNotifications(
  client: PoolClient,
  userId: string,
  boardId: string,
) {
  const eligibleTasksResult = await client.query<{
    id: string;
    title: string;
    reminder_base_at: string;
    reminder_offset_minutes: number | null;
    overdue_reminder_enabled: boolean;
  }>(
    `
      SELECT
        id,
        title,
        ${taskReminderBase} AS reminder_base_at,
        reminder_offset_minutes,
        overdue_reminder_enabled
      FROM tasks
      WHERE board_id = $1 AND ${taskReminderEligible}
    `,
    [boardId],
  );

  const now = Date.now();

  for (const task of eligibleTasksResult.rows) {
    const reminderBaseAtMs = new Date(task.reminder_base_at).getTime();
    if (Number.isNaN(reminderBaseAtMs)) {
      continue;
    }

    if (task.reminder_offset_minutes !== null) {
      const triggerAt = new Date(reminderBaseAtMs - task.reminder_offset_minutes * 60_000);
      if (now >= triggerAt.getTime()) {
        await client.query(
          `
            INSERT INTO task_notifications (
              id,
              user_id,
              board_id,
              task_id,
              kind,
              due_at_snapshot,
              trigger_at,
              title_snapshot
            )
            VALUES ($1, $2, $3, $4, 'scheduled', $5, $6, $7)
            ON CONFLICT (task_id, kind, due_at_snapshot) DO NOTHING
          `,
          [
            randomUUID(),
            userId,
            boardId,
            task.id,
            task.reminder_base_at,
            triggerAt.toISOString(),
            task.title,
          ],
        );
      }
    }

    if (task.overdue_reminder_enabled && now > reminderBaseAtMs) {
      await client.query(
        `
          INSERT INTO task_notifications (
            id,
            user_id,
            board_id,
            task_id,
            kind,
            due_at_snapshot,
            trigger_at,
            title_snapshot
          )
          VALUES ($1, $2, $3, $4, 'overdue', $5, $6, $7)
          ON CONFLICT (task_id, kind, due_at_snapshot) DO NOTHING
        `,
        [
          randomUUID(),
          userId,
          boardId,
          task.id,
          task.reminder_base_at,
          new Date(reminderBaseAtMs + 1).toISOString(),
          task.title,
        ],
      );
    }
  }

}

function mapTaskNotificationRow(row: DbTaskNotificationRow): TaskNotification {
  return {
    id: row.id,
    taskId: row.task_id,
    title: row.title_snapshot,
    kind: row.kind,
    dueAt: row.due_at_snapshot,
    triggerAt: row.trigger_at,
    ...(row.read_at ? { readAt: row.read_at } : {}),
    ...(row.bucket_title ? { bucketTitle: row.bucket_title } : {}),
    ...(row.provider_label ? { providerLabel: row.provider_label } : {}),
  };
}

async function fetchTaskNotifications(
  client: PoolClient,
  userId: string,
  boardId: string,
) {
  await materializeTaskNotifications(client, userId, boardId);

  const result = await client.query<DbTaskNotificationRow>(
    `
      SELECT
        notifications.id,
        notifications.task_id,
        notifications.kind,
        notifications.due_at_snapshot,
        notifications.trigger_at,
        COALESCE(tasks.title, notifications.title_snapshot) AS title_snapshot,
        notifications.read_at,
        buckets.title AS bucket_title,
        CASE
          WHEN tasks.source_type IS NULL OR tasks.source_type = 'native' THEN NULL
          ELSE tasks.source_type
        END AS provider_label
      FROM task_notifications AS notifications
      INNER JOIN tasks ON tasks.id = notifications.task_id AND tasks.board_id = notifications.board_id
      LEFT JOIN buckets ON buckets.id = tasks.bucket_id AND buckets.board_id = tasks.board_id
      WHERE notifications.user_id = $1
        AND notifications.board_id = $2
        AND notifications.dismissed_at IS NULL
        AND ${taskReminderEligible}
        AND ${taskReminderBase} = notifications.due_at_snapshot
        AND (
          (
            notifications.kind = 'scheduled'
            AND tasks.reminder_offset_minutes IS NOT NULL
            AND NOW() >= ${taskReminderTrigger}
          )
          OR (
            notifications.kind = 'overdue'
            AND tasks.overdue_reminder_enabled = TRUE
            AND NOW() > ${taskReminderBase}
          )
        )
      ORDER BY notifications.read_at NULLS FIRST, notifications.trigger_at DESC, notifications.created_at DESC
    `,
    [userId, boardId],
  );

  const items = result.rows.map((row) => ({
    ...mapTaskNotificationRow(row),
    ...(row.provider_label ? { providerLabel: formatProviderLabel(row.provider_label) } : {}),
  }));

  return {
    unreadCount: items.filter((item) => !item.readAt).length,
    items,
  };
}

function computeNextRecurringDueAt(
  currentDueAt: string,
  rule: TaskRecurrenceRule,
  completedAtIso: string,
) {
  if (rule.mode === "after_completion") {
    return advanceRecurringDate(completedAtIso, rule);
  }

  let nextDueAt = advanceRecurringDate(currentDueAt, rule);
  while (new Date(nextDueAt).getTime() <= new Date(completedAtIso).getTime()) {
    nextDueAt = advanceRecurringDate(nextDueAt, rule);
  }
  return nextDueAt;
}

function advanceRecurringDate(baseIso: string, rule: TaskRecurrenceRule) {
  const date = new Date(baseIso);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Recurring tasks require a valid due date.");
  }

  if (rule.frequency === "monthly") {
    date.setMonth(date.getMonth() + rule.interval);
    return date.toISOString();
  }

  const next = new Date(date.getTime());
  if (rule.frequency === "weekly") {
    next.setUTCDate(next.getUTCDate() + rule.interval * 7);
    return next.toISOString();
  }

  if (rule.frequency === "custom") {
    next.setUTCDate(next.getUTCDate() + rule.interval);
    return next.toISOString();
  }

  if (rule.frequency === "weekday") {
    let remaining = rule.interval;
    while (remaining > 0) {
      next.setUTCDate(next.getUTCDate() + 1);
      const day = next.getUTCDay();
      if (day !== 0 && day !== 6) {
        remaining -= 1;
      }
    }
    return next.toISOString();
  }

  next.setUTCDate(next.getUTCDate() + rule.interval);
  return next.toISOString();
}

function shiftRecurringTaskDate(value: string | null, shiftMs: number) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return new Date(date.getTime() + shiftMs).toISOString();
}

export async function uploadTaskAttachments(
  user: TaskboardUserIdentity,
  taskId: string,
  files: TaskAttachmentUploadInput[],
  options: BoardContextOptions = {},
) {
  await uploadTaskAttachmentsForNote(user, taskId, null, files, options);
}

export async function uploadTaskNoteAttachments(
  user: TaskboardUserIdentity,
  taskId: string,
  noteId: string,
  files: TaskAttachmentUploadInput[],
  options: BoardContextOptions = {},
) {
  await uploadTaskAttachmentsForNote(user, taskId, noteId, files, options);
}

async function uploadTaskAttachmentsForNote(
  user: TaskboardUserIdentity,
  taskId: string,
  noteId: string | null,
  files: TaskAttachmentUploadInput[],
  options: BoardContextOptions = {},
) {
  if (files.length === 0) {
    throw new Error("Select at least one file.");
  }

  const pool = getPool();

  if (!pool) {
    return;
  }

  const client = await pool.connect();
  const writtenDiskKeys: string[] = [];
  let commitAttempted=false;

  try {
 await client.query('BEGIN');const {board}=await resolveBoardContext(client,user,options,'edit');
    const result=await uploadTaskAttachmentsForNoteInTransaction(client,user,board,taskId,noteId,files,writtenDiskKeys);
    commitAttempted=true;await client.query('COMMIT');
    return result;
} catch (error) {
    await client.query("ROLLBACK");
    if(!commitAttempted)await removeTaskAttachmentFiles(writtenDiskKeys);
    throw error;
  } finally {
    client.release();
  }
}

export async function uploadTaskAttachmentsForNoteInTransaction(client:PoolClient,user:TaskboardUserIdentity,board:Pick<DbBoardRow,'id'|'owner_user_id'|'board_type'>,taskId:string,noteId:string|null,files:TaskAttachmentUploadInput[],writtenDiskKeys:string[]=[]) {

    const actorUserId = await getOrCreateUserRecord(client, user);
    await assertTaskCanHoldDetail(client, board.id, taskId);

    const taskResult = await client.query<{ id: string; board_id: string }>(
      `
        SELECT id, board_id
        FROM tasks
        WHERE id = $1 AND board_id = $2 AND deleted_at IS NULL AND archived_at IS NULL
        FOR KEY SHARE
      `,
      [taskId, board.id],
    );

    if (!taskResult.rows[0]) {
      throw new Error("Task not found.");
    }

    if (noteId) {
      const noteResult = await client.query<{ id: string }>(
        `
          SELECT id
          FROM task_notes
          WHERE id = $1 AND task_id = $2 AND board_id = $3 AND deleted_at IS NULL
          LIMIT 1 FOR UPDATE
        `,
        [noteId, taskId, board.id],
      );

      if (!noteResult.rows[0]) {
        throw new Error("Note not found.");
      }
    }



    for (const file of files) {
      const originalName = normalizeAttachmentFilename(file.originalName);

      if (!originalName) {
        throw new Error("Each attachment must have a filename.");
      }

      if (file.sizeBytes <= 0) {
        throw new Error(`"${originalName}" is empty.`);
      }

      if (file.sizeBytes > maxTaskAttachmentSizeBytes) {
        throw new Error(`"${originalName}" exceeds the 25 MB per-file limit.`);
      }

      const attachmentId = mutationUUID();
      const diskKey = buildTaskAttachmentDiskKey(board.id, taskId, attachmentId);
      if(file.buffer.byteLength!==file.sizeBytes)throw new Error("Attachment length mismatch.");
      await writeMutationAttachment(Buffer.from(file.buffer),diskKey,file.mutationSource ?? "native:"+attachmentId);
      writtenDiskKeys.push(diskKey);

      await client.query(
        `
          INSERT INTO task_attachments (
            id,
            task_id,
            board_id,
            note_id,
            uploaded_by_user_id,
            original_name,
            display_name,
            stored_name,
            mime_type,
            size_bytes
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `,
        [
          attachmentId,
          taskId,
          board.id,
          noteId,
          actorUserId,
          originalName,
          originalName,
          diskKey,
          file.mimeType || "application/octet-stream",
          file.sizeBytes,
        ],
      );
    }



}


export async function createTaskNote(
  user: TaskboardUserIdentity,
  taskId: string,
  body: string,
  options: BoardContextOptions = {},
) {
 const pool=getPool();if(!pool)throw new Error('Persistence unavailable.');const client=await pool.connect();
 try { await client.query('BEGIN'); const {board}=await resolveBoardContext(client,user,options,'edit');
 const result=await createTaskNoteInTransaction(client,user,board,taskId,body);await client.query('COMMIT');return result;
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

export async function createTaskNoteInTransaction(client:PoolClient,user:TaskboardUserIdentity,board:Pick<DbBoardRow,'id'|'owner_user_id'|'board_type'>,taskId: string,body: string) {const trimmedBody = body.trim();
if (!trimmedBody) {
    throw new Error("Note text is required.");
  }

    const noteId=mutationUUID();
 const userId = await getOrCreateUserRecord(client, user);
    await assertTaskBelongsToBoard(client, board.id, taskId);
    await assertTaskCanHoldDetail(client, board.id, taskId);

    await client.query(
      `
        INSERT INTO task_notes (id, board_id, task_id, body, note_type, created_by_user_id)
        VALUES ($1, $2, $3, $4, 'working', $5)
      `,
      [noteId, board.id, taskId, trimmedBody, userId],
    );



 return noteId;
}

export async function updateTaskNote(
  user: TaskboardUserIdentity,
  taskId: string,
  noteId: string,
  body: string,
  options: BoardContextOptions = {},
) {
 const pool=getPool();if(!pool)throw new Error('Persistence unavailable.');const client=await pool.connect();
 try { await client.query('BEGIN'); const {board}=await resolveBoardContext(client,user,options,'edit');
 const result=await updateTaskNoteInTransaction(client,user,board,taskId,noteId,body);await client.query('COMMIT');return result;
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

export async function updateTaskNoteInTransaction(client:PoolClient,user:TaskboardUserIdentity,board:Pick<DbBoardRow,'id'|'owner_user_id'|'board_type'>,taskId: string,noteId: string,body: string) {

    const userId = await getOrCreateUserRecord(client, user);
    // Editing the primary note also updates the task's summary.
    await lockLiveTask(client, board.id, taskId, "update");
    const noteResult = await client.query<{ note_type: "primary" | "working" }>(
      `
        SELECT note_type
        FROM task_notes
        WHERE id = $1 AND task_id = $2 AND board_id = $3 AND deleted_at IS NULL
        LIMIT 1
      `,
      [noteId, taskId, board.id],
    );
    const noteType = noteResult.rows[0]?.note_type;

    if (!noteType) {
      throw new Error("Note not found.");
    }

    const trimmedBody = body.trim();
    if (noteType === "working" && !trimmedBody) {
      throw new Error("Note text is required.");
    }

    const result = await client.query(
      `
        UPDATE task_notes
        SET body = $4, updated_by_user_id = $5, updated_via_share_id = NULL, updated_at = NOW()
        WHERE id = $1 AND task_id = $2 AND board_id = $3 AND deleted_at IS NULL
      `,
      [noteId, taskId, board.id, trimmedBody, userId],
    );

    if (result.rowCount === 0) {
      throw new Error("Note not found.");
    }

    if (noteType === "primary") {
      await client.query(
        `
          UPDATE tasks
          SET summary = $3, updated_at = NOW()
          WHERE id = $1 AND board_id = $2 AND deleted_at IS NULL AND archived_at IS NULL
        `,
        [taskId, board.id, trimmedBody],
      );
    }



}

export async function deleteTaskNote(
  user: TaskboardUserIdentity,
  taskId: string,
  noteId: string,
  options: BoardContextOptions = {},
) {
 const pool=getPool();if(!pool)throw new Error('Persistence unavailable.');const client=await pool.connect();
 try { await client.query('BEGIN'); const {board}=await resolveBoardContext(client,user,options,'edit');
 const result=await deleteTaskNoteInTransaction(client,user,board,taskId,noteId);await client.query('COMMIT');return result;
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}

export async function deleteTaskNoteInTransaction(client:PoolClient,user:TaskboardUserIdentity,board:Pick<DbBoardRow,'id'|'owner_user_id'|'board_type'>,taskId: string,noteId: string) {

    const userId = await getOrCreateUserRecord(client, user);
    await lockLiveTask(client, board.id, taskId);
    const noteResult = await client.query<{ note_type: "primary" | "working" }>(
      `
        SELECT note_type
        FROM task_notes
        WHERE id = $1 AND task_id = $2 AND board_id = $3 AND deleted_at IS NULL
        LIMIT 1
      `,
      [noteId, taskId, board.id],
    );
    const noteType = noteResult.rows[0]?.note_type;

    if (!noteType) {
      throw new Error("Note not found.");
    }

    if (noteType === "primary") {
      throw new Error("Primary note cannot be deleted.");
    }

    const result = await client.query(
      `
        UPDATE task_notes
        SET deleted_by_user_id = $4, deleted_via_share_id = NULL, deleted_at = NOW()
        WHERE id = $1 AND task_id = $2 AND board_id = $3 AND deleted_at IS NULL
      `,
      [noteId, taskId, board.id, userId],
    );

    if (result.rowCount === 0) {
      throw new Error("Note not found.");
    }


}

export async function deleteTaskAttachment(
  user: TaskboardUserIdentity,
  taskId: string,
  attachmentId: string,
  options: BoardContextOptions = {},
) {
  const pool = getPool();

  if (!pool) {
    return;
  }

  const client = await pool.connect();

  try {
 await client.query('BEGIN');const {board}=await resolveBoardContext(client,user,options,'edit');
    const result=await deleteTaskAttachmentInTransaction(client,user,board,taskId,attachmentId);
    await client.query('COMMIT');if(result && !inMutationBatch()) await removeTaskAttachmentFiles([result]);
    return result;
} catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteTaskAttachmentInTransaction(client:PoolClient,user:TaskboardUserIdentity,board:Pick<DbBoardRow,'id'|'owner_user_id'|'board_type'>,taskId:string,attachmentId:string) {

    await lockLiveTask(client, board.id, taskId);
    const attachment = await getTaskAttachmentRecordForTask(client, board.id, taskId, attachmentId);

    if (!attachment) {
      throw new Error("Attachment not found.");
    }
    await guardMutationAttachment(attachment.stored_name);
    await client.query(
      `
        DELETE FROM task_attachments
        WHERE id = $1 AND task_id = $2 AND board_id = $3
      `,
      [attachmentId, taskId, board.id],
    );


    return attachment.stored_name;

}


export async function updateTaskAttachmentDisplayName(
  user: TaskboardUserIdentity,
  taskId: string,
  attachmentId: string,
  displayName: string,
  options: BoardContextOptions = {},
) {
  const trimmedDisplayName = normalizeAttachmentDisplayName(displayName);

  if (!trimmedDisplayName) {
    throw new Error("Attachment name is required.");
  }

  const pool = getPool();

  if (!pool) {
    return;
  }

  const client = await pool.connect();

  try {
 await client.query('BEGIN');const {board}=await resolveBoardContext(client,user,options,'edit');
    const result=await updateTaskAttachmentDisplayNameInTransaction(client,user,board,taskId,attachmentId,displayName);
    await client.query('COMMIT');
    return result;
} catch(error) { await client.query("ROLLBACK");throw error; } finally {
    client.release();
  }
}

export async function updateTaskAttachmentDisplayNameInTransaction(client:PoolClient,user:TaskboardUserIdentity,board:Pick<DbBoardRow,'id'|'owner_user_id'|'board_type'>,taskId:string,attachmentId:string,displayName:string) {const trimmedDisplayName=normalizeAttachmentDisplayName(displayName);if(!trimmedDisplayName)throw new Error("Attachment name is required.");

    const attachment = await getTaskAttachmentRecordForTask(client, board.id, taskId, attachmentId);

    if (!attachment) {
      throw new Error("Attachment not found.");
    }

    await client.query(
      `
        UPDATE task_attachments
        SET display_name = $4
        WHERE id = $1 AND task_id = $2 AND board_id = $3
          AND EXISTS (SELECT 1 FROM tasks WHERE tasks.id = task_attachments.task_id AND tasks.deleted_at IS NULL)
      `,
      [attachmentId, taskId, board.id, trimmedDisplayName],
    );

}


export async function getTaskAttachmentDownload(
  user: TaskboardUserIdentity,
  taskId: string,
  attachmentId: string,
  options: BoardContextOptions = {},
): Promise<TaskAttachmentDownloadRecord> {
  const pool = getPool();

  if (!pool) {
    throw new Error("Persistence is unavailable.");
  }

  const client = await pool.connect();

  try {
    const { board } = await resolveBoardContext(client, user, options, "read");
    const attachment = await getTaskAttachmentRecordForTask(client, board.id, taskId, attachmentId);

    if (!attachment) {
      throw new Error("Attachment not found.");
    }

    const content = await readFile(getTaskAttachmentDiskPath(attachment.stored_name));

    return {
      displayName: attachment.display_name || attachment.original_name,
      mimeType: attachment.mime_type || "application/octet-stream",
      sizeBytes: attachment.size_bytes,
      content,
    };
  } finally {
    client.release();
  }
}

export async function addChecklistItem(
  user: TaskboardUserIdentity,
  args: { taskId: string; label: string },
  options: BoardContextOptions = {},
) {const pool=getPool();if(!pool)return;const client=await pool.connect();try{await client.query('BEGIN');const {board}=await resolveBoardContext(client,user,options,'edit');const result=await mutateChecklistInTransaction(client,board.id,{op:'create',taskId:args.taskId,label:args.label});await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}

export async function updateChecklistItem(
  user: TaskboardUserIdentity,
  itemId: string,
  patch: {
    label?: string;
    done?: boolean;
  },
  options: BoardContextOptions = {},
) {const pool=getPool();if(!pool)return;const client=await pool.connect();try{await client.query('BEGIN');const {board}=await resolveBoardContext(client,user,options,'edit');const result=await mutateChecklistInTransaction(client,board.id,{op:'update',itemId,...patch});await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}

export async function deleteChecklistItem(
  user: TaskboardUserIdentity,
  itemId: string,
  options: BoardContextOptions = {},
) {const pool=getPool();if(!pool)return;const client=await pool.connect();try{await client.query('BEGIN');const {board}=await resolveBoardContext(client,user,options,'edit');const result=await mutateChecklistInTransaction(client,board.id,{op:'delete',itemId});await client.query('COMMIT');return result;}catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}}

export async function createSubtask(
  user: TaskboardUserIdentity,
  args: { parentTaskId: string; title: string },
  options: BoardContextOptions = {},
) {
  const pool = getPool();

  if (!pool) {
    return null;
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { board } = await resolveBoardContext(client, user, options, "edit");

    const taskId = await createSubtaskOnBoard(client, board, args, { user, board });

    await client.query("COMMIT");
    return taskId;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Creates a subtask inside the caller's open transaction.
export async function createSubtaskOnBoard(
  client: PoolClient,
  board: { id: string },
  args: { parentTaskId: string; title: string; requireTopLevel?: boolean },
  actor?: CompletionActor,
) {
  if (actor) {
    await getOrCreateUserRecord(client, actor.user);
    await lockTaskTree(client, board.id, args.parentTaskId);
  }
  const parentResult = await client.query<{ board_id: string; bucket_id: string | null; parent_task_id: string | null }>(
    `SELECT board_id,bucket_id,parent_task_id FROM tasks
     WHERE id=$1 AND board_id=$2 AND deleted_at IS NULL AND archived_at IS NULL
       ${args.requireTopLevel ? "AND parent_task_id IS NULL AND is_read_only_import=FALSE" : ""}
     FOR UPDATE`,
    [args.parentTaskId, board.id],
  );
  const parent = parentResult.rows[0];
  if (!parent) throw new Error("Parent task is unavailable or cannot contain this subtask.");
  const orderResult = await client.query<{ next_order: string }>(
    `SELECT COALESCE(MAX(sort_order),0)::text AS next_order FROM tasks WHERE parent_task_id=$1`,
    [args.parentTaskId],
  );
  const taskId = mutationUUID();
  await client.query(
    `INSERT INTO tasks (id,board_id,bucket_id,parent_task_id,title,summary,next_action,notes,status,color,icon,sort_order,source_type,is_read_only_import)
     VALUES ($1,$2,$3,$4,$5,'','','','todo',$6,$7,$8,'native',FALSE)`,
    [taskId, parent.board_id, parent.bucket_id, args.parentTaskId, requireNonEmptyString(args.title, "title"), SUBTASK_COLOR, SUBTASK_ICON, Number(orderResult.rows[0]?.next_order ?? "0") + 1000],
  );
  // A subtask has no description, so unlike a task it gets no primary note.
  // New work under a finished parent reopens it.
  if (actor) await reconcileParentCompletion(client, actor.user, actor.board, args.parentTaskId);
  return taskId;
}

// Moves a subtask to a new parent and position inside the same top-level
// task: nesting, un-nesting, and dragging work between windows. The root task
// never moves here, and a subtask cannot go inside its own children.
export async function moveSubtask(
  user: TaskboardUserIdentity,
  args: { taskId: string; parentTaskId: string; targetIndex: number },
  options: BoardContextOptions = {},
) {
  const pool = getPool();

  if (!pool) {
    return;
  }

  if (!Number.isInteger(args.targetIndex) || args.targetIndex < 0) {
    throw new Error("targetIndex must be a whole number of zero or more.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");
    const { board } = await resolveBoardContext(client, user, options, "edit");
    await getOrCreateUserRecord(client, user);
    await lockTaskTree(client, board.id, args.taskId);

    await moveSubtaskInTransaction(client, board, args, { user, board });

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// Caller owns authorization and the transaction. Shared callers additionally
// prove that both ends belong to the currently published subtree.
// A signed-in actor also keeps parent completion in step; shared-link edits
// keep their own rules.
export async function moveSubtaskInTransaction(client: PoolClient, board: { id: string }, args: { taskId: string; parentTaskId: string; targetIndex: number }, actor?: CompletionActor) {
    if (!Number.isInteger(args.targetIndex) || args.targetIndex < 0) throw new Error("Invalid task position.");
    // Each task with the root of its tree; both ends of the move must be live
    // tasks on this board in the same tree.
    const rootOf = async (taskId: string) => {
      const result = await client.query<{
        id: string;
        root_id: string;
        parent_task_id: string | null;
        bucket_id: string | null;
        is_read_only_import: boolean;
      }>(
        `
          WITH RECURSIVE ancestors AS (
            SELECT id, parent_task_id, 0 AS depth
            FROM tasks
            WHERE id = $1 AND board_id = $2 AND deleted_at IS NULL AND archived_at IS NULL
            UNION ALL
            SELECT tasks.id, tasks.parent_task_id, ancestors.depth + 1
            FROM tasks
            INNER JOIN ancestors ON tasks.id = ancestors.parent_task_id
          )
          SELECT
            task.id,
            (SELECT id FROM ancestors WHERE parent_task_id IS NULL LIMIT 1) AS root_id,
            task.parent_task_id,
            task.bucket_id,
            task.is_read_only_import
          FROM tasks AS task
          WHERE task.id = $1 AND task.board_id = $2 AND task.deleted_at IS NULL AND task.archived_at IS NULL
        `,
        [taskId, board.id],
      );
      return result.rows[0] ?? null;
    };

    const task = await rootOf(args.taskId);
    if (!task || !task.parent_task_id) {
      throw new Error("Only a subtask can be moved this way.");
    }
    if (task.is_read_only_import) {
      throw new Error("Imported read-only items cannot be moved.");
    }

    const parent = await rootOf(args.parentTaskId);
    if (!parent || parent.root_id !== task.root_id) {
      throw new Error("A subtask can only move within its own task.");
    }

    const loop = await client.query<{ id: string }>(
      `
        WITH RECURSIVE descendants AS (
          SELECT id FROM tasks WHERE id = $1
          UNION ALL
          SELECT tasks.id FROM tasks INNER JOIN descendants ON tasks.parent_task_id = descendants.id
        )
        SELECT id FROM descendants WHERE id = $2 LIMIT 1
      `,
      [args.taskId, args.parentTaskId],
    );
    if (loop.rows[0]) {
      throw new Error("A subtask cannot be moved inside itself.");
    }

    const siblings = await client.query<{ id: string }>(
      `
        SELECT id
        FROM tasks
        WHERE parent_task_id = $1 AND board_id = $2 AND id <> $3 AND deleted_at IS NULL
        ORDER BY sort_order ASC, created_at ASC, id ASC
      `,
      [args.parentTaskId, board.id, args.taskId],
    );
    const ordered = siblings.rows.map((row) => row.id);
    ordered.splice(Math.min(args.targetIndex, ordered.length), 0, args.taskId);

    await client.query(
      `
        UPDATE tasks
        SET parent_task_id = $2, bucket_id = $3, updated_at = NOW()
        WHERE id = $1 AND board_id = $4
      `,
      [args.taskId, args.parentTaskId, parent.bucket_id, board.id],
    );
    for (let index = 0; index < ordered.length; index += 1) {
      await client.query(
        `UPDATE tasks SET sort_order = $2 WHERE id = $1 AND board_id = $3`,
        [ordered[index], (index + 1) * 1000, board.id],
      );
    }

    // The new parent first: open work arriving there reopens it and its
    // ancestors before the old parent is checked.
    if (actor && task.parent_task_id !== args.parentTaskId) {
      await reconcileParentCompletion(client, actor.user, actor.board, args.parentTaskId);
      await reconcileParentCompletion(client, actor.user, actor.board, task.parent_task_id);
    }
}

export async function importIcsEvents(
  user: TaskboardUserIdentity,
  args: {
  fileName: string;
  events: ParsedIcsEvent[];
}): Promise<IcsImportResult> {
  await ensureDatabaseReady();

  const pool = getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const board = await ensureUserBoardRow(client, user);

    if (!board) {
      throw new Error("Board not found.");
    }

    const bucketId = await ensureCalendarImportsBucket(client, board.id);
    let created = 0;
    let updated = 0;
    const touchedTaskIds = new Set<string>();

    for (const event of args.events) {
      const existingEventResult = await client.query<ImportedEventRow>(
        `
          SELECT
            imported_events.id,
            imported_events.task_id,
            imported_events.external_event_id,
            imported_events.raw_payload,
            tasks.is_read_only_import AS task_is_read_only_import,
            imported_events.sync_status,
            tasks.deleted_at AS task_deleted_at,
            tasks.purge_after_at AS task_purge_after_at,
            tasks.archived_at AS task_archived_at
          FROM imported_events
          LEFT JOIN tasks ON tasks.id = imported_events.task_id
          WHERE imported_events.board_id = $1 AND imported_events.provider = 'ics' AND imported_events.external_event_id = $2
          LIMIT 1
        `,
        [board.id, event.uid],
      );
      const existingEvent = existingEventResult.rows[0] ?? null;

      if (isImportedEventSuppressedByRecycleBin(existingEvent)) {
        continue;
      }

      const taskImport = await upsertImportedIcsTask(client, {
        boardId: board.id,
        bucketId,
        existingTaskId: existingEvent?.task_id ?? null,
        fileName: args.fileName,
        event,
      });

      if (existingEvent) {
        await client.query(
          `
            UPDATE imported_events
            SET
              task_id = $3,
              title = $4,
              starts_at = $5,
              ends_at = $6,
              location = $7,
              raw_payload = $8::jsonb,
              sync_status = 'active',
              updated_at = NOW()
            WHERE id = $1 AND board_id = $2
          `,
          [
            existingEvent.id,
            board.id,
            taskImport.taskId,
            event.title,
            event.startsAt,
            event.endsAt,
            event.location,
            JSON.stringify(event.rawPayload),
          ],
        );
        updated += 1;
      } else {
        await client.query(
          `
            INSERT INTO imported_events (
              id,
              board_id,
              task_id,
              provider,
              external_event_id,
              title,
              starts_at,
              ends_at,
              location,
              raw_payload,
              sync_status
            )
            VALUES ($1, $2, $3, 'ics', $4, $5, $6, $7, $8, $9::jsonb, 'active')
          `,
          [
            randomUUID(),
            board.id,
            taskImport.taskId,
            event.uid,
            event.title,
            event.startsAt,
            event.endsAt,
            event.location,
            JSON.stringify(event.rawPayload),
          ],
        );
        created += 1;
      }

      if (taskImport.shouldApplyImportLabels) {
        await ensureImportedTaskLabels(client, board.id, taskImport.taskId);
      }

      touchedTaskIds.add(taskImport.taskId);
    }

    await client.query("COMMIT");

    return {
      created,
      updated,
      bucketId,
      touchedTaskIds: Array.from(touchedTaskIds),
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function ensureCalendarImportsBucket(client: PoolClient, boardId: string) {
  return ensureImportBucket(client, {
    boardId,
    title: "Calendar Imports",
    color: "#0891b2",
  });
}

async function ensureImportBucket(
  client: PoolClient,
  args: {
    boardId: string;
    title: string;
    color: string;
  },
) {
  const existingBucketResult = await client.query<{ id: string }>(
    `
      SELECT id
      FROM buckets
      WHERE board_id = $1 AND LOWER(title) = LOWER($2)
      LIMIT 1
    `,
    [args.boardId, args.title],
  );
  const existingBucketId = existingBucketResult.rows[0]?.id;

  if (existingBucketId) {
    return existingBucketId;
  }

  const orderResult = await client.query<{ next_order: string }>(
    `
      SELECT COALESCE(MAX(sort_order), 0)::text AS next_order
      FROM buckets
      WHERE board_id = $1
    `,
    [args.boardId],
  );
  const bucketId = randomUUID();
  const nextOrder = Number(orderResult.rows[0]?.next_order ?? "0") + 1000;

  await client.query(
    `
      INSERT INTO buckets (id, board_id, title, color, icon, sort_order, is_collapsed)
      VALUES ($1, $2, $3, $4, 'inbox', $5, FALSE)
    `,
    [bucketId, args.boardId, args.title, args.color, nextOrder],
  );

  return bucketId;
}

async function upsertImportedIcsTask(
  client: PoolClient,
  args: {
    boardId: string;
    bucketId: string;
    existingTaskId: string | null;
    fileName: string;
    event: ParsedIcsEvent;
  },
) {
  const existingTask = await findImportTask(client, args.boardId, args.existingTaskId, args.event.uid);

  if (existingTask) {
    if (existingTask.is_read_only_import) {
      const summary = buildImportedTaskSummary(args.event);
      await client.query(
        `
          UPDATE tasks
          SET
            bucket_id = $2,
            parent_task_id = NULL,
            title = $3,
            summary = $4,
            notes = $5,
            status = 'waiting',
            color = '#0891b2',
            icon = 'calendar',
            start_at = $6,
            end_at = $7,
            due_at = NULL,
            source_type = 'ics',
            source_record_id = $8,
            updated_at = NOW()
          WHERE id = $1
        `,
        [
          existingTask.id,
          args.bucketId,
          args.event.title,
          summary,
          buildImportedTaskNotes(args.event, args.fileName),
          args.event.startsAt,
          args.event.endsAt,
          args.event.uid,
        ],
      );
      await mirrorTaskSummaryToPrimaryNote(
        client,
        args.boardId,
        existingTask.id,
        summary,
        await getFirstBoardUserId(client, args.boardId),
      );
    }

    return {
      taskId: existingTask.id,
      shouldApplyImportLabels: existingTask.is_read_only_import,
    };
  }

  const orderResult = await client.query<{ next_order: string }>(
    `
      SELECT COALESCE(MAX(sort_order), 0)::text AS next_order
      FROM tasks
      WHERE bucket_id = $1 AND parent_task_id IS NULL
    `,
    [args.bucketId],
  );
  const taskId = randomUUID();
  const nextOrder = Number(orderResult.rows[0]?.next_order ?? "0") + 1000;
  const summary = buildImportedTaskSummary(args.event);

  await client.query(
    `
      INSERT INTO tasks (
        id,
        board_id,
        bucket_id,
        parent_task_id,
        title,
        summary,
        next_action,
        notes,
        status,
        completed_at,
        color,
        icon,
        start_at,
        end_at,
        due_at,
        sort_order,
        source_type,
        source_record_id,
        is_read_only_import
      )
      VALUES ($1, $2, $3, NULL, $4, $5, '', $6, 'waiting', NULL, '#0891b2', 'calendar', $7, $8, NULL, $9, 'ics', $10, TRUE)
    `,
    [
      taskId,
      args.boardId,
      args.bucketId,
      args.event.title,
      summary,
      buildImportedTaskNotes(args.event, args.fileName),
      args.event.startsAt,
      args.event.endsAt,
      nextOrder,
      args.event.uid,
    ],
  );
  await mirrorTaskSummaryToPrimaryNote(
    client,
    args.boardId,
    taskId,
    summary,
    await getFirstBoardUserId(client, args.boardId),
  );

  return {
    taskId,
    shouldApplyImportLabels: true,
  };
}

async function findImportTask(
  client: PoolClient,
  boardId: string,
  existingTaskId: string | null,
  sourceRecordId: string,
) {
  if (existingTaskId) {
    const taskResult = await client.query<ImportTaskRow>(
      `
        SELECT id, is_read_only_import, deleted_at
        FROM tasks
        WHERE id = $1 AND board_id = $2
        LIMIT 1
      `,
      [existingTaskId, boardId],
    );
    const task = taskResult.rows[0];

    if (task && !task.deleted_at) {
      return task;
    }
  }

  const taskResult = await client.query<ImportTaskRow>(
    `
      SELECT id, is_read_only_import, deleted_at
      FROM tasks
      WHERE board_id = $1 AND source_type = 'ics' AND source_record_id = $2 AND deleted_at IS NULL AND archived_at IS NULL
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [boardId, sourceRecordId],
  );

  return taskResult.rows[0] ?? null;
}

async function ensureImportedTaskLabels(client: PoolClient, boardId: string, taskId: string) {
  await ensureTaskLabels(client, boardId, taskId, ["Imported", "ICS"]);
}

async function loadTaskLabelNames(
  client: PoolClient,
  taskId: string,
) {
  const result = await client.query<{ label_name: string }>(
    `
      SELECT labels.name AS label_name
      FROM task_labels
      INNER JOIN labels ON labels.id = task_labels.label_id
      WHERE task_labels.task_id = $1
      ORDER BY labels.name ASC
    `,
    [taskId],
  );

  return result.rows.map((row) => row.label_name);
}

async function ensureTaskLabels(
  client: PoolClient,
  boardId: string,
  taskId: string,
  labels: string[],
) {
  await client.query(
    `
      DELETE FROM task_labels
      WHERE task_id = $1
    `,
    [taskId],
  );

  for (const labelName of labels) {
    const labelId = await ensureLabel(client, boardId, labelName);

    await client.query(
      `
        INSERT INTO task_labels (task_id, label_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
      `,
      [taskId, labelId],
    );
  }
}

export async function ensureLabel(client: PoolClient, boardId: string, labelName: string) {
  const existingLabelResult = await client.query<{ id: string }>(
    `
      SELECT id
      FROM labels
      WHERE board_id = $1 AND LOWER(name) = LOWER($2)
      LIMIT 1
    `,
    [boardId, labelName],
  );
  const existingLabelId = existingLabelResult.rows[0]?.id;

  if (existingLabelId) {
    return existingLabelId;
  }

  const labelId = mutationUUID();

  await client.query(
    `
      INSERT INTO labels (id, board_id, name)
      VALUES ($1, $2, $3)
    `,
    [labelId, boardId, labelName],
  );

  return labelId;
}

function buildImportedTaskSummary(event: ParsedIcsEvent) {
  if (event.location) {
    return `Imported .ics event at ${event.location}.`;
  }

  return "Imported .ics calendar event.";
}

function buildImportedTaskNotes(event: ParsedIcsEvent, fileName: string) {
  return [
    event.description,
    event.location ? `Location: ${event.location}` : "",
    `Imported from: ${fileName}`,
  ]
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n\n");
}

function getRecordPayload(rawPayload: unknown) {
  if (!rawPayload || typeof rawPayload !== "object" || Array.isArray(rawPayload)) {
    return null;
  }

  return rawPayload as Record<string, unknown>;
}

function getRawPayloadString(rawPayload: unknown, key: string) {
  const payload = getRecordPayload(rawPayload);
  const value = payload?.[key];
  return typeof value === "string" ? value.trim() : "";
}

function getRawPayloadBoolean(rawPayload: unknown, key: string) {
  const payload = getRecordPayload(rawPayload);
  const value = payload?.[key];
  return value === true || value === "true";
}

function mergeRawPayload(rawPayload: unknown, patch: Record<string, unknown>) {
  return {
    ...(getRecordPayload(rawPayload) ?? {}),
    ...patch,
  };
}

function mapImportSyncStatus(value: string | null | undefined): "active" | "stale" | "deleted" {
  if (value === "stale" || value === "deleted") {
    return value;
  }

  return "active";
}

export async function createViewPreset(
  user: TaskboardUserIdentity,
  args: {
    name: string;
    layoutMode: ViewLayoutMode;
    filters?: ViewFilters;
  },
  options: BoardContextOptions = {},
) {
  const pool = getPool();

  if (!pool) {
    return null;
  }

  const client = await pool.connect();

  try {
    const { board } = await resolveBoardContext(client, user, options, "edit");
    const viewUserId = board.owner_user_id ?? (await getOrCreateUserRecord(client, user));
    const id = randomUUID();
    await client.query(
      `
        INSERT INTO view_presets (id, board_id, user_id, name, layout_mode, filters, hidden_fields, display_options)
        VALUES ($1, $2, $3, $4, $5, $6::jsonb, '[]'::jsonb, '{}'::jsonb)
      `,
      [
        id,
        board.id,
        viewUserId,
        requireNonEmptyString(args.name, "name"),
        requireLayoutMode(args.layoutMode),
        JSON.stringify(normalizeViewFilters(args.filters ?? {})),
      ],
    );

    return id;
  } finally {
    client.release();
  }
}

export async function updateViewPreset(
  user: TaskboardUserIdentity,
  viewId: string,
  patch: {
    name?: string;
    layoutMode?: ViewLayoutMode;
    filters?: ViewFilters;
    hiddenFields?: string[];
    displayOptions?: Record<string, boolean | string | number>;
  },
  options: BoardContextOptions = {},
) {
  const pool = getPool();

  if (!pool) {
    return;
  }

  const updates: string[] = [];
  const values: Array<string> = [];

  if (typeof patch.name === "string") {
    values.push(requireNonEmptyString(patch.name, "name"));
    updates.push(`name = $${values.length}`);
  }

  if (typeof patch.layoutMode === "string") {
    values.push(requireLayoutMode(patch.layoutMode));
    updates.push(`layout_mode = $${values.length}`);
  }

  if (patch.filters) {
    values.push(JSON.stringify(normalizeViewFilters(patch.filters)));
    updates.push(`filters = $${values.length}::jsonb`);
  }

  if (patch.hiddenFields) {
    values.push(JSON.stringify(patch.hiddenFields.map(String)));
    updates.push(`hidden_fields = $${values.length}::jsonb`);
  }

  if (patch.displayOptions) {
    values.push(JSON.stringify(patch.displayOptions));
    updates.push(`display_options = $${values.length}::jsonb`);
  }

  if (updates.length === 0) {
    return;
  }

  const client = await pool.connect();

  try {
    const { board } = await resolveBoardContext(client, user, options, "edit");
    const viewUserId = board.owner_user_id ?? (await getOrCreateUserRecord(client, user));
    values.push(viewId);
    values.push(board.id);
    values.push(viewUserId);
    const result = await client.query(
      `
        UPDATE view_presets
        SET ${updates.join(", ")}, updated_at = NOW()
        WHERE id = $${values.length - 2}
          AND board_id = $${values.length - 1}
          AND user_id = $${values.length}
      `,
      values,
    );

    if (result.rowCount === 0) {
      throw new Error("View preset not found.");
    }
  } finally {
    client.release();
  }
}

export async function deleteViewPreset(
  user: TaskboardUserIdentity,
  viewId: string,
  options: BoardContextOptions = {},
) {
  const pool = getPool();

  if (!pool) {
    return;
  }

  const client = await pool.connect();

  try {
    const { board } = await resolveBoardContext(client, user, options, "edit");
    const viewUserId = board.owner_user_id ?? (await getOrCreateUserRecord(client, user));
    const result = await client.query(
      `
        DELETE FROM view_presets
        WHERE id = $1 AND board_id = $2 AND user_id = $3
      `,
      [viewId, board.id, viewUserId],
    );

    if (result.rowCount === 0) {
      throw new Error("View preset not found.");
    }
  } finally {
    client.release();
  }
}

async function fetchBoardStateForUser(
  client: PoolClient,
  user: TaskboardUserIdentity,
  options: BoardContextOptions = {},
): Promise<{ board: Board; boardAccess: BoardAccessMetadata } | null> {
  if (options.boardId === null || options.boardId === undefined) {
    const userId = await getOrCreateUserRecord(client, user);
    await clearStaleSelectedBoardPreferenceForUser(client, user, userId);
  }

  const { board, boardAccess } = await resolveBoardContext(client, user, options, "read");
  const boardUserId = board.owner_user_id ?? (await getOrCreateUserRecord(client, user));
  await purgeExpiredRecycleBinItems(client, board.id);
  await materializeTaskNotifications(client, boardUserId, board.id);
  await ensurePrimaryTaskNotesForBoard(client, board.id);

  // The revision is read before any board data below, and the board's own
  // fields are re-read after it, so the revision never covers a change that
  // this snapshot is missing (see board-revision-schema.ts).
  const revision = await readBoardRevision(client, board.id);
  const boardFieldsResult = await client.query<{ title: string; description: string }>(
    `SELECT title, description FROM boards WHERE id = $1`,
    [board.id],
  );
  const boardFields = boardFieldsResult.rows[0] ?? board;

  const bucketResult = await client.query<DbBucketRow>(
    `
      SELECT id, title, color, icon, is_collapsed
      FROM buckets
      WHERE board_id = $1
      ORDER BY sort_order ASC
    `,
    [board.id],
  );
  const maintenanceLocationResult = await client.query<DbMaintenanceLocationRow>(
    `
      SELECT id, name, is_active
      FROM maintenance_locations
      WHERE board_id = $1
      ORDER BY is_active DESC, sort_order ASC, LOWER(name) ASC
    `,
    [board.id],
  );
  const taskResult = await client.query<DbTaskRow>(
    `
      SELECT
        tasks.id,
        tasks.bucket_id,
        tasks.parent_task_id,
        tasks.title,
        tasks.summary,
        tasks.next_action,
        tasks.notes,
        tasks.status,
        tasks.completed_at,
        tasks.created_at,
        tasks.color,
        tasks.icon,
        tasks.start_at,
        tasks.end_at,
        tasks.all_day,
        tasks.due_at,
        tasks.recurrence_rule,
        tasks.recurrence_series_id,
        tasks.reminder_offset_minutes,
        tasks.overdue_reminder_enabled,
        tasks.sort_order,
        COALESCE(tasks.source_type, 'native') AS source_type,
        tasks.is_read_only_import,
        tasks.work_item_type,
        maintenance_outages.location_id AS outage_location_id,
        maintenance_locations.name AS outage_location_name,
        maintenance_outages.owner_name AS outage_owner_name,
        maintenance_outages.attendees AS outage_attendees,
        imported_events.sync_status AS import_sync_status,
        imported_events.raw_payload AS import_raw_payload
      FROM tasks
      LEFT JOIN maintenance_outages ON maintenance_outages.task_id = tasks.id
      LEFT JOIN maintenance_locations ON maintenance_locations.id = maintenance_outages.location_id
      LEFT JOIN LATERAL (
        SELECT sync_status, raw_payload
        FROM imported_events
        WHERE imported_events.task_id = tasks.id
        ORDER BY imported_events.updated_at DESC, imported_events.created_at DESC
        LIMIT 1
      ) imported_events ON TRUE
      WHERE tasks.board_id = $1 AND tasks.deleted_at IS NULL AND tasks.archived_at IS NULL
      ORDER BY tasks.sort_order ASC
    `,
    [board.id],
  );
  const checklistResult = await client.query<DbChecklistRow>(
    `
      SELECT checklist_items.id, checklist_items.task_id, checklist_items.label, checklist_items.is_done, checklist_items.sort_order
      FROM checklist_items
      INNER JOIN tasks ON tasks.id = checklist_items.task_id
      WHERE tasks.board_id = $1 AND tasks.deleted_at IS NULL AND tasks.archived_at IS NULL
      ORDER BY checklist_items.sort_order ASC
    `,
    [board.id],
  );
  const taskLabelResult = await client.query<DbTaskLabelRow>(
    `
      SELECT task_labels.task_id, labels.name AS label_name
      FROM task_labels
      INNER JOIN labels ON labels.id = task_labels.label_id
      INNER JOIN tasks ON tasks.id = task_labels.task_id
      WHERE tasks.board_id = $1 AND tasks.deleted_at IS NULL AND tasks.archived_at IS NULL
      ORDER BY labels.name ASC
    `,
    [board.id],
  );
  const taskAttachmentResult = await client.query<DbTaskAttachmentRow>(
    `
      SELECT id, task_id, note_id, original_name, display_name, mime_type, size_bytes, created_at
      FROM task_attachments
      WHERE board_id = $1
        AND task_id IN (SELECT id FROM tasks WHERE board_id = $1 AND deleted_at IS NULL AND archived_at IS NULL)
      ORDER BY created_at ASC, display_name ASC, original_name ASC
    `,
    [board.id],
  );
  const taskNoteResult = await client.query<DbTaskNoteRow>(
    `
      SELECT
        task_notes.id,
        task_notes.task_id,
        task_notes.body,
        task_notes.note_type,
        task_notes.created_at,
        task_notes.updated_at,
        COALESCE(created_users.display_name, CASE WHEN to_jsonb(task_notes)->>'created_via_share_id' IS NOT NULL THEN 'Shared link editor' END) AS author_name,
        COALESCE(updated_users.display_name, CASE WHEN to_jsonb(task_notes)->>'updated_via_share_id' IS NOT NULL THEN 'Shared link editor' END) AS editor_name
      FROM task_notes
      LEFT JOIN users created_users ON created_users.id = task_notes.created_by_user_id
      LEFT JOIN users updated_users ON updated_users.id = task_notes.updated_by_user_id
      WHERE task_notes.board_id = $1
        AND task_notes.deleted_at IS NULL
        AND task_notes.task_id IN (SELECT id FROM tasks WHERE board_id = $1 AND deleted_at IS NULL AND archived_at IS NULL)
      ORDER BY task_notes.created_at DESC, task_notes.id DESC
    `,
    [board.id],
  );
  const viewPresetResult = await client.query<DbViewPresetRow>(
    `
      SELECT id, name, layout_mode, filters, hidden_fields, display_options
      FROM view_presets
      WHERE board_id = $1 AND user_id = $2
      ORDER BY created_at ASC
    `,
    [board.id, boardUserId],
  );

  const taskMap = new Map<string, Task>();
  const taskOrder = taskResult.rows.map((row) => row.id);

  for (const row of taskResult.rows) {
    taskMap.set(row.id, {
      id: row.id,
      title: row.title,
      summary: row.summary,
      nextAction: row.next_action || undefined,
      status: row.status,
      ...(row.completed_at ? { completedAt: row.completed_at } : {}),
      ...(row.created_at ? { createdAt: row.created_at } : {}),
      color: row.color ?? "#64748b",
      icon: row.icon ?? "flag",
      startAt: row.start_at ?? undefined,
      endAt: row.end_at ?? undefined,
      allDay: row.all_day,
      dueAt: row.due_at ?? undefined,
      recurrence: parseTaskRecurrenceRule(row.recurrence_rule),
      reminderConfig: {
        reminderOffsetMinutes: row.reminder_offset_minutes,
        overdueReminderEnabled: row.overdue_reminder_enabled,
      },
      labels: [],
      notes: [],
      checklist: [],
      attachments: [],
      subtasks: [],
      workItemType: row.work_item_type,
      maintenanceOutage:
        row.work_item_type === "maintenance_outage"
          ? {
              ...(row.outage_location_id ? { locationId: row.outage_location_id } : {}),
              ...(row.outage_location_name ? { locationName: row.outage_location_name } : {}),
              owner: row.outage_owner_name ?? "",
              attendees: Array.isArray(row.outage_attendees)
                ? row.outage_attendees.map((value) => String(value))
                : [],
            }
          : undefined,
      importedFrom:
        row.source_type && row.source_type !== "native"
          ? {
              source: mapCalendarSource(row.source_type),
              readOnly: row.is_read_only_import,
              convertToTask: true,
              providerLabel: formatProviderLabel(row.source_type),
              syncStatus: mapImportSyncStatus(row.import_sync_status),
              isRecurring: getRawPayloadBoolean(row.import_raw_payload, "isRecurring"),
            }
          : undefined,
    });
  }

  for (const row of checklistResult.rows) {
    const task = taskMap.get(row.task_id);
    if (!task) {
      continue;
    }

    task.checklist.push({
      id: row.id,
      label: row.label,
      done: row.is_done,
    });
  }

  for (const row of taskLabelResult.rows) {
    const task = taskMap.get(row.task_id);
    if (!task) {
      continue;
    }

    task.labels.push(row.label_name);
  }

  for (const row of taskAttachmentResult.rows) {
    const task = taskMap.get(row.task_id);
    if (!task) {
      continue;
    }

    task.attachments.push(mapTaskAttachmentRow(row));
  }

  const attachmentsByNoteId = new Map<string, TaskAttachment[]>();
  for (const task of taskMap.values()) {
    for (const attachment of task.attachments) {
      if (!attachment.noteId) {
        continue;
      }

      const group = attachmentsByNoteId.get(attachment.noteId);
      if (group) {
        group.push(attachment);
      } else {
        attachmentsByNoteId.set(attachment.noteId, [attachment]);
      }
    }
  }

  for (const row of taskNoteResult.rows) {
    const task = taskMap.get(row.task_id);
    if (!task) {
      continue;
    }

    const mappedNote = mapTaskNoteRow(row, attachmentsByNoteId.get(row.id) ?? []);
    if (row.note_type === "primary") {
      task.primaryNote = mappedNote;
    } else {
      task.notes.push(mappedNote);
    }
  }

  const bucketTaskMap = new Map<string, Task[]>();
  for (const bucket of bucketResult.rows) {
    bucketTaskMap.set(bucket.id, []);
  }

  for (const taskId of taskOrder) {
    const row = taskResult.rows.find((candidate) => candidate.id === taskId);
    const task = taskMap.get(taskId);

    if (!row || !task) {
      continue;
    }

    if (row.parent_task_id) {
      const parent = taskMap.get(row.parent_task_id);
      parent?.subtasks.push(task);
      continue;
    }

    if (row.bucket_id) {
      bucketTaskMap.get(row.bucket_id)?.push(task);
    }
  }

  return {
    board: {
      id: board.id,
      title: boardFields.title,
      description: boardFields.description,
      revision,
      views:
        viewPresetResult.rows.length > 0
          ? viewPresetResult.rows.map(mapViewPresetRow)
          : defaultViewPresets,
      buckets: bucketResult.rows.map<Bucket>((bucket) => ({
        id: bucket.id,
        title: bucket.title,
        color: bucket.color ?? "#64748b",
        icon: bucket.icon ?? "inbox",
        collapsed: bucket.is_collapsed,
        tasks: bucketTaskMap.get(bucket.id) ?? [],
      })),
      maintenanceLocations: maintenanceLocationResult.rows.map((location) => ({
        id: location.id,
        name: location.name,
        isActive: location.is_active,
      })),
    },
    boardAccess,
  };
}

async function clearSelectedBoardPreferenceByUserId(client: PoolClient, userId: string) {
  await client.query(
    `
      UPDATE users
      SET last_selected_board_id = NULL,
          updated_at = NOW()
      WHERE id = $1
        AND last_selected_board_id IS NOT NULL
    `,
    [userId],
  );
}

async function clearStaleSelectedBoardPreferenceForUser(
  client: PoolClient,
  user: TaskboardUserIdentity,
  userId: string,
) {
  const preferenceResult = await client.query<{ last_selected_board_id: string | null }>(
    `
      SELECT last_selected_board_id
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId],
  );
  const preferredBoardId = preferenceResult.rows[0]?.last_selected_board_id ?? null;

  if (!preferredBoardId) {
    return;
  }

  try {
    await resolveBoardContext(
      client,
      { ...user, id: userId },
      { boardId: preferredBoardId },
      "read",
    );
  } catch (error) {
    if (!(error instanceof BoardAccessError)) {
      throw error;
    }

    try {
      await clearSelectedBoardPreferenceByUserId(client, userId);
    } catch (cleanupError) {
      console.error("Failed to clear stale selected board preference.", cleanupError);
    }
  }
}

async function fetchPreferredBoardStateForUser(
  client: PoolClient,
  user: TaskboardUserIdentity,
): Promise<{ board: Board; boardAccess: BoardAccessMetadata } | null> {
  const userId = await getOrCreateUserRecord(client, user);
  const personalBoard = await ensureUserBoardRow(client, user);
  const preferenceResult = await client.query<{ last_selected_board_id: string | null }>(
    `
      SELECT last_selected_board_id
      FROM users
      WHERE id = $1
      LIMIT 1
    `,
    [userId],
  );
  const preferredBoardId = preferenceResult.rows[0]?.last_selected_board_id ?? null;

  if (preferredBoardId) {
    try {
      return await fetchBoardStateForUser(client, user, { boardId: preferredBoardId });
    } catch (error) {
      if (error instanceof BoardAccessError) {
        try {
          await clearSelectedBoardPreferenceByUserId(client, userId);
        } catch (cleanupError) {
          console.error("Failed to clear stale selected board preference.", cleanupError);
        }
      } else {
        throw error;
      }
    }
  }

  return fetchBoardStateForUser(client, user, { boardId: personalBoard.id });
}

async function fetchBoardForUser(
  client: PoolClient,
  user: TaskboardUserIdentity,
): Promise<Board | null> {
  return (await fetchBoardStateForUser(client, user))?.board ?? null;
}

export async function getBoardRowForUserId(client: PoolClient, userId: string) {
  const boardResult = await client.query<DbBoardRow>(
    `
      SELECT
        id,
        owner_user_id,
        board_type,
        owner_team_id,
        team_member_default_access,
        personal_visibility,
        personal_visibility_team_id,
        title,
        description
      FROM boards
      WHERE board_type = 'personal'
        AND owner_user_id = $1
      ORDER BY created_at ASC
      LIMIT 1
    `,
    [userId],
  );

  return boardResult.rows[0] ?? null;
}

async function getBoardRowFromPool(
  user: TaskboardUserIdentity,
  options: BoardContextOptions = {},
  requiredAccess: BoardAccessRequirement = "edit",
) {
  const pool = getPool();

  if (!pool) {
    return null;
  }

  const client = await pool.connect();

  try {
    return (await resolveBoardContext(client, user, options, requiredAccess)).board;
  } finally {
    client.release();
  }
}

async function getRootTaskIdsForBucket(client: PoolClient, boardId: string, bucketId: string) {
  const result = await client.query<{ id: string }>(
    `
      SELECT id
      FROM tasks
      WHERE board_id = $1
        AND bucket_id = $2
        AND parent_task_id IS NULL
        AND deleted_at IS NULL
        AND archived_at IS NULL
      ORDER BY sort_order ASC, id ASC
    `,
    [boardId, bucketId],
  );

  return result.rows.map((row) => row.id);
}

async function getTaskAttachmentRecordForTask(
  client: PoolClient,
  boardId: string,
  taskId: string,
  attachmentId: string,
) {
  const result = await client.query<DbAttachmentRecordRow>(
    `
      SELECT id, task_id, board_id, note_id, original_name, display_name, stored_name, mime_type, size_bytes, created_at
      FROM task_attachments
      WHERE id = $1 AND task_id = $2 AND board_id = $3
        AND EXISTS (SELECT 1 FROM tasks WHERE tasks.id = task_attachments.task_id AND tasks.deleted_at IS NULL)
      LIMIT 1
    `,
    [attachmentId, taskId, boardId],
  );

  return result.rows[0] ?? null;
}

async function assertTaskBelongsToBoard(client: PoolClient, boardId: string, taskId: string) {
  const result = await client.query<{ id: string }>(
    `
      SELECT id
      FROM tasks
      WHERE id = $1 AND board_id = $2 AND deleted_at IS NULL AND archived_at IS NULL
      LIMIT 1
      FOR SHARE
    `,
    [taskId, boardId],
  );

  if (!result.rows[0]) {
    throw new Error("Task not found.");
  }
}

// Notes, files, checklists and links belong to the task at the top of the
// tree; a subtask holds none (see subtask-rule.ts).
export async function assertTaskCanHoldDetail(client: PoolClient, boardId: string, taskId: string) {
  const row = (await client.query<{ parent_task_id: string | null }>(
    `SELECT parent_task_id FROM tasks WHERE id = $1 AND board_id = $2`,
    [taskId, boardId],
  )).rows[0];
  if (row?.parent_task_id) throw new SubtaskRuleError();
}

async function getTaskAttachmentDiskKeysForTaskTree(
  client: PoolClient,
  boardId: string,
  taskId: string,
) {
  const result = await client.query<{ stored_name: string }>(
    `
      WITH RECURSIVE task_tree AS (
        SELECT id
        FROM tasks
        WHERE id = $1 AND board_id = $2
        UNION ALL
        SELECT tasks.id
        FROM tasks
        INNER JOIN task_tree ON tasks.parent_task_id = task_tree.id
      )
      SELECT stored_name
      FROM task_attachments
      WHERE board_id = $2
        AND task_id IN (SELECT id FROM task_tree)
    `,
    [taskId, boardId],
  );

  return result.rows.map((row) => row.stored_name);
}

async function getTaskAttachmentDiskKeysForBucketRootTasks(
  client: PoolClient,
  boardId: string,
  bucketId: string,
) {
  const result = await client.query<{ stored_name: string }>(
    `
      WITH RECURSIVE task_tree AS (
        SELECT id
        FROM tasks
        WHERE board_id = $1 AND bucket_id = $2 AND parent_task_id IS NULL
        UNION ALL
        SELECT tasks.id
        FROM tasks
        INNER JOIN task_tree ON tasks.parent_task_id = task_tree.id
      )
      SELECT stored_name
      FROM task_attachments
      WHERE board_id = $1
        AND task_id IN (SELECT id FROM task_tree)
    `,
    [boardId, bucketId],
  );

  return result.rows.map((row) => row.stored_name);
}

async function writeTaskOrder(
  client: PoolClient,
  boardId: string,
  bucketId: string,
  taskIds: string[],
) {
  if (taskIds.length === 0) {
    return;
  }

  // One statement for the whole bucket instead of one UPDATE per task.
  await client.query(
    `
      UPDATE tasks
      SET sort_order = ordered.position * 1000, bucket_id = $2, updated_at = NOW()
      FROM unnest($3::uuid[]) WITH ORDINALITY AS ordered(task_id, position)
      WHERE tasks.id = ordered.task_id AND tasks.board_id = $1
    `,
    [boardId, bucketId, taskIds],
  );
}

function mapCalendarSource(sourceType: string) {
  switch (sourceType) {
    case "google":
    case "ics":
    case "manual":
      return sourceType;
    default:
      return "manual";
  }
}

function parseTaskRecurrenceRule(value: unknown): TaskRecurrenceRule | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }

  const candidate = value as Partial<TaskRecurrenceRule>;
  if (
    !candidate.frequency ||
    !recurrenceFrequencies.has(candidate.frequency as TaskRecurrenceFrequency) ||
    !candidate.mode ||
    !recurrenceModes.has(candidate.mode as TaskRecurrenceMode) ||
    typeof candidate.interval !== "number" ||
    !Number.isInteger(candidate.interval) ||
    candidate.interval < 1
  ) {
    return undefined;
  }

  return {
    frequency: candidate.frequency as TaskRecurrenceFrequency,
    interval: candidate.interval,
    mode: candidate.mode as TaskRecurrenceMode,
  };
}

function formatProviderLabel(sourceType: string) {
  switch (sourceType) {
    case "google":
      return "Google Calendar";
    case "ics":
      return ".ics import";
    default:
      return "Manual";
  }
}

function mapRecycleBinSource(sourceType: string | null) {
  if (!sourceType || sourceType === "native") {
    return "native" as const;
  }

  return mapCalendarSource(sourceType);
}

function mapRecycleBinRow(row: DbRecycleBinRow): RecycleBinItem {
  const source = mapRecycleBinSource(row.source_type);

  return {
    id: row.id,
    title: row.title,
    source,
    providerLabel: source === "native" ? "Task" : formatProviderLabel(source),
    readOnlyImport: row.is_read_only_import,
    convertedImport: source !== "native" && !row.is_read_only_import,
    deletedAt: row.deleted_at,
    purgeAfterAt: row.purge_after_at,
    ...(row.recycle_original_bucket_title
      ? { originalBucketTitle: row.recycle_original_bucket_title }
      : {}),
    ...(row.parent_title ? { parentTitle: row.parent_title } : {}),
    attachmentCount: Number(row.attachment_count),
    subtaskCount: Number(row.subtask_count),
  };
}

function mapArchiveRow(row: DbArchiveRow): ArchiveItem {
  const source = mapRecycleBinSource(row.source_type);

  return {
    id: row.id,
    title: row.title,
    source,
    providerLabel: source === "native" ? "Task" : formatProviderLabel(source),
    readOnlyImport: row.is_read_only_import,
    convertedImport: source !== "native" && !row.is_read_only_import,
    archivedAt: row.archived_at,
    ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    ...(row.archive_original_bucket_title
      ? {
          originalBucketTitle: row.original_bucket_exists
            ? row.archive_original_bucket_title
            : `${row.archive_original_bucket_title} (removed)`,
        }
      : {}),
    attachmentCount: Number(row.attachment_count),
    subtaskCount: Number(row.subtask_count),
  };
}

function isImportedEventSuppressedByRecycleBin(row: ImportedEventRow | null) {
  if (!row || row.sync_status !== "deleted" || (!row.task_deleted_at && !row.task_archived_at)) {
    return false;
  }

  if (row.task_archived_at) {
    return true;
  }

  if (!row.task_purge_after_at) {
    return true;
  }

  return new Date(row.task_purge_after_at).getTime() > Date.now();
}

async function purgeExpiredRecycleBinItems(client: PoolClient, boardId: string) {
  // Owns its transaction; call before starting a request's write transaction.
  // Eligibility is checked by the locking query, including after a concurrent
  // update. Busy rows wait for a later automatic purge.
  const diskKeys: string[] = [];
  await client.query("BEGIN");

  try {
    const expiredRootResult = await client.query<{ id: string }>(
      `
        SELECT item.id
        FROM tasks item
        LEFT JOIN tasks parent ON parent.id = item.parent_task_id
        WHERE
          item.board_id = $1
          AND item.deleted_at IS NOT NULL
          AND item.purge_after_at IS NOT NULL
          AND item.purge_after_at <= NOW()
          AND (item.parent_task_id IS NULL OR parent.recycle_group_id IS DISTINCT FROM item.recycle_group_id)
        ORDER BY item.id
        FOR UPDATE OF item SKIP LOCKED
      `,
      [boardId],
    );

    for (const row of expiredRootResult.rows) {
      diskKeys.push(...await permanentlyDeleteRecycledTree(client, boardId, row.id, true));
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }

  await removeTaskAttachmentFiles(diskKeys);
}

async function recycleRootTaskTree(
  client: PoolClient,
  args: {
    boardId: string;
    taskId: string;
    deletedByUserId: string;
    originalBucketId?: string | null;
    originalBucketTitle?: string | null;
  },
) {
  await recycleTaskTree(client, args);
}

// One delete is one recycle group: the task and the live work under it.
// Work deleted earlier keeps its own group, so restoring this item does not
// bring that back. A subtask keeps its parent, bucket, and position.
async function recycleTaskTree(
  client: PoolClient,
  args: {
    boardId: string;
    taskId: string;
    deletedByUserId: string;
    originalBucketId?: string | null;
    originalBucketTitle?: string | null;
    keepPlacement?: boolean;
  },
) {
  await lockTaskTree(client, args.boardId, args.taskId);
  const deletedAt = mutationDate().toISOString();
  const purgeAfterAt = new Date(mutationDate().getTime() + recycleBinRetentionMs).toISOString();
  const groupId = mutationUUID();

  await client.query(
    `
      WITH RECURSIVE task_tree AS (
        SELECT id
        FROM tasks
        WHERE id = $1 AND board_id = $2 AND deleted_at IS NULL
        UNION ALL
        SELECT tasks.id
        FROM tasks
        INNER JOIN task_tree ON tasks.parent_task_id = task_tree.id
        WHERE tasks.deleted_at IS NULL
      )
      UPDATE tasks
      SET
        deleted_at = $3,
        purge_after_at = $4,
        recycle_deleted_by_user_id = $5,
        recycle_group_id = $8,
        bucket_id = CASE WHEN $9::boolean THEN tasks.bucket_id ELSE NULL END,
        recycle_original_bucket_id = CASE
          WHEN tasks.id = $1 THEN $6
          ELSE recycle_original_bucket_id
        END,
        recycle_original_bucket_title = CASE
          WHEN tasks.id = $1 THEN $7
          ELSE recycle_original_bucket_title
        END,
        updated_at = NOW()
      WHERE id IN (SELECT id FROM task_tree)
    `,
    [
      args.taskId,
      args.boardId,
      deletedAt,
      purgeAfterAt,
      args.deletedByUserId,
      args.originalBucketId ?? null,
      args.originalBucketTitle ?? null,
      groupId,
      Boolean(args.keepPlacement),
    ],
  );

  await client.query(
    `
      UPDATE imported_events
      SET sync_status = 'deleted', updated_at = NOW()
      WHERE board_id = $2
        AND task_id IN (SELECT id FROM tasks WHERE board_id = $2 AND recycle_group_id = $1)
    `,
    [groupId, args.boardId],
  );
}

// Batch recycles lock every top-level task first, in one order, so two
// batches over the same tasks wait instead of deadlocking.
async function lockRootTasks(client: PoolClient, boardId: string, taskIds: string[]) {
  if (taskIds.length === 0) return;
  await client.query(
    `SELECT id FROM tasks WHERE board_id = $1 AND id = ANY($2::uuid[]) ORDER BY id FOR UPDATE`,
    [boardId, taskIds],
  );
}

// Holds a live task while a change to its notes, attachments, or checklist
// commits, so a delete of the task cannot slip in between check and write.
// A change that also writes the task row takes the exclusive lock up front,
// so two editors never wait on each other to upgrade a shared one.
async function lockLiveTask(client: PoolClient, boardId: string, taskId: string, mode: "share" | "update" = "share") {
  const result = await client.query(
    `SELECT id FROM tasks WHERE id = $1 AND board_id = $2 AND deleted_at IS NULL ${mode === "update" ? "FOR UPDATE" : "FOR SHARE"}`,
    [taskId, boardId],
  );
  if (!result.rows[0]) {
    throw new Error("Task not found.");
  }
}

// A Recycle Bin item is a deleted top-level task, or a subtask deleted on its
// own (not as part of its parent's delete).
async function getRecycleBinItemRecord(client: PoolClient, boardId: string, taskId: string) {
  const result = await client.query<{
    id: string;
    parent_task_id: string | null;
    recycle_group_id: string;
    recycle_original_bucket_id: string | null;
  }>(
    `
      SELECT item.id, item.parent_task_id, item.recycle_group_id, item.recycle_original_bucket_id
      FROM tasks item
      LEFT JOIN tasks parent ON parent.id = item.parent_task_id
      WHERE item.id = $1 AND item.board_id = $2 AND item.deleted_at IS NOT NULL
        AND item.recycle_group_id IS NOT NULL
        AND (item.parent_task_id IS NULL OR parent.recycle_group_id IS DISTINCT FROM item.recycle_group_id)
      FOR UPDATE OF item
    `,
    [taskId, boardId],
  );
  return result.rows[0] ?? null;
}

async function archiveRootTaskTree(
  client: PoolClient,
  args: {
    boardId: string;
    taskId: string;
    archivedByUserId: string | null;
    originalBucketId?: string | null;
    originalBucketTitle?: string | null;
    reason: "manual" | "recurring_completion";
  },
) {
  const archivedAt = mutationDate().toISOString();

  await client.query(
    `
      WITH RECURSIVE task_tree AS (
        SELECT id
        FROM tasks
        WHERE id = $1 AND board_id = $2
        UNION ALL
        SELECT tasks.id
        FROM tasks
        INNER JOIN task_tree ON tasks.parent_task_id = task_tree.id
        WHERE tasks.deleted_at IS NULL
      )
      UPDATE tasks
      SET
        archived_at = $3,
        archive_archived_by_user_id = $4,
        bucket_id = NULL,
        archive_original_bucket_id = CASE
          WHEN tasks.id = $1 THEN $5
          ELSE archive_original_bucket_id
        END,
        archive_original_bucket_title = CASE
          WHEN tasks.id = $1 THEN $6
          ELSE archive_original_bucket_title
        END,
        archive_reason = CASE
          WHEN tasks.id = $1 THEN $7
          ELSE archive_reason
        END,
        updated_at = NOW()
      WHERE id IN (SELECT id FROM task_tree)
    `,
    [
      args.taskId,
      args.boardId,
      archivedAt,
      args.archivedByUserId,
      args.originalBucketId ?? null,
      args.originalBucketTitle ?? null,
      args.reason,
    ],
  );

  await client.query(
    `
      WITH RECURSIVE task_tree AS (
        SELECT id
        FROM tasks
        WHERE id = $1 AND board_id = $2
        UNION ALL
        SELECT tasks.id
        FROM tasks
        INNER JOIN task_tree ON tasks.parent_task_id = task_tree.id
        WHERE tasks.deleted_at IS NULL
      )
      UPDATE imported_events
      SET sync_status = 'deleted', updated_at = NOW()
      WHERE board_id = $2 AND task_id IN (SELECT id FROM task_tree)
    `,
    [args.taskId, args.boardId],
  );
}

// Deletes a recycled item and everything under it. A purge may find an item
// already removed with an older item that contained it; that is not an error.
async function permanentlyDeleteRecycledTree(
  client: PoolClient,
  boardId: string,
  taskId: string,
  allowMissing = false,
) {
  const diskKeys = await getTaskAttachmentDiskKeysForTaskTree(client, boardId, taskId);

  await client.query(
    `
      WITH RECURSIVE task_tree AS (
        SELECT id
        FROM tasks
        WHERE id = $1 AND board_id = $2
        UNION ALL
        SELECT tasks.id
        FROM tasks
        INNER JOIN task_tree ON tasks.parent_task_id = task_tree.id
      )
      DELETE FROM imported_events
      WHERE board_id = $2 AND task_id IN (SELECT id FROM task_tree)
    `,
    [taskId, boardId],
  );

  const deleteResult = await client.query(
    `
      DELETE FROM tasks
      WHERE id = $1 AND board_id = $2 AND deleted_at IS NOT NULL
    `,
    [taskId, boardId],
  );

  if (deleteResult.rowCount === 0) {
    if (allowMissing) return [];
    throw new Error("Recycle-bin item not found.");
  }

  return diskKeys;
}

async function getTaskRecordForDelete(
  client: PoolClient,
  boardId: string,
  taskId: string,
) {
  const result = await client.query<{
    id: string;
    parent_task_id: string | null;
    bucket_id: string | null;
    deleted_at: string | null;
    archived_at: string | null;
    recycle_original_bucket_id: string | null;
    recycle_original_bucket_title: string | null;
    bucket_title: string | null;
  }>(
    `
      SELECT
        tasks.id,
        tasks.parent_task_id,
        tasks.bucket_id,
        tasks.deleted_at,
        tasks.archived_at,
        tasks.recycle_original_bucket_id,
        tasks.recycle_original_bucket_title,
        buckets.title AS bucket_title
      FROM tasks
      LEFT JOIN buckets ON buckets.id = tasks.bucket_id AND buckets.board_id = tasks.board_id
      WHERE tasks.id = $1 AND tasks.board_id = $2
      LIMIT 1
    `,
    [taskId, boardId],
  );

  return result.rows[0] ?? null;
}

async function getRootTaskRecordForArchive(
  client: PoolClient,
  boardId: string,
  taskId: string,
) {
  const result = await client.query<{
    id: string;
    bucket_id: string | null;
    deleted_at: string | null;
    archived_at: string | null;
    archive_original_bucket_id: string | null;
    archive_original_bucket_title: string | null;
    bucket_title: string | null;
  }>(
    `
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_task_id
        FROM tasks
        WHERE id = $1 AND board_id = $2
        UNION ALL
        SELECT parent.id, parent.parent_task_id
        FROM tasks parent
        INNER JOIN ancestors child ON child.parent_task_id = parent.id
        WHERE parent.board_id = $2
      )
      SELECT
        root.id,
        root.bucket_id,
        root.deleted_at,
        root.archived_at,
        root.archive_original_bucket_id,
        root.archive_original_bucket_title,
        buckets.title AS bucket_title
      FROM tasks root
      LEFT JOIN buckets ON buckets.id = root.bucket_id AND buckets.board_id = root.board_id
      WHERE root.id IN (SELECT id FROM ancestors WHERE parent_task_id IS NULL)
        AND root.board_id = $2
      LIMIT 1
    `,
    [taskId, boardId],
  );

  return result.rows[0] ?? null;
}

async function ensureInboxBucket(client: PoolClient, boardId: string) {
  const existingBucketResult = await client.query<{ id: string }>(
    `
      SELECT id
      FROM buckets
      WHERE board_id = $1 AND LOWER(title) = 'inbox'
      ORDER BY sort_order ASC
      LIMIT 1
    `,
    [boardId],
  );

  const existingBucketId = existingBucketResult.rows[0]?.id;

  if (existingBucketId) {
    return existingBucketId;
  }

  const orderResult = await client.query<{ next_order: string }>(
    `
      SELECT COALESCE(MAX(sort_order), 0)::text AS next_order
      FROM buckets
      WHERE board_id = $1
    `,
    [boardId],
  );
  const bucketId = mutationUUID();
  const nextOrder = Number(orderResult.rows[0]?.next_order ?? "0") + 1000;

  await client.query(
    `
      INSERT INTO buckets (id, board_id, title, color, icon, sort_order, is_collapsed)
      VALUES ($1, $2, 'Inbox', '#64748b', 'inbox', $3, FALSE)
    `,
    [bucketId, boardId, nextOrder],
  );

  return bucketId;
}

async function resolveRestoreBucketId(
  client: PoolClient,
  boardId: string,
  originalBucketId: string | null,
) {
  if (originalBucketId) {
    const originalBucketResult = await client.query<{ id: string }>(
      `
        SELECT id
        FROM buckets
        WHERE id = $1 AND board_id = $2
        LIMIT 1
      `,
      [originalBucketId, boardId],
    );

    if (originalBucketResult.rows[0]?.id) {
      return originalBucketResult.rows[0].id;
    }
  }

  const fallbackBucketResult = await client.query<{ id: string }>(
    `
      SELECT id
      FROM buckets
      WHERE board_id = $1
      ORDER BY sort_order ASC
      LIMIT 1
    `,
    [boardId],
  );

  return fallbackBucketResult.rows[0]?.id ?? ensureInboxBucket(client, boardId);
}

async function getNextRootTaskSortOrder(
  client: PoolClient,
  boardId: string,
  bucketId: string,
) {
  const orderResult = await client.query<{ next_order: string }>(
    `
      SELECT COALESCE(MAX(sort_order), 0)::text AS next_order
      FROM tasks
      WHERE board_id = $1
        AND bucket_id = $2
        AND parent_task_id IS NULL
        AND deleted_at IS NULL
        AND archived_at IS NULL
    `,
    [boardId, bucketId],
  );

  return Number(orderResult.rows[0]?.next_order ?? "0") + 1000;
}

async function insertNativeRootTask(
  client: PoolClient,
  args: {
    taskId: string;
    boardId: string;
    bucketId: string;
    sortOrder: number;
    actorUserId: string;
    task: BulkTaskImportTask & {
      startAt?: string | null;
      endAt?: string | null;
      allDay?: boolean;
      color?: string;
      icon?: TaskIcon;
      workItemType?: "task" | "maintenance_outage";
    };
  },
) {
  await client.query(
    `
      INSERT INTO tasks (
        id,
        board_id,
        bucket_id,
        parent_task_id,
        title,
        summary,
        next_action,
        notes,
        status,
        completed_at,
        color,
        icon,
        start_at,
        end_at,
        due_at,
        recurrence_rule,
        recurrence_series_id,
        reminder_offset_minutes,
        overdue_reminder_enabled,
        sort_order,
        source_type,
        is_read_only_import,
        work_item_type,
        all_day
      )
      VALUES (
        $1, $2, $3, NULL, $4, $5, $6, $7, $8, CASE WHEN $8 = 'done' THEN NOW() ELSE NULL END, $9, $10, $11, $12, $13, NULL, NULL, NULL, FALSE, $14, 'native', FALSE, $15, $16
      )
    `,
    [
      args.taskId,
      args.boardId,
      args.bucketId,
      requireNonEmptyString(args.task.title, "title"),
      args.task.summary.trim(),
      args.task.nextAction.trim(),
      args.task.note.trim(),
      requireTaskStatus(args.task.status),
      requireColor(args.task.color ?? "#64748b"),
      requireTaskIcon(args.task.icon ?? "flag"),
      requireDateOrNull(args.task.startAt ?? null),
      requireDateOrNull(args.task.endAt ?? null),
      requireDateOrNull(args.task.dueAt),
      args.sortOrder,
      args.task.workItemType ?? "task",
      Boolean(args.task.allDay),
    ],
  );

  if (args.task.labels.length > 0) {
    await ensureTaskLabels(
      client,
      args.boardId,
      args.taskId,
      normalizeLabels(args.task.labels),
    );
  }

  const noteBody = args.task.note.trim();
  if (noteBody) {
    await client.query(
      `
        INSERT INTO task_notes (id, board_id, task_id, body, note_type, created_by_user_id)
        VALUES ($1, $2, $3, $4, 'working', $5)
      `,
      [mutationUUID(), args.boardId, args.taskId, noteBody, args.actorUserId],
    );
  }

  await mirrorTaskSummaryToPrimaryNote(
    client,
    args.boardId,
    args.taskId,
    args.task.summary,
    args.actorUserId,
  );
}

async function resolveBulkImportBucketId(args: {
  boardId: string;
  task: BulkTaskImportTask;
  bucketByNormalizedTitle: Map<string, { id: string; title: string }>;
  mappingBySource: Map<string, string>;
  createdBucketIdBySource: Map<string, string>;
}) {
  const sourceKey = normalizeBucketImportKey(args.task.bucket);
  const directBucket = args.bucketByNormalizedTitle.get(sourceKey);

  if (directBucket) {
    return directBucket.id;
  }

  const mappedBucketId = args.mappingBySource.get(sourceKey);
  if (mappedBucketId) {
    return mappedBucketId;
  }

  const createdBucketId = args.createdBucketIdBySource.get(sourceKey);
  if (createdBucketId) {
    return createdBucketId;
  }

  throw new Error(`Bucket "${args.task.bucket}" is not mapped or approved for creation.`);
}

async function getFirstBoardUserId(client: PoolClient, boardId: string) {
  const result = await client.query<{ owner_user_id: string }>(
    `
      SELECT owner_user_id
      FROM boards
      WHERE id = $1
      LIMIT 1
    `,
    [boardId],
  );

  const userId = result.rows[0]?.owner_user_id;
  if (!userId) {
    throw new Error("Board owner not found.");
  }

  return userId;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function normalizeBucketImportKey(value: string) {
  return value.trim().toLocaleLowerCase();
}

function normalizeAttachmentFilename(filename: string) {
  const trimmed = filename.trim();
  const basename = path.basename(trimmed);
  return basename || "attachment";
}

function normalizeAttachmentDisplayName(displayName: string) {
  const trimmed = displayName.trim();
  if (!trimmed) {
    return "";
  }

  const basename = path.basename(trimmed);
  return basename || "";
}

function buildTaskAttachmentDiskKey(boardId: string, taskId: string, attachmentId: string) {
  return path.posix.join(boardId, taskId, attachmentId);
}

function getTaskAttachmentDiskPath(diskKey: string) {
  return path.join(taskAttachmentUploadRoot, diskKey);
}

function mapTaskAttachmentRow(row: DbTaskAttachmentRow): TaskAttachment {
  return {
    id: row.id,
    ...(row.note_id ? { noteId: row.note_id } : {}),
    originalName: row.original_name,
    displayName: row.display_name || row.original_name,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    createdAt: row.created_at,
    previewKind: getTaskAttachmentPreviewKind(row.mime_type),
  };
}

function mapTaskNoteRow(row: DbTaskNoteRow, attachments: TaskAttachment[]): TaskNote {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    ...(row.updated_at ? { updatedAt: row.updated_at } : {}),
    authorName: row.author_name ?? "Unknown user",
    ...(row.editor_name ? { editorName: row.editor_name } : {}),
    attachments,
  };
}

async function ensurePrimaryTaskNotesForBoard(client: PoolClient, boardId: string) {
  await client.query(
    `
      INSERT INTO task_notes (id, board_id, task_id, body, note_type, created_by_user_id, created_at)
      SELECT
        (
          SUBSTR(MD5('primary-task-note:' || tasks.id::text), 1, 8) || '-' ||
          SUBSTR(MD5('primary-task-note:' || tasks.id::text), 9, 4) || '-' ||
          SUBSTR(MD5('primary-task-note:' || tasks.id::text), 13, 4) || '-' ||
          SUBSTR(MD5('primary-task-note:' || tasks.id::text), 17, 4) || '-' ||
          SUBSTR(MD5('primary-task-note:' || tasks.id::text), 21, 12)
        )::uuid,
        tasks.board_id,
        tasks.id,
        BTRIM(tasks.summary),
        'primary',
        COALESCE(boards.owner_user_id, boards.created_by_user_id),
        COALESCE(tasks.created_at, NOW())
      FROM tasks
      INNER JOIN boards ON boards.id = tasks.board_id
      WHERE tasks.board_id = $1
        AND tasks.deleted_at IS NULL
        AND tasks.archived_at IS NULL
        AND tasks.parent_task_id IS NULL
        AND NOT EXISTS (
          SELECT 1
          FROM task_notes
          WHERE task_notes.task_id = tasks.id
            AND task_notes.note_type = 'primary'
            AND task_notes.deleted_at IS NULL
        )
      ON CONFLICT DO NOTHING
    `,
    [boardId],
  );
}

async function mirrorTaskSummaryToPrimaryNote(
  client: PoolClient,
  boardId: string,
  taskId: string,
  summary: string,
  userId: string | null,
) {
  const normalizedSummary = summary.trim();

  await client.query(
    `
      INSERT INTO task_notes (
        id,
        board_id,
        task_id,
        body,
        note_type,
        created_by_user_id,
        updated_by_user_id,
        updated_at
      )
      SELECT $1, $2, tasks.id, $4, 'primary', $5, $5, NOW()
      FROM tasks
      WHERE tasks.id = $3
        AND tasks.board_id = $2
        AND tasks.deleted_at IS NULL
      ON CONFLICT DO NOTHING
    `,
    [mutationUUID(), boardId, taskId, normalizedSummary, userId],
  );

  await client.query(
    `
      UPDATE task_notes
      SET body = $3, updated_by_user_id = $4, updated_at = NOW()
      WHERE board_id = $1
        AND task_id = $2
        AND note_type = 'primary'
        AND deleted_at IS NULL
        AND EXISTS (
          SELECT 1
          FROM tasks
          WHERE tasks.id = $2
            AND tasks.board_id = $1
            AND tasks.deleted_at IS NULL
        )
    `,
    [boardId, taskId, normalizedSummary, userId],
  );
}

function getTaskAttachmentPreviewKind(mimeType: string): TaskAttachmentPreviewKind {
  if (mimeType === "application/pdf") {
    return "pdf";
  }

  if (mimeType.toLowerCase().startsWith("image/")) {
    return "image";
  }

  return "none";
}

async function ensureTaskAttachmentUploadRoot() {
  await mkdir(taskAttachmentUploadRoot, { recursive: true });
}

async function removeTaskAttachmentFiles(diskKeys: string[]) {
  await Promise.all(
    Array.from(new Set(diskKeys)).map(async (diskKey) => {
      try {
        await unlink(getTaskAttachmentDiskPath(diskKey));
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !("code" in error) ||
          (error as NodeJS.ErrnoException).code !== "ENOENT"
        ) {
          console.error("Failed to delete task attachment file.", { diskKey, error });
        }
      }
    }),
  );
}

export function stableUuid(input: string) {
  const hex = createHash("sha1").update(input).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export async function ensureSchemaAndSeed() {
  // New DDL belongs only in db/migrations/recorded/. The pre-wiki bootstrap is
  // frozen in schema-baseline.ts and must never grow with feature branches.
  const pool = getPool();

  if (!pool) {
    throw new Error("DATABASE_URL is not configured.");
  }

  const baselineSql = await readFile(path.join(process.cwd(), "db/baseline/schema.sql"), "utf8");
  if (migrationChecksum(baselineSql) !== BASELINE_SQL_CHECKSUM) {
    throw new Error("Frozen baseline SQL checksum mismatch. Startup refused.");
  }
  return initializeSchema({
    pool,
    baseline: applyFrozenBaseline,
    seed: async (client) => {
      const result = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM boards`);
      if (Number(result.rows[0]?.count ?? "0") === 0) await seedDatabase(client);
    },
  });
}

async function seedDatabase(client: PoolClient) {
  const userId = stableUuid("seed-user");
  const boardId = stableUuid(seedBoard.id);

  await client.query("BEGIN");

  try {
    await client.query(
      `
        INSERT INTO users (
          id, email, username, display_name, role, is_disabled,
          is_reserved_local_admin, auth_provider
        )
        VALUES ($1, $2, $3, $4, 'admin', FALSE, TRUE, 'local')
        ON CONFLICT (id) DO NOTHING
      `,
      [
        userId,
        legacyOwnerEmail,
        defaultReservedLocalAdminUsername,
        legacyOwnerDisplayName,
      ],
    );

    await client.query(
      `
        INSERT INTO boards (
          id, owner_user_id, board_type, personal_visibility, title, description, created_by_user_id, updated_by_user_id
        )
        VALUES ($1, $2, 'personal', 'private', $3, $4, $2, $2)
        ON CONFLICT (id) DO NOTHING
      `,
      [boardId, userId, seedBoard.title, seedBoard.description],
    );

    await client.query(
      `
        INSERT INTO board_members (board_id, user_id, role)
        VALUES ($1, $2, 'owner')
        ON CONFLICT (board_id, user_id) DO NOTHING
      `,
      [boardId, userId],
    );

    for (const view of defaultViewPresets) {
      await client.query(
        `
          INSERT INTO view_presets (id, board_id, user_id, name, layout_mode, filters, hidden_fields, display_options)
          VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb)
          ON CONFLICT (id) DO NOTHING
        `,
        [
          stableUuid(view.id),
          boardId,
          userId,
          view.name,
          view.layoutMode,
          JSON.stringify(view.filters),
          JSON.stringify(view.hiddenFields),
          JSON.stringify(view.displayOptions),
        ],
      );
    }

    await seedBoardBucketsAndTasks(client, boardId);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function seedBoardBucketsAndTasks(client: PoolClient, boardId: string) {
  const labelMap = new Map<string, string>();
  const boardOwnerId = await getFirstBoardUserId(client, boardId);
  const tasksToInsert: Array<{
    task: Task;
    boardId: string;
    bucketId: string;
    parentTaskId: string | null;
    sortOrder: number;
  }> = [];

  for (const [bucketIndex, bucket] of seedBoard.buckets.entries()) {
    const bucketId = stableUuid(`${boardId}:bucket:${bucket.id}`);
    await client.query(
      `
        INSERT INTO buckets (id, board_id, title, color, icon, sort_order, is_collapsed)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (id) DO NOTHING
      `,
      [
        bucketId,
        boardId,
        bucket.title,
        bucket.color,
        bucket.icon,
        (bucketIndex + 1) * 1000,
        bucket.collapsed,
      ],
    );

    collectTasks(tasksToInsert, bucket.tasks, boardId, bucketId, null);
  }

  for (const entry of tasksToInsert) {
    const taskId = stableUuid(`${entry.boardId}:task:${entry.task.id}`);
    const legacyNoteText = entry.task.notes.map((note) => note.body).join("\n\n");

    await client.query(
      `
        INSERT INTO tasks (
          id,
          board_id,
          bucket_id,
          parent_task_id,
          title,
          summary,
          next_action,
          notes,
          status,
          color,
          icon,
          start_at,
          end_at,
          due_at,
          sort_order,
          source_type,
          source_record_id,
          is_read_only_import
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
        ON CONFLICT (id) DO NOTHING
      `,
      [
        taskId,
        entry.boardId,
        entry.bucketId,
        entry.parentTaskId,
        entry.task.title,
        entry.task.summary,
        entry.task.nextAction ?? "",
        legacyNoteText,
        entry.task.status,
        entry.task.color,
        entry.task.icon,
        entry.task.startAt ?? null,
        entry.task.endAt ?? null,
        entry.task.dueAt ?? null,
        entry.sortOrder,
        entry.task.importedFrom ? entry.task.importedFrom.source : "native",
        entry.task.importedFrom ? entry.task.id : null,
        Boolean(entry.task.importedFrom?.readOnly),
      ],
    );

    if (!entry.parentTaskId) {
      await mirrorTaskSummaryToPrimaryNote(client, entry.boardId, taskId, entry.task.summary, boardOwnerId);
    }

    for (const note of entry.task.notes) {
      await client.query(
        `
          INSERT INTO task_notes (id, board_id, task_id, body, note_type, created_by_user_id, created_at)
          VALUES ($1, $2, $3, $4, 'working', $5, $6)
          ON CONFLICT (id) DO NOTHING
        `,
        [
          stableUuid(`${entry.boardId}:task-note:${note.id}`),
          entry.boardId,
          taskId,
          note.body,
          boardOwnerId,
          note.createdAt,
        ],
      );
    }

    for (const [checklistIndex, checklistItem] of entry.task.checklist.entries()) {
      await client.query(
        `
          INSERT INTO checklist_items (id, task_id, label, is_done, sort_order)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (id) DO NOTHING
        `,
        [
          stableUuid(`${entry.boardId}:checklist:${checklistItem.id}`),
          taskId,
          checklistItem.label,
          checklistItem.done,
          (checklistIndex + 1) * 1000,
        ],
      );
    }

    for (const label of entry.task.labels) {
      let labelId = labelMap.get(label);

      if (!labelId) {
        labelId = stableUuid(`${boardId}:label:${label}`);
        labelMap.set(label, labelId);

        await client.query(
          `
            INSERT INTO labels (id, board_id, name)
            VALUES ($1, $2, $3)
            ON CONFLICT (id) DO NOTHING
          `,
          [labelId, boardId, label],
        );
      }

      await client.query(
        `
          INSERT INTO task_labels (task_id, label_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `,
        [taskId, labelId],
      );
    }
  }
}

function collectTasks(
  target: Array<{
    task: Task;
    boardId: string;
    bucketId: string;
    parentTaskId: string | null;
    sortOrder: number;
  }>,
  tasks: Task[],
  boardId: string,
  bucketId: string,
  parentTaskId: string | null,
) {
  for (const [index, task] of tasks.entries()) {
    const taskId = stableUuid(`${boardId}:task:${task.id}`);

    target.push({
      task,
      boardId,
      bucketId,
      parentTaskId,
      sortOrder: (index + 1) * 1000,
    });

    if (task.subtasks.length > 0) {
      collectTasks(target, task.subtasks, boardId, bucketId, taskId);
    }
  }
}

function mapViewPresetRow(row: DbViewPresetRow): ViewPreset {
  return {
    id: row.id,
    name: row.name,
    layoutMode: layoutModes.has(row.layout_mode) ? row.layout_mode : "board",
    filters: normalizeViewFilters(row.filters ?? {}),
    hiddenFields: Array.isArray(row.hidden_fields) ? row.hidden_fields.map(String) : [],
    displayOptions:
      row.display_options && typeof row.display_options === "object"
        ? row.display_options
        : {},
  };
}

function requireNonEmptyString(value: string, fieldName: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    throw new Error(`${fieldName} must not be empty.`);
  }

  return trimmed;
}

function requireColor(value: string) {
  if (!colorPattern.test(value)) {
    throw new Error("color must be a hex color.");
  }

  return value;
}

function requireTaskStatus(value: string): TaskStatus {
  if (!taskStatuses.has(value as TaskStatus)) {
    throw new Error("Invalid task status.");
  }

  return value as TaskStatus;
}

function requireTaskIcon(value: string): TaskIcon {
  if (!taskIcons.has(value as TaskIcon)) {
    throw new Error("Invalid task icon.");
  }

  return value as TaskIcon;
}

function requireBucketIcon(value: string): BucketIcon {
  if (!bucketIcons.has(value as BucketIcon)) {
    throw new Error("Invalid bucket icon.");
  }

  return value as BucketIcon;
}

function requireLayoutMode(value: string): ViewLayoutMode {
  if (!layoutModes.has(value as ViewLayoutMode)) {
    throw new Error("Invalid layout mode.");
  }

  return value as ViewLayoutMode;
}

function requireDateOrNull(value: string | null) {
  if (value === null) {
    return null;
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date.");
  }

  return date.toISOString();
}

function requireTaskRecurrenceRuleOrNull(value: unknown): TaskRecurrenceRule | null {
  if (value === null) {
    return null;
  }

  const parsed = parseTaskRecurrenceRule(value);
  if (!parsed) {
    throw new Error("Invalid recurrence rule.");
  }

  return parsed;
}

function requireReminderOffsetOrNull(value: number | null) {
  if (value === null) {
    return null;
  }

  const numeric = Math.trunc(Number(value));
  if (!Number.isFinite(numeric) || !reminderOffsets.has(numeric)) {
    throw new Error("Invalid reminder offset.");
  }

  return numeric;
}

function normalizeLabels(labels: string[]) {
  return Array.from(
    new Set(labels.map((label) => label.trim()).filter(Boolean)),
  ).slice(0, 20);
}

function normalizeViewFilters(filters: ViewFilters): ViewFilters {
  const normalized: ViewFilters = {};

  if (Array.isArray(filters.statuses)) {
    normalized.statuses = filters.statuses.filter((status) => taskStatuses.has(status));
  }

  if (Array.isArray(filters.labels)) {
    normalized.labels = normalizeLabels(filters.labels);
  }

  if (
    filters.due === "any" ||
    filters.due === "with" ||
    filters.due === "without" ||
    filters.due === "overdue" ||
    filters.due === "today" ||
    filters.due === "week"
  ) {
    normalized.due = filters.due;
  }

  if (filters.source === "all" || filters.source === "native" || filters.source === "imported") {
    normalized.source = filters.source;
  }

  if (Array.isArray(filters.bucketIds)) {
    normalized.bucketIds = Array.from(
      new Set(filters.bucketIds.map((bucketId) => bucketId.trim()).filter(Boolean)),
    );
  }

  return normalized;
}

export async function recycleCreatedTaskInTransaction(client: PoolClient, boardId: string, taskId: string, userId: string) {
  const task = await getTaskRecordForDelete(client, boardId, taskId);
  if (!task || task.deleted_at) throw new Error("Created task is unavailable for undo.");
  const archived=(await client.query<{archive_original_bucket_id:string|null; archive_original_bucket_title:string|null}>("SELECT archive_original_bucket_id,archive_original_bucket_title FROM tasks WHERE id=$1 AND board_id=$2",[taskId,boardId])).rows[0];
  await recycleTaskTree(client, { boardId, taskId, deletedByUserId: userId,
    originalBucketId: task.bucket_id ?? archived.archive_original_bucket_id,
    originalBucketTitle: task.bucket_title ?? archived.archive_original_bucket_title, keepPlacement: Boolean(task.parent_task_id) });
}

// Shared native checklist command used by the UI and confirmed board batches.
export async function mutateChecklistInTransaction(client:PoolClient,boardId:string,change:{op:'create'|'update'|'delete';taskId?:string;itemId?:string;label?:string;done?:boolean}) {
 let taskId=change.taskId;
 if(change.op!=='create'){const row=(await client.query<{task_id:string}>('SELECT c.task_id FROM checklist_items c JOIN tasks t ON t.id=c.task_id WHERE c.id=$1 AND t.board_id=$2',[change.itemId,boardId])).rows[0];if(!row || taskId && taskId!==row.task_id)throw new Error('Checklist item not found.');taskId=row.task_id;}
 if(!taskId)throw new Error('Task not found.');await lockLiveTask(client,boardId,taskId);
 if(change.op==='create'){await assertTaskCanHoldDetail(client,boardId,taskId);const id=mutationUUID();await client.query('INSERT INTO checklist_items(id,task_id,label,is_done,sort_order) SELECT $1,$2,$3,$4,COALESCE(MAX(sort_order),0)+1000 FROM checklist_items WHERE task_id=$2',[id,taskId,requireNonEmptyString(change.label ?? '', 'label'),change.done ?? false]);return id;}
 if(change.op==='delete'){await client.query('DELETE FROM checklist_items WHERE id=$1 AND task_id=$2',[change.itemId,taskId]);return;}
 if(change.label===undefined && change.done===undefined)return;
 await client.query('UPDATE checklist_items SET label=COALESCE($3,label),is_done=COALESCE($4,is_done) WHERE id=$1 AND task_id=$2',[change.itemId,taskId,change.label===undefined ? null : requireNonEmptyString(change.label,'label'),change.done ?? null]);
}
