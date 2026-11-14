import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { isLocalVisualDatabase, visualDatabaseName } from "../helpers/visual-database";

const databaseName = visualDatabaseName();

async function main() {
  const visualDatabaseUrl = process.env.DATABASE_URL?.trim();

  if (!visualDatabaseUrl) {
    throw new Error("DATABASE_URL is required to prepare the isolated visual-test database.");
  }
  if (!isLocalVisualDatabase(new URL(visualDatabaseUrl))) {
    throw new Error("DATABASE_URL must point to the configured isolated local visual-test database.");
  }

  const serverUrl = new URL(visualDatabaseUrl);
  serverUrl.pathname = "/postgres";

  const client = new Client({ connectionString: serverUrl.toString() });
  await client.connect();

  try {
    await client.query(
      "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid()",
      [databaseName],
    );
    await client.query(`DROP DATABASE IF EXISTS ${databaseName}`);
    await client.query(`CREATE DATABASE ${databaseName}`);
  } finally {
    await client.end();
  }

  const { ensureSchemaAndSeed } = await import("../../src/lib/taskboard-store");
  await ensureSchemaAndSeed();

  const visualClient = new Client({ connectionString: visualDatabaseUrl });
  await visualClient.connect();

  try {
    const seededBoard = await visualClient.query<Record<string, unknown>>(
      "SELECT * FROM boards ORDER BY created_at ASC LIMIT 1",
    );
    const sourceBoard = seededBoard.rows[0];

    if (!sourceBoard || typeof sourceBoard.id !== "string") {
      throw new Error("Visual database seeding did not create the expected board fixture.");
    }

    const sourceBoardId = sourceBoard.id;
    const visualBoardId = randomUUID();
    const columns = Object.keys(sourceBoard);
    const values = columns.map((column) => {
      if (column === "id") {
        return visualBoardId;
      }
      if (column === "created_at") {
        return new Date(0);
      }
      return sourceBoard[column];
    });
    const quotedColumns = columns.map((column) => `"${column}"`).join(", ");
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(", ");

    await visualClient.query("BEGIN");
    await visualClient.query(
      `INSERT INTO boards (${quotedColumns}) VALUES (${placeholders})`,
      values,
    );

    const references = await visualClient.query<{
      table_schema: string;
      table_name: string;
      column_name: string;
    }>(
      `
        SELECT tc.table_schema, tc.table_name, kcu.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND ccu.table_schema = 'public'
          AND ccu.table_name = 'boards'
          AND ccu.column_name = 'id'
      `,
    );

    for (const reference of references.rows) {
      const table = `"${reference.table_schema}"."${reference.table_name}"`;
      const column = `"${reference.column_name}"`;
      await visualClient.query(
        `UPDATE ${table} SET ${column} = $1 WHERE ${column} = $2`,
        [visualBoardId, sourceBoardId],
      );
    }

    const visualCalendarEntries = [
      {
        id: randomUUID(),
        title: "Overlapping review A",
        startsAt: "2026-07-20T15:00:00.000Z",
        endsAt: "2026-07-20T16:00:00.000Z",
        allDay: false,
      },
      {
        id: randomUUID(),
        title: "Overlapping review B",
        startsAt: "2026-07-20T15:15:00.000Z",
        endsAt: "2026-07-20T16:15:00.000Z",
        allDay: false,
      },
      {
        id: randomUUID(),
        title: "Multi-day maintenance window",
        startsAt: "2026-07-19T05:00:00.000Z",
        endsAt: "2026-07-23T05:00:00.000Z",
        allDay: true,
      },
    ];

    for (const entry of visualCalendarEntries) {
      await visualClient.query(
        `
          INSERT INTO calendar_entries (
            id, board_id, title, starts_at, ends_at, all_day, location,
            description, color, created_at, updated_at
          )
          VALUES ($1, $2, $3, $4, $5, $6, '', 'Visual regression fixture', '#14b8a6', NOW(), NOW())
        `,
        [
          entry.id,
          visualBoardId,
          entry.title,
          entry.startsAt,
          entry.endsAt,
          entry.allDay,
        ],
      );
    }

    await visualClient.query("COMMIT");
  } catch (error) {
    await visualClient.query("ROLLBACK");
    throw error;
  } finally {
    await visualClient.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
