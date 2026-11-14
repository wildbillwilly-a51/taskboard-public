import "server-only";

import type { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, createSessionCookieValue, getAuthCookieMaxAge, type TaskboardSession } from "@/lib/auth";

export async function setTaskboardSession(response: NextResponse, session: Omit<TaskboardSession, "expiresAt">) {
  response.headers.set("Cache-Control", "no-store");
  response.cookies.set(AUTH_COOKIE_NAME, await createSessionCookieValue(session), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.AUTH_COOKIE_SECURE === "true",
    path: "/",
    maxAge: getAuthCookieMaxAge(),
  });
  return response;
}
