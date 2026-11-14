import type { PoolClient } from "pg";

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
