import assert from "node:assert/strict";
import test from "node:test";
import { getLoginDestination } from "../src/lib/login-destination";

test("sign-in keeps Taskboard deep links and rejects external destinations", () => {
  const board = "/?boardId=example&view=board#task";
  assert.equal(getLoginDestination(board), board);
  for (const value of ["//example.test/", "/\\example.test/", "/a/..//example.test/", "https://example.test/"]) {
    assert.equal(getLoginDestination(value), "/folio", value);
  }
});
