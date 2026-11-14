import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkBreakdown, SubtaskTimeline } from "../src/components/task-work-breakdown";
import { TaskWorkspaceLayout } from "../src/components/task-workspace-layout";
import type { Task } from "../src/lib/taskboard-data";
import { WORKSTREAM_PALETTE } from "../src/lib/subtask-board";

const task = (id: string, extra: Partial<Task> = {}): Task => ({ id, title: id, summary: "", status: "todo", color: "", icon: "wrench", labels: [], notes: [], checklist: [], attachments: [], subtasks: [], ...extra });
const time = { startAt: "2026-10-24T13:00:00Z", endAt: "2026-10-24T21:00:00Z" };
const fixture = () => task("outage", { ...time, subtasks: [
  task("window", { ...time, subtasks: [task("nested", { startAt: "2026-10-24T14:00:00Z", endAt: "2026-10-24T14:20:00Z" })] }),
  task("timed leaf", time), task("untimed leaf"),
] });
const renderWork = (canEdit = true) => renderToStaticMarkup(createElement(WorkBreakdown, {
  task: fixture(), checklist: null, checklistDetail: "None yet", canEdit, timeZone: "America/Chicago",
  onSaveTask: () => {}, onDeleteTask: () => {}, onAddSubtask: () => {},
}));

test("only work windows are highlighted; other top-level rows stay plain but bold", () => {
  const rows = renderWork().match(/<div[^>]*class="work-row"[^>]*>/g) ?? [];
  assert.equal(rows.length, 4);
  assert.equal(rows.filter(row => row.includes('data-kind="window"')).length, 1);
  assert.equal(rows.filter(row => row.includes('data-kind="top"')).length, 2);
  assert.equal(rows.filter(row => row.includes('data-top-level="true"')).length, 3);
});

test("window times stand out and every other time stays plain", () => {
  const html = renderWork();
  assert.equal((html.match(/class="work-when" data-kind="window"/g) ?? []).length, 1);
  assert.equal((html.match(/class="work-when" data-kind="timed"/g) ?? []).length, 2);
});

test("unscheduled top-level work offers Set time when editable", () => {
  assert.match(renderWork(), /<button type="button" class="work-tag work-tag-action">Not scheduled · Set time<\/button>/);
  assert.doesNotMatch(renderWork(false), /Set time<\/button>/);
});

test("read-only rows retain titles and structure without mutation actions", () => {
  const html = renderWork(false);
  assert.match(html, /untimed leaf/);
  // SSR cannot know the viewport: start shut until the client resolves it.
  assert.match(html, /Expand window/);
  assert.doesNotMatch(html, /aria-label="Delete subtask"/);
  assert.doesNotMatch(html, /aria-label="Add child subtask"/);
});

test("short timeline work exposes its complete time independently of the bar label", () => {
  const html = renderToStaticMarkup(createElement(SubtaskTimeline, { task: fixture(), timeZone: "America/Chicago" }));
  assert.match(html, /class="work-timeline-time" data-short="true"/);
  assert.match(html, /aria-label="nested\nStart: Sat, Oct 24, 2026, 9:00 AM CDT\nEnd: Sat, Oct 24, 2026, 9:20 AM CDT\nDuration: 20m"/);
  assert.doesNotMatch(html, /NaN%/);
});

test("inside-window hover details describe nested work while the whole strip keeps its existing labels", () => {
  const root = fixture();
  root.subtasks[0].subtasks[0].subtasks.push(task("Router refresh"), task("Finishing Switch updates"));
  const html = renderToStaticMarkup(createElement(SubtaskTimeline, { task: root, timeZone: "America/Chicago" }));
  const [whole, inside] = html.split('data-tone="window"');
  assert.doesNotMatch(whole, /work-timeline-window-bar|Duration:/);
  assert.match(whole, /class="work-timeline-bar-time">Sat Oct 24 · 8:00 AM → 4:00 PM/);
  assert.match(inside, /Duration: 20m\nWork: Router refresh; Finishing Switch updates/);
});

test("untimed children in a window have no no-time placeholder in either view", () => {
  const root = fixture();
  root.subtasks[0].subtasks.push(task("no-time child"));
  const props = { task: root, timeZone: "America/Chicago" };
  const list = renderToStaticMarkup(createElement(WorkBreakdown, {
    ...props, checklist: null, checklistDetail: "None yet", canEdit: true,
    onSaveTask: () => {}, onDeleteTask: () => {}, onAddSubtask: () => {},
  }));
  assert.doesNotMatch(list, /In this window|no time yet/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(SubtaskTimeline, props)), /In this window|no time yet/);
});

