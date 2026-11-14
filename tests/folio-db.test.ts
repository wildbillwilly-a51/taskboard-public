import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import {
  folioNoteAccess,
  loadFolioMetadata,
} from "../src/lib/folio-store-access";
import type { Actor } from "../src/lib/notes-store-context";
import { isLocalVisualDatabase } from "./helpers/visual-database";
import { loadNoteRow } from "../src/lib/notes-store-access";
import {
  saveNoteContent,
  snapshotWikiNote,
} from "../src/lib/notes-content-store";
import {
  browseFolioTasks,
  changeFolioConnection,
  createFolioNote,
  createFolioSpace,
  getFolioLibrary,
  getFolioSpacePage,
  listFolioNotes,
  setFolioFavorite,
} from "../src/lib/folio-store";
import { getPool } from "../src/lib/db";
import { getNote, updateNote } from "../src/lib/notes-store";

test(
  "Folio SQL preserves independent notes across hidden links, lifecycle and hierarchy changes",
  {
    skip: process.env.FOLIO_DB_TEST !== "1",
    timeout: 30_000,
  },
  async () => {
    assert.ok(isLocalVisualDatabase(new URL(process.env.DATABASE_URL!)));
    assert.match(
      process.env.TASKBOARD_VISUAL_DATABASE_NAME ?? "",
      /^taskboard_visual_test_folio(?:_[a-z0-9_]+)?$/,
    );
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: 1,
    });
    const client = await pool.connect();
    await client.query("BEGIN");
    try {
      const owner = randomUUID(),
        other = randomUUID(),
        board = randomUUID(),
        task = randomUUID();
      const actor = (id: string): Actor => ({
        id,
        email: `${id}@example.invalid`,
        displayName: id,
        authMode: "authelia",
      });
      for (const id of [owner, other])
        await client.query(
          "INSERT INTO users(id,email,display_name) VALUES($1,$2,$3)",
          [id, `${id}@example.invalid`, id],
        );
      await client.query(
        "INSERT INTO boards(id,title,owner_user_id,board_type) VALUES($1,'Hidden board',$2,'personal')",
        [board, owner],
      );
      await client.query(
        "INSERT INTO tasks(id,board_id,title,status,sort_order) VALUES($1,$2,'Hidden task','todo',1)",
        [task, board],
      );
      const personal = randomUUID(),
        taskSpace = randomUUID(),
        boardSpace = randomUUID(),
        document = randomUUID();
      await client.query(
        "INSERT INTO folio_spaces(id,kind,title,owner_user_id,is_root) VALUES($1,'personal','Owner',$2,true)",
        [personal, owner],
      );
      await client.query(
        "INSERT INTO folio_spaces(id,kind,title,board_id) VALUES($1,'board','Board',$2)",
        [boardSpace, board],
      );
      await client.query(
        "INSERT INTO folio_spaces(id,kind,title,task_id,parent_id) VALUES($1,'task','Task',$2,$3)",
        [taskSpace, task, boardSpace],
      );
      await client.query(
        "INSERT INTO notes(id,owner_user_id,folio_kind,title) VALUES($1,$2,'document','Independent document')",
        [document, owner],
      );
      const row = {
        id: document,
        owner_user_id: owner,
        folio_kind: "document" as const,
      };
      const read = (id: string) =>
        folioNoteAccess(client, actor(id), row, async () => id === owner);
      assert.equal(
        (await read(other)).canRead,
        true,
        "zero connections are public",
      );
      await client.query(
        "INSERT INTO folio_connections(note_id,space_id) VALUES($1,$2)",
        [document, personal],
      );
      assert.equal(
        (await read(other)).canRead,
        false,
        "Personal-only is owner-only",
      );
      await client.query(
        "INSERT INTO folio_connections(note_id,space_id) VALUES($1,$2)",
        [document, taskSpace],
      );
      assert.equal(
        (await read(other)).canRead,
        true,
        "board access does not govern public document access",
      );
      const projected = await loadFolioMetadata(
        client,
        actor(other),
        row,
        async () => false,
      );
      assert.deepEqual(
        projected.connections,
        [],
        "neither hidden work nor another Personal placement is indicated",
      );
      assert.equal(projected.audience, "public");
      assert.equal(
        projected.unconnected,
        false,
        "empty viewer projection is not Unconnected",
      );

      await client.query("UPDATE tasks SET status='done' WHERE id=$1", [task]);
      assert.equal(
        (await read(other)).canRead,
        true,
        "completion is not archival",
      );
      await client.query("UPDATE tasks SET archived_at=now() WHERE id=$1", [
        task,
      ]);
      assert.equal(
        (await read(other)).canRead,
        false,
        "archive retires public placement, Personal remains",
      );
      await client.query(
        "DELETE FROM folio_connections WHERE note_id=$1 AND space_id=$2",
        [document, personal],
      );
      assert.equal(
        (await loadFolioMetadata(client, actor(other), row, async () => false))
          .unconnected,
        true,
      );
      await client.query("UPDATE tasks SET archived_at=NULL WHERE id=$1", [
        task,
      ]);
      assert.equal(
        (await loadFolioMetadata(client, actor(other), row, async () => false))
          .unconnected,
        false,
        "restore reactivates the existing connection",
      );
      await client.query("UPDATE boards SET archived_at=now() WHERE id=$1", [
        board,
      ]);
      assert.equal(
        (await loadFolioMetadata(client, actor(other), row, async () => false))
          .unconnected,
        true,
      );
      await client.query("UPDATE boards SET archived_at=NULL WHERE id=$1", [
        board,
      ]);

      const page = randomUUID(),
        file = randomUUID(),
        stored = `folio:${page}/${file}`;
      await client.query(
        "INSERT INTO notes(id,owner_user_id,folio_kind,folio_page_space_id) VALUES($1,$2,'space_page',$3)",
        [page, owner, taskSpace],
      );
      await snapshotWikiNote(client, actor(owner), page, "start");
      const pageRow = (await loadNoteRow(client, page))!;
      await saveNoteContent(client, actor(owner), pageRow, {
        expectedVersion: 1,
        title: "Customized page",
        folioPageState: {
          bannerAttachmentId: null,
          notesListVisible: false,
          notesListPosition: "before",
        },
      });
      const pageVersions = (
        await client.query<{ folio_page_state: { notesListVisible: boolean } }>(
          "SELECT folio_page_state FROM note_versions WHERE note_id=$1 ORDER BY version_number",
          [page],
        )
      ).rows;
      assert.equal(
        pageVersions.length,
        2,
        "managed page uses the existing version engine",
      );
      assert.equal(pageVersions[0].folio_page_state.notesListVisible, true);
      assert.equal(
        pageVersions[1].folio_page_state.notesListVisible,
        false,
        "layout is part of recoverable history",
      );
      await client.query(
        `INSERT INTO note_attachments(id,note_id,original_name,stored_name,mime_type,size_bytes)
      VALUES($1,$2,'fixture.png',$3,'image/png',1)`,
        [file, page, stored],
      );
      await client.query("DELETE FROM tasks WHERE id=$1", [task]);
      assert.equal(
        (await client.query("SELECT 1 FROM notes WHERE id=$1", [document]))
          .rowCount,
        1,
      );
      assert.equal(
        (await client.query("SELECT 1 FROM notes WHERE id=$1", [page]))
          .rowCount,
        0,
      );
      assert.equal(
        (
          await client.query(
            "SELECT 1 FROM folio_connections WHERE note_id=$1",
            [document],
          )
        ).rowCount,
        0,
      );
      assert.equal(
        (
          await client.query(
            "SELECT 1 FROM folio_file_cleanup WHERE stored_name=$1",
            [stored],
          )
        ).rowCount,
        1,
      );

      const parent = randomUUID(),
        child = randomUUID(),
        childNote = randomUUID();
      await client.query(
        "INSERT INTO folio_spaces(id,kind,title) VALUES($1,'shared','Parent')",
        [parent],
      );
      await client.query(
        "INSERT INTO folio_spaces(id,kind,title,parent_id) VALUES($1,'shared','Child',$2)",
        [child, parent],
      );
      await client.query(
        "INSERT INTO notes(id,owner_user_id,folio_kind) VALUES($1,$2,'document')",
        [childNote, owner],
      );
      await client.query(
        "INSERT INTO folio_connections(note_id,space_id) VALUES($1,$2),($3,$4)",
        [document, parent, childNote, child],
      );
      await client.query("DELETE FROM folio_spaces WHERE id=$1", [parent]);
      assert.equal(
        (
          await client.query("SELECT parent_id FROM folio_spaces WHERE id=$1", [
            child,
          ])
        ).rows[0].parent_id,
        null,
      );
      assert.equal(
        (
          await client.query(
            "SELECT 1 FROM folio_connections WHERE note_id=$1 AND space_id=$2",
            [childNote, child],
          )
        ).rowCount,
        1,
      );
      assert.equal(
        (
          await client.query(
            "SELECT 1 FROM folio_connections WHERE note_id=$1",
            [document],
          )
        ).rowCount,
        0,
      );
      const ancestor = randomUUID(),
        middle = randomUUID(),
        leaf = randomUUID();
      for (const [id, parentId] of [
        [ancestor, null],
        [middle, ancestor],
        [leaf, middle],
      ])
        await client.query(
          "INSERT INTO folio_spaces(id,kind,title,parent_id) VALUES($1,'shared','Bulk hierarchy',$2)",
          [id, parentId],
        );
      await client.query(
        "INSERT INTO folio_connections(note_id,space_id) VALUES($1,$2)",
        [document, leaf],
      );
      await client.query("DELETE FROM folio_spaces WHERE id=ANY($1::uuid[])", [
        [ancestor, middle],
      ]);
      assert.equal(
        (
          await client.query("SELECT parent_id FROM folio_spaces WHERE id=$1", [
            leaf,
          ])
        ).rows[0].parent_id,
        null,
        "bulk ancestor deletion promotes surviving descendants to the nearest surviving level",
      );
      assert.equal(
        (
          await client.query(
            "SELECT 1 FROM folio_connections WHERE note_id=$1 AND space_id=$2",
            [document, leaf],
          )
        ).rowCount,
        1,
      );

      const movedTask = randomUUID(),
        destination = randomUUID(),
        movedSpace = randomUUID();
      await client.query(
        "INSERT INTO boards(id,title,owner_user_id,board_type) VALUES($1,'Destination',$2,'personal')",
        [destination, owner],
      );
      await client.query(
        "INSERT INTO tasks(id,board_id,title,status,sort_order) VALUES($1,$2,'Restricted-role move','todo',1)",
        [movedTask, board],
      );
      await client.query(
        "INSERT INTO folio_spaces(id,kind,title,task_id,parent_id) VALUES($1,'task','Restricted-role move',$2,$3)",
        [movedSpace, movedTask, boardSpace],
      );
      const role = `folio_fixture_${randomUUID().replaceAll("-", "")}`;
      await client.query(`CREATE ROLE ${role}`);
      await client.query(
        `GRANT SELECT ON tasks,boards,buckets,users TO ${role}`,
      );
      await client.query(`GRANT UPDATE(board_id) ON tasks TO ${role}`);
      await client.query(
        `GRANT SELECT,UPDATE ON task_public_shares TO ${role}`,
      );
      await client.query("SAVEPOINT folio_denied_read");
      await client.query(`SET LOCAL ROLE ${role}`);
      await assert.rejects(
        client.query("SELECT id FROM folio_spaces LIMIT 1"),
        (error: unknown) => (error as { code?: string }).code === "42501",
      );
      await client.query("ROLLBACK TO SAVEPOINT folio_denied_read");
      await client.query(`SET LOCAL ROLE ${role}`);
      await client.query("UPDATE tasks SET board_id=$2 WHERE id=$1", [
        movedTask,
        destination,
      ]);
      await client.query("RESET ROLE");
      assert.equal(
        (
          await client.query(
            "SELECT p.board_id FROM folio_spaces s JOIN folio_spaces p ON p.id=s.parent_id WHERE s.id=$1",
            [movedSpace],
          )
        ).rows[0].board_id,
        destination,
        "source writes maintain derived Folio state without granting the restricted writer Folio access",
      );
    } finally {
      await client.query("ROLLBACK");
      client.release();
      await pool.end();
    }
  },
);

