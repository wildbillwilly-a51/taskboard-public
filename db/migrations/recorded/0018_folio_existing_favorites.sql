SET LOCAL search_path = public, pg_catalog;
INSERT INTO folio_favorites(user_id,note_id)
SELECT owner_user_id,id FROM notes WHERE folio_kind IS NULL AND pinned_at IS NOT NULL
ON CONFLICT DO NOTHING;
