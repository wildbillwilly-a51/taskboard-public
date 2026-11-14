import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { mergeUiSettings } from "../src/lib/ui-settings";

const homePageSource = readFileSync("src/app/page.tsx", "utf8");
const calendarPageSource = readFileSync("src/app/calendar/page.tsx", "utf8");
const taskboardSource = readFileSync("src/components/taskboard.tsx", "utf8");
const calendarShellSource = readFileSync("src/components/calendar-proof.tsx", "utf8");
const calendarInnerSource = readFileSync("src/components/calendar-proof-inner.tsx", "utf8");
const calendarEntryEventsSource = readFileSync("src/lib/calendar-entry-events.ts", "utf8");
const calendarEntriesRouteSource = readFileSync("src/app/api/calendar/entries/route.ts", "utf8");
const taskboardStoreSource = readFileSync("src/lib/taskboard-store.ts", "utf8");
const taskboardDataSource = readFileSync("src/lib/taskboard-data.ts", "utf8");
const calendarTaskEventsSource = readFileSync("src/lib/calendar-task-events.ts", "utf8");
const calendarDateUtilsSource = readFileSync("src/lib/calendar-date-utils.ts", "utf8");
const globalStylesSource = readFileSync("src/app/globals.css", "utf8");
const uiSettingsSource = readFileSync("src/lib/ui-settings.ts", "utf8");

test("calendar task events carry board context for safe workspace handoff", () => {
  assert.match(calendarTaskEventsSource, /boardId: string/);
  assert.match(calendarTaskEventsSource, /boardId: board\.id/);
});

test("home route accepts task handoff after access-controlled board loading", () => {
  assert.match(homePageSource, /taskId\?: string \| string\[\]/);
  assert.match(homePageSource, /from\?: string \| string\[\]/);
  assert.match(homePageSource, /view\?: string \| string\[\]/);
  assert.match(homePageSource, /function getInitialViewMode/);
  assert.match(homePageSource, /requestedBoardId = getFirstSearchParamValue\(resolvedSearchParams\.boardId\)/);
  assert.match(homePageSource, /requestedTaskId = getFirstSearchParamValue\(resolvedSearchParams\.taskId\)/);
  assert.match(homePageSource, /requestedViewMode = getInitialViewMode\(getFirstSearchParamValue\(resolvedSearchParams\.view\)\)/);
  assert.match(homePageSource, /requestedHandoffSource =\s+getFirstSearchParamValue\(resolvedSearchParams\.from\) === "calendar" \? "calendar" : null/);
  assert.match(homePageSource, /loadTaskboardState\(user, \{ boardId: requestedBoardId \}\)/);
  assert.match(homePageSource, /initialSelectedTaskId=\{requestedTaskId\}/);
  assert.match(homePageSource, /initialTaskHandoffSource=\{requestedHandoffSource\}/);
  assert.match(homePageSource, /initialViewMode=\{requestedViewMode\}/);
});

test("taskboard only opens requested task when it exists on the loaded board", () => {
  assert.match(taskboardSource, /initialSelectedTaskId\?: string \| null/);
  assert.match(taskboardSource, /initialTaskHandoffSource\?: "calendar" \| null/);
  // A requested subtask opens its task, with the subtask in focus.
  assert.match(taskboardSource, /const initialSelection = useMemo/);
  assert.match(taskboardSource, /buildBoardIndex\(initialBoard\.buckets\)\.rootTaskIdByTaskId\.get\(initialSelectedTaskId\)/);
  assert.match(taskboardSource, /const initialOpenTaskId = initialSelection\.taskId/);
  assert.match(taskboardSource, /useState<string \| null>\(initialOpenTaskId\)/);
  assert.match(taskboardSource, /useState\(Boolean\(initialOpenTaskId\)\)/);
});

test("taskboard marks valid calendar handoff arrivals without affecting generic task links", () => {
  assert.match(taskboardSource, /initialTaskHandoffSource === "calendar" \? initialOpenTaskId : null/);
  assert.match(taskboardSource, /taskboard-calendar-arrival-notice/);
  assert.match(taskboardSource, /task-inspector-calendar-handoff/);
  assert.match(taskboardSource, /data-calendar-arrival=\{isCalendarArrival \? "true" : undefined\}/);
  assert.match(taskboardSource, /role="status"/);
  assert.match(taskboardSource, /aria-live="polite"/);
});

