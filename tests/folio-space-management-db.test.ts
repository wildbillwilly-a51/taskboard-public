import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { getPool } from "../src/lib/db";
import {
  changeFolioConnection, createFolioNote, createFolioSpace,
  getFolioLibrary, getFolioSpacePage, manageFolioSpace, manageFolioSpaces,
} from "../src/lib/folio-store";
import { getNote, NotesNotFoundError } from "../src/lib/notes-store";
import type { Actor } from "../src/lib/notes-store-context";
import { isLocalVisualDatabase } from "./helpers/visual-database";

test("Folio moves and batch operations preserve hierarchy, access, and atomicity", {
  skip: process.env.FOLIO_DB_TEST !== "1",
  timeout: 60_000,
}, async () => {
  assert.ok(isLocalVisualDatabase(new URL(process.env.DATABASE_URL!)));
  const pool = getPool()!;
  const makeActor = (role: Actor["role"]): Actor => {
    const id = randomUUID();
    return { id, email: `${id}@example.invalid`, displayName: id, role, authMode: "authelia", authProvider: "authelia" };
  };
  const owner = makeActor("standard");
  const other = makeActor("admin");
  const actors = [owner.id, other.id];
  const create = async (title: string, parentId: string | null, personal: boolean) =>
    (await createFolioSpace(owner, { title, parentId, personal })).id;
  const lookup = async (id: string) => (await getFolioLibrary(owner)).spaces.find(space => space.id === id);

  try {
    for (const actor of [owner, other]) {
      await pool.query("INSERT INTO users(id,email,display_name,role) VALUES($1,$2,$3,$4)", [
        actor.id, actor.email, actor.displayName, actor.role,
      ]);
    }
    const root = (await getFolioLibrary(owner)).rootSpaceId;
    const imported = await create("Imported procedures", root, true);
    const child = await create("Child folder", imported, true);
    const second = await create("Imported references", root, true);
    const destination = await create("Team knowledge", null, false);
    const collision = await create("IMPORTED REFERENCES", destination, false);
    const note = await createFolioNote(owner, { title: "Imported note" });
    await changeFolioConnection(owner, note.id, child, true);
    const page = await getFolioSpacePage(owner, child);

    await assert.rejects(getNote(other, note.id), NotesNotFoundError);
    await assert.rejects(getNote(other, page.id), NotesNotFoundError);
    await assert.rejects(manageFolioSpace(other, imported, { parentId: null, share: true }), NotesNotFoundError);
    await assert.rejects(manageFolioSpace(owner, root, { parentId: null, share: true }), /permanent/);
    await assert.rejects(manageFolioSpace(owner, imported, { parentId: null }), /Confirm the Folio destination/);
    await assert.rejects(manageFolioSpaces(owner, [imported, second], { parentId: child }), /inside itself/);
    await assert.rejects(manageFolioSpaces(owner, [imported, second], { parentId: destination, share: true }), /already exists/);
    assert.equal((await lookup(imported))?.parentId, root, "a failed batch must not publish its first branch");
    await assert.rejects(getNote(other, note.id), NotesNotFoundError);

    await manageFolioSpace(owner, collision, { title: "Existing reference" });
    await manageFolioSpaces(owner, [child, imported, second], { parentId: destination, share: true });
    for (const id of [imported, child, second]) {
      const space = await lookup(id);
      assert.equal(space?.kind, "shared");
      assert.equal(space?.ownerUserId, null);
      assert.equal(space?.parentId, id === child ? imported : destination);
    }
    assert.equal((await getNote(other, note.id)).folio?.connections[0].id, child);
    assert.equal((await getNote(other, page.id)).folio?.pageSpaceId, child);
    assert.equal((await lookup(child))?.pageNoteId, page.id);
    await assert.rejects(manageFolioSpace(owner, imported, { parentId: root }), /Folio location/);

    await manageFolioSpace(owner, imported, { parentId: null });
    assert.equal((await lookup(imported))?.parentId, null);
    await manageFolioSpaces(owner, [second, imported, child, collision], { archived: true });
    assert.equal((await lookup(second))?.archived, true);
    assert.equal((await lookup(collision))?.archived, true);
    assert.equal((await lookup(child))?.archived, true);
    await manageFolioSpace(owner, imported, { archived: false });
    assert.equal((await lookup(child))?.archived, false, "a selected child restores with its archived parent");
    await manageFolioSpace(owner, second, { archived: false });
    assert.equal((await lookup(second))?.archived, false);

    const keep = await create("Surviving folder", child, false);
    await assert.rejects(manageFolioSpaces(owner, [imported, root], { remove: true }), /permanent/);
    assert.ok(await lookup(imported));
    await manageFolioSpaces(owner, [imported, child], { remove: true });
    assert.equal(await lookup(imported), undefined);
    assert.equal(await lookup(child), undefined);
    assert.equal((await lookup(keep))?.parentId, null);
    assert.equal((await getNote(other, note.id)).folio?.unconnected, true);
    await assert.rejects(getNote(owner, page.id), NotesNotFoundError);
  } finally {
    await pool.query("DELETE FROM folio_spaces WHERE owner_user_id=ANY($1::uuid[]) OR created_by_user_id=ANY($1::uuid[])", [actors]);
    await pool.query("DELETE FROM notes WHERE owner_user_id=ANY($1::uuid[])", [actors]);
    await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [actors]);
    await pool.end();
  }
});
