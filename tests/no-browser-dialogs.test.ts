import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";

// Owner rule (docs/agent-context.md, "No browser dialogs"): prompts and
// confirmations happen inside the app, never with window.prompt/confirm/alert.

function listSourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const fullPath = path.join(dir, entry);
    if (statSync(fullPath).isDirectory()) {
      return listSourceFiles(fullPath);
    }
    return /\.(ts|tsx)$/.test(entry) ? [fullPath] : [];
  });
}

const taskboardSource = readFileSync("src/components/taskboard.tsx", "utf8");
const teamsSource = readFileSync("src/components/teams-page.tsx", "utf8");
const confirmSource = readFileSync("src/components/ui/confirm-dialog.tsx", "utf8");
const inlineNameSource = readFileSync("src/components/ui/inline-name-field.tsx", "utf8");

test("app source uses no browser prompt, confirm, or alert dialogs", () => {
  const offenders = listSourceFiles("src").filter((file) =>
    /\bwindow\.(confirm|prompt|alert)\s*\(/.test(readFileSync(file, "utf8")),
  );

  assert.deepEqual(offenders, []);
});

test("the shared confirm dialog is an in-app alertdialog that starts destructive actions on Cancel", () => {
  assert.match(confirmSource, /role="alertdialog"/);
  assert.match(confirmSource, /aria-modal="true"/);
  assert.match(confirmSource, /const startOnCancel = isDanger \|\| options\.focusCancel === true;/);
  assert.match(confirmSource, /window\.addEventListener\("keydown", handleKeyDown, true\)/);
  assert.match(confirmSource, /data-keep-surfaces-open=""/);
  // A density rule forces .taskboard-popover padding to 4px.
  assert.doesNotMatch(confirmSource, /className="[^"]*taskboard-popover/);
});

test("the inline name field saves on Enter or blur and cancels on Escape", () => {
  assert.match(inlineNameSource, /event\.key === "Enter"/);
  assert.match(inlineNameSource, /event\.key === "Escape"/);
  assert.match(inlineNameSource, /onBlur=/);
  assert.match(inlineNameSource, /savingRef/);
});

test("board, recycle bin, attachment, and working-note deletes confirm in the app", () => {
  for (const pattern of [
    /title: `Delete "\$\{bucketTitle\}"\?`,\s*body: "Its tasks move into the recycle bin\.",\s*confirmLabel: "Delete bucket",\s*tone: "danger"/,
    /title: `Permanently delete "\$\{itemTitle\}"\?`,\s*body: "This cannot be undone\.",\s*confirmLabel: "Delete forever",\s*tone: "danger"/,
    /title: `Delete "\$\{attachmentName\}" from this task\?`,\s*confirmLabel: "Delete attachment",\s*tone: "danger"/,
    /title: "Delete this note\?",\s*body: "Its attachments will remain on the task\.",\s*confirmLabel: "Delete note",\s*tone: "danger"/,
  ]) {
    assert.match(taskboardSource, pattern);
  }
});

test("a new maintenance location is named in place", () => {
  assert.match(taskboardSource, /if \(value === "__add__"\) \{\s*setIsAddingLocation\(true\);/);
  assert.match(taskboardSource, /<InlineNameField\s+label="New maintenance location name"/);
  assert.match(taskboardSource, /testId="maintenance-location-name-input"/);
});

test("enabling team personal-board visibility confirms in the app with focus on Cancel", () => {
  assert.match(teamsSource, /const confirmed = await confirm\(\{/);
  assert.match(teamsSource, /confirmLabel: "Enable read-only viewing",[\s\S]*?focusCancel: true,/);
  assert.match(teamsSource, /Estimated impact:/);
});
