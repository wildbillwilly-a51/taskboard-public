import type { PoolClient } from "pg";
import { ensureSubtaskRuleSchema, findSubtaskRuleViolations, SUBTASK_COLOR, SUBTASK_ICON } from "./legacy-subtask-rule";

// One-time clean-up that brings existing subtasks to the subtask rule
// (see subtask-rule.ts), then installs the rule, in one transaction. What a
// subtask held moves to the task at the top of its tree, so nothing written
// by a person is lost: notes become that task's working notes with a line
// naming the subtask, checklist items, files and linked Notes move with them.
// Labels, Active/Waiting, colors and icons are cleared, and the descriptions
// sample boards were seeded with are dropped (the owner chose this on
// 2026-11-03). Old values are kept in taskboard_data_repairs for reference.
export const simpleSubtasksRepairKey = "simple-subtasks-2026-11";

// The descriptions sample boards gave their subtasks before the rule.
export const legacySampleSubtaskDescriptions = [
  "Check where meetings are crowding work blocks.",
  "Turn notes and half-ideas into properly placed tasks.",
  "Move anything real onto the board and discard the rest.",
  "Separate structural entities from view preferences and imported events.",
  "Import calendar files.",
  "Track sync token and upsert imported events.",
  "Upload file, parse event, create imported event record.",
];

const subtaskPrefix = `'From subtask ''' || subtask_roots.title || ''':' || E'\\n\\n'`;

