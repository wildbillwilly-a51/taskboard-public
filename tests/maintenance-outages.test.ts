import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildTaskSearchText } from "@/lib/taskboard-search";
import type { Task } from "@/lib/taskboard-data";

function outageTask(): Task {
  return {
    id: "outage",
    title: "Planned electrical shutdown",
    summary: "Replace switchgear",
    status: "todo",
    color: "#0f766e",
    icon: "calendar",
    labels: [],
    notes: [],
    checklist: [],
    attachments: [],
    subtasks: [],
    workItemType: "maintenance_outage",
    maintenanceOutage: {
      locationId: "north-plant",
      locationName: "North Plant",
      owner: "Facilities",
      attendees: ["Safety", "Electrical"],
    },
  };
}

test("outage metadata participates in Taskboard search", () => {
  const searchText = buildTaskSearchText(outageTask(), "Maintenance");
  assert.match(searchText, /maintenance outage/i);
  assert.match(searchText, /North Plant/);
  assert.match(searchText, /Facilities/);
  assert.match(searchText, /Safety/);
});

test("normal quick task creation still defaults to task work items", () => {
  const routeSource = readFileSync("src/app/api/tasks/route.ts", "utf8");
  const taskboardSource = readFileSync("src/components/taskboard.tsx", "utf8");

  assert.match(routeSource, /workItemType: body\.workItemType \?\? "task"/);
  assert.match(taskboardSource, /workItemType: "task" \| "maintenance_outage" = "task"/);
  assert.match(taskboardSource, />\s*\+ Add task\s*</);
  assert.match(taskboardSource, /placeholder=\{newWorkItemType === "maintenance_outage" \? "Outage title" : "Task title"\}/);
});

test("bucket quick create keeps Add task primary and moves outage into a connected menu", () => {
  const taskboardSource = readFileSync("src/components/taskboard.tsx", "utf8");

  assert.match(taskboardSource, /taskboard-add-split-control/);
  assert.match(taskboardSource, />\s*\+ Add task\s*</);
  assert.match(taskboardSource, /aria-label=\{`More create options for \$\{bucket\.title\}`\}/);
  assert.match(taskboardSource, /aria-haspopup="menu"/);
  assert.match(taskboardSource, /role="menuitem"[\s\S]*?setNewWorkItemType\("maintenance_outage"\)[\s\S]*?Outage/);
  assert.doesNotMatch(taskboardSource, /aria-label=\{`Add maintenance outage to \$\{bucket\.title\}`\}/);
});

test("bucket quick create is rendered before the task stack", () => {
  const taskboardSource = readFileSync("src/components/taskboard.tsx", "utf8");
  const bucketBodyStart = taskboardSource.indexOf("taskboard-bucket-body pretty-scrollbar");
  const quickCreateStart = taskboardSource.indexOf("taskboard-add-split-control", bucketBodyStart);
  const taskStackStart = taskboardSource.indexOf("{bucket.collapsed ?", bucketBodyStart);

  assert.notEqual(bucketBodyStart, -1);
  assert.notEqual(quickCreateStart, -1);
  assert.notEqual(taskStackStart, -1);
  assert.ok(quickCreateStart < taskStackStart);
});

test("task cards are one full-card button that opens on click and drags from anywhere", () => {
  const taskboardSource = readFileSync("src/components/taskboard.tsx", "utf8");

  assert.match(taskboardSource, /<SortableContext[\s\S]*?<SortableCollapsedTaskCard/);
  assert.match(taskboardSource, /const SortableCollapsedTaskCard = memo/);
  assert.doesNotMatch(taskboardSource, /data-drag-handle=/);
  assert.doesNotMatch(taskboardSource, /aria-label=\{`Drag \$\{task\.title\}`\}/);
  assert.match(
    taskboardSource,
    /ref=\{isDragDisabled \? undefined : setActivatorNodeRef\}[\s\S]*?\{\.\.\.\(isDragDisabled \? \{\} : \{ \.\.\.attributes, \.\.\.listeners \}\)\}[\s\S]*?onClick=\{\(\) => onSelectTask\(task\.id\)\}[\s\S]*?aria-label=\{`Open task \$\{task\.title\}\$\{isOverdue \? \" \(overdue\)\" : \"\"\}`\}/,
  );
  assert.match(taskboardSource, /data-drag-surface=\{isDragDisabled \? undefined : "true"\}/);
  assert.match(taskboardSource, /dragActivatorRef=\{isDragDisabled \? undefined : setActivatorNodeRef\}/);
  assert.match(taskboardSource, /dragActivatorProps=\{isDragDisabled \? undefined : \{ \.\.\.attributes, \.\.\.listeners \}\}/);
  // Enter stays free to open the task; Space picks a card up for keyboard moving.
  assert.match(taskboardSource, /start: \[KeyboardCode\.Space\]/);
});

test("collapsed task drags retain the compact task presentation", () => {
  const taskboardSource = readFileSync("src/components/taskboard.tsx", "utf8");

  assert.match(taskboardSource, /presentation: "collapsed"/);
  assert.match(taskboardSource, /presentation: "expanded"/);
  assert.match(taskboardSource, /setActiveTaskPreviewMode\([\s\S]*?presentation === "collapsed"/);
  assert.match(taskboardSource, /activeTaskPreviewMode === "collapsed"[\s\S]*?<CollapsedTaskDragPreview/);
  assert.match(taskboardSource, /data-testid="collapsed-task-drag-preview"/);
  assert.match(taskboardSource, /className=\{`taskboard-card flex w-full/);
  // The drag preview shows status as the card's left bar, not the task color.
  assert.match(taskboardSource, /data-testid="collapsed-task-drag-preview"\s+data-task-status=\{task\.status\}/);
  assert.doesNotMatch(taskboardSource, /"--task-accent-color": taskAccentColor/);
  assert.match(taskboardSource, /setActiveTaskPreviewMode\(null\)/);
});

test("promotion and optional outage fields use the existing task update route", () => {
  const routeSource = readFileSync("src/app/api/tasks/[taskId]/route.ts", "utf8");
  const storeSource = readFileSync("src/lib/taskboard-store.ts", "utf8");

  assert.match(routeSource, /promoteToMaintenanceOutage/);
  assert.match(routeSource, /maintenanceOutage/);
  assert.match(storeSource, /Only root tasks can be maintenance outages/);
  assert.match(storeSource, /Convert the imported item to an editable task before promoting it/);
  assert.match(storeSource, /ON CONFLICT \(task_id\) DO UPDATE/);
});
