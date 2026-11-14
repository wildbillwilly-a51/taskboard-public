import assert from "node:assert/strict";
import test from "node:test";
import { indexOutageWork, outageWorkRosters } from "../src/lib/outage-work";
import { emptyPeopleReport, type OutagePerson } from "../src/lib/outage-people";
import type { Task } from "../src/lib/taskboard-data";

const task = (id: string, title: string, subtasks: Task[] = []): Task => ({ id, title, subtasks, summary: "", status: "todo", icon: "folder", color: "#888888", labels: [], notes: [], attachments: [], checklist: [] });
const person = (key: string, id: string | null, value = "same title"): OutagePerson => ({ key, name: key, team: emptyPeopleReport(), location: emptyPeopleReport(), activity: { ...emptyPeopleReport(), value, linkedTaskId: id }, history: [] });

test("work paths preserve duplicate titles and protect against cycles and duplicate ids", () => {
  const leaf = task("leaf", "Checks"), parent = task("parent", "IT Ops", [leaf]);
  const root = task("root", "Outage", [parent, task("other", "Checks"), leaf]);
  leaf.subtasks.push(root);
  const index = indexOutageWork(root);
  assert.deepEqual([...index.keys()], ["parent", "leaf", "other"]);
  assert.deepEqual(index.get("leaf")?.path, ["parent", "leaf"]);
  assert.deepEqual(index.get("leaf")?.titles, ["IT Ops", "Checks"]);
  assert.equal(index.get("other")?.parentId, null);
});

test("names roll up by stable identity and links, with live moves and removals", () => {
  const leaf = task("leaf", "Checks"), parent = task("parent", "IT Ops", [leaf]), other = task("other", "Electrical");
  const root = task("root", "Outage", [parent, other]);
  const linked = person("Alex", "leaf"), direct = person("Jordan", "parent");
  const unavailable = person("Unavailable", "leaf"); unavailable.activity.unavailable = true;
  const people = [linked, direct, linked, person("Free text", null, "Checks"), unavailable, person("Fresh task", "missing")];
  const initial = outageWorkRosters(indexOutageWork(root), people);
  assert.deepEqual(initial.rosters.get("parent")?.direct.map(p => p.key), ["Jordan"]);
  assert.deepEqual(initial.rosters.get("parent")?.descendants.map(p => p.key), ["Alex"]);
  assert.deepEqual(initial.rosters.get("leaf")?.direct.map(p => p.key), ["Alex"]);
  assert.deepEqual(initial.unresolved.map(p => p.key), ["Fresh task"]);
  parent.subtasks = []; other.subtasks = [leaf]; leaf.title = "Renamed checks";
  const next = outageWorkRosters(indexOutageWork(root), [linked]);
  assert.equal(next.rosters.has("parent"), false);
  assert.deepEqual(next.rosters.get("other")?.descendants.map(p => p.key), ["Alex"]);
  assert.equal(outageWorkRosters(indexOutageWork(root), []).rosters.size, 0);
});
