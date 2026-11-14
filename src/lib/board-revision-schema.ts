import type { PoolClient } from "pg";

// Board and note revisions, applied idempotently on every start by
// runMigrations. db/schema.sql carries the same definitions for a fresh
// database, and db/migrations/20261102_board_revisions.sql and
// 20261103_note_revisions.sql record the changes.
//
// Every statement that really changes a board's data bumps that board's
// revision, whoever the writer is: the app, other clients or plain SQL. Open pages compare the revision
// they hold with GET /api/board/revision and reload only when it moved.
//
// Triggers are statement-level with transition tables, so a bulk statement
// queues each board once, and a statement that touched no rows (the board
// loader's "insert if missing" housekeeping) queues nothing, which keeps a
// reload from causing another reload. The functions use SECURITY DEFINER.
//
// The bump itself happens at commit, from a deferred constraint trigger on
// board_revision_pending. A transaction therefore locks a board's revision row
// only for the moment before it commits, never while it goes on to lock task
// rows (which could deadlock with another writer), and it takes its revision
// number after obtaining that lock. So a board's revisions increase in commit
// order: a page that has seen revision N has seen every change committed with
// a revision up to N.
//
// Notes have revisions of their own, per scope: a person's personal notes
// ('user', owner) and a board's notes ('board', board). They are kept apart
// from board revisions so that typing in a board note, which autosaves about
// every second, does not reload that board's pages. Both kinds are bumped by
// one function, flush_live_revisions, from both pending tables: every
// transaction locks its board rows first and its note rows after, each in id
// order, so two transactions cannot lock them in opposite orders.

// Tables whose rows carry the board directly, keyed by that column.
export const boardKeyedRevisionTables: { table: string; column: "board_id" | "id" }[] = [
  { table: "boards", column: "id" },
  { table: "board_members", column: "board_id" },
  { table: "buckets", column: "board_id" },
  { table: "tasks", column: "board_id" },
  { table: "task_notes", column: "board_id" },
  { table: "labels", column: "board_id" },
  { table: "task_attachments", column: "board_id" },
  { table: "maintenance_locations", column: "board_id" },
  { table: "maintenance_outages", column: "board_id" },
  { table: "calendar_entries", column: "board_id" },
  { table: "imported_events", column: "board_id" },
  { table: "view_presets", column: "board_id" },
];

// Tables reached through their task. When the task is already gone (cascade
// delete), the tasks trigger has bumped its board.
export const taskKeyedRevisionTables = ["checklist_items", "task_labels"];

// Note tables, each reaching its scope a different way.
export const noteRevisionTables: { table: string; scope: NoteScopeSource }[] = [
  { table: "notes", scope: "note" },
  { table: "note_notebooks", scope: "owner" },
  { table: "note_tags", scope: "owner" },
  { table: "note_tag_links", scope: "note_id" },
  { table: "note_task_links", scope: "note_id" },
  { table: "note_labels", scope: "note_id" },
  { table: "note_attachments", scope: "note_id" },
];

// "note": the row is a note (a board note's scope is its board, a personal
// note's its owner; a move between them changes both). "owner": a personal
// notebook or tag. "note_id": a row of a note; when the note is already gone
// (cascade delete), the notes trigger has bumped its scope.
type NoteScopeSource = "note" | "owner" | "note_id";

const triggerFunctionFor = (column: "board_id" | "id" | "task_id") =>
  column === "task_id" ? "board_revision_by_task" : column === "id" ? "board_revision_by_board" : "board_revision_by_board_id";

// The changed rows' boards, from the transition tables this operation has.
function changedBoardsQuery(column: "board_id" | "id" | "task_id", op: "INSERT" | "UPDATE" | "DELETE") {
  const select = (rows: string) => `SELECT ${column} AS changed_id FROM ${rows}`;
  const changed =
    op === "INSERT" ? select("revision_new_rows")
      : op === "DELETE" ? select("revision_old_rows")
        : `${select("revision_old_rows")} UNION ${select("revision_new_rows")}`;
  return column === "task_id"
    ? `SELECT array_agg(DISTINCT t.board_id) INTO changed_boards FROM tasks t WHERE t.id IN (${changed})`
    : `SELECT array_agg(DISTINCT changed.changed_id) INTO changed_boards FROM (${changed}) changed`;
}

