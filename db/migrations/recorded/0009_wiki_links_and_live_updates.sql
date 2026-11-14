SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '15s';

CREATE TABLE note_links (
  source_note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  PRIMARY KEY(source_note_id,target_note_id)
);
CREATE INDEX note_links_target_idx ON note_links(target_note_id);

CREATE FUNCTION note_revision_by_wiki_space() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE changed_ids UUID[]; changed_kinds TEXT[];
BEGIN
  IF TG_OP = 'INSERT' THEN
    SELECT array_agg(board_id), array_agg('board'::text) INTO changed_ids, changed_kinds FROM revision_new_rows;
  ELSIF TG_OP = 'DELETE' THEN
    SELECT array_agg(board_id), array_agg('board'::text) INTO changed_ids, changed_kinds FROM revision_old_rows;
  ELSE
    SELECT array_agg(board_id), array_agg('board'::text) INTO changed_ids, changed_kinds
    FROM (SELECT board_id FROM revision_old_rows UNION SELECT board_id FROM revision_new_rows) changed;
  END IF;
  PERFORM queue_note_revisions(changed_kinds,changed_ids);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION note_revision_by_wiki_space() FROM PUBLIC;
CREATE TRIGGER wiki_space_note_revision_insert AFTER INSERT ON wiki_spaces
  REFERENCING NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION note_revision_by_wiki_space();
CREATE TRIGGER wiki_space_note_revision_update AFTER UPDATE ON wiki_spaces
  REFERENCING OLD TABLE AS revision_old_rows NEW TABLE AS revision_new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION note_revision_by_wiki_space();
CREATE TRIGGER wiki_space_note_revision_delete AFTER DELETE ON wiki_spaces
  REFERENCING OLD TABLE AS revision_old_rows FOR EACH STATEMENT EXECUTE FUNCTION note_revision_by_wiki_space();