export async function simplifySubtasks(client: PoolClient) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS taskboard_data_repairs (
      key TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      details JSONB NOT NULL DEFAULT '{}'::jsonb
    )
  `);
  await client.query("BEGIN");
  try {
    await client.query(`SELECT pg_advisory_xact_lock(hashtext('taskboard:simple-subtasks'))`);
    const applied = await client.query(`SELECT 1 FROM taskboard_data_repairs WHERE key = $1`, [simpleSubtasksRepairKey]);
    if (applied.rows.length === 0) await cleanUpSubtasks(client);
    await ensureSubtaskRuleSchema(client);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function exists(client: PoolClient, table: string) {
  return Boolean((await client.query<{ e: string | null }>(`SELECT to_regclass($1) AS e`, [`public.${table}`])).rows[0]?.e);
}

async function cleanUpSubtasks(client: PoolClient) {
  // Nothing else writes tasks or their detail until this commits.
  const lockable = [];
  for (const table of ["tasks", "task_notes", "checklist_items", "task_attachments", "task_labels", "note_task_links", "task_public_shares"]) {
    if (await exists(client, table)) lockable.push(table);
  }
  await client.query(`LOCK TABLE ${lockable.join(", ")} IN SHARE ROW EXCLUSIVE MODE`);

  // Every subtask with the task at the top of its tree, Recycle Bin and
  // archived ones included, so the rule holds for every row.
  await client.query(`
    CREATE TEMP TABLE subtask_roots ON COMMIT DROP AS
    WITH RECURSIVE tree AS (
      SELECT id, id AS root_id FROM tasks WHERE parent_task_id IS NULL
      UNION ALL
      SELECT child.id, tree.root_id FROM tasks child JOIN tree ON child.parent_task_id = tree.id
    )
    SELECT tasks.id, tree.root_id, tasks.title, tasks.board_id
    FROM tree JOIN tasks ON tasks.id = tree.id
    WHERE tasks.parent_task_id IS NOT NULL
  `);
  const details: Record<string, unknown> = {};

  // Text kept on the subtask row rather than in a note of its own: a
  // description without its note, the legacy notes field, a next action.
  // It becomes one working note on the task.
  details.notesFromFields = (await client.query(`
    WITH text AS (
      SELECT subtask_roots.*, CONCAT_WS(E'\\n\\n',
        CASE WHEN BTRIM(tasks.summary) <> '' AND NOT (BTRIM(tasks.summary) = ANY($1::text[]))
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
    SELECT gen_random_uuid(), subtask_roots.board_id, subtask_roots.root_id, ${subtaskPrefix} || subtask_roots.body,
      'working', COALESCE(boards.owner_user_id, boards.created_by_user_id), COALESCE(subtask_roots.updated_at, NOW())
    FROM text AS subtask_roots JOIN boards ON boards.id = subtask_roots.board_id
    WHERE subtask_roots.body <> ''
    RETURNING id, task_id AS "taskId"
  `, [legacySampleSubtaskDescriptions])).rows;

  // Notes a person wrote move to the task as working notes, keeping their
  // author and time. A sample description is not one of them.
  details.movedNotes = (await client.query(`
    WITH moving AS (
      SELECT task_notes.id, task_notes.task_id AS old_task_id, task_notes.note_type AS old_note_type, task_notes.body AS old_body
      FROM task_notes JOIN subtask_roots ON subtask_roots.id = task_notes.task_id
      WHERE BTRIM(task_notes.body) <> ''
        AND NOT (task_notes.note_type = 'primary' AND BTRIM(task_notes.body) = ANY($1::text[]))
    )
    UPDATE task_notes SET task_id = subtask_roots.root_id, note_type = 'working',
      body = ${subtaskPrefix} || task_notes.body
    FROM moving JOIN subtask_roots ON subtask_roots.id = moving.old_task_id
    WHERE task_notes.id = moving.id
    RETURNING task_notes.id, moving.old_task_id AS "oldTaskId", task_notes.task_id AS "newTaskId",
      moving.old_note_type AS "oldNoteType", MD5(moving.old_body) AS "oldBodyMd5"
  `, [legacySampleSubtaskDescriptions])).rows;

  // Checklist items go to the end of the task's checklist, in order.
  details.movedChecklistItems = (await client.query(`
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
  `)).rows;

  // Files are stored by name, not by task, so moving one is a row change.
  details.movedFiles = (await client.query(`
    UPDATE task_attachments SET task_id = subtask_roots.root_id
    FROM subtask_roots WHERE task_attachments.task_id = subtask_roots.id
    RETURNING task_attachments.id, subtask_roots.id AS "oldTaskId", subtask_roots.root_id AS "newTaskId"
  `)).rows;

  details.movedNoteLinks = (await client.query(`
    INSERT INTO note_task_links (note_id, task_id, created_by_user_id, created_at)
    SELECT note_task_links.note_id, subtask_roots.root_id, note_task_links.created_by_user_id, note_task_links.created_at
    FROM note_task_links JOIN subtask_roots ON subtask_roots.id = note_task_links.task_id
    ON CONFLICT DO NOTHING
    RETURNING note_id AS "noteId", task_id AS "taskId"
  `)).rows;
  await client.query(`DELETE FROM note_task_links USING subtask_roots WHERE note_task_links.task_id = subtask_roots.id`);

  details.clearedLabels = (await client.query(`
    DELETE FROM task_labels USING subtask_roots, labels
    WHERE task_labels.task_id = subtask_roots.id AND labels.id = task_labels.label_id
    RETURNING task_labels.task_id AS "taskId", labels.name AS label
  `)).rows;

  details.revokedShares = (await client.query(`
    UPDATE task_public_shares SET revoked_at = NOW(), revoked_reason = 'subtask_simplified'
    FROM subtask_roots WHERE task_public_shares.task_id = subtask_roots.id AND task_public_shares.revoked_at IS NULL
    RETURNING task_public_shares.id, task_public_shares.task_id AS "taskId"
  `)).rows;

  // Derived rows the app rebuilds for tasks, and links that only made sense
  // for a task. Outage records cannot belong to a subtask in any version.
  const removed: Record<string, unknown[]> = {};
  for (const table of ["task_notifications", "task_suggestions", "maintenance_outages", "outage_people_details",
    "outage_people_teams", "outage_people_fields", "outage_people_history", "outage_people_mutations"]) {
    if (!(await exists(client, table))) continue;
    const rows = (await client.query(`DELETE FROM ${table} USING subtask_roots WHERE ${table}.task_id = subtask_roots.id
      RETURNING to_jsonb(${table}.*) AS row`)).rows;
    if (rows.length > 0) removed[table] = rows.map((row) => row.row);
  }
  details.removedRows = removed;
  details.unlinkedImportedEvents = (await client.query(`
    UPDATE imported_events SET task_id = NULL FROM subtask_roots WHERE imported_events.task_id = subtask_roots.id
    RETURNING imported_events.id, subtask_roots.id AS "taskId"
  `)).rows;

  // Empty descriptions and sample text are all that is left on subtasks.
  details.deletedSubtaskNotes = (await client.query(`
    DELETE FROM task_notes USING subtask_roots WHERE task_notes.task_id = subtask_roots.id
    RETURNING task_notes.id, task_notes.task_id AS "taskId", task_notes.note_type AS "noteType", BTRIM(task_notes.body) <> '' AS "hadSampleText"
  `)).rows;

  details.clearedFields = (await client.query(`
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
      color = '${SUBTASK_COLOR}', icon = '${SUBTASK_ICON}'
    FROM old WHERE tasks.id = old.id AND (
      old.status IN ('active', 'waiting') OR (old.reopen_status IS NOT NULL AND old.reopen_status <> 'todo')
      OR old.summary <> '' OR old.notes <> '' OR old.next_action <> '' OR old.due_at IS NOT NULL
      OR old.recurrence_rule IS NOT NULL OR old.recurrence_series_id IS NOT NULL OR old.reminder_offset_minutes IS NOT NULL
      OR old.overdue_reminder_enabled OR old.work_item_type <> 'task' OR COALESCE(old.source_type, 'native') <> 'native'
      OR old.source_record_id IS NOT NULL OR old.is_read_only_import
      OR old.color IS DISTINCT FROM '${SUBTASK_COLOR}' OR old.icon IS DISTINCT FROM '${SUBTASK_ICON}')
    RETURNING tasks.id, jsonb_strip_nulls(jsonb_build_object(
      'status', NULLIF(old.status, tasks.status), 'reopenStatus', old.reopen_status,
      'summary', NULLIF(old.summary, ''), 'notes', NULLIF(old.notes, ''), 'nextAction', NULLIF(old.next_action, ''),
      'dueAt', old.due_at, 'recurrenceRule', old.recurrence_rule, 'reminderOffsetMinutes', old.reminder_offset_minutes,
      'workItemType', NULLIF(old.work_item_type, 'task'), 'sourceType', NULLIF(old.source_type, 'native'),
      'sourceRecordId', old.source_record_id, 'color', NULLIF(old.color, '${SUBTASK_COLOR}'),
      'icon', NULLIF(old.icon, '${SUBTASK_ICON}'))) AS old
  `)).rows;

  const left = await findSubtaskRuleViolations(client);
  if (Object.keys(left).length > 0) {
    throw new Error(`Subtask clean-up left rows that break the subtask rule: ${JSON.stringify(left)}`);
  }
  await client.query(`INSERT INTO taskboard_data_repairs (key, details) VALUES ($1, $2::jsonb)`,
    [simpleSubtasksRepairKey, JSON.stringify(details)]);
}