function triggerFunction(column: "board_id" | "id" | "task_id") {
  return `
    CREATE OR REPLACE FUNCTION ${triggerFunctionFor(column)}() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    DECLARE
      changed_boards UUID[];
    BEGIN
      IF TG_OP = 'INSERT' THEN
        ${changedBoardsQuery(column, "INSERT")};
      ELSIF TG_OP = 'DELETE' THEN
        ${changedBoardsQuery(column, "DELETE")};
      ELSE
        ${changedBoardsQuery(column, "UPDATE")};
      END IF;
      PERFORM queue_board_revisions(changed_boards);
      RETURN NULL;
    END;
    $$
  `;
}

function triggers(table: string, fn: string, prefix = "board_revision") {
  return [
    `CREATE OR REPLACE TRIGGER ${prefix}_insert AFTER INSERT ON ${table}
  REFERENCING NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION ${fn}()`,
    `CREATE OR REPLACE TRIGGER ${prefix}_update AFTER UPDATE ON ${table}
  REFERENCING OLD TABLE AS revision_old_rows NEW TABLE AS revision_new_rows FOR EACH STATEMENT EXECUTE FUNCTION ${fn}()`,
    `CREATE OR REPLACE TRIGGER ${prefix}_delete AFTER DELETE ON ${table}
  REFERENCING OLD TABLE AS revision_old_rows FOR EACH STATEMENT EXECUTE FUNCTION ${fn}()`,
  ];
}

const noteTriggerFunctionFor = (scope: NoteScopeSource) =>
  scope === "note" ? "note_revision_by_note" : scope === "owner" ? "note_revision_by_owner" : "note_revision_by_note_id";

// The changed rows' note scopes, as (kind, id) pairs.
function changedNoteScopesQuery(scope: NoteScopeSource, op: "INSERT" | "UPDATE" | "DELETE") {
  const columns =
    scope === "note" ? "board_id, owner_user_id" : scope === "owner" ? "owner_user_id" : "note_id";
  const select = (rows: string) => `SELECT ${columns} FROM ${rows}`;
  const changed =
    op === "INSERT" ? select("revision_new_rows")
      : op === "DELETE" ? select("revision_old_rows")
        : `${select("revision_old_rows")} UNION ${select("revision_new_rows")}`;
  const scopes =
    scope === "note"
      ? `SELECT CASE WHEN c.board_id IS NULL THEN 'user' ELSE 'board' END AS kind, COALESCE(c.board_id, c.owner_user_id) AS id FROM (${changed}) c`
      : scope === "owner"
        ? `SELECT 'user' AS kind, c.owner_user_id AS id FROM (${changed}) c`
        : `SELECT CASE WHEN n.board_id IS NULL THEN 'user' ELSE 'board' END AS kind, COALESCE(n.board_id, n.owner_user_id) AS id
           FROM notes n WHERE n.id IN (SELECT note_id FROM (${changed}) c)`;
  return `SELECT array_agg(s.kind), array_agg(s.id) INTO changed_kinds, changed_ids FROM (SELECT DISTINCT kind, id FROM (${scopes}) all_scopes) s`;
}

function noteTriggerFunction(scope: NoteScopeSource) {
  return `
    CREATE OR REPLACE FUNCTION ${noteTriggerFunctionFor(scope)}() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    DECLARE
      changed_kinds TEXT[];
      changed_ids UUID[];
    BEGIN
      IF TG_OP = 'INSERT' THEN
        ${changedNoteScopesQuery(scope, "INSERT")};
      ELSIF TG_OP = 'DELETE' THEN
        ${changedNoteScopesQuery(scope, "DELETE")};
      ELSE
        ${changedNoteScopesQuery(scope, "UPDATE")};
      END IF;
      PERFORM queue_note_revisions(changed_kinds, changed_ids);
      RETURN NULL;
    END;
    $$
  `;
}

// Points a pending table's constraint trigger at flush_live_revisions. One DO
// block is one statement, so the trigger is never missing: runMigrations
// commits each statement on its own, and a transaction committing between a
// separate DROP and CREATE would get no bump. An older app version reinstalls
// its own board-only trigger; it still bumps boards, and the notes trigger
// keeps flushing both.
function flushTrigger(trigger: string, table: string) {
  return `
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1
        FROM pg_trigger t
        JOIN pg_proc p ON p.oid = t.tgfoid
        WHERE t.tgrelid = '${table}'::regclass AND t.tgname = '${trigger}' AND p.proname = 'flush_live_revisions'
      ) THEN
        DROP TRIGGER IF EXISTS ${trigger} ON ${table};
        CREATE CONSTRAINT TRIGGER ${trigger} AFTER INSERT ON ${table}
          DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION flush_live_revisions();
      END IF;
    END
    $$
  `;
}

