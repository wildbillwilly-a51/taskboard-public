import type { Task } from "./taskboard-data";
import type { OutagePerson } from "./outage-people";

export type WorkChoice = { task: Task; parentId: string | null; path: string[]; titles: string[]; depth: number };
export function indexOutageWork(root: Task) {
  const index = new Map<string, WorkChoice>();
  const visit = (tasks: Task[], parentId: string | null, path: string[], titles: string[]) => {
    for (const task of tasks) {
      if (task.id === root.id || index.has(task.id)) continue;
      const next = { task, parentId, path: [...path, task.id], titles: [...titles, task.title], depth: path.length };
      index.set(task.id, next);
      visit(task.subtasks, task.id, next.path, next.titles);
    }
  };
  visit(root.subtasks, null, [], []);
  return index;
}

export type WorkRoster = { direct: OutagePerson[]; descendants: OutagePerson[] };
export function outageWorkRosters(index: Map<string, WorkChoice>, people: OutagePerson[]) {
  const rosters = new Map<string, WorkRoster>();
  const seen = new Set<string>();
  const unresolved: OutagePerson[] = [];
  for (const person of [...people].sort((a, b) => a.name.localeCompare(b.name) || a.key.localeCompare(b.key))) {
    if (seen.has(person.key)) continue;
    seen.add(person.key);
    const report = person.activity;
    if (!report.linkedTaskId || report.unavailable) continue;
    const work = index.get(report.linkedTaskId);
    if (!work) { unresolved.push(person); continue; }
    for (const id of work.path) {
      const roster = rosters.get(id) ?? { direct: [], descendants: [] };
      (id === work.task.id ? roster.direct : roster.descendants).push(person);
      rosters.set(id, roster);
    }
  }
  return { rosters, unresolved };
}
