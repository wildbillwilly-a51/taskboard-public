import type { PoolClient } from "pg";

// What a subtask is: a title, done or not done, an optional time window
// (start, end, all-day), the work inside it, and its order. Everything else
// (description, working notes, linked Notes, files, checklist, labels, due
// date, reminders, recurrence, next action, Active/Waiting, color, icon,
// sharing) belongs to the task at the top of the tree. The owner decided this
// on 2026-11-03 so detail always lives in one place everyone looks.
//
// The database enforces the rule for every writer (app, shared links,
// ChatGPT, raw SQL); the checks here only turn a refusal into a clear message
// before the database has to.

export const SUBTASK_RULE_MESSAGE =
  "Subtasks only have a title, done, a time and work inside. Add notes, files and other details to the task.";

export const SUBTASK_COLOR = "#64748b";
export const SUBTASK_ICON = "layers";

// The fields a subtask save may carry.
export const SUBTASK_FIELDS = ["title", "status", "startAt", "endAt", "allDay"] as const;
const subtaskFields = new Set<string>(SUBTASK_FIELDS);

export class SubtaskRuleError extends Error {
  readonly status = 400;
  constructor(message = SUBTASK_RULE_MESSAGE) {
    super(message);
    this.name = "SubtaskRuleError";
  }
}

export function isSubtaskStatus(status: unknown): status is "todo" | "done" {
  return status === "todo" || status === "done";
}

// A field that is present is refused even when its value is empty: a
// subtask save must say only what a subtask has.
export function assertSubtaskPatch(patch: object) {
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) continue;
    if (!subtaskFields.has(key)) throw new SubtaskRuleError();
    if (key === "status" && !isSubtaskStatus(value)) {
      throw new SubtaskRuleError("A subtask is either done or not done.");
    }
  }
}

export const SUBTASK_RULE_CONSTRAINT = "tasks_subtask_simple_check";
const SUBTASK_OWNER_CONSTRAINT = "taskboard_subtask_owns_nothing";

// The database's refusal, as the same message the app gives.
export function subtaskRuleDatabaseError(error: unknown): SubtaskRuleError | null {
  const constraint = (error as { constraint?: unknown } | null)?.constraint;
  return constraint === SUBTASK_RULE_CONSTRAINT || constraint === SUBTASK_OWNER_CONSTRAINT
    ? new SubtaskRuleError()
    : null;
}

// Rows that belong to one task. A subtask may own none of them. Rows that
// only point at a subtask stay allowed: the People board's "working on"
// (outage_people_fields.linked_task_id) and a calendar entry's linked task.
export const TASK_OWNED_TABLES = [
  "task_notes",
  "checklist_items",
  "task_attachments",
  "task_labels",
  "note_task_links",
  "task_public_shares",
  "task_notifications",
  "task_suggestions",
  "imported_events",
  "maintenance_outages",
  "outage_people_details",
  "outage_people_teams",
  "outage_people_fields",
  "outage_people_history",
  "outage_people_mutations",
] as const;

const subtaskColumnRule = `
  parent_task_id IS NULL OR (
    status IN ('todo', 'done')
    AND (reopen_status IS NULL OR reopen_status = 'todo')
    AND summary = '' AND notes = '' AND next_action = ''
    AND due_at IS NULL AND recurrence_rule IS NULL AND recurrence_series_id IS NULL
    AND reminder_offset_minutes IS NULL AND overdue_reminder_enabled = FALSE
    AND work_item_type = 'task'
    AND COALESCE(source_type, 'native') = 'native' AND source_record_id IS NULL AND is_read_only_import = FALSE
    AND COALESCE(color, '${SUBTASK_COLOR}') = '${SUBTASK_COLOR}' AND COALESCE(icon, '${SUBTASK_ICON}') = '${SUBTASK_ICON}'
  )`;

