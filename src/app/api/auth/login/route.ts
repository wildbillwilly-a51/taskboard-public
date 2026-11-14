import { NextRequest, NextResponse } from "next/server";
import {
  isExternalAuthOnly,
  isAuthConfigured,
} from "@/lib/auth";
import { setTaskboardSession } from "@/lib/auth-response";
import { authenticateReservedLocalAdmin } from "@/lib/local-admin-auth";
import { maximumLocalPasswordLength, verifyLocalPassword } from "@/lib/local-password";
import { admitLocalLogin, clearLocalLoginAttempts } from "@/lib/local-login-attempts";
import { getLocalAccountForLogin } from "@/lib/taskboard-store";

export async function POST(request: NextRequest) {
  if (isExternalAuthOnly()) {
    return NextResponse.json(
      { error: "Taskboard is configured for external authentication only." },
      { status: 404 },
    );
  }

  if (!isAuthConfigured()) {
    return NextResponse.json(
      { error: "Authentication is not configured." },
      { status: 503 },
    );
  }

  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return NextResponse.json({ error: "Expected a JSON request." }, { status: 415 });
  }

  const body = await request.json().catch(() => null);
  const invalid = () => NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
  const username = body?.username === undefined ? "" : body.username;
  const password = body?.password;
  if (typeof username !== "string" || username.length > 254
    || typeof password !== "string" || !password || password.length > maximumLocalPasswordLength) {
    return invalid();
  }

  const name = username.trim().toLowerCase();
  const account = name ? await getLocalAccountForLogin(name) : null;
  if (account) {
    if (!admitLocalLogin(account.id) || !await verifyLocalPassword(password, account.local_password_hash)) return invalid();
    clearLocalLoginAttempts(account.id);
    return setTaskboardSession(NextResponse.json({ ok: true }), {
      userId: account.id, authProvider: "local", reservedAdmin: false, version: account.session_version,
    });
  }

  const admin = await authenticateReservedLocalAdmin({
    username: name,
    password,
    allowLegacyPasswordMigration: true,
    requireUsername: false,
  });

  if (!admin?.id) return invalid();
  return setTaskboardSession(NextResponse.json({ ok: true }), {
    userId: admin.id, authProvider: "local", reservedAdmin: true,
  });

}