export const boardRevisionSchemaStatements = [
  `CREATE SEQUENCE IF NOT EXISTS board_revision_seq`,
  `
    CREATE TABLE IF NOT EXISTS board_revisions (
      board_id UUID PRIMARY KEY REFERENCES boards(id) ON DELETE CASCADE,
      revision BIGINT NOT NULL,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  // Boards changed by transactions that have not committed yet.
  `
    CREATE TABLE IF NOT EXISTS board_revision_pending (
      transaction_id XID8 NOT NULL DEFAULT pg_current_xact_id(),
      board_id UUID NOT NULL
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS board_revision_pending_transaction_idx
      ON board_revision_pending (transaction_id, board_id)
  `,
  `
    CREATE OR REPLACE FUNCTION queue_board_revisions(board_ids UUID[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    BEGIN
      IF board_ids IS NULL OR cardinality(board_ids) = 0 THEN
        RETURN;
      END IF;
      INSERT INTO board_revision_pending (board_id)
      SELECT DISTINCT changed.id
      FROM unnest(board_ids) AS changed(id)
      WHERE changed.id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM board_revision_pending pending
          WHERE pending.transaction_id = pg_current_xact_id() AND pending.board_id = changed.id
        );
    END;
    $$
  `,
  `
    CREATE TABLE IF NOT EXISTS note_revisions (
      scope_kind TEXT NOT NULL CHECK (scope_kind IN ('user', 'board')),
      scope_id UUID NOT NULL,
      revision BIGINT NOT NULL,
      changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (scope_kind, scope_id)
    )
  `,
  // Note scopes changed by transactions that have not committed yet.
  `
    CREATE TABLE IF NOT EXISTS note_revision_pending (
      transaction_id XID8 NOT NULL DEFAULT pg_current_xact_id(),
      scope_kind TEXT NOT NULL,
      scope_id UUID NOT NULL
    )
  `,
  `
    CREATE INDEX IF NOT EXISTS note_revision_pending_transaction_idx
      ON note_revision_pending (transaction_id, scope_kind, scope_id)
  `,
  `
    CREATE OR REPLACE FUNCTION queue_note_revisions(kinds TEXT[], ids UUID[]) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    BEGIN
      IF ids IS NULL OR cardinality(ids) = 0 THEN
        RETURN;
      END IF;
      INSERT INTO note_revision_pending (scope_kind, scope_id)
      SELECT DISTINCT changed.kind, changed.id
      FROM unnest(kinds, ids) AS changed(kind, id)
      WHERE changed.id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM note_revision_pending pending
          WHERE pending.transaction_id = pg_current_xact_id()
            AND pending.scope_kind = changed.kind AND pending.scope_id = changed.id
        );
    END;
    $$
  `,
  // Runs at commit. The first firing in a transaction bumps all its boards,
  // then all its note scopes, each in id order (so two committing transactions
  // lock revision rows in the same order); later firings find nothing left.
  // nextval in DO UPDATE runs after the row lock is held. Deleted boards are
  // skipped.
  `
    CREATE OR REPLACE FUNCTION flush_live_revisions() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    DECLARE
      flushed UUID[];
    BEGIN
      WITH mine AS (
        DELETE FROM board_revision_pending
        WHERE transaction_id = pg_current_xact_id()
        RETURNING board_id
      )
      SELECT array_agg(DISTINCT board_id) INTO flushed FROM mine;
      IF flushed IS NOT NULL THEN
        INSERT INTO board_revisions (board_id, revision, changed_at)
        SELECT b.id, nextval('board_revision_seq'), clock_timestamp()
        FROM boards b
        WHERE b.id = ANY(flushed)
        ORDER BY b.id
        ON CONFLICT (board_id) DO UPDATE
          SET revision = nextval('board_revision_seq'), changed_at = clock_timestamp();
      END IF;
      WITH mine AS (
        DELETE FROM note_revision_pending
        WHERE transaction_id = pg_current_xact_id()
        RETURNING scope_kind, scope_id
      )
      INSERT INTO note_revisions (scope_kind, scope_id, revision, changed_at)
      SELECT s.scope_kind, s.scope_id, nextval('board_revision_seq'), clock_timestamp()
      FROM (SELECT DISTINCT scope_kind, scope_id FROM mine) s
      ORDER BY s.scope_kind, s.scope_id
      ON CONFLICT (scope_kind, scope_id) DO UPDATE
        SET revision = nextval('board_revision_seq'), changed_at = clock_timestamp();
      RETURN NULL;
    END;
    $$
  `,
  // The Phase 1 board-only flush. Kept for an older app version, which
  // reinstalls its trigger with it; this version's triggers use
  // flush_live_revisions.
  `
    CREATE OR REPLACE FUNCTION flush_board_revisions() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
    DECLARE
      flushed UUID[];
    BEGIN
      WITH mine AS (
        DELETE FROM board_revision_pending
        WHERE transaction_id = pg_current_xact_id()
        RETURNING board_id
      )
      SELECT array_agg(DISTINCT board_id) INTO flushed FROM mine;
      IF flushed IS NULL THEN
        RETURN NULL;
      END IF;
      INSERT INTO board_revisions (board_id, revision, changed_at)
      SELECT b.id, nextval('board_revision_seq'), clock_timestamp()
      FROM boards b
      WHERE b.id = ANY(flushed)
      ORDER BY b.id
      ON CONFLICT (board_id) DO UPDATE
        SET revision = nextval('board_revision_seq'), changed_at = clock_timestamp();
      RETURN NULL;
    END;
    $$
  `,
  flushTrigger("board_revision_flush", "board_revision_pending"),
  flushTrigger("note_revision_flush", "note_revision_pending"),
  triggerFunction("board_id"),
  triggerFunction("id"),
  triggerFunction("task_id"),
  noteTriggerFunction("note"),
  noteTriggerFunction("owner"),
  noteTriggerFunction("note_id"),
  // Trigger functions need no EXECUTE grant to fire; nobody calls these directly.
  `REVOKE ALL ON FUNCTION queue_board_revisions(UUID[]) FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION queue_note_revisions(TEXT[], UUID[]) FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION flush_board_revisions() FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION flush_live_revisions() FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION board_revision_by_board_id() FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION board_revision_by_board() FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION board_revision_by_task() FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION note_revision_by_note() FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION note_revision_by_owner() FROM PUBLIC`,
  `REVOKE ALL ON FUNCTION note_revision_by_note_id() FROM PUBLIC`,
  ...boardKeyedRevisionTables.flatMap(({ table, column }) => triggers(table, triggerFunctionFor(column))),
  ...taskKeyedRevisionTables.flatMap((table) => triggers(table, triggerFunctionFor("task_id"))),
  // Note producers last, once their pending table and flush exist.
  ...noteRevisionTables.flatMap(({ table, scope }) => triggers(table, noteTriggerFunctionFor(scope), "note_revision")),
];

export async function ensureBoardRevisionSchema(client: PoolClient) {
  for (const statement of boardRevisionSchemaStatements) {
    await client.query(statement);
  }
}

// Read before the board's rows, so a page never claims a revision newer than
// the data it shows: a write landing mid-load only causes one more reload.
export async function readBoardRevision(client: PoolClient, boardId: string): Promise<number> {
  const result = await client.query<{ revision: string }>(
    `SELECT revision::text AS revision FROM board_revisions WHERE board_id = $1`,
    [boardId],
  );
  return Number(result.rows[0]?.revision ?? 0);
}

// The board and note revisions behind what a person's Notes can show: their
// personal notes and, for each board they can read, its notes and its board
// data (task titles, buckets and labels appear in Notes). Missing rows read 0.
export async function readNoteDependencyRevisions(
  client: Pick<PoolClient, "query">,
  userId: string,
  boardIds: string[],
) {
  const result = await client.query<{ key: string; revision: string }>(
    `
      SELECT 'notes:user' AS key, COALESCE(MAX(revision), 0)::text AS revision
      FROM note_revisions WHERE scope_kind = 'user' AND scope_id = $1
      UNION ALL
      SELECT 'notes:folio', COALESCE(MAX(revision),0)::text FROM note_revisions
      WHERE scope_kind='folio' AND scope_id='00000000-0000-4000-8000-000000000014'
      UNION ALL
      SELECT 'notes:' || ids.id::text, COALESCE(n.revision, 0)::text
      FROM unnest($2::uuid[]) AS ids(id)
      LEFT JOIN note_revisions n ON n.scope_kind = 'board' AND n.scope_id = ids.id
      UNION ALL
      SELECT 'board:' || ids.id::text, COALESCE(b.revision, 0)::text
      FROM unnest($2::uuid[]) AS ids(id)
      LEFT JOIN board_revisions b ON b.board_id = ids.id
    `,
    [userId, boardIds],
  );
  return Object.fromEntries(result.rows.map((row) => [row.key, Number(row.revision)]));
}
