SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '15s';

CREATE TABLE folio_keywords (
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 80)
);
CREATE UNIQUE INDEX folio_keyword_name_idx ON folio_keywords(note_id,lower(name));
INSERT INTO folio_keywords(note_id,name)
SELECT l.note_id,t.name FROM note_tag_links l JOIN note_tags t ON t.id=l.tag_id
JOIN notes n ON n.id=l.note_id WHERE n.folio_kind IS NOT NULL ON CONFLICT DO NOTHING;
DELETE FROM note_tag_links l USING notes n WHERE n.id=l.note_id AND n.folio_kind IS NOT NULL;

-- Existing notebooks are compatibility nodes. Their notes retain their original
-- authorization until an editor explicitly adopts the note into Folio.
ALTER TABLE folio_spaces ADD COLUMN legacy_notebook_id UUID UNIQUE REFERENCES note_notebooks(id) ON DELETE SET NULL;
-- Archiving a Personal folder must never make its contents public implicitly.
ALTER TABLE folio_spaces ADD CONSTRAINT folio_personal_spaces_stay_active CHECK(kind<>'personal' OR archived_at IS NULL);

CREATE FUNCTION folio_follow_task_board() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.board_id IS DISTINCT FROM OLD.board_id AND EXISTS(SELECT 1 FROM folio_spaces WHERE task_id=NEW.id) THEN
    INSERT INTO folio_spaces(id,kind,title,board_id,created_by_user_id)
      SELECT gen_random_uuid(),'board',left(title,120),id,NEW.updated_by_user_id FROM boards WHERE id=NEW.board_id
      ON CONFLICT DO NOTHING;
    UPDATE folio_spaces SET parent_id=(SELECT id FROM folio_spaces WHERE board_id=NEW.board_id),updated_at=clock_timestamp()
      WHERE task_id=NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER folio_task_board_move AFTER UPDATE OF board_id ON tasks
FOR EACH ROW EXECUTE FUNCTION folio_follow_task_board();
