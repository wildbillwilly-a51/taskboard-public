import "server-only";

import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { Pool, PoolClient } from "pg";

// This lineage starts with the clean public baseline. Future changes use recorded migrations.
const baselineId = "public_baseline";
export const BASELINE_CHECKSUM = "f875eb747336c3cb5dd7d01c6d219deac2a36fdd93d11bd8e2e58448fdfea819";
export const BASELINE_SQL_CHECKSUM = "ace6d522fb8a75d5a02e2a9599409ce9f23726960e6a7348efb1462d7f576375";
export const recordedMigrationsDirectory = path.join(process.cwd(), "db/migrations/recorded");

export type Migration = { id: string; checksum: string; sql: string };
export type SchemaStatus = {
  schemaReady: boolean;
  schemaLevel: string | null;
  requiredSchemaLevel: string;
};
type LedgerRow = { id: string; checksum: string };

export function migrationChecksum(source: string) {
  // Git's text=auto and Windows editors must not change migration identity.
  return createHash("sha256").update(source.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n")).digest("hex");
}

function assertTransactionalSql(sql: string, id: string) {
  // Ignore literals, identifiers and comments (including nested block comments),
  // so PL/pgSQL BEGIN/END inside dollar quotes is allowed. Migration files are
  // trusted code, but may not escape the transaction owned by this runner.
  const tokens: string[] = [];
  for (let i = 0; i < sql.length;) {
    const rest = sql.slice(i);
    if (rest.startsWith("--")) {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end + 1;
    } else if (rest.startsWith("/*")) {
      i += 2;
      let depth = 1;
      while (i < sql.length && depth) {
        if (sql.slice(i, i + 2) === "/*") { depth++; i += 2; }
        else if (sql.slice(i, i + 2) === "*/") { depth--; i += 2; }
        else i++;
      }
    } else if (rest[0] === "'" || rest[0] === '"') {
      const quote = rest[0];
      const escaped = quote === "'" && /[Ee]/.test(sql[i - 1] ?? "") &&
        (i < 2 || !/[A-Za-z_0-9$]/.test(sql[i - 2]));
      i++;
      while (i < sql.length) {
        if (sql[i] === quote) {
          i++;
          if (sql[i] !== quote) break;
        } else if (escaped && sql[i] === "\\") i++;
        i++;
      }
    } else {
      const dollar = rest.match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];
      if (dollar) {
        const end = sql.indexOf(dollar, i + dollar.length);
        i = end < 0 ? sql.length : end + dollar.length;
      } else {
        const word = rest.match(/^[A-Za-z_][A-Za-z_0-9$]*/)?.[0];
        if (word) { tokens.push(word.toUpperCase()); i += word.length; }
        else { if (rest[0] === ";") tokens.push(";"); i++; }
      }
    }
  }
  const controls = new Set(["BEGIN", "START", "COMMIT", "END", "ROLLBACK", "ABORT", "SAVEPOINT", "RELEASE"]);
  if (tokens.some((token, index) => token === "CONCURRENTLY" ||
    ((index === 0 || tokens[index - 1] === ";") && (controls.has(token) ||
      (token === "PREPARE" && tokens[index + 1] === "TRANSACTION"))))) {
    throw new Error(`Migration ${id} must not contain transaction control or CONCURRENTLY.`);
  }
}

export async function loadRecordedMigrations(directory = recordedMigrationsDirectory): Promise<Migration[]> {
  const files = (await readdir(directory, { withFileTypes: true })).filter((file) => file.name.toLowerCase().endsWith(".sql"));
  const numbers = new Set<string>();
  return Promise.all(files.sort((a, b) => a.name.localeCompare(b.name, "en")).map(async (file) => {
    const match = /^(\d{4})_[a-z0-9_]+\.sql$/.exec(file.name);
    if (!file.isFile() || !match || match[1] === "0000" || numbers.has(match[1])) {
      throw new Error(`Invalid or duplicate recorded migration filename: ${file.name}. Use NNNN_description.sql.`);
    }
    numbers.add(match[1]);
    const sql = (await readFile(path.join(directory, file.name), "utf8")).replace(/^\uFEFF/, "").replace(/\r\n/g, "\n");
    const id = file.name.slice(0, -4);
    assertTransactionalSql(sql, id);
    return { id, sql, checksum: migrationChecksum(sql) };
  }));
}

