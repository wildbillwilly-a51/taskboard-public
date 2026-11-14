import { NextRequest, NextResponse } from "next/server";
import {
  AUTH_COOKIE_NAME,
  createSessionCookieValue,
  getAuthCookieMaxAge,
  isSessionSigningConfigured,
} from "@/lib/auth";
import { hashLocalPassword, validateLocalPassword } from "@/lib/local-password";
import {
  getReservedLocalAdminSetupStatus,
  setupReservedLocalAdmin,
} from "@/lib/taskboard-store";

export async function GET() {
  try {
    return NextResponse.json(await getReservedLocalAdminSetupStatus());
  } catch {
    return NextResponse.json({ required: true });
  }
}

export async function POST(request: NextRequest) {
  const status = await getReservedLocalAdminSetupStatus();

  if (!isSessionSigningConfigured()) {
    return NextResponse.json(
      { error: "Session signing is not configured." },
      { status: 503 },
    );
  }

  if (!status.required) {
    return NextResponse.json({ error: "Reserved local admin setup is already complete." }, { status: 409 });
  }

  const body = (await request.json().catch(() => ({}))) as {
    username?: string;
    displayName?: string;
    password?: string;
  };
  const username = typeof body?.username === "string" ? body.username.trim().toLowerCase() : "";
  const displayName = (typeof body?.displayName === "string" && body.displayName.trim()) || "Taskboard Owner";
  const password = body?.password;

  if (!/^[a-z0-9._-]{3,64}$/.test(username)) {
    return NextResponse.json(
      { error: "Username must be 3-64 characters using letters, numbers, dots, underscores, or hyphens." },
      { status: 400 },
    );
  }

  try {
    validateLocalPassword(password);
    const user = await setupReservedLocalAdmin({
      username,
      displayName,
      passwordHash: await hashLocalPassword(password),
    });

    if (!user.id) {
      throw new Error("Reserved local admin setup did not return a user id.");
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
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Reserved local admin setup failed." },
      { status: 400 },
    );
  }
}
