import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { WikiFiles } from "../src/components/wiki/wiki-files";
import { maskUnavailableFiles } from "../src/components/wiki/wiki-reader";
import { wikiViewQuery } from "../src/components/wiki/wiki-routing";
import { createWikiFixture, fixtureNote, fixtureVersion, ids } from "./fixtures/wiki-ui/state";
import { selectUploadedNoteFile } from "../src/components/wiki/wiki-attachments";

test("canonical redirects preserve only supported view fields", () => {
  assert.equal(wikiViewQuery({ mode: "edit", view: "history", version: ids.version, token: "private", unknown: "1" }), `?view=history&version=${ids.version}`);
  assert.equal(wikiViewQuery({ mode: "delete", version: "bad" }), "");
});
test("readers see downloads; editors remove; managers delete permanently", () => {
  const html = (canEdit: boolean, canManage: boolean) => renderToStaticMarkup(<WikiFiles noteId={ids.note} files={fixtureNote().attachments} canEdit={canEdit} canManage={canManage} busy={false} onUpload={() => {}} onRemove={() => {}} />);
  assert.match(html(false, false), /guide.txt/); assert.doesNotMatch(html(false, false), />Remove<|Delete permanently|Add file/);
  assert.match(html(true, false), />Remove</); assert.doesNotMatch(html(true, false), /Delete permanently/); assert.match(html(true, true), /Delete permanently/);
});
test("history replaces unavailable embedded files without dead links", () => {
  const version = fixtureVersion(); const result = maskUnavailableFiles(version.content, version.unavailableAttachmentIds);
  assert.match(JSON.stringify(result), /File unavailable/); assert.doesNotMatch(JSON.stringify(result), new RegExp(ids.missing));
  assert.match(JSON.stringify(result), /Original document body/);
});
test("fixture rejects unexpected endpoints and fields and models a version conflict", async () => {
  const fake = createWikiFixture();
  await assert.rejects(fake.handle("PATCH", new URL(`http://localhost/api/notes/${ids.note}`), { home: null }), /Unexpected fixture request fields/);
  await assert.rejects(fake.handle("GET", new URL("http://localhost/api/unknown")), /Unexpected fixture endpoint/);
  const result = await fake.handle("PATCH", new URL(`http://localhost/api/notes/${ids.note}`), { title: "New", expectedVersion: 8 });
  assert.equal(result.status, 409); assert.equal((result.body as { code: string }).code, "note_conflict");
});
test("the full upload response selects the new file instead of an older existing attachment", () => {
  const previous = fixtureNote().attachments;
  const added = { ...previous[0], id: ids.missing, originalName: "new.txt", sizeBytes: 45 };
  assert.equal(selectUploadedNoteFile(previous, [...previous, added], { name: "new.txt", size: 45 })?.id, ids.missing);
  assert.equal(selectUploadedNoteFile(previous, previous, { name: "new.txt", size: 45 }), undefined);
});
