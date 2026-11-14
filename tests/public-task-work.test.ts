import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { parseSharedWorkRequest, readBoundedWorkBody, SharedWorkError } from "../src/lib/public-task-work-request";

const request = (change: unknown) => ({ mutationId: randomUUID(), editRevision: "a".repeat(64), change });
test("shared work requests admit only explicit work fields and bounded text", () => {
  const id = randomUUID();
  assert.deepEqual(parseSharedWorkRequest(request({ type: "subtask.update", taskId: id, patch: { title: "  New title  ", status: "done", allDay: false } })).change, { type: "subtask.update", taskId: id, patch: { title: "New title", status: "done", allDay: false } });
  for (const change of [
    { type: "subtask.remove", taskId: id },
    { type: "subtask.update", taskId: id, patch: { boardId: id } },
    { type: "subtask.update", taskId: id, patch: { summary: "Hidden details" } },
    { type: "subtask.update", taskId: id, patch: { status: "admin" } },
    { type: "subtask.update", taskId: id, patch: { startAt: "not a date" } },
    { type: "subtask.update", taskId: id, patch: { allDay: "false" } },
    { type: "subtask.add", parentTaskId: id, title: " " },
    { type: "subtask.move", taskId: id, parentTaskId: id, targetIndex: -1 },
    { type: "checklist.update", itemId: id, done: "true" },
    { type: "note.add", body: "x".repeat(65537) },
    { type: "note.add", body: "😀".repeat(17000) },
    { type: "note.update", noteId: id, body: "Note", userId: id },
    { type: "file.upload" },
  ]) assert.throws(() => parseSharedWorkRequest(request(change)), SharedWorkError);
  assert.throws(() => parseSharedWorkRequest({ ...request({ type: "note.add", body: "Hi" }), boardId: id }), SharedWorkError);
  assert.throws(() => parseSharedWorkRequest({ ...request({ type: "note.add", body: "Hi" }), mutationId: "invalid" }), SharedWorkError);
});
test("shared JSON body limits apply without trusting Content-Length", async () => {
  const valid = request({ type: "note.add", body: "A working note." });
  assert.deepEqual(await readBoundedWorkBody(new Request("http://localhost/", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(valid) })), valid);
  await assert.rejects(readBoundedWorkBody(new Request("http://localhost/", { method: "POST", headers: { "Content-Type": "text/plain" }, body: "{}" })), (error: unknown) => error instanceof SharedWorkError && error.status === 415);
  await assert.rejects(readBoundedWorkBody(new Request("http://localhost/", { method: "POST", headers: { "Content-Type": "application/json" }, body: "x".repeat(100000) })), (error: unknown) => error instanceof SharedWorkError && error.status === 413);
  await assert.rejects(readBoundedWorkBody(new Request("http://localhost/", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{" })), SharedWorkError);
});
