import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { BoardAccessError } from "@/lib/board-access";
import { getPool } from "@/lib/db";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";
import {
  createNativeCalendarEntry,
  ensureSchemaAndSeed,
  listCalendarEntriesForBoard,
  softDeleteNativeCalendarEntry,
  updateNativeCalendarEntry,
  updateNativeCalendarEntrySchedule,
} from "@/lib/taskboard-store";

const cloneValidationEnabled = process.env.TASKBOARD_CALENDAR_ENTRY_LIFECYCLE_DB === "clone";

test(
  "native calendar entry lifecycle preserves access, stale-write, and soft-delete boundaries",
  { skip: !cloneValidationEnabled, concurrency: false },
  async () => {
    const pool = getPool();
    assert.ok(pool, "DATABASE_URL must point to a disposable clone.");

    await ensureSchemaAndSeed();

    const fixtureTag = randomUUID();
    const ownerId = randomUUID();
    const viewerId = randomUUID();
    const boardId = randomUUID();
    const ownerEmail = `calendar-entry-owner-${fixtureTag}@example.invalid`;
    const viewerEmail = `calendar-entry-viewer-${fixtureTag}@example.invalid`;
    const owner: TaskboardUserIdentity = {
      id: ownerId,
      authMode: "authelia",
      authProvider: "authelia",
      email: ownerEmail,
      displayName: "Calendar entry owner",
      username: `calendar-entry-owner-${fixtureTag}`,
      role: "standard",
    };
    const viewer: TaskboardUserIdentity = {
      id: viewerId,
      authMode: "authelia",
      authProvider: "authelia",
      email: viewerEmail,
      displayName: "Calendar entry viewer",
      username: `calendar-entry-viewer-${fixtureTag}`,
      role: "standard",
    };
    const countsBefore = await pool.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM calendar_entries`,
    );

    try {
      await pool.query(
        `
          INSERT INTO users (
            id, email, username, display_name, role, auth_provider, is_disabled,
            is_reserved_local_admin
          )
          VALUES
            ($1, $2, $3, 'Calendar entry owner', 'standard', 'authelia', FALSE, FALSE),
            ($4, $5, $6, 'Calendar entry viewer', 'standard', 'authelia', FALSE, FALSE)
        `,
        [ownerId, ownerEmail, owner.username, viewerId, viewerEmail, viewer.username],
      );
      await pool.query(
        `
          INSERT INTO boards (
            id, owner_user_id, board_type, owner_team_id,
            team_member_default_access, personal_visibility,
            personal_visibility_team_id, title, description
          )
          VALUES ($1, $2, 'personal', NULL, NULL, 'private', NULL, 'Calendar entry fixture', '')
        `,
        [boardId, ownerId],
      );

      const created = await createNativeCalendarEntry(owner, {
        title: "Lifecycle fixture",
        startAt: "2026-07-20T15:00:00.000Z",
        endAt: "2026-07-20T16:00:00.000Z",
        location: "Initial room",
        description: "Initial description",
        color: "#14b8a6",
      }, { boardId });
      assert.equal(created.kind, "calendar-entry");
      if (created.kind !== "calendar-entry") {
        assert.fail("Expected a native calendar entry.");
      }

      const createdEntry = created.calendarEntry;
      assert.equal(createdEntry.title, "Lifecycle fixture");
      assert.ok(createdEntry.updatedAt);

      const listedAfterCreate = await listCalendarEntriesForBoard(owner, boardId);
      assert.ok(listedAfterCreate.some((entry) => entry.id === createdEntry.id));

      await assert.rejects(
        () => updateNativeCalendarEntry(viewer, createdEntry.id, {
          expectedUpdatedAt: createdEntry.updatedAt,
          title: "Unauthorized edit",
          startAt: createdEntry.startAt,
          endAt: createdEntry.endAt,
          allDay: false,
          color: createdEntry.color,
        }, { boardId }),
        (error) => error instanceof BoardAccessError && error.status === 403,
      );

      const updatedEntry = await updateNativeCalendarEntry(owner, createdEntry.id, {
        expectedUpdatedAt: createdEntry.updatedAt,
        title: "Updated lifecycle fixture",
        startAt: "2026-07-20T16:00:00.000Z",
        endAt: "2026-07-20T17:30:00.000Z",
        allDay: false,
        location: "Updated room",
        description: "Updated description",
        color: "#0f766e",
      }, { boardId });
      assert.equal(updatedEntry.title, "Updated lifecycle fixture");
      assert.equal(updatedEntry.location, "Updated room");
      assert.equal(updatedEntry.description, "Updated description");
      assert.equal(updatedEntry.color, "#0f766e");
      assert.notEqual(updatedEntry.updatedAt, createdEntry.updatedAt);

      await assert.rejects(
        () => updateNativeCalendarEntry(owner, createdEntry.id, {
          expectedUpdatedAt: createdEntry.updatedAt,
          title: "Stale edit",
          startAt: updatedEntry.startAt,
          endAt: updatedEntry.endAt,
          allDay: false,
          color: updatedEntry.color,
        }, { boardId }),
        (error) => error instanceof BoardAccessError && error.status === 409,
      );

      const scheduleUpdate = await updateNativeCalendarEntrySchedule(owner, createdEntry.id, {
        expectedStartAt: updatedEntry.startAt,
        expectedEndAt: updatedEntry.endAt,
        startAt: "2026-07-20T16:15:00.000Z",
        endAt: "2026-07-20T17:45:00.000Z",
      }, { boardId });
      assert.ok(scheduleUpdate.updatedAt);
      assert.notEqual(scheduleUpdate.updatedAt, updatedEntry.updatedAt);

      await assert.rejects(
        () => softDeleteNativeCalendarEntry(owner, createdEntry.id, {
          expectedUpdatedAt: updatedEntry.updatedAt,
        }, { boardId }),
        (error) => error instanceof BoardAccessError && error.status === 409,
      );

      const deleted = await softDeleteNativeCalendarEntry(owner, createdEntry.id, {
        expectedUpdatedAt: scheduleUpdate.updatedAt,
      }, { boardId });
      assert.equal(deleted.calendarEntryId, createdEntry.id);
      assert.ok(deleted.deletedAt);

      const listedAfterDelete = await listCalendarEntriesForBoard(owner, boardId);
      assert.ok(!listedAfterDelete.some((entry) => entry.id === createdEntry.id));
      const deletedRow = await pool.query<{ deleted_at: string | Date | null }>(
        `SELECT deleted_at FROM calendar_entries WHERE id = $1`,
        [createdEntry.id],
      );
      assert.ok(deletedRow.rows[0]?.deleted_at);
    } finally {
      await pool.query(`DELETE FROM notes WHERE owner_user_id IN ($1, $2)`, [ownerId, viewerId]);
      await pool.query(`DELETE FROM boards WHERE id = $1`, [boardId]);
      await pool.query(`DELETE FROM users WHERE id IN ($1, $2)`, [ownerId, viewerId]);

      const countsAfter = await pool.query<{ count: string }>(
        `SELECT COUNT(*)::text AS count FROM calendar_entries`,
      );
      assert.equal(countsAfter.rows[0]?.count, countsBefore.rows[0]?.count);
      await pool.end();
    }
  },
);
