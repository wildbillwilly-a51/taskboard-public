SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '15s';

ALTER TABLE wiki_spaces ADD COLUMN topics_version INTEGER NOT NULL DEFAULT 1 CHECK (topics_version > 0);
CREATE TABLE wiki_topics (
  id UUID PRIMARY KEY CHECK (id <> '00000000-0000-0000-0000-000000000000'::uuid),
  space_id UUID NOT NULL REFERENCES wiki_spaces(id) ON DELETE CASCADE,
  parent_topic_id UUID,
  title TEXT NOT NULL CHECK (title = btrim(title) AND char_length(title) BETWEEN 1 AND 120),
  sort_order NUMERIC(20,10) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(id, space_id),
  FOREIGN KEY(parent_topic_id, space_id) REFERENCES wiki_topics(id, space_id) ON DELETE NO ACTION,
  CHECK(parent_topic_id IS DISTINCT FROM id)
);
CREATE UNIQUE INDEX wiki_topics_sibling_name_key ON wiki_topics
  (space_id, COALESCE(parent_topic_id, '00000000-0000-0000-0000-000000000000'::uuid), LOWER(title));
CREATE INDEX wiki_topics_tree_idx ON wiki_topics(space_id,parent_topic_id,sort_order,id);
CREATE TABLE wiki_page_topics (
  note_id UUID NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  topic_id UUID NOT NULL REFERENCES wiki_topics(id) ON DELETE CASCADE,
  PRIMARY KEY(note_id,topic_id)
);
CREATE INDEX wiki_page_topics_topic_idx ON wiki_page_topics(topic_id,note_id);
