import assert from "node:assert/strict";
import test from "node:test";
import { createPublicContentBudget, sanitizeSharedNoteContent } from "../src/lib/public-task-share-content";
import { mentionId } from "./fixtures/wiki-p2-editor/documents";

test("public wire projection replaces canonical/malformed nested and table mentions without lookups", () => {
  const malicious = { type: "pageMention", props: { noteId: mentionId, title: "Private title", href: "/private" }, text: "Private title", content: [{ type: "text", text: "Private title" }] };
  const doc = [{ type: "paragraph", content: [malicious], children: [{ type: "table", content: { type: "tableContent", rows: [{ cells: [[malicious], { type: "tableCell", content: [malicious] }] }] } }] }];
  const sanitized = sanitizeSharedNoteContent(doc, () => { throw new Error("No URL or lookup for mentions"); });
  const wire = JSON.stringify(sanitized);
  for (const secret of ["pageMention", "noteId", mentionId, "Private title", "/private", "href"]) assert.equal(wire.includes(secret), false);
  assert.equal(wire.match(/Wiki page/g)?.length, 3);
});
test("mention fallbacks honor complexity and public wire-size budgets", () => {
  const tooMany = [{ type: "paragraph", content: Array.from({ length: 10001 }, () => ({ type: "pageMention", props: null })) }];
  assert.throws(() => sanitizeSharedNoteContent(tooMany, () => null), /complex/);
  const result = createPublicContentBudget(100, 100).document(tooMany, () => null);
  assert.match(JSON.stringify(result), /cannot be displayed/);
});
