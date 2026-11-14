import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertCanManagePersonalBoardShares,
  canManagePersonalBoardShares,
  normalizePersonalBoardMemberGrantRole,
  type PersonalBoardSharingActor,
  type PersonalBoardSharingBoard,
} from "../src/lib/personal-board-sharing-policy";

const ownerId = "00000000-0000-4000-8000-000000000001";
const otherId = "00000000-0000-4000-8000-000000000002";

const personalBoard: PersonalBoardSharingBoard = {
  id: "10000000-0000-4000-8000-000000000001",
  boardType: "personal",
  ownerUserId: ownerId,
};

function actor(
  overrides: Partial<PersonalBoardSharingActor> = {},
): PersonalBoardSharingActor {
  return {
    id: otherId,
    role: "standard",
    isDisabled: false,
    ...overrides,
  };
}

test("personal board sharing management belongs to the actual owner, without an admin bypass", () => {
  assert.equal(canManagePersonalBoardShares(actor({ id: ownerId }), personalBoard), true);
  assert.equal(canManagePersonalBoardShares(actor({ role: "admin" }), personalBoard), false);
  assert.equal(canManagePersonalBoardShares(actor({ role: "admin", id: ownerId }), personalBoard), true);
  assert.equal(canManagePersonalBoardShares(actor({ role: "manager" }), personalBoard), false);
  assert.equal(canManagePersonalBoardShares(actor({ role: "standard" }), personalBoard), false);
  assert.equal(
    canManagePersonalBoardShares(actor({ id: ownerId, isDisabled: true }), personalBoard),
    false,
  );

  assert.doesNotThrow(() =>
    assertCanManagePersonalBoardShares(actor({ id: ownerId }), personalBoard),
  );
  assert.throws(
    () => assertCanManagePersonalBoardShares(actor({ role: "manager" }), personalBoard),
    /Personal board sharing access is required/,
  );
});

test("personal board sharing rejects team boards and missing owners", () => {
  assert.equal(
    canManagePersonalBoardShares(actor({ role: "admin" }), {
      ...personalBoard,
      boardType: "team",
    }),
    false,
  );

  assert.throws(
    () =>
      assertCanManagePersonalBoardShares(actor({ role: "admin" }), {
        ...personalBoard,
        boardType: "team",
      }),
    /only for personal boards/,
  );
  assert.throws(
    () =>
      assertCanManagePersonalBoardShares(actor({ role: "admin" }), {
        ...personalBoard,
        ownerUserId: null,
      }),
    /Board owner is unavailable/,
  );
});

test("personal board sharing accepts only viewer and editor roles", () => {
  assert.equal(normalizePersonalBoardMemberGrantRole("viewer"), "viewer");
  assert.equal(normalizePersonalBoardMemberGrantRole("editor"), "editor");
  assert.throws(
    () => normalizePersonalBoardMemberGrantRole("owner"),
    /must be viewer or editor/,
  );
  assert.throws(
    () => normalizePersonalBoardMemberGrantRole("admin"),
    /must be viewer or editor/,
  );
});

