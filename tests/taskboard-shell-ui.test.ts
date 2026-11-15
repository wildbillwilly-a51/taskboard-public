import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const taskboardSource = readFileSync("src/components/taskboard.tsx", "utf8");
const taskboardSharedSource = readFileSync("src/components/taskboard-shared.tsx", "utf8");
const viewSettingsSource = readFileSync("src/components/taskboard-view-settings.tsx", "utf8");
const optionsSource = readFileSync("src/components/options-page.tsx", "utf8");
const uiSettingsSource = readFileSync("src/lib/ui-settings.ts", "utf8");
const taskboardStoreSource = readFileSync("src/lib/taskboard-store.ts", "utf8");
const globalStyles = readFileSync("src/app/globals.css", "utf8");
const sharedScaleStyles = readFileSync("src/app/skins/shared-scale.css", "utf8");

test("the two-tier board header is always docked above the workspace", () => {
  assert.match(taskboardSource, /ref=\{boardHeaderRef\}/);
  assert.match(taskboardSource, /ref=\{boardStageRef\}/);
  assert.match(taskboardSource, /--taskboard-sticky-header-offset/);
  // The nav row spans the header so its tools stay put when the sidebar opens.
  assert.doesNotMatch(taskboardSource, /--taskboard-view-stage-width/);
  assert.doesNotMatch(sharedScaleStyles, /--taskboard-view-stage-width/);
  assert.match(taskboardSource, /className="taskboard-main-header sticky top-0 z-40 overflow-visible"/);
  assert.match(taskboardSource, /taskboard-header-identity-row taskboard-header-utility-row/);
  assert.match(taskboardSource, /taskboard-header-nav-row w-full/);
  assert.doesNotMatch(taskboardSource, /settings\.headerPinned \? "sticky top-2" : ""/);
  assert.doesNotMatch(taskboardSource, /Pin header|Unpin header/);
  assert.match(
    sharedScaleStyles,
    /:is\(\[data-testid="board-header"\], \[data-workspace-header\]\)\.taskboard-main-header\s*\{[^}]*padding: 0 !important;[^}]*top: 0 !important;/,
  );
  assert.match(
    sharedScaleStyles,
    /taskboard-header-nav-row \{[^}]*width: auto;/,
  );
  assert.match(taskboardSource, /taskboard-calendar-stage overflow-visible/);
  assert.match(globalStyles, /data-header-pinned="true"[\s\S]*taskboard-calendar-proof__masthead/);
  assert.match(globalStyles, /top: var\(--taskboard-sticky-header-offset, 7rem\)/);
});

test("every fresh load starts with the header pinned", () => {
  assert.match(uiSettingsSource, /headerPinned: true/);
  assert.match(uiSettingsSource, /Header pinning is session-scoped: every fresh load starts pinned/);
  assert.match(uiSettingsSource, /document\.documentElement\.dataset\.headerPinned = 'true'/);
});

test("header theme control is removed and button typography uses the shared compact style", () => {
  assert.doesNotMatch(taskboardSource, /ThemeDropdown/);
  assert.match(taskboardSource, /aria-label=\{`Board: \$\{currentAccessibleBoard\?\.title \?\? board\.title\}`\}/);
  assert.match(taskboardSource, /className=\{`\$\{SMALL_CHIP_BUTTON_CLASS\} max-w-full`\}/);
  // Board sharing is labeled as sharing, with its own icon.
  assert.match(taskboardSource, /aria-label="Share board"/);
  assert.match(taskboardSource, /<Share2 className="h-3\.5 w-3\.5 shrink-0" aria-hidden="true" \/>/);
});

test("Recycle Bin and Archives are available from the overflow menu", () => {
  assert.match(taskboardSource, />Manage<\/p>[\s\S]*?<span>Recycle Bin<\/span>/);
  assert.match(taskboardSource, />Manage<\/p>[\s\S]*?<span>Archives<\/span>/);
});

test("density tiers center today's compact geometry between relaxed and tight", () => {
  assert.match(uiSettingsSource, /DensityMode = "relaxed" \| "standard" \| "tight"/);
  assert.match(uiSettingsSource, /density: "standard"/);
  assert.match(uiSettingsSource, /\["relaxed", "standard", "tight"\]/);
  assert.match(optionsSource, /value: "relaxed", label: "Relaxed"/);
  assert.match(optionsSource, /value: "standard", label: "Standard"/);
  assert.match(optionsSource, /value: "tight", label: "Tight"/);
  assert.match(
    taskboardSource,
    /settings\.density === "relaxed" \? "gap-2" : settings\.density === "tight" \? "gap-1" : "gap-1\.5"/,
  );
  assert.match(globalStyles, /data-density="standard"[\s\S]*taskboard-popover/);
  assert.match(
    globalStyles,
    /data-density="tight"[\s\S]*taskboard-bucket-body[\s\S]*gap: 5px;[\s\S]*min-height: 84px;/,
  );
});

