import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { proxy as middleware } from "../src/proxy";
test("public exception preserves password and forwarded-identity protection on every private route", async () => {
    process.env.TASKBOARD_PUBLIC_SHARES_ENABLED = "true";
    process.env.TASKBOARD_AUTH_MODE = "password";
    const get = (path: string, method = "GET") => middleware(new NextRequest(`http://localhost${path}`, { method }));
    assert.equal((await get("/api/board")).status, 401);
    for (const route of ["/", "/notes", "/calendar", "/admin/users", "/teams", "/options"])
        assert.equal((await get(route)).status, 307, route);
    const publicPath = `/share/task/${"a".repeat(43)}`;
    process.env.TASKBOARD_AUTH_MODE = "password";
    const response = await get(publicPath + "/data");
    assert.equal(response.status, 200);
    assert.match(response.headers.get("Cache-Control")!, /no-store/);
    assert.equal((await get(publicPath + "/data", "POST")).status, 405);
    process.env.TASKBOARD_PUBLIC_TASK_EDITS_ENABLED = "false";
    assert.equal((await get(publicPath + "/changes", "POST")).status, 405);
    process.env.TASKBOARD_PUBLIC_TASK_EDITS_ENABLED = "true";
    assert.equal((await get(publicPath + "/changes", "POST")).status, 200);
    for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE"])
        assert.equal((await get(publicPath + "/changes", method)).status, 405);
    assert.equal((await get(publicPath + "/changes/extra", "POST")).status, 404);
    assert.equal((await get(publicPath, "POST")).status, 405);
    assert.equal((await get("/api/board", "POST")).status, 401);
    assert.equal((await get(publicPath + "/other")).status, 404);
    const notePath = `/share/note/${"n".repeat(43)}`;
    for (const mode of ["password", "authelia"]) {
        process.env.TASKBOARD_AUTH_MODE = mode;
        for (const route of [notePath, notePath + "/data", notePath + "/files/00000000-0000-4000-8000-000000000001"])
            assert.equal((await get(route)).status, 200, `${mode}: note read`);
        for (const route of [notePath + "/save", notePath + "/files"])
            assert.equal((await get(route, "POST")).status, 200, `${mode}: capability write handler`);
        assert.equal((await get(notePath + "/data", "POST")).status, 405);
        assert.equal((await get(notePath + "/save", "GET")).status, 405);
        assert.equal((await get(notePath + "/sharing", "POST")).status, 404);
        assert.equal((await get(notePath + "/files/not-a-file", "DELETE")).status, 404);
        assert.equal((await get("/api/folio/shares", "POST")).status, 401);
    }
    process.env.TASKBOARD_AUTH_MODE = "authelia";
    assert.equal((await get("/api/board")).status, 401);
    assert.equal((await get("/notes")).status, 403);
    assert.equal((await get(publicPath)).status, 200);
    process.env.TASKBOARD_PUBLIC_SHARES_ENABLED = "false";
    assert.equal((await get(publicPath)).status, 404);
    assert.equal((await get(notePath)).status, 404);
});
