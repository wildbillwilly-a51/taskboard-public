-- Release 2 cleanup, now in the runner transaction. Keep the legacy key too:
-- it excludes a pre-runner initializer during a mixed-version start.
SELECT pg_advisory_xact_lock(hashtext('taskboard:simple-subtasks'));
SET LOCAL search_path = public, pg_catalog;
SET LOCAL lock_timeout = '15s';
DO $migration$
DECLARE
  details jsonb := '{}'::jsonb;
  removed jsonb := '{}'::jsonb;
  rows jsonb;
  changed record;
BEGIN
  -- A complete baseline is required; never silently omit a trigger.
  IF to_regclass('public.task_notes') IS NULL THEN RAISE EXCEPTION 'Missing baseline table task_notes'; END IF;
  IF to_regclass('public.checklist_items') IS NULL THEN RAISE EXCEPTION 'Missing baseline table checklist_items'; END IF;
  IF to_regclass('public.task_attachments') IS NULL THEN RAISE EXCEPTION 'Missing baseline table task_attachments'; END IF;
  IF to_regclass('public.task_labels') IS NULL THEN RAISE EXCEPTION 'Missing baseline table task_labels'; END IF;
  IF to_regclass('public.note_task_links') IS NULL THEN RAISE EXCEPTION 'Missing baseline table note_task_links'; END IF;
  IF to_regclass('public.task_public_shares') IS NULL THEN RAISE EXCEPTION 'Missing baseline table task_public_shares'; END IF;
  IF to_regclass('public.task_notifications') IS NULL THEN RAISE EXCEPTION 'Missing baseline table task_notifications'; END IF;
  IF to_regclass('public.imported_events') IS NULL THEN RAISE EXCEPTION 'Missing baseline table imported_events'; END IF;
  IF to_regclass('public.maintenance_outages') IS NULL THEN RAISE EXCEPTION 'Missing baseline table maintenance_outages'; END IF;
  IF to_regclass('public.outage_people_details') IS NULL THEN RAISE EXCEPTION 'Missing baseline table outage_people_details'; END IF;
  IF to_regclass('public.outage_people_teams') IS NULL THEN RAISE EXCEPTION 'Missing baseline table outage_people_teams'; END IF;
  IF to_regclass('public.outage_people_fields') IS NULL THEN RAISE EXCEPTION 'Missing baseline table outage_people_fields'; END IF;
  IF to_regclass('public.outage_people_history') IS NULL THEN RAISE EXCEPTION 'Missing baseline table outage_people_history'; END IF;
  IF to_regclass('public.outage_people_mutations') IS NULL THEN RAISE EXCEPTION 'Missing baseline table outage_people_mutations'; END IF;
  IF NOT EXISTS (SELECT 1 FROM taskboard_data_repairs WHERE key='simple-subtasks-2026-11') THEN
    LOCK TABLE tasks, task_notes, checklist_items, task_attachments, task_labels, note_task_links, task_public_shares IN SHARE ROW EXCLUSIVE MODE;
    CREATE TEMP TABLE subtask_roots ON COMMIT DROP AS
    WITH RECURSIVE tree AS (
      SELECT id, id AS root_id FROM tasks WHERE parent_task_id IS NULL
      UNION ALL
      SELECT child.id, tree.root_id FROM tasks child JOIN tree ON child.parent_task_id = tree.id
    )
    SELECT tasks.id, tree.root_id, tasks.title, tasks.board_id
    FROM tree JOIN tasks ON tasks.id = tree.id
    WHERE tasks.parent_task_id IS NOT NULL;
    rows := '[]'::jsonb;
    FOR changed IN
      WITH text AS (
      SELECT subtask_roots.*, CONCAT_WS(E'\n\n',
        CASE WHEN BTRIM(tasks.summary) <> '' AND NOT (BTRIM(tasks.summary) = ANY(ARRAY['Check where meetings are crowding work blocks.', 'Turn notes and half-ideas into properly placed tasks.', 'Move anything real onto the board and discard the rest.', 'Separate structural entities from view preferences and imported events.', 'Import calendar files.', 'Track sync token and upsert imported events.', 'Upload file, parse event, create imported event record.']::text[]))
          AND NOT EXISTS (SELECT 1 FROM task_notes own WHERE own.task_id = tasks.id AND own.note_type = 'primary'
            AND BTRIM(own.body) = BTRIM(tasks.summary)) THEN BTRIM(tasks.summary) END,
        CASE WHEN BTRIM(tasks.notes) <> ''
          AND NOT EXISTS (SELECT 1 FROM task_notes own WHERE own.task_id = tasks.id AND own.note_type = 'working'
            AND BTRIM(own.body) = BTRIM(tasks.notes)) THEN BTRIM(tasks.notes) END,
        CASE WHEN BTRIM(tasks.next_action) <> '' THEN 'Next action: ' || BTRIM(tasks.next_action) END) AS body,
        tasks.updated_at
      FROM tasks JOIN subtask_roots ON subtask_roots.id = tasks.id
    )
    INSERT INTO task_notes (id, board_id, task_id, body, note_type, created_by_user_id, created_at)
    SELECT gen_random_uuid(), subtask_roots.board_id, subtask_roots.root_id, 'From subtask ''' || subtask_roots.title || ''':' || E'\n\n' || subtask_roots.body,
      'working', COALESCE(boards.owner_user_id, boards.created_by_user_id), COALESCE(subtask_roots.updated_at, NOW())
    FROM text AS subtask_roots JOIN boards ON boards.id = subtask_roots.board_id
    WHERE subtask_roots.body <> ''
    RETURNING id, task_id AS "taskId"
    LOOP rows := rows || jsonb_build_array(to_jsonb(changed)); END LOOP;
    details := jsonb_set(details, '{notesFromFields}', rows);
    rows := '[]'::jsonb;
    FOR changed IN
      WITH moving AS (
      SELECT task_notes.id, task_notes.task_id AS old_task_id, task_notes.note_type AS old_note_type, task_notes.body AS old_body
      FROM task_notes JOIN subtask_roots ON subtask_roots.id = task_notes.task_id
      WHERE BTRIM(task_notes.body) <> ''
        AND NOT (task_notes.note_type = 'primary' AND BTRIM(task_notes.body) = ANY(ARRAY['Check where meetings are crowding work blocks.', 'Turn notes and half-ideas into properly placed tasks.', 'Move anything real onto the board and discard the rest.', 'Separate structural entities from view preferences and imported events.', 'Import calendar files.', 'Track sync token and upsert imported events.', 'Upload file, parse event, create imported event record.']::text[]))
    )
    UPDATE task_notes SET task_id = subtask_roots.root_id, note_type = 'working',
      body = 'From subtask ''' || subtask_roots.title || ''':' || E'\n\n' || task_notes.body
    FROM moving JOIN subtask_roots ON subtask_roots.id = moving.old_task_id
    WHERE task_notes.id = moving.id
    RETURNING task_notes.id, moving.old_task_id AS "oldTaskId", task_notes.task_id AS "newTaskId",
      moving.old_note_type AS "oldNoteType", MD5(moving.old_body) AS "oldBodyMd5"
    LOOP rows := rows || jsonb_build_array(to_jsonb(changed)); END LOOP;
    details := jsonb_set(details, '{movedNotes}', rows);
    rows := '[]'::jsonb;
    FOR changed IN
      WITH base AS (
      SELECT task_id, MAX(sort_order) AS top FROM checklist_items GROUP BY task_id
    ), moving AS (
      SELECT checklist_items.id, checklist_items.task_id AS old_task_id, subtask_roots.root_id,
        COALESCE(base.top, 0) + 1000 * ROW_NUMBER() OVER (PARTITION BY subtask_roots.root_id
          ORDER BY subtask_roots.id, checklist_items.sort_order) AS new_order
      FROM checklist_items JOIN subtask_roots ON subtask_roots.id = checklist_items.task_id
      LEFT JOIN base ON base.task_id = subtask_roots.root_id
    )
    UPDATE checklist_items SET task_id = moving.root_id, sort_order = moving.new_order
    FROM moving WHERE checklist_items.id = moving.id
    RETURNING checklist_items.id, moving.old_task_id AS "oldTaskId", checklist_items.task_id AS "newTaskId"
    LOOP rows := rows || jsonb_build_array(to_jsonb(changed)); END LOOP;
    details := jsonb_set(details, '{movedChecklistItems}', rows);
    rows := '[]'::jsonb;
    FOR changed IN
      UPDATE task_attachments SET task_id = subtask_roots.root_id
    FROM subtask_roots WHERE task_attachments.task_id = subtask_roots.id
    RETURNING task_attachments.id, subtask_roots.id AS "oldTaskId", subtask_roots.root_id AS "newTaskId"
    LOOP rows := rows || jsonb_build_array(to_jsonb(changed)); END LOOP;
    details := jsonb_set(details, '{movedFiles}', rows);
    rows := '[]'::jsonb;
    FOR changed IN
      INSERT INTO note_task_links (note_id, task_id, created_by_user_id, created_at)
    SELECT note_task_links.note_id, subtask_roots.root_id, note_task_links.created_by_user_id, note_task_links.created_at
    FROM note_task_links JOIN subtask_roots ON subtask_roots.id = note_task_links.task_id
    ON CONFLICT DO NOTHING
    RETURNING note_id AS "noteId", task_id AS "taskId"
    LOOP rows := rows || jsonb_build_array(to_jsonb(changed)); END LOOP;
    details := jsonb_set(details, '{movedNoteLinks}', rows);
    DELETE FROM note_task_links USING subtask_roots WHERE note_task_links.task_id = subtask_roots.id;
    rows := '[]'::jsonb;
    FOR changed IN
      DELETE FROM task_labels USING subtask_roots, labels
    WHERE task_labels.task_id = subtask_roots.id AND labels.id = task_labels.label_id
    RETURNING task_labels.task_id AS "taskId", labels.name AS label
    LOOP rows := rows || jsonb_build_array(to_jsonb(changed)); END LOOP;
    details := jsonb_set(details, '{clearedLabels}', rows);
    rows := '[]'::jsonb;
    FOR changed IN
      UPDATE task_public_shares SET revoked_at = NOW(), revoked_reason = 'subtask_simplified'
    FROM subtask_roots WHERE task_public_shares.task_id = subtask_roots.id AND task_public_shares.revoked_at IS NULL
    RETURNING task_public_shares.id, task_public_shares.task_id AS "taskId"
    LOOP rows := rows || jsonb_build_array(to_jsonb(changed)); END LOOP;
    details := jsonb_set(details, '{revokedShares}', rows);
    rows := '[]'::jsonb;
    FOR changed IN
      DELETE FROM task_notifications USING subtask_roots WHERE task_notifications.task_id = subtask_roots.id
      RETURNING to_jsonb(task_notifications.*) AS row
    LOOP rows := rows || jsonb_build_array(to_jsonb(changed) -> 'row'); END LOOP;
    IF jsonb_array_length(rows) > 0 THEN removed := jsonb_set(removed, '{task_notifications}', rows); END IF;
    rows := '[]'::jsonb;
    FOR changed IN
      DELETE FROM maintenance_outages USING subtask_roots WHERE maintenance_outages.task_id = subtask_roots.id
      RETURNING to_jsonb(maintenance_outages.*) AS row
    LOOP rows := rows || jsonb_build_array(to_jsonb(changed) -> 'row'); END LOOP;
    IF jsonb_array_length(rows) > 0 THEN removed := jsonb_set(removed, '{maintenance_outages}', rows); END IF;
    rows := '[]'::jsonb;
    FOR changed IN
      DELETE FROM outage_people_details USING subtask_roots WHERE outage_people_details.task_id = subtask_roots.id
      RETURNING to_jsonb(outage_people_details.*) AS row
    LOOP rows := rows || jsonb_build_array(to_jsonb(changed) -> 'row'); END LOOP;
    IF jsonb_array_length(rows) > 0 THEN removed := jsonb_set(removed, '{outage_people_details}', rows); END IF;
    rows := '[]'::jsonb;
    FOR changed IN
      DELETE FROM outage_people_teams USING subtask_roots WHERE outage_people_teams.task_id = subtask_roots.id
      RETURNING to_jsonb(outage_people_teams.*) AS row
    LOOP rows := rows || jsonb_build_array(to_jsonb(changed) -> 'row'); END LOOP;
    IF jsonb_array_length(rows) > 0 THEN removed := jsonb_set(removed, '{outage_people_teams}', rows); END IF;
    rows := '[]'::jsonb;
    FOR changed IN
      DELETE FROM outage_people_fields USING subtask_roots WHERE outage_people_fields.task_id = subtask_roots.id
      RETURNING to_jsonb(outage_people_fields.*) AS row
    LOOP rows := rows || jsonb_build_array(to_jsonb(changed) -> 'row'); END LOOP;
    IF jsonb_array_length(rows) > 0 THEN removed := jsonb_set(removed, '{outage_people_fields}', rows); END IF;
    rows := '[]'::jsonb;
    FOR changed IN
      DELETE FROM outage_people_history USING subtask_roots WHERE outage_people_history.task_id = subtask_roots.id
      RETURNING to_jsonb(outage_people_history.*) AS row
    LOOP rows := rows || jsonb_build_array(to_jsonb(changed) -> 'row'); END LOOP;
    IF jsonb_array_length(rows) > 0 THEN removed := jsonb_set(removed, '{outage_people_history}', rows); END IF;
    rows := '[]'::jsonb;
    FOR changed IN
      DELETE FROM outage_people_mutations USING subtask_roots WHERE outage_people_mutations.task_id = subtask_roots.id
      RETURNING to_jsonb(outage_people_mutations.*) AS row
    LOOP rows := rows || jsonb_build_array(to_jsonb(changed) -> 'row'); END LOOP;
    IF jsonb_array_length(rows) > 0 THEN removed := jsonb_set(removed, '{outage_people_mutations}', rows); END IF;
    rows := '[]'::jsonb;
    FOR changed IN
      UPDATE imported_events SET task_id = NULL FROM subtask_roots WHERE imported_events.task_id = subtask_roots.id
    RETURNING imported_events.id, subtask_roots.id AS "taskId"
    LOOP rows := rows || jsonb_build_array(to_jsonb(changed)); END LOOP;
    details := jsonb_set(details, '{unlinkedImportedEvents}', rows);
    rows := '[]'::jsonb;
    FOR changed IN
      DELETE FROM task_notes USING subtask_roots WHERE task_notes.task_id = subtask_roots.id
    RETURNING task_notes.id, task_notes.task_id AS "taskId", task_notes.note_type AS "noteType", BTRIM(task_notes.body) <> '' AS "hadSampleText"
    LOOP rows := rows || jsonb_build_array(to_jsonb(changed)); END LOOP;
    details := jsonb_set(details, '{deletedSubtaskNotes}', rows);
    rows := '[]'::jsonb;
    FOR changed IN
      WITH old AS (
      SELECT tasks.id, tasks.status, tasks.reopen_status, tasks.summary, tasks.notes, tasks.next_action, tasks.due_at,
        tasks.recurrence_rule, tasks.recurrence_series_id, tasks.reminder_offset_minutes, tasks.overdue_reminder_enabled,
        tasks.work_item_type, tasks.source_type, tasks.source_record_id, tasks.is_read_only_import, tasks.color, tasks.icon
      FROM tasks JOIN subtask_roots ON subtask_roots.id = tasks.id
    )
    UPDATE tasks SET
      status = CASE WHEN tasks.status IN ('active', 'waiting') THEN 'todo' ELSE tasks.status END,
      reopen_status = CASE WHEN tasks.reopen_status = 'todo' THEN 'todo' ELSE NULL END,
      summary = '', notes = '', next_action = '', due_at = NULL,
      recurrence_rule = NULL, recurrence_series_id = NULL, reminder_offset_minutes = NULL, overdue_reminder_enabled = FALSE,
      work_item_type = 'task', source_type = 'native', source_record_id = NULL, is_read_only_import = FALSE,
      color = '#64748b', icon = 'layers'
    FROM old WHERE tasks.id = old.id AND (
      old.status IN ('active', 'waiting') OR (old.reopen_status IS NOT NULL AND old.reopen_status <> 'todo')
      OR old.summary <> '' OR old.notes <> '' OR old.next_action <> '' OR old.due_at IS NOT NULL
      OR old.recurrence_rule IS NOT NULL OR old.recurrence_series_id IS NOT NULL OR old.reminder_offset_minutes IS NOT NULL
      OR old.overdue_reminder_enabled OR old.work_item_type <> 'task' OR COALESCE(old.source_type, 'native') <> 'native'
      OR old.source_record_id IS NOT NULL OR old.is_read_only_import
      OR old.color IS DISTINCT FROM '#64748b' OR old.icon IS DISTINCT FROM 'layers')
    RETURNING tasks.id, jsonb_strip_nulls(jsonb_build_object(
      'status', NULLIF(old.status, tasks.status), 'reopenStatus', old.reopen_status,
      'summary', NULLIF(old.summary, ''), 'notes', NULLIF(old.notes, ''), 'nextAction', NULLIF(old.next_action, ''),
      'dueAt', old.due_at, 'recurrenceRule', old.recurrence_rule, 'reminderOffsetMinutes', old.reminder_offset_minutes,
      'workItemType', NULLIF(old.work_item_type, 'task'), 'sourceType', NULLIF(old.source_type, 'native'),
      'sourceRecordId', old.source_record_id, 'color', NULLIF(old.color, '#64748b'),
      'icon', NULLIF(old.icon, 'layers'))) AS old
    LOOP rows := rows || jsonb_build_array(to_jsonb(changed)); END LOOP;
    details := jsonb_set(details, '{clearedFields}', rows);
    details := jsonb_set(details, '{removedRows}', removed);
    IF (SELECT COUNT(*) FROM tasks WHERE NOT (
  parent_task_id IS NULL OR (
    status IN ('todo', 'done')
    AND (reopen_status IS NULL OR reopen_status = 'todo')
    AND summary = '' AND notes = '' AND next_action = ''
    AND due_at IS NULL AND recurrence_rule IS NULL AND recurrence_series_id IS NULL
    AND reminder_offset_minutes IS NULL AND overdue_reminder_enabled = FALSE
    AND work_item_type = 'task'
    AND COALESCE(source_type, 'native') = 'native' AND source_record_id IS NULL AND is_read_only_import = FALSE
    AND COALESCE(color, '#64748b') = '#64748b' AND COALESCE(icon, 'layers') = 'layers'
  ))) > 0 THEN RAISE EXCEPTION 'Subtask cleanup left rule violations'; END IF;
    IF (SELECT COUNT(*) FROM task_notes owned
       JOIN tasks ON tasks.id = owned.task_id WHERE tasks.parent_task_id IS NOT NULL) > 0 THEN RAISE EXCEPTION 'Subtask cleanup left rule violations'; END IF;
    IF (SELECT COUNT(*) FROM checklist_items owned
       JOIN tasks ON tasks.id = owned.task_id WHERE tasks.parent_task_id IS NOT NULL) > 0 THEN RAISE EXCEPTION 'Subtask cleanup left rule violations'; END IF;
    IF (SELECT COUNT(*) FROM task_attachments owned
       JOIN tasks ON tasks.id = owned.task_id WHERE tasks.parent_task_id IS NOT NULL) > 0 THEN RAISE EXCEPTION 'Subtask cleanup left rule violations'; END IF;
    IF (SELECT COUNT(*) FROM task_labels owned
       JOIN tasks ON tasks.id = owned.task_id WHERE tasks.parent_task_id IS NOT NULL) > 0 THEN RAISE EXCEPTION 'Subtask cleanup left rule violations'; END IF;
    IF (SELECT COUNT(*) FROM note_task_links owned
       JOIN tasks ON tasks.id = owned.task_id WHERE tasks.parent_task_id IS NOT NULL) > 0 THEN RAISE EXCEPTION 'Subtask cleanup left rule violations'; END IF;
    IF (SELECT COUNT(*) FROM task_public_shares owned
       JOIN tasks ON tasks.id = owned.task_id WHERE tasks.parent_task_id IS NOT NULL AND owned.revoked_at IS NULL) > 0 THEN RAISE EXCEPTION 'Subtask cleanup left rule violations'; END IF;
    IF (SELECT COUNT(*) FROM task_notifications owned
       JOIN tasks ON tasks.id = owned.task_id WHERE tasks.parent_task_id IS NOT NULL) > 0 THEN RAISE EXCEPTION 'Subtask cleanup left rule violations'; END IF;
    IF (SELECT COUNT(*) FROM imported_events owned
       JOIN tasks ON tasks.id = owned.task_id WHERE tasks.parent_task_id IS NOT NULL) > 0 THEN RAISE EXCEPTION 'Subtask cleanup left rule violations'; END IF;
    IF (SELECT COUNT(*) FROM maintenance_outages owned
       JOIN tasks ON tasks.id = owned.task_id WHERE tasks.parent_task_id IS NOT NULL) > 0 THEN RAISE EXCEPTION 'Subtask cleanup left rule violations'; END IF;
    IF (SELECT COUNT(*) FROM outage_people_details owned
       JOIN tasks ON tasks.id = owned.task_id WHERE tasks.parent_task_id IS NOT NULL) > 0 THEN RAISE EXCEPTION 'Subtask cleanup left rule violations'; END IF;
    IF (SELECT COUNT(*) FROM outage_people_teams owned
       JOIN tasks ON tasks.id = owned.task_id WHERE tasks.parent_task_id IS NOT NULL) > 0 THEN RAISE EXCEPTION 'Subtask cleanup left rule violations'; END IF;
    IF (SELECT COUNT(*) FROM outage_people_fields owned
       JOIN tasks ON tasks.id = owned.task_id WHERE tasks.parent_task_id IS NOT NULL) > 0 THEN RAISE EXCEPTION 'Subtask cleanup left rule violations'; END IF;
    IF (SELECT COUNT(*) FROM outage_people_history owned
       JOIN tasks ON tasks.id = owned.task_id WHERE tasks.parent_task_id IS NOT NULL) > 0 THEN RAISE EXCEPTION 'Subtask cleanup left rule violations'; END IF;
    IF (SELECT COUNT(*) FROM outage_people_mutations owned
       JOIN tasks ON tasks.id = owned.task_id WHERE tasks.parent_task_id IS NOT NULL) > 0 THEN RAISE EXCEPTION 'Subtask cleanup left rule violations'; END IF;
    INSERT INTO taskboard_data_repairs(key, details) VALUES ('simple-subtasks-2026-11', details);
  END IF;
END $migration$;

DO $migration$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public.tasks'::regclass AND conname='tasks_subtask_simple_check') THEN
    ALTER TABLE tasks ADD CONSTRAINT tasks_subtask_simple_check CHECK (
  parent_task_id IS NULL OR (
    status IN ('todo', 'done')
    AND (reopen_status IS NULL OR reopen_status = 'todo')
    AND summary = '' AND notes = '' AND next_action = ''
    AND due_at IS NULL AND recurrence_rule IS NULL AND recurrence_series_id IS NULL
    AND reminder_offset_minutes IS NULL AND overdue_reminder_enabled = FALSE
    AND work_item_type = 'task'
    AND COALESCE(source_type, 'native') = 'native' AND source_record_id IS NULL AND is_read_only_import = FALSE
    AND COALESCE(color, '#64748b') = '#64748b' AND COALESCE(icon, 'layers') = 'layers'
  ));
  END IF;
END $migration$;

CREATE OR REPLACE FUNCTION taskboard_refuse_subtask_owner() RETURNS trigger AS $$
    DECLARE
      owner_id UUID := (to_jsonb(NEW) ->> 'task_id')::uuid;
      owner_is_subtask BOOLEAN;
    BEGIN
      IF owner_id IS NULL THEN RETURN NEW; END IF;
      IF TG_TABLE_NAME = 'task_public_shares' AND (to_jsonb(NEW) ->> 'revoked_at') IS NOT NULL THEN RETURN NEW; END IF;
      SELECT parent_task_id IS NOT NULL INTO owner_is_subtask FROM tasks WHERE id = owner_id FOR SHARE;
      IF owner_is_subtask THEN
        RAISE EXCEPTION 'Subtasks only have a title, done, a time and work inside. Add notes, files and other details to the task.' USING ERRCODE = 'check_violation', CONSTRAINT = 'taskboard_subtask_owns_nothing';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER task_notes_subtask_rule BEFORE INSERT OR UPDATE OF task_id ON task_notes
      FOR EACH ROW EXECUTE FUNCTION taskboard_refuse_subtask_owner();

CREATE OR REPLACE TRIGGER checklist_items_subtask_rule BEFORE INSERT OR UPDATE OF task_id ON checklist_items
      FOR EACH ROW EXECUTE FUNCTION taskboard_refuse_subtask_owner();

CREATE OR REPLACE TRIGGER task_attachments_subtask_rule BEFORE INSERT OR UPDATE OF task_id ON task_attachments
      FOR EACH ROW EXECUTE FUNCTION taskboard_refuse_subtask_owner();

CREATE OR REPLACE TRIGGER task_labels_subtask_rule BEFORE INSERT OR UPDATE OF task_id ON task_labels
      FOR EACH ROW EXECUTE FUNCTION taskboard_refuse_subtask_owner();

CREATE OR REPLACE TRIGGER note_task_links_subtask_rule BEFORE INSERT OR UPDATE OF task_id ON note_task_links
      FOR EACH ROW EXECUTE FUNCTION taskboard_refuse_subtask_owner();

CREATE OR REPLACE TRIGGER task_public_shares_subtask_rule BEFORE INSERT OR UPDATE OF task_id, revoked_at ON task_public_shares
      FOR EACH ROW EXECUTE FUNCTION taskboard_refuse_subtask_owner();

CREATE OR REPLACE TRIGGER task_notifications_subtask_rule BEFORE INSERT OR UPDATE OF task_id ON task_notifications
      FOR EACH ROW EXECUTE FUNCTION taskboard_refuse_subtask_owner();


CREATE OR REPLACE TRIGGER imported_events_subtask_rule BEFORE INSERT OR UPDATE OF task_id ON imported_events
      FOR EACH ROW EXECUTE FUNCTION taskboard_refuse_subtask_owner();

CREATE OR REPLACE TRIGGER maintenance_outages_subtask_rule BEFORE INSERT OR UPDATE OF task_id ON maintenance_outages
      FOR EACH ROW EXECUTE FUNCTION taskboard_refuse_subtask_owner();

CREATE OR REPLACE TRIGGER outage_people_details_subtask_rule BEFORE INSERT OR UPDATE OF task_id ON outage_people_details
      FOR EACH ROW EXECUTE FUNCTION taskboard_refuse_subtask_owner();

CREATE OR REPLACE TRIGGER outage_people_teams_subtask_rule BEFORE INSERT OR UPDATE OF task_id ON outage_people_teams
      FOR EACH ROW EXECUTE FUNCTION taskboard_refuse_subtask_owner();

CREATE OR REPLACE TRIGGER outage_people_fields_subtask_rule BEFORE INSERT OR UPDATE OF task_id ON outage_people_fields
      FOR EACH ROW EXECUTE FUNCTION taskboard_refuse_subtask_owner();

CREATE OR REPLACE TRIGGER outage_people_history_subtask_rule BEFORE INSERT OR UPDATE OF task_id ON outage_people_history
      FOR EACH ROW EXECUTE FUNCTION taskboard_refuse_subtask_owner();

CREATE OR REPLACE TRIGGER outage_people_mutations_subtask_rule BEFORE INSERT OR UPDATE OF task_id ON outage_people_mutations
      FOR EACH ROW EXECUTE FUNCTION taskboard_refuse_subtask_owner();

CREATE OR REPLACE FUNCTION taskboard_refuse_detailed_task_as_subtask() RETURNS trigger AS $$
    BEGIN
      IF EXISTS (SELECT 1 FROM task_notes WHERE task_id = NEW.id) OR EXISTS (SELECT 1 FROM checklist_items WHERE task_id = NEW.id) OR EXISTS (SELECT 1 FROM task_attachments WHERE task_id = NEW.id) OR EXISTS (SELECT 1 FROM task_labels WHERE task_id = NEW.id) OR EXISTS (SELECT 1 FROM note_task_links WHERE task_id = NEW.id) OR EXISTS (SELECT 1 FROM task_public_shares WHERE task_id = NEW.id AND revoked_at IS NULL) OR EXISTS (SELECT 1 FROM task_notifications WHERE task_id = NEW.id) OR EXISTS (SELECT 1 FROM imported_events WHERE task_id = NEW.id) OR EXISTS (SELECT 1 FROM maintenance_outages WHERE task_id = NEW.id) OR EXISTS (SELECT 1 FROM outage_people_details WHERE task_id = NEW.id) OR EXISTS (SELECT 1 FROM outage_people_teams WHERE task_id = NEW.id) OR EXISTS (SELECT 1 FROM outage_people_fields WHERE task_id = NEW.id) OR EXISTS (SELECT 1 FROM outage_people_history WHERE task_id = NEW.id) OR EXISTS (SELECT 1 FROM outage_people_mutations WHERE task_id = NEW.id) THEN
        RAISE EXCEPTION 'Subtasks only have a title, done, a time and work inside. Add notes, files and other details to the task.' USING ERRCODE = 'check_violation', CONSTRAINT = 'taskboard_subtask_owns_nothing';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

CREATE OR REPLACE TRIGGER tasks_subtask_rule BEFORE UPDATE OF parent_task_id ON tasks
    FOR EACH ROW WHEN (OLD.parent_task_id IS NULL AND NEW.parent_task_id IS NOT NULL)
    EXECUTE FUNCTION taskboard_refuse_detailed_task_as_subtask();