test("mixed parents expose their checkbox state to assistive technology", () => {
  const root = task("root", { subtasks: [task("parent", { subtasks: [task("done", { status: "done" }), task("todo")] })] });
  const html = renderToStaticMarkup(createElement(WorkBreakdown, {
    task: root, timeZone: "America/Chicago", checklist: null, checklistDetail: "None yet", canEdit: true,
    onSaveTask: () => {}, onDeleteTask: () => {}, onAddSubtask: () => {},
  }));
  assert.match(html, /type="checkbox"[^>]*aria-checked="mixed"/);
});

test("progress agrees with parent checkboxes for previously inconsistent task trees", () => {
  const root = task("root", { subtasks: [task("parent", { status: "done", subtasks: [task("unfinished")] })] });
  const html = renderToStaticMarkup(createElement(WorkBreakdown, {
    task: root, timeZone: "America/Chicago", checklist: null, checklistDetail: "None yet", canEdit: true,
    onSaveTask: () => {}, onDeleteTask: () => {}, onAddSubtask: () => {},
  }));
  assert.match(html, /0 of 2 done/);
});

test("working notes and linked Notes have distinct tabs and hidden sections remain mounted", () => {
  const html = renderToStaticMarkup(createElement(TaskWorkspaceLayout, {
    work: "work fixture", workingNotes: "working-note fixture", notes: "linked-note fixture", details: "details fixture", files: "files fixture", notesCount: 2, filesCount: 1,
  }));
  assert.match(html, /role="tab"[^>]*aria-selected="true"[^>]*data-workspace-tab="work"/);
  assert.match(html, /Working notes<small> · 2<\/small>/);
  assert.match(html, /data-workspace-tab="notes"[^>]*>Notes<\/button>/);
  assert.match(html, /hidden=""[^>]*data-destination="notes"[^>]*>linked-note fixture/);
  assert.match(html, /hidden=""[^>]*data-destination="updates"[^>]*>working-note fixture/);
});

test("list rows and timeline strips take each workstream's Board color, never the danger color", () => {
  const root = fixture();
  root.subtasks[1].color = "#e11d48";
  const list = renderWork();
  const nodes = list.match(/<div class="work-node" data-depth="0"[^>]*>/g) ?? [];
  assert.equal(nodes.length, 3);
  assert.match(nodes[0], new RegExp(`--work-color:${WORKSTREAM_PALETTE[0]}`));
  assert.match(nodes[2], new RegExp(`--work-color:${WORKSTREAM_PALETTE[2]}`));
  const timeline = renderToStaticMarkup(createElement(SubtaskTimeline, { task: root, timeZone: "America/Chicago" }));
  assert.match(timeline, new RegExp(`data-tone="window" style="--work-color:${WORKSTREAM_PALETTE[0]}"`));
  assert.match(timeline, new RegExp(`class="contents" style="--work-color:${WORKSTREAM_PALETTE[1]}"`), "A stored color is ignored: subtasks have none of their own.");
  assert.doesNotMatch(list + timeline, /danger/);
});

test("timeline bars stay inside their strip and work outside it is called out", () => {
  const root = fixture();
  const window = root.subtasks[0];
  window.subtasks = [
    task("early", { startAt: "2026-10-24T11:00:00Z", endAt: "2026-10-24T15:00:00Z" }),
    task("after", { startAt: "2026-10-25T01:00:00Z", endAt: "2026-10-25T02:00:00Z" }),
  ];
  const html = renderToStaticMarkup(createElement(SubtaskTimeline, { task: root, timeZone: "America/Chicago" }));
  const inside = html.split('data-tone="window"')[1];
  // 13:00-21:00 window: "early" shows its 13:00-15:00 part, a quarter.
  assert.match(inside, /aria-label="early[^"]*"[^>]*style="left:0%;width:25%"/);
  // Desktop hides lane times, so the warning keeps the schedule for hover and screen readers.
  assert.match(inside, /work-timeline-outside" title="after · [^"]+">\s*Outside the window<span class="sr-only"> · Sat Oct 24/);
  for (const [, left, width] of html.matchAll(/class="work-timeline-bar[^"]*"[^>]*style="left:([\d.]+)%;width:([\d.]+)%"/g)) {
    assert.ok(Number(left) + Number(width) <= 100.0001, `bar ends at ${Number(left) + Number(width)}%`);
  }
});

test("timeline lanes count work done from what is inside them", () => {
  const root = fixture();
  root.subtasks[0].subtasks[0].status = "done";
  const html = renderToStaticMarkup(createElement(SubtaskTimeline, { task: root, timeZone: "America/Chicago" }));
  const whole = html.split('data-tone="window"')[0];
  assert.match(whole, /aria-label="window[^"]*"[^>]*data-done="true"/, "A window whose work is all done reads as done.");
  assert.match(whole, /<span class="work-timeline-name">window<\/span>/);
});
