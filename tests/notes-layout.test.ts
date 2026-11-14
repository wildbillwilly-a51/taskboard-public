import assert from "node:assert/strict";
import test from "node:test";

import {
  getEffectiveNotesColumnWidths,
  getNotesColumnBounds,
  getNotesLayoutMode,
  getVisibleNotesColumns,
  NOTES_LAYOUT,
  normalizeNotesColumnWidths,
} from "@/lib/notes-layout";

test("layout mode follows the workspace width", () => {
  assert.equal(getNotesLayoutMode(1400), "wide");
  assert.equal(getNotesLayoutMode(NOTES_LAYOUT.wideMin), "wide");
  assert.equal(getNotesLayoutMode(NOTES_LAYOUT.wideMin - 1), "medium");
  assert.equal(getNotesLayoutMode(NOTES_LAYOUT.singleBelow), "medium");
  assert.equal(getNotesLayoutMode(NOTES_LAYOUT.singleBelow - 1), "single");
});

test("visible columns follow the mode and the phone/medium pane", () => {
  assert.deepEqual(getVisibleNotesColumns("wide", "note"), { sidebar: true, list: true });
  assert.deepEqual(getVisibleNotesColumns("medium", "list"), { sidebar: false, list: true });
  assert.deepEqual(getVisibleNotesColumns("medium", "nav"), { sidebar: true, list: false });
  assert.deepEqual(getVisibleNotesColumns("single", "nav"), { sidebar: false, list: false });
});

test("stored widths are normalized and bounded", () => {
  assert.deepEqual(normalizeNotesColumnWidths(null), {
    sidebar: NOTES_LAYOUT.sidebar.default,
    list: NOTES_LAYOUT.list.default,
  });
  assert.deepEqual(normalizeNotesColumnWidths({ sidebar: 10, list: 9999 }), {
    sidebar: NOTES_LAYOUT.sidebar.min,
    list: NOTES_LAYOUT.list.max,
  });
  assert.deepEqual(normalizeNotesColumnWidths({ sidebar: "250.4", list: "x" }), {
    sidebar: 250,
    list: NOTES_LAYOUT.list.default,
  });
});

test("the editor keeps its minimum width; the list shrinks before the sidebar", () => {
  // Wide and roomy: stored widths are used as they are.
  assert.deepEqual(getEffectiveNotesColumnWidths({ sidebar: 260, list: 340 }, 1400, "note"), {
    sidebar: 260,
    list: 340,
  });

  // 1000px: 2 separators + 360 editor leave 638 for both columns.
  const tight = getEffectiveNotesColumnWidths({ sidebar: 300, list: 500 }, 1000, "note");
  assert.equal(tight.sidebar + tight.list, 1000 - 2 - NOTES_LAYOUT.editorMin);
  assert.equal(tight.sidebar, 300);

  // Very tight: both reach their minimums and stop there.
  const minimal = getEffectiveNotesColumnWidths({ sidebar: 400, list: 500 }, 960, "note");
  assert.equal(minimal.list, NOTES_LAYOUT.list.min);
  assert.ok(minimal.sidebar >= NOTES_LAYOUT.sidebar.min);

  // Medium: only the list is beside the editor.
  assert.equal(getEffectiveNotesColumnWidths({ sidebar: 260, list: 500 }, 800, "list").list, 800 - 1 - 360);
});

test("separator bounds leave room for the editor and the other column", () => {
  const effective = { sidebar: 240, list: 300 };
  assert.deepEqual(getNotesColumnBounds("sidebar", effective, 1400, "note"), {
    min: NOTES_LAYOUT.sidebar.min,
    max: NOTES_LAYOUT.sidebar.max,
  });
  assert.deepEqual(getNotesColumnBounds("list", effective, 1000, "note"), {
    min: NOTES_LAYOUT.list.min,
    max: 1000 - 2 - 360 - 240,
  });
  assert.equal(getNotesColumnBounds("list", effective, 700, "list").max, 700 - 1 - 360);
});
