import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream, existsSync } from "node:fs";
import { createServer } from "node:net";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { TaskboardUserIdentity } from "@/lib/taskboard-request";
export async function verifyDiscoveryHttp(users: Record<"owner" | "editor" | "viewer", TaskboardUserIdentity>, spaceId: string) {
  const port = Number(process.env.WIKI_P2_HTTP_PORT || 33572), origin = `http://127.0.0.1:${port}`;
  assert.ok(Number.isInteger(port) && port >= 1024 && port <= 65535, "Use a valid isolated HTTP port.");
  assert.ok(existsSync(".next/BUILD_ID"), "Build this worktree before the real HTTP suite.");
  const probe = createServer();
  await new Promise<void>((resolve,reject)=>{probe.once("error",reject);probe.listen(port,"127.0.0.1",resolve);});
  await new Promise<void>((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
  const log = createWriteStream(path.join(process.env.WIKI_P2_SANDBOX_ROOT!,`http-${Date.now()}.log`));
  const server = spawn(process.execPath,["node_modules/next/dist/bin/next","start","--hostname","127.0.0.1","--port",String(port)],{env:process.env,stdio:["ignore","pipe","pipe"]});
  server.stdout.pipe(log,{end:false});server.stderr.pipe(log,{end:false});
  const exited = new Promise<void>(resolve=>server.once("exit",()=>resolve()));
  let requests = 0;
  const request = async (actor: keyof typeof users, url: string, method="GET", body?:unknown, expected=200) => {
    const u=users[actor]; requests++;
    const response=await fetch(origin+url,{method,redirect:"manual",signal:AbortSignal.timeout(15000),headers:{"Remote-Email":u.email,"Remote-Name":u.displayName,"Remote-User":u.username??u.email,"Content-Type":"application/json"},...(body===undefined?{}:{body:JSON.stringify(body)})});
    assert.equal(response.status,expected,await response.clone().text());assert.equal(response.headers.get("cache-control"),"private, no-store");return response.json();
  };
  try {
    const deadline=Date.now()+30000;
    while(true){
      assert.equal(server.exitCode,null,"Fixture HTTP server exited early.");
      const ready=await fetch(origin+"/api/health",{signal:AbortSignal.timeout(1000)}).then(r=>r.ok,()=>false);
      if(ready)break;assert.ok(Date.now()<deadline,"HTTP fixture startup timed out.");await delay(100);
    }
    const base=`/api/wiki/spaces/${spaceId}/topics`, tree=await request("viewer",base);
    const made=await request("owner",base,"POST",{title:"HTTP topic",expectedTopicsVersion:tree.topicsVersion},201);
    const topic=await request("owner",`${base}/${made.topic.id}`,"PATCH",{title:"HTTP renamed",expectedTopicsVersion:made.topicsVersion});
    const body={formatVersion:2,blocks:[{type:"paragraph",content:[{type:"text",text:"network needle"}]}],markdown:"network needle",text:"network needle"};
    const {note}=await request("editor",`/api/wiki/spaces/${spaceId}/pages`,"POST",{title:"HTTP page",content:body},201);
    await request("editor",`/api/wiki/pages/${note.id}/topics`,"PUT",{sourceSpaceId:spaceId,expectedTopicIds:[],topicIds:[made.topic.id]});
    assert.equal((await request("viewer",`/api/wiki/pages/${note.id}/topics`)).topics.length,1);
    assert.equal((await request("viewer",`/api/wiki/search?q=needle&spaceId=${spaceId}&topicId=${made.topic.id}`)).pages[0].id,note.id);
    assert.equal((await request("viewer","/api/wiki/mentions/resolve","POST",{noteIds:[note.id]})).mentions[0].state,"readable");
    assert.deepEqual((await request("viewer",`/api/wiki/pages/${note.id}/backlinks`)).pages,[]);
    await request("editor",`/api/notes/${note.id}`,"PATCH",{content:{...body,formatVersion:undefined},expectedVersion:1},409);
    await request("editor",`/api/notes/${note.id}`,"PATCH",{content:body,expectedVersion:1});
    await request("owner",`${base}/${made.topic.id}`,"DELETE",{expectedTopicsVersion:topic.topicsVersion});
    console.log(JSON.stringify({realNextHttp:true,origin,requests,allNewOperations:true,notesFormatGuard:true}));
  } finally {server.kill();await Promise.race([exited,delay(10000).then(()=>{throw new Error("HTTP fixture did not stop.");})]);log.end();}
}
