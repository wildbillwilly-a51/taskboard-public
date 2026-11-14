import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { applyAttendeeChanges, canonicalPlace, parsePeopleChange, parsePeopleTeamChange, peopleRoster, reconcilePeopleGroups } from "@/lib/outage-people";
import { isPublicTaskSharePath } from "@/lib/public-task-share-model";

const request = () => ({ mutationId: randomUUID(), field: "location", value: "New lab", updates: [{ personKey: "Ann Lee", expectedRevision: null }] });
test("team commands support empty groups but protect directory identities and reserved labels", () => {
  const empty = { operation: "create-team", mutationId: randomUUID(), name: " Camera crew ", updates: [], addUserIds: [] };
  assert.equal(parsePeopleTeamChange(empty).name, "Camera crew");
  assert.deepEqual(parsePeopleTeamChange(empty).updates, []);
  assert.throws(() => parsePeopleTeamChange({ ...empty, name: " Unassigned " }));
  assert.throws(() => parsePeopleTeamChange({ ...empty, sourceTeamId: randomUUID(), reporterName: "Ann Lee" }, true));
  assert.throws(() => parsePeopleTeamChange({ ...empty, addUserIds: [randomUUID()] }));
  assert.throws(() => parsePeopleTeamChange({ ...empty, operation: "remove-team", updates: [{ personKey: "Ann Lee", expectedRevision: null }] }));
  assert.throws(() => parsePeopleTeamChange({ ...empty, mutationId: "invalid" }));
  assert.equal(parsePeopleTeamChange({ ...empty, reporterName: "Ann Lee" }, true).reporterName, "Ann Lee");
});

test("empty teams remain visible while row positions are frozen", () => {
  assert.deepEqual(reconcilePeopleGroups([{ label: "Ops", keys: ["Alex"] }], [{ label: "Ops", keys: [] }, { label: "Network", keys: ["Alex"] }, { label: "Camera crew", keys: [] }]), [{ label: "Ops", keys: ["Alex"] }, { label: "Camera crew", keys: [] }]);
});
test("attendee edits apply only named changes and preserve concurrent imports", () => {
  assert.deepEqual(applyAttendeeChanges(["Alex","Imported"],[{name:"Blair",attending:true},{name:"Alex",attending:false}]),["Imported","Blair"]);
  assert.deepEqual(applyAttendeeChanges(["Alex"],[{name:"Blair",attending:true},{name:"Blair",attending:false},{name:"Casey",attending:true}]),["Alex","Casey"]);
  assert.throws(()=>applyAttendeeChanges([],[{name:"Comma, Name",attending:true}]));
  assert.throws(()=>applyAttendeeChanges(["Alex"],[{name:"alex",attending:true}]));
  assert.deepEqual(applyAttendeeChanges(["Alex","alex"],[{name:"Blair",attending:true}]),["Alex","alex","Blair"]);
  assert.deepEqual(applyAttendeeChanges(["Alex","alex"],[{name:"alex",attending:false}]),["Alex"]);
  assert.throws(()=>applyAttendeeChanges(Array.from({length:50},(_,i)=>String(i)),[{name:"Extra",attending:true}]));
});
test("roster membership updates while an edited person's group position stays fixed", () => {
  const frozen = [{ label: "Ops", keys: ["Alex", "Removed"] }, { label: "People", keys: ["Blair"] }];
  const current = [{ label: "Networking", keys: ["Alex", "New colleague"] }, { label: "People", keys: ["Blair", "New attendee"] }];
  assert.deepEqual(reconcilePeopleGroups(frozen, current), [
    { label: "Ops", keys: ["Alex"] }, { label: "People", keys: ["Blair", "New attendee"] }, { label: "Networking", keys: ["New colleague"] },
  ]);
  assert.deepEqual(frozen[0].keys, ["Alex", "Removed"], "The saved layout is not mutated");
  assert.deepEqual(reconcilePeopleGroups(frozen, []), []);
});
test("people roster preserves distinct stored attendee names", () => {
  assert.deepEqual(peopleRoster([" Ann Lee ", "ann  lee", "Ann Lee", ""]), [{ key: "Ann Lee", name: "Ann Lee" }, { key: "ann  lee", name: "ann  lee" }]);
});
test("people changes preserve initial null revisions and accept clearing", () => {
  const parsed = parsePeopleChange({ ...request(), value: "  " });
  assert.equal(parsed.value, ""); assert.equal(parsed.updates[0].expectedRevision, null);
  assert.throws(() => parsePeopleChange({ ...request(), updates: [{ personKey: "Ann Lee" }] }));
});
test("people changes are bounded and reject unknown or duplicate fields", () => {
  assert.throws(() => parsePeopleChange({ ...request(), value: "x".repeat(241) }));
  assert.throws(() => parsePeopleChange({ ...request(), value: "a\u0000b" }));
  assert.throws(() => parsePeopleChange({ ...request(), status: "done" }));
  assert.throws(() => parsePeopleChange({ ...request(), updates: Array.from({ length: 2 }, () => ({ personKey: "Ann Lee", expectedRevision: null })) }));
});
test("only activity can link work, and private changes cannot claim an identity", () => {
  assert.throws(() => parsePeopleChange({ ...request(), linkedTaskId: randomUUID() }));
  assert.throws(() => parsePeopleChange({ ...request(), reporterName: "Somebody" }));
  assert.throws(() => parsePeopleChange(request(), true));
  assert.equal(parsePeopleChange({ ...request(), field: "activity", linkedTaskId: randomUUID(), reporterName: "Ann Lee" }, true).reporterName, "Ann Lee");
});
test("free locations remain free while simple spelling variations reuse known places", () => {
  assert.equal(canonicalPlace(" idf 2000 ", ["IDF-2000"]), "IDF-2000");
  assert.equal(canonicalPlace("New lab annex", ["Lab"]), "New lab annex");
});
test("only the exact public people route is admitted", () => {
  const root = `/share/task/${"a".repeat(43)}`;
  assert.ok(isPublicTaskSharePath(`${root}/people`));
  assert.ok(isPublicTaskSharePath(`${root}/people/`));
  assert.equal(isPublicTaskSharePath(`${root}/people/extra`), false);
  assert.equal(isPublicTaskSharePath(`${root}/people-anything`), false);
});
