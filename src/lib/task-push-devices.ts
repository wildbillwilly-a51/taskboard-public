import { randomUUID } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { getPool } from "@/lib/db";
import { ensureDatabaseReady, getOrCreateUserRecord } from "@/lib/taskboard-store";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";
import { sendTaskPush, type PushSubscriptionData, taskPushConfig } from "@/lib/task-push-transport";

export { taskPushDeviceCookie } from "@/lib/task-push-device-cookie";

async function withPushAccount<T>(
  identity: TaskboardUserIdentity,
  query: (client: PoolClient, userId: string) => Promise<T>,
) {
  const pool = getPool();
  if (!pool) throw new Error("Taskboard persistence is unavailable.");
  await ensureDatabaseReady();
  const client = await pool.connect();
  try {
    const userId = identity.id ?? await getOrCreateUserRecord(client, identity);
    return await query(client, userId);
  } finally {
    client.release();
  }
}

export async function revokeForeignPushDevice(pool: Pool | PoolClient, userId: string, deviceId?: string) {
  if (!deviceId) return;
  await pool.query("DELETE FROM task_push_devices WHERE id = $1 AND user_id <> $2", [deviceId, userId]);
}

export function listPushDevices(identity: TaskboardUserIdentity, deviceId?: string) {
  return withPushAccount(identity, async (client, userId) => {
    await revokeForeignPushDevice(client, userId, deviceId);
    const { rows } = await client.query<{ id: string; label: string }>(`
      SELECT id, label FROM task_push_devices WHERE user_id = $1 ORDER BY enrolled_at DESC
    `, [userId]);
    return rows.map((device) => ({ ...device, current: device.id === deviceId }));
  });
}

export function registerPushDevice(
  identity: TaskboardUserIdentity,
  subscription: PushSubscriptionData,
  label: string,
  previousDeviceId?: string,
) {
  return withPushAccount(identity, async (client, userId) => {
    await client.query("BEGIN");
    try {
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 14929))", [subscription.endpoint]);
      const { rows } = await client.query<{ id: string; user_id: string; p256dh: string; auth: string }>(`
        SELECT id, user_id, p256dh, auth FROM task_push_devices WHERE endpoint = $1 FOR UPDATE
      `, [subscription.endpoint]);
      const existing = rows[0];
      if (existing && existing.user_id !== userId) {
        await client.query("DELETE FROM task_push_devices WHERE id = $1", [existing.id]);
        await client.query("COMMIT");
        return null;
      }

      const id = existing?.id ?? randomUUID();
      if (previousDeviceId && previousDeviceId !== id) {
        await client.query("DELETE FROM task_push_devices WHERE id = $1 AND user_id = $2", [previousDeviceId, userId]);
      }
      if (!existing) {
        await client.query(`
          INSERT INTO task_push_devices (id, user_id, endpoint, p256dh, auth, label)
          VALUES ($1, $2, $3, $4, $5, $6)
        `, [id, userId, subscription.endpoint, subscription.keys.p256dh, subscription.keys.auth, label]);
      } else if (existing.p256dh !== subscription.keys.p256dh || existing.auth !== subscription.keys.auth) {
        await client.query("DELETE FROM task_push_deliveries WHERE device_id = $1", [id]);
        await client.query(`
          UPDATE task_push_devices SET p256dh = $2, auth = $3, label = $4, enrolled_at = NOW()
          WHERE id = $1
        `, [id, subscription.keys.p256dh, subscription.keys.auth, label]);
      }
      await client.query("COMMIT");
      return id;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  });
}

export function removePushDevice(identity: TaskboardUserIdentity, deviceId: string) {
  return withPushAccount(identity, async (client, userId) => {
    await client.query("DELETE FROM task_push_devices WHERE id = $1 AND user_id = $2", [deviceId, userId]);
  });
}

export function sendPushTest(
  identity: TaskboardUserIdentity,
  deviceId: string,
  config: NonNullable<ReturnType<typeof taskPushConfig>>,
) {
  return withPushAccount(identity, async (client, userId) => {
    const { rows } = await client.query<{ endpoint: string; p256dh: string; auth: string }>(`
      UPDATE task_push_devices SET last_test_at = NOW()
      WHERE id = $1 AND user_id = $2 AND
        (last_test_at IS NULL OR last_test_at < NOW() - INTERVAL '30 seconds')
      RETURNING endpoint, p256dh, auth
    `, [deviceId, userId]);
    const device = rows[0];
    if (!device) {
      const result = await client.query("SELECT 1 FROM task_push_devices WHERE id = $1 AND user_id = $2", [deviceId, userId]);
      return result.rowCount ? 429 : 404;
    }
    let status: number;
    try {
      status = await sendTaskPush(config, {
        endpoint: device.endpoint,
        keys: { p256dh: device.p256dh, auth: device.auth },
      }, { id: "test" }, 60);
    } catch {
      return 502;
    }
    if (status === 404 || status === 410) {
      await client.query("DELETE FROM task_push_devices WHERE id = $1 AND p256dh = $2 AND auth = $3", [deviceId, device.p256dh, device.auth]);
      return 404;
    }
    return status >= 200 && status < 300 ? 200 : 502;
  });
}
