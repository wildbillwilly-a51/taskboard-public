import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  createSessionCookieValue,
  getAuthCookieMaxAge,
  isExternalAuthOnly,
  isAuthConfigured,
} from "@/lib/auth";
import { authenticateReservedLocalAdmin } from "@/lib/local-admin-auth";

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

  const body = (await request.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
  };
  const user = await authenticateReservedLocalAdmin({
    username: body.username,
    password: body.password ?? "",
    allowLegacyPasswordMigration: true,
    requireUsername: false,
  });

  if (!user?.id) {
    return NextResponse.json({ error: "Invalid password." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: await createSessionCookieValue({
      userId: user.id,
      authProvider: "local",
      reservedAdmin: true,
    }),
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.AUTH_COOKIE_SECURE === "true",
    path: "/",
    maxAge: getAuthCookieMaxAge(),
  });

  return response;
}
