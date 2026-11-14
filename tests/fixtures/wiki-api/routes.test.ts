// Run only in the external sandbox with fixture store/identity bindings.
import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { sandboxStore as store, WikiApiStub, ids } from "../../helpers/wiki-api-stub";
import * as spaces from "@/app/api/wiki/spaces/route";
import * as space from "@/app/api/wiki/spaces/[spaceId]/route";
import * as spacePages from "@/app/api/wiki/spaces/[spaceId]/pages/route";
import * as pages from "@/app/api/wiki/pages/route";
import * as page from "@/app/api/wiki/pages/[noteId]/route";
import * as add from "@/app/api/wiki/pages/[noteId]/add/route";
import * as move from "@/app/api/wiki/pages/[noteId]/move/route";
import * as copy from "@/app/api/wiki/pages/[noteId]/copy/route";
import * as versions from "@/app/api/wiki/pages/[noteId]/versions/route";
import * as version from "@/app/api/wiki/pages/[noteId]/versions/[versionId]/route";
import * as restoreVersion from "@/app/api/wiki/pages/[noteId]/versions/[versionId]/restore/route";
import * as notes from "@/app/api/notes/route";
import * as note from "@/app/api/notes/[noteId]/route";
import * as attachment from "@/app/api/notes/[noteId]/attachments/[attachmentId]/route";
import * as upload from "@/app/api/notes/[noteId]/attachments/route";
import * as restore from "@/app/api/notes/[noteId]/restore/route";
import * as link from "@/app/api/notes/[noteId]/links/route";
import * as unlink from "@/app/api/notes/[noteId]/links/[taskId]/route";
import * as convert from "@/app/api/notes/[noteId]/convert-to-task/route";

