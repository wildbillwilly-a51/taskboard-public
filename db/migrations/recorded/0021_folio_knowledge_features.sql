-- Additive Folio knowledge features. Existing documents and audiences are unchanged.
CREATE TABLE folio_note_features (
 note_id uuid PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
 maintainer_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 review_due date, reviewed_at timestamptz, reviewed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 is_template boolean NOT NULL DEFAULT false
);
CREATE INDEX folio_review_due_idx ON folio_note_features(review_due) WHERE review_due IS NOT NULL;
CREATE INDEX folio_maintainer_idx ON folio_note_features(maintainer_user_id);
CREATE TABLE folio_recent_views (
 user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
 viewed_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(user_id,note_id)
);
CREATE INDEX folio_recent_view_order_idx ON folio_recent_views(user_id,viewed_at DESC);
CREATE INDEX folio_recent_note_idx ON folio_recent_views(note_id);
CREATE TABLE folio_note_shares (
 id uuid PRIMARY KEY, note_id uuid NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
 mode text NOT NULL CHECK(mode IN ('read','write')), token_hash text UNIQUE NOT NULL,
 token_ciphertext text NOT NULL, created_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL,
 created_at timestamptz NOT NULL DEFAULT now(), revoked_at timestamptz
);
CREATE UNIQUE INDEX folio_note_share_active_idx ON folio_note_shares(note_id,mode) WHERE revoked_at IS NULL;
CREATE INDEX folio_note_share_creator_idx ON folio_note_shares(created_by_user_id);
CREATE TABLE folio_share_admissions (
 share_id uuid NOT NULL REFERENCES folio_note_shares(id) ON DELETE CASCADE,
 minute timestamptz NOT NULL, requests integer NOT NULL DEFAULT 0, bytes bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(share_id,minute)
);
CREATE TABLE folio_share_mutations (
 share_id uuid NOT NULL REFERENCES folio_note_shares(id) ON DELETE CASCADE,
 mutation_id uuid NOT NULL, request_hash text NOT NULL, result_version integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(share_id,mutation_id)
);
ALTER TABLE notes ADD COLUMN updated_via_share_id uuid REFERENCES folio_note_shares(id) ON DELETE SET NULL;
ALTER TABLE note_versions ADD COLUMN author_share_id uuid REFERENCES folio_note_shares(id) ON DELETE SET NULL;
ALTER TABLE note_attachments ADD COLUMN uploaded_via_share_id uuid REFERENCES folio_note_shares(id) ON DELETE SET NULL;
ALTER TABLE notes ADD CONSTRAINT notes_one_editor CHECK(updated_by_user_id IS NULL OR updated_via_share_id IS NULL);
ALTER TABLE note_versions ADD CONSTRAINT note_versions_one_author CHECK(author_user_id IS NULL OR author_share_id IS NULL);
ALTER TABLE note_attachments ADD CONSTRAINT note_attachments_one_uploader CHECK(uploaded_by_user_id IS NULL OR uploaded_via_share_id IS NULL);
CREATE INDEX notes_share_editor_idx ON notes(updated_via_share_id);
CREATE INDEX note_versions_share_author_idx ON note_versions(author_share_id);
CREATE INDEX note_attachments_share_uploader_idx ON note_attachments(uploaded_via_share_id);
-- Existing signed-in operations explicitly set updated_by_user_id. Clear the
-- previous anonymous marker when those operations take over a document.
CREATE FUNCTION folio_signed_editor_provenance() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.updated_by_user_id IS NOT NULL AND NEW.updated_by_user_id IS DISTINCT FROM OLD.updated_by_user_id
 AND NEW.updated_via_share_id IS NOT DISTINCT FROM OLD.updated_via_share_id THEN NEW.updated_via_share_id=NULL; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER folio_signed_editor BEFORE UPDATE ON notes FOR EACH ROW EXECUTE FUNCTION folio_signed_editor_provenance();
-- Backfill explicit note mentions; future writes also index ordinary Folio links.
INSERT INTO note_links(source_note_id,target_note_id)
 SELECT DISTINCT n.id,t.id FROM notes n
 CROSS JOIN LATERAL jsonb_path_query(n.content_json,'$.** ? (@.type == "pageMention").props.noteId') AS mentioned(value)
 JOIN notes t ON t.id::text=trim(both '"' from mentioned.value::text)
 WHERE n.folio_kind IS NOT NULL AND t.folio_kind IS NOT NULL AND n.id<>t.id
 ON CONFLICT DO NOTHING;
