import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, open } from "node:fs/promises";
import path from "node:path";

export type PlannedFile = { source: string; destination: string; sha256: string };
type Effects = { operationId: string; at: string; preview: boolean; counter: number; files: PlannedFile[]; approvedFiles?: PlannedFile[] };
const current = new AsyncLocalStorage<Effects>();
export async function withMutationEffects<T>(operationId: string, at: string, preview: boolean,
  run: () => Promise<T>, approvedFiles?: PlannedFile[]) {
  const state: Effects = { operationId, at, preview, counter: 0, files: [], approvedFiles };
  const result = await current.run(state, run);
  return { result, files: state.files };
}
// Only record identifiers use this function. Credentials and public tokens must
// continue to use cryptographically random values, including inside a batch.
export function mutationUUID() {
  const state = current.getStore();
  if (!state) return randomUUID();
  const bytes = createHash("sha256").update(`${state.operationId}:${state.counter++}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 0x50;
  bytes[8] = (bytes[8] & 63) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function mutationDate() { return new Date(current.getStore()?.at ?? Date.now()); }
export function inMutationBatch() { return current.getStore() !== undefined; }
export function mutationAttachmentPath(key: string) {
  if (key.startsWith("note:")) {
    const legacy=key.slice(5);
    if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(legacy)) throw new Error("Invalid Note attachment path.");
    return path.join(process.cwd(),"uploads","note-attachments",legacy);
  }
  if (!/^[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/.test(key)) throw new Error("Invalid attachment destination.");
  return path.join(process.cwd(),"uploads","task-attachments",key);
}
export async function writeDurableAttachment(filePath:string,content:Uint8Array) {
  await mkdir(path.dirname(filePath),{recursive:true});
  const file=await open(filePath,"w",0o600);
  try{await file.writeFile(content);await file.sync();}finally{await file.close();}
  if(process.platform!=="win32") {
    const directory=await open(path.dirname(filePath),"r");
    try{await directory.sync();}finally{await directory.close();}
  }
}
export async function writeMutationAttachment(content:Buffer,destination:string,source:string) {
  const state=current.getStore();
  const intent={source,destination,sha256:createHash("sha256").update(content).digest("hex")};
  const diskPath=mutationAttachmentPath(destination);
  if (state) {
    if (!state.preview && !state.approvedFiles?.some(f=>f.source===source && f.destination===destination && f.sha256===intent.sha256)) throw new Error("Attachment bytes changed since the preview. Prepare again.");
    state.files.push(intent);
    if (state.preview) return;
  }
  await writeDurableAttachment(diskPath,content);
}
// Removal only detaches metadata during a batch. Keep bytes for journal undo.
export async function guardMutationAttachment(key:string,expectedSha256?:string) {
  const state=current.getStore();
  if (!state) return;
  const content=await readFile(mutationAttachmentPath(key));
  const intent={source:key,destination:key,sha256:createHash("sha256").update(content).digest("hex")};
  if(expectedSha256 && intent.sha256!==expectedSha256)throw new Error("Attachment bytes no longer match this batch. No changes were undone.");
  if (!state.preview && !state.approvedFiles?.some(f=>f.source===key && f.destination===key && f.sha256===intent.sha256)) throw new Error("Attachment bytes changed since the preview.");
  state.files.push(intent);
}
export async function copyRecurringAttachment(source: string, destination: string,
  nativePath: (key: string) => string) {
  const state = current.getStore();
  const content = await readFile(nativePath(source));
  const intent = { source, destination, sha256: createHash("sha256").update(content).digest("hex") };
  if (state) {
    mutationAttachmentPath(destination);
    if (!state.preview && !state.approvedFiles?.some(f => f.source === source && f.destination === destination && f.sha256 === intent.sha256)) {
      throw new Error("Recurring attachments changed since the preview. Prepare again.");
    }
    state.files.push(intent);
    if (state.preview) return;
  }
  const diskPath = nativePath(destination);
  await writeDurableAttachment(diskPath,content);
}
