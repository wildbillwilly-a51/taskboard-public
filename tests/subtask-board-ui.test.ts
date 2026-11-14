import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SubtaskBoard } from "../src/components/subtask-board";
import { WorkBreakdown } from "../src/components/task-work-breakdown";
import type { Task } from "../src/lib/taskboard-data";

const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: id, summary: "", status: "todo", color: "", icon: "wrench", labels: [], notes: [], checklist: [], attachments: [], subtasks: [], ...extra });
const fixture = () => task("outage", { subtasks: [
  task("ops", { startAt: "2026-10-24T13:00:00Z", endAt: "2026-10-24T21:00:00Z", subtasks: [
    task("core", { subtasks: [task("esx", { subtasks: [task("host 1"), task("host 2")] }), task("ucs", { status: "done" })] }),
    task("argos"),
  ] }),
  task("open leaf"),
  task("finished parent", { subtasks: [task("child", { subtasks: [task("step", { status: "done" })] })] }),
] });
const handlers = { timeZone: "America/Chicago", onSaveTask: () => {}, onDeleteTask: () => {}, onAddSubtask: () => {} };
const renderBoard = (root = fixture(), canEdit = true) => renderToStaticMarkup(createElement(SubtaskBoard, { task: root, canEdit, ...handlers }));
const ids = (html: string, testId: string) => [...html.matchAll(new RegExp(`data-testid="${testId}"[^>]*data-subtask-id="([^"]+)"`, "g"))].map(match => match[1]);

test("outages offer People even before subtasks exist; ordinary tasks keep their existing views", () => {
  const outage = task("empty-outage", { workItemType: "maintenance_outage", maintenanceOutage: { owner: "", attendees: ["Alex"] } });
  const html = renderToStaticMarkup(createElement(WorkBreakdown, { task: outage, canEdit: true, checklist: null, checklistDetail: "None", ...handlers }));
  assert.match(html, /data-testid="task-outage-people-toggle"/);
  assert.match(html, /data-testid="task-subtask-list"/);
  const ordinary = renderToStaticMarkup(createElement(WorkBreakdown, { task: task("ordinary"), canEdit: true, checklist: null, checklistDetail: "None", ...handlers }));
  assert.doesNotMatch(ordinary, /task-outage-people-toggle/);
});

test("every top-level subtask is a bucket-style column, in list order, with no status columns", () => {
  const html = renderBoard();
  assert.deepEqual(ids(html, "subtask-board-box"), ["ops", "open leaf", "finished parent"]);
  assert.doesNotMatch(html, /subtask-board-column/);
  assert.match(html, /class="subtask-box taskboard-bucket-column[^"]*" data-testid="subtask-board-box"/, "Columns use the main board's bucket column.");
  assert.match(html, /data-subtask-id="open leaf" data-task-status="todo"/, "A column keeps its own done state, not a status column.");
  assert.match(html, />Not done</, "An empty column says whether it is done.");
  assert.match(html, /data-subtask-id="finished parent" data-task-status="done" data-done="true"/, "Done follows the same completion the list shows.");
  assert.match(html, />0 of 2 done</, "A column with work shows how much is done, like a bucket's task count.");
});

