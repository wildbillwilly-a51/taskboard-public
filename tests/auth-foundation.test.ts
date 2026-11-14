import assert from "node:assert/strict";
import test from "node:test";
import {
  createSessionCookieValue,
  verifySessionCookieValue,
} from "../src/lib/auth";

test("session cookies use signed user payloads and reject legacy solo cookies", async () => {
  const previousAuthSecret = process.env.AUTH_SECRET;
  const previousDatabaseUrl = process.env.DATABASE_URL;

  process.env.AUTH_SECRET = "test-secret-for-auth-foundation";
  process.env.DATABASE_URL = "postgres://taskboard-test";

  try {
    const cookie = await createSessionCookieValue({
      userId: "00000000-0000-0000-0000-000000000001",
      authProvider: "local",
      reservedAdmin: true,
    });
    const session = await verifySessionCookieValue(cookie);

    assert.equal(session?.userId, "00000000-0000-0000-0000-000000000001");
    assert.equal(session?.authProvider, "local");
    assert.equal(session?.reservedAdmin, true);

    const tamperedCookie = cookie.replace(/\.[^.]+$/, ".tampered-signature");
    assert.equal(await verifySessionCookieValue(tamperedCookie), null);

    assert.equal(await verifySessionCookieValue(`solo:${Date.now() + 10000}.signature`), null);
  } finally {
    if (previousAuthSecret === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = previousAuthSecret;
    }

    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  }
});

test("session cookies require AUTH_SECRET for creation and verification", async () => {
  const previousAuthSecret = process.env.AUTH_SECRET;
  const previousDatabaseUrl = process.env.DATABASE_URL;

  delete process.env.AUTH_SECRET;
  process.env.DATABASE_URL = "postgres://taskboard-test";

  try {
    await assert.rejects(
      async () =>
        await createSessionCookieValue({
          userId: "00000000-0000-0000-0000-000000000001",
          authProvider: "local",
          reservedAdmin: true,
        }),
      /Session signing is not configured/,
    );

    assert.equal(
      await verifySessionCookieValue("payload.signature"),
      null,
    );
  } finally {
    if (previousAuthSecret === undefined) {
      delete process.env.AUTH_SECRET;
    } else {
      process.env.AUTH_SECRET = previousAuthSecret;
    }

    if (previousDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = previousDatabaseUrl;
    }
  }
});
