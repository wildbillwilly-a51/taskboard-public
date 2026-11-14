import { Pool } from "pg";

declare global {
  var __taskboardPool: Pool | undefined;
}

function createPool() {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Connections serve concurrent DB work, not signed-in users. Ten per
    // process leaves room for other processes on a single 1–80 user host.
    max: positivePoolSetting("DATABASE_POOL_MAX", 10),
    connectionTimeoutMillis: positivePoolSetting("DATABASE_POOL_CONNECTION_TIMEOUT_MS", 5_000),
    idleTimeoutMillis: positivePoolSetting("DATABASE_POOL_IDLE_TIMEOUT_MS", 30_000),
  });
  pool.on("error", (error) => {
    console.error("An idle database connection failed.", { message: error.message });
  });
  return pool;
}

function positivePoolSetting(name: string, fallback: number) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!raw.trim() || !Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) {
    throw new Error(`${name} must be a positive integer no greater than 2147483647.`);
  }
  return value;
}

export function getPool() {
  if (!process.env.DATABASE_URL) {
    return null;
  }

  if (!global.__taskboardPool) {
    global.__taskboardPool = createPool() ?? undefined;
  }

  return global.__taskboardPool ?? null;
}

export function isDatabaseConfigured() {
  return Boolean(process.env.DATABASE_URL);
}
