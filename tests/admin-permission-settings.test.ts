import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";
import {
  evaluateAdminPermissionSettingsUpdate,
  parseAdminPermissionSettingsPatchBody,
  type AdminPermissionSettings,
} from "../src/lib/admin-permission-settings-policy";

const admin = {
  id: "00000000-0000-4000-8000-000000000001",
  role: "admin" as const,
  isDisabled: false,
};
const standardUser = {
  id: "00000000-0000-4000-8000-000000000002",
  role: "standard" as const,
  isDisabled: false,
};
const appManager = {
  id: "00000000-0000-4000-8000-000000000003",
  role: "manager" as const,
  isDisabled: false,
};
const currentSettings: AdminPermissionSettings = {
  sameTeamPersonalBoardVisibilityAllowed: false,
  defaultPersonalBoardVisibility: "private",
  managersCanConfigureTeamPersonalBoardVisibility: false,
  usersCanMakeBoardsPrivate: true,
  adminsCanViewPrivateBoards: true,
  updatedAt: "2026-07-04T00:00:00.000Z",
};

test("permission settings patch body is strict and validates types", () => {
  assert.deepEqual(
    parseAdminPermissionSettingsPatchBody({
      sameTeamPersonalBoardVisibilityAllowed: true,
      defaultPersonalBoardVisibility: "team_visible",
      managersCanConfigureTeamPersonalBoardVisibility: false,
      usersCanMakeBoardsPrivate: true,
      adminsCanViewPrivateBoards: true,
    }),
    {
      sameTeamPersonalBoardVisibilityAllowed: true,
      defaultPersonalBoardVisibility: "team_visible",
      managersCanConfigureTeamPersonalBoardVisibility: false,
      usersCanMakeBoardsPrivate: true,
      adminsCanViewPrivateBoards: true,
    },
  );

  assert.throws(
    () => parseAdminPermissionSettingsPatchBody({ unknown: true }),
    /Unknown permission setting: unknown/,
  );
  assert.throws(
    () =>
      parseAdminPermissionSettingsPatchBody({
        sameTeamPersonalBoardVisibilityAllowed: "true",
      }),
    /sameTeamPersonalBoardVisibilityAllowed must be a boolean/,
  );
  assert.throws(
    () =>
      parseAdminPermissionSettingsPatchBody({
        defaultPersonalBoardVisibility: "public",
      }),
    /defaultPersonalBoardVisibility must be private or team_visible/,
  );
  assert.throws(
    () => parseAdminPermissionSettingsPatchBody(null),
    /Request body must be a JSON object/,
  );
});

test("only app admins can update permission settings", () => {
  assert.doesNotThrow(() =>
    evaluateAdminPermissionSettingsUpdate(admin, currentSettings, {
      sameTeamPersonalBoardVisibilityAllowed: true,
    }),
  );
  assert.throws(
    () =>
      evaluateAdminPermissionSettingsUpdate(standardUser, currentSettings, {
        sameTeamPersonalBoardVisibilityAllowed: true,
      }),
    /Taskboard admin access is required/,
  );
  assert.throws(
    () =>
      evaluateAdminPermissionSettingsUpdate(appManager, currentSettings, {
        sameTeamPersonalBoardVisibilityAllowed: true,
      }),
    /Taskboard admin access is required/,
  );
  assert.throws(
    () =>
      evaluateAdminPermissionSettingsUpdate(
        { ...admin, isDisabled: true },
        currentSettings,
        { sameTeamPersonalBoardVisibilityAllowed: true },
      ),
    /Taskboard admin access is required/,
  );
});

