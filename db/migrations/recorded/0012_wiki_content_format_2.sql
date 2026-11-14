SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '15s';
-- This is a wire-format identity conversion, not a user edit. The statement
-- revision trigger would otherwise advance live counters and their sequence.
-- Hold the table lock through this migration transaction and restore the exact
-- trigger mode (including a deliberately disabled/replica/always trigger).
DO $$
DECLARE revision_trigger_mode "char";
BEGIN
  SELECT tgenabled INTO STRICT revision_trigger_mode FROM pg_trigger
  WHERE tgrelid='public.notes'::regclass AND tgname='note_revision_update';
  ALTER TABLE notes DISABLE TRIGGER note_revision_update;
  UPDATE notes SET content_format_version = 2
  WHERE wiki_space_id IS NOT NULL AND content_format_version = 1
    AND NOT jsonb_path_exists(content_json, '$.** ? (@.type == "pageMention")');
  EXECUTE 'ALTER TABLE notes ' || CASE revision_trigger_mode
    WHEN 'O' THEN 'ENABLE' WHEN 'R' THEN 'ENABLE REPLICA'
    WHEN 'A' THEN 'ENABLE ALWAYS' WHEN 'D' THEN 'DISABLE'
  END || ' TRIGGER note_revision_update';
END;
$$;
-- Preserve anomalous/future rows for audit.
UPDATE note_versions v SET content_format_version = 2
WHERE v.content_format_version = 1
  AND EXISTS (SELECT 1 FROM notes n WHERE n.id=v.note_id AND n.wiki_space_id IS NOT NULL)
  AND NOT jsonb_path_exists(v.content_json, '$.** ? (@.type == "pageMention")');
