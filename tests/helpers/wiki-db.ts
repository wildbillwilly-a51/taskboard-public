import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { unlink } from "node:fs/promises";
import { getPool } from "@/lib/db";
import { ensureDatabaseReady } from "@/lib/taskboard-store";
import { getNoteAttachmentDiskPath } from "@/lib/note-attachments-store";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";
import { isLocalVisualDatabase } from "./visual-database";

export const enabled=process.env.WIKI_DB_TEST==="1";
export const content=(text:string)=>({formatVersion:2,blocks:[{type:"paragraph",content:[{type:"text",text}]}],markdown:text,text});
export async function fixture() {
  assert.equal(process.env.WIKI_DB_TEST,"1");
  assert.ok(isLocalVisualDatabase(new URL(process.env.DATABASE_URL!)),"Use a guarded localhost visual database.");
  assert.match(process.env.TASKBOARD_VISUAL_DATABASE_NAME??"",/^taskboard_visual_test_wiki_(?:p1_(?:core|api|int)|p2_(?:server|int))(?:_[a-z0-9_]+)?$/);
  await ensureDatabaseReady();const pool=getPool()!;
  const users:Record<"owner"|"editor"|"viewer"|"outsider"|"admin"|"manager"|"disabled",TaskboardUserIdentity & {id:string}>=Object.fromEntries(
    ["owner","editor","viewer","outsider","admin","manager","disabled"].map(name=>{
      const id=randomUUID();return [name,{id,email:`${id}@example.invalid`,username:`wiki-${id}`,displayName:name,authMode:"authelia",authProvider:"authelia",role:name==="admin"?"admin":"standard",isDisabled:name==="disabled"}];
    })) as typeof users;
  for(const user of Object.values(users))await pool.query("INSERT INTO users(id,email,username,display_name,role,is_disabled) VALUES($1,$2,$3,$4,$5,$6)",[user.id,user.email,user.username,user.displayName,user.role,user.isDisabled]);
  const team=randomUUID(),board=randomUUID(),board2=randomUUID(),personal=randomUUID();
  await pool.query("INSERT INTO teams(id,name) VALUES($1,$2)",[team,`Wiki ${team}`]);
  await pool.query("INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'manager')",[team,users.manager.id]);
  for(const id of [board,board2]) {
    await pool.query("INSERT INTO boards(id,title,board_type,owner_team_id,created_by_user_id,team_member_default_access) VALUES($1,'Wiki fixture','team',$2,$3,'viewer')",[id,team,users.owner.id]);
    for(const [who,role] of [["owner","owner"],["editor","editor"],["viewer","viewer"]] as const)
      await pool.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,$3)",[id,users[who].id,role]);
  }
  await pool.query("INSERT INTO boards(id,title,owner_user_id,board_type) VALUES($1,'Private fixture',$2,'personal')",[personal,users.owner.id]);
  return {pool,users,team,board,board2,personal,async cleanup(){
    const ids=Object.values(users).map(u=>u.id);
    const stored=(await pool.query<{stored_name:string}>("SELECT a.stored_name FROM note_attachments a JOIN notes n ON n.id=a.note_id WHERE n.owner_user_id=ANY($1::uuid[])",[ids])).rows;
    await pool.query("DELETE FROM notes WHERE owner_user_id=ANY($1::uuid[])",[ids]);
    await pool.query("DELETE FROM wiki_spaces WHERE board_id=ANY($1::uuid[])",[[board,board2]]);
    await pool.query("DELETE FROM boards WHERE id=ANY($1::uuid[]) OR owner_user_id=ANY($2::uuid[])",[[board,board2,personal],ids]);
    await pool.query("DELETE FROM teams WHERE id=$1",[team]);await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])",[ids]);
    for(const file of stored)await unlink(getNoteAttachmentDiskPath(file.stored_name)).catch(()=>{});
    await pool.end();
  }};
}
export const code=(expected:string)=>(error:unknown)=>(error as {code?:string}).code===expected;
