import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WikiHits } from "../src/components/wiki/wiki-discovery";
import { topicDescendants, topicPath } from "../src/components/wiki/wiki-topic-paths";
import { isWikiDocumentSupported } from "../src/components/wiki/wiki-format";
import { fixtureHit, fixtureTopics, topicIds, createP2Fixture } from "./fixtures/wiki-p2-ui/state";
import { ids } from "./fixtures/wiki-ui/state";
import { AppRouterContext, type AppRouterInstance } from "next/dist/shared/lib/app-router-context.shared-runtime";

const renderRouter: AppRouterInstance = { back() {}, forward() {}, refresh() {}, push() {}, replace() {}, prefetch() {}, bfcacheId: "snippet-render" };
test("topic paths and descendant exclusion include the complete subtree without looping on malformed input", () => {
  const topics = fixtureTopics();
  assert.equal(topicPath(topics[1], topics), "Operations / Daily routines");
  assert.deepEqual([...topicDescendants(topicIds[0], topics)], topicIds.slice(0, 2));
  topics[0].parentTopicId = topicIds[1];
  assert.equal(topicPath(topics[0], topics), "Daily routines / Operations");
});
test("ranked snippets render untrusted markup as text and only match segments as mark", () => {
  const html = renderToStaticMarkup(<AppRouterContext.Provider value={renderRouter}><WikiHits pages={[fixtureHit()]} /></AppRouterContext.Provider>);
  assert.match(html, /&lt;img/); assert.doesNotMatch(html, /<img/); assert.match(html, /<mark>knowledge<\/mark>/);
});
test("history format gate waits for schema, refuses future formats and unknown blocks losslessly", () => {
  const content = [{ type: "futureBlock", content: [] }], before = JSON.stringify(content);
  const inventory = { blockTypes: ["paragraph"], inlineContentTypes: ["text", "pageMention"] };
  assert.equal(isWikiDocumentSupported(content, 2, null), false);
  assert.equal(isWikiDocumentSupported(content, 2, inventory), false);
  assert.equal(isWikiDocumentSupported([], 3, inventory), false);
  assert.equal(isWikiDocumentSupported([{ type: "paragraph", content: [{ type: "pageMention", props: { noteId: ids.note } }] }], 2, inventory), true);
  assert.equal(JSON.stringify(content), before);
});
test("contract fixture models assignment conflict independently from body version", async () => {
  const fixture = createP2Fixture(); fixture.conflict();
  const url = new URL(`http://localhost/api/wiki/pages/${ids.note}/topics`);
  const result = await fixture.handle("PUT", url, { sourceSpaceId: ids.space, expectedTopicIds: [topicIds[0]], topicIds: [topicIds[1]] });
  assert.equal(result.status, 409); assert.equal(fixture.base.note.contentVersion, 1);
  assert.deepEqual(fixture.selected, [topicIds[2]]);
});
