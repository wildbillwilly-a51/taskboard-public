SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '15s';

-- NULL preserves the authorization contract of legacy Notes/Wiki callers.
ALTER TABLE notes ADD COLUMN folio_kind TEXT CHECK (folio_kind IN ('document', 'space_page'));
ALTER TABLE notes ADD COLUMN folio_page_state JSONB NOT NULL DEFAULT '{"bannerAttachmentId":null,"notesListVisible":true,"notesListPosition":"after"}'::jsonb;
ALTER TABLE notes ADD CONSTRAINT folio_notes_have_no_legacy_home CHECK (
  folio_kind IS NULL OR (board_id IS NULL AND bucket_id IS NULL AND notebook_id IS NULL AND wiki_space_id IS NULL)
);
ALTER TABLE note_versions ADD COLUMN folio_page_state JSONB;
ALTER TABLE boards ADD COLUMN archived_at TIMESTAMPTZ;

CREATE TABLE folio_spaces (
  id UUID PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('personal', 'shared', 'board', 'task')),
  title TEXT NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 120),
  owner_user_id UUID REFERENCES users(id) ON DELETE RESTRICT,
  parent_id UUID REFERENCES folio_spaces(id) ON DELETE SET NULL,
  board_id UUID REFERENCES boards(id) ON DELETE CASCADE,
  task_id UUID REFERENCES tasks(id) ON DELETE CASCADE,
  is_root BOOLEAN NOT NULL DEFAULT FALSE,
  archived_at TIMESTAMPTZ,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (parent_id IS DISTINCT FROM id),
  CHECK (
    (kind = 'personal' AND owner_user_id IS NOT NULL AND board_id IS NULL AND task_id IS NULL) OR
    (kind = 'shared' AND owner_user_id IS NULL AND board_id IS NULL AND task_id IS NULL AND NOT is_root) OR
    (kind = 'board' AND owner_user_id IS NULL AND board_id IS NOT NULL AND task_id IS NULL AND parent_id IS NULL AND NOT is_root) OR
    (kind = 'task' AND owner_user_id IS NULL AND board_id IS NULL AND task_id IS NOT NULL AND NOT is_root)
  ),
  CHECK (NOT is_root OR (kind = 'personal' AND parent_id IS NULL))
);
CREATE UNIQUE INDEX folio_personal_root_idx ON folio_spaces(owner_user_id) WHERE is_root;
CREATE UNIQUE INDEX folio_board_space_idx ON folio_spaces(board_id) WHERE kind = 'board';
CREATE UNIQUE INDEX folio_task_space_idx ON folio_spaces(task_id) WHERE kind = 'task';
CREATE INDEX folio_space_parent_idx ON folio_spaces(parent_id, kind, lower(title), id);
CREATE INDEX folio_space_owner_idx ON folio_spaces(owner_user_id) WHERE owner_user_id IS NOT NULL;

ALTER TABLE notes ADD COLUMN folio_page_space_id UUID UNIQUE REFERENCES folio_spaces(id) ON DELETE CASCADE;
ALTER TABLE notes ADD CONSTRAINT folio_space_page_shape CHECK (
  (folio_kind = 'space_page') IS NOT DISTINCT FROM (folio_page_space_id IS NOT NULL)
  OR (folio_kind IS NULL AND folio_page_space_id IS NULL)
);
CREATE INDEX folio_documents_updated_idx ON notes(updated_at DESC, id) WHERE folio_kind = 'document';

CREATE TABLE folio_connections (
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  space_id UUID NOT NULL REFERENCES folio_spaces(id) ON DELETE CASCADE,
  created_by_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(note_id, space_id)
);
CREATE INDEX folio_connections_space_idx ON folio_connections(space_id, note_id);
CREATE TABLE folio_favorites (
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, note_id)
);