test("Options keeps its return action available while settings scroll", () => {
  assert.match(
    optionsSource,
    /taskboard-options-header panel-surface panel-strong sticky top-0 z-40/,
  );
  assert.match(optionsSource, /data-testid="options-header"/);
  assert.match(optionsSource, /Back to previous view/);
  assert.match(
    globalStyles,
    /\.taskboard-shell \.taskboard-options-header\.panel-strong \{[\s\S]*background: var\(--popover\) !important;/,
  );
});

test("header utilities stay accessible without the global Board collapse control", () => {
  assert.match(taskboardSource, /aria-label="Add bucket"[\s\S]*title="Add bucket"/);
  assert.match(taskboardSource, /aria-label="Menu"[\s\S]*title="Menu"/);
  assert.match(taskboardSource, /<MoreHorizontal className="h-3\.5 w-3\.5" \/>/);
  assert.match(taskboardSource, /<WorkspacePrimaryNav\b[^>]*tasksHref=\{buildTaskboardWorkspaceHref\(isRoutedWorkspace \? lastTaskView : viewMode\)\}/);
  assert.doesNotMatch(taskboardSource, /taskboard-board-split-toggle|BulkCollapseIcon|bulkCollapseButtonLabel/);
});

test("desktop workspace menu exposes its close button", () => {
  assert.match(taskboardSource, /SurfaceCloseButton label="Close menu"/);
  assert.doesNotMatch(taskboardSharedSource, /Close (color menu|icon menu|theme menu)/);
  assert.doesNotMatch(viewSettingsSource, /Close view settings/);
  assert.match(taskboardSource, /Close task inspector/);
});

test("bucket movement uses one icon-only row and style controls use compact fixed grids", () => {
  assert.match(taskboardSource, /mt-1 grid grid-cols-4 gap-1/);
  assert.match(taskboardSource, /aria-label="Move bucket to start"[\s\S]*?<ArrowLeftToLine/);
  assert.match(taskboardSource, /aria-label="Move bucket left"[\s\S]*?<ArrowLeft/);
  assert.match(taskboardSource, /aria-label="Move bucket right"[\s\S]*?<ArrowRight/);
  assert.match(taskboardSource, /aria-label="Move bucket to end"[\s\S]*?<ArrowRightToLine/);
  assert.doesNotMatch(taskboardSource, /<ArrowLeftToLine[^>]*\/>\s*First/);
  assert.doesNotMatch(taskboardSource, /<ArrowLeft[^>]*\/>\s*Left/);
  assert.doesNotMatch(taskboardSource, /<ArrowRight[^>]*\/>\s*Right/);
  assert.doesNotMatch(taskboardSource, /<ArrowRightToLine[^>]*\/>\s*Last/);
  assert.match(taskboardSource, /grid grid-cols-3 gap-1\.5 px-1\.5 pb-2/);
  assert.match(taskboardSource, /grid grid-cols-3 gap-1 px-1\.5 pb-1/);
});

test("the bucket icon is the only reorder handle and the sidebar keeps its footer docked", () => {
  assert.doesNotMatch(taskboardSource, /GripVertical|taskboard-bucket-grip/);
  assert.match(taskboardSource, /data-testid="bucket-reorder-handle"[\s\S]*?<span[\s\S]*taskboard-bucket-icon/);
  assert.match(taskboardSource, /taskboard-task-sidebar[\s\S]*overflow-hidden/);
  assert.match(taskboardSource, /pretty-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto/);
  assert.match(taskboardSource, /data-testid="task-inspector-open-workspace"[\s\S]*data-testid="task-inspector-view-calendar"/);
  assert.doesNotMatch(taskboardSource, /taskboard-task-sidebar[^\n]*overscroll-contain|taskboard-task-sidebar[^\n]*md:top-3/);
  assert.match(taskboardSource, /--taskboard-sidebar-sticky-top/);
  assert.match(globalStyles, /\.taskboard-task-sidebar \{[\s\S]*height: calc\(100dvh - var\(--taskboard-sidebar-sticky-top/);
  assert.match(globalStyles, /top: var\(--taskboard-sidebar-sticky-top, 0\.75rem\)/);
  assert.match(taskboardSource, /ui-button-surface w-full justify-center border py-1\.5/);
});

test("the task inspector keeps the established responsive right rail", () => {
  assert.match(taskboardSource, /taskboard-workspace-row flex flex-col[^\n]*md:flex-row/);
  assert.match(
    taskboardSource,
    /taskboard-task-sidebar[^\n]*w-full[^\n]*md:sticky[^\n]*\$\{sidebarWidthClass\}/,
  );
  assert.doesNotMatch(
    sharedScaleStyles,
    /\.taskboard-shell \.taskboard-workspace-row\s*\{\s*flex-direction:\s*column\s*!important;/,
  );
  assert.doesNotMatch(
    sharedScaleStyles,
    /\.taskboard-shell \.taskboard-task-sidebar\s*\{[^}]*\b(?:order:\s*-1|position:\s*static\s*!important|width:\s*100%\s*!important)/,
  );
});

// Owner decision 2026-10-16: a task marked done stays in place until it is
// archived. Only a recurring completion archives, after its next occurrence
// is created, because that occurrence takes its place.
test("only a recurring root completion archives, after the next occurrence is created", () => {
  const transitionIndex = taskboardStoreSource.indexOf("const transitionedToDone =");
  const recurrenceIndex = taskboardStoreSource.indexOf(
    "if (transitionedToDone && nextRecurrence && nextDueAt)",
    transitionIndex,
  );
  const archiveIndex = taskboardStoreSource.indexOf(
    "if (transitionedToDone && nextRecurrence && nextDueAt)",
    recurrenceIndex + 1,
  );

  assert.ok(transitionIndex >= 0);
  assert.match(taskboardStoreSource.slice(transitionIndex, recurrenceIndex), /task\.parent_task_id === null/);
  assert.ok(recurrenceIndex > transitionIndex);
  assert.ok(archiveIndex > recurrenceIndex);
  assert.match(taskboardStoreSource.slice(archiveIndex), /await archiveRootTaskTree\(client, \{/);
  assert.doesNotMatch(taskboardStoreSource, /if \(transitionedToDone\) \{/);
  assert.match(taskboardSource, /Done tasks wait here for review until you archive them/);
});

test("an open newly archived task remains visible but read-only until replaced", () => {
  assert.match(taskboardSource, /type RetainedArchivedTask = \{/);
  assert.match(taskboardSource, /selectedActiveTask \?\?[\s\S]*retainedArchivedTask\.task/);
  assert.match(taskboardSource, /setRetainedArchivedTask\(\{[\s\S]*task: retainedTaskAfterSave/);
  assert.match(taskboardSource, /const canMutateTask = canEditBoard && !isReadOnlyImport && !isArchived/);
  assert.match(taskboardSource, /data-testid="task-editor-archived-status"[\s\S]*Archived/);
  assert.match(taskboardSource, /className="ui-danger-banner ed-chip/);
  assert.match(taskboardSource, /handleSelectTask[\s\S]*setRetainedArchivedTask\(null\)/);
  assert.match(taskboardSource, /handleCloseInspector[\s\S]*setRetainedArchivedTask\(null\)/);
});

test("sidebar schedule, notes, actions, and autosave follow the compact approved layout", () => {
  assert.match(taskboardSource, /function SidebarScheduleDisclosure/);
  assert.match(taskboardSource, /const \[isOpen, setIsOpen\] = useState\(false\)/);
  assert.match(taskboardSource, /aria-expanded=\{isOpen\}[\s\S]*<ChevronDown[\s\S]*isOpen \? "rotate-180" : ""/);
  assert.match(taskboardSource, /autosaveState !== "saved"[\s\S]*setTimeout\(\(\) => setAutosaveState\("idle"\), 2500\)/);
  assert.match(taskboardSource, /<TaskSidebarEditor[\s\S]*key=\{task\.id\}/);
  assert.match(taskboardSource, />Labels</);
  assert.match(taskboardSource, /aria-label="Task description"/);
  assert.match(taskboardSource, /<WorkingNotesInspectorRow/);
  assert.match(taskboardSource, /taskboard-inspector-body pretty-scrollbar min-h-0 flex-1 overflow-x-hidden overflow-y-auto/);
  assert.doesNotMatch(taskboardSource, /FieldNotes|field-notes|isFieldNotes/);
});

test("bucket dragging keeps its origin as a no-op target and never scales columns", () => {
  assert.match(taskboardSource, /keepActiveBucketAsDropTarget = activeType === "bucket-column"/);
  assert.match(
    taskboardSource,
    /keepActiveBucketAsDropTarget \|\| String\(collision\.id\) !== String\(args\.active\.id\)/,
  );
  assert.match(taskboardSource, /transform: CSS\.Translate\.toString\(bucketTransform\)/);
  assert.doesNotMatch(taskboardSource, /transform: CSS\.Transform\.toString\(bucketTransform\)/);
});

test("the complete font scale is shifted upward by two prior size steps", () => {
  assert.match(globalStyles, /html\[data-font-scale="small"\] \{\s+font-size: 17px;/);
  assert.match(globalStyles, /html\[data-font-scale="normal"\] \{\s+font-size: 18\.5px;/);
  assert.match(globalStyles, /html\[data-font-scale="large"\] \{\s+font-size: 20px;/);
  assert.match(globalStyles, /html\[data-font-scale="x-large"\] \{\s+font-size: 22px;/);
  assert.match(globalStyles, /html\[data-font-scale="xx-large"\] \{\s+font-size: 24px;/);
});
