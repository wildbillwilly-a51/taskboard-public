// All callers alias the task relation as "tasks".
export const taskReminderBase = "COALESCE(tasks.due_at, tasks.start_at)";
export const taskReminderTrigger = `(((${taskReminderBase} AT TIME ZONE 'UTC') - tasks.reminder_offset_minutes * INTERVAL '1 minute') AT TIME ZONE 'UTC')`;
export const taskReminderEligible = `
  tasks.parent_task_id IS NULL
  AND tasks.deleted_at IS NULL
  AND tasks.archived_at IS NULL
  AND tasks.status <> 'done'
  AND NOT tasks.is_read_only_import
  AND ${taskReminderBase} IS NOT NULL
`;
