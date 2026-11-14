import { NextRequest, NextResponse } from "next/server";
import { isPublicTaskSharePath, publicShareHeaders } from "@/lib/public-task-share-model";
import {publicNotePath} from './folio-features-model';
import {
  AUTH_COOKIE_NAME,
  isExternalAuthOnly,
  readExternalAuthIdentity,
  verifySessionCookieValue,
} from "@/lib/auth";

const publicPaths = new Set([
  "/login",
  "/setup",
  "/local-admin/login",
  "/api/auth/login",
  "/api/auth/setup",
  "/api/auth/local-admin/login",
  "/api/health",
]);

function isPublicAsset(pathname: string) {
  return (
    pathname.startsWith("/_next/") ||
    pathname === "/favicon.ico" ||
    pathname === "/taskboard-push.js" ||
    pathname === "/taskboard.webmanifest" ||
    pathname === "/offline-notes/personal-192.png" ||
    pathname === "/offline-notes/personal-512.png" ||
    pathname.startsWith("/images/") ||
    pathname.startsWith("/icons/")
  );
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/share/")) {
    if(publicNotePath(pathname)){
      if(process.env.TASKBOARD_PUBLIC_SHARES_ENABLED!=='true')return new NextResponse('This shared note is unavailable.',{status:404,headers:publicShareHeaders});
      const write=pathname.endsWith('/save')||/\/files\/?$/.test(pathname),file=/\/files\/[0-9a-f-]{36}\/?$/.test(pathname);
      const allowed=(['GET','HEAD'].includes(request.method)&&!write)||(request.method==='POST'&&write)||(request.method==='DELETE'&&file);
      if(!allowed)return new NextResponse(null,{status:405,headers:publicShareHeaders});
      const response=NextResponse.next();for(const[k,v]of Object.entries(publicShareHeaders))response.headers.set(k,v);return response;
    }
    if (process.env.TASKBOARD_PUBLIC_SHARES_ENABLED !== "true" || !isPublicTaskSharePath(pathname)) {
      return new NextResponse("This shared workspace is unavailable.", {status:404,headers:publicShareHeaders});
    }
    const workChange = pathname.replace(/\/$/, "").endsWith("/changes");
    const peoplePath = pathname.replace(/\/$/, "").endsWith("/people");
    const editPost = workChange && request.method === "POST" && process.env.TASKBOARD_PUBLIC_TASK_EDITS_ENABLED === "true";
    const peoplePatch = peoplePath && request.method === "PATCH" && process.env.TASKBOARD_PUBLIC_TASK_EDITS_ENABLED === "true";
    if (!editPost && !peoplePatch && (workChange || !["GET","HEAD"].includes(request.method))) return new NextResponse(null,{status:405,headers:{...publicShareHeaders,Allow:workChange ? "POST" : peoplePath && process.env.TASKBOARD_PUBLIC_TASK_EDITS_ENABLED === "true" ? "GET, HEAD, PATCH" : "GET, HEAD"}});
    const response=NextResponse.next();
    for (const [key,value] of Object.entries(publicShareHeaders)) response.headers.set(key,value);
    if (!pathname.includes("/files/")) response.headers.set("Content-Security-Policy","frame-ancestors 'none'; object-src 'none'; base-uri 'self'");
    return response;
  }

  if (isExternalAuthOnly()) {
    if (
      pathname === "/api/health" ||
      pathname === "/local-admin/login" ||
      pathname === "/api/auth/local-admin/login" ||
      pathname === "/api/auth/setup" ||
      pathname === "/setup" ||
      isPublicAsset(pathname)
    ) {
      return NextResponse.next();
    }

    if (pathname === "/login") {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/";
      return NextResponse.redirect(redirectUrl);
    }

    const session = await verifySessionCookieValue(
      request.cookies.get(AUTH_COOKIE_NAME)?.value,
    );

    if (session?.authProvider === "local" && session.reservedAdmin) {
      return NextResponse.next();
    }

    if (!readExternalAuthIdentity(request.headers)) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json(
          { error: "Forwarded Taskboard identity headers are missing." },
          { status: 401 },
        );
      }

      return new NextResponse("Forwarded Taskboard identity headers are missing.", {
        status: 403,
      });
    }

    const navigationSession=request.cookies.get('taskboard_navigation')?.value;
    if(navigationSession && /^[0-9a-f-]{36}$/.test(navigationSession))return NextResponse.next();
    const sessionId=crypto.randomUUID(),forwarded=new Headers(request.headers);
    forwarded.set('x-taskboard-navigation-session',sessionId);
    const hasBoardDestination = request.nextUrl.searchParams.has("taskId") || request.nextUrl.searchParams.get("view") === "board";
    const response = pathname === "/" && !hasBoardDestination
      ? NextResponse.redirect(new URL("/folio", request.url))
      : NextResponse.next({ request: { headers: forwarded } });
    response.cookies.set('taskboard_navigation',sessionId,{httpOnly:true,sameSite:'lax',secure:process.env.AUTH_COOKIE_SECURE==='true'||request.nextUrl.protocol==='https:',path:'/'});
    return response;
  }

  if (publicPaths.has(pathname) || isPublicAsset(pathname)) {
    return NextResponse.next();
  }

  {
    const session = await verifySessionCookieValue(
      request.cookies.get(AUTH_COOKIE_NAME)?.value,
    );

    if (session) {
      return NextResponse.next();
    }

    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }

    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    const hasBoardDestination = pathname === "/" && (
      request.nextUrl.searchParams.has("taskId") || request.nextUrl.searchParams.get("view") === "board"
    );
    loginUrl.search = "";
    loginUrl.searchParams.set("next", hasBoardDestination
      ? pathname + request.nextUrl.search
      : pathname === "/" ? "/folio" : pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
