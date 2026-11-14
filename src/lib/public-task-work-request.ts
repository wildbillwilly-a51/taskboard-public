import type { SharedWorkChange, SharedWorkPatch, SharedWorkRequest } from "./public-task-share-model";
import { isUuid } from "./uuid";

export class SharedWorkError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
function object(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key))) throw new SharedWorkError("Invalid work change.");
  return value as Record<string, unknown>;
}
function id(value: unknown) {
  if (typeof value !== "string" || !isUuid(value)) throw new SharedWorkError("Invalid work item.");
  return value;
}
function text(value: unknown, body = false) {
  if (typeof value !== "string" || !value.trim() || (body ? new TextEncoder().encode(value).length > 65536 : value.trim().length > 1000)) throw new SharedWorkError(body ? "Use between 1 and 65,536 bytes of note text." : "Use a name of 1 to 1,000 characters.");
  return value.trim();
}
function date(value: unknown) {
  if (value === null) return null;
  if (typeof value !== "string" || value.length > 40 || !/^\d{4}-\d{2}-\d{2}T/.test(value) || !Number.isFinite(Date.parse(value))) throw new SharedWorkError("Choose a valid date and time.");
  return new Date(value).toISOString();
}
export function parseSharedWorkRequest(value: unknown): SharedWorkRequest {
  const request = object(value, ["mutationId", "editRevision", "change"]);
  if (typeof request.editRevision !== "string" || !/^[a-f0-9]{64}$/.test(request.editRevision)) throw new SharedWorkError("Refresh the workspace before editing.", 409);
  const raw = object(request.change, ["type", "taskId", "parentTaskId", "patch", "targetIndex", "itemId", "label", "done", "noteId", "body", "title"]);
  let change: SharedWorkChange;
  switch (raw.type) {
    case "subtask.update": {
      object(raw, ["type", "taskId", "patch"]);
      const input = object(raw.patch, ["title", "status", "startAt", "endAt", "allDay"]), patch: SharedWorkPatch = {};
      if (!Object.keys(input).length) throw new SharedWorkError("Choose a field to change.");
      if ("title" in input) patch.title = text(input.title);
      if ("status" in input) {
        if (!["todo", "done"].includes(String(input.status))) throw new SharedWorkError("A subtask is either done or not done.");
        patch.status = input.status as SharedWorkPatch["status"];
      }
      if ("startAt" in input) patch.startAt = date(input.startAt);
      if ("endAt" in input) patch.endAt = date(input.endAt);
      if ("allDay" in input) {
        if (typeof input.allDay !== "boolean") throw new SharedWorkError("Invalid all-day setting.");
        patch.allDay = input.allDay;
      }
      change = { type: raw.type, taskId: id(raw.taskId), patch }; break;
    }
    case "subtask.add":
      object(raw, ["type", "parentTaskId", "title"]);
      change = { type: raw.type, parentTaskId: id(raw.parentTaskId), title: text(raw.title) }; break;
    case "subtask.move":
      object(raw, ["type", "taskId", "parentTaskId", "targetIndex"]);
      if (!Number.isInteger(raw.targetIndex) || Number(raw.targetIndex) < 0 || Number(raw.targetIndex) > 5000) throw new SharedWorkError("Invalid task position.");
      change = { type: raw.type, taskId: id(raw.taskId), parentTaskId: id(raw.parentTaskId), targetIndex: Number(raw.targetIndex) }; break;
    case "checklist.add":
      object(raw, ["type", "label"]); change = { type: raw.type, label: text(raw.label) }; break;
    case "checklist.update":
      object(raw, ["type", "itemId", "label", "done"]);
      if (!("label" in raw) && !("done" in raw) || "done" in raw && typeof raw.done !== "boolean") throw new SharedWorkError("Invalid checklist change.");
      change = { type: raw.type, itemId: id(raw.itemId), ...("label" in raw ? { label: text(raw.label) } : {}), ...("done" in raw ? { done: raw.done as boolean } : {}) }; break;
    case "checklist.remove":
      object(raw, ["type", "itemId"]); change = { type: raw.type, itemId: id(raw.itemId) }; break;
    case "note.add":
      object(raw, ["type", "body"]); change = { type: raw.type, body: text(raw.body, true) }; break;
    case "note.update":
      object(raw, ["type", "noteId", "body"]); change = { type: raw.type, noteId: id(raw.noteId), body: text(raw.body, true) }; break;
    case "note.remove":
      object(raw, ["type", "noteId"]); change = { type: raw.type, noteId: id(raw.noteId) }; break;
    default: throw new SharedWorkError("This link can change subtasks, checklists and working notes only.");
  }
  return { mutationId: id(request.mutationId), editRevision: request.editRevision, change };
}

export async function readBoundedWorkBody(request: Request) {
  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") throw new SharedWorkError("Send a JSON work change.", 415);
  if (Number(request.headers.get("content-length") || 0) > 98304) throw new SharedWorkError("This change is too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new SharedWorkError("A work change is required.");
  let length = 0;
  const chunks: Uint8Array[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { void reader.cancel(); reject(new SharedWorkError("The request timed out.", 408)); }, 5000); });
    const body = (async () => {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 98304) { void reader.cancel(); throw new SharedWorkError("This change is too large.", 413); }
        chunks.push(value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      try { return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)); }
      catch { throw new SharedWorkError("Invalid JSON work change."); }
    })();
    return await Promise.race([body, timeout]);
  } finally { if (timer) clearTimeout(timer); reader.releaseLock(); }
}
