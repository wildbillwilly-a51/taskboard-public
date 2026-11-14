import { NextResponse } from "next/server";
import { AUTH_COOKIE_NAME, getExternalAccountActions, isExternalAuthOnly } from "@/lib/auth";

export async function POST() {
  const response = NextResponse.json(
    isExternalAuthOnly()
      ? {
          ok: true,
          externalAuthOnly: true,
          logoutUrl: getExternalAccountActions().logoutUrl,
        }
      : { ok: true },
  );
  response.cookies.set({
    name: AUTH_COOKIE_NAME,
    value: "",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.AUTH_COOKIE_SECURE === "true",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set('taskboard_navigation','',{httpOnly:true,sameSite:'lax',path:'/',maxAge:0});

  if (isExternalAuthOnly()) {
    return response;
  }

  return response;
}
