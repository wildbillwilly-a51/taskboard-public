// FROZEN baseline from production-source 75e8b55 (2026-11-03) and adapted for new public installations.
// Never add DDL here or call mutable schema helpers. Use db/migrations/recorded/.
// Legacy transaction boundaries and data repairs are preserved verbatim.
// The public baseline and its SQL are pinned by the migration ledger.
import type { PoolClient } from "pg";
import { readFile } from "node:fs/promises";
import path from "node:path";

export async function applyFrozenBaseline(client: PoolClient) {
  const result = await client.query<{ exists: string | null }>(
    `SELECT to_regclass('public.boards') AS exists`,
  );
  if (!result.rows[0]?.exists) {
    await client.query(await readFile(path.join(process.cwd(), "db/baseline/schema.sql"), "utf8"));
  }
  await runMigrations(client);
}

const legacyOwnerEmail = "owner@taskboard.local";
const legacyOwnerDisplayName = "Taskboard Owner";
const defaultReservedLocalAdminUsername = "admin";
const fallbackReservedLocalAdminUsername = "taskboard-admin";

async function migrateLegacyOwnerToReservedLocalAdmin(client: PoolClient) {
  await client.query("BEGIN");

  try {
    const ownerResult = await client.query<{ id: string; username: string | null }>(
      `
        SELECT id, username
        FROM users
        WHERE email = $1
        LIMIT 1
      `,
      [legacyOwnerEmail],
    );
    const owner = ownerResult.rows[0];

    if (!owner) {
      await client.query("COMMIT");
      return;
    }

    const usernameResult = await client.query<{ username: string }>(
      `
        SELECT username
        FROM users
        WHERE username IN ($1, $2) AND id <> $3
      `,
      [defaultReservedLocalAdminUsername, fallbackReservedLocalAdminUsername, owner.id],
    );
    const occupiedUsernames = new Set(usernameResult.rows.map((row) => row.username));
    const username =
      owner.username ||
      (occupiedUsernames.has(defaultReservedLocalAdminUsername)
        ? fallbackReservedLocalAdminUsername
        : defaultReservedLocalAdminUsername);

    if (occupiedUsernames.has(username)) {
      throw new Error(`Reserved local admin username '${username}' is already in use.`);
    }

    await client.query(
      `
        UPDATE users
        SET
          username = COALESCE(username, $2),
          display_name = COALESCE(NULLIF(display_name, ''), $3),
          role = 'admin',
          auth_provider = 'local',
          is_reserved_local_admin = TRUE,
          updated_at = NOW()
        WHERE id = $1
      `,
      [owner.id, username, legacyOwnerDisplayName],
    );

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function runMigrations(client: PoolClient) {
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS username TEXT`);
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'standard'`);
  await client.query(`UPDATE users SET role = 'standard' WHERE role IS NULL OR role NOT IN ('standard', 'manager', 'admin')`);
  await client.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check`);
  await client.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('standard', 'manager', 'admin'))`);
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_disabled BOOLEAN NOT NULL DEFAULT FALSE`);
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS is_reserved_local_admin BOOLEAN NOT NULL DEFAULT FALSE`);
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS local_password_hash TEXT`);
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS auth_provider TEXT NOT NULL DEFAULT 'authelia'`);
  await client.query(`UPDATE users SET auth_provider = 'authelia' WHERE auth_provider IS NULL OR auth_provider NOT IN ('local', 'authelia')`);
  await client.query(`ALTER TABLE users DROP CONSTRAINT IF EXISTS users_auth_provider_check`);
  await client.query(`ALTER TABLE users ADD CONSTRAINT users_auth_provider_check CHECK (auth_provider IN ('local', 'authelia'))`);
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS last_selected_board_id UUID`);
  await client.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_username_unique
    ON users (username)
    WHERE username IS NOT NULL
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS users_reserved_local_admin_unique
    ON users ((is_reserved_local_admin))
    WHERE is_reserved_local_admin = TRUE
  `);
  await migrateLegacyOwnerToReservedLocalAdmin(client);

  await client.query(`
    CREATE TABLE IF NOT EXISTS teams (
      id UUID PRIMARY KEY,
      name TEXT NOT NULL CHECK (BTRIM(name) <> ''),
      description TEXT NOT NULL DEFAULT '',
      personal_board_view_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      archived_at TIMESTAMPTZ,
      archived_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`ALTER TABLE teams ADD COLUMN IF NOT EXISTS personal_board_view_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
  await client.query(`UPDATE teams SET personal_board_view_enabled = FALSE WHERE personal_board_view_enabled IS NULL`);
  await client.query(`ALTER TABLE teams ALTER COLUMN personal_board_view_enabled SET DEFAULT FALSE`);
  await client.query(`ALTER TABLE teams ALTER COLUMN personal_board_view_enabled SET NOT NULL`);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS teams_active_name_unique
    ON teams (LOWER(BTRIM(name)))
    WHERE archived_at IS NULL
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS team_members (
      team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK (role IN ('manager', 'member')),
      added_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (team_id, user_id)
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS team_members_user_id_idx
    ON team_members (user_id)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS team_members_team_role_idx
    ON team_members (team_id, role)
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS app_permission_settings (
      id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
      same_team_personal_board_visibility_allowed BOOLEAN NOT NULL DEFAULT FALSE,
      default_personal_board_visibility TEXT NOT NULL DEFAULT 'private',
      managers_can_configure_team_personal_board_visibility BOOLEAN NOT NULL DEFAULT FALSE,
      users_can_make_boards_private BOOLEAN NOT NULL DEFAULT TRUE,
      admins_can_view_private_boards BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    ALTER TABLE app_permission_settings
      ADD COLUMN IF NOT EXISTS same_team_personal_board_visibility_allowed BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS default_personal_board_visibility TEXT NOT NULL DEFAULT 'private',
      ADD COLUMN IF NOT EXISTS managers_can_configure_team_personal_board_visibility BOOLEAN NOT NULL DEFAULT FALSE,
      ADD COLUMN IF NOT EXISTS users_can_make_boards_private BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS admins_can_view_private_boards BOOLEAN NOT NULL DEFAULT TRUE,
      ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);
  await client.query(`
    INSERT INTO app_permission_settings (id)
    VALUES (1)
    ON CONFLICT (id) DO NOTHING
  `);
  await client.query(`DELETE FROM app_permission_settings WHERE id <> 1`);
  await client.query(`
    UPDATE app_permission_settings
    SET
      same_team_personal_board_visibility_allowed = COALESCE(same_team_personal_board_visibility_allowed, FALSE),
      default_personal_board_visibility = CASE
        WHEN default_personal_board_visibility IN ('private', 'team_visible') THEN default_personal_board_visibility
        ELSE 'private'
      END,
      managers_can_configure_team_personal_board_visibility = COALESCE(managers_can_configure_team_personal_board_visibility, FALSE),
      users_can_make_boards_private = COALESCE(users_can_make_boards_private, TRUE),
      admins_can_view_private_boards = COALESCE(admins_can_view_private_boards, TRUE),
      created_at = COALESCE(created_at, NOW()),
      updated_at = COALESCE(updated_at, NOW())
  `);
  await client.query(`
    ALTER TABLE app_permission_settings
      DROP CONSTRAINT IF EXISTS app_permission_settings_id_check,
      ADD CONSTRAINT app_permission_settings_id_check CHECK (id = 1),
      DROP CONSTRAINT IF EXISTS app_permission_settings_default_personal_board_visibility_check,
      ADD CONSTRAINT app_permission_settings_default_personal_board_visibility_check CHECK (default_personal_board_visibility IN ('private', 'team_visible')),
      ALTER COLUMN same_team_personal_board_visibility_allowed SET DEFAULT FALSE,
      ALTER COLUMN same_team_personal_board_visibility_allowed SET NOT NULL,
      ALTER COLUMN default_personal_board_visibility SET DEFAULT 'private',
      ALTER COLUMN default_personal_board_visibility SET NOT NULL,
      ALTER COLUMN managers_can_configure_team_personal_board_visibility SET DEFAULT FALSE,
      ALTER COLUMN managers_can_configure_team_personal_board_visibility SET NOT NULL,
      ALTER COLUMN users_can_make_boards_private SET DEFAULT TRUE,
      ALTER COLUMN users_can_make_boards_private SET NOT NULL,
      ALTER COLUMN admins_can_view_private_boards SET DEFAULT TRUE,
      ALTER COLUMN admins_can_view_private_boards SET NOT NULL,
      ALTER COLUMN created_at SET DEFAULT NOW(),
      ALTER COLUMN created_at SET NOT NULL,
      ALTER COLUMN updated_at SET DEFAULT NOW(),
      ALTER COLUMN updated_at SET NOT NULL
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS admin_audit_events (
      id UUID PRIMARY KEY,
      actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      target_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
      action TEXT NOT NULL CHECK (action <> ''),
      previous_values JSONB NOT NULL DEFAULT '{}'::jsonb,
      new_values JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    ALTER TABLE admin_audit_events
    ADD COLUMN IF NOT EXISTS target_team_id UUID REFERENCES teams(id) ON DELETE SET NULL
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS admin_audit_events_actor_user_id_idx
    ON admin_audit_events (actor_user_id)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS admin_audit_events_target_user_id_idx
    ON admin_audit_events (target_user_id)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS admin_audit_events_target_team_id_idx
    ON admin_audit_events (target_team_id)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS admin_audit_events_created_at_idx
    ON admin_audit_events (created_at DESC)
  `);
  await client.query(`ALTER TABLE boards ADD COLUMN IF NOT EXISTS board_type TEXT NOT NULL DEFAULT 'personal'`);
  await client.query(`UPDATE boards SET board_type = 'personal' WHERE board_type IS NULL OR board_type NOT IN ('personal', 'team')`);
  await client.query(`ALTER TABLE boards DROP CONSTRAINT IF EXISTS boards_board_type_check`);
  await client.query(`ALTER TABLE boards ADD CONSTRAINT boards_board_type_check CHECK (board_type IN ('personal', 'team'))`);
  await client.query(`ALTER TABLE boards ADD COLUMN IF NOT EXISTS owner_team_id UUID REFERENCES teams(id) ON DELETE RESTRICT`);
  await client.query(`ALTER TABLE boards ADD COLUMN IF NOT EXISTS team_member_default_access TEXT`);
  await client.query(`UPDATE boards SET team_member_default_access = NULL WHERE board_type = 'personal'`);
  await client.query(`ALTER TABLE boards DROP CONSTRAINT IF EXISTS boards_team_member_default_access_check`);
  await client.query(`ALTER TABLE boards ADD CONSTRAINT boards_team_member_default_access_check CHECK (team_member_default_access IN ('viewer', 'editor'))`);
  await client.query(`ALTER TABLE boards ADD COLUMN IF NOT EXISTS personal_visibility TEXT`);
  await client.query(`ALTER TABLE boards ADD COLUMN IF NOT EXISTS personal_visibility_team_id UUID REFERENCES teams(id) ON DELETE SET NULL`);
  await client.query(`
    UPDATE boards
    SET personal_visibility = 'private',
        personal_visibility_team_id = NULL
    WHERE board_type = 'personal'
      AND (
        personal_visibility IS NULL
        OR personal_visibility NOT IN ('private', 'team_visible')
        OR (personal_visibility = 'private' AND personal_visibility_team_id IS NOT NULL)
        OR (personal_visibility = 'team_visible' AND personal_visibility_team_id IS NULL)
      )
  `);
  await client.query(`
    UPDATE boards
    SET personal_visibility = NULL,
        personal_visibility_team_id = NULL
    WHERE board_type = 'team'
  `);
  await client.query(`ALTER TABLE boards DROP CONSTRAINT IF EXISTS boards_personal_visibility_check`);
  await client.query(`ALTER TABLE boards ADD CONSTRAINT boards_personal_visibility_check CHECK (personal_visibility IN ('private', 'team_visible'))`);
  await client.query(`ALTER TABLE boards ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE boards ADD COLUMN IF NOT EXISTS updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL`);
  await client.query(`
    UPDATE boards
    SET created_by_user_id = owner_user_id
    WHERE created_by_user_id IS NULL
      AND owner_user_id IS NOT NULL
  `);
  await client.query(`ALTER TABLE boards ALTER COLUMN owner_user_id DROP NOT NULL`);
  await client.query(`ALTER TABLE boards DROP CONSTRAINT IF EXISTS boards_ownership_shape_check`);
  await client.query(`
    ALTER TABLE boards
    ADD CONSTRAINT boards_ownership_shape_check
    CHECK (
      (
        board_type = 'personal'
        AND owner_user_id IS NOT NULL
        AND owner_team_id IS NULL
        AND team_member_default_access IS NULL
        AND personal_visibility IN ('private', 'team_visible')
        AND (
          (personal_visibility = 'private' AND personal_visibility_team_id IS NULL)
          OR
          (personal_visibility = 'team_visible' AND personal_visibility_team_id IS NOT NULL)
        )
      )
      OR
      (
        board_type = 'team'
        AND owner_team_id IS NOT NULL
        AND team_member_default_access IS NOT NULL
        AND personal_visibility IS NULL
        AND personal_visibility_team_id IS NULL
      )
    )
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS boards_owner_team_id_idx
    ON boards (owner_team_id)
    WHERE owner_team_id IS NOT NULL
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS boards_board_type_idx
    ON boards (board_type)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS boards_personal_visibility_team_id_idx
    ON boards (personal_visibility_team_id)
    WHERE personal_visibility_team_id IS NOT NULL
  `);
  await client.query(`
    UPDATE users
    SET last_selected_board_id = NULL
    WHERE last_selected_board_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM boards
        WHERE boards.id = users.last_selected_board_id
      )
  `);
  await client.query(`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_constraint
        WHERE conname = 'users_last_selected_board_id_fkey'
          AND conrelid = 'users'::regclass
      ) THEN
        ALTER TABLE users
          ADD CONSTRAINT users_last_selected_board_id_fkey
          FOREIGN KEY (last_selected_board_id) REFERENCES boards(id) ON DELETE SET NULL;
      END IF;
    END $$
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS board_members_user_id_board_id_idx
    ON board_members (user_id, board_id)
  `);
  await client.query(`
    ALTER TABLE board_members
    ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);
  await client.query(`
    ALTER TABLE board_members
    ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  `);
  await client.query(`
    ALTER TABLE admin_audit_events
    ADD COLUMN IF NOT EXISTS target_board_id UUID REFERENCES boards(id) ON DELETE SET NULL
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS admin_audit_events_target_board_id_idx
    ON admin_audit_events (target_board_id)
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS view_presets (
      id UUID PRIMARY KEY,
      board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      layout_mode TEXT NOT NULL CHECK (layout_mode IN ('board', 'agenda', 'focus', 'list')),
      filters JSONB NOT NULL DEFAULT '{}'::jsonb,
      hidden_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
      display_options JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS calendar_accounts (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      provider TEXT NOT NULL CHECK (provider IN ('google')),
      external_account_id TEXT NOT NULL,
      access_token_encrypted TEXT,
      refresh_token_encrypted TEXT,
      sync_cursor TEXT,
      last_synced_at TIMESTAMPTZ
    )
  `);

  await client.query(`
    CREATE TABLE IF NOT EXISTS imported_events (
      id UUID PRIMARY KEY,
      board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      calendar_account_id UUID REFERENCES calendar_accounts(id) ON DELETE SET NULL,
      task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
      provider TEXT NOT NULL CHECK (provider IN ('google', 'ics', 'manual')),
      external_event_id TEXT,
      title TEXT NOT NULL,
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      location TEXT NOT NULL DEFAULT '',
      raw_payload JSONB,
      sync_status TEXT NOT NULL DEFAULT 'active' CHECK (sync_status IN ('active', 'deleted', 'stale')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS calendar_entries (
      id UUID PRIMARY KEY,
      board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      title TEXT NOT NULL CHECK (BTRIM(title) <> ''),
      starts_at TIMESTAMPTZ NOT NULL,
      ends_at TIMESTAMPTZ NOT NULL,
      all_day BOOLEAN NOT NULL DEFAULT FALSE,
      location TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      color TEXT NOT NULL DEFAULT '#14b8a6',
      linked_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
      deleted_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`ALTER TABLE calendar_entries ADD COLUMN IF NOT EXISTS created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE calendar_entries ADD COLUMN IF NOT EXISTS updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE calendar_entries ADD COLUMN IF NOT EXISTS all_day BOOLEAN NOT NULL DEFAULT FALSE`);
  await client.query(`ALTER TABLE calendar_entries ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT ''`);
  await client.query(`ALTER TABLE calendar_entries ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`);
  await client.query(`ALTER TABLE calendar_entries ADD COLUMN IF NOT EXISTS color TEXT NOT NULL DEFAULT '#14b8a6'`);
  await client.query(`ALTER TABLE calendar_entries ADD COLUMN IF NOT EXISTS linked_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE calendar_entries ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE calendar_entries ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await client.query(`ALTER TABLE calendar_entries ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await client.query(`ALTER TABLE calendar_entries DROP CONSTRAINT IF EXISTS calendar_entries_time_order_check`);
  await client.query(`ALTER TABLE calendar_entries ADD CONSTRAINT calendar_entries_time_order_check CHECK (ends_at > starts_at)`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS task_notes (
      id UUID PRIMARY KEY,
      board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      note_type TEXT NOT NULL DEFAULT 'working' CHECK (note_type IN ('primary', 'working')),
      created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      deleted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS task_attachments (
      id UUID PRIMARY KEY,
      task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      note_id UUID REFERENCES task_notes(id) ON DELETE SET NULL,
      uploaded_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      original_name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      stored_name TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS task_notifications (
      id UUID PRIMARY KEY,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      kind TEXT NOT NULL CHECK (kind IN ('scheduled', 'overdue')),
      due_at_snapshot TIMESTAMPTZ NOT NULL,
      trigger_at TIMESTAMPTZ NOT NULL,
      title_snapshot TEXT NOT NULL,
      read_at TIMESTAMPTZ,
      dismissed_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);





  await client.query(`ALTER TABLE boards ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT ''`);
  await client.query(`ALTER TABLE boards ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await client.query(`ALTER TABLE buckets ADD COLUMN IF NOT EXISTS color TEXT`);
  await client.query(`ALTER TABLE buckets ADD COLUMN IF NOT EXISTS icon TEXT`);
  await client.query(`ALTER TABLE buckets ADD COLUMN IF NOT EXISTS is_collapsed BOOLEAN NOT NULL DEFAULT FALSE`);
  await client.query(`ALTER TABLE buckets ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT ''`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS task_notes (
      id UUID PRIMARY KEY,
      board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      body TEXT NOT NULL,
      note_type TEXT NOT NULL DEFAULT 'working' CHECK (note_type IN ('primary', 'working')),
      created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      deleted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ
    )
  `);
  await client.query(`ALTER TABLE task_notes ADD COLUMN IF NOT EXISTS note_type TEXT NOT NULL DEFAULT 'working'`);
  await client.query(`ALTER TABLE task_notes ALTER COLUMN note_type SET DEFAULT 'working'`);
  await client.query(`UPDATE task_notes SET note_type = 'working' WHERE note_type IS NULL OR note_type NOT IN ('primary', 'working')`);
  await client.query(`ALTER TABLE task_notes ALTER COLUMN note_type SET NOT NULL`);
  await client.query(`ALTER TABLE task_notes DROP CONSTRAINT IF EXISTS task_notes_note_type_check`);
  await client.query(`ALTER TABLE task_notes ADD CONSTRAINT task_notes_note_type_check CHECK (note_type IN ('primary', 'working'))`);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS next_action TEXT NOT NULL DEFAULT ''`);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS color TEXT`);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS icon TEXT`);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS due_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS start_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS end_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS all_day BOOLEAN NOT NULL DEFAULT FALSE`);
  await client.query(`
    UPDATE tasks
    SET end_at = due_at
    WHERE end_at IS NULL
      AND start_at IS NOT NULL
      AND due_at IS NOT NULL
      AND due_at > start_at
  `);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_rule JSONB`);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recurrence_series_id UUID`);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reminder_offset_minutes INTEGER`);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS overdue_reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE`);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_type TEXT`);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS source_record_id TEXT`);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS is_read_only_import BOOLEAN NOT NULL DEFAULT FALSE`);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS work_item_type TEXT NOT NULL DEFAULT 'task'`);
  await client.query(`ALTER TABLE tasks DROP CONSTRAINT IF EXISTS tasks_work_item_type_check`);
  await client.query(`ALTER TABLE tasks ADD CONSTRAINT tasks_work_item_type_check CHECK (work_item_type IN ('task', 'maintenance_outage'))`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS maintenance_locations (
      id UUID PRIMARY KEY,
      board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK (BTRIM(name) <> ''),
      sort_order NUMERIC(20,10) NOT NULL DEFAULT 1000,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS maintenance_outages (
      task_id UUID PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
      board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
      location_id UUID REFERENCES maintenance_locations(id) ON DELETE SET NULL,
      owner_name TEXT NOT NULL DEFAULT '',
      attendees JSONB NOT NULL DEFAULT '[]'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT maintenance_outages_attendees_array_check CHECK (jsonb_typeof(attendees) = 'array')
    )
  `);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archive_original_bucket_id UUID`);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archive_original_bucket_title TEXT`);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archive_archived_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS purge_after_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recycle_original_bucket_id UUID`);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recycle_original_bucket_title TEXT`);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recycle_deleted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS recycle_group_id UUID`);
  // The status a parent had when its work finished it, restored if that work
  // reopens. Empty for everything else.
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS reopen_status TEXT`);
  await client.query(`
    DO $$ BEGIN
      ALTER TABLE tasks ADD CONSTRAINT tasks_reopen_status_check CHECK (reopen_status IN ('todo', 'active', 'waiting'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$`);
  // Why a top-level task is archived: finishing a recurring occurrence, or a
  // person archiving it. Empty for archives made before this was recorded.
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS archive_reason TEXT`);
  await client.query(`
    DO $$ BEGIN
      ALTER TABLE tasks ADD CONSTRAINT tasks_archive_reason_check CHECK (archive_reason IN ('manual', 'recurring_completion'));
    EXCEPTION WHEN duplicate_object THEN NULL;
    END $$`);
  // Deletes made before recycle groups existed: each deleted top-level task and
  // the work deleted with it form one group.
  await client.query(`
    WITH RECURSIVE roots AS (
      SELECT id, deleted_at, gen_random_uuid() AS group_id
      FROM tasks
      WHERE parent_task_id IS NULL AND deleted_at IS NOT NULL AND recycle_group_id IS NULL
    ),
    tree AS (
      SELECT id, deleted_at, group_id FROM roots
      UNION ALL
      SELECT child.id, tree.deleted_at, tree.group_id
      FROM tasks child INNER JOIN tree ON child.parent_task_id = tree.id
      WHERE child.deleted_at = tree.deleted_at AND child.recycle_group_id IS NULL
    )
    UPDATE tasks SET recycle_group_id = tree.group_id FROM tree WHERE tasks.id = tree.id
  `);
  await client.query(`CREATE INDEX IF NOT EXISTS tasks_recycle_group_idx ON tasks (board_id, recycle_group_id) WHERE recycle_group_id IS NOT NULL`);
  await client.query(`ALTER TABLE tasks ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await client.query(`UPDATE tasks SET completed_at = COALESCE(completed_at, updated_at, created_at, NOW()) WHERE status = 'done' AND completed_at IS NULL`);
  await client.query(`UPDATE tasks SET completed_at = NULL WHERE status <> 'done' AND completed_at IS NOT NULL`);
  await client.query(`ALTER TABLE imported_events ADD COLUMN IF NOT EXISTS calendar_account_id UUID REFERENCES calendar_accounts(id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE imported_events ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES tasks(id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE imported_events ADD COLUMN IF NOT EXISTS external_event_id TEXT`);
  await client.query(`ALTER TABLE imported_events ADD COLUMN IF NOT EXISTS location TEXT NOT NULL DEFAULT ''`);
  await client.query(`ALTER TABLE imported_events ADD COLUMN IF NOT EXISTS raw_payload JSONB`);
  await client.query(`ALTER TABLE imported_events ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'active'`);
  await client.query(`ALTER TABLE imported_events ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await client.query(`ALTER TABLE task_attachments ADD COLUMN IF NOT EXISTS uploaded_by_user_id UUID REFERENCES users(id) ON DELETE CASCADE`);
  await client.query(`ALTER TABLE task_attachments ADD COLUMN IF NOT EXISTS note_id UUID REFERENCES task_notes(id) ON DELETE SET NULL`);
  await client.query(`ALTER TABLE task_attachments ADD COLUMN IF NOT EXISTS original_name TEXT NOT NULL DEFAULT 'attachment'`);
  await client.query(`ALTER TABLE task_attachments ADD COLUMN IF NOT EXISTS display_name TEXT NOT NULL DEFAULT ''`);
  await client.query(`ALTER TABLE task_attachments ADD COLUMN IF NOT EXISTS stored_name TEXT NOT NULL DEFAULT ''`);
  await client.query(`ALTER TABLE task_attachments ADD COLUMN IF NOT EXISTS mime_type TEXT NOT NULL DEFAULT 'application/octet-stream'`);
  await client.query(`ALTER TABLE task_attachments ADD COLUMN IF NOT EXISTS size_bytes BIGINT NOT NULL DEFAULT 0`);
  await client.query(`ALTER TABLE task_attachments ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await client.query(`ALTER TABLE task_notifications ADD COLUMN IF NOT EXISTS read_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE task_notifications ADD COLUMN IF NOT EXISTS dismissed_at TIMESTAMPTZ`);
  await client.query(`ALTER TABLE task_notifications ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
  await client.query(`
    UPDATE task_attachments
    SET display_name = original_name
    WHERE BTRIM(display_name) = ''
  `);
  await client.query(`
    WITH ranked_primary_notes AS (
      SELECT
        id,
        ROW_NUMBER() OVER (
          PARTITION BY task_id
          ORDER BY created_at ASC, id ASC
        ) AS primary_rank
      FROM task_notes
      WHERE deleted_at IS NULL
        AND note_type = 'primary'
    )
    UPDATE task_notes
    SET note_type = 'working',
        updated_at = COALESCE(updated_at, NOW())
    FROM ranked_primary_notes
    WHERE task_notes.id = ranked_primary_notes.id
      AND ranked_primary_notes.primary_rank > 1
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS task_notes_active_primary_idx
    ON task_notes (task_id)
    WHERE deleted_at IS NULL AND note_type = 'primary'
  `);
  await client.query(`
    INSERT INTO task_notes (id, board_id, task_id, body, note_type, created_by_user_id, created_at)
    SELECT
      (
        SUBSTR(MD5('legacy-task-note:' || tasks.id::text), 1, 8) || '-' ||
        SUBSTR(MD5('legacy-task-note:' || tasks.id::text), 9, 4) || '-' ||
        SUBSTR(MD5('legacy-task-note:' || tasks.id::text), 13, 4) || '-' ||
        SUBSTR(MD5('legacy-task-note:' || tasks.id::text), 17, 4) || '-' ||
        SUBSTR(MD5('legacy-task-note:' || tasks.id::text), 21, 12)
      )::uuid,
      tasks.board_id,
      tasks.id,
      BTRIM(tasks.notes),
      'working',
      boards.owner_user_id,
      COALESCE(tasks.created_at, NOW())
    FROM tasks
    INNER JOIN boards ON boards.id = tasks.board_id
    WHERE BTRIM(tasks.notes) <> ''
      AND NOT EXISTS (
        SELECT 1
        FROM task_notes
        WHERE task_notes.task_id = tasks.id
          AND task_notes.note_type = 'working'
      )
  `);
  await client.query(`
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
      boards.owner_user_id,
      COALESCE(tasks.created_at, NOW())
    FROM tasks
    INNER JOIN boards ON boards.id = tasks.board_id
    WHERE tasks.deleted_at IS NULL
      AND tasks.archived_at IS NULL
      AND NOT EXISTS (
        SELECT 1
        FROM task_notes
        WHERE task_notes.task_id = tasks.id
          AND task_notes.note_type = 'primary'
          AND task_notes.deleted_at IS NULL
      )
    ON CONFLICT DO NOTHING
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS imported_events_board_provider_external_idx
    ON imported_events (board_id, provider, external_event_id)
    WHERE external_event_id IS NOT NULL
  `);
  await client.query(`DROP INDEX IF EXISTS task_notes_task_created_idx`);
  await client.query(`
    CREATE INDEX IF NOT EXISTS task_notes_task_created_idx
    ON task_notes (task_id, created_at DESC, id DESC)
    WHERE deleted_at IS NULL
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS task_attachments_stored_name_idx
    ON task_attachments (stored_name)
    WHERE stored_name <> ''
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS task_attachments_task_created_idx
    ON task_attachments (task_id, created_at ASC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS task_attachments_board_task_idx
    ON task_attachments (board_id, task_id)
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS task_notifications_task_kind_due_idx
    ON task_notifications (task_id, kind, due_at_snapshot)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS task_notifications_user_active_idx
    ON task_notifications (user_id, dismissed_at, read_at, trigger_at DESC)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS tasks_board_source_record_idx
    ON tasks (board_id, source_type, source_record_id)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS tasks_board_work_item_type_idx
    ON tasks (board_id, work_item_type)
    WHERE deleted_at IS NULL AND archived_at IS NULL
  `);
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS maintenance_locations_board_name_idx
    ON maintenance_locations (board_id, LOWER(name))
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS maintenance_outages_board_idx
    ON maintenance_outages (board_id)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS tasks_board_deleted_root_idx
    ON tasks (board_id, deleted_at, purge_after_at)
    WHERE parent_task_id IS NULL
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS tasks_board_archive_root_idx
    ON tasks (board_id, archived_at DESC)
    WHERE parent_task_id IS NULL AND archived_at IS NOT NULL
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS tasks_board_done_auto_archive_idx
    ON tasks (board_id, completed_at)
    WHERE parent_task_id IS NULL AND status = 'done' AND deleted_at IS NULL AND archived_at IS NULL
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS tasks_board_recurrence_series_idx
    ON tasks (board_id, recurrence_series_id, due_at)
    WHERE recurrence_series_id IS NOT NULL AND deleted_at IS NULL AND archived_at IS NULL
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS calendar_entries_board_starts_idx
    ON calendar_entries (board_id, starts_at)
    WHERE deleted_at IS NULL
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS calendar_entries_board_deleted_idx
    ON calendar_entries (board_id, deleted_at)
  `);
  await client.query(`
    CREATE INDEX IF NOT EXISTS calendar_entries_linked_task_idx
    ON calendar_entries (linked_task_id)
    WHERE linked_task_id IS NOT NULL
  `);
  await ensureNotesSchema(client);
  await ensurePublicTaskShareSchema(client);
  await ensureOutagePeopleSchema(client);
  await ensureBoardRevisionSchema(client);
  await repairParentCompletion(client);
}

const parentCompletionRepairKey = "parent-completion-2026-11";

// One-time repair: parents saved before completion rolled up can disagree
// with their subtasks. Each live parent, deepest first, takes the status its
// live work implies. A recurring top-level task is left alone, nothing is
// archived, and no occurrence is created. Old values are kept for rollback.
async function repairParentCompletion(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS taskboard_data_repairs (
      key TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      details JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  await client.query("BEGIN");

  try {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('taskboard:parent-completion-repair'))`);
    const applied = await client.query(`SELECT 1 FROM taskboard_data_repairs WHERE key = $1`, [parentCompletionRepairKey]);
    if (applied.rows.length > 0) {
      await client.query("COMMIT");
      return;
    }
    // The same root lock task edits take, in a fixed order.
    await client.query(`
      SELECT id FROM tasks root
      WHERE root.parent_task_id IS NULL AND root.deleted_at IS NULL AND root.archived_at IS NULL
        AND EXISTS (SELECT 1 FROM tasks child WHERE child.parent_task_id = root.id)
      ORDER BY root.id
      FOR UPDATE
    `);
    const depthResult = await client.query<{ max_depth: number | null }>(`
      WITH RECURSIVE depths AS (
        SELECT id, 0 AS depth FROM tasks
        WHERE parent_task_id IS NULL AND deleted_at IS NULL AND archived_at IS NULL
        UNION ALL
        SELECT child.id, depths.depth + 1 FROM tasks child
        INNER JOIN depths ON child.parent_task_id = depths.id
        WHERE child.deleted_at IS NULL AND child.archived_at IS NULL
      )
      SELECT MAX(depth) AS max_depth FROM depths
    `);
    const changed: Array<{ id: string; boardId: string; oldStatus: string; oldCompletedAt: string | null; newStatus: string }> = [];
    for (let depth = depthResult.rows[0]?.max_depth ?? -1; depth >= 0; depth -= 1) {
      const result = await client.query<{ id: string; board_id: string; old_status: string; old_completed_at: string | null; new_status: string }>(
        `
          WITH RECURSIVE depths AS (
            SELECT id, 0 AS depth FROM tasks
            WHERE parent_task_id IS NULL AND deleted_at IS NULL AND archived_at IS NULL
            UNION ALL
            SELECT child.id, depths.depth + 1 FROM tasks child
            INNER JOIN depths ON child.parent_task_id = depths.id
            WHERE child.deleted_at IS NULL AND child.archived_at IS NULL
          ),
          target AS (
            SELECT parent.id, parent.status, parent.completed_at,
              NOT EXISTS (
                SELECT 1 FROM tasks child WHERE child.parent_task_id = parent.id
                  AND child.deleted_at IS NULL AND child.archived_at IS NULL AND child.status <> 'done'
              ) AS all_done
            FROM tasks parent
            INNER JOIN depths ON depths.id = parent.id AND depths.depth = $1
            WHERE NOT (parent.parent_task_id IS NULL AND parent.recurrence_rule IS NOT NULL)
              AND EXISTS (
                SELECT 1 FROM tasks child WHERE child.parent_task_id = parent.id
                  AND child.deleted_at IS NULL AND child.archived_at IS NULL
              )
          )
          UPDATE tasks
          SET
            status = CASE WHEN target.all_done THEN 'done' ELSE 'todo' END,
            completed_at = CASE WHEN target.all_done THEN COALESCE(tasks.completed_at, NOW()) ELSE NULL END,
            updated_at = NOW()
          FROM target
          WHERE tasks.id = target.id AND target.all_done <> (target.status = 'done')
          RETURNING tasks.id, tasks.board_id, target.status AS old_status,
            target.completed_at AS old_completed_at, tasks.status AS new_status
        `,
        [depth],
      );
      changed.push(...result.rows.map((row) => ({
        id: row.id,
        boardId: row.board_id,
        oldStatus: row.old_status,
        oldCompletedAt: row.old_completed_at,
        newStatus: row.new_status,
      })));
    }
    await client.query(
      `INSERT INTO taskboard_data_repairs (key, details) VALUES ($1, $2::jsonb)`,
      [parentCompletionRepairKey, JSON.stringify({ changed })],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

// Frozen from notes-schema.ts at 75e8b55.
// Notes tables, applied idempotently on every start by runMigrations.
// db/schema.sql carries the same definitions for a fresh database, and
// db/migrations/20261016_notes.sql records the change.
//
// Fallbacks come from the foreign keys: deleting a bucket clears bucket_id
// (the note moves up to its board), deleting a board clears board_id (the note
// returns to its owner as a personal note). There is deliberately no CHECK
// tying bucket_id to board_id, because Postgres may apply the two SET NULL
// actions of a board deletion in either order; the store keeps them
// consistent instead.
export const notesSchemaStatements = [
  `
    CREATE TABLE IF NOT EXISTS note_notebooks (
      id UUID PRIMARY KEY,
      owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      parent_notebook_id UUID REFERENCES note_notebooks(id) ON DELETE SET NULL,
      title TEXT NOT NULL CHECK (BTRIM(title) <> ''),
      sort_order NUMERIC(20,10) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS note_notebooks_owner_parent_idx
      ON note_notebooks (owner_user_id, parent_notebook_id, sort_order)
  `,
  `
    CREATE TABLE IF NOT EXISTS notes (
      id UUID PRIMARY KEY,
      owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      board_id UUID REFERENCES boards(id) ON DELETE SET NULL,
      bucket_id UUID REFERENCES buckets(id) ON DELETE SET NULL,
      notebook_id UUID REFERENCES note_notebooks(id) ON DELETE SET NULL,
      title TEXT NOT NULL DEFAULT '',
      content_json JSONB NOT NULL DEFAULT '[]'::jsonb,
      content_markdown TEXT NOT NULL DEFAULT '',
      content_text TEXT NOT NULL DEFAULT '',
      search_vector TSVECTOR GENERATED ALWAYS AS (
        to_tsvector('simple'::regconfig, title || ' ' || content_text)
      ) STORED,
      content_version INTEGER NOT NULL DEFAULT 1,
      pinned_at TIMESTAMPTZ,
      archived_at TIMESTAMPTZ,
      deleted_at TIMESTAMPTZ,
      purge_after_at TIMESTAMPTZ,
      deleted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT notes_board_notebook_check CHECK (board_id IS NULL OR notebook_id IS NULL)
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS notes_owner_personal_idx
      ON notes (owner_user_id, updated_at DESC)
      WHERE board_id IS NULL
  `,
  `
    CREATE INDEX IF NOT EXISTS notes_board_bucket_idx
      ON notes (board_id, bucket_id, updated_at DESC)
      WHERE board_id IS NOT NULL
  `,
  `
    CREATE INDEX IF NOT EXISTS notes_search_idx
      ON notes USING GIN (search_vector)
  `,
  `
    CREATE INDEX IF NOT EXISTS notes_purge_idx
      ON notes (purge_after_at)
      WHERE deleted_at IS NOT NULL
  `,
  `
    CREATE TABLE IF NOT EXISTS note_task_links (
      note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
      created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (note_id, task_id)
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS note_task_links_task_idx
      ON note_task_links (task_id)
  `,
  `
    CREATE TABLE IF NOT EXISTS note_labels (
      note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
      PRIMARY KEY (note_id, label_id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS note_tags (
      id UUID PRIMARY KEY,
      owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL CHECK (BTRIM(name) <> ''),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE UNIQUE INDEX IF NOT EXISTS note_tags_owner_name_idx
      ON note_tags (owner_user_id, LOWER(name))
  `,
  `
    CREATE TABLE IF NOT EXISTS note_tag_links (
      note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      tag_id UUID NOT NULL REFERENCES note_tags(id) ON DELETE CASCADE,
      PRIMARY KEY (note_id, tag_id)
    )
  `,
  `
    CREATE TABLE IF NOT EXISTS note_attachments (
      id UUID PRIMARY KEY,
      note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL UNIQUE,
      mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
      size_bytes BIGINT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS note_attachments_note_idx
      ON note_attachments (note_id, created_at ASC)
  `,
];

export async function ensureNotesSchema(client: PoolClient) {
  for (const statement of notesSchemaStatements) {
    await client.query(statement);
  }
}

// Frozen from public-task-edit-schema.ts at 75e8b55.
export const publicTaskEditSchema = `
ALTER TABLE task_public_shares ADD COLUMN IF NOT EXISTS access_mode TEXT NOT NULL DEFAULT 'view';
ALTER TABLE task_public_shares ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='task_public_shares_mode_check') THEN
    ALTER TABLE task_public_shares ADD CONSTRAINT task_public_shares_mode_check CHECK (access_mode IN ('view','edit_work'));
  END IF;
  IF EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname=current_schema() AND indexname='task_public_shares_active_task_idx' AND indexdef NOT LIKE '%access_mode%') THEN
    DROP INDEX task_public_shares_active_task_idx;
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS task_public_shares_active_task_idx ON task_public_shares(task_id,access_mode) WHERE revoked_at IS NULL;
ALTER TABLE task_notes ADD COLUMN IF NOT EXISTS created_via_share_id UUID REFERENCES task_public_shares(id) ON DELETE SET NULL;
ALTER TABLE task_notes ADD COLUMN IF NOT EXISTS updated_via_share_id UUID REFERENCES task_public_shares(id) ON DELETE SET NULL;
ALTER TABLE task_notes ADD COLUMN IF NOT EXISTS deleted_via_share_id UUID REFERENCES task_public_shares(id) ON DELETE SET NULL;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='task_notes_share_actor_check') THEN
    ALTER TABLE task_notes ADD CONSTRAINT task_notes_share_actor_check CHECK (
      (created_via_share_id IS NULL OR created_by_user_id IS NULL) AND
      (updated_via_share_id IS NULL OR updated_by_user_id IS NULL) AND
      (deleted_via_share_id IS NULL OR deleted_by_user_id IS NULL));
  END IF;
END $$;
CREATE TABLE IF NOT EXISTS task_share_work_changes (
  id UUID PRIMARY KEY,
  share_id UUID NOT NULL REFERENCES task_public_shares(id) ON DELETE CASCADE,
  mutation_id UUID NOT NULL,
  request_hash TEXT NOT NULL,
  edit_revision_after TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  resource_id UUID,
  details JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (octet_length(details::text)<=4096),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(share_id,mutation_id)
);
ALTER TABLE task_share_work_changes ADD COLUMN IF NOT EXISTS edit_revision_after TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS task_share_work_changes_share_time_idx ON task_share_work_changes(share_id,created_at);
CREATE TABLE IF NOT EXISTS task_share_work_limits (
  share_id UUID PRIMARY KEY REFERENCES task_public_shares(id) ON DELETE CASCADE,
  minute_started_at TIMESTAMPTZ NOT NULL,
  minute_count INTEGER NOT NULL CHECK (minute_count BETWEEN 1 AND 120),
  hour_started_at TIMESTAMPTZ NOT NULL,
  hour_count INTEGER NOT NULL CHECK (hour_count BETWEEN 1 AND 1000)
);
`;

export async function ensurePublicTaskEditSchema(client: PoolClient) {
  await client.query(publicTaskEditSchema);
}

// Frozen from public-task-share-schema.ts at 75e8b55.
export const publicTaskShareSchema = `
CREATE TABLE IF NOT EXISTS task_public_shares (
  id UUID PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  created_by_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  time_zone TEXT NOT NULL DEFAULT 'UTC',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  revoked_at TIMESTAMPTZ,
  revoked_reason TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS task_public_shares_active_task_idx ON task_public_shares(task_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS task_public_shares_active_board_idx ON task_public_shares(board_id) WHERE revoked_at IS NULL;
CREATE OR REPLACE FUNCTION revoke_task_public_shares_on_scope_change() RETURNS trigger AS $$
BEGIN
  IF NEW.board_id IS DISTINCT FROM OLD.board_id OR NEW.parent_task_id IS DISTINCT FROM OLD.parent_task_id
     OR (NEW.archived_at IS NOT NULL AND OLD.archived_at IS NULL)
     OR (NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL) THEN
    -- Walk only active publications upward; do not scan every unshared subtree
    -- for each row of an existing bulk archive/delete operation.
    WITH RECURSIVE affected AS (
      SELECT s.id AS share_id,t.id,t.parent_task_id FROM task_public_shares s
        JOIN tasks t ON t.id=s.task_id WHERE s.revoked_at IS NULL AND s.board_id=OLD.board_id
      UNION SELECT a.share_id,t.id,t.parent_task_id FROM tasks t JOIN affected a ON t.id=a.parent_task_id
    ) UPDATE task_public_shares SET revoked_at = NOW(), revoked_reason = 'task_scope_changed'
      WHERE id IN (SELECT share_id FROM affected WHERE id=NEW.id) AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS task_public_share_scope_change ON tasks;
CREATE TRIGGER task_public_share_scope_change AFTER UPDATE OF board_id, parent_task_id, archived_at, deleted_at ON tasks
  FOR EACH ROW EXECUTE FUNCTION revoke_task_public_shares_on_scope_change();
`;
export async function ensurePublicTaskShareSchema(client: PoolClient) {
    await client.query(publicTaskShareSchema);
    await ensurePublicTaskEditSchema(client);
}

// Frozen from outage-people-schema.ts at 75e8b55.
export const outagePeopleSchema = `
CREATE TABLE IF NOT EXISTS outage_people_details (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  person_key TEXT NOT NULL,
  travel JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(travel)='object' AND octet_length(travel::text)<=4096),
  discussed_day TEXT NOT NULL DEFAULT '',
  revision UUID NOT NULL,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  reporter_name TEXT NOT NULL,
  reporter_verified BOOLEAN NOT NULL,
  PRIMARY KEY(task_id,person_key)
);
CREATE TABLE IF NOT EXISTS outage_people_teams (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(task_id,name)
);
CREATE TABLE IF NOT EXISTS outage_people_fields (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  person_key TEXT NOT NULL,
  field TEXT NOT NULL CHECK (field IN ('team','location','activity')),
  value TEXT NOT NULL DEFAULT '',
  linked_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  is_linked BOOLEAN NOT NULL DEFAULT FALSE,
  revision UUID NOT NULL,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  reporter_name TEXT NOT NULL,
  reporter_verified BOOLEAN NOT NULL,
  PRIMARY KEY (task_id,person_key,field),
  CHECK (char_length(value) <= CASE field WHEN 'team' THEN 80 WHEN 'location' THEN 240 ELSE 1000 END),
  CHECK (NOT is_linked OR field='activity')
);
CREATE TABLE IF NOT EXISTS outage_people_history (
  id UUID PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  person_key TEXT NOT NULL,
  field TEXT NOT NULL CHECK (field IN ('team','location','activity')),
  value TEXT NOT NULL,
  linked_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  is_linked BOOLEAN NOT NULL DEFAULT FALSE,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  reporter_name TEXT NOT NULL,
  reporter_verified BOOLEAN NOT NULL
);
CREATE INDEX IF NOT EXISTS outage_people_history_person_idx
  ON outage_people_history(task_id,person_key,reported_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS outage_people_mutations (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  mutation_id UUID NOT NULL,
  actor_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  applied_revisions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(task_id,mutation_id)
);
ALTER TABLE outage_people_mutations ADD COLUMN IF NOT EXISTS applied_revisions JSONB NOT NULL DEFAULT '[]'::jsonb;
`;
export async function ensureOutagePeopleSchema(client: PoolClient) {
  await client.query(outagePeopleSchema);
}

// Frozen from board-revision-schema.ts at 75e8b55.
// Board and note revisions, applied idempotently on every start by
// runMigrations. db/schema.sql carries the same definitions for a fresh
// database, and db/migrations/20261102_board_revisions.sql and
// 20261103_note_revisions.sql record the changes.
//
// Every statement that really changes a board's data bumps that board's
// revision regardless of writer. Open pages compare the revision
// they hold with GET /api/board/revision and reload only when it moved.
//
// Triggers are statement-level with transition tables, so a bulk statement
// queues each board once, and a statement that touched no rows (the board
// loader's "insert if missing" housekeeping) queues nothing, which keeps a
// reload from causing another reload. The functions are SECURITY DEFINER so
//
// The bump itself happens at commit, from a deferred constraint trigger on
// board_revision_pending. A transaction therefore locks a board's revision row
// only for the moment before it commits, never while it goes on to lock task
// rows (which could deadlock with another writer), and it takes its revision
// number after obtaining that lock. So a board's revisions increase in commit
// order: a page that has seen revision N has seen every change committed with
// a revision up to N.
//
// Notes have revisions of their own, per scope: a person's personal notes
// ('user', owner) and a board's notes ('board', board). They are kept apart
// from board revisions so that typing in a board note, which autosaves about
// every second, does not reload that board's pages. Both kinds are bumped by
// one function, flush_live_revisions, from both pending tables: every
// transaction locks its board rows first and its note rows after, each in id
// order, so two transactions cannot lock them in opposite orders.

// Tables whose rows carry the board directly, keyed by that column.
export const boardKeyedRevisionTables: { table: string; column: "board_id" | "id" }[] = [
  { table: "boards", column: "id" },
  { table: "board_members", column: "board_id" },
  { table: "buckets", column: "board_id" },
  { table: "tasks", column: "board_id" },
  { table: "task_notes", column: "board_id" },
  { table: "labels", column: "board_id" },
  { table: "task_attachments", column: "board_id" },
  { table: "maintenance_locations", column: "board_id" },
  { table: "maintenance_outages", column: "board_id" },
  { table: "calendar_entries", column: "board_id" },
  { table: "imported_events", column: "board_id" },
  { table: "view_presets", column: "board_id" },
];

// Tables reached through their task. When the task is already gone (cascade
// delete), the tasks trigger has bumped its board.
export const taskKeyedRevisionTables = ["checklist_items", "task_labels"];

// Note tables, each reaching its scope a different way.
export const noteRevisionTables: { table: string; scope: NoteScopeSource }[] = [
  { table: "notes", scope: "note" },
  { table: "note_notebooks", scope: "owner" },
  { table: "note_tags", scope: "owner" },
  { table: "note_tag_links", scope: "note_id" },
  { table: "note_task_links", scope: "note_id" },
  { table: "note_labels", scope: "note_id" },
  { table: "note_attachments", scope: "note_id" },
];

// "note": the row is a note (a board note's scope is its board, a personal
// note's its owner; a move between them changes both). "owner": a personal
// notebook or tag. "note_id": a row of a note; when the note is already gone
// (cascade delete), the notes trigger has bumped its scope.
type NoteScopeSource = "note" | "owner" | "note_id";

const triggerFunctionFor = (column: "board_id" | "id" | "task_id") =>
  column === "task_id" ? "board_revision_by_task" : column === "id" ? "board_revision_by_board" : "board_revision_by_board_id";

// The changed rows' boards, from the transition tables this operation has.
function changedBoardsQuery(column: "board_id" | "id" | "task_id", op: "INSERT" | "UPDATE" | "DELETE") {
  const select = (rows: string) => `SELECT ${column} AS changed_id FROM ${rows}`;
  const changed =
    op === "INSERT" ? select("revision_new_rows")
      : op === "DELETE" ? select("revision_old_rows")
        : `${select("revision_old_rows")} UNION ${select("revision_new_rows")}`;
  return column === "task_id"
    ? `SELECT array_agg(DISTINCT t.board_id) INTO changed_boards FROM tasks t WHERE t.id IN (${changed})`
    : `SELECT array_agg(DISTINCT changed.changed_id) INTO changed_boards FROM (${changed}) changed`;
}

function triggerFunction(column: "board_id" | "id" | "task_id") {
  return `
    CREATE OR REPLACE FUNCTION ${triggerFunctionFor(column)}() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    DECLARE
      changed_boards UUID[];
    BEGIN
      IF TG_OP = 'INSERT' THEN
        ${changedBoardsQuery(column, "INSERT")};
      ELSIF TG_OP = 'DELETE' THEN
        ${changedBoardsQuery(column, "DELETE")};
      ELSE
        ${changedBoardsQuery(column, "UPDATE")};
      END IF;
      PERFORM queue_board_revisions(changed_boards);
      RETURN NULL;
    END;
    $$
  `;
}

function triggers(table: string, fn: string, prefix = "board_revision") {
  return [
    `CREATE OR REPLACE TRIGGER ${prefix}_insert AFTER INSERT ON ${table}
  REFERENCING NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION ${fn}()`,
    `CREATE OR REPLACE TRIGGER ${prefix}_update AFTER UPDATE ON ${table}
  REFERENCING OLD TABLE AS revision_old_rows NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION ${fn}()`,
    `CREATE OR REPLACE TRIGGER ${prefix}_delete AFTER DELETE ON ${table}
  REFERENCING OLD TABLE AS revision_old_rows FOR EACH STATEMENT EXECUTE FUNCTION ${fn}()`,
  ];
}

const noteTriggerFunctionFor = (scope: NoteScopeSource) =>
  scope === "note" ? "note_revision_by_note" : scope === "owner" ? "note_revision_by_owner" : "note_revision_by_note_id";

// The changed rows' note scopes, as (kind, id) pairs.
function changedNoteScopesQuery(scope: NoteScopeSource, op: "INSERT" | "UPDATE" | "DELETE") {
  const columns =
    scope === "note" ? "board_id, owner_user_id" : scope === "owner" ? "owner_user_id" : "note_id";
  const select = (rows: string) => `SELECT ${columns} FROM ${rows}`;
  const changed =
    op === "INSERT" ? select("revision_new_rows")
      : op === "DELETE" ? select("revision_old_rows")
        : `${select("revision_old_rows")} UNION ${select("revision_new_rows")}`;
  const scopes =
    scope === "note"
      ? `SELECT CASE WHEN c.board_id IS NULL THEN 'user' ELSE 'board' END AS kind, COALESCE(c.board_id, c.owner_user_id) AS id FROM (${changed}) c`
      : scope === "owner"
        ? `SELECT 'user' AS kind, c.owner_user_id AS id FROM (${changed}) c`
        : `SELECT CASE WHEN n.board_id IS NULL THEN 'user' ELSE 'board' END AS kind, COALESCE(n.board_id, n.owner_user_id) AS id
           FROM notes n WHERE n.id IN (SELECT note_id FROM (${changed}) c)`;
  return `SELECT array_agg(s.kind), array_agg(s.id) INTO changed_kinds, changed_ids FROM (SELECT DISTINCT kind, id FROM (${scopes}) all_scopes) s`;
}

function noteTriggerFunction(scope: NoteScopeSource) {
  return `
    CREATE OR REPLACE FUNCTION ${noteTriggerFunctionFor(scope)}() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    DECLARE
      changed_kinds TEXT[];
      changed_ids UUID[];
    BEGIN
      IF TG_OP = 'INSERT' THEN
        ${changedNoteScopesQuery(scope, "INSERT")};
      ELSIF TG_OP = 'DELETE' THEN
        ${changedNoteScopesQuery(scope, "DELETE")};
      ELSE
        ${changedNoteScopesQuery(scope, "UPDATE")};
      END IF;
      PERFORM queue_note_revisions(changed_kinds, changed_ids);
      RETURN NULL;
    END;
    $$
  `;
}

// Points a pending table's constraint trigger at flush_live_revisions. One DO
// block is one statement, so the trigger is never missing: runMigrations
// commits each statement on its own, and a transaction committing between a
// separate DROP and CREATE would get no bump. An older app version reinstalls
// its own board-only trigger; it still bumps boards, and the notes trigger
// keeps flushing both.
function flushTrigger(trigger: string, table: string) {
  return `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger t
        JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE t.tgrelid = '${table}'::regclass AND t.tgname = '${trigger}' AND p.proname = 'flush_live_revisions'
      ) THEN
        DROP TRIGGER IF EXISTS ${trigger} ON ${table};
        CREATE CONSTRAINT TRIGGER ${trigger} AFTER INSERT ON ${table}
          DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION flush_live_revisions();
      END IF;
    END
    $$
  `;
}

export const boardRevisionSchemaStatements = [
  `CREATE SEQUENCE IF NOT EXISTS board_revision_seq`,
  `
    CREATE TABLE IF NOT EXISTS board_revisions (
      board_id UUID PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
      revision BIGINT NOT NULL,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  // Boards changed by transactions that have not committed yet.
  `
    CREATE TABLE IF NOT EXISTS board_revision_pending (
      transaction_id XID8 NOT NULL DEFAULT pg_current_xact_id(),
      board_id UUID NOT NULL
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS board_revision_pending_transaction_idx
      ON board_revision_pending (transaction_id, board_id)
  `,
  `
    CREATE OR REPLACE FUNCTION queue_board_revisions(board_ids UUID[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    BEGIN
      IF board_ids IS NULL OR cardinality(board_ids) = 0 THEN
        RETURN;
      END IF;
      INSERT INTO board_revision_pending (board_id)
      SELECT DISTINCT changed.id
      FROM unnest(board_ids) AS changed(id)
      WHERE changed.id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM board_revision_pending pending
          WHERE pending.transaction_id = pg_current_xact_id() AND pending.board_id = changed.id
        );
    END;
    $$
  `,
  `
    CREATE TABLE IF NOT EXISTS note_revisions (
      scope_kind TEXT NOT NULL CHECK (scope_kind IN ('user', 'board')),
      scope_id UUID NOT NULL,
      revision BIGINT NOT NULL,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (scope_kind, scope_id)
    )
  `,
  // Note scopes changed by transactions that have not committed yet.
  `
    CREATE TABLE IF NOT EXISTS note_revision_pending (
      transaction_id XID8 NOT NULL DEFAULT pg_current_xact_id(),
      scope_kind TEXT NOT NULL,
      scope_id UUID NOT NULL
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS note_revision_pending_transaction_idx
      ON note_revision_pending (transaction_id, scope_kind, scope_id)
  `,
  `
    CREATE OR REPLACE FUNCTION queue_note_revisions(kinds TEXT[], ids UUID[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    BEGIN
      IF ids IS NULL OR cardinality(ids) = 0 THEN
        RETURN;
      END IF;
      INSERT INTO note_revision_pending (scope_kind, scope_id)
      SELECT DISTINCT changed.kind, changed.id
      FROM unnest(kinds, ids) AS changed(kind, id)
      WHERE changed.id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM note_revision_pending pending
          WHERE pending.transaction_id = pg_current_xact_id()
            AND pending.scope_kind = changed.kind AND pending.scope_id = changed.id
        );
    END;
    $$
  `,
  // Runs at commit. The first firing in a transaction bumps all its boards,
  // then all its note scopes, each in id order (so two committing transactions
  // lock revision rows in the same order); later firings find nothing left.
  // nextval in DO UPDATE runs after the row lock is held. Deleted boards are
  // skipped.
  `
    CREATE OR REPLACE FUNCTION flush_live_revisions() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    DECLARE
      flushed UUID[];
    BEGIN
      WITH mine AS (
        DELETE FROM board_revision_pending
        WHERE transaction_id = pg_current_xact_id()
        RETURNING board_id
      )
      SELECT array_agg(DISTINCT board_id) INTO flushed FROM mine;
      IF flushed IS NOT NULL THEN
        INSERT INTO board_revisions (board_id, revision, changed_at)
        SELECT b.id, nextval('board_revision_seq'), clock_timestamp()
        FROM boards b
        WHERE b.id = ANY(flushed)
        ORDER BY b.id
        ON CONFLICT (board_id) DO UPDATE
          SET revision = nextval('board_revision_seq'), changed_at = clock_timestamp();
      END IF;
      WITH mine AS (
        DELETE FROM note_revision_pending
        WHERE transaction_id = pg_current_xact_id()
        RETURNING scope_kind, scope_id
      )
      INSERT INTO note_revisions (scope_kind, scope_id, revision, changed_at)
      SELECT s.scope_kind, s.scope_id, nextval('board_revision_seq'), clock_timestamp()
      FROM (SELECT DISTINCT scope_kind, scope_id FROM mine) s
      ORDER BY s.scope_kind, s.scope_id
      ON CONFLICT (scope_kind, scope_id) DO UPDATE
        SET revision = nextval('board_revision_seq'), changed_at = clock_timestamp();
      RETURN NULL;
    END;
    $$
  `,
  // The Phase 1 board-only flush. Kept for an older app version, which
  // reinstalls its trigger with it; this version's triggers use
  // flush_live_revisions.
  `
    CREATE OR REPLACE FUNCTION flush_board_revisions() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    DECLARE
      flushed UUID[];
    BEGIN
      WITH mine AS (
        DELETE FROM board_revision_pending
        WHERE transaction_id = pg_current_xact_id()
        RETURNING board_id
      )
      SELECT array_agg(DISTINCT board_id) INTO flushed FROM mine;
      IF flushed IS NULL THEN
        RETURN NULL;
      END IF;
      INSERT INTO board_revisions (board_id, revision, changed_at)
      SELECT b.id, nextval('board_revision_seq'), clock_timestamp()
      FROM boards b
      WHERE b.id = ANY(flushed)
      ORDER BY b.id
      ON CONFLICT (board_id) DO UPDATE
        SET revision = nextval('board_revision_seq'), changed_at = clock_timestamp();
      RETURN NULL;
    END;
    $$
  `,
  flushTrigger("board_revision_flush", "board_revision_pending"),
  flushTrigger("note_revision_flush", "note_revision_pending"),
  triggerFunction("board_id"),
  triggerFunction("id"),
  triggerFunction("task_id"),
  noteTriggerFunction("note"),
  noteTriggerFunction("owner"),
  noteTriggerFunction("note_id"),
  // Trigger functions need no EXECUTE grant to fire; nobody calls these directly.
  `REVOKE ALL ON FUNCTION queue_board_revisions(UUID[]) FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION queue_note_revisions(TEXT[], UUID[]) FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION flush_board_revisions() FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION flush_live_revisions() FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION board_revision_by_board_id() FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION board_revision_by_board() FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION board_revision_by_task() FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION note_revision_by_note() FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION note_revision_by_owner() FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION note_revision_by_note_id() FROM PUBLIC`,
  ...boardKeyedRevisionTables.flatMap(({ table, column }) => triggers(table, triggerFunctionFor(column))),
  ...taskKeyedRevisionTables.flatMap((table) => triggers(table, triggerFunctionFor("task_id"))),
  // Note producers last, once their pending table and flush exist.
  ...noteRevisionTables.flatMap(({ table, scope }) => triggers(table, noteTriggerFunctionFor(scope), "note_revision")),
];

export async function ensureBoardRevisionSchema(client: PoolClient) {
  for (const statement of boardRevisionSchemaStatements) {
    await client.query(statement);
  }
}
