SET LOCAL search_path = public, pg_catalog;
-- Source work-item writes can originate in the existing restricted connector.
-- The application-owned triggers maintain Folio's derived rows without granting
-- that connector direct access to Folio notes, spaces or connections.
ALTER FUNCTION folio_follow_task_board() SECURITY DEFINER;
ALTER FUNCTION folio_promote_deleted_spaces() SECURITY DEFINER;
ALTER FUNCTION folio_queue_deleted_note_files() SECURITY DEFINER;
REVOKE ALL ON FUNCTION folio_follow_task_board() FROM PUBLIC;
REVOKE ALL ON FUNCTION folio_promote_deleted_spaces() FROM PUBLIC;
REVOKE ALL ON FUNCTION folio_queue_deleted_note_files() FROM PUBLIC;
