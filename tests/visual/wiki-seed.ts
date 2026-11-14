import { createP2Fixture } from "../fixtures/wiki-p2-ui/state";
import { expect, type Page } from "@playwright/test";
import { type Scenario } from "../fixtures/wiki-ui/state";

export async function installWikiFixture(page: Page, scenario: Scenario = "manager") {
  if (process.env.TASKBOARD_WIKI_UI_FIXTURE !== "1") throw new Error("Fixture interception is disabled outside the external sandbox. Real app verification must seed its isolated DB.");
  const base = process.env.TASKBOARD_BASE_URL ?? `http://127.0.0.1:${process.env.TASKBOARD_VISUAL_TEST_PORT || 3231}`;
  await page.context().addCookies([{ name: "wikiScenario", value: scenario, url: base }]);
  const p2 = createP2Fixture(scenario);
  const fixture = { ...p2.base, handle: p2.handle, get note() { return p2.base.note; } };
  const unexpected: string[] = [];
  const browserErrors: string[] = [];
  page.on("pageerror", error => browserErrors.push(error.message));
  page.on("console", message => { if (/hydration|didn't match|did not match/i.test(message.text())) browserErrors.push(message.text()); });
  await page.route("**/api/**", async route => {
    const request = route.request();
    let body: unknown;
    if (request.postData() && !request.headers()["content-type"]?.includes("multipart")) { try { body = request.postDataJSON(); } catch { body = request.postData(); } }
    try {
      const result = await fixture.handle(request.method(), new URL(request.url()), body);
      if (request.method() !== "GET" || new URL(request.url()).pathname === `/api/wiki/pages/${fixture.note.id}`) {
        const note = fixture.note;
        const state = { title: note.title, contentVersion: note.contentVersion, content: note.content, contentMarkdown: note.contentMarkdown, deletedAt: note.deletedAt, spaceId: note.wiki.spaceId, spaceSlug: note.wiki.spaceSlug };
        await page.context().addCookies([{ name: "wikiState", value: Buffer.from(JSON.stringify(state)).toString("base64url"), url: base }]);
      }
      await route.fulfill({ status: result.status, contentType: typeof result.body === "string" ? "text/plain" : "application/json", body: typeof result.body === "string" ? result.body : JSON.stringify(result.body), headers: { "Cache-Control": "private, no-store" } });
    } catch (reason) { unexpected.push(String(reason)); await route.fulfill({ status: 500, json: { error: "Unexpected fixture request" } }); }
  });
  return { fixture, assertExpected: () => { expect(unexpected).toEqual([]); expect(browserErrors).toEqual([]); } };
}
