import { NextRequest, NextResponse } from "next/server";
import { getTaskboardPublicOrigin } from "@/lib/taskboard-request";
import { publicShareHeaders } from "@/lib/public-task-share-model";
import { TaskShareUnavailable } from "@/lib/public-task-share-store";
import { applyPublicTaskWorkChange } from "@/lib/public-task-work-store";
import { readBoundedWorkBody, SharedWorkError } from "@/lib/public-task-work-request";

export const dynamic = "force-dynamic";
export async function POST(request: NextRequest, context: { params: Promise<{ token: string }> }) {
  try {
    const origin = getTaskboardPublicOrigin({ headers: request.headers, fallbackOrigin: request.url });
    if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") throw new SharedWorkError("Save changes from the shared workspace.", 403);
    const input = await readBoundedWorkBody(request);
    const { token } = await context.params;
    const data = await applyPublicTaskWorkChange(token, origin, input);
    return NextResponse.json(data, { headers: publicShareHeaders });
  } catch (error) {
    const status = error instanceof TaskShareUnavailable ? 404 : error instanceof SharedWorkError ? error.status : 503;
    const message = error instanceof TaskShareUnavailable ? "This shared workspace is unavailable." : error instanceof SharedWorkError ? error.message : "Unable to save work. Try again.";
    return NextResponse.json({ error: message }, { status, headers: publicShareHeaders });
  }
}
