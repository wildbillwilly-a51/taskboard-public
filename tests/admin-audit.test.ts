import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assertAdminAuditActor,
  maxAdminAuditLimit,
  parseAdminAuditEventFilters,
  redactAuditValue,
  type AdminAuditActor,
} from "../src/lib/admin-audit-policy";

const admin: AdminAuditActor = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "admin",
  isDisabled: false,
};

test("admin audit access allows active admins only", () => {
  assert.doesNotThrow(() => assertAdminAuditActor(admin));
  assert.throws(
    () =>
      assertAdminAuditActor({
        id: "00000000-0000-4000-8000-000000000002",
        role: "standard",
        isDisabled: false,
      }),
    /admin access is required/,
  );
  assert.throws(
    () =>
      assertAdminAuditActor({
        ...admin,
        isDisabled: true,
      }),
    /admin access is required/,
  );
});

test("audit filters apply defaults, caps, offset, action, targets, and dates", () => {
  const defaults = parseAdminAuditEventFilters(new URLSearchParams());
  assert.equal(defaults.limit, 100);
  assert.equal(defaults.offset, 0);

  const filters = parseAdminAuditEventFilters(
    new URLSearchParams({
      limit: "999",
      offset: "25",
      action: "team.updated",
      actorUserId: "00000000-0000-4000-8000-000000000001",
      targetUserId: "00000000-0000-4000-8000-000000000002",
      targetTeamId: "00000000-0000-4000-8000-000000000003",
      targetBoardId: "00000000-0000-4000-8000-000000000004",
      from: "2026-07-01",
      to: "2026-07-04",
    }),
  );

  assert.equal(filters.limit, maxAdminAuditLimit);
  assert.equal(filters.offset, 25);
  assert.equal(filters.action, "team.updated");
  assert.equal(filters.actorUserId, "00000000-0000-4000-8000-000000000001");
  assert.equal(filters.targetUserId, "00000000-0000-4000-8000-000000000002");
  assert.equal(filters.targetTeamId, "00000000-0000-4000-8000-000000000003");
  assert.equal(filters.targetBoardId, "00000000-0000-4000-8000-000000000004");
  assert.equal(filters.from, "2026-07-01T00:00:00.000Z");
  assert.equal(filters.to, "2026-07-04T00:00:00.000Z");

  assert.throws(
    () => parseAdminAuditEventFilters(new URLSearchParams({ actorUserId: "not-a-uuid" })),
    /actorUserId must be a UUID/,
  );
  assert.throws(
    () => parseAdminAuditEventFilters(new URLSearchParams({ from: "not-a-date" })),
    /from must be a valid date/,
  );
});

test("audit value redaction recursively masks sensitive keys in objects and arrays", () => {
  const redacted = redactAuditValue({
    role: "admin",
    password: "plain",
    local_password_hash: "hash-value",
    nested: {
      authSecret: "secret",
      safe: "visible",
      deviceCredentials: "device-secret",
      token_hash: "token-hash",
    },
    list: [
      {
        cookie: "session",
        value: "kept",
      },
      {
        pairingCode: "123456",
      },
    ],
  });

  assert.deepEqual(redacted, {
    role: "admin",
    password: "[redacted]",
    local_password_hash: "[redacted]",
    nested: {
      authSecret: "[redacted]",
      safe: "visible",
      deviceCredentials: "[redacted]",
      token_hash: "[redacted]",
    },
    list: [
      {
        cookie: "[redacted]",
        value: "kept",
      },
      {
        pairingCode: "[redacted]",
      },
    ],
  });
});

