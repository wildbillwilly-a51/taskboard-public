import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const storeSource = readFileSync("src/lib/taskboard-store.ts", "utf8");
const routeSource = readFileSync(
  "src/app/api/calendar/source-events/[eventId]/convert/route.ts",
  "utf8",
);
const calendarInnerSource = readFileSync("src/components/calendar-proof-inner.tsx", "utf8");

test("calendar source conversion route accepts only bucket and scope context", () => {
  assert.match(routeSource, /export async function POST/);
  assert.match(routeSource, /explicitBoardIdErrorResponse/);
  assert.match(routeSource, /key === "bucketId" \|\| key === "scope"/);
  assert.match(routeSource, /scope === "occurrence" \|\| scope === "series"/);
  assert.match(routeSource, /convertPersonalBoardImportedCalendarEventToTask\(user, eventId, \{/);
  assert.match(routeSource, /bucketId: parsedBody\.bucketId/);
  assert.doesNotMatch(routeSource, /getBoardContextFromRequest/);
  assert.doesNotMatch(routeSource, /getBoardStateFromDatabase/);
});

test("calendar source conversion store helper is owner-only and transactional", () => {
  assert.match(storeSource, /export async function convertPersonalBoardImportedCalendarEventToTask/);
  assert.match(storeSource, /await client\.query\("BEGIN"\)/);
  assert.match(storeSource, /FOR UPDATE OF imported_events/);
  assert.match(storeSource, /event\.board_type !== "personal"/);
  assert.match(storeSource, /event\.owner_user_id !== userId/);
  assert.match(storeSource, /event\.owner_is_disabled/);
  assert.match(storeSource, /event\.sync_status !== "active"/);
  assert.match(storeSource, /linkedTask\.deleted_at \|\| linkedTask\.archived_at/);
  assert.match(storeSource, /SET is_read_only_import = FALSE, updated_at = NOW\(\)/);
  assert.match(storeSource, /SET task_id = \$2, raw_payload = \$4::jsonb, updated_at = NOW\(\)/);
  assert.match(storeSource, /INSERT INTO tasks/);
  assert.match(storeSource, /source_record_id/);
  assert.match(storeSource, /taskLinkScope: conversionScope/);
  assert.match(storeSource, /Destination bucket not found/);
});

test("generic task convert is hardened to personal board owners", () => {
  assert.match(storeSource, /assertPersonalBoardOwnerForImportedConversion/);
  assert.match(
    storeSource,
    /if \(patch\.convertToTask === true && task\.is_read_only_import\) \{[\s\S]*assertPersonalBoardOwnerForImportedConversion/,
  );
  assert.match(storeSource, /Only the personal board owner can convert imported calendar events/);
});

test("calendar UI uses the persistent route for stored imports and local conversion for samples", () => {
  assert.match(calendarInnerSource, /data\.kind === "imported-source" && data\.importedEventId/);
  assert.match(calendarInnerSource, /\/api\/calendar\/source-events\/\$\{encodeURIComponent\(importedEventId\)\}\/convert/);
  // After saving, the calendar asks the shell to reload its live data.
  assert.match(calendarInnerSource, /onCalendarDataChanged\?\.\(\)/);
  assert.match(calendarInnerSource, /Add task functionality/);
  assert.match(calendarInnerSource, /This occurrence/);
  assert.match(calendarInnerSource, /Entire series/);
  assert.match(calendarInnerSource, /JSON\.stringify\(options\)/);
  assert.match(calendarInnerSource, /Convert sample locally/);
  assert.match(calendarInnerSource, /no external calendar writeback is implied/);
  assert.match(calendarInnerSource, /does not write to Taskboard or the source calendar/);
});