export function inspectMigrationLedger(rows: LedgerRow[], migrations: Migration[]): SchemaStatus {
  const known = [{ id: baselineId, checksum: BASELINE_CHECKSUM }, ...migrations];
  const applied = new Map(rows.map((row) => [row.id, row.checksum]));
  let level: string | null = null;
  let gap = false;
  for (const migration of known) {
    const checksum = applied.get(migration.id);
    if (checksum === undefined) gap = true;
    else {
      if (checksum !== migration.checksum) throw new Error(`Schema migration checksum mismatch for ${migration.id}; restore the original file. Startup refused.`);
      if (gap) throw new Error(`Schema migration ledger has a gap before ${migration.id}. Startup refused.`);
      level = migration.id;
    }
  }
  const highestNumber = migrations.at(-1)?.id.slice(0, 4) ?? "0000";
  for (const row of rows) {
    if (known.some((migration) => migration.id === row.id)) continue;
    // A newer binary may have applied a later suffix. Permit older binaries to
    // check their own required prefix; this does not promise schema compatibility.
    if (!/^\d{4}_[a-z0-9_]+$/.test(row.id) || row.id.slice(0, 4) <= highestNumber || gap) {
      throw new Error(`Unknown or out-of-order schema migration ${row.id}. Startup refused.`);
    }
  }
  return { schemaReady: !gap, schemaLevel: level, requiredSchemaLevel: known.at(-1)!.id };
}

async function ledgerStatus(client: Pick<PoolClient, "query">, migrations: Migration[]) {
  const result = await client.query<LedgerRow>("SELECT id, checksum FROM public.schema_migrations ORDER BY id");
  return inspectMigrationLedger(result.rows, migrations);
}

async function createLedger(client: PoolClient) {
  await client.query(`CREATE TABLE public.schema_migrations (
    id TEXT PRIMARY KEY,
    checksum TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
}

async function recordMigration(client: PoolClient, id: string, checksum: string) {
  await client.query("INSERT INTO public.schema_migrations (id, checksum) VALUES ($1, $2)", [id, checksum]);
}

export async function initializeSchema(options: {
  pool: Pool;
  baseline: (client: PoolClient) => Promise<void>;
  seed: (client: PoolClient) => Promise<void>;
  directory?: string;
}): Promise<SchemaStatus> {
  const migrations = await loadRecordedMigrations(options.directory);
  const client = await options.pool.connect();
  let failed = false;
  let destroy = false;
  try {
    // Two-int namespace is disjoint from the bigint/hashtext legacy repair locks.
    await client.query("SELECT pg_advisory_lock(1413631303, 1)");
    const detection = await client.query<{ ledger: string | null; boards: string | null }>(`SELECT
      to_regclass('public.schema_migrations') AS ledger, to_regclass('public.boards') AS boards`);
    if (!detection.rows[0].ledger) {
      if (detection.rows[0].boards) {
        throw new Error("This installation requires a Taskboard public database. Use a fresh database.");
      }
      await createLedger(client);
    }
    const rows = await client.query<LedgerRow>("SELECT id, checksum FROM public.schema_migrations");
    inspectMigrationLedger(rows.rows, migrations);
    if (!rows.rows.some((row) => row.id === baselineId)) {
      await options.baseline(client);
      await recordMigration(client, baselineId, BASELINE_CHECKSUM);
    }
    const applied = new Set(rows.rows.map((row) => row.id));
    for (const migration of migrations) {
      if (applied.has(migration.id)) continue;
      await client.query("BEGIN");
      await client.query(migration.sql);
      await recordMigration(client, migration.id, migration.checksum);
      await client.query("COMMIT");
    }
    await options.seed(client);
    const status = await ledgerStatus(client, migrations);
    if (!status.schemaReady) throw new Error(`Database has not reached required schema migration ${status.requiredSchemaLevel}.`);
    return status;
  } catch (error) {
    failed = true;
    try { await client.query("ROLLBACK"); } catch { destroy = true; }
    throw error;
  } finally {
    let unlockError: unknown;
    try {
      const result = await client.query<{ unlocked: boolean }>("SELECT pg_advisory_unlock(1413631303, 1) AS unlocked");
      if (!result.rows[0]?.unlocked) throw new Error("Schema migration advisory unlock failed.");
    } catch (error) {
      destroy = true;
      unlockError = error;
    }
    client.release(destroy);
    if (unlockError && !failed) throw unlockError;
  }
}

export async function readSchemaStatus(pool: Pick<PoolClient, "query">, directory = recordedMigrationsDirectory) {
  return ledgerStatus(pool, await loadRecordedMigrations(directory));
}
