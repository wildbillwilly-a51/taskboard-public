// Materialize checkpoint + API-owned overlays outside the working checkout.
// Fixture modules are written ONLY into that scratch tree.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { cp, mkdir, mkdtemp, writeFile, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

async function main() {
const checkpoint = "ac2c7c23759b46a0e51d14af5055e6a16eb1c300";
const source = path.resolve(process.cwd());
const scratch = await mkdtemp(path.join(tmpdir(), "taskboard-wiki-p1-api-"));
assert.ok(!scratch.startsWith(source + path.sep), "Sandbox must be external.");
console.log(`Scratch: ${scratch}`);
console.log("FAKE BOUNDARIES: wiki/Notes stores, identity resolution, persistence availability. Real shared contracts, NextRequest/NextResponse, route wrappers. No DB requests.");
const archive = path.join(scratch, "checkpoint.tar");
execFileSync("git", ["archive", "--format=tar", "-o", archive, checkpoint], { cwd: source });
execFileSync("tar", ["-xf", "checkpoint.tar"], { cwd: scratch });
const overlays = [
  "src/app/api/wiki", "src/lib/wiki-route.ts", "src/lib/wiki-api-handlers.ts", "src/lib/notes-route.ts",
  "src/app/api/notes/route.ts", "src/app/api/notes/[noteId]/route.ts", "src/app/api/notes/[noteId]/attachments/[attachmentId]/route.ts",
  "tests/wiki-api.test.ts", "tests/wiki-api-db.test.ts", "tests/helpers/wiki-api-stub.ts", "tests/helpers/wiki-api-sandbox.ts", "tests/fixtures/wiki-api",
];
for (const file of overlays) {
  if (!existsSync(path.join(source, file))) continue;
  await mkdir(path.dirname(path.join(scratch, file)), { recursive: true });
  await cp(path.join(source, file), path.join(scratch, file), { recursive: true });
}
const npmCli = path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
assert.ok(existsSync(npmCli), "npm CLI must already be installed next to Node.");
async function run(args: string[], environment: Partial<NodeJS.ProcessEnv> = {}) {
  console.log(`RUN node ${args.join(" ")}`);
  const child = spawn(process.execPath, args, { cwd: scratch, env: { ...process.env, DATABASE_URL: "", WIKI_DB_TEST: "", ...environment }, stdio: "inherit", windowsHide: true });
  const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  console.log(`RESULT ${code}`); assert.equal(code, 0);
}
await run([npmCli, "ci", "--no-audit", "--no-fund"]);
// Bind methods explicitly; destructuring a stateful fake loses its receiver.
const wikiMethods = ["listWikiSpaces", "createWikiSpace", "getWikiSpace", "updateWikiSpace", "removeWikiSpace", "listWikiPages", "createWikiPage", "getWikiPage", "promoteNoteToWiki", "moveWikiPage", "copyWikiPageToPersonal", "listWikiVersions", "getWikiVersion", "restoreWikiVersion"];
await writeFile(path.join(scratch,"src/lib/wiki-store.ts"), 'import { sandboxStore } from "../../tests/helpers/wiki-api-stub";\n' + wikiMethods.map(name => `export const ${name} = sandboxStore.${name}.bind(sandboxStore);`).join("\n"));
const notesMethods = ["listNotes", "createNote", "getNote", "updateNote", "trashNote", "restoreNote", "deleteNotePermanently", "deleteNoteAttachment", "getNoteAttachmentDownload", "uploadNoteAttachments", "linkNoteToTask", "unlinkNoteFromTask", "convertNoteToTask"];
await rename(path.join(scratch,"src/lib/notes-store.ts"),path.join(scratch,"src/lib/notes-store-real.ts"));
let noteFixture = 'export * from "./notes-store-real";\nimport * as real from "./notes-store-real";\nimport { sandboxStore } from "../../tests/helpers/wiki-api-stub";\n';
for (const name of notesMethods) {
  const tuple = name === "deleteNoteAttachment" ? '[...Parameters<typeof real.deleteNoteAttachment>, { permanent?: boolean }?]' : `Parameters<typeof real.${name}>`;
  const arity = ["updateNote","getNoteAttachmentDownload","deleteNoteAttachment"].includes(name) ? 3 : 2;
  const args = Array.from({length:arity}, (_,i) => `args[${i}]`).join(", ") + (name === "deleteNoteAttachment" ? ', args[3]' : '');
  noteFixture += `export const ${name} = async (...args: ${tuple}) => sandboxStore.${name}(${args});\n`;
}
await writeFile(path.join(scratch,"src/lib/notes-store.ts"),noteFixture);
await rename(path.join(scratch,"src/lib/taskboard-request.ts"),path.join(scratch,"src/lib/taskboard-request-real.ts"));
await writeFile(path.join(scratch,"src/lib/taskboard-request.ts"),`export * from "./taskboard-request-real";
import type * as real from "./taskboard-request-real";
import { fakeIdentity, type FakeRole } from "../../tests/helpers/wiki-api-stub";
export async function requireTaskboardUserFromHeaders(request: Parameters<typeof real.requireTaskboardUserFromHeaders>[0]) {
  const role = request.headers.get("x-wiki-fixture-role") ?? "manager";
  if (!["manager","editor","viewer","outsider"].includes(role)) throw Error("Unexpected fixture identity");
  return fakeIdentity(role as FakeRole);
}
`);
await rename(path.join(scratch,"src/lib/db.ts"),path.join(scratch,"src/lib/db-real.ts"));
await writeFile(path.join(scratch,"src/lib/db.ts"),'export * from "./db-real";\nexport function isDatabaseConfigured() { return true; }\n');
await run(["--import","tsx","--test","tests/wiki-api.test.ts"]);
await run(["--conditions","react-server","--import","tsx","--test","tests/fixtures/wiki-api/routes.test.ts"],{WIKI_API_SANDBOX:"1"});
await run(["node_modules/typescript/bin/tsc","--noEmit","--incremental","false"]);
const result = { checkpoint, source, scratch, fixtureOnly: true, completedAt: new Date().toISOString() };
await writeFile(path.join(scratch,"SANDBOX-RESULT.json"),JSON.stringify(result,null,2));
console.log(`PASS fixture-only. Result: ${path.join(scratch,"SANDBOX-RESULT.json")}`);
console.log(`Cleanup: remove the external scratch directory ${scratch} after inspecting the evidence. No containers were created.`);
}

main().catch(error => { console.error(error); process.exitCode = 1; });
