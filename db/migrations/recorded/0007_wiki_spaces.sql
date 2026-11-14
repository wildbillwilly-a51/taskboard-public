SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '15s';

CREATE TABLE wiki_spaces (
  id UUID PRIMARY KEY,
  board_id UUID NOT NULL UNIQUE REFERENCES boards(id) ON DELETE RESTRICT,
  slug TEXT NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' AND length(slug) <= 80),
  title TEXT NOT NULL CHECK (BTRIM(title) <> '' AND length(title) <= 120),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  home_note_id UUID REFERENCES notes(id) ON DELETE SET NULL,
  archived_at TIMESTAMPTZ,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (id, board_id)
);
ALTER TABLE notes
  ADD COLUMN wiki_space_id UUID,
  ADD COLUMN content_format_version INTEGER NOT NULL DEFAULT 1 CHECK (content_format_version > 0),
  ADD CONSTRAINT notes_wiki_space_fk FOREIGN KEY (wiki_space_id, board_id)
    REFERENCES wiki_spaces(id, board_id) ON DELETE RESTRICT,
  ADD CONSTRAINT notes_wiki_board_check CHECK (wiki_space_id IS NULL OR board_id IS NOT NULL),
  ADD CONSTRAINT notes_wiki_bucket_check CHECK (wiki_space_id IS NULL OR bucket_id IS NULL);
CREATE INDEX notes_wiki_space_updated_idx ON notes(wiki_space_id, updated_at DESC, id);

-- The pre-existing notes.board_id FK performs SET NULL. Refuse before those
-- actions run: PostgreSQL may otherwise hit notes_wiki_board_check before the
-- wiki_spaces RESTRICT action. The FK remains the concurrent-insert backstop.
CREATE FUNCTION restrict_wiki_board_delete() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM wiki_spaces WHERE board_id=OLD.id) THEN
    RAISE EXCEPTION 'A board with a wiki space cannot be deleted'
      USING ERRCODE='23503', CONSTRAINT='wiki_spaces_board_id_fkey';
  END IF;
  RETURN OLD;
END;
$$;
REVOKE ALL ON FUNCTION restrict_wiki_board_delete() FROM PUBLIC;
CREATE TRIGGER wiki_board_delete_restrict BEFORE DELETE ON boards
  FOR EACH ROW EXECUTE FUNCTION restrict_wiki_board_delete();