test("admin audit route and store expose read-only joined listing with redaction", () => {
  const route = readFileSync("src/app/api/admin/audit-events/route.ts", "utf8");
  const store = readFileSync("src/lib/taskboard-store.ts", "utf8");

  assert.match(route, /export async function GET/);
  assert.match(route, /requireAdminTaskboardUserFromHeaders\(request\)/);
  assert.match(route, /parseAdminAuditEventFilters\(request\.nextUrl\.searchParams\)/);
  assert.match(route, /listAdminAuditEvents\(admin, filters\)/);
  assert.doesNotMatch(route, /POST|PATCH|DELETE/);

  assert.match(store, /export async function listAdminAuditEvents/);
  assert.match(store, /assertAdminAuditActor\(actor\)/);
  assert.match(store, /LEFT JOIN users actor ON actor\.id = audit\.actor_user_id/);
  assert.match(store, /LEFT JOIN users target_user ON target_user\.id = audit\.target_user_id/);
  assert.match(store, /LEFT JOIN teams target_team ON target_team\.id = audit\.target_team_id/);
  assert.match(store, /LEFT JOIN boards target_board ON target_board\.id = audit\.target_board_id/);
  assert.match(store, /ORDER BY audit\.created_at DESC, audit\.id DESC/);
  assert.match(store, /filters\.limit \+ 1/);
  assert.match(store, /hasMore: result\.rows\.length > filters\.limit/);
  assert.match(store, /redactAuditValue\(row\.previous_values\)/);
  assert.match(store, /redactAuditValue\(row\.new_values\)/);
  assert.doesNotMatch(store, /local_password_hash AS/);
  assert.doesNotMatch(store, /token_hash AS/);
});

test("audit page and admin menu are admin-only and include filters and pagination", () => {
  const page = readFileSync("src/app/admin/audit/page.tsx", "utf8");
  const component = readFileSync("src/components/admin-audit-page.tsx", "utf8");
  const taskboard = readFileSync("src/components/taskboard.tsx", "utf8");

  assert.match(page, /getCurrentAdminTaskboardUser\(\)/);
  assert.match(page, /Audit log access is available only to Taskboard admins/);
  assert.match(page, /listAdminAuditEvents\(admin, filters\)/);

  assert.match(component, /Audit log/);
  assert.match(component, /User administration/);
  assert.match(component, /name="action"/);
  assert.match(component, /name="from"/);
  assert.match(component, /name="to"/);
  assert.match(component, /"actorUserId", "Actor user ID"/);
  assert.match(component, /"targetUserId", "Target user ID"/);
  assert.match(component, /"targetTeamId", "Target team ID"/);
  assert.match(component, /"targetBoardId", "Target board ID"/);
  assert.match(component, /app\.permission_settings\.changed/);
  assert.match(component, /board\.privacy_changed/);
  assert.match(component, /personal_board\.member_grant\.added/);
  assert.match(component, /personal_board\.member_grant\.changed/);
  assert.match(component, /personal_board\.member_grant\.removed/);
  assert.match(component, /Previous/);
  assert.match(component, /Next/);
  assert.match(component, /JSON\.stringify/);

  assert.match(taskboard, /currentUser\.role === "admin"/);
  assert.match(taskboard, /href="\/admin\/audit"/);
  assert.match(taskboard, /Audit log/);
});

test("audit route preserves database-unavailable behavior without leaking rows", () => {
  const probe = `
    import { pathToFileURL } from "node:url";
    import path from "node:path";
    import { NextRequest } from "next/server";

    const route = await import(pathToFileURL(path.join(process.cwd(), "src/app/api/admin/audit-events/route.ts")).href);
    const handler = route.GET ?? route.default?.GET ?? route["module.exports"]?.GET;
    if (typeof handler !== "function") {
      console.error(JSON.stringify({ keys: Object.keys(route) }));
      process.exit(1);
    }
    const response = await handler(new NextRequest("http://taskboard.test/api/admin/audit-events"));
    const body = await response.json().catch(() => ({}));
    if (response.status !== 503 || !String(body.error ?? "").includes("DATABASE_URL")) {
      console.error(JSON.stringify({ status: response.status, body }));
      process.exit(1);
    }
  `;

  execFileSync(process.execPath, ["--conditions", "react-server", "--import", "tsx", "--eval", probe], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: "",
    },
    stdio: "pipe",
  });
});
