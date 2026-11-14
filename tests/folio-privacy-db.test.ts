import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { getPool } from "../src/lib/db";
import { NotesNotFoundError, createNote, getNote, getNoteAttachmentDownload, updateNote } from "../src/lib/notes-store";
import { browseFolioTasks, changeFolioConnection, createFolioNote, folioHistory, getFolioHistoryVersion, getFolioLibrary, listFolioNotes, searchFolioTargets } from "../src/lib/folio-store";
import { BoardAccessError } from "../src/lib/board-access";
import { addPersonalBoardMember, getBoardPrivacySettings, getBoardStateFromDatabase, listPersonalBoardMemberCandidates, listPersonalBoardMembers, updateBoardPrivacySettings } from "../src/lib/taskboard-store";
import type { TaskboardUserIdentity } from "../src/lib/taskboard-request";
import { isLocalVisualDatabase } from "./helpers/visual-database";

test("administration is separate from board grants and Personal note access", { skip: process.env.FOLIO_DB_TEST !== "1" }, async () => {
  assert.ok(isLocalVisualDatabase(new URL(process.env.DATABASE_URL!)));
  const pool = getPool()!;
  const identity = (role: "standard" | "admin"): TaskboardUserIdentity & { id: string } => {
    const id = randomUUID();
    return { id, email: `${id}@example.invalid`, username: id, displayName: id, role, authMode: "authelia", authProvider: "authelia", isDisabled: false };
  };
  const owner = identity("standard"), admin = identity("admin");
  let boardId = "";
  try {
    for (const u of [owner, admin]) await pool.query("INSERT INTO users(id,email,username,display_name,role) VALUES($1,$2,$3,$4,$5)", [u.id,u.email,u.username,u.displayName,u.role]);
    boardId = randomUUID();
    await pool.query("INSERT INTO boards(id,title,board_type,owner_user_id) VALUES($1,'Same board name','personal',$2)", [boardId,owner.id]);
    const taskId = randomUUID();
    await pool.query("INSERT INTO tasks(id,board_id,title,status,sort_order) VALUES($1,$2,'Owner task','todo',1)", [taskId,boardId]);
    const legacy = await createNote(owner, { title: "Owner personal note" });
    const library = await getFolioLibrary(owner);
    const personal = await createFolioNote(owner);
    await changeFolioConnection(owner,personal.id,library.rootSpaceId,true);
    const publicNote = await createFolioNote(owner);
    const taskSpace = (await browseFolioTasks(owner,boardId)).spaces[0];
    const mixed = await createFolioNote(owner);
    await changeFolioConnection(owner,mixed.id,library.rootSpaceId,true);
    await changeFolioConnection(owner,mixed.id,taskSpace.id,true);
    const hidden = (e: unknown) => e instanceof NotesNotFoundError;
    const absentBoard = (e: unknown) => e instanceof BoardAccessError && e.status === 404;
    await assert.rejects(getBoardStateFromDatabase(admin,{boardId}), (e: unknown) => e instanceof BoardAccessError && e.status === 403);
    assert.equal((await getFolioLibrary(admin)).spaces.some(s=>s.boardId===boardId),false);
    assert.equal((await searchFolioTargets(admin,"Same board")).spaces.some(s=>s.boardId===boardId),false);
    for (const note of [legacy, personal]) {
      await assert.rejects(getNote(admin,note.id),hidden);
      await assert.rejects(updateNote(admin,note.id,{title:"Forbidden"}),hidden);
      await assert.rejects(getNoteAttachmentDownload(admin,note.id,randomUUID()),hidden);
      await assert.rejects(folioHistory(admin,note.id),hidden);
      await assert.rejects(getFolioHistoryVersion(admin,note.id,randomUUID()),hidden);
    }
    const listed = await listFolioNotes(admin,{view:{kind:"home"}});
    assert.equal(listed.notes.some(n=>n.id===personal.id),false);
    assert.equal((await getNote(admin,publicNote.id)).folio?.audience,"public");
    const visibleMixed = await getNote(admin,mixed.id);
    assert.equal(visibleMixed.folio?.audience,"public");
    assert.deepEqual(visibleMixed.folio?.connections,[]);
    for (const role of [null,"viewer","editor","owner"] as const) {
      await pool.query("DELETE FROM board_members WHERE board_id=$1 AND user_id=$2",[boardId,admin.id]);
      if(role) await pool.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,$3)",[boardId,admin.id,role]);
      for (const op of [()=>getBoardPrivacySettings(admin,boardId),()=>updateBoardPrivacySettings(admin,boardId,{personalVisibility:"private",personalVisibilityTeamId:null}),()=>listPersonalBoardMembers(admin,boardId),()=>listPersonalBoardMemberCandidates(admin,boardId,"Owner"),()=>addPersonalBoardMember(admin,boardId,{userId:admin.id,role:"editor"})]) await assert.rejects(op(),absentBoard);
      if(role) {
        const state = await getBoardStateFromDatabase(admin,{boardId});
        assert.equal(state?.boardAccess.level,role);
        assert.equal(state?.boardAccess.source,"board_member");
        assert.equal((await browseFolioTasks(admin,boardId)).spaces[0].boardId,boardId);
      }
      await assert.rejects(getNote(admin,personal.id),hidden);
    }
    assert.equal((await getBoardPrivacySettings(owner,boardId)).board.id,boardId);
    await listPersonalBoardMembers(owner,boardId);
  } finally {
    await pool.query("DELETE FROM folio_spaces WHERE created_by_user_id=ANY($1::uuid[]) OR owner_user_id=ANY($1::uuid[]) OR board_id=$2", [[owner.id,admin.id],boardId||null]);
    await pool.query("DELETE FROM notes WHERE owner_user_id=ANY($1::uuid[])",[[owner.id,admin.id]]);
    await pool.query("DELETE FROM boards WHERE owner_user_id=ANY($1::uuid[])",[[owner.id,admin.id]]);
    await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])",[[owner.id,admin.id]]);
    await pool.end();
  }
});
