import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOptionsHref,
  getSafeOptionsReturnTo,
} from "../src/lib/options-return";

test("options href preserves the active Taskboard workspace location", () => {
  assert.equal(
    buildOptionsHref("/?boardId=board-1&view=agenda&taskId=task-1"),
    "/options?returnTo=%2F%3FboardId%3Dboard-1%26view%3Dagenda%26taskId%3Dtask-1",
  );
  assert.equal(
    buildOptionsHref("/calendar?boardId=board-1&view=outages&taskId=task-1"),
    "/options?returnTo=%2Fcalendar%3FboardId%3Dboard-1%26view%3Doutages%26taskId%3Dtask-1",
  );
});

test("options return target accepts only Taskboard workspace routes", () => {
  assert.equal(
    getSafeOptionsReturnTo("/?boardId=board-1&view=focus&taskId=task-1"),
    "/?boardId=board-1&view=focus&taskId=task-1",
  );
  assert.equal(
    getSafeOptionsReturnTo("/calendar?boardId=board-1&view=outages"),
    "/calendar?boardId=board-1&view=outages",
  );
  assert.equal(getSafeOptionsReturnTo("https://example.com"), "/");
  assert.equal(getSafeOptionsReturnTo("//example.com/calendar"), "/");
  assert.equal(getSafeOptionsReturnTo("/admin/users"), "/");
  assert.equal(getSafeOptionsReturnTo(undefined), "/");
});

test("Wiki appearance settings return to the current page and keep the local route boundary", () => {
  assert.equal(getSafeOptionsReturnTo("/wiki"), "/wiki");
  assert.equal(getSafeOptionsReturnTo("/wiki/operations/page-id-checklist?view=history#files"), "/wiki/operations/page-id-checklist?view=history#files");
  assert.equal(getSafeOptionsReturnTo("/wikievil"), "/");
  assert.equal(getSafeOptionsReturnTo("/wiki/../../admin/users"), "/");
  assert.equal(getSafeOptionsReturnTo("//example.com/wiki"), "/");
});


test("Folio and legacy Notes settings return preserve exact local workspace routes", () => {
  for (const value of ["/folio", "/notes", "/folio?note=note-1#section=block-1", "/notes?boardId=board-1&note=note-1"]) {
    assert.equal(getSafeOptionsReturnTo(value), value);
    assert.equal(getSafeOptionsReturnTo(decodeURIComponent(buildOptionsHref(value).split("returnTo=")[1])), value);
  }
  for (const value of ["/folioevil", "/notesevil", "/folio/../admin/users", "/folio/%2e%2e/admin/users", "//evil.example/folio", "/\\evil.example/folio"]) assert.equal(getSafeOptionsReturnTo(value), "/");
});
