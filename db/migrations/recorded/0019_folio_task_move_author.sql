SET LOCAL search_path = public, pg_catalog;
CREATE OR REPLACE FUNCTION folio_follow_task_board() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
  IF NEW.board_id IS DISTINCT FROM OLD.board_id AND EXISTS(SELECT 1 FROM folio_spaces WHERE task_id=NEW.id) THEN
    INSERT INTO folio_spaces(id,kind,title,board_id,created_by_user_id)
      SELECT gen_random_uuid(),'board',left(title,120),id,created_by_user_id FROM boards WHERE id=NEW.board_id
      ON CONFLICT DO NOTHING;
    UPDATE folio_spaces SET parent_id=(SELECT id FROM folio_spaces WHERE board_id=NEW.board_id),updated_at=clock_timestamp()
      WHERE task_id=NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
