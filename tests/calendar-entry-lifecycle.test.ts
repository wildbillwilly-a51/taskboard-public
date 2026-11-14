import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const entryRouteSource = readFileSync(
  "src/app/api/calendar/entries/[entryId]/route.ts",
  "utf8",
);
const entryScheduleRouteSource = readFileSync(
  "src/app/api/calendar/entries/[entryId]/schedule/route.ts",
  "utf8",
);
const calendarInnerSource = readFileSync("src/components/calendar-proof-inner.tsx", "utf8");
const globalStylesSource = readFileSync("src/app/globals.css", "utf8");
const taskboardStoreSource = readFileSync("src/lib/taskboard-store.ts", "utf8");
const taskboardDataSource = readFileSync("src/lib/taskboard-data.ts", "utf8");

test("native calendar entry mutation route preserves board access and stale-write boundaries", () => {
  assert.match(entryRouteSource, /export async function PATCH/);
  assert.match(entryRouteSource, /export async function DELETE/);
  assert.match(entryRouteSource, /requireTaskboardUserFromHeaders/);
  assert.match(entryRouteSource, /getBoardContextFromRequest/);
  assert.match(entryRouteSource, /expectedUpdatedAt/);
  assert.match(entryRouteSource, /updateNativeCalendarEntry/);
  assert.match(entryRouteSource, /softDeleteNativeCalendarEntry/);
  assert.match(taskboardStoreSource, /export async function updateNativeCalendarEntry/);
  assert.match(taskboardStoreSource, /export async function softDeleteNativeCalendarEntry/);
  assert.match(taskboardStoreSource, /resolveBoardContext\(client, user, options, "edit"\)/);
  assert.match(taskboardStoreSource, /SELECT id, updated_at[\s\S]*FOR UPDATE/);
  assert.match(taskboardStoreSource, /This calendar entry changed elsewhere/);
  assert.match(taskboardStoreSource, /deleted_at = NOW\(\)/);
  assert.match(taskboardStoreSource, /WHERE id = \$1[\s\S]*AND deleted_at IS NULL/);
  assert.match(taskboardStoreSource, /AND linked_task_id IS NULL/);
});

test("entry timestamps flow through creation, editing, and schedule changes", () => {
  assert.match(taskboardDataSource, /updatedAt: string/);
  assert.match(taskboardStoreSource, /updatedAt: new Date\(row\.updated_at\)\.toISOString\(\)/);
  assert.match(taskboardStoreSource, /INSERT INTO calendar_entries[\s\S]*RETURNING[\s\S]*updated_at/);
  assert.match(entryScheduleRouteSource, /updateNativeCalendarEntrySchedule/);
  assert.match(taskboardStoreSource, /Calendar entry schedule update did not return a timestamp/);
  assert.match(calendarInnerSource, /updatedAt\?: string/);
  assert.match(calendarInnerSource, /entry\.id === body\.calendarEntryId[\s\S]*updatedAt: body\.updatedAt/);
});

test("native entries use the themed sidebar and expanded workspace lifecycle", () => {
  assert.match(calendarInnerSource, /intent: "create" \| "edit"/);
  assert.match(calendarInnerSource, /Taskboard Calendar/);
  assert.match(calendarInnerSource, /Save changes/);
  assert.match(calendarInnerSource, /Expand calendar item/);
  assert.match(calendarInnerSource, /calendar-entry-workspace/);
  assert.match(calendarInnerSource, /data-testid="calendar-entry-expanded"/);
  assert.match(calendarInnerSource, /Delete this calendar item\?/);
  assert.match(calendarInnerSource, /It will be hidden from Calendar and Agenda\./);
  assert.match(calendarInnerSource, /method: "PATCH"/);
  assert.match(calendarInnerSource, /method: "DELETE"/);
  assert.match(calendarInnerSource, /setCalendarEntryRecords/);
  assert.match(calendarInnerSource, /This board is read-only/);
  assert.match(globalStylesSource, /\.calendar-entry-workspace\s*\{/);
  assert.match(globalStylesSource, /\.calendar-entry-form__delete-confirmation\s*\{/);
  assert.doesNotMatch(calendarInnerSource, /window\.confirm/);
});