// Every rule-breaking row, by table, for the release check. Empty means the
// database already follows the rule.
export async function findSubtaskRuleViolations(client: PoolClient) {
  const counts: Record<string, number> = {};
  const tasks = await client.query<{ count: string }>(`SELECT COUNT(*)::text AS count FROM tasks WHERE NOT (${subtaskColumnRule})`);
  if (Number(tasks.rows[0]?.count) > 0) counts.tasks = Number(tasks.rows[0].count);
  for (const table of TASK_OWNED_TABLES) {
    if (!(await tableExists(client, table))) continue;
    // A revoked share link is history, not something the subtask has.
    const active = table === "task_public_shares" ? " AND owned.revoked_at IS NULL" : "";
    const result = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM ${table} owned
       JOIN tasks ON tasks.id = owned.task_id WHERE tasks.parent_task_id IS NOT NULL${active}`,
    );
    if (Number(result.rows[0]?.count) > 0) counts[table] = Number(result.rows[0].count);
  }
  return counts;
}

async function tableExists(client: PoolClient, table: string) {
  const result = await client.query<{ exists: string | null }>(`SELECT to_regclass($1) AS exists`, [`public.${table}`]);
  return Boolean(result.rows[0]?.exists);
}

// Installs the rule. Safe to run on every start; the release's one-time
// clean-up runs first so existing rows already follow it.
export async function ensureSubtaskRuleSchema(client: PoolClient) {
  const existing = await client.query(`SELECT 1 FROM pg_constraint WHERE conname = $1 AND conrelid = 'tasks'::regclass`, [SUBTASK_RULE_CONSTRAINT]);
  if (existing.rows.length === 0) {
    await client.query(`ALTER TABLE tasks ADD CONSTRAINT ${SUBTASK_RULE_CONSTRAINT} CHECK (${subtaskColumnRule})`);
  }
  // Owned rows: the owner row is locked FOR SHARE before it is checked, and
  // a task gaining a parent holds its own row lock while it checks, so a
  // note added while its task becomes a subtask cannot slip past both.
  await client.query(`
    CREATE OR REPLACE FUNCTION taskboard_refuse_subtask_owner() RETURNS trigger AS $$
    DECLARE
      owner_id UUID := (to_jsonb(NEW) ->> 'task_id')::uuid;
      owner_is_subtask BOOLEAN;
    BEGIN
      IF owner_id IS NULL THEN RETURN NEW; END IF;
      IF TG_TABLE_NAME = 'task_public_shares' AND (to_jsonb(NEW) ->> 'revoked_at') IS NOT NULL THEN RETURN NEW; END IF;
      SELECT parent_task_id IS NOT NULL INTO owner_is_subtask FROM tasks WHERE id = owner_id FOR SHARE;
      IF owner_is_subtask THEN
        RAISE EXCEPTION '${SUBTASK_RULE_MESSAGE}' USING ERRCODE = 'check_violation', CONSTRAINT = '${SUBTASK_OWNER_CONSTRAINT}';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  for (const table of TASK_OWNED_TABLES) {
    if (!(await tableExists(client, table))) continue;
    const columns = table === "task_public_shares" ? "task_id, revoked_at" : "task_id";
    await client.query(`
      CREATE OR REPLACE TRIGGER ${table}_subtask_rule BEFORE INSERT OR UPDATE OF ${columns} ON ${table}
      FOR EACH ROW EXECUTE FUNCTION taskboard_refuse_subtask_owner()
    `);
  }
  const ownedChecks = [];
  for (const table of TASK_OWNED_TABLES) {
    if (!(await tableExists(client, table))) continue;
    const active = table === "task_public_shares" ? " AND revoked_at IS NULL" : "";
    ownedChecks.push(`EXISTS (SELECT 1 FROM ${table} WHERE task_id = NEW.id${active})`);
  }
  // No path makes a task a subtask today; if one is added, the task must
  // already be plain, or its detail would be hidden inside the tree.
  await client.query(`
    CREATE OR REPLACE FUNCTION taskboard_refuse_detailed_task_as_subtask() RETURNS trigger AS $$
    BEGIN
      IF ${ownedChecks.join(" OR ") || "FALSE"} THEN
        RAISE EXCEPTION '${SUBTASK_RULE_MESSAGE}' USING ERRCODE = 'check_violation', CONSTRAINT = '${SUBTASK_OWNER_CONSTRAINT}';
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql
  `);
  await client.query(`
    CREATE OR REPLACE TRIGGER tasks_subtask_rule BEFORE UPDATE OF parent_task_id ON tasks
    FOR EACH ROW WHEN (OLD.parent_task_id IS NULL AND NEW.parent_task_id IS NOT NULL)
    EXECUTE FUNCTION taskboard_refuse_detailed_task_as_subtask()
  `);
}