test("calendar task events select the shared Taskboard sidebar in the calendar shell", () => {
  assert.match(calendarPageSource, /<TaskboardApp/);
  assert.match(taskboardSource, /calendarWorkspace\?: CalendarWorkspaceProps/);
  assert.match(taskboardSource, /embeddedInTaskboardShell/);
  assert.match(taskboardSource, /onSidebarTaskSelect=\{\(taskId\) =>/);
  assert.match(calendarInnerSource, /onSidebarTaskSelect\?: \(taskId: string \| null\) => void/);
  assert.match(calendarInnerSource, /data\.kind === "taskboard-task" && data\.taskId/);
  assert.match(calendarInnerSource, /onSidebarTaskSelect\?\.\(data\.taskId\)/);
  assert.match(calendarInnerSource, /shouldRenderCalendarInspector/);
});

test("Taskboard inspector links dated tasks into the matching calendar context", () => {
  assert.match(taskboardSource, /function buildTaskCalendarHref\(task: Task, boardId: string\)/);
  assert.match(taskboardSource, /const datedValue = task\.startAt \?\? task\.endAt \?\? task\.dueAt/);
  assert.match(taskboardSource, /getCalendarFocusDateTime\(datedValue\)/);
  assert.match(taskboardSource, /new URLSearchParams\(\{\s+boardId,\s+date: focusDate,/);
  assert.match(taskboardSource, /taskId: task\.id/);
  assert.match(taskboardSource, /href=\{calendarTaskHref\}/);
  assert.match(taskboardSource, /View in Calendar/);
  assert.match(taskboardSource, /data-testid="task-inspector-view-calendar"/);
  assert.match(taskboardSource, /params\.set\("taskId", navigationTaskId\)/);
  assert.doesNotMatch(taskboardSource, /fetch\([^)]*calendar[^)]*taskId/i);
  assert.doesNotMatch(taskboardSource, /localStorage\.setItem\([^)]*calendar/i);
});

test("Taskboard calendar focus date normalization is safe for persisted Date values", () => {
  assert.match(taskboardSource, /getCalendarFocusDate, getCalendarFocusDateTime/);
  assert.match(calendarDateUtilsSource, /function getCalendarFocusDate\(value: unknown\)/);
  assert.match(calendarDateUtilsSource, /typeof value === "string" \? value\.trim\(\) : null/);
  assert.match(calendarDateUtilsSource, /trimmed === ""/);
  assert.match(calendarDateUtilsSource, /value instanceof Date \? value : trimmed \? new Date\(trimmed\) : null/);
  assert.match(calendarDateUtilsSource, /!date \|\| Number\.isNaN\(date\.getTime\(\)\)/);
});

test("Taskboard hides calendar links when a safe focus date cannot be derived", () => {
  assert.match(taskboardSource, /if \(!focusDate\) \{\s+return null;\s+\}/);
  assert.match(taskboardSource, /calendarTaskHref \? \(/);
});

test("calendar consumes date positioning without overriding the saved grid view", () => {
  assert.match(calendarPageSource, /taskId\?: string \| string\[\]/);
  assert.match(calendarPageSource, /date\?: string \| string\[\]/);
  assert.match(calendarPageSource, /getSafeCalendarDate/);
  assert.match(calendarPageSource, /initialDate: requestedDate/);
  assert.match(calendarPageSource, /initialSelectedTaskId=\{requestedTaskId\}/);
  assert.match(calendarInnerSource, /focusContext\?: CalendarFocusContext/);
  assert.match(calendarInnerSource, /appliedInitialDateKeyRef/);
  assert.match(calendarInnerSource, /calendarRef\.current\?\.getApi\(\)/);
  assert.match(calendarInnerSource, /function applyCalendarFocus\(\)/);
  assert.match(calendarInnerSource, /window\.requestAnimationFrame\(applyCalendarFocus\)/);
  assert.match(calendarInnerSource, /calendarApi\.gotoDate\(focusDate\.toDate\(\)\)/);
  assert.doesNotMatch(calendarInnerSource, /changeView\("timeGridDay", focusDate\.toDate\(\)\)/);
  assert.match(calendarInnerSource, /getTaskboardCalendarView\(calendarApi\.view\.type\) !== "month"/);
  assert.match(calendarInnerSource, /requestedInitialDateValue\?\.includes\("T"\)/);
  assert.match(calendarInnerSource, /calendarApi\.scrollToTime\(requestedScrollTime\)/);
  assert.match(calendarInnerSource, /slotMinTime=/);
  assert.match(calendarInnerSource, /slotMaxTime=/);
  assert.doesNotMatch(calendarInnerSource, /focusedTaskId/);
  assert.doesNotMatch(calendarInnerSource, /Focused Taskboard task selected from the main workspace/);
  assert.match(calendarPageSource, /requestedBoardId === undefined\s+\?\s+await listPersonalBoardImportedCalendarEvents\(user, state\.board\.id\)\s+:\s+\[\]/);
});

test("sidebar working notes stays compact without a separate expand control", () => {
  assert.match(taskboardSource, /function WorkingNotesInspectorRow/);
  assert.match(taskboardSource, /<TaskWorkingNotesPreview[\s\S]*compact/);
  assert.doesNotMatch(taskboardSource, /Expand Working Notes|Collapse Working Notes/);
});

test("week and day calendars retain the full day while opening at 7 AM", () => {
  assert.match(calendarInnerSource, /const defaultCalendarScrollTime = "07:00:00";/);
  assert.match(calendarInnerSource, /scrollTime=\{defaultCalendarScrollTime\}/);
  assert.match(calendarInnerSource, /slotMinTime="00:00:00"/);
  // A full day by default; an overnight Day runs past midnight.
  assert.match(calendarInnerSource, /slotMaxTime=\{overnightDay\?\.slotMaxTime \?\? "24:00:00"\}/);
  // Date navigation keeps the scrolled time; view switches return to 7 AM.
  assert.match(calendarInnerSource, /scrollTimeReset=\{false\}/);
  assert.match(
    calendarInnerSource,
    /calendarApi\.changeView\(viewName, date\);\s+if \(viewName !== "dayGridMonth"\) \{\s+calendarApi\.scrollToTime\(defaultCalendarScrollTime\);/,
  );
  assert.match(calendarInnerSource, /changeCalendarView\(getFullCalendarViewName\(view\)\)/);
  assert.match(calendarInnerSource, /changeCalendarView\("timeGridDay", day\.toDate\(\)\)/);
  // The calendar scrolls itself, so the page-scroll positioning is gone.
  assert.doesNotMatch(calendarInnerSource, /scheduleDefaultTimeScroll/);
  assert.doesNotMatch(calendarInnerSource, /window\.scrollTo\(/);
  assert.doesNotMatch(calendarInnerSource, /scrollTime="08:00:00"/);
  assert.doesNotMatch(calendarInnerSource, /slotMinTime=\{`\$\{String\(focusedBusinessHours\.startTime\)/);
  assert.doesNotMatch(calendarInnerSource, /slotMaxTime=\{`\$\{String\(focusedBusinessHours\.endTime\)/);
});

test("calendar date arrivals do not persist or render focused-task state", () => {
  assert.doesNotMatch(calendarInnerSource, /Focused Taskboard task selected from the main workspace\./);
  assert.doesNotMatch(calendarInnerSource, /focused Taskboard task is hidden/i);
  assert.doesNotMatch(calendarInnerSource, /handleShowFocusedTask|handleClearCalendarFocus/);
  assert.match(calendarPageSource, /requestedTaskId/);
  assert.doesNotMatch(calendarPageSource, /focusedTaskId/);
  assert.doesNotMatch(calendarInnerSource, /localStorage\.setItem\([^)]*focus/i);
  assert.doesNotMatch(calendarInnerSource, /fetch\([^)]*taskId/i);
});

test("main Taskboard Calendar entry preserves the active accessible board context", () => {
  assert.match(taskboardSource, /const currentAccessibleBoardId = currentAccessibleBoard\?\.boardId \?\? null/);
  assert.match(taskboardSource, /const buildCalendarWorkspaceHref = useCallback/);
  assert.match(taskboardSource, /params\.set\("boardId", currentAccessibleBoardId\)/);
  assert.match(taskboardSource, /const calendarWorkspaceHref = buildCalendarWorkspaceHref\(\)/);
  assert.match(taskboardSource, /calendarHref=\{/);
  assert.match(taskboardSource, /<WorkspacePrimaryNav/);
  assert.doesNotMatch(taskboardSource, /fetch\([^)]*calendar[^)]*boardId/i);
  assert.doesNotMatch(taskboardSource, /localStorage\.setItem\([^)]*calendar/i);
});

test("maintenance outages use a visible Calendar subview without remounting the shell", () => {
  assert.match(calendarPageSource, /view\?: string \| string\[\]/);
  assert.match(calendarPageSource, /requestedOutageView = getFirstSearchParamValue\(resolvedSearchParams\.view\) === "outages"/);
  assert.match(calendarPageSource, /initialOutageView: true/);
  assert.match(taskboardSource, /const outageCalendarWorkspaceHref = buildCalendarWorkspaceHref\(true\)/);
  assert.match(taskboardSource, /params\.set\("view", "outages"\)/);
  assert.match(taskboardSource, /id: "outages", label: "Outages", href: outageCalendarWorkspaceHref/);
  assert.match(
    calendarPageSource,
    /key=\{`calendar:\$\{state\.board\.id\}`\}/,
  );
  assert.doesNotMatch(calendarInnerSource, /Outage View/);
  assert.match(calendarInnerSource, /data\.workItemType === "maintenance_outage"/);
  assert.match(
    calendarInnerSource,
    /getInitialProofView\(\s*requestedOutageView,\s*settings\.calendarView,\s*settings\.outagesCalendarView,?\s*\)/,
  );
  assert.match(calendarInnerSource, /requestedOutageView \? outagesCalendarView : calendarView/);
});

test("calendar workspace header preserves selected task state across every Taskboard view", () => {
  assert.match(taskboardSource, /const taskboardWorkspaceHref = buildTaskboardWorkspaceHref\("board"\)/);
  assert.match(taskboardSource, /const agendaWorkspaceHref = buildTaskboardWorkspaceHref\("agenda"\)/);
  assert.match(taskboardSource, /const focusWorkspaceHref = buildTaskboardWorkspaceHref\("focus"\)/);
  assert.match(taskboardSource, /id: "board", label: "Board", href: taskboardWorkspaceHref/);
  assert.match(taskboardSource, /id: "agenda", label: "Agenda", href: agendaWorkspaceHref/);
  assert.match(taskboardSource, /id: "focus", label: "Focus", href: focusWorkspaceHref/);
  assert.match(calendarInnerSource, /document\.getElementById\("taskboard-calendar-inline-toolbar"\)/);
  assert.match(taskboardSource, /params\.set\("date", selectedTaskCalendarDate\)/);
  assert.match(taskboardSource, /params\.set\("taskId", navigationTaskId\)/);
  assert.match(taskboardSource, /window\.history\.replaceState/);
  assert.doesNotMatch(calendarInnerSource, /id: "agenda"/);
  assert.doesNotMatch(calendarInnerSource, /agendaPlugin/);
  assert.doesNotMatch(taskboardSource, /localStorage\.setItem\([^)]*view/i);
  assert.doesNotMatch(homePageSource, /fetch\([^)]*view/i);
});

test("calendar filters stay client-side and scoped to existing event metadata", () => {
  assert.match(calendarInnerSource, /type CalendarEventFilter = "all" \| "taskboard" \| "calendar" \| "stored" \| "converted" \| "outage"/);
  assert.match(calendarInnerSource, /eventMatchesFilter/);
  assert.match(calendarInnerSource, /data\.kind === "imported-source"/);
  assert.match(calendarInnerSource, /data\.kind === "calendar-entry"/);
  assert.match(calendarInnerSource, /isConvertedCalendarTask/);
  assert.match(calendarInnerSource, /countCalendarEvents/);
  assert.match(calendarInnerSource, /calendar-proof-filter-menu/);
  assert.match(calendarInnerSource, /calendar-proof-filters__count/);
  assert.doesNotMatch(calendarInnerSource, /taskboard-calendar-proof__feed-summary/);
  assert.match(calendarInnerSource, /requestedOutageView \? "outage" : "all"/);
  assert.match(calendarShellSource, /searchQuery\?: string/);
  assert.match(calendarInnerSource, /normalizedSearchQuery/);
  assert.match(calendarInnerSource, /searchableText\.includes\(normalizedSearchQuery\)/);
  assert.match(calendarInnerSource, /const hasLiveCalendarEvents = taskEvents\.length > 0 \|\| sourceEvents\.length > 0/);
  assert.match(calendarInnerSource, /const \[hideSampleEvents, setHideSampleEvents\] = useState<boolean \| null>\(null\)/);
  assert.match(calendarInnerSource, /const effectiveHideSampleEvents = hideSampleEvents \?\? hasLiveCalendarEvents/);
  assert.match(calendarInnerSource, /const calendarEvents = useMemo/);
  assert.match(calendarInnerSource, /\[activeCalendarView, canEditBoard, filteredEvents\]/);
  assert.match(calendarInnerSource, /events=\{calendarEvents\}/);
  assert.doesNotMatch(calendarInnerSource, /localStorage\.setItem\([^)]*calendar/i);
});

test("calendar and outages retain independent validated view preferences", () => {
  assert.equal(mergeUiSettings(undefined).calendarView, "week");
  assert.equal(mergeUiSettings(undefined).outagesCalendarView, "month");
  assert.equal(mergeUiSettings({ calendarView: "month" }).calendarView, "month");
  assert.equal(mergeUiSettings({ outagesCalendarView: "day" }).outagesCalendarView, "day");
  assert.equal(
    mergeUiSettings({ calendarView: "invalid" as "week" }).calendarView,
    "week",
  );
  assert.match(uiSettingsSource, /calendarView: "week"/);
  assert.match(uiSettingsSource, /outagesCalendarView: "month"/);
  assert.match(calendarInnerSource, /settings\.calendarView/);
  assert.match(calendarInnerSource, /settings\.outagesCalendarView/);
  assert.match(
    calendarInnerSource,
    /updateSetting\(isOutagesView \? "outagesCalendarView" : "calendarView", view\)/,
  );
  assert.doesNotMatch(calendarInnerSource, /__taskboardCalendarView/);
  assert.doesNotMatch(calendarInnerSource, /rememberCalendarView/);
  assert.match(calendarInnerSource, /return startOfWorkWeek\(requestedInitialDate \?\? dayjs\(\)\)/);
  assert.doesNotMatch(calendarInnerSource, /taskEvents\[0\]\?\.start/);
});

test("calendar scrolls inside a window-height frame instead of scrolling the page", () => {
  assert.match(calendarInnerSource, /height=\{calendarViewportHeight\}/);
  assert.doesNotMatch(calendarInnerSource, /height="auto"/);
  assert.doesNotMatch(calendarInnerSource, /stickyHeaderDates/);
  assert.match(calendarInnerSource, /function getCalendarViewportHeight\(calendarElement: HTMLElement\)/);
  assert.match(calendarInnerSource, /window\.innerHeight - documentTop - bottomInset/);
  assert.match(calendarInnerSource, /useLayoutEffect/);
  assert.match(calendarInnerSource, /requestAnimationFrame\(syncCalendarViewportHeight\)/);
  assert.match(calendarInnerSource, /observer\.observe\(section, \{ box: "border-box" \}\)/);
  assert.doesNotMatch(calendarInnerSource, /dayMinWidth/);
  assert.doesNotMatch(globalStylesSource, /--calendar-proof-sticky-toolbar-height/);
  assert.doesNotMatch(globalStylesSource, /\.taskboard-calendar-proof__calendar(?: \.fc)? \{[^}]*min-height: \d/);
  assert.match(
    globalStylesSource,
    /\.fc-scroller:not\(\.fc-scroller-liquid-absolute\) \{\s+scrollbar-color: transparent transparent;/,
  );
});

test("calendar all-day and month events stay compact inside fixed columns", () => {
  assert.match(globalStylesSource, /\.fc-scrollgrid table \{[\s\S]*table-layout: fixed;/);
  assert.match(
    globalStylesSource,
    /\.fc-scrollgrid-section-body:has\(\.fc-daygrid-body\)\s+> td \{\s+background: var\(--calendar-proof-grid-bg\);\s+box-shadow: 0 1px 0 var\(--calendar-proof-grid-major\);\s+\}/,
  );
  assert.match(globalStylesSource, /\.fc-timegrid-event\.taskboard-calendar-event-shell \{[\s\S]*min-height: 1\.35rem;/);
  assert.match(globalStylesSource, /\.fc-daygrid-event\.taskboard-calendar-event-shell \{[\s\S]*white-space: nowrap;/);
  assert.doesNotMatch(globalStylesSource, /\.fc-daygrid-day,[\s\S]{0,120}overflow: hidden/);
  assert.doesNotMatch(globalStylesSource, /\.fc-(?:timegrid|daygrid)-event\.taskboard-calendar-event-shell \{[\s\S]{0,120}max-width:/);
  assert.match(calendarInnerSource, /slotEventOverlap=\{false\}/);
  assert.match(globalStylesSource, /data-calendar-all-day="true"\]\[data-calendar-view="week"\][\s\S]*calendar-proof-event__time[\s\S]*display: none;/);
  assert.match(globalStylesSource, /data-calendar-view="month"\] \.calendar-proof-event__title[\s\S]*text-overflow: ellipsis;[\s\S]*white-space: nowrap;/);
  assert.match(calendarInnerSource, /view === "month"[\s\S]*event\.allDay[\s\S]*\? "All Day"[\s\S]*dayjs\(event\.start\)\.format\("h:mm A"\)/);
});

test("native calendar entries are loaded through board-scoped calendar props", () => {
  assert.match(homePageSource, /listCalendarEntriesForBoard\(user, state\.board\.id\)/);
  assert.match(homePageSource, /initialCalendarEntries=\{calendarEntries\}/);
  assert.match(calendarPageSource, /listCalendarEntriesForBoard\(user, state\.board\.id\)/);
  assert.match(calendarShellSource, /boardBuckets: CalendarBoardBucketOption\[\]/);
  assert.match(calendarShellSource, /calendarEntries: CalendarEntry\[\]/);
  assert.match(calendarInnerSource, /useState<CalendarEntry\[\]>\(calendarEntries\)/);
  assert.match(calendarInnerSource, /mapCalendarEntriesToCalendarEvents\(calendarEntryRecords\)/);
  assert.match(calendarEntryEventsSource, /\.filter\(\(entry\) => !entry\.linkedTaskId\)/);
});

test("Taskboard Agenda includes allowed imported source events without explicit-board expansion", () => {
  assert.match(homePageSource, /mapImportedCalendarSourceEvents/);
  assert.match(homePageSource, /listPersonalBoardImportedCalendarEvents/);
  assert.match(homePageSource, /state\.persistenceEnabled && requestedBoardId === undefined/);
  assert.match(homePageSource, /initialCalendarSourceEvents=\{calendarSourceEvents\}/);
  assert.match(taskboardSource, /initialCalendarSourceEvents\?: TaskboardCalendarSourceEvent\[\]/);
  assert.match(taskboardSource, /calendarSourceEvents=\{calendarSourceEvents\}/);
  assert.match(taskboardSource, /calendarSourceEvents: TaskboardCalendarSourceEvent\[\]/);
  assert.match(taskboardSource, /kind: "source-event"/);
  assert.match(taskboardSource, /sourceEvent\.data\.providerLabel/);
  assert.match(taskboardSource, /buildSourceEventCalendarHref/);
  assert.match(taskboardSource, /\/calendar\?date=\$\{encodeURIComponent\(focusDate\)\}/);
  assert.doesNotMatch(taskboardSource, /\/calendar\?boardId=[^`"]*sourceEvent/i);
});

test("Taskboard Agenda orders scheduled tasks and suppresses duplicate imported task rows", () => {
  assert.match(taskboardSource, /function getAgendaTimestamp/);
  assert.match(taskboardSource, /timestamp: getAgendaTimestamp\(task\.startAt, task\.endAt, task\.dueAt\)/);
  assert.match(taskboardSource, /function formatTaskAgendaSchedule/);
  assert.match(
    taskboardSource,
    /formatAgendaDateRange\(displayTimeZone, task\.startAt, task\.endAt, Boolean\(task\.allDay\)\)/,
  );
  assert.match(taskboardSource, /suppressedImportedTaskIds/);
  assert.match(taskboardSource, /\.filter\(\(task\) => !suppressedImportedTaskIds\.has\(task\.id\)\)/);
  assert.match(taskboardSource, /No scheduled date/);
});

test("Calendar no longer exposes a duplicate internal Agenda view", () => {
  assert.match(taskboardSource, /id: "agenda", label: "Agenda", href: agendaWorkspaceHref/);
  assert.match(taskboardSource, /href: agendaWorkspaceHref/);
  assert.match(calendarInnerSource, /\{ id: "month", label: "Month" \}/);
  assert.match(calendarInnerSource, /\{ id: "week", label: "Week" \}/);
  assert.match(calendarInnerSource, /\{ id: "day", label: "Day" \}/);
  assert.doesNotMatch(calendarInnerSource, /\{ id: "agenda", label: "Agenda" \}/);
  assert.doesNotMatch(calendarInnerSource, /CalendarAgendaList/);
  assert.doesNotMatch(calendarInnerSource, /taskboard-calendar-agenda/);
});

test("calendar entry creation stays on the owner board context and converts bucket selections to tasks", () => {
  assert.match(calendarEntriesRouteSource, /export async function POST/);
  assert.match(calendarEntriesRouteSource, /getBoardContextFromRequest/);
  assert.match(calendarEntriesRouteSource, /createNativeCalendarEntry/);
  assert.match(calendarEntriesRouteSource, /bucketId/);
  assert.match(taskboardStoreSource, /export async function createNativeCalendarEntry/);
  assert.match(taskboardStoreSource, /resolveBoardContext\(client, user, options, "edit"\)/);
  assert.match(taskboardStoreSource, /if \(bucketId\) \{/);
  assert.match(taskboardStoreSource, /createRootTask/);
  assert.match(taskboardStoreSource, /endAt: endsAt/);
  assert.match(taskboardStoreSource, /dueAt: null/);
  assert.match(taskboardStoreSource, /return \{ kind: "task", taskId \}/);
  assert.match(taskboardStoreSource, /INSERT INTO calendar_entries/);
});

test("task persistence separates calendar end time from optional due date", () => {
  assert.match(taskboardDataSource, /endAt\?: string/);
  assert.match(readFileSync("src/lib/schema-baseline.ts", "utf8"), /ALTER TABLE tasks ADD COLUMN IF NOT EXISTS end_at TIMESTAMPTZ/);
  // Undated tasks start today as all-day tasks (owner decision, 2026-10-11); outages stay undated.
  assert.match(taskboardStoreSource, /args\.startAt == null && args\.workItemType !== "maintenance_outage"/);
  assert.match(taskboardStoreSource, /getStartOfTodayInTimeZone\(mutationDate\(\), args\.timeZone\)/);
  assert.match(taskboardStoreSource, /\$\{taskReminderBase\} AS reminder_base_at/);
  assert.match(readFileSync("src/lib/task-reminder-sql.ts", "utf8"), /COALESCE\(tasks\.due_at, tasks\.start_at\)/);
  assert.match(taskboardSource, /title=\{draftDueAt \? "Due date" : "Add due date"\}/);
  assert.match(taskboardSource, /title=\{draftReminderOffsetValue !== "none" \|\| draftOverdueReminderEnabled \? "Reminders" : "Add reminders"\}/);
});

test("native calendar entry UI remains local to the calendar workspace", () => {
  assert.match(calendarInnerSource, /New calendar item/);
  assert.match(calendarInnerSource, /Selecting a bucket will create this calendar entry as a Taskboard task\./);
  assert.match(calendarInnerSource, /\/api\/calendar\/entries/);
  assert.match(calendarInnerSource, /dateClick=\{handleDateClick\}/);
  assert.match(calendarInnerSource, /activeCalendarView === "month"/);
  assert.match(calendarInnerSource, /activeCalendarView === "month" \|\| info\.allDay/);
  assert.match(calendarInnerSource, /normalizeCalendarTimeSelection\([\s\S]*start\.add\(15, "minute"\)\.toDate\(\)/);
  assert.match(calendarInnerSource, /select=\{handleCalendarSelect\}/);
  assert.match(calendarInnerSource, /setSelectedCalendarSlot\(\{ start, end, allDay \}\)/);
  assert.match(calendarInnerSource, /applyCalendarSlotSelection\(start\.startOf\("day"\), start\.startOf\("day"\)\.add\(1, "day"\), true\)/);
  assert.match(calendarInnerSource, /calendar-proof-day--selected/);
  assert.match(calendarInnerSource, /info\.view\.calendar\.select\(\{/);
  assert.match(calendarInnerSource, /unselectAuto=\{false\}/);
  assert.doesNotMatch(calendarInnerSource, /openEntryForm\(start, start\.add/);
  assert.match(calendarInnerSource, /mode="sidebar"/);
  assert.match(calendarInnerSource, /mode="expanded"/);
  assert.match(calendarInnerSource, /Expand new calendar item/);
  assert.match(calendarInnerSource, /Return new calendar item to sidebar/);
  assert.match(calendarInnerSource, /function navigateToDay\(date: Dayjs\)/);
  assert.match(calendarInnerSource, /changeCalendarView\("timeGridDay", day\.toDate\(\)\)/);
  assert.match(calendarInnerSource, /navLinkDayClick=/);
  assert.match(calendarInnerSource, /eventStartEditable=\{false\}/);
  assert.doesNotMatch(calendarInnerSource, /disableDragAndDrop|handleCalendarClickCapture/);
  assert.doesNotMatch(calendarInnerSource, /localStorage\.setItem\([^)]*entry/i);
});

test("calendar event accents use bucket colors and unbucketed skin text", () => {
  assert.match(calendarTaskEventsSource, /bucketColor: string/);
  assert.match(calendarTaskEventsSource, /flattenTasks\(bucket\.tasks, bucket\.id, bucket\.title, bucket\.color\)/);
  assert.match(calendarInnerSource, /data\.bucketColor\?\.trim\(\) \|\| "currentColor"/);
});

test("task selection positions Calendar by date while saved views stay hidden", () => {
  assert.match(taskboardSource, /if \(selectedTaskCalendarDate\) \{\s+params\.set\("date", selectedTaskCalendarDate\)/);
  assert.match(taskboardSource, /params\.set\("taskId", navigationTaskId\)/);
  assert.match(calendarInnerSource, /useState<CalendarEventFilter>\(\(\) =>\s+requestedOutageView \? "outage" : "all"/);
  assert.match(taskboardSource, /const SHOW_SAVED_VIEWS = false/);
  // Saved views stay off on routed workspaces (Calendar and Notes).
  assert.match(taskboardSource, /SHOW_SAVED_VIEWS && !isRoutedWorkspace/);
  assert.match(taskboardSource, /const isRoutedWorkspace = isCalendarWorkspace \|\| isNotesWorkspace;/);
  assert.match(taskboardSource, /initialSelectedTaskId/);
});

test("calendar controls and inspector expose accessible labels and announcements", () => {
  assert.match(calendarInnerSource, /calendar-proof-filters-heading/);
  assert.match(calendarInnerSource, /role="group"/);
  assert.match(calendarInnerSource, /aria-label=\{filter\.ariaLabel\}/);
  assert.match(calendarInnerSource, /Show Taskboard task events/);
  assert.match(calendarInnerSource, /scrollInspectorIntoViewOnNarrowScreens/);
  assert.match(calendarInnerSource, /scrollIntoView/);
  assert.match(calendarInnerSource, /aria-live="polite"/);
  assert.match(calendarInnerSource, /role="status"/);
  assert.match(calendarInnerSource, /aria-labelledby=\{inspectorTitleId\}/);
  assert.match(calendarInnerSource, /aria-labelledby="calendar-proof-inspector-empty-title"/);
  assert.match(calendarInnerSource, /Selection hidden/);
  assert.match(calendarInnerSource, /Show selected event/);
  assert.match(calendarInnerSource, /function handleShowSelectedEvent/);
  assert.match(calendarInnerSource, /function handleClearSelection/);
});

test("calendar board context control uses existing access-controlled board state", () => {
  assert.match(calendarPageSource, /listAccessibleBoards/);
  assert.match(calendarPageSource, /withCurrentBoard\(await listAccessibleBoards\(user\), state\.board\.id\)/);
  assert.match(calendarPageSource, /requestedBoardRejected = true/);
  assert.match(calendarPageSource, /requestedBoardId !== undefined && state\.board\.id !== requestedBoardId/);
  assert.match(calendarPageSource, /const isExplicitBoardContext = requestedBoardId !== undefined && !requestedBoardRejected/);
  assert.match(calendarPageSource, /requestedBoardId === undefined\s+\?\s+await listPersonalBoardImportedCalendarEvents\(user, state\.board\.id\)\s+:\s+\[\]/);
  assert.match(calendarShellSource, /export type CalendarBoardContext/);
  assert.match(calendarShellSource, /export type CalendarBoardOption/);
  assert.match(calendarShellSource, /boardContext=\{boardContext\}/);
  assert.match(calendarShellSource, /boardOptions: CalendarBoardOption\[\]/);
});

test("calendar board context uses the shared header switcher and stays URL scoped", () => {
  assert.match(calendarInnerSource, /data-testid="calendar-board-context"/);
  assert.doesNotMatch(calendarInnerSource, /\sid="calendar-board-context"/);
  assert.doesNotMatch(calendarInnerSource, /Current\/preferred board/);
  assert.match(taskboardSource, /window\.location\.assign\(`\/calendar\?boardId=\$\{encodeURIComponent\(accessibleBoard\.boardId\)\}`\)/);
  assert.match(calendarInnerSource, /Imported calendars are hidden in explicit board views\./);
  assert.match(calendarInnerSource, /Requested board was unavailable; showing your default board\./);
  assert.doesNotMatch(calendarInnerSource, /localStorage\.setItem\([^)]*board/i);
  assert.doesNotMatch(calendarInnerSource, /fetch\([^)]*boards\/selected/i);
});