test("permission setting changes audit only changed values", () => {
  const result = evaluateAdminPermissionSettingsUpdate(admin, currentSettings, {
    sameTeamPersonalBoardVisibilityAllowed: true,
    defaultPersonalBoardVisibility: "team_visible",
    usersCanMakeBoardsPrivate: true,
  });

  assert.equal(result.settings.sameTeamPersonalBoardVisibilityAllowed, true);
  assert.equal(result.settings.defaultPersonalBoardVisibility, "team_visible");
  assert.equal(result.auditEvents.length, 1);
  assert.equal(result.auditEvents[0].action, "app.permission_settings.changed");
  assert.deepEqual(result.auditEvents[0].previousValues, {
    sameTeamPersonalBoardVisibilityAllowed: false,
    defaultPersonalBoardVisibility: "private",
  });
  assert.deepEqual(result.auditEvents[0].newValues, {
    sameTeamPersonalBoardVisibilityAllowed: true,
    defaultPersonalBoardVisibility: "team_visible",
  });

  const noOp = evaluateAdminPermissionSettingsUpdate(admin, currentSettings, {
    sameTeamPersonalBoardVisibilityAllowed: false,
    usersCanMakeBoardsPrivate: true,
  });
  assert.equal(noOp.auditEvents.length, 0);
});

test("permission settings route and store enforce admin access, env status, and audit writes", () => {
  const route = readFileSync("src/app/api/admin/settings/permissions/route.ts", "utf8");
  const store = readFileSync("src/lib/taskboard-store.ts", "utf8");
  const policy = readFileSync("src/lib/admin-permission-settings-policy.ts", "utf8");

  assert.match(route, /export async function GET/);
  assert.match(route, /export async function PATCH/);
  assert.match(route, /requireAdminTaskboardUserFromHeaders\(request\)/);
  assert.match(route, /parseAdminPermissionSettingsPatchBody/);
  assert.match(route, /sameTeamPersonalBoardVisibilityEnvGate/);
  assert.match(route, /enabled" : "not_enabled"/);
  assert.doesNotMatch(route, /process\.env/);

  assert.match(store, /export async function getAdminPermissionSettings/);
  assert.match(store, /export async function updateAdminPermissionSettings/);
  assert.match(store, /assertAdminActor\(actor\)/);
  assert.match(store, /FOR UPDATE/);
  assert.match(store, /INSERT INTO admin_audit_events/);
  assert.match(policy, /app\.permission_settings\.changed/);
  assert.doesNotMatch(store, /local_password_hash AS/);
  assert.doesNotMatch(store, /AUTH_SECRET/);
});

test("permission settings page and admin menu are admin-only and include warnings", () => {
  const page = readFileSync("src/app/admin/settings/permissions/page.tsx", "utf8");
  const component = readFileSync("src/components/admin-permission-settings-page.tsx", "utf8");
  const taskboard = readFileSync("src/components/taskboard.tsx", "utf8");
  const auditPage = readFileSync("src/components/admin-audit-page.tsx", "utf8");

  assert.match(page, /getCurrentAdminTaskboardUser\(\)/);
  assert.match(page, /Permission settings are available only to Taskboard admins/);
  assert.match(page, /getAdminPermissionSettings\(admin\)/);

  assert.match(component, /Permission settings/);
  assert.match(component, /TASKBOARD_SAME_TEAM_PERSONAL_BOARD_VIEW/);
  assert.match(component, /Env gate:/);
  assert.match(component, /Enabling this setting does not expose boards by itself/);
  assert.match(component, /stored for future personal-board creation behavior/);
  assert.match(component, /User administration/);
  assert.match(component, /Audit log/);
  assert.match(component, /Save settings/);
  assert.doesNotMatch(component, /local_password_hash|password_hash|AUTH_SECRET/);

  assert.match(taskboard, /currentUser\.role === "admin"/);
  assert.match(taskboard, /href="\/admin\/settings\/permissions"/);
  assert.match(taskboard, /Permission settings/);
  assert.match(auditPage, /app\.permission_settings\.changed/);
});

test("permission settings route preserves database-unavailable behavior", () => {
  const probe = `
    import { NextRequest } from "next/server";
    const route = await import(${JSON.stringify(
      pathToFileURL(
        path.join(process.cwd(), "src/app/api/admin/settings/permissions/route.ts"),
      ).href,
    )});
    const handler = route.GET ?? route.default?.GET ?? route["module.exports"]?.GET;
    if (typeof handler !== "function") {
      console.error(JSON.stringify({ keys: Object.keys(route) }));
      process.exit(1);
    }
    const response = await handler(new NextRequest("http://taskboard.test/api/admin/settings/permissions"));
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
