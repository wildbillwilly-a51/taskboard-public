import assert from "node:assert/strict";
import test from "node:test";

import {
  getDueDeadline,
  getRescheduleToTodayDueAt,
  isTaskOverdue,
} from "../src/lib/taskboard-overdue";
import {
  isShortcutBlockedTarget,
  rankPaletteItems,
  resolveShortcut,
} from "../src/lib/taskboard-shortcuts";

const key = (value: string, modifiers: Partial<Record<"ctrlKey" | "metaKey" | "altKey" | "shiftKey", boolean>> = {}) => ({
  key: value,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...modifiers,
});

test("Ctrl+K and Cmd+K open the palette even with single keys off", () => {
  assert.equal(resolveShortcut(key("k", { ctrlKey: true }), { singleKeys: true }), "palette");
  assert.equal(resolveShortcut(key("K", { metaKey: true }), { singleKeys: false }), "palette");
  assert.equal(resolveShortcut(key("k", { ctrlKey: true, shiftKey: true }), { singleKeys: true }), null);
});

test("single keys map to commands and respect the off switch", () => {
  assert.equal(resolveShortcut(key("n"), { singleKeys: true }), "new-task");
  assert.equal(resolveShortcut(key("J"), { singleKeys: true }), "next-card");
  assert.equal(resolveShortcut(key("2"), { singleKeys: true }), "status-active");
  assert.equal(resolveShortcut(key("?", { shiftKey: true }), { singleKeys: true }), "help");
  assert.equal(resolveShortcut(key("n"), { singleKeys: false }), null);
  assert.equal(resolveShortcut(key("n", { shiftKey: true }), { singleKeys: true }), null);
  assert.equal(resolveShortcut(key("n", { ctrlKey: true }), { singleKeys: true }), null);
  assert.equal(resolveShortcut(key("d", { altKey: true }), { singleKeys: true }), null);
  assert.equal(resolveShortcut(key("Enter"), { singleKeys: true }), null);
  assert.equal(resolveShortcut(key("x"), { singleKeys: true }), null);
});

test("typing targets and overlays block single keys", () => {
  const element = (matches: string[]) => ({
    closest: (selector: string) => (matches.some((match) => selector.includes(match)) ? {} : null),
  });

  assert.equal(isShortcutBlockedTarget(element(["input"])), true);
  assert.equal(isShortcutBlockedTarget(element(['[role="dialog"]'])), true);
  assert.equal(isShortcutBlockedTarget(element(["[data-selection-scope]"])), true, "A subtask picked on the work tab's board is not the open task.");
  assert.equal(isShortcutBlockedTarget({ closest: () => null, isContentEditable: true }), true);
  assert.equal(isShortcutBlockedTarget(element([])), false);
  assert.equal(isShortcutBlockedTarget(null), false);
});

test("palette ranking prefers label starts and requires every word", () => {
  const items = [
    { label: "Open Calendar", group: "Go to" },
    { label: "Calendar outages", group: "Go to" },
    { label: "Move to bucket", group: "Task", keywords: "column" },
    { label: "Set due today", group: "Task" },
  ];

  assert.deepEqual(rankPaletteItems(items, "cal").map((item) => item.label), ["Calendar outages", "Open Calendar"]);
  assert.deepEqual(rankPaletteItems(items, "column").map((item) => item.label), ["Move to bucket"]);
  assert.deepEqual(rankPaletteItems(items, "due tod").map((item) => item.label), ["Set due today"]);
  assert.equal(rankPaletteItems(items, "").length, items.length);
  assert.equal(rankPaletteItems(items, "zzz").length, 0);
});

