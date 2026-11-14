import assert from "node:assert/strict";
import test from "node:test";
import { isPhoneKeyboardOpen, normalizeNoteReadingScale } from "@/lib/phone-layout";

test("navigation hides only for an editable focus plus a keyboard-sized viewport reduction", () => {
  const viewport = { baselineHeight: 844, visibleHeight: 500, scale: 1, editableFocused: true };
  assert.equal(isPhoneKeyboardOpen(viewport), true);
  assert.equal(isPhoneKeyboardOpen({ ...viewport, editableFocused: false }), false);
  assert.equal(isPhoneKeyboardOpen({ ...viewport, visibleHeight: 790 }), false);
  assert.equal(isPhoneKeyboardOpen({ ...viewport, scale: 1.5 }), false);
  assert.equal(isPhoneKeyboardOpen({ ...viewport, visibleHeight: 300, scale: 1.5 }), true);
});

test("reading scale uses bounded steps and safely accepts old or invalid preferences", () => {
  assert.equal(normalizeNoteReadingScale(undefined), 100);
  assert.equal(normalizeNoteReadingScale("invalid"), 100);
  assert.equal(normalizeNoteReadingScale(85), 100);
  assert.equal(normalizeNoteReadingScale(114), 110);
  assert.equal(normalizeNoteReadingScale(117), 120);
  assert.equal(normalizeNoteReadingScale(999), 160);
});
