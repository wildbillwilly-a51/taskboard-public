import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { calendarDate, emptyTravel, hasTravel, locationDuration, parsePeopleDetailsChange, peopleTeamColors, travelCaption, unassignedTeamColor } from "@/lib/outage-people-details";
const request = () => ({ operation: "person-details", mutationId: randomUUID(), updates: [{ personKey: "Alex", expectedRevision: null }], travel: emptyTravel(), discussedDay: "" });
test("travel parses calendar values without interpreting floating local times", () => {
  const input = request(); input.travel.arrival = "2026-12-08T10:30"; input.travel.phase = "inbound";
  assert.equal(parsePeopleDetailsChange(input).travel.arrival, input.travel.arrival);
  assert.match(travelCaption(input.travel), /10:30 AM/);
  assert.equal(calendarDate("2026-02-29"), false); assert.equal(calendarDate("2028-02-29"), true);
  for (const arrival of ["2026-02-30T10:30", "2026-12-08T25:00", "2026-12-08T10:30Z"]) assert.throws(() => parsePeopleDetailsChange({ ...input, travel: { ...input.travel, arrival } }));
});
test("travel commands reject spoofing, unbounded payloads and extra fields", () => {
  const input = request();
  assert.throws(() => parsePeopleDetailsChange({ ...input, reporterName: "Other" }));
  assert.throws(() => parsePeopleDetailsChange(input, true));
  assert.throws(() => parsePeopleDetailsChange({ ...input, updates: [...input.updates, { personKey: "Blair", expectedRevision: null }] }));
  assert.throws(() => parsePeopleDetailsChange({ ...input, travel: { ...input.travel, secret: "extra" } }));
  assert.throws(() => parsePeopleDetailsChange({ ...input, travel: { ...input.travel, travelNotes: "x".repeat(1001) } }));
  assert.throws(() => parsePeopleDetailsChange({ ...input, location: { value: "Site", expectedRevision: "bad" } }));
  assert.equal(parsePeopleDetailsChange({ ...input, reporterName: "Alex" }, true).reporterName, "Alex");
});
test("Traveling includes actual trip details without turning every on-site person into a traveler", () => {
  assert.equal(hasTravel({ ...emptyTravel(), phase: "arrived" }), false);
  assert.equal(hasTravel({ ...emptyTravel(), phase: "inbound" }), true);
  assert.equal(hasTravel({ ...emptyTravel(), travelNotes: "Drive from hotel" }), true);
  assert.equal(hasTravel({ ...emptyTravel(), departureDate: "2027-01-01" }), true);
  assert.equal(hasTravel({ ...emptyTravel(), phase: "left", leftDate: "2026-12-01" }), true);
});
test("duration counts hours beyond one day and clamps clock skew", () => {
  const now = Date.parse("2026-12-08T12:00:00Z");
  assert.equal(locationDuration(new Date(now-1630*60000).toISOString(),now),"27h10m");
  assert.equal(locationDuration(new Date(now+60000).toISOString(),now),"0m");
  assert.equal(locationDuration(null,now),"—");
});
test("team palette avoids collisions and stays stable when a new team is appended", () => {
  const names = ["IT Ops", "IT Networking", "Camera crew", "A", "B", "C", "D"];
  const colors = peopleTeamColors(names);
  assert.equal(new Set(Object.values(colors)).size, 7);
  assert.deepEqual(peopleTeamColors(names), colors);
  const added = peopleTeamColors([...names, "E"]);
  for (const name of names) assert.equal(added[name], colors[name]);
});

test("team colors are the bucket palette's, with the same values saved teams already show", () => {
  const colors = Object.values(peopleTeamColors(["A", "B", "C", "D", "E", "F", "G"]));
  assert.deepEqual(new Set(colors), new Set(["#2563eb", "#0f766e", "#8b5cf6", "#0891b2", "#6366f1", "#65a30d", "#d97706"]));
  assert.equal(unassignedTeamColor, "#475569");
});