if (process.env.WIKI_API_SANDBOX !== "1") throw Error("Use wiki-api-sandbox.ts; these fixtures require external store bindings.");
const pageContext = { params: Promise.resolve({ noteId: ids.note }) };
const spaceContext = { params: Promise.resolve({ spaceId: ids.space }) };
const fileContext = { params: Promise.resolve({ noteId: ids.note, attachmentId: ids.attachment }) };
function request(method: string, body?: unknown, query = "", role = "manager") {
  return new NextRequest(`http://127.0.0.1:3232/api/notes${query}`, { method, headers: { "x-wiki-fixture-role": role }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
function reset() { Object.assign(store, new WikiApiStub()); }
async function status(response: Response, expected: number) { assert.equal(response.status, expected, await response.clone().text()); return response.json(); }

test("all production wiki wrappers bind to the intended store export", async () => {
  reset();
  for (const mod of [spaces,space,spacePages,pages,page,add,move,copy,versions,version,restoreVersion]) assert.equal(mod.runtime,"nodejs");
  const vctx = { params: Promise.resolve({ noteId: ids.note, versionId: ids.version }) };
  const cases: Array<[() => Promise<Response>, string]> = [
    [() => spaces.GET(request("GET")), "listWikiSpaces"],
    [() => spaces.POST(request("POST", { boardId: ids.task, title: "New" })), "createWikiSpace"],
    [() => space.GET(request("GET"), spaceContext), "getWikiSpace"],
    [() => space.PATCH(request("PATCH", { title: "Updated" }), spaceContext), "updateWikiSpace"],
    [() => space.DELETE(request("DELETE"), { params: Promise.resolve({ spaceId: ids.otherSpace }) }), "removeWikiSpace"],
    [() => spacePages.GET(request("GET"), spaceContext), "listWikiPages"],
    [() => spacePages.POST(request("POST", {}), spaceContext), "createWikiPage"],
    [() => pages.GET(request("GET")), "listWikiPages"],
    [() => page.GET(request("GET"), pageContext), "getWikiPage"],
    [() => add.POST(request("POST", { expectedVersion: 1, spaceId: ids.space }), pageContext), "promoteNoteToWiki"],
    [() => move.POST(request("POST", { expectedVersion: 1, spaceId: ids.otherSpace, sourceSpaceId: ids.space }), pageContext), "moveWikiPage"],
    [() => copy.POST(request("POST", { expectedVersion: 1 }), pageContext), "copyWikiPageToPersonal"],
    [() => versions.GET(request("GET"), pageContext), "listWikiVersions"],
    [() => version.GET(request("GET"), vctx), "getWikiVersion"],
    [() => restoreVersion.POST(request("POST", { expectedVersion: 1 }), vctx), "restoreWikiVersion"],
  ];
  for (const [run, name] of cases) {
    reset(); const response = await run();
    assert.ok(response.status < 500, await response.clone().text());
    assert.equal(response.headers.get("cache-control"), "private, no-store");
    assert.equal(store.calls[0].name, name);
  }
});

test("Notes GET forwards wiki filter and refuses incompatible filters before store access", async () => {
  reset();
  const response = await notes.GET(request("GET", undefined, `?wikiSpaceId=${ids.space}&scope=board&boardId=${ids.board}`));
  const result = await status(response, 200); assert.equal(result.notes[0].wiki.spaceId, ids.space);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal((store.calls[0].args[0] as { wikiSpaceId: string }).wikiSpaceId, ids.space);
  for (const query of [`?wikiSpaceId=bad`, `?wikiSpaceId=${ids.space}&scope=personal`, `?wikiSpaceId=${ids.space}&notebookId=inbox`, `?wikiSpaceId=${ids.space}&bucketId=${ids.task}`, `?wikiSpaceId=${ids.space}&wikiSpaceId=${ids.space}`, `?wikiSpaceId=${ids.space}&boardId=${ids.board}&boardId=${ids.task}`]) {
    reset(); await status(await notes.GET(request("GET", undefined, query)),400); assert.equal(store.calls.length,0);
  }
  await status(await notes.GET(request("GET", undefined, `?wikiSpaceId=${ids.space}&boardId=${ids.task}`)),400);
  await status(await notes.GET(request("GET", undefined, `?wikiSpaceId=${ids.space}`, "outsider")),404);
});

test("Notes POST/PATCH reject all home aliases rather than dropping a field", async () => {
  for (const key of ["wikiSpaceId","wiki_space_id","board_id","ownerUserId","owner_user_id","kind","contentFormatVersion","wiki"]) {
    for (const run of [() => notes.POST(request("POST", { title:"Keep",[key]:null })), () => note.PATCH(request("PATCH", { title:"Keep",expectedVersion:1,[key]:null }),pageContext)]) {
      reset(); const result = await status(await run(),400); assert.equal(result.code,"invalid_wiki_request"); assert.equal(store.calls.length,0);
    }
  }
  reset(); await status(await notes.POST(request("POST", { title:"Ordinary" })),200);
  for (const body of [{home:null},{home:{kind:"personal"}},{home:{kind:"board",boardId:ids.board}},{notebookId:null},{notebookId:ids.space}]) {
    reset(); const result = await status(await note.PATCH(request("PATCH",{ title:"Keep", expectedVersion:1, ...body }),pageContext),409);
    assert.equal(result.code,"wiki_home_change_forbidden"); assert.equal(store.notes.get(ids.note)!.title,"Welcome"); assert.equal(store.notes.get(ids.note)!.contentVersion,1);
    assert.deepEqual(store.calls[0].args[1],{ title:"Keep",expectedVersion:1,...body });
  }
  reset(); store.notes.get(ids.note)!.contentVersion=2;
  const conflict=await status(await note.PATCH(request("PATCH",{ title:"Stale",expectedVersion:1 }),pageContext),409); assert.equal(conflict.code,"note_conflict"); assert.equal(conflict.currentVersion,2);
});

test("attachment permanent option is explicit, manager guarded and never passed from GET", async () => {
  reset(); await status(await attachment.DELETE(request("DELETE"),fileContext),200);
  assert.deepEqual(store.calls[0].args[2],{permanent:false}); assert.equal(store.notes.get(ids.note)!.contentVersion,1);
  reset(); await status(await attachment.DELETE(request("DELETE",undefined,"?permanent=1"),fileContext),200);
  assert.deepEqual(store.calls[0].args[2],{permanent:true});
  reset(); await status(await attachment.DELETE(request("DELETE",undefined,"?permanent=1","editor"),fileContext),403);
  for (const value of ["0","true","1&permanent=1"]) { reset(); await status(await attachment.DELETE(request("DELETE",undefined,`?permanent=${value}`),fileContext),400); assert.equal(store.calls.length,0); }
  reset(); await status(await attachment.DELETE(request("DELETE"),fileContext),200); store.notes.get(ids.note)!.deletedAt="2026-11-03T12:00:00.000Z";
  const response=await attachment.GET(request("GET",undefined,"?permanent=1","viewer"),fileContext);
  assert.equal(response.status,200); assert.equal(await response.text(),"Hello"); assert.equal(response.headers.get("cache-control"),"private, no-store"); assert.equal(store.calls.at(-1)!.name,"getNoteAttachmentDownload");
});

test("Notes permanent page deletion and each unchanged write route still reach upgraded cores", async () => {
  reset(); store.notes.get(ids.note)!.deletedAt="2026-11-03T12:00:00.000Z";
  await status(await note.DELETE(request("DELETE",undefined,"?permanent=1","editor"),pageContext),403);
  await status(await note.DELETE(request("DELETE",undefined,"?permanent=1"),pageContext),200); assert.ok(!store.notes.has(ids.note));
  const uploadRequest = (role: string) => {
    const form=new FormData(); form.append("files",new File(["Hello"],"guide.txt",{type:"text/plain"}));
    return new NextRequest("http://127.0.0.1:3232/api/notes",{method:"POST",headers:{"x-wiki-fixture-role":role},body:form});
  };
  const mutations=[
    (role:string)=>note.DELETE(request("DELETE",undefined,"",role),pageContext),
    (role:string)=>restore.POST(request("POST",undefined,"",role),pageContext),
    (role:string)=>upload.POST(uploadRequest(role),pageContext),
    (role:string)=>link.POST(request("POST",{taskId:ids.task},"",role),pageContext),
    (role:string)=>unlink.DELETE(request("DELETE",undefined,"",role),{params:Promise.resolve({noteId:ids.note,taskId:ids.task})}),
    (role:string)=>convert.POST(request("POST",{boardId:ids.board},"",role),pageContext),
  ];
  for (const run of mutations) {
    reset(); await status(await run("viewer"),403);
    reset(); store.spaces.get(ids.space)!.archivedAt="2026-11-03T12:00:00.000Z"; await status(await run("manager"),403);
    reset(); await status(await run("manager"),200);
  }
  reset(); const uploaded=await status(await upload.POST(uploadRequest("manager"),pageContext),200);
  assert.deepEqual(Object.keys(uploaded).sort(),["attachments","ok"]); assert.equal(store.notes.get(ids.note)!.contentVersion,1);
});
