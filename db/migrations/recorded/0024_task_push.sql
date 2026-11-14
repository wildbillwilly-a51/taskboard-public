CREATE TABLE task_push_devices (
  id UUID PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint TEXT NOT NULL UNIQUE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  label TEXT NOT NULL,
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_test_at TIMESTAMPTZ
);

CREATE INDEX task_push_devices_user_idx ON task_push_devices (user_id);

CREATE TABLE task_push_deliveries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  device_id UUID NOT NULL REFERENCES task_push_devices(id) ON DELETE CASCADE,
  board_id UUID NOT NULL REFERENCES boards(id) ON DELETE CASCADE,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  base_at TIMESTAMPTZ NOT NULL,
  trigger_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  attempts INTEGER NOT NULL DEFAULT 0,
  lease_token UUID,
  finished_at TIMESTAMPTZ,
  UNIQUE (device_id, board_id, task_id, base_at, trigger_at)
);

CREATE INDEX task_push_deliveries_ready_idx
  ON task_push_deliveries (available_at) WHERE finished_at IS NULL;
CREATE INDEX task_push_deliveries_expiry_idx ON task_push_deliveries (expires_at);
CREATE INDEX task_push_deliveries_task_idx ON task_push_deliveries (task_id);
CREATE INDEX task_push_deliveries_board_idx ON task_push_deliveries (board_id);

CREATE INDEX tasks_scheduled_push_trigger_idx ON tasks
  ((((COALESCE(due_at, start_at) AT TIME ZONE 'UTC') - reminder_offset_minutes * INTERVAL '1 minute') AT TIME ZONE 'UTC'))
  WHERE parent_task_id IS NULL AND deleted_at IS NULL AND archived_at IS NULL
    AND status <> 'done' AND NOT is_read_only_import AND NOT all_day
    AND reminder_offset_minutes IS NOT NULL;
