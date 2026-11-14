import type { NextRequest } from "next/server";
import { middleware } from "@/lib/taskboard-request-guard";
// The app lives in src/app, so Next discovers its request guard here.
export function proxy(request: NextRequest) {
    return middleware(request);
}
export const config = { matcher: ["/((?!_next/static|_next/image).*)"] };