test("overdue: open tasks with a past due date, excluding done and read-only imports", () => {
  const now = new Date(2026, 9, 15, 12, 0);

  assert.equal(isTaskOverdue({ status: "todo", dueAt: new Date(2026, 9, 15, 11, 0).toISOString() }, now), true);
  assert.equal(isTaskOverdue({ status: "todo", dueAt: new Date(2026, 9, 15, 17, 0).toISOString() }, now), false);
  assert.equal(isTaskOverdue({ status: "done", dueAt: "2026-04-17T18:00:00.000Z" }, now), false);
  assert.equal(
    isTaskOverdue({ status: "waiting", dueAt: "2026-04-17T18:00:00.000Z", importedFrom: { readOnly: true } }, now),
    false,
  );
  assert.equal(isTaskOverdue({ status: "active", dueAt: null }, now), false);
});

test("a date-only due date stays on time until the end of that day", () => {
  assert.equal(getDueDeadline("2026-10-15"), new Date(2026, 9, 16).getTime());
  assert.equal(isTaskOverdue({ status: "todo", dueAt: "2026-10-15" }, new Date(2026, 9, 15, 23, 0)), false);
  assert.equal(isTaskOverdue({ status: "todo", dueAt: "2026-10-14" }, new Date(2026, 9, 15, 0, 1)), true);
  assert.equal(getDueDeadline("not a date"), null);
});

test("move to today lands at 5 PM, or at the end of the day after 5 PM", () => {
  assert.equal(getRescheduleToTodayDueAt(new Date(2026, 9, 15, 9, 30)), new Date(2026, 9, 15, 17, 0).toISOString());
  assert.equal(getRescheduleToTodayDueAt(new Date(2026, 9, 15, 18, 0)), new Date(2026, 9, 15, 23, 59).toISOString());
});

test("the board wires shortcuts, the palette and keyboard-focusable task rows", async () => {
  const { readFileSync } = await import("node:fs");
  const taskboardSource = readFileSync("src/components/taskboard.tsx", "utf8");
  const calendarSource = readFileSync("src/components/calendar-proof-inner.tsx", "utf8");
  const uiSettingsSource = readFileSync("src/lib/ui-settings.ts", "utf8");
  const optionsSource = readFileSync("src/components/options-page.tsx", "utf8");

  assert.match(taskboardSource, /resolveShortcut\(event, \{ singleKeys: settings\.singleKeyShortcuts \}\)/);
  assert.match(taskboardSource, /document\.querySelector\(OPEN_OVERLAY_SELECTOR\)/);
  assert.match(taskboardSource, /<CommandPalette key=\{paletteMode\.title\}/);
  assert.match(taskboardSource, /<ShortcutSheet/);
  // Collapsed cards, full cards and Agenda rows all join J/K navigation.
  assert.equal(taskboardSource.match(/data-task-nav=\{task\.id\}/g)?.length, 3);
  // Keyboard edits send only the changed fields and keep the undo toast. They
  // and their undo go through the task's save queue, as the editors do.
  assert.match(taskboardSource, /const handleSaveTask = async \(\s*taskId: string,\s*patch: TaskSavePatch,/);
  assert.match(taskboardSource, /const saved = await saveTaskInQueue\(taskId, patch\);/);
  assert.match(taskboardSource, /showUndoToast\(message, async \(\) => \{\s*await saveTaskInQueue\(taskId, restore\);/);
  // Sharing is labeled as sharing and closes on Escape before the sidebar does.
  assert.match(taskboardSource, /aria-label="Share board"/);
  assert.match(taskboardSource, /document\.addEventListener\("keydown", handleKeyDown, true\);\s*return \(\) => document\.removeEventListener\("keydown", handleKeyDown, true\);\s*\}, \[isBoardSettingsOpen\]\);/);
  // Agenda leads with overdue work and can move it all to today.
  assert.match(taskboardSource, /data-testid="agenda-move-overdue-today"/);
  // A calendar click only selects a time; New entry shows and uses it.
  assert.match(calendarSource, /data-testid="calendar-new-entry-slot"/);
  assert.doesNotMatch(calendarSource, /local session items hidden/);
  assert.match(uiSettingsSource, /singleKeyShortcuts: true,/);
  assert.match(optionsSource, /label="Single-key shortcuts"/);
});
