import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { PageMentionLabel } from "../src/components/notes/page-mention";
import { mentionId } from "./fixtures/wiki-p2-editor/documents";

test("a renderer without authenticated context is a neutral label with no link or ID", () => {
  const html = renderToStaticMarkup(<PageMentionLabel noteId={mentionId} />);
  assert.match(html, /Wiki page/); assert.doesNotMatch(html, /href=|noteId|71000000/);
});
