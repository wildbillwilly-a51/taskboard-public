SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '15s';
DROP INDEX notes_search_idx;
ALTER TABLE notes DROP COLUMN search_vector;
ALTER TABLE notes ADD COLUMN search_vector TSVECTOR GENERATED ALWAYS AS (
  setweight(to_tsvector('simple'::regconfig, coalesce(title,'')), 'A') ||
  setweight(to_tsvector('simple'::regconfig, coalesce(content_text,'')), 'B')
) STORED;
CREATE INDEX notes_search_idx ON notes USING GIN(search_vector);
