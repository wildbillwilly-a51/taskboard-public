import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";

const [mode, address, fixturePath] = process.argv.slice(2);
assert.ok(["seed", "verify"].includes(mode) && fixturePath, "Provide seed|verify, address, and fixture path.");
const base = new URL(address);
assert.ok(base.protocol === "http:" && base.hostname === "127.0.0.1" && base.port,
  "Use the disposable loopback Compose app.");
const password = process.env.TASKBOARD_CHECK_PASSWORD;
assert.ok(password && password.length >= 24, "Set a generated fixture password.");

const admin = "release-check-admin";
const outsider = "release-check-outsider";
const title = "Release check task";
const note = "Release check working note";
const filename = "release-check.png";
const bytes = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j9KsAAAAASUVORK5CYII=",
  "base64",
);

const health = await json("/api/health");
assert.equal(health.schemaReady, true, "The required database schema must be ready.");
assert.equal(health.schemaLevel, health.requiredSchemaLevel, "All required migrations must be applied.");

let fixture;
if (mode === "seed") {
  assert.equal((await json("/api/auth/setup")).required, true, "First-run setup must be available.");
  await json("/api/auth/setup", { data: { username: admin, displayName: "Release Check Admin", password } });
  assert.equal((await json("/api/auth/setup")).required, false, "Setup must record the administrator.");
  const cookie = await signIn(admin);
  await json("/api/admin/users", {
    cookie,
    data: { username: outsider, email: "release-check@example.test", displayName: "Release Check Outsider", password },
  });
  const { team } = await json("/api/teams", { cookie, data: { name: "Release Check Team" } });
  const { board } = await json("/api/teams/" + team.id + "/boards", {
    cookie,
    data: { title: "Release Check Board" },
  });
  const boardPath = "/api/board?boardId=" + board.id;
  const { board: detail } = await json(boardPath, { cookie });
  const { taskId } = await json("/api/tasks", {
    cookie,
    data: { boardId: board.id, bucketId: detail.buckets[0].id, title },
  });
  const taskPath = "/api/tasks/" + taskId;
  await json(taskPath + "/notes", { cookie, data: { boardId: board.id, body: note } });
  const form = new FormData();
  form.set("boardId", board.id);
  form.set("files", new Blob([bytes], { type: "image/png" }), filename);
  const uploaded = await json(taskPath + "/attachments", { cookie, form });
  const file = findTask(uploaded.board, taskId).attachments.find((item) => item.originalName === filename);
  assert.ok(file?.id, "The upload must appear on the task.");
  fixture = { boardId: board.id, taskId, fileId: file.id, schemaLevel: health.schemaLevel };
  await writeFile(fixturePath, JSON.stringify(fixture), { mode: 0o600 });
} else {
  fixture = JSON.parse(await readFile(fixturePath, "utf8"));
}

const cookie = await signIn(admin);
const boardPath = "/api/board?boardId=" + fixture.boardId;
const { board } = await json(boardPath, { cookie });
assert.equal(board.id, fixture.boardId, "The same board must remain accessible.");
const task = findTask(board, fixture.taskId);
assert.equal(task.title, title);
assert.ok(task.notes.some((item) => item.body === note), "The working note must remain intact.");
const attachmentPath = "/api/tasks/" + fixture.taskId + "/attachments/" + fixture.fileId
  + "?boardId=" + fixture.boardId;
const downloaded = await request(attachmentPath, { cookie });
assert.match(downloaded.headers.get("content-disposition") ?? "", /^attachment;/);
assert.ok(bytes.equals(Buffer.from(await downloaded.arrayBuffer())), "Attachment bytes must match.");
const inline = await request(attachmentPath + "&disposition=inline", { cookie });
assert.match(inline.headers.get("content-disposition") ?? "", /^inline;/);
assert.equal(inline.headers.get("content-type"), "image/png");
assert.ok(bytes.equals(Buffer.from(await inline.arrayBuffer())), "Preview bytes must match.");

const outsiderCookie = await signIn(outsider);
for (const path of [boardPath, attachmentPath]) {
  const denied = await request(path, { cookie: outsiderCookie, expected: [403, 404] });
  await denied.body?.cancel();
}
console.log("Verified local sign-in, team isolation, task, working note, and attachment at schema "
  + health.schemaLevel + " (fixture schema " + fixture.schemaLevel + ").");

async function request(path, { cookie, data, form, expected } = {}) {
  const headers = { Origin: base.origin };
  if (cookie) headers.Cookie = cookie;
  if (data) headers["Content-Type"] = "application/json";
  const method = data || form ? "POST" : "GET";
  const response = await fetch(new URL(path, base), {
    method,
    headers,
    body: data ? JSON.stringify(data) : form,
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
  });
  assert.ok(expected ? expected.includes(response.status) : response.ok,
    method + " " + path + " returned HTTP " + response.status);
  return response;
}

async function json(path, options) {
  return (await request(path, options)).json();
}

async function signIn(username) {
  const response = await request("/api/auth/login", { data: { username, password } });
  const cookie = response.headers.getSetCookie().map((value) => value.split(";", 1)[0]).join("; ");
  assert.ok(cookie.length, "Sign-in must return a session cookie.");
  await response.body?.cancel();
  return cookie;
}

function findTask(board, id) {
  const task = board.buckets.flatMap((bucket) => bucket.tasks).find((item) => item.id === id);
  assert.ok(task, "The release check task must exist on the board.");
  return task;
}
