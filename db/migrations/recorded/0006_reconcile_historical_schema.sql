SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '15s';

-- Early installations added display_name with an empty default; newer frozen
-- CREATE TABLE text omitted it. Retain the more permissive historical default.
ALTER TABLE public.task_attachments ALTER COLUMN display_name SET DEFAULT '';

-- CREATE INDEX IF NOT EXISTS in the legacy initializer never replaced the
-- older predicate. Reconcile it transactionally, including fresh installations.
DROP INDEX IF EXISTS public.tasks_board_recurrence_series_idx;
CREATE INDEX tasks_board_recurrence_series_idx
  ON public.tasks (board_id, recurrence_series_id, due_at)
  WHERE recurrence_series_id IS NOT NULL AND deleted_at IS NULL AND archived_at IS NULL;
