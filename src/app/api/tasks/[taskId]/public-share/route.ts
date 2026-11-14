import { NextRequest, NextResponse } from "next/server";
import { requireTaskboardUserFromHeaders, getTaskboardPublicOrigin } from "@/lib/taskboard-request";
import { manageTaskShare, publicTaskSharingEnabled, TaskShareConflict } from "@/lib/public-task-share-store";
import { isUuid } from "@/lib/uuid";
import { publicShareHeaders, type TaskShareMode } from "@/lib/public-task-share-model";
type Context = {
    params: Promise<{
        taskId: string;
    }>;
};
async function handle(request: NextRequest, context: Context, write: boolean) {
    if (!publicTaskSharingEnabled())
        return NextResponse.json({ error: "Sharing is unavailable." }, { status: 404, headers: publicShareHeaders });
    try {
        const user = await requireTaskboardUserFromHeaders(request);
        const { taskId } = await context.params;
        let action: "status" | "create" | "replace" | "disable" | "update" = "status", timeZone = "UTC";
        const settings: { mode?: TaskShareMode; expiresAt?: string | null; expectedShareId?: string | null } = {};
        if (write) {
            const origin = getTaskboardPublicOrigin({ headers: request.headers, fallbackOrigin: request.url });
            if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site")
                return NextResponse.json({ error: "Open sharing from Taskboard." }, { status: 403, headers: publicShareHeaders });
            if (Number(request.headers.get("content-length") || 0) > 2048)
                throw new Error("Invalid sharing request.");
            const body = await request.json();
            if (!["create", "replace", "disable", "update"].includes(body.action))
                throw new Error("Invalid sharing action.");
            action = body.action;
            if (!("expectedShareId" in body) || body.expectedShareId !== null && (typeof body.expectedShareId !== "string" || !isUuid(body.expectedShareId)))
                return NextResponse.json({ error: "Refresh sharing before changing a link." }, { status: 409, headers: publicShareHeaders });
            settings.expectedShareId = body.expectedShareId;
            timeZone = typeof body.timeZone === "string" ? body.timeZone : "UTC";
            if (body.mode !== undefined) {
                if (!["view", "edit_work"].includes(body.mode)) throw new Error("Invalid link mode.");
                settings.mode = body.mode;
            }
            if (body.expiresAt !== undefined) {
                if (body.expiresAt !== null && typeof body.expiresAt !== "string") throw new Error("Invalid expiry.");
                settings.expiresAt = body.expiresAt;
            }
        }
        const data = await manageTaskShare(user, taskId, action, timeZone, settings);
        return NextResponse.json(data, { status: !write || data.allowed ? 200 : 403, headers: publicShareHeaders });
    }
    catch (error) {
        if (error instanceof TaskShareConflict) return NextResponse.json({ error: error.message }, { status: 409, headers: publicShareHeaders });
        return NextResponse.json({ error: "Unable to manage this share. Refresh and try again." }, { status: 400, headers: publicShareHeaders });
    }
}
export const GET = (request: NextRequest, context: Context) => handle(request, context, false);
export const POST = (request: NextRequest, context: Context) => handle(request, context, true);
