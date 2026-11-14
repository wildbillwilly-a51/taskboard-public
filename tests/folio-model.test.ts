import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { canReadFolioDocument, defaultFolioPageState, deriveFolioPlacement,
  folioDescendants, folioNavigationKey, folioSpacePath, normalizeFolioPageState,
  parseFolioNavigation, type FolioSpace } from "../src/lib/folio-model";

test("Folio access follows the full active connection set, including invisible targets", () => {
  assert.deepEqual(deriveFolioPlacement([]), { audience: "public", unconnected: true });
  assert.deepEqual(deriveFolioPlacement([{ kind: "personal" }]), { audience: "personal", unconnected: false });
  for (const kind of ["shared", "board", "task"] as const) {
    const placement = deriveFolioPlacement([{ kind: "personal" }, { kind }]);
    assert.deepEqual(placement, { audience: "public", unconnected: false });
    assert.equal(canReadFolioDocument({ actorId: "outsider", ownerId: "owner", audience: placement.audience }), true);
  }
  assert.equal(canReadFolioDocument({ actorId: "outsider", ownerId: "owner", audience: "personal" }), false);
  assert.equal(canReadFolioDocument({ actorId: "owner", ownerId: "owner", audience: "personal" }), true);
  assert.equal(canReadFolioDocument({ actorId: "owner", disabled: true, ownerId: "owner", audience: "public" }), false);
  assert.equal(canReadFolioDocument({ ownerId: "owner", audience: "public" }), false);
});

test("Space page settings preserve the restorable dynamic list and validate banners", () => {
  const banner = randomUUID();
  assert.deepEqual(normalizeFolioPageState({ ...defaultFolioPageState, bannerAttachmentId: banner,
    notesListVisible: false, notesListPosition: "before" }), {
    bannerAttachmentId: banner, notesListVisible: false, notesListPosition: "before",
  });
  for (const value of [null, [], {}, { ...defaultFolioPageState, notesListVisible: "false" },
    { ...defaultFolioPageState, bannerAttachmentId: "/someone-elses-file" },
    { ...defaultFolioPageState, notesListPosition: "middle" }, { ...defaultFolioPageState, audience: "public" }]) {
    assert.throws(() => normalizeFolioPageState(value));
  }
});

test("Folio descendant listings deduplicate and remain bounded on corrupt cycles", () => {
  const root = randomUUID(), child = randomUUID(), grandchild = randomUUID();
  const space = (id: string, parentId: string | null, title: string): FolioSpace => ({
    id, parentId, title, kind: "shared", ownerUserId: null, boardId: null, taskId: null,
    root: false, archived: false, pageNoteId: null, canManage: true,
  });
  const spaces = [space(root, null, "Network"), space(child, root, "Runbooks"), space(grandchild, child, "Switch")];
  assert.deepEqual([...folioDescendants(spaces, root)], [root, child, grandchild]);
  assert.equal(folioSpacePath(spaces, grandchild), "Network / Runbooks / Switch");
  assert.equal(folioDescendants([space(root, child, "A"), space(child, root, "B")], root).size, 2);
});

test("Login-scoped navigation remembers same-session targets and rejects invalid state", () => {
  const id = randomUUID(), note = randomUUID();
  const state = { view: { kind: "space", spaceId: id }, noteId: note, editing: true,
    expanded: [id, "invalid"], boardsExpanded: true };
  assert.deepEqual(parseFolioNavigation(JSON.stringify(state)), { ...state, expanded: [id] });
  assert.equal(parseFolioNavigation(null).view.kind, "home");
  assert.equal(parseFolioNavigation("broken").view.kind, "home");
  assert.equal(parseFolioNavigation('{"view":{"kind":"space","spaceId":"invalid"}}').view.kind, "home");
  assert.notEqual(folioNavigationKey("u1", "session-a"), folioNavigationKey("u1", "session-b"));
  assert.notEqual(folioNavigationKey("u1", "session-a"), folioNavigationKey("u2", "session-a"));
});
