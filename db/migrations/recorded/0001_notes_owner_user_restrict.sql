DO $$
DECLARE
  owner_fk_name text;
  owner_fk_count integer;
BEGIN
  SELECT count(*), min(conname)
    INTO owner_fk_count, owner_fk_name
  FROM pg_constraint
  WHERE contype = 'f'
    AND conrelid = 'public.notes'::regclass
    AND confrelid = 'public.users'::regclass
    AND conkey = ARRAY[(SELECT attnum FROM pg_attribute WHERE attrelid = 'public.notes'::regclass AND attname = 'owner_user_id' AND NOT attisdropped)]::smallint[];

  IF owner_fk_count <> 1 THEN
    RAISE EXCEPTION 'Expected exactly one notes.owner_user_id foreign key to public.users, found %', owner_fk_count;
  END IF;

  EXECUTE format('ALTER TABLE public.notes DROP CONSTRAINT %I', owner_fk_name);
  EXECUTE 'ALTER TABLE public.notes ADD CONSTRAINT notes_owner_user_id_fkey FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT';
END $$;
