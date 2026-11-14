import assert from "node:assert/strict";
import test from "node:test";
import { canDeleteFolioSpace, createFolioBranchLoader, folioBoardDescriptor, folioConnectionLabel, toggleFolioExpanded } from "../src/lib/folio-navigation";
import type { FolioSpace } from "../src/lib/folio-model";
const base = { id:"space",kind:"board",title:"IT Operations",parentId:null,ownerUserId:null,boardId:"board",taskId:null,root:false,archived:false,pageNoteId:null,canManage:false } satisfies FolioSpace;

test("space deletion is distinct from legacy edit capability and excludes protected targets", () => {
  assert.equal(canDeleteFolioSpace({...base,kind:"personal",canDelete:true}),true);
  assert.equal(canDeleteFolioSpace({...base,kind:"shared",canDelete:true}),true);
  assert.equal(canDeleteFolioSpace({...base,kind:"shared",canManage:true}),true);
  assert.equal(canDeleteFolioSpace({...base,kind:"personal",canDelete:false}),false);
  for (const kind of ["personal","shared","board","task"] as const) {
    assert.equal(canDeleteFolioSpace({...base,kind,root:true,canDelete:true}),false);
  }
  assert.equal(canDeleteFolioSpace({...base,kind:"board",canDelete:true}),false);
  assert.equal(canDeleteFolioSpace({...base,kind:"task",canDelete:true}),false);
});
test("disclosure toggles only its branch and remains closed after unrelated changes", () => {
  assert.deepEqual(toggleFolioExpanded(["ancestor","target"], "target"), ["ancestor"]);
  assert.deepEqual(toggleFolioExpanded(["ancestor"], "target", false), ["ancestor"]);
  assert.deepEqual(toggleFolioExpanded(["ancestor","target"], "target", true), ["ancestor","target"]);
  assert.deepEqual(toggleFolioExpanded(["ancestor"], "target"), ["ancestor","target"]);
});
test("same-titled board targets retain identities and show their actual ownership", () => {
  assert.equal(folioBoardDescriptor({...base,boardType:"personal",boardOwnerUserId:"me"},"me"),"Your board");
  assert.equal(folioBoardDescriptor({...base,boardType:"team",boardOwnerTeamName:"IT"},"me"),"Team · IT");
  assert.equal(folioBoardDescriptor({...base,boardType:"personal",boardOwnerUserId:"other",boardOwnerDisplayName:"Alex"},"me"),"Shared by Alex");
  assert.equal(folioBoardDescriptor({...base,kind:"shared"},"me"),"");
  assert.equal(folioConnectionLabel({...base,kind:"task",title:"Maintenance",boardTitle:"IT Operations",boardType:"personal",boardOwnerUserId:"me"},"me"),"Maintenance — IT Operations · Your board");
  assert.equal(folioConnectionLabel({...base,kind:"task",title:"Maintenance",boardTitle:"IT Operations",boardType:"team",boardOwnerTeamName:"IT"},"me"),"Maintenance — IT Operations · Team · IT");
});

test("independent pending board loads both run, coalesce duplicates, and retry failures", async () => {
  const load = createFolioBranchLoader();
  let finishA!: () => void, finishB!: () => void;
  const starts: string[] = [];
  const a = load("A",async()=>{starts.push("A");await new Promise<void>(r=>finishA=r);});
  const b = load("B",async()=>{starts.push("B");await new Promise<void>(r=>finishB=r);});
  assert.equal(load("A",async()=>{throw Error("duplicate");}),a);
  await Promise.resolve();
  assert.deepEqual(starts,["A","B"]);
  finishB();await b;finishA();await a;
  await assert.rejects(load("A",async()=>{throw Error("network");}),/network/);
  let retried=false;await load("A",async()=>{retried=true;});assert.equal(retried,true);
});
