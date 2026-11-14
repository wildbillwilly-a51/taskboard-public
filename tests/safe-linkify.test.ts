import assert from "node:assert/strict";
import test from "node:test";

import { splitSafeLinks } from "../src/lib/safe-linkify";

test("linkifies safe Outlook meeting links while preserving text and line breaks", () => {
  assert.deepEqual(
    splitSafeLinks("Join https://teams.example.com/meet/123\nBackup: www.example.com/help"),
    [
      { kind: "text", text: "Join " },
      {
        kind: "link",
        href: "https://teams.example.com/meet/123",
        text: "https://teams.example.com/meet/123",
      },
      { kind: "text", text: "\nBackup: " },
      { kind: "link", href: "https://www.example.com/help", text: "www.example.com/help" },
    ],
  );
});

test("keeps punctuation outside safe links", () => {
  assert.deepEqual(splitSafeLinks("Open (https://example.com/path)."), [
    { kind: "text", text: "Open (" },
    { kind: "link", href: "https://example.com/path", text: "https://example.com/path" },
    { kind: "text", text: ")." },
  ]);
});

test("does not linkify unsafe protocols or markup", () => {
  assert.deepEqual(splitSafeLinks("javascript:alert(1) <a href='https://bad.example'>bad</a>"), [
    { kind: "text", text: "javascript:alert(1) <a href='" },
    { kind: "link", href: "https://bad.example/", text: "https://bad.example" },
    { kind: "text", text: "'>bad</a>" },
  ]);
});
