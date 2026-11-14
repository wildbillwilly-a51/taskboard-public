import assert from "node:assert/strict";
import test from "node:test";

import { assertBoardLifecycleAccess, buildBoardAccessMetadata } from "@/lib/board-access";

const boardId = "00000000-0000-4000-8000-000000000001";

test("lifecycle access follows edit access unless it is withheld", () => {
  assert.equal(buildBoardAccessMetadata({ boardId, level: "editor", source: "board_member" }).canManageLifecycle, true);
  assert.equal(buildBoardAccessMetadata({ boardId, level: "viewer", source: "board_member" }).canManageLifecycle, false);
  assert.equal(
    buildBoardAccessMetadata({ boardId, level: "owner", source: "board_member", canManageLifecycle: false }).canManageLifecycle,
    false,
  );
  // Lifecycle access never exceeds edit access.
  assert.equal(
    buildBoardAccessMetadata({ boardId, level: "viewer", source: "board_member", canManageLifecycle: true }).canManageLifecycle,
    false,
  );
});

test("lifecycle assertion names the manager requirement", () => {
  const editor = buildBoardAccessMetadata({ boardId, level: "editor", source: "team_default", canManageLifecycle: false });
  assert.throws(() => assertBoardLifecycleAccess(editor, "archive tasks"), /Only a team manager can archive tasks/);
  const viewer = buildBoardAccessMetadata({ boardId, level: "viewer", source: "team_default" });
  assert.throws(() => assertBoardLifecycleAccess(viewer, "archive tasks"), /do not have access/);
  assert.doesNotThrow(() =>
    assertBoardLifecycleAccess(buildBoardAccessMetadata({ boardId, level: "owner", source: "team_manager" }), "archive tasks"),
  );
});
