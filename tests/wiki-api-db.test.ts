import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import type { Pool } from "pg";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";
import type { NoteContentInput } from "@/lib/notes-model";
import { isLocalVisualDatabase } from "./helpers/visual-database";

const enabled = process.env.WIKI_DB_TEST === "1";
type Fixture = {
  pool: Pool; users: Record<"owner" | "editor" | "viewer" | "outsider" | "manager", TaskboardUserIdentity>;
  board: string; board2: string; personal: string; cleanup(): Promise<void>;
};

test("real route contracts, Notes guards and historical files against full core", {
  skip: enabled ? false : "Requires completed core, WIKI_DB_TEST=1, isolated API database and uploads cwd.",
  concurrency: false,
}, async () => {
  assert.ok(isLocalVisualDatabase(new URL(process.env.DATABASE_URL!)), "Only a guarded localhost visual database is allowed.");
  assert.match(process.env.TASKBOARD_VISUAL_DATABASE_NAME ?? "", /^taskboard_visual_test_wiki_(?:p1_(?:api|int)|p2_(?:server|int))(?:_[a-z0-9_]+)?$/);
  assert.ok(process.env.WIKI_API_DB_CWD, "Set WIKI_API_DB_CWD to this isolated checkout's uploads cwd.");
  assert.equal(path.resolve(process.env.WIKI_API_DB_CWD), process.cwd(), "The uploads cwd must match the isolated checkout.");
  assert.ok(!existsSync(path.join(process.cwd(), ".env")), "Do not load a production/development env file.");
  assert.notEqual(process.env.WIKI_API_SANDBOX, "1", "Fixture bindings cannot establish a DB pass.");
  // Delayed import lets the checkpoint-only tree report a skip, not pretend
  // that its missing full-core helper/store has passed. Core owns this helper.
  const helperPath = "./helpers/wiki-db";
  const helper: { fixture(): Promise<Fixture>; content(text: string): NoteContentInput } = await import(helperPath);
  const fixture = await helper.fixture();
  const previousAuth = process.env.TASKBOARD_AUTH_MODE;
  process.env.TASKBOARD_AUTH_MODE = "authelia";
  const { users } = fixture;
  const req = (actor: TaskboardUserIdentity, method = "GET", body?: unknown, query = "") => new NextRequest(`http://127.0.0.1:3232/api/wiki${query}`, {
    method, headers: { "Remote-Email": actor.email, "Remote-Name": actor.displayName, "Remote-User": actor.username ?? actor.email },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const ctx = <T extends { spaceId?: string; noteId?: string; versionId?: string }>(params: T) => ({ params: Promise.resolve(params) });
  const result = async (response: Response, expected = 200) => {
    assert.equal(response.status, expected, await response.clone().text());
    return response.json();
  };
  try {
    // These are the production wrappers, bound to the real stores and identity.
    const spaces = await import("@/app/api/wiki/spaces/route");
    const space = await import("@/app/api/wiki/spaces/[spaceId]/route");
    const spacePages = await import("@/app/api/wiki/spaces/[spaceId]/pages/route");
    const pages = await import("@/app/api/wiki/pages/route");
    const page = await import("@/app/api/wiki/pages/[noteId]/route");
    const add = await import("@/app/api/wiki/pages/[noteId]/add/route");
    const move = await import("@/app/api/wiki/pages/[noteId]/move/route");
    const copy = await import("@/app/api/wiki/pages/[noteId]/copy/route");
    const versions = await import("@/app/api/wiki/pages/[noteId]/versions/route");
    const version = await import("@/app/api/wiki/pages/[noteId]/versions/[versionId]/route");
    const restoreVersion = await import("@/app/api/wiki/pages/[noteId]/versions/[versionId]/restore/route");
    const notes = await import("@/app/api/notes/route");
    const note = await import("@/app/api/notes/[noteId]/route");
    const attachment = await import("@/app/api/notes/[noteId]/attachments/[attachmentId]/route");
    const upload = await import("@/app/api/notes/[noteId]/attachments/route");
    const restore = await import("@/app/api/notes/[noteId]/restore/route");
    const link = await import("@/app/api/notes/[noteId]/links/route");
    const unlink = await import("@/app/api/notes/[noteId]/links/[taskId]/route");
    const convert = await import("@/app/api/notes/[noteId]/convert-to-task/route");
    const a = (await result(await spaces.POST(req(users.owner, "POST", { boardId: fixture.board, title: "API guide" })), 201)).space;
    const b = (await result(await spaces.POST(req(users.owner, "POST", { boardId: fixture.board2, title: "API other" })), 201)).space;
    assert.equal((await result(await spaces.POST(req(users.owner,"POST",{boardId:fixture.personal,title:"Invalid"})),400)).code,"wiki_team_board_required");
    assert.ok((await result(await spaces.GET(req(users.viewer)))).spaces.some((s: { id: string }) => s.id === a.id));
    await result(await space.GET(req(users.viewer),ctx({spaceId:a.id})));
    const created = (await result(await spacePages.POST(req(users.editor,"POST",{title:"Start",content:helper.content("First")}),ctx({spaceId:a.id})),201)).note;
    const nctx = {params:Promise.resolve({noteId:created.id})};
    const first = (await result(await versions.GET(req(users.viewer),nctx))).versions[0];
    const vctx = ctx({noteId:created.id,versionId:first.id});
    await result(await version.GET(req(users.viewer),vctx));
    await result(await page.GET(req(users.viewer),nctx));
    assert.equal((await result(await pages.GET(req(users.viewer,"GET",undefined,`?spaceId=${a.id}&q=First`)))).pages.length,1);
    await result(await spacePages.GET(req(users.viewer),ctx({spaceId:a.id})));
    await result(await space.PATCH(req(users.owner,"PATCH",{homeNoteId:created.id}),ctx({spaceId:a.id})));
    const edited = (await result(await note.PATCH(req(users.editor,"PATCH",{title:"Changed",expectedVersion:created.contentVersion}),nctx))).note;
    const conflict = await result(await restoreVersion.POST(req(users.editor,"POST",{expectedVersion:created.contentVersion}),vctx),409);
    assert.equal(conflict.code,"note_conflict"); assert.equal(conflict.currentVersion,edited.contentVersion);
    const restored = (await result(await restoreVersion.POST(req(users.editor,"POST",{expectedVersion:edited.contentVersion}),vctx))).note;
    assert.equal(restored.title,"Start"); assert.equal(restored.contentVersion,edited.contentVersion+1);
    const copied = (await result(await copy.POST(req(users.viewer,"POST",{expectedVersion:restored.contentVersion}),nctx),201)).note;
    assert.equal(copied.wiki,undefined); assert.equal(copied.home.kind,"personal");
    for (const body of [{home:null},{notebookId:null},{home:{kind:"personal"}}]) {
      const denied = await result(await note.PATCH(req(users.editor,"PATCH",{title:"Must roll back",expectedVersion:restored.contentVersion,...body}),nctx),409);
      assert.equal(denied.code,"wiki_home_change_forbidden");
    }
    const still = (await result(await page.GET(req(users.viewer),nctx))).note; assert.equal(still.title,"Start"); assert.equal(still.contentVersion,restored.contentVersion);
    const uploadRequest = (actor: TaskboardUserIdentity) => {
      const request = req(actor,"POST"); const form = new FormData(); form.append("files",new File(["Hello"],"api.txt",{type:"text/plain"}));
      return new NextRequest(request.url,{method:"POST",headers:request.headers,body:form});
    };
    const uploaded = await result(await upload.POST(uploadRequest(users.editor),nctx));
    assert.deepEqual(Object.keys(uploaded).sort(),["attachments","ok"]);
    const file = uploaded.attachments[0]; const fctx={params:Promise.resolve({noteId:created.id,attachmentId:file.id})};
    await result(await attachment.DELETE(req(users.editor,"DELETE"),fctx));
    assert.equal((await result(await page.GET(req(users.viewer),nctx))).note.contentVersion,restored.contentVersion);
    assert.equal((await attachment.GET(req(users.viewer),fctx)).status,200);
    await result(await attachment.DELETE(req(users.editor,"DELETE",undefined,"?permanent=1"),fctx),403);
    await result(await attachment.DELETE(req(users.owner,"DELETE",undefined,"?permanent=1"),fctx));
    const concealed=await result(await page.GET(req(users.outsider),nctx),404); assert.equal(concealed.code,"wiki_not_found");
    await result(await version.GET(req(users.viewer),ctx({noteId:created.id,versionId:randomUUID()})),404);
    await result(await move.POST(req(users.editor,"POST",{spaceId:b.id,sourceSpaceId:b.id,expectedVersion:restored.contentVersion}),nctx),409);
    const moved=(await result(await move.POST(req(users.editor,"POST",{spaceId:b.id,sourceSpaceId:a.id,expectedVersion:restored.contentVersion}),nctx))).note;
    assert.equal(moved.ownerUserId,created.ownerUserId); assert.equal(moved.contentVersion,restored.contentVersion);
    const ordinary=(await result(await notes.POST(req(users.editor,"POST",{boardId:fixture.board,title:"Promote"})))).note;
    await result(await add.POST(req(users.editor,"POST",{spaceId:a.id,expectedVersion:ordinary.contentVersion}),{params:Promise.resolve({noteId:ordinary.id})}));
    const filtered=await notes.GET(req(users.viewer,"GET",undefined,`?wikiSpaceId=${a.id}`));
    assert.equal(filtered.headers.get("cache-control"),"private, no-store");
    assert.ok((await result(filtered)).notes.every((n:{wiki?:{spaceId:string}})=>n.wiki?.spaceId===a.id));
    await result(await space.PATCH(req(users.owner,"PATCH",{archived:true}),ctx({spaceId:b.id})));
    for (const run of [
      () => note.PATCH(req(users.editor,"PATCH",{pinned:true}),nctx),
      () => note.DELETE(req(users.owner,"DELETE"),nctx),
      () => restore.POST(req(users.owner,"POST"),nctx),
      () => upload.POST(uploadRequest(users.owner),nctx),
      () => link.POST(req(users.owner,"POST",{taskId:randomUUID()}),nctx),
      () => unlink.DELETE(req(users.owner,"DELETE"),{params:Promise.resolve({noteId:created.id,taskId:randomUUID()})}),
      () => convert.POST(req(users.owner,"POST",{boardId:fixture.board}),nctx),
    ]) assert.equal((await result(await run(),403)).code,"wiki_read_only");
    await result(await copy.POST(req(users.viewer,"POST",{expectedVersion:moved.contentVersion}),nctx),201);
    await result(await space.PATCH(req(users.owner,"PATCH",{archived:false}),ctx({spaceId:b.id})));
    await result(await note.DELETE(req(users.editor,"DELETE"),nctx));
    await result(await note.DELETE(req(users.editor,"DELETE",undefined,"?permanent=1"),nctx),403);
    await result(await restore.POST(req(users.editor,"POST"),nctx));
    await result(await note.DELETE(req(users.owner,"DELETE"),nctx));
    await result(await note.DELETE(req(users.owner,"DELETE",undefined,"?permanent=1"),nctx));
    await result(await space.DELETE(req(users.owner,"DELETE"),ctx({spaceId:b.id})));
  } finally {
    if (previousAuth === undefined) delete process.env.TASKBOARD_AUTH_MODE; else process.env.TASKBOARD_AUTH_MODE=previousAuth;
    await fixture.cleanup();
  }
});
