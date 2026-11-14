import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  createSessionCookieValue,
  getAuthCookieMaxAge,
  isSessionSigningConfigured,
} from "@/lib/auth";
import { authenticateReservedLocalAdmin } from "@/lib/local-admin-auth";

export async function POST(request: NextRequest) {
  if (!isSessionSigningConfigured()) {
    return NextResponse.json(
      { error: "Session signing is not configured." },
      { status: 503 },
    );
  }

  if (request.headers.get("content-type")?.split(";")[0].trim() !== "application/json") {
    return NextResponse.json({ error: "Expected a JSON request." }, { status: 415 });
  }
  const body = (await request.json().catch(() => null)) as { username?: string; password?: string } | null;
  const user = await authenticateReservedLocalAdmin({
    username: body?.username,
    password: body?.password ?? "",
    allowLegacyPasswordMigration: false,
    requireUsername: true,
  });

  if (!user?.id) {
    return NextResponse.json({ error: "Invalid username or password." }, { status: 401 });
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
