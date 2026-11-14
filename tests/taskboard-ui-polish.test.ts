import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const taskboardSource = readFileSync("src/components/taskboard.tsx", "utf8");
const globalStylesSource = readFileSync("src/app/globals.css", "utf8");

test("collapsed task cards and drag surfaces share the two-line title clamp", () => {
  assert.equal(
    taskboardSource.match(/className="line-clamp-2 min-w-0 flex-1"/g)?.length,
    3,
  );
});

test("expanded Working Notes exposes one edit and delete action set per note", () => {
  const notesStart = taskboardSource.indexOf("const workingNotesSection");
  const notesEnd = taskboardSource.indexOf("const attachmentsSection", notesStart);
  const notesSource = taskboardSource.slice(notesStart, notesEnd);

  assert.ok(notesStart >= 0 && notesEnd > notesStart);
  assert.equal(notesSource.match(/onClick=\{\(\) => startNoteEdit\(note\)\}/g)?.length, 1);
  assert.equal(notesSource.match(/onClick=\{\(\) => void deleteNote\(note\)\}/g)?.length, 1);
});

test("workspace tabs contain scrolling within each visible section", () => {
  const rule = (selector: string) => {
    const start = globalStylesSource.indexOf(selector);
    assert.ok(start >= 0, `Missing ${selector}`);
    return globalStylesSource.slice(start, globalStylesSource.indexOf("}", start));
  };
  assert.match(rule(".task-workspace-slot {"), /min-width:\s*0;/);
  assert.match(rule(".task-workspace-slot {"), /overflow-y:\s*auto;/);
  assert.match(rule(".task-workspace-grid {"), /overflow:\s*hidden;/);
  assert.match(rule(".task-workspace-slot[hidden]"), /display:\s*none\s*!important/);
  assert.match(globalStylesSource, /@container task-workspace-support \(min-width:\s*640px\)/);
  // Sections own scrolling; nested note streams do not get another scrollbar.
  assert.doesNotMatch(globalStylesSource, /\.task-working-notes-stream \{[\s\S]*?overflow-y: auto;/);
  assert.match(globalStylesSource, /@container task-workspace \(min-width:\s*1180px\)/);
  assert.match(rule('.task-workspace-slot[data-destination="details"] {grid-column:'), /grid-column:\s*2;/);
  // Row hit areas are independent of glyphs and fields. The rendered geometry
  // is covered in workspace-density.spec.ts; do not restore the blanket rule.
  assert.doesNotMatch(globalStylesSource, /\[data-testid="task-editor-expanded"\]\[data-testid="task-editor-expanded"\]/);
  assert.doesNotMatch(globalStylesSource, /@container task-workspace \(max-width: 1023px\)/);
  assert.doesNotMatch(globalStylesSource, /@container task-editor-expanded \(max-width: 1043\.99px\)/);
  assert.match(taskboardSource, /document\.documentElement\.style\.overflow = "hidden"/);
  assert.match(taskboardSource, /taskSidebarRef\.current\?\.scrollIntoView/);
});

test("populated attachment rows keep details and actions in a wrapping grid", () => {
  const attachmentsStart = taskboardSource.indexOf("const attachmentsSection");
  const attachmentsEnd = taskboardSource.indexOf("const workspaceAttachmentsSection", attachmentsStart);
  const attachmentsSource = taskboardSource.slice(attachmentsStart, attachmentsEnd);

  assert.ok(attachmentsStart >= 0 && attachmentsEnd > attachmentsStart);
  assert.match(
    attachmentsSource,
    /className="grid min-w-0 gap-2"[\s\S]*className="flex min-w-0 flex-wrap items-center gap-1"/,
  );
});
