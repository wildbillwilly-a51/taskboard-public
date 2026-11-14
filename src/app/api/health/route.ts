import { NextResponse } from "next/server";
import { getPool, isDatabaseConfigured } from "@/lib/db";
import { getAuthMode, isAuthConfigured } from "@/lib/auth";
import { getDatabaseSchemaStatus } from "@/lib/taskboard-store";
import { loadRecordedMigrations, readSchemaStatus, type SchemaStatus } from "@/lib/schema-migrations";

async function withDeadline<T>(work: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Database schema initialization is still pending.")), 5000);
    })]);
  } finally {
    clearTimeout(timer);
  }
}

export async function GET() {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { ok: false, database: "not_configured", schemaReady: false, schemaLevel: null, requiredSchemaLevel: null, auth: isAuthConfigured(), authMode: getAuthMode() },
      { status: 503 },
    );
  }

  let schema: SchemaStatus = { schemaReady: false, schemaLevel: null, requiredSchemaLevel: "baseline" };
  try {
    const migrations = await loadRecordedMigrations();
    schema.requiredSchemaLevel = migrations.at(-1)?.id ?? "baseline";
    schema = await withDeadline(getDatabaseSchemaStatus());
    return NextResponse.json({
      ok: schema.schemaReady,
      database: "ok",
      ...schema,
      auth: isAuthConfigured(),
      authMode: getAuthMode(),
    }, { status: schema.schemaReady ? 200 : 503 });
  } catch (error) {
    const pool = getPool();
    if (pool) {
      try { schema = await withDeadline(readSchemaStatus(pool)); } catch { /* Keep last known level. */ }
    }
    return NextResponse.json(
      {
        ok: false,
        database: "unavailable",
        ...schema,
        schemaReady: false,
        auth: isAuthConfigured(),
        authMode: getAuthMode(),
        error: error instanceof Error ? error.message : "Unknown database error.",
      },
      { status: 503 },
    );
  }
}
