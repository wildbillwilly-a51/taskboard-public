import assert from "node:assert/strict";
import test from "node:test";

import { createTaskSaveQueue } from "../src/lib/task-save-queue";

type Patch = Record<string, unknown>;
const DRAFT = { kind: "draft", source: "editor" } as const;
const ACTION = { kind: "action", source: "menu" } as const;

// A save that waits until the test releases it, recording what was sent.
function controlledSave(results: boolean[] = []) {
  const sent: Array<{ taskId: string; patch: Patch }> = [];
  const releases: Array<() => void> = [];
  let inFlight = 0;
  let maxInFlight = 0;
  const save = (taskId: string, patch: Patch) =>
    new Promise<boolean>((resolve, reject) => {
      sent.push({ taskId, patch });
      inFlight += 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      const result = results.shift();
      releases.push(() => {
        inFlight -= 1;
        if (result === undefined) resolve(true);
        else if (result) resolve(true);
        else reject(new Error("save failed"));
      });
    });
  const releaseNext = async () => {
    releases.shift()?.();
    await new Promise((resolve) => setTimeout(resolve, 0));
  };
  return { save, sent, releaseNext, maxInFlight: () => maxInFlight };
}

test("requests for one task run one at a time, in order", async () => {
  const io = controlledSave();
  const queue = createTaskSaveQueue<Patch>();
  const first = queue.enqueue("a", { status: "done" }, { ...ACTION, save: (patch) => io.save("a", patch) });
  const second = queue.enqueue("a", { status: "active" }, { ...ACTION, save: (patch) => io.save("a", patch) });
  assert.deepEqual(io.sent, [{ taskId: "a", patch: { status: "done" } }]);
  await io.releaseNext();
  assert.deepEqual((await first), { saved: true, patch: { status: "done" } });
  assert.deepEqual(io.sent.at(-1), { taskId: "a", patch: { status: "active" } });
  await io.releaseNext();
  assert.equal((await second).saved, true);
  assert.equal(io.maxInFlight(), 1);
});

test("the first request is sent at once, so a flushed draft goes before the action", () => {
  const io = controlledSave();
  const queue = createTaskSaveQueue<Patch>();
  void queue.enqueue("a", { title: "Typed" }, { ...DRAFT, save: (patch) => io.save("a", patch) });
  void queue.enqueue("a", { status: "done" }, { ...ACTION, save: (patch) => io.save("a", patch) });
  assert.deepEqual(io.sent, [{ taskId: "a", patch: { title: "Typed" } }]);
});

test("waiting drafts merge; actions never do", async () => {
  const io = controlledSave();
  const queue = createTaskSaveQueue<Patch>();
  void queue.enqueue("a", { title: "One" }, { ...DRAFT, save: (patch) => io.save("a", patch) });
  const second = queue.enqueue("a", { title: "Two" }, { ...DRAFT, save: (patch) => io.save("a", patch) });
  const third = queue.enqueue("a", { summary: "Body" }, { ...DRAFT, save: (patch) => io.save("a", patch) });
  const action = queue.enqueue("a", { status: "done" }, { ...ACTION, save: (patch) => io.save("a", patch) });
  const afterAction = queue.enqueue("a", { title: "Three" }, { ...DRAFT, save: (patch) => io.save("a", patch) });
  await io.releaseNext();
  assert.deepEqual(io.sent.at(-1)?.patch, { title: "Two", summary: "Body" });
  // Both merged callers learn the outcome of the one request.
  await io.releaseNext();
  assert.deepEqual(await second, await third);
  assert.deepEqual(io.sent.at(-1)?.patch, { status: "done" });
  await io.releaseNext();
  assert.equal((await action).saved, true);
  assert.deepEqual(io.sent.at(-1)?.patch, { title: "Three" });
  await io.releaseNext();
  assert.equal((await afterAction).saved, true);
});

test("a failure is reported to its own caller and the queue continues", async () => {
  const io = controlledSave([false, true]);
  const queue = createTaskSaveQueue<Patch>();
  const failing = queue.enqueue("a", { status: "done" }, { ...ACTION, save: (patch) => io.save("a", patch) });
  const next = queue.enqueue("a", { status: "active" }, { ...ACTION, save: (patch) => io.save("a", patch) });
  const originalError = console.error;
  console.error = () => {};
  try {
    await io.releaseNext();
  } finally {
    console.error = originalError;
  }
  assert.equal((await failing).saved, false);
  await io.releaseNext();
  assert.equal((await next).saved, true);
});

