SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '15s';

-- Reuse the existing transaction-local queue and sorted, deferred commit flush.
-- A synchronous shared counter would invert space/page locking order.
ALTER TABLE note_revisions DROP CONSTRAINT note_revisions_scope_kind_check;
ALTER TABLE note_revisions ADD CONSTRAINT note_revisions_scope_kind_check
  CHECK (scope_kind IN ('user', 'board', 'folio'));

CREATE FUNCTION folio_queue_live_revision() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
BEGIN
  IF TG_TABLE_NAME = 'notes' THEN
    IF TG_OP = 'DELETE' THEN
      IF OLD.folio_kind IS NULL THEN RETURN NULL; END IF;
    ELSIF TG_OP = 'INSERT' THEN
      IF NEW.folio_kind IS NULL THEN RETURN NULL; END IF;
    ELSE
      IF OLD.folio_kind IS NULL AND NEW.folio_kind IS NULL THEN RETURN NULL; END IF;
    END IF;
  END IF;
  PERFORM queue_note_revisions(ARRAY['folio']::text[], ARRAY['00000000-0000-4000-8000-000000000014'::uuid]);
  RETURN NULL;
END;
$$;
REVOKE ALL ON FUNCTION folio_queue_live_revision() FROM PUBLIC;

CREATE TRIGGER folio_notes_live AFTER INSERT OR UPDATE OR DELETE ON notes
  FOR EACH ROW EXECUTE FUNCTION folio_queue_live_revision();
CREATE TRIGGER folio_spaces_live AFTER INSERT OR UPDATE OR DELETE ON folio_spaces
  FOR EACH ROW EXECUTE FUNCTION folio_queue_live_revision();
CREATE TRIGGER folio_connections_live AFTER INSERT OR UPDATE OR DELETE ON folio_connections
  FOR EACH ROW EXECUTE FUNCTION folio_queue_live_revision();
CREATE TRIGGER folio_favorites_live AFTER INSERT OR DELETE ON folio_favorites
  FOR EACH ROW EXECUTE FUNCTION folio_queue_live_revision();
CREATE TRIGGER folio_tasks_live AFTER INSERT OR UPDATE OR DELETE ON tasks
  FOR EACH ROW EXECUTE FUNCTION folio_queue_live_revision();
CREATE TRIGGER folio_boards_live AFTER INSERT OR UPDATE OR DELETE ON boards
  FOR EACH ROW EXECUTE FUNCTION folio_queue_live_revision();
CREATE TRIGGER folio_board_members_live AFTER INSERT OR UPDATE OR DELETE ON board_members
  FOR EACH ROW EXECUTE FUNCTION folio_queue_live_revision();
CREATE TRIGGER folio_team_members_live AFTER INSERT OR UPDATE OR DELETE ON team_members
  FOR EACH ROW EXECUTE FUNCTION folio_queue_live_revision();