test("each subtask has its own box: cards in a column, small cards on a card, deeper work closed with its count", () => {
  const html = renderBoard();
  assert.deepEqual(ids(html, "subtask-board-card"), ["core", "argos", "child"]);
  assert.deepEqual(ids(html, "subtask-board-step"), ["esx", "ucs", "step"]);
  assert.match(html, /class="subtask-card taskboard-card drag-card[^"]*" data-testid="subtask-board-card"[^>]*data-subtask-id="core"/, "Cards use the main board's task card.");
  assert.match(html, /class="subtask-card-title taskboard-card-title/, "Card titles use the main board's card title.");
  assert.doesNotMatch(html, /subtask-tile/, "No pills.");
  assert.match(html, /data-subtask-id="ucs" data-task-status="done" data-done="true"/, "Done work stays in place.");
  assert.match(html, /aria-expanded="false" aria-label="Open the 2 inside esx, 0 done"/);
  assert.doesNotMatch(html, /host 1/, "Deeper work waits until it is opened.");
  assert.match(html, /data-subtask-id="esx" data-group="true"/, "An item with work of its own is a group row, as the work list sets them apart.");
  assert.doesNotMatch(html, /data-subtask-id="ucs" data-group/, "A single step is a plain row.");
  assert.doesNotMatch(html, /data-testid="subtask-inspector"/, "Nothing is opened until an item is clicked.");
  assert.doesNotMatch(html, /subtask-board-path|aria-current="location"/, "The board never changes level.");
});

test("long lists preview their open work and offer the rest", () => {
  const steps = (count: number) => Array.from({ length: count }, (_, index) => task(`step ${index + 1}`, { status: index < 4 ? "done" : "todo" }));
  const cards = renderBoard(task("root", { subtasks: [task("group", { subtasks: steps(12) })] }));
  assert.deepEqual(ids(cards, "subtask-board-card"), ["step 5", "step 6", "step 7", "step 8", "step 9", "step 10"]);
  assert.match(cards, />Show all 12 \(4 done\)</);
  const small = renderBoard(task("root", { subtasks: [task("group", { subtasks: [task("card", { subtasks: steps(14) })] })] }));
  assert.equal(ids(small, "subtask-board-step").length, 8);
  assert.match(small, />Show all 14 \(4 done\)</);
});

test("editors can add columns and cards; read-only viewers can still look", () => {
  const editable = renderBoard();
  assert.match(editable, /data-testid="subtask-board-add-card"/);
  assert.match(editable, /aria-label="Add a card to ops"/);
  const readOnly = renderBoard(fixture(), false);
  assert.doesNotMatch(readOnly, /subtask-board-add|Add a card/);
  assert.match(readOnly, /<input type="checkbox"[^>]*disabled=""/);
  assert.match(readOnly, /class="subtask-step-title"/, "Small cards still open their details.");
});

test("the work tab offers List, Board, and Timeline and still opens on the list", () => {
  const html = renderToStaticMarkup(createElement(WorkBreakdown, { task: fixture(), checklist: null, checklistDetail: "None yet", canEdit: true, ...handlers }));
  assert.match(html, /aria-label="Subtask view"/);
  assert.match(html, />List<\/button>[\s\S]*data-testid="task-subtask-board-toggle"[^>]*>\s*Board\s*<\/button>[\s\S]*>\s*Timeline\s*<\/button>/);
  assert.match(html, /data-testid="task-subtask-list"/);
  assert.doesNotMatch(html, /data-testid="task-subtask-board"/);
});

test("a subtask opened by link shows selected on the Board, with everything above it open", () => {
  const html = renderToStaticMarkup(createElement(WorkBreakdown, { task: fixture(), focusTaskId: "host 1", checklist: null, checklistDetail: "None yet", canEdit: true, ...handlers }));
  assert.match(html, /data-testid="task-subtask-board-toggle"[^>]*aria-pressed="true"|aria-pressed="true"[^>]*data-testid="task-subtask-board-toggle"/);
  assert.match(html, /aria-expanded="true" aria-label="Close the 2 inside esx, 0 done"/);
  assert.match(html, /data-testid="subtask-inspector"[^>]*aria-label="Details for host 1"/);
});

test("the subtask panel offers what a subtask has: done, title, time, work inside, place and delete", () => {
  const html = renderToStaticMarkup(createElement(SubtaskBoard, { task: fixture(), initialSelectedId: "core", canEdit: true, ...handlers }));
  const panel = html.slice(html.indexOf('data-testid="subtask-inspector"'));
  assert.match(panel, /data-testid="subtask-inspector-done"[\s\S]*type="checkbox"[\s\S]*Done when all the work inside is done/);
  assert.match(panel, /data-testid="subtask-inspector-title"/);
  assert.match(panel, /aria-label="Time"/);
  assert.match(panel, /aria-label="Work inside"/);
  assert.match(panel, /Delete/);
  assert.doesNotMatch(panel, /data-status=|>Active<|>Waiting<|role="group" aria-label="Status"/, "No task statuses.");
  assert.doesNotMatch(html, /subtask-step-status/, "No Active or Waiting dots on the board.");
});