-- File deletion is post-commit. Work-item FK cascades can remove managed pages;
-- durably queue their bytes rather than losing the paths in the cascade.
CREATE TABLE folio_file_cleanup (
  stored_name TEXT PRIMARY KEY,
  queued_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE FUNCTION folio_queue_deleted_note_files() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF OLD.folio_kind IS NOT NULL THEN
    INSERT INTO folio_file_cleanup(stored_name)
      SELECT stored_name FROM note_attachments WHERE note_id = OLD.id
      ON CONFLICT DO NOTHING;
  END IF;
  RETURN OLD;
END;
$$;
CREATE TRIGGER folio_note_file_cleanup BEFORE DELETE ON notes
  FOR EACH ROW EXECUTE FUNCTION folio_queue_deleted_note_files();

-- A space owns its page, never its connected documents. Promote immediate
-- children, leaving their IDs, pages and note connections untouched.
CREATE FUNCTION folio_promote_children() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  UPDATE folio_spaces SET parent_id = OLD.parent_id, updated_at = clock_timestamp()
    WHERE parent_id = OLD.id;
  RETURN OLD;
END;
$$;
CREATE TRIGGER folio_space_promote BEFORE DELETE ON folio_spaces
  FOR EACH ROW EXECUTE FUNCTION folio_promote_children();

-- These predicates intentionally do not inspect task completion status. Recycle
-- and archive suspend placement; restoring the source reactivates the same rows.
CREATE VIEW folio_space_lifecycle AS
WITH RECURSIVE lifecycle AS (
  SELECT s.id, s.parent_id, s.archived_at IS NOT NULL
    OR (s.kind = 'board' AND b.archived_at IS NOT NULL)
    OR (s.kind = 'task' AND (t.archived_at IS NOT NULL OR t.deleted_at IS NOT NULL OR tb.archived_at IS NOT NULL)) AS inactive,
    ARRAY[s.id] AS visited
  FROM folio_spaces s
  LEFT JOIN boards b ON b.id = s.board_id
  LEFT JOIN tasks t ON t.id = s.task_id
  LEFT JOIN boards tb ON tb.id = t.board_id
  WHERE s.parent_id IS NULL
  UNION ALL
  SELECT s.id, s.parent_id, p.inactive OR s.archived_at IS NOT NULL
    OR (s.kind = 'task' AND (t.archived_at IS NOT NULL OR t.deleted_at IS NOT NULL OR tb.archived_at IS NOT NULL)),
    p.visited || s.id
  FROM folio_spaces s JOIN lifecycle p ON p.id = s.parent_id
  LEFT JOIN tasks t ON t.id = s.task_id
  LEFT JOIN boards tb ON tb.id = t.board_id
  WHERE NOT s.id = ANY(p.visited)
)
SELECT id, inactive FROM lifecycle;

CREATE VIEW folio_active_connections AS
SELECT c.note_id, c.space_id, s.kind, s.owner_user_id
FROM folio_connections c
JOIN folio_spaces s ON s.id = c.space_id
JOIN folio_space_lifecycle l ON l.id = s.id AND NOT l.inactive;

-- Every connection must target a real document. A stable Personal principal
-- preserves the existing Only-you guarantee when the final public link leaves.
CREATE FUNCTION folio_validate_connection() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
DECLARE n notes; s folio_spaces;
BEGIN
  SELECT * INTO n FROM notes WHERE id = NEW.note_id;
  SELECT * INTO s FROM folio_spaces WHERE id = NEW.space_id;
  IF n.folio_kind IS DISTINCT FROM 'document' THEN
    RAISE EXCEPTION 'Only Folio documents can have connections' USING ERRCODE = '23514';
  END IF;
  IF s.kind = 'personal' AND s.owner_user_id IS DISTINCT FROM n.owner_user_id THEN
    RAISE EXCEPTION 'Personal connections must belong to the note owner' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER folio_connection_shape BEFORE INSERT OR UPDATE ON folio_connections
  FOR EACH ROW EXECUTE FUNCTION folio_validate_connection();
