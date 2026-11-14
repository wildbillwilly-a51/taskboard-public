import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const taskboardSource = readFileSync("src/components/taskboard.tsx", "utf8");
const layoutSource = readFileSync("src/components/task-workspace-layout.tsx", "utf8");
const breakdownSource = readFileSync("src/components/task-work-breakdown.tsx", "utf8");
const sharedSource = readFileSync("src/components/taskboard-shared.tsx", "utf8");

test("the workspace header retains status, title, scheduling, and actions", () => {
  assert.match(taskboardSource, /className="workspace-header-row" data-testid="task-overview-section"/);
  assert.match(taskboardSource, /workspaceStatusControl[\s\S]*workspaceTitleControl[\s\S]*className="workspace-chips"/);
  assert.match(taskboardSource, /data-testid="task-workspace-date-chip"/);
  // The Calendar card and the fixed context zone are gone; Calendar is a header icon.
  assert.doesNotMatch(taskboardSource, /task-workspace-context/);
  assert.doesNotMatch(taskboardSource, /task-workspace-calendar-handoff/);
  assert.doesNotMatch(taskboardSource, /<SectionCard title="Overview">/);
});

test("the workspace separates work, working notes, linked Notes, details, and files", () => {
  assert.match(layoutSource, /work: ReactNode;\s+workingNotes: ReactNode;\s+notes: ReactNode;\s+details: ReactNode;\s+files: ReactNode;/);
  assert.match(layoutSource, /role="tablist" aria-label="Task workspace sections"/);
  assert.match(taskboardSource, /<TaskWorkspaceLayout[\s\S]*workingNotes=\{workingNotesSection\}/);
  // Outage fields live in the details column, not above the work.
  assert.match(taskboardSource, /details=\{[\s\S]*?<MaintenanceOutageFields[\s\S]*?compact/);
});

test("subtasks retain times, windows, scheduling actions, and a timeline", () => {
  assert.match(taskboardSource, /<WorkBreakdown\s+(?:[^>]*?\s)?task=\{task\}/);
  assert.doesNotMatch(breakdownSource, /In this window · no time yet/);
  assert.match(breakdownSource, /Not scheduled/);
  assert.match(breakdownSource, /aria-label=\{hasTime \? "Change time" : "Set time"\}/);
  assert.match(breakdownSource, /\{formatHours\(fill\.scheduledHours\)\} of \{formatHours\(fill\.totalHours\)\} h\s*<\/span>/);
  assert.match(breakdownSource, /Outside the window/);
  assert.match(breakdownSource, /export function SubtaskTimeline/);
  // Subtask edits send only what changed.
  assert.match(breakdownSource, /onSaveTask\(item\.id, \{ title: nextTitle \}\)/);
  assert.match(breakdownSource, /onSaveTask\(item\.id, \{ status: isDone \? "todo" : "done" \}\)/);
});

test("sidebar working notes keep their fold state and Escape reaches fields first", () => {
  assert.match(taskboardSource, /data-testid="task-working-notes-toggle"/);
  assert.match(taskboardSource, /const WORKING_NOTES_OPEN_KEY = "taskboard-workspace-notes-open";/);
  assert.match(sharedSource, /closeOnEscape = true,/);
  assert.match(taskboardSource, /refs: \[expandedDetailPanelRef\],\s+closeOnEscape: false,/);
});