test(
  "Folio stores preserve hidden placements, scope favorites and revoke access after the final public removal",
  {
    skip: process.env.FOLIO_DB_TEST !== "1",
    timeout: 30_000,
  },
  async () => {
    assert.ok(isLocalVisualDatabase(new URL(process.env.DATABASE_URL!)));
    const pool = getPool()!;
    const owner = randomUUID(),
      other = randomUUID(),
      board = randomUUID(),
      task = randomUUID();
    const actor = (id: string): Actor => ({
      id,
      email: `${id}@example.invalid`,
      displayName: id,
      authMode: "authelia",
    });
    const sharedSpaces: string[] = [];
    try {
      for (const id of [owner, other])
        await pool.query(
          "INSERT INTO users(id,email,display_name) VALUES($1,$2,$3)",
          [id, `${id}@example.invalid`, id],
        );
      await pool.query(
        "INSERT INTO boards(id,title,owner_user_id,board_type) VALUES($1,'Owner board',$2,'personal')",
        [board, owner],
      );
      await pool.query(
        "INSERT INTO tasks(id,board_id,title,status,sort_order) VALUES($1,$2,'Owner task','todo',1)",
        [task, board],
      );
      const document = await createFolioNote(actor(owner), {
        title: "Shared body",
      });
      assert.equal(
        (await getNote(actor(other), document.id)).folio?.unconnected,
        true,
      );
      const library = await getFolioLibrary(actor(owner));
      await changeFolioConnection(
        actor(owner),
        document.id,
        library.rootSpaceId,
        true,
      );
      await assert.rejects(
        getNote(actor(other), document.id),
        (e: unknown) => e instanceof Error && e.name === "NotesNotFoundError",
      );
      const parent = await createFolioSpace(actor(owner), {
        title: `Network ${owner}`,
        parentId: null,
        personal: false,
      });
      sharedSpaces.push(parent.id);
      const child = await createFolioSpace(actor(other), {
        title: "Runbooks",
        parentId: parent.id,
        personal: false,
      });
      sharedSpaces.push(child.id);
      await changeFolioConnection(actor(owner), document.id, child.id, true);
      const visible = await getNote(actor(other), document.id);
      assert.deepEqual(
        visible.folio?.connections.map((c) => c.id),
        [child.id],
      );
      assert.equal(visible.folio?.audience, "public");
      await setFolioFavorite(actor(other), document.id, true);
      assert.equal(
        (await getNote(actor(other), document.id)).folio?.favorite,
        true,
      );
      assert.equal(
        (await getNote(actor(owner), document.id)).folio?.favorite,
        false,
      );
      await changeFolioConnection(actor(owner), document.id, parent.id, true);
      assert.equal(
        (
          await listFolioNotes(actor(other), {
            view: { kind: "space", spaceId: parent.id },
          })
        ).notes.filter((n) => n.id === document.id).length,
        1,
      );
      await changeFolioConnection(actor(other), document.id, parent.id, false);
      const revoked = await changeFolioConnection(
        actor(other),
        document.id,
        child.id,
        false,
      );
      assert.equal(revoked.unavailable, true);
      assert.equal(revoked.note, null);
      assert.equal(
        (
          await pool.query(
            "SELECT 1 FROM folio_connections WHERE note_id=$1 AND space_id=$2",
            [document.id, library.rootSpaceId],
          )
        ).rowCount,
        1,
      );
      await changeFolioConnection(actor(owner), document.id, child.id, true);
      const page = await getFolioSpacePage(actor(owner), parent.id);
      const updated = await updateNote(actor(other), page.id, {
        expectedVersion: page.contentVersion,
        folioPageState: {
          bannerAttachmentId: null,
          notesListVisible: false,
          notesListPosition: "before",
        },
      });
      assert.equal(updated.folio?.pageState.notesListVisible, false);
      assert.equal(
        (
          await pool.query(
            "SELECT count(*)::int AS count FROM note_versions WHERE note_id=$1",
            [page.id],
          )
        ).rows[0].count,
        2,
      );
      const targets = await browseFolioTasks(actor(owner), board);
      assert.equal(targets.spaces.length, 1);
      const taskDocument = await createFolioNote(actor(owner));
      await changeFolioConnection(
        actor(owner),
        taskDocument.id,
        targets.spaces[0].id,
        true,
      );
      const outside = await getNote(actor(other), taskDocument.id);
      assert.equal(outside.folio?.unconnected, false);
      assert.deepEqual(outside.folio?.connections, []);
    } finally {
      await pool.query(
        "DELETE FROM folio_spaces WHERE created_by_user_id=ANY($1::uuid[]) OR owner_user_id=ANY($1::uuid[]) OR id=ANY($2::uuid[])",
        [[owner, other], sharedSpaces],
      );
      await pool.query(
        "DELETE FROM notes WHERE owner_user_id=ANY($1::uuid[])",
        [[owner, other]],
      );
      await pool.query(
        "DELETE FROM boards WHERE id=$1 OR owner_user_id=ANY($2::uuid[])",
        [board, [owner, other]],
      );
      await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [
        [owner, other],
      ]);
      await pool.end();
    }
  },
);