test("tasks do not wait for each other", () => {
  const io = controlledSave();
  const queue = createTaskSaveQueue<Patch>();
  void queue.enqueue("a", { status: "done" }, { ...ACTION, save: (patch) => io.save("a", patch) });
  void queue.enqueue("b", { status: "done" }, { ...ACTION, save: (patch) => io.save("b", patch) });
  assert.deepEqual(io.sent.map((entry) => entry.taskId), ["a", "b"]);
});

test("pending changes are visible to subscribers until the queue is empty", async () => {
  const io = controlledSave();
  const queue = createTaskSaveQueue<Patch>();
  let notified = 0;
  const unsubscribe = queue.subscribe("a", () => { notified += 1; });
  assert.equal(queue.getPendingPatch("a"), null);
  void queue.enqueue("a", { status: "done" }, { ...ACTION, save: (patch) => io.save("a", patch) });
  void queue.enqueue("a", { title: "Later" }, { ...DRAFT, save: (patch) => io.save("a", patch) });
  const pending = queue.getPendingPatch("a");
  assert.deepEqual(pending, { status: "done", title: "Later" });
  // The same object is returned until something changes.
  assert.equal(queue.getPendingPatch("a"), pending);
  await io.releaseNext();
  assert.deepEqual(queue.getPendingPatch("a"), { title: "Later" });
  await io.releaseNext();
  assert.equal(queue.getPendingPatch("a"), null);
  assert.ok(notified >= 3);
  unsubscribe();
});

test("a custom merge combines waiting drafts", async () => {
  const io = controlledSave();
  const queue = createTaskSaveQueue<Patch>({
    merge: (previous, next) => ({ ...previous, ...next, list: [...((previous.list as unknown[]) ?? []), ...((next.list as unknown[]) ?? [])] }),
  });
  void queue.enqueue("a", { title: "Busy" }, { ...DRAFT, save: (patch) => io.save("a", patch) });
  void queue.enqueue("a", { list: [1] }, { ...DRAFT, save: (patch) => io.save("a", patch) });
  void queue.enqueue("a", { list: [2] }, { ...DRAFT, save: (patch) => io.save("a", patch) });
  await io.releaseNext();
  assert.deepEqual(io.sent.at(-1)?.patch, { list: [1, 2] });
});

test("an editor's pending choices exclude changes made elsewhere", async () => {
  const io = controlledSave();
  const queue = createTaskSaveQueue<Patch>();
  void queue.enqueue("a", { title: "Typed" }, { ...DRAFT, save: (patch) => io.save("a", patch) });
  void queue.enqueue("a", { status: "done" }, { ...ACTION, save: (patch) => io.save("a", patch) });
  // A draft after an action still merges only with drafts from its source.
  void queue.enqueue("a", { summary: "Body" }, { ...DRAFT, save: (patch) => io.save("a", patch) });
  assert.deepEqual(queue.getPendingPatch("a", "editor"), { title: "Typed", summary: "Body" });
  assert.deepEqual(queue.getPendingPatch("a", "menu"), { status: "done" });
  assert.deepEqual(queue.getPendingPatch("a"), { title: "Typed", status: "done", summary: "Body" });
  await io.releaseNext();
  await io.releaseNext();
  assert.equal(queue.getPendingPatch("a", "menu"), null);
  assert.deepEqual(queue.getPendingPatch("a", "editor"), { summary: "Body" });
  await io.releaseNext();
});

test("callers hear back after their entry stops counting as pending", async () => {
  const io = controlledSave();
  const queue = createTaskSaveQueue<Patch>();
  const result = queue.enqueue("a", { status: "done" }, { ...ACTION, save: (patch) => io.save("a", patch) }).then(() => queue.getPendingPatch("a"));
  await io.releaseNext();
  assert.equal(await result, null);
});

test("each entry is sent by the request it was queued with", async () => {
  const io = controlledSave();
  const queue = createTaskSaveQueue<Patch>();
  // A request queued on board A keeps board A even if board B is open later.
  void queue.enqueue("a", { status: "done" }, { ...ACTION, save: (patch) => io.save("a", { ...patch, board: "A" }) });
  void queue.enqueue("a", { status: "active" }, { ...ACTION, save: (patch) => io.save("a", { ...patch, board: "B" }) });
  await io.releaseNext();
  assert.deepEqual(io.sent.map((entry) => entry.patch.board), ["A", "B"]);
  await io.releaseNext();
});
