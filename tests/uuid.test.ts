import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { parseAdminAuditEventFilters } from "../src/lib/admin-audit-policy";
import { isValidBoardId } from "../src/lib/board-access";
import { parseBoardPrivacySettingsPatchBody } from "../src/lib/board-privacy-policy";
import { isUuid } from "../src/lib/uuid";

// The seed board id in every install: stableUuid("board-personal-command").
// Its version digit (2) and variant digit (c) are not RFC 4122 values.
const seedBoardId = "21d2718b-33e2-236d-cca8-3fb3c3779b4d";

// Same shape as stableUuid in taskboard-store (SHA-1 hex, no version/variant bits).
function seedStyleUuid(input: string) {
  const hex = createHash("sha1").update(input).digest("hex").slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

test("seed board id is the deterministic id the seed creates", () => {
  assert.equal(seedStyleUuid("board-personal-command"), seedBoardId);
});

test("any well-formed 8-4-4-4-12 hex id is accepted, whatever its version and variant", () => {
  assert.equal(isUuid(seedBoardId), true);
  assert.equal(isValidBoardId(seedBoardId), true);
  assert.equal(isUuid(seedBoardId.toUpperCase()), true);
  assert.equal(isUuid("10000000-0000-4000-8000-000000000001"), true);
  assert.equal(isUuid("00000000-0000-0000-0000-000000000000"), true);
  assert.equal(isUuid("ffffffff-ffff-ffff-ffff-ffffffffffff"), true);

  for (const digit of "0123456789abcdef") {
    assert.equal(isValidBoardId(`10000000-0000-${digit}000-${digit}000-000000000001`), true, digit);
  }

  for (const key of ["seed-user", "board-personal-command:bucket:today", "x:task:1"]) {
    assert.equal(isValidBoardId(seedStyleUuid(key)), true, key);
  }
});

test("malformed ids are still rejected", () => {
  for (const value of [
    "",
    "not-a-uuid",
    "21d2718b33e2236dcca83fb3c3779b4d",
    "{21d2718b-33e2-236d-cca8-3fb3c3779b4d}",
    " 21d2718b-33e2-236d-cca8-3fb3c3779b4d",
    "21d2718b-33e2-236d-cca8-3fb3c3779b4d\n",
    "21d2718b-33e2-236d-cca8-3fb3c3779b4",
    "21d2718b-33e2-236d-cca8-3fb3c3779b4dd",
    "g1d2718b-33e2-236d-cca8-3fb3c3779b4d",
    "21d2718b-33e2-236d-cca8-3fb3c3779b4d' OR '1'='1",
  ]) {
    assert.equal(isUuid(value), false, JSON.stringify(value));
    assert.equal(isValidBoardId(value), false, JSON.stringify(value));
  }

  assert.equal(isUuid(undefined), false);
  assert.equal(isUuid(null), false);
  assert.equal(isUuid(123), false);
});

test("admin audit filters and board privacy settings accept seed-style ids", () => {
  const seedUserId = seedStyleUuid("seed-user");
  const filters = parseAdminAuditEventFilters(
    new URLSearchParams({ actorUserId: seedUserId, targetBoardId: seedBoardId }),
  );
  assert.equal(filters.actorUserId, seedUserId);
  assert.equal(filters.targetBoardId, seedBoardId);

  const teamId = seedStyleUuid("team");
  assert.deepEqual(
    parseBoardPrivacySettingsPatchBody({
      personalVisibility: "team_visible",
      personalVisibilityTeamId: teamId,
    }),
    { personalVisibility: "team_visible", personalVisibilityTeamId: teamId },
  );
});
