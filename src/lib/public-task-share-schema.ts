import type { PoolClient } from "pg";
import { ensurePublicTaskEditSchema } from "./public-task-edit-schema";
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