test("personal board sharing routes are owner scoped and database guarded", () => {
  const listRoute = readFileSync("src/app/api/boards/[boardId]/members/route.ts", "utf8");
  const memberRoute = readFileSync(
    "src/app/api/boards/[boardId]/members/[userId]/route.ts",
    "utf8",
  );
  const candidateRoute = readFileSync(
    "src/app/api/boards/[boardId]/member-candidates/route.ts",
    "utf8",
  );

  assert.match(listRoute, /export async function GET/);
  assert.match(listRoute, /export async function POST/);
  assert.match(listRoute, /requireTaskboardUserFromHeaders\(request\)/);
  assert.match(listRoute, /listPersonalBoardMembers\(user, boardId\)/);
  assert.match(listRoute, /addPersonalBoardMember\(user, boardId/);
  assert.match(listRoute, /Board member grant already exists/);

  assert.match(memberRoute, /export async function PATCH/);
  assert.match(memberRoute, /export async function DELETE/);
  assert.match(memberRoute, /updatePersonalBoardMember\(user, boardId, userId/);
  assert.match(memberRoute, /removePersonalBoardMember\(user, boardId, userId\)/);

  assert.match(candidateRoute, /export async function GET/);
  assert.match(candidateRoute, /listPersonalBoardMemberCandidates\(user, boardId, q\)/);
  assert.doesNotMatch(candidateRoute, /local_password_hash|password_hash|cookie|token|secret/i);
});

test("personal board sharing store uses board_members and audits real changes only", () => {
  const store = readFileSync("src/lib/taskboard-store.ts", "utf8");

  assert.match(store, /export async function listPersonalBoardMembers/);
  assert.match(store, /export async function listPersonalBoardMemberCandidates/);
  assert.match(store, /export async function addPersonalBoardMember/);
  assert.match(store, /export async function updatePersonalBoardMember/);
  assert.match(store, /export async function removePersonalBoardMember/);
  assert.match(store, /INSERT INTO board_members \(board_id, user_id, role\)/);
  assert.match(store, /DELETE FROM board_members/);
  assert.match(store, /users\.is_disabled = FALSE/);
  assert.match(store, /Search query must be at least 2 characters/);
  assert.match(store, /users\.id <> \$2/);
  assert.match(store, /board_members\.user_id IS NULL/);
  assert.match(store, /Board owner cannot be granted explicit board access/);
  assert.match(store, /if \(grant\.explicit_role === role\)/);
  assert.match(store, /personal_board\.member_grant\.added/);
  assert.match(store, /personal_board\.member_grant\.changed/);
  assert.match(store, /personal_board\.member_grant\.removed/);
  assert.match(store, /canManagePersonalBoardShares\(actor/);
});

test("board settings UI exposes explicit sharing without owner as a new grant option", () => {
  const taskboard = readFileSync("src/components/taskboard.tsx", "utf8");

  assert.match(taskboard, /Explicit sharing/);
  assert.match(taskboard, /People you add here find this board under Shared with me/);
  assert.match(taskboard, /persistLoadPersonalBoardMembers/);
  assert.match(taskboard, /persistSearchPersonalBoardMemberCandidates/);
  assert.match(taskboard, /persistAddPersonalBoardMember/);
  assert.match(taskboard, /persistUpdatePersonalBoardMember/);
  assert.match(taskboard, /persistRemovePersonalBoardMember/);
  assert.match(taskboard, /currentAccessibleBoard\?\.boardType === "personal"/);
  assert.match(taskboard, /<option value="viewer">Viewer<\/option>/);
  assert.match(taskboard, /<option value="editor">Editor<\/option>/);
  assert.match(taskboard, /member\.role === "owner" \? <option value="owner">Owner grant<\/option>/);
});

test("personal board sharing routes preserve database-unavailable behavior", () => {
  const probe = `
    import { pathToFileURL } from "node:url";
    import path from "node:path";
    import { NextRequest } from "next/server";

    const routePaths = [
      "src/app/api/boards/[boardId]/members/route.ts",
      "src/app/api/boards/[boardId]/members/[userId]/route.ts",
      "src/app/api/boards/[boardId]/member-candidates/route.ts",
    ];
    for (const routePath of routePaths) {
      const route = await import(pathToFileURL(path.join(process.cwd(), routePath)).href);
      const exports = route.default ?? route["module.exports"] ?? route;
      const handler = exports.GET ?? exports.PATCH ?? exports.DELETE;
      const response = await handler(
        new NextRequest("http://taskboard.test/api/boards/10000000-0000-4000-8000-000000000001/members"),
        {
          params: Promise.resolve({
            boardId: "10000000-0000-4000-8000-000000000001",
            userId: "20000000-0000-4000-8000-000000000001",
          }),
        },
      );
      const body = await response.json().catch(() => ({}));
      if (response.status !== 503 || !String(body.error ?? "").includes("DATABASE_URL")) {
        console.error(JSON.stringify({ routePath, status: response.status, body }));
        process.exit(1);
      }
    }
  `;

  execFileSync(process.execPath, ["--conditions", "react-server", "--import", "tsx", "--eval", probe], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: "",
    },
    stdio: "pipe",
  });
});
