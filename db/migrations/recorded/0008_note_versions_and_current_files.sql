SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '15s';

ALTER TABLE note_attachments ADD COLUMN removed_at TIMESTAMPTZ;
CREATE INDEX note_attachments_current_idx ON note_attachments(note_id, created_at, id) WHERE removed_at IS NULL;
CREATE TABLE note_versions (
  id UUID PRIMARY KEY,
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  version_number INTEGER NOT NULL CHECK (version_number > 0),
  kind TEXT NOT NULL CHECK (kind IN ('start','edit','restore','import')),
  title TEXT NOT NULL,
  content_json JSONB NOT NULL,
  content_markdown TEXT NOT NULL,
  content_format_version INTEGER NOT NULL CHECK (content_format_version > 0),
  attachment_ids UUID[] NOT NULL DEFAULT '{}',
  author_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  started_at TIMESTAMPTZ NOT NULL,
  saved_at TIMESTAMPTZ NOT NULL CHECK (saved_at >= started_at),
  UNIQUE(note_id, version_number)
);
