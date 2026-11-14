import type { PoolClient } from "pg";

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
