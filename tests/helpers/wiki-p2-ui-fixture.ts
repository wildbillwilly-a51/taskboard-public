import { expect, type Page } from "@playwright/test";
import { createP2Fixture } from "../fixtures/wiki-p2-ui/state";
import type { Scenario } from "../fixtures/wiki-ui/state";
export async function installP2Fixture(page: Page, scenario: Scenario = "manager") {
  if (process.env.TASKBOARD_WIKI_P2_REAL === "1") throw new Error("No fixtures in real mode.");
  const base = process.env.TASKBOARD_BASE_URL || `http://127.0.0.1:${process.env.TASKBOARD_VISUAL_TEST_PORT || 3243}`;
  await page.context().addCookies([{ name: "wikiScenario", value: scenario, url: base }]);
  const fixture = createP2Fixture(scenario), errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (/hydration|didn't match|did not match/i.test(message.text())) errors.push(message.text()); });
  await page.route("**/api/**", async route => {
    const request = route.request();
    let body: unknown;
    if (request.postData() && !request.headers()["content-type"]?.includes("multipart")) body = request.postDataJSON();
    try {
      const result = await fixture.handle(request.method(), new URL(request.url()), body);
      const note = fixture.base.note;
      await page.context().addCookies([{ name: "wikiState", value: Buffer.from(JSON.stringify({ title: note.title, contentVersion: note.contentVersion, content: note.content, contentMarkdown: note.contentMarkdown, deletedAt: note.deletedAt, spaceId: note.wiki.spaceId, spaceSlug: note.wiki.spaceSlug })).toString("base64url"), url: base }]);
      await route.fulfill({ status: result.status, contentType: typeof result.body === "string" ? "text/plain" : "application/json", body: typeof result.body === "string" ? result.body : JSON.stringify(result.body), headers: { "Cache-Control": "private, no-store" } });
    } catch (error) { errors.push(String(error)); await route.fulfill({ status: 500, json: { error: "Unexpected fixture request" } }); }
  });
  return { fixture, check: () => expect(errors).toEqual([]) };
}
