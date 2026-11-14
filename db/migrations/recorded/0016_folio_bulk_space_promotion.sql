SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '15s';

-- Row-level BEFORE promotion can modify another row in a multi-row DELETE and
-- PostgreSQL correctly refuses that operation. Repair the hierarchy once from
-- the deleted transition table, with FK validation deferred until commit.
DROP TRIGGER folio_space_promote ON folio_spaces;
ALTER TABLE folio_spaces DROP CONSTRAINT folio_spaces_parent_id_fkey;
ALTER TABLE folio_spaces ADD CONSTRAINT folio_spaces_parent_id_fkey
  FOREIGN KEY(parent_id) REFERENCES folio_spaces(id) DEFERRABLE INITIALLY DEFERRED;

CREATE FUNCTION folio_promote_deleted_spaces() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  WITH RECURSIVE ancestry AS (
    SELECT id AS deleted_id, parent_id, ARRAY[id] AS visited FROM folio_deleted_spaces
    UNION ALL
    SELECT a.deleted_id,d.parent_id,a.visited || d.id
    FROM ancestry a JOIN folio_deleted_spaces d ON d.id=a.parent_id
    WHERE NOT d.id=ANY(a.visited)
  ), destinations AS (
    SELECT a.deleted_id,
      CASE WHEN a.parent_id=ANY(a.visited) THEN NULL ELSE a.parent_id END AS parent_id
    FROM ancestry a
    WHERE a.parent_id IS NULL OR a.parent_id=ANY(a.visited)
      OR NOT EXISTS(SELECT 1 FROM folio_deleted_spaces d WHERE d.id=a.parent_id)
  )
  UPDATE folio_spaces s SET parent_id=d.parent_id,updated_at=clock_timestamp()
    FROM destinations d WHERE s.parent_id=d.deleted_id;
  RETURN NULL;
END;
$$;
CREATE TRIGGER folio_space_promote AFTER DELETE ON folio_spaces
  REFERENCING OLD TABLE AS folio_deleted_spaces
  FOR EACH STATEMENT EXECUTE FUNCTION folio_promote_deleted_spaces();
