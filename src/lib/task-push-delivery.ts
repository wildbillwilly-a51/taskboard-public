import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { getPool } from "@/lib/db";
import { ensureDatabaseReady } from "@/lib/taskboard-store";
import { taskReminderBase, taskReminderEligible, taskReminderTrigger } from "@/lib/task-reminder-sql";
import { isPushDatabase, sendTaskPush, taskPushConfig } from "@/lib/task-push-transport";

type PushConfig = NonNullable<ReturnType<typeof taskPushConfig>>;
const reminderWindow = "INTERVAL '10 minutes'";
const batchSize = 16;

const eligiblePushTask = `
  ${taskReminderEligible}
  AND NOT tasks.all_day
  AND tasks.reminder_offset_minutes IS NOT NULL
  AND boards.board_type = 'personal'
  AND NOT users.is_disabled
`;

export async function enqueueTaskPushes(pool: Pool) {
  await pool.query(`
    DELETE FROM task_push_deliveries WHERE expires_at < NOW() - INTERVAL '1 day'
  `);
  await pool.query(`
    INSERT INTO task_push_deliveries (device_id, board_id, task_id, base_at, trigger_at, expires_at)
    SELECT device.id, tasks.board_id, tasks.id,
      ${taskReminderBase}, ${taskReminderTrigger}, ${taskReminderTrigger} + ${reminderWindow}
    FROM tasks
    JOIN boards ON boards.id = tasks.board_id
    JOIN users ON users.id = boards.owner_user_id
    JOIN task_push_devices device ON device.user_id = users.id
    WHERE ${eligiblePushTask}
      AND ${taskReminderTrigger} <= NOW()
      AND ${taskReminderTrigger} > NOW() - ${reminderWindow}
      AND ${taskReminderTrigger} >= device.enrolled_at
    ON CONFLICT (device_id, board_id, task_id, base_at, trigger_at) DO NOTHING
  `);
}

export async function deliverTaskPush(
  pool: Pool,
  config: PushConfig,
  send: typeof sendTaskPush = sendTaskPush,
) {
  const token = randomUUID();
  const claim = await pool.query<{ id: string; attempts: number }>(`
    UPDATE task_push_deliveries
    SET lease_token = $1, available_at = NOW() + INTERVAL '30 seconds', attempts = attempts + 1
    WHERE id = (
      SELECT id FROM task_push_deliveries
      WHERE finished_at IS NULL AND available_at <= NOW() AND expires_at > NOW()
      ORDER BY available_at, id LIMIT 1 FOR UPDATE SKIP LOCKED
    )
    RETURNING id, attempts
  `, [token]);
  const delivery = claim.rows[0];
  if (!delivery) return false;

  const current = await pool.query<{
    device_id: string; endpoint: string; p256dh: string; auth: string;
    board_id: string; task_id: string; ttl: number;
  }>(`
    SELECT device.id AS device_id, device.endpoint, device.p256dh, device.auth, delivery.board_id,
      delivery.task_id, FLOOR(EXTRACT(EPOCH FROM delivery.expires_at - NOW()))::integer AS ttl
    FROM task_push_deliveries delivery
    JOIN task_push_devices device ON device.id = delivery.device_id
    JOIN users ON users.id = device.user_id
    JOIN boards ON boards.id = delivery.board_id AND boards.owner_user_id = device.user_id
    JOIN tasks ON tasks.id = delivery.task_id AND tasks.board_id = boards.id
    WHERE delivery.id = $1 AND delivery.lease_token = $2 AND delivery.available_at > NOW()
      AND ${eligiblePushTask}
      AND ${taskReminderBase} = delivery.base_at
      AND ${taskReminderTrigger} = delivery.trigger_at
  `, [delivery.id, token]);
  const target = current.rows[0];

  let status = 0;
  if (target && target.ttl > 0) {
    try {
      status = await send(config, {
        endpoint: target.endpoint,
        keys: { p256dh: target.p256dh, auth: target.auth },
      }, { id: delivery.id, boardId: target.board_id, taskId: target.task_id }, target.ttl);
    } catch {
      // Transport errors can include credentials. Retry without logging them.
    }
  }

  if (target && (status === 404 || status === 410)) {
    await pool.query(`
      DELETE FROM task_push_devices device
      USING task_push_deliveries delivery
      WHERE device.id = $1 AND device.p256dh = $2 AND device.auth = $3
        AND delivery.device_id = device.id AND delivery.id = $4 AND delivery.lease_token = $5
    `, [target.device_id, target.p256dh, target.auth, delivery.id, token]);
  } else if (target && target.ttl > 0 && delivery.attempts < 4 &&
             (status === 0 || status === 429 || status >= 500)) {
    await pool.query(`
      UPDATE task_push_deliveries
      SET lease_token = NULL, available_at = NOW() + $3 * INTERVAL '1 second'
      WHERE id = $1 AND lease_token = $2
    `, [delivery.id, token, 15 * 2 ** delivery.attempts]);
  } else {
    await pool.query(`
      UPDATE task_push_deliveries SET finished_at = NOW(), lease_token = NULL
      WHERE id = $1 AND lease_token = $2
    `, [delivery.id, token]);
  }
  return true;
}

declare global {
  var taskboardPushWorkerStarted: boolean | undefined;
}

export function startTaskPushWorker() {
  const config = taskPushConfig();
  const pool = getPool();
  if (!config || !pool || globalThis.taskboardPushWorkerStarted) return;
  const runTick = () => tick(pool, config);
  globalThis.taskboardPushWorkerStarted = true;
  let verified = false;

  async function tick(pool: Pool, config: PushConfig) {
    try {
      if (!verified) {
        if (!(await isPushDatabase(pool))) return;
        verified = true;
        console.info("Taskboard scheduled device alerts enabled.");
      }
      await ensureDatabaseReady();
      await enqueueTaskPushes(pool);
      for (let index = 0; index < batchSize; index++) {
        if (!(await deliverTaskPush(pool, config))) break;
      }
    } catch {
      console.error("Taskboard could not process scheduled alerts.");
    } finally {
      setTimeout(() => void runTick(), 15_000).unref();
    }
  }

  setTimeout(() => void runTick(), 1_000).unref();
}
