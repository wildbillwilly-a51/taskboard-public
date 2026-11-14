import assert from "node:assert/strict";
import test from "node:test";
import { getPool } from "@/lib/db";

test("database pool defaults and overrides stay bounded; invalid settings can be corrected", async () => {
  const previousEnv = { ...process.env };
  const previousPool = global.__taskboardPool;
  const settings = ["DATABASE_POOL_MAX", "DATABASE_POOL_CONNECTION_TIMEOUT_MS", "DATABASE_POOL_IDLE_TIMEOUT_MS"];
  try {
    global.__taskboardPool = undefined;
    // No connection is opened by this test.
    process.env.DATABASE_URL = "postgres://unused@127.0.0.1/unused";
    for (const name of settings) delete process.env[name];
    const defaults = getPool()!;
    assert.equal(defaults.options.max, 10);
    assert.equal(defaults.options.connectionTimeoutMillis, 5_000);
    assert.equal(defaults.options.idleTimeoutMillis, 30_000);
    await defaults.end();
    global.__taskboardPool = undefined;

    for (const name of settings) {
      for (const value of ["", " ", "0", "-1", "NaN", "Infinity", "1.5", "2147483648"]) {
        process.env[name] = value;
        assert.throws(() => getPool(), new RegExp(name));
        assert.equal(global.__taskboardPool, undefined);
      }
      delete process.env[name];
    }
    Object.assign(process.env, {
      DATABASE_POOL_MAX: "2", DATABASE_POOL_CONNECTION_TIMEOUT_MS: "250", DATABASE_POOL_IDLE_TIMEOUT_MS: "1000",
    });
    const configured = getPool()!;
    assert.equal(configured.options.max, 2);
    assert.equal(configured.options.connectionTimeoutMillis, 250);
    assert.equal(configured.options.idleTimeoutMillis, 1000);
    assert.equal(getPool(), configured);
    await configured.end();
  } finally {
    for (const name of ["DATABASE_URL", ...settings]) {
      if (previousEnv[name] === undefined) delete process.env[name];
      else process.env[name] = previousEnv[name];
    }
    global.__taskboardPool = previousPool;
  }
});
