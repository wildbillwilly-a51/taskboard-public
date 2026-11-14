import assert from "node:assert/strict";
import test from "node:test";
import type { Board, Task } from "@/lib/taskboard-data";
import {
  filterBoardByTaskSearch,
  getTaskSearchTokens,
  taskMatchesSearch,
} from "@/lib/taskboard-search";

function makeTask(patch: Partial<Task>): Task {
  return {
    id: patch.id ?? crypto.randomUUID(),
    title: patch.title ?? "Untitled task",
    summary: patch.summary ?? "",
    nextAction: patch.nextAction,
    status: patch.status ?? "todo",
    color: patch.color ?? "#64748b",
    icon: patch.icon ?? "flag",
    startAt: patch.startAt,
    dueAt: patch.dueAt,
    recurrence: patch.recurrence,
    reminderConfig: patch.reminderConfig,
    labels: patch.labels ?? [],
    notes: patch.notes ?? [],
    checklist: patch.checklist ?? [],
    attachments: patch.attachments ?? [],
    subtasks: patch.subtasks ?? [],
    importedFrom: patch.importedFrom,
  };
}

test("search tokenization ignores case, punctuation, and extra spaces", () => {
  assert.deepEqual(getTaskSearchTokens("  Datto,   BACKUP!! "), ["datto", "backup"]);
});

test("empty search matches all tasks", () => {
  assert.equal(taskMatchesSearch(makeTask({ title: "Anything" }), "Inbox", ""), true);
  assert.equal(taskMatchesSearch(makeTask({ title: "Anything" }), "Inbox", "   "), true);
});

test("AND-token matching requires every token in the same task search text", () => {
  const matchingTask = makeTask({
    title: "Datto billing cleanup",
    summary: "Confirm backup invoices before renewal.",
  });
  const dattoOnlyTask = makeTask({ title: "Datto billing cleanup" });
  const backupOnlyTask = makeTask({ title: "Backup invoice review" });

  assert.equal(taskMatchesSearch(matchingTask, "Admin", "Datto backup"), true);
  assert.equal(taskMatchesSearch(dattoOnlyTask, "Admin", "Datto backup"), false);
  assert.equal(taskMatchesSearch(backupOnlyTask, "Admin", "Datto backup"), false);
});

test("partial words match the start of task words while typing", () => {
  const task = makeTask({ title: "Prepare Q4 planning deck" });

  assert.equal(taskMatchesSearch(task, "Deep Work", "plan"), true);
  assert.equal(taskMatchesSearch(task, "Deep Work", "pl"), true);
  assert.equal(taskMatchesSearch(task, "Deep Work", "plan dec"), true);
  assert.equal(taskMatchesSearch(task, "Deep Work", "deep plan"), true);
  // Matches the start of a word only, and every token is still required.
  assert.equal(taskMatchesSearch(task, "Deep Work", "lanning"), false);
  assert.equal(taskMatchesSearch(task, "Deep Work", "plan budget"), false);
});

test("labels, notes, checklist, subtasks, bucket names, and attachment names are searchable", () => {
  const task = makeTask({
    title: "Quarterly vendor review",
    labels: ["Infrastructure"],
    notes: [
      {
        id: "note-1",
        body: "Confirm recovery point objective.",
        createdAt: "2026-06-17T12:00:00Z",
        authorName: "Taskboard",
        attachments: [
          {
            id: "note-attachment-1",
            originalName: "handoff.pdf",
            displayName: "handoff.pdf",
            mimeType: "application/pdf",
            sizeBytes: 120,
            createdAt: "2026-06-17T12:00:00Z",
            previewKind: "pdf",
          },
        ],
      },
    ],
    checklist: [{ id: "check-1", label: "Validate retention policy", done: false }],
    attachments: [
      {
        id: "attachment-1",
        originalName: "restore-plan.png",
        displayName: "restore-plan.png",
        mimeType: "image/png",
        sizeBytes: 68,
        createdAt: "2026-06-17T12:00:00Z",
        previewKind: "image",
      },
    ],
    subtasks: [
      makeTask({
        id: "subtask-1",
        title: "Document escalation route",
        summary: "Escalation path for outage follow-up.",
      }),
    ],
  });

  assert.equal(taskMatchesSearch(task, "Vendor Ops", "Infrastructure"), true);
  assert.equal(taskMatchesSearch(task, "Vendor Ops", "recovery objective"), true);
  assert.equal(taskMatchesSearch(task, "Vendor Ops", "retention policy"), true);
  assert.equal(taskMatchesSearch(task, "Vendor Ops", "escalation outage"), true);
  assert.equal(taskMatchesSearch(task, "Vendor Ops", "Vendor Ops"), true);
  assert.equal(taskMatchesSearch(task, "Vendor Ops", "restore plan"), true);
  assert.equal(taskMatchesSearch(task, "Vendor Ops", "handoff pdf"), true);
});

test("filterBoardByTaskSearch keeps buckets visible while filtering root tasks", () => {
  const board: Board = {
    id: "board-1",
    title: "Board",
    description: "",
    views: [],
    buckets: [
      {
        id: "bucket-1",
        title: "Admin",
        color: "#64748b",
        icon: "inbox",
        collapsed: false,
        tasks: [
          makeTask({ id: "task-1", title: "Datto backup renewal" }),
          makeTask({ id: "task-2", title: "Payroll review" }),
        ],
      },
      {
        id: "bucket-2",
        title: "Empty after search",
        color: "#64748b",
        icon: "inbox",
        collapsed: false,
        tasks: [makeTask({ id: "task-3", title: "Grocery list" })],
      },
    ],
  };

  const filtered = filterBoardByTaskSearch(board, "datto backup");

  assert.equal(filtered.buckets.length, 2);
  assert.deepEqual(filtered.buckets.map((bucket) => bucket.tasks.map((task) => task.id)), [
    ["task-1"],
    [],
  ]);
});
