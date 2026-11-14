import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { getPool } from "../src/lib/db";
import { ensureDatabaseReady, updateTask } from "../src/lib/taskboard-store";
import { authenticatedOutagePeople, publicOutagePeople, updatePublicOutagePeople } from "../src/lib/outage-people-store";
import { manageTaskShare } from "../src/lib/public-task-share-store";
import type { TaskboardUserIdentity } from "../src/lib/taskboard-request";
import type { OutagePeopleState, PeopleChange, PeopleField } from "../src/lib/outage-people";
import { NextRequest } from "next/server";
import { middleware } from "../src/lib/taskboard-request-guard";
import { emptyPersonDetails, emptyTravel, type PeopleDetailsChange } from "../src/lib/outage-people-details";

test("outage people persistence, concurrency and share boundaries", { skip: process.env.OUTAGE_PEOPLE_TEST_DATABASE !== "true" }, async t => {
  const url = new URL(process.env.DATABASE_URL!);
  assert.equal(url.hostname, "127.0.0.1");
  assert.equal(url.port, "55433");
  assert.ok(/^\/taskboard_(?:compact_)?people_test_[a-z0-9_]+$/.test(url.pathname) && !url.search && !url.hash, "Only the dedicated disposable databases are allowed");
  await ensureDatabaseReady();
  const pool = getPool()!;
  const ownerId = randomUUID(), otherId = randomUUID(), boardId = randomUUID(), bucketId = randomUUID();
  const rootId = randomUUID(), workId = randomUUID(), outsideId = randomUUID();
  const owner: TaskboardUserIdentity = { id: ownerId, email: `${ownerId}@example.test`, displayName: "People test owner", authMode: "password", role: "standard" };
  const other: TaskboardUserIdentity = { ...owner, id: otherId, email: `${otherId}@example.test`, displayName: "People test viewer" };
  const get = () => authenticatedOutagePeople(owner, rootId);
  const report = (s: OutagePeopleState, person = "Alex", field: PeopleField = "location") => s.people.find(p => p.key === person)![field];
  const request = (s: OutagePeopleState, field: PeopleField, value: string, names = ["Alex"]): PeopleChange => ({ mutationId: randomUUID(), field, value, linkedTaskId: null, updates: names.map(personKey => ({ personKey, expectedRevision: report(s, personKey, field).revision })) });
  const save = (r: PeopleChange) => authenticatedOutagePeople(owner, rootId, r);
  const rejected = async (run: Promise<unknown>, status: number) => assert.rejects(run, (e: unknown) => !!e && typeof e === "object" && "status" in e && e.status === status);
  try {
    await pool.query("INSERT INTO users(id,email,display_name,role) VALUES($1,$2,$3,'standard'),($4,$5,$6,'standard')", [ownerId, owner.email, owner.displayName, otherId, other.email, other.displayName]);
    await pool.query("INSERT INTO boards(id,owner_user_id,title,personal_visibility) VALUES($1,$2,'People integration','private')", [boardId, ownerId]);
    await pool.query("INSERT INTO buckets(id,board_id,title,sort_order) VALUES($1,$2,'Outages',1000)", [bucketId, boardId]);
    for (const [id, parent, title, kind] of [[rootId, null, "Synthetic outage", "maintenance_outage"], [workId, rootId, "Switch checks", "task"], [outsideId, null, "Outside secret title", "task"]]) {
      await pool.query("INSERT INTO tasks(id,board_id,bucket_id,parent_task_id,title,status,sort_order,work_item_type) VALUES($1,$2,$3,$4,$5,'todo',1000,$6)", [id, boardId, bucketId, parent, title, kind]);
    }
    await pool.query("INSERT INTO maintenance_outages(task_id,board_id,attendees) VALUES($1,$2,'[\"Alex\",\"Blair\"]')", [rootId, boardId]);
    await t.test("blank roster, readonly identity lookup, separate fields and timestamps", async () => {
      const before = (await pool.query("SELECT updated_at FROM users WHERE id=$1", [ownerId])).rows[0].updated_at;
      const initial = await get();
      assert.equal(initial.people.length, 2); assert.equal(report(initial).revision, null);
      const placed = await save(request(initial, "location", "IDF-2000"));
      const active = await save(request(placed, "activity", "Checking switches"));
      assert.deepEqual(report(active), report(placed));
      assert.equal(report(active, "Alex", "activity").reporter, owner.displayName);
      assert.equal(report(active, "Alex", "activity").verified, true);
      assert.equal((await pool.query("SELECT updated_at FROM users WHERE id=$1", [ownerId])).rows[0].updated_at.toISOString(), before.toISOString());
      assert.equal((await pool.query("SELECT status,start_at,end_at FROM tasks WHERE id=$1", [rootId])).rows[0].status, "todo");
    });
    await t.test("same-field CAS conflicts, independent-field saves and atomic bulk rollback", async () => {
      const current = await get(), stale = request(current, "location", "Stale", ["Alex", "Blair"]);
      await save(request(current, "location", "Control room"));
      await rejected(save(stale), 409);
      assert.equal(report(await get(), "Blair").value, "");
      const blank = await get();
      const outcomes = await Promise.allSettled([save(request(blank, "team", "Ops", ["Blair"])), save(request(blank, "team", "Networking", ["Blair"]))]);
      assert.equal(outcomes.filter(o => o.status === "fulfilled").length, 1, "First inserts serialize on the roster row");
      const independent = await get();
      const results = await Promise.all([save(request(independent, "location", "Lab", ["Blair"])), save(request(independent, "activity", "Preparing", ["Blair"]))]);
      assert.equal(results.length, 2);
    });
    await t.test("retry receipt precedes CAS and retains proof of its own revision", async () => {
      const first = request(await get(), "location", "Remote");
      const applied = await save(first), proof = applied.applied;
      await save(request(applied, "location", "Elsewhere"));
      const retried = await save(first);
      assert.equal(report(retried).value, "Elsewhere"); assert.deepEqual(retried.applied, proof);
      assert.notEqual(report(retried).revision, proof![0].revision);
      await rejected(save({ ...first, value: "different body" }), 409);
    });
    await t.test("travel and location save atomically with one immutable receipt", async () => {
      const initial = await get(), person = initial.people.find(p=>p.key==="Alex")!;
      const command: PeopleDetailsChange = { operation:"person-details", mutationId:randomUUID(), updates:[{personKey:"Alex",expectedRevision:person.details?.revision??null}],travel:{...emptyTravel(),phase:"arrived",departureDate:"2026-12-11"},discussedDay:"",location:{value:"Travel lab",expectedRevision:person.location.revision} };
      const saved = await authenticatedOutagePeople(owner,rootId,command), detail=saved.people.find(p=>p.key==="Alex")!.details!;
      assert.equal(detail.travel.phase,"arrived");assert.equal(report(saved).value,"Travel lab");assert.equal(saved.applied?.length,2);
      const newer=await save(request(saved,"location","Elsewhere"));
      const replay=await authenticatedOutagePeople(owner,rootId,command);
      assert.deepEqual(replay.applied,saved.applied);assert.equal(report(replay).revision,report(newer).revision);
      assert.equal((await pool.query("SELECT count(*)::int n FROM outage_people_mutations WHERE task_id=$1 AND mutation_id=$2",[rootId,command.mutationId])).rows[0].n,1);
      const staleLocation={...command,mutationId:randomUUID(),updates:[{personKey:"Alex",expectedRevision:detail.revision}],travel:{...command.travel,travelNotes:"must not persist"}};
      await rejected(authenticatedOutagePeople(owner,rootId,staleLocation),409);
      assert.equal((await get()).people.find(p=>p.key==="Alex")!.details!.travel.travelNotes,"");
      await rejected(authenticatedOutagePeople(owner,rootId,{...command,mutationId:randomUUID(),location:{value:"Must not persist",expectedRevision:report(newer).revision}}),409);
      assert.equal(report(await get()).value,"Elsewhere");
      const current=await get(), p=current.people.find(p=>p.key==="Alex")!;
      const unchanged=await authenticatedOutagePeople(owner,rootId,{...command,mutationId:randomUUID(),updates:[{personKey:"Alex",expectedRevision:p.details!.revision}],location:{value:p.location.value,expectedRevision:p.location.revision}});
      assert.deepEqual(report(unchanged),p.location,"Confirming the precise existing location preserves its age");
    });
    await t.test("board access, disabled users and current roster are enforced", async () => {
      await rejected(authenticatedOutagePeople(other, rootId), 403);
      await pool.query("INSERT INTO board_members(board_id,user_id,role) VALUES($1,$2,'viewer')", [boardId, otherId]);
      assert.equal((await authenticatedOutagePeople(other, rootId)).canEdit, false);
      await rejected(authenticatedOutagePeople(other, rootId, request(await get(), "location", "Forbidden")), 403);
      await rejected(authenticatedOutagePeople(owner, rootId, undefined, randomUUID()), 403);
      await pool.query("UPDATE users SET is_disabled=true WHERE id=$1", [otherId]);
      await rejected(authenticatedOutagePeople(other, rootId), 403);
      await pool.query("UPDATE maintenance_outages SET attendees='[\"Alex\"]' WHERE task_id=$1", [rootId]);
      const s = await get(); assert.equal(s.people.length, 1);
      await rejected(save({ mutationId: randomUUID(), field: "location", value: "No", linkedTaskId: null, updates: [{ personKey: "Blair", expectedRevision: null }] }), 409);
      await pool.query("UPDATE maintenance_outages SET attendees='[\"Alex\",\"Blair\"]' WHERE task_id=$1", [rootId]);
    });
    await t.test("linked work remains scoped in both current reports and history", async () => {
      await rejected(save({ ...request(await get(), "activity", "Outside secret title"), linkedTaskId: outsideId }), 400);
      await save({ ...request(await get(), "activity", "Ignored client label"), linkedTaskId: workId });
      assert.equal(report(await get(), "Alex", "activity").value, "Switch checks");
      for (const sql of ["UPDATE tasks SET deleted_at=now() WHERE id=$1", "UPDATE tasks SET deleted_at=NULL,archived_at=now() WHERE id=$1", "UPDATE tasks SET archived_at=NULL,parent_task_id=NULL WHERE id=$1", "DELETE FROM tasks WHERE id=$1"]) {
        await pool.query(sql, [workId]);
        const s = await get(); assert.equal(report(s, "Alex", "activity").value, ""); assert.equal(report(s, "Alex", "activity").unavailable, true);
        assert.ok(!JSON.stringify(s.people).includes("Switch checks"), "History must not leak the now unavailable work title");
      }
    });
    await t.test("empty groups persist, survive their last member moving, and can be removed with retry", async () => {
      const command = { operation: "create-team", mutationId: randomUUID(), name: "Camera crew", updates: [], addUserIds: [] };
      assert.ok((await authenticatedOutagePeople(owner, rootId, command)).teams?.includes("Camera crew"));
      assert.deepEqual((await authenticatedOutagePeople(owner, rootId, command)).applied, []);
      await rejected(authenticatedOutagePeople(owner, rootId, { ...command, mutationId: randomUUID(), name: "camera CREW" }), 409);
      const placed = await save(request(await get(), "team", "Camera crew"));
      await rejected(authenticatedOutagePeople(owner, rootId, { ...command, operation: "remove-team", mutationId: randomUUID() }), 409);
      const moved = await save(request(placed, "team", "Ops"));
      assert.ok(moved.teams?.includes("Camera crew"));
      const remove = { ...command, operation: "remove-team", mutationId: randomUUID() };
      assert.ok(!(await authenticatedOutagePeople(owner, rootId, remove)).teams?.includes("Camera crew"));
      assert.deepEqual((await authenticatedOutagePeople(owner, rootId, remove)).applied, []);
    });
    await t.test("directory imports append atomically, recover former attendees, and coexist with attendee edits", async () => {
      const teamId = randomUUID(), hiddenId = randomUUID(), duplicateId = randomUUID();
      const memberName = "Returning crew member";
      await pool.query("UPDATE users SET is_disabled=false,display_name=$2 WHERE id=$1", [otherId, memberName]);
      await pool.query("INSERT INTO users(id,email,display_name,role) VALUES($1,$2,$3,'standard')", [duplicateId, `${duplicateId}@example.test`, memberName]);
      await pool.query("INSERT INTO teams(id,name) VALUES($1,$2),($3,$4)", [teamId, `Directory ${teamId}`, hiddenId, `Hidden ${hiddenId}`]);
      await pool.query("INSERT INTO team_members(team_id,user_id,role) VALUES($1,$2,'manager'),($1,$3,'member'),($1,$4,'member')", [teamId, ownerId, otherId, duplicateId]);
      const command = { operation: "create-team", mutationId: randomUUID(), name: "Imported crew", sourceTeamId: teamId, updates: [], addUserIds: [otherId] };
      try {
        await rejected(authenticatedOutagePeople(owner, rootId, { ...command, sourceTeamId: hiddenId }), 403);
        await rejected(authenticatedOutagePeople(owner, rootId, { ...command, addUserIds: [otherId, duplicateId] }), 400);
        await pool.query("UPDATE users SET display_name='Comma, Name' WHERE id=$1",[duplicateId]);
        await rejected(authenticatedOutagePeople(owner,rootId,{...command,addUserIds:[duplicateId]}),400);
        await pool.query("UPDATE users SET display_name='alex' WHERE id=$1",[duplicateId]);
        await rejected(authenticatedOutagePeople(owner,rootId,{...command,addUserIds:[duplicateId]}),409);
        await pool.query("UPDATE maintenance_outages SET attendees=$2::jsonb WHERE task_id=$1", [rootId, JSON.stringify(["Alex","Blair",memberName])]);
        await save(request(await get(), "team", "Former team", [memberName]));
        await save(request(await get(), "location", "Previous room", [memberName]));
        await pool.query("UPDATE maintenance_outages SET attendees='[\"Alex\",\"Blair\"]' WHERE task_id=$1", [rootId]);
        const stale = request(await get(), "team", "Ignored");
        await save(request(await get(), "team", "Latest team"));
        await rejected(authenticatedOutagePeople(owner, rootId, { ...command, updates: stale.updates }), 409);
        assert.deepEqual((await get()).people.map(p => p.key), ["Alex","Blair"], "A failed assignment rolls the attendee append back");
        assert.ok(!(await get()).teams?.includes(command.name));
        const imported = await authenticatedOutagePeople(owner, rootId, command);
        assert.deepEqual(imported.people.map(p => p.key), ["Alex","Blair",memberName]);
        assert.equal(report(imported,memberName,"team").value, command.name);
        assert.equal(report(imported,memberName,"location").value, "Previous room");
        const history = (await pool.query("SELECT count(*) n FROM outage_people_history WHERE task_id=$1",[rootId])).rows[0].n;
        assert.deepEqual((await authenticatedOutagePeople(owner, rootId, command)).applied, imported.applied);
        assert.equal((await pool.query("SELECT count(*) n FROM outage_people_history WHERE task_id=$1",[rootId])).rows[0].n, history);
        await updateTask(owner,rootId,{maintenanceOutage:{attendeeChanges:[{name:"Another attendee",attending:true}]}});
        assert.deepEqual((await get()).people.map(p=>p.name),["Alex","Blair",memberName,"Another attendee"]);
        await rejected(updateTask(owner,rootId,{maintenanceOutage:{attendeeChanges:[{name:"alex",attending:true}]}}),409);
        assert.equal((await pool.query("SELECT count(*) n FROM team_members WHERE team_id=$1",[teamId])).rows[0].n,"3","Outage assignment doesn't change directory membership");
        await pool.query("UPDATE maintenance_outages SET attendees=$2::jsonb WHERE task_id=$1", [rootId,JSON.stringify(Array.from({length:50},(_,i)=>`Person ${i}`))]);
        await rejected(authenticatedOutagePeople(owner,rootId,{...command,mutationId:randomUUID()}),400);
      } finally {
        await pool.query("UPDATE maintenance_outages SET attendees='[\"Alex\",\"Blair\"]' WHERE task_id=$1", [rootId]);
        await pool.query("DELETE FROM teams WHERE id=ANY($1::uuid[])", [[teamId,hiddenId]]);
        await pool.query("DELETE FROM notes WHERE owner_user_id=$1",[duplicateId]);
        await pool.query("DELETE FROM users WHERE id=$1",[duplicateId]);
      }
    });
    await t.test("legacy case variants can be removed and guarded moves cannot revive a removed team", async () => {
      await pool.query("INSERT INTO outage_people_teams(task_id,name) VALUES($1,'Case crew'),($1,'case crew')",[rootId]);
      await authenticatedOutagePeople(owner,rootId,{operation:"remove-team",mutationId:randomUUID(),name:"case crew",updates:[],addUserIds:[]});
      assert.ok((await get()).teams?.includes("Case crew"));
      const canonical = await save(request(await get(),"team","CASE CREW"));
      assert.equal(report(canonical,"Alex","team").value,"Case crew");
      await rejected(save({...request(await get(),"team","Removed group"),requireTeam:true}),409);
    });
    await t.test("view/edit shares, attribution, revocation, expiry and flags", async () => {
      const view = await manageTaskShare(owner, rootId, "create", "America/Chicago", { mode: "view" });
      const edit = await manageTaskShare(owner, rootId, "create", "America/Chicago", { mode: "edit_work" });
      const vt = view.url!.split("/").pop()!, et = edit.url!.split("/").pop()!;
      assert.equal((await publicOutagePeople(vt)).canEdit, false);
      await assert.rejects(updatePublicOutagePeople(vt, { ...request(await get(), "location", "No"), reporterName: "Alex" }));
      await rejected(updatePublicOutagePeople(et, { ...request(await get(), "location", "No"), reporterName: "Unknown" }), 400);
      const s = await updatePublicOutagePeople(et, { ...request(await get(), "location", "Workshop"), reporterName: "Alex" });
      assert.equal(report(s).reporter, "Alex"); assert.equal(report(s).verified, false);
      assert.ok(!JSON.stringify(s).includes(owner.email));
      const details=s.people.find(p=>p.key==="Alex")!.details??emptyPersonDetails();
      const trip={operation:"person-details",mutationId:randomUUID(),updates:[{personKey:"Alex",expectedRevision:details.revision}],travel:{...details.travel,travelNotes:"Flight and pickup details"},discussedDay:"2026-12-08",reporterName:"Alex"};
      await assert.rejects(updatePublicOutagePeople(vt,trip));
      await rejected(updatePublicOutagePeople(et,{...trip,reporterName:"Unknown"}),400);
      const travelSaved=await updatePublicOutagePeople(et,trip);
      assert.equal(travelSaved.people.find(p=>p.key==="Alex")!.details!.verified,false);
      assert.equal((await publicOutagePeople(vt)).people.find(p=>p.key==="Alex")!.details!.travel.travelNotes,"Flight and pickup details");
      const custom = { operation:"create-team",mutationId:randomUUID(),name:"Shared crew",updates:[],addUserIds:[],reporterName:"Alex" };
      assert.ok((await updatePublicOutagePeople(et,custom)).teams?.includes("Shared crew"));
      await rejected(updatePublicOutagePeople(et,{...custom,mutationId:randomUUID(),sourceTeamId:randomUUID()}),403);
      await pool.query("UPDATE task_public_shares SET expires_at=now()-interval '1 second' WHERE task_id=$1 AND access_mode='edit_work'", [rootId]);
      await assert.rejects(publicOutagePeople(et));
      await pool.query("UPDATE task_public_shares SET revoked_at=now() WHERE task_id=$1 AND access_mode='view'", [rootId]);
      await assert.rejects(publicOutagePeople(vt));
      process.env.TASKBOARD_PUBLIC_SHARES_ENABLED = "false";
      await assert.rejects(publicOutagePeople(et));
      process.env.TASKBOARD_PUBLIC_SHARES_ENABLED = "true";
      const childShare = await manageTaskShare(owner, outsideId, "create", "UTC", { mode: "view" });
      await assert.rejects(publicOutagePeople(childShare.url!.split("/").pop()!));
    });
    await t.test("middleware only permits exact People PATCH routes while enabled", async () => {
      const base = `http://localhost/share/task/${"x".repeat(43)}`;
      assert.equal((await middleware(new NextRequest(`${base}/people`, { method: "PATCH" }))).status, 200);
      assert.equal((await middleware(new NextRequest(`${base}/people/more`, { method: "PATCH" }))).status, 404);
      assert.equal((await middleware(new NextRequest(`${base}/data`, { method: "PATCH" }))).status, 405);
      assert.equal((await middleware(new NextRequest(`${base}/people`, { method: "POST" }))).status, 405);
      process.env.TASKBOARD_PUBLIC_TASK_EDITS_ENABLED = "false";
      assert.equal((await middleware(new NextRequest(`${base}/people`, { method: "PATCH" }))).status, 405);
      assert.equal((await middleware(new NextRequest(`${base}/people`))).status, 200);
      process.env.TASKBOARD_PUBLIC_TASK_EDITS_ENABLED = "true";
    });
  } finally {
    await pool.query("DELETE FROM boards WHERE id=$1", [boardId]);
    await pool.query("DELETE FROM notes WHERE owner_user_id=ANY($1::uuid[])", [[ownerId, otherId]]);
    await pool.query("DELETE FROM users WHERE id=ANY($1::uuid[])", [[ownerId, otherId]]);
    await pool.end();
  }
});
