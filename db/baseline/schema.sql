CREATE TABLE users (
  id UUID PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  username TEXT,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'standard' CHECK (role IN ('standard', 'manager', 'admin')),
  is_disabled BOOLEAN NOT NULL DEFAULT FALSE,
  is_reserved_local_admin BOOLEAN NOT NULL DEFAULT FALSE,
  local_password_hash TEXT,
  auth_provider TEXT NOT NULL DEFAULT 'authelia' CHECK (auth_provider IN ('local', 'authelia')),
  last_selected_board_id UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX users_reserved_local_admin_unique
  ON users ((is_reserved_local_admin))
  WHERE is_reserved_local_admin = TRUE;

CREATE UNIQUE INDEX users_username_unique
  ON users (username)
  WHERE username IS NOT NULL;

CREATE TABLE teams (
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
);

CREATE UNIQUE INDEX teams_active_name_unique
  ON teams (LOWER(BTRIM(name)))
  WHERE archived_at IS NULL;

CREATE TABLE team_members (
  team_id UUID NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('manager', 'member')),
  added_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (team_id, user_id)
);

CREATE INDEX team_members_user_id_idx
  ON team_members (user_id);

CREATE INDEX team_members_team_role_idx
  ON team_members (team_id, role);

CREATE TABLE app_permission_settings (
  id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  same_team_personal_board_visibility_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  default_personal_board_visibility TEXT NOT NULL DEFAULT 'private' CHECK (default_personal_board_visibility IN ('private', 'team_visible')),
  managers_can_configure_team_personal_board_visibility BOOLEAN NOT NULL DEFAULT FALSE,
  users_can_make_boards_private BOOLEAN NOT NULL DEFAULT TRUE,
  admins_can_view_private_boards BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO app_permission_settings (id)
VALUES (1)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE admin_audit_events (
  id UUID PRIMARY KEY,
  actor_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  target_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  target_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK (action <> ''),
  previous_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  new_values JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX admin_audit_events_actor_user_id_idx
  ON admin_audit_events (actor_user_id);

CREATE INDEX admin_audit_events_target_user_id_idx
  ON admin_audit_events (target_user_id);

CREATE INDEX admin_audit_events_target_team_id_idx
  ON admin_audit_events (target_team_id);

CREATE INDEX admin_audit_events_created_at_idx
  ON admin_audit_events (created_at DESC);

CREATE TABLE boards (
  id UUID PRIMARY KEY,
  owner_user_id UUID REFERENCES users(id),
  board_type TEXT NOT NULL DEFAULT 'personal' CHECK (board_type IN ('personal', 'team')),
  owner_team_id UUID REFERENCES teams(id) ON DELETE RESTRICT,
  team_member_default_access TEXT CHECK (team_member_default_access IN ('viewer', 'editor')),
  personal_visibility TEXT,
  personal_visibility_team_id UUID REFERENCES teams(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  icon TEXT,
  color TEXT,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT boards_ownership_shape_check CHECK (
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
);

CREATE INDEX boards_owner_team_id_idx
  ON boards (owner_team_id)
  WHERE owner_team_id IS NOT NULL;

CREATE INDEX boards_board_type_idx
  ON boards (board_type);

CREATE INDEX boards_personal_visibility_team_id_idx
  ON boards (personal_visibility_team_id)
  WHERE personal_visibility_team_id IS NOT NULL;

ALTER TABLE users
  ADD CONSTRAINT users_last_selected_board_id_fkey
  FOREIGN KEY (last_selected_board_id) REFERENCES boards(id) ON DELETE SET NULL;

ALTER TABLE admin_audit_events
  ADD COLUMN target_board_id UUID REFERENCES boards(id) ON DELETE SET NULL;

CREATE INDEX admin_audit_events_target_board_id_idx
  ON admin_audit_events (target_board_id);

CREATE TABLE board_members (
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (board_id, user_id)
);

CREATE INDEX board_members_user_id_board_id_idx
  ON board_members (user_id, board_id);

CREATE TABLE buckets (
  id UUID PRIMARY KEY,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  color TEXT,
  icon TEXT,
  sort_order NUMERIC(20,10) NOT NULL,
  is_collapsed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE tasks (
  id UUID PRIMARY KEY,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  bucket_id UUID REFERENCES buckets(id) ON DELETE SET NULL,
  parent_task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('todo', 'active', 'waiting', 'done')),
  color TEXT,
  icon TEXT,
  due_at TIMESTAMPTZ,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  recurrence_rule JSONB,
  recurrence_series_id UUID,
  reminder_offset_minutes INTEGER,
  overdue_reminder_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order NUMERIC(20,10) NOT NULL,
  source_type TEXT CHECK (source_type IN ('native', 'google', 'ics', 'manual')),
  source_record_id TEXT,
  is_read_only_import BOOLEAN NOT NULL DEFAULT FALSE,
  work_item_type TEXT NOT NULL DEFAULT 'task' CHECK (work_item_type IN ('task', 'maintenance_outage')),
  completed_at TIMESTAMPTZ,
  archived_at TIMESTAMPTZ,
  archive_original_bucket_id UUID,
  archive_original_bucket_title TEXT,
  archive_archived_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  deleted_at TIMESTAMPTZ,
  purge_after_at TIMESTAMPTZ,
  recycle_original_bucket_id UUID,
  recycle_original_bucket_title TEXT,
  recycle_deleted_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX tasks_board_bucket_idx ON tasks(board_id, bucket_id, sort_order);
CREATE INDEX tasks_parent_idx ON tasks(parent_task_id, sort_order);
CREATE INDEX tasks_board_work_item_type_idx
  ON tasks (board_id, work_item_type)
  WHERE deleted_at IS NULL AND archived_at IS NULL;
CREATE INDEX tasks_board_recurrence_series_idx
  ON tasks (board_id, recurrence_series_id, due_at)
  WHERE recurrence_series_id IS NOT NULL AND deleted_at IS NULL AND archived_at IS NULL;

CREATE TABLE maintenance_locations (
  id UUID PRIMARY KEY,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (BTRIM(name) <> ''),
  sort_order NUMERIC(20,10) NOT NULL DEFAULT 1000,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX maintenance_locations_board_name_idx
  ON maintenance_locations (board_id, LOWER(name));

CREATE TABLE maintenance_outages (
  task_id UUID PRIMARY KEY REFERENCES tasks(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  location_id UUID REFERENCES maintenance_locations(id) ON DELETE SET NULL,
  owner_name TEXT NOT NULL DEFAULT '',
  attendees JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT maintenance_outages_attendees_array_check CHECK (jsonb_typeof(attendees) = 'array')
);

CREATE INDEX maintenance_outages_board_idx ON maintenance_outages (board_id);

CREATE TABLE task_notifications (
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
);

CREATE UNIQUE INDEX task_notifications_task_kind_due_idx
  ON task_notifications (task_id, kind, due_at_snapshot);

CREATE INDEX task_notifications_user_active_idx
  ON task_notifications (user_id, dismissed_at, read_at, trigger_at DESC);

CREATE TABLE task_notes (
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
);

CREATE INDEX task_notes_task_created_idx
  ON task_notes (task_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX task_notes_active_primary_idx
  ON task_notes (task_id)
  WHERE deleted_at IS NULL AND note_type = 'primary';

CREATE INDEX tasks_board_deleted_root_idx
  ON tasks (board_id, deleted_at, purge_after_at)
  WHERE parent_task_id IS NULL;

CREATE INDEX tasks_board_archive_root_idx
  ON tasks (board_id, archived_at DESC)
  WHERE parent_task_id IS NULL AND archived_at IS NOT NULL;

CREATE INDEX tasks_board_done_auto_archive_idx
  ON tasks (board_id, completed_at)
  WHERE parent_task_id IS NULL AND status = 'done' AND deleted_at IS NULL AND archived_at IS NULL;

CREATE TABLE checklist_items (
  id UUID PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  is_done BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order NUMERIC(20,10) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE labels (
  id UUID PRIMARY KEY,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT,
  icon TEXT
);

CREATE TABLE task_labels (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (task_id, label_id)
);

CREATE TABLE task_attachments (
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
);

CREATE INDEX task_attachments_task_created_idx
  ON task_attachments (task_id, created_at ASC);

CREATE INDEX task_attachments_board_task_idx
  ON task_attachments (board_id, task_id);

CREATE TABLE calendar_accounts (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('google')),
  external_account_id TEXT NOT NULL,
  access_token_encrypted TEXT,
  refresh_token_encrypted TEXT,
  sync_cursor TEXT,
  last_synced_at TIMESTAMPTZ
);

CREATE TABLE imported_events (
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
);

CREATE UNIQUE INDEX imported_events_board_provider_external_idx
  ON imported_events (board_id, provider, external_event_id)
  WHERE external_event_id IS NOT NULL;

CREATE TABLE calendar_entries (
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
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT calendar_entries_time_order_check CHECK (ends_at > starts_at)
);

CREATE INDEX calendar_entries_board_starts_idx
  ON calendar_entries (board_id, starts_at)
  WHERE deleted_at IS NULL;

CREATE INDEX calendar_entries_board_deleted_idx
  ON calendar_entries (board_id, deleted_at);

CREATE INDEX calendar_entries_linked_task_idx
  ON calendar_entries (linked_task_id)
  WHERE linked_task_id IS NOT NULL;

CREATE TABLE view_presets (
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
);

CREATE TABLE IF NOT EXISTS note_notebooks (
  id UUID PRIMARY KEY,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_notebook_id UUID REFERENCES note_notebooks(id) ON DELETE SET NULL,
  title TEXT NOT NULL CHECK (BTRIM(title) <> ''),
  sort_order NUMERIC(20,10) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS note_notebooks_owner_parent_idx
  ON note_notebooks (owner_user_id, parent_notebook_id, sort_order);

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
);

CREATE INDEX IF NOT EXISTS notes_owner_personal_idx
  ON notes (owner_user_id, updated_at DESC)
  WHERE board_id IS NULL;

CREATE INDEX IF NOT EXISTS notes_board_bucket_idx
  ON notes (board_id, bucket_id, updated_at DESC)
  WHERE board_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS notes_search_idx
  ON notes USING GIN (search_vector);

CREATE INDEX IF NOT EXISTS notes_purge_idx
  ON notes (purge_after_at)
  WHERE deleted_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS note_task_links (
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (note_id, task_id)
);

CREATE INDEX IF NOT EXISTS note_task_links_task_idx
  ON note_task_links (task_id);

CREATE TABLE IF NOT EXISTS note_labels (
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  label_id UUID NOT NULL REFERENCES labels(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, label_id)
);

CREATE TABLE IF NOT EXISTS note_tags (
  id UUID PRIMARY KEY,
  owner_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (BTRIM(name) <> ''),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS note_tags_owner_name_idx
  ON note_tags (owner_user_id, LOWER(name));

CREATE TABLE IF NOT EXISTS note_tag_links (
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES note_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

CREATE TABLE IF NOT EXISTS note_attachments (
  id UUID PRIMARY KEY,
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  uploaded_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL UNIQUE,
  mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
  size_bytes BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS note_attachments_note_idx
  ON note_attachments (note_id, created_at ASC);


-- Public task workspace links.
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

-- Shared task work editing and expiring links.
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

-- Outage people board
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

-- Live board and note updates (src/lib/board-revision-schema.ts).
CREATE SEQUENCE IF NOT EXISTS board_revision_seq;
CREATE TABLE IF NOT EXISTS board_revisions (
  board_id UUID PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
  revision BIGINT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TABLE IF NOT EXISTS board_revision_pending (
  transaction_id XID8 NOT NULL DEFAULT pg_current_xact_id(),
  board_id UUID NOT NULL
);
CREATE INDEX IF NOT EXISTS board_revision_pending_transaction_idx
  ON board_revision_pending (transaction_id, board_id);
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
$$;
CREATE TABLE IF NOT EXISTS note_revisions (
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('user', 'board')),
  scope_id UUID NOT NULL,
  revision BIGINT NOT NULL,
  changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (scope_kind, scope_id)
);
CREATE TABLE IF NOT EXISTS note_revision_pending (
  transaction_id XID8 NOT NULL DEFAULT pg_current_xact_id(),
  scope_kind TEXT NOT NULL,
  scope_id UUID NOT NULL
);
CREATE INDEX IF NOT EXISTS note_revision_pending_transaction_idx
  ON note_revision_pending (transaction_id, scope_kind, scope_id);
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
$$;
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
$$;
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
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'board_revision_pending'::regclass AND t.tgname = 'board_revision_flush' AND p.proname = 'flush_live_revisions'
  ) THEN
    DROP TRIGGER IF EXISTS board_revision_flush ON board_revision_pending;
    CREATE CONSTRAINT TRIGGER board_revision_flush AFTER INSERT ON board_revision_pending
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION flush_live_revisions();
  END IF;
END
$$;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE t.tgrelid = 'note_revision_pending'::regclass AND t.tgname = 'note_revision_flush' AND p.proname = 'flush_live_revisions'
  ) THEN
    DROP TRIGGER IF EXISTS note_revision_flush ON note_revision_pending;
    CREATE CONSTRAINT TRIGGER note_revision_flush AFTER INSERT ON note_revision_pending
      DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION flush_live_revisions();
  END IF;
END
$$;
CREATE OR REPLACE FUNCTION board_revision_by_board_id() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  changed_boards UUID[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT changed.changed_id) INTO changed_boards FROM (SELECT board_id AS changed_id FROM revision_new_rows) changed;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT changed.changed_id) INTO changed_boards FROM (SELECT board_id AS changed_id FROM revision_old_rows) changed;
  ELSE
    SELECT array_agg(DISTINCT changed.changed_id) INTO changed_boards FROM (SELECT board_id AS changed_id FROM revision_old_rows UNION SELECT board_id AS changed_id FROM revision_new_rows) changed;
  END IF;
  PERFORM queue_board_revisions(changed_boards);
  RETURN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION board_revision_by_board() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  changed_boards UUID[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT changed.changed_id) INTO changed_boards FROM (SELECT id AS changed_id FROM revision_new_rows) changed;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT changed.changed_id) INTO changed_boards FROM (SELECT id AS changed_id FROM revision_old_rows) changed;
  ELSE
    SELECT array_agg(DISTINCT changed.changed_id) INTO changed_boards FROM (SELECT id AS changed_id FROM revision_old_rows UNION SELECT id AS changed_id FROM revision_new_rows) changed;
  END IF;
  PERFORM queue_board_revisions(changed_boards);
  RETURN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION board_revision_by_task() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  changed_boards UUID[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(DISTINCT t.board_id) INTO changed_boards FROM tasks t WHERE t.id IN (SELECT task_id AS changed_id FROM revision_new_rows);
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(DISTINCT t.board_id) INTO changed_boards FROM tasks t WHERE t.id IN (SELECT task_id AS changed_id FROM revision_old_rows);
  ELSE
    SELECT array_agg(DISTINCT t.board_id) INTO changed_boards FROM tasks t WHERE t.id IN (SELECT task_id AS changed_id FROM revision_old_rows UNION SELECT task_id AS changed_id FROM revision_new_rows);
  END IF;
  PERFORM queue_board_revisions(changed_boards);
  RETURN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION note_revision_by_note() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  changed_kinds TEXT[];
  changed_ids UUID[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(s.kind), array_agg(s.id) INTO changed_kinds, changed_ids FROM (SELECT DISTINCT kind, id FROM (SELECT CASE WHEN c.board_id IS NULL THEN 'user' ELSE 'board' END AS kind, COALESCE(c.board_id, c.owner_user_id) AS id FROM (SELECT board_id, owner_user_id FROM revision_new_rows) c) all_scopes) s;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(s.kind), array_agg(s.id) INTO changed_kinds, changed_ids FROM (SELECT DISTINCT kind, id FROM (SELECT CASE WHEN c.board_id IS NULL THEN 'user' ELSE 'board' END AS kind, COALESCE(c.board_id, c.owner_user_id) AS id FROM (SELECT board_id, owner_user_id FROM revision_old_rows) c) all_scopes) s;
  ELSE
    SELECT array_agg(s.kind), array_agg(s.id) INTO changed_kinds, changed_ids FROM (SELECT DISTINCT kind, id FROM (SELECT CASE WHEN c.board_id IS NULL THEN 'user' ELSE 'board' END AS kind, COALESCE(c.board_id, c.owner_user_id) AS id FROM (SELECT board_id, owner_user_id FROM revision_old_rows UNION SELECT board_id, owner_user_id FROM revision_new_rows) c) all_scopes) s;
  END IF;
  PERFORM queue_note_revisions(changed_kinds, changed_ids);
  RETURN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION note_revision_by_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  changed_kinds TEXT[];
  changed_ids UUID[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(s.kind), array_agg(s.id) INTO changed_kinds, changed_ids FROM (SELECT DISTINCT kind, id FROM (SELECT 'user' AS kind, c.owner_user_id AS id FROM (SELECT owner_user_id FROM revision_new_rows) c) all_scopes) s;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(s.kind), array_agg(s.id) INTO changed_kinds, changed_ids FROM (SELECT DISTINCT kind, id FROM (SELECT 'user' AS kind, c.owner_user_id AS id FROM (SELECT owner_user_id FROM revision_old_rows) c) all_scopes) s;
  ELSE
    SELECT array_agg(s.kind), array_agg(s.id) INTO changed_kinds, changed_ids FROM (SELECT DISTINCT kind, id FROM (SELECT 'user' AS kind, c.owner_user_id AS id FROM (SELECT owner_user_id FROM revision_old_rows UNION SELECT owner_user_id FROM revision_new_rows) c) all_scopes) s;
  END IF;
  PERFORM queue_note_revisions(changed_kinds, changed_ids);
  RETURN NULL;
END;
$$;
CREATE OR REPLACE FUNCTION note_revision_by_note_id() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  changed_kinds TEXT[];
  changed_ids UUID[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(s.kind), array_agg(s.id) INTO changed_kinds, changed_ids FROM (SELECT DISTINCT kind, id FROM (SELECT CASE WHEN n.board_id IS NULL THEN 'user' ELSE 'board' END AS kind, COALESCE(n.board_id, n.owner_user_id) AS id
       FROM notes n WHERE n.id IN (SELECT note_id FROM (SELECT note_id FROM revision_new_rows) c)) all_scopes) s;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(s.kind), array_agg(s.id) INTO changed_kinds, changed_ids FROM (SELECT DISTINCT kind, id FROM (SELECT CASE WHEN n.board_id IS NULL THEN 'user' ELSE 'board' END AS kind, COALESCE(n.board_id, n.owner_user_id) AS id
       FROM notes n WHERE n.id IN (SELECT note_id FROM (SELECT note_id FROM revision_old_rows) c)) all_scopes) s;
  ELSE
    SELECT array_agg(s.kind), array_agg(s.id) INTO changed_kinds, changed_ids FROM (SELECT DISTINCT kind, id FROM (SELECT CASE WHEN n.board_id IS NULL THEN 'user' ELSE 'board' END AS kind, COALESCE(n.board_id, n.owner_user_id) AS id
       FROM notes n WHERE n.id IN (SELECT note_id FROM (SELECT note_id FROM revision_old_rows UNION SELECT note_id FROM revision_new_rows) c)) all_scopes) s;
  END IF;
  PERFORM queue_note_revisions(changed_kinds, changed_ids);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION queue_board_revisions(UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION queue_note_revisions(TEXT[], UUID[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION flush_board_revisions() FROM PUBLIC;
REVOKE ALL ON FUNCTION flush_live_revisions() FROM PUBLIC;
REVOKE ALL ON FUNCTION board_revision_by_board_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION board_revision_by_board() FROM PUBLIC;
REVOKE ALL ON FUNCTION board_revision_by_task() FROM PUBLIC;
REVOKE ALL ON FUNCTION note_revision_by_note() FROM PUBLIC;
REVOKE ALL ON FUNCTION note_revision_by_owner() FROM PUBLIC;
REVOKE ALL ON FUNCTION note_revision_by_note_id() FROM PUBLIC;
CREATE OR REPLACE TRIGGER board_revision_insert AFTER INSERT ON boards
  REFERENCING NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board();
CREATE OR REPLACE TRIGGER board_revision_update AFTER UPDATE ON boards
  REFERENCING OLD TABLE AS revision_old_rows NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board();
CREATE OR REPLACE TRIGGER board_revision_delete AFTER DELETE ON boards
  REFERENCING OLD TABLE AS revision_old_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board();
CREATE OR REPLACE TRIGGER board_revision_insert AFTER INSERT ON board_members
  REFERENCING NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_update AFTER UPDATE ON board_members
  REFERENCING OLD TABLE AS revision_old_rows NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_delete AFTER DELETE ON board_members
  REFERENCING OLD TABLE AS revision_old_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_insert AFTER INSERT ON buckets
  REFERENCING NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_update AFTER UPDATE ON buckets
  REFERENCING OLD TABLE AS revision_old_rows NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_delete AFTER DELETE ON buckets
  REFERENCING OLD TABLE AS revision_old_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_insert AFTER INSERT ON tasks
  REFERENCING NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_update AFTER UPDATE ON tasks
  REFERENCING OLD TABLE AS revision_old_rows NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_delete AFTER DELETE ON tasks
  REFERENCING OLD TABLE AS revision_old_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_insert AFTER INSERT ON task_notes
  REFERENCING NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_update AFTER UPDATE ON task_notes
  REFERENCING OLD TABLE AS revision_old_rows NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_delete AFTER DELETE ON task_notes
  REFERENCING OLD TABLE AS revision_old_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_insert AFTER INSERT ON labels
  REFERENCING NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_update AFTER UPDATE ON labels
  REFERENCING OLD TABLE AS revision_old_rows NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_delete AFTER DELETE ON labels
  REFERENCING OLD TABLE AS revision_old_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_insert AFTER INSERT ON task_attachments
  REFERENCING NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_update AFTER UPDATE ON task_attachments
  REFERENCING OLD TABLE AS revision_old_rows NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_delete AFTER DELETE ON task_attachments
  REFERENCING OLD TABLE AS revision_old_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_insert AFTER INSERT ON maintenance_locations
  REFERENCING NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_update AFTER UPDATE ON maintenance_locations
  REFERENCING OLD TABLE AS revision_old_rows NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_delete AFTER DELETE ON maintenance_locations
  REFERENCING OLD TABLE AS revision_old_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_insert AFTER INSERT ON maintenance_outages
  REFERENCING NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_update AFTER UPDATE ON maintenance_outages
  REFERENCING OLD TABLE AS revision_old_rows NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_delete AFTER DELETE ON maintenance_outages
  REFERENCING OLD TABLE AS revision_old_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_insert AFTER INSERT ON calendar_entries
  REFERENCING NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_update AFTER UPDATE ON calendar_entries
  REFERENCING OLD TABLE AS revision_old_rows NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_delete AFTER DELETE ON calendar_entries
  REFERENCING OLD TABLE AS revision_old_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_insert AFTER INSERT ON imported_events
  REFERENCING NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_update AFTER UPDATE ON imported_events
  REFERENCING OLD TABLE AS revision_old_rows NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_delete AFTER DELETE ON imported_events
  REFERENCING OLD TABLE AS revision_old_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_insert AFTER INSERT ON view_presets
  REFERENCING NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_update AFTER UPDATE ON view_presets
  REFERENCING OLD TABLE AS revision_old_rows NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_delete AFTER DELETE ON view_presets
  REFERENCING OLD TABLE AS revision_old_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_board_id();
CREATE OR REPLACE TRIGGER board_revision_insert AFTER INSERT ON checklist_items
  REFERENCING NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_task();
CREATE OR REPLACE TRIGGER board_revision_update AFTER UPDATE ON checklist_items
  REFERENCING OLD TABLE AS revision_old_rows NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_task();
CREATE OR REPLACE TRIGGER board_revision_delete AFTER DELETE ON checklist_items
  REFERENCING OLD TABLE AS revision_old_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_task();
CREATE OR REPLACE TRIGGER board_revision_insert AFTER INSERT ON task_labels
  REFERENCING NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_task();
CREATE OR REPLACE TRIGGER board_revision_update AFTER UPDATE ON task_labels
  REFERENCING OLD TABLE AS revision_old_rows NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_task();
CREATE OR REPLACE TRIGGER board_revision_delete AFTER DELETE ON task_labels
  REFERENCING OLD TABLE AS revision_old_rows FOR EACH STATEMENT EXECUTE FUNCTION board_revision_by_task();
CREATE OR REPLACE TRIGGER note_revision_insert AFTER INSERT ON notes
  REFERENCING NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION note_revision_by_note();
CREATE OR REPLACE TRIGGER note_revision_update AFTER UPDATE ON notes
  REFERENCING OLD TABLE AS revision_old_rows NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION note_revision_by_note();
CREATE OR REPLACE TRIGGER note_revision_delete AFTER DELETE ON notes
  REFERENCING OLD TABLE AS revision_old_rows FOR EACH STATEMENT EXECUTE FUNCTION note_revision_by_note();
CREATE OR REPLACE TRIGGER note_revision_insert AFTER INSERT ON note_notebooks
  REFERENCING NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION note_revision_by_owner();
CREATE OR REPLACE TRIGGER note_revision_update AFTER UPDATE ON note_notebooks
  REFERENCING OLD TABLE AS revision_old_rows NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION note_revision_by_owner();
CREATE OR REPLACE TRIGGER note_revision_delete AFTER DELETE ON note_notebooks
  REFERENCING OLD TABLE AS revision_old_rows FOR EACH STATEMENT EXECUTE FUNCTION note_revision_by_owner();
CREATE OR REPLACE TRIGGER note_revision_insert AFTER INSERT ON note_tags
  REFERENCING NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION note_revision_by_owner();
CREATE OR REPLACE TRIGGER note_revision_update AFTER UPDATE ON note_tags
  REFERENCING OLD TABLE AS revision_old_rows NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION note_revision_by_owner();
CREATE OR REPLACE TRIGGER note_revision_delete AFTER DELETE ON note_tags
  REFERENCING OLD TABLE AS revision_old_rows FOR EACH STATEMENT EXECUTE FUNCTION note_revision_by_owner();
CREATE OR REPLACE TRIGGER note_revision_insert AFTER INSERT ON note_tag_links
  REFERENCING NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION note_revision_by_note_id();
CREATE OR REPLACE TRIGGER note_revision_update AFTER UPDATE ON note_tag_links
  REFERENCING OLD TABLE AS revision_old_rows NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION note_revision_by_note_id();
CREATE OR REPLACE TRIGGER note_revision_delete AFTER DELETE ON note_tag_links
  REFERENCING OLD TABLE AS revision_old_rows FOR EACH STATEMENT EXECUTE FUNCTION note_revision_by_note_id();
CREATE OR REPLACE TRIGGER note_revision_insert AFTER INSERT ON note_task_links
  REFERENCING NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION note_revision_by_note_id();
CREATE OR REPLACE TRIGGER note_revision_update AFTER UPDATE ON note_task_links
  REFERENCING OLD TABLE AS revision_old_rows NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION note_revision_by_note_id();
CREATE OR REPLACE TRIGGER note_revision_delete AFTER DELETE ON note_task_links
  REFERENCING OLD TABLE AS revision_old_rows FOR EACH STATEMENT EXECUTE FUNCTION note_revision_by_note_id();
CREATE OR REPLACE TRIGGER note_revision_insert AFTER INSERT ON note_labels
  REFERENCING NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION note_revision_by_note_id();
CREATE OR REPLACE TRIGGER note_revision_update AFTER UPDATE ON note_labels
  REFERENCING OLD TABLE AS revision_old_rows NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION note_revision_by_note_id();
CREATE OR REPLACE TRIGGER note_revision_delete AFTER DELETE ON note_labels
  REFERENCING OLD TABLE AS revision_old_rows FOR EACH STATEMENT EXECUTE FUNCTION note_revision_by_note_id();
CREATE OR REPLACE TRIGGER note_revision_insert AFTER INSERT ON note_attachments
  REFERENCING NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION note_revision_by_note_id();
CREATE OR REPLACE TRIGGER note_revision_update AFTER UPDATE ON note_attachments
  REFERENCING OLD TABLE AS revision_old_rows NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION note_revision_by_note_id();
CREATE OR REPLACE TRIGGER note_revision_delete AFTER DELETE ON note_attachments
  REFERENCING OLD TABLE AS revision_old_rows FOR EACH STATEMENT EXECUTE FUNCTION note_revision_by_note_id();

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
