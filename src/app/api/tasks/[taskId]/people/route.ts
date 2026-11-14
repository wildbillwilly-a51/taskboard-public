import { NextRequest, NextResponse } from "next/server";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { authenticatedOutagePeople } from "@/lib/outage-people-store";
import { peopleRouteError, requirePeopleOrigin } from "@/lib/outage-people-route";
import { readBoundedWorkBody } from "@/lib/public-task-work-request";
import { publicShareHeaders } from "@/lib/public-task-share-model";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ taskId: string }> };
export async function GET(request: NextRequest, context: Context) {
  try {
    const user = await requireTaskboardUserFromHeaders(request), { taskId } = await context.params;
    return NextResponse.json(await authenticatedOutagePeople(user, taskId, undefined, request.nextUrl.searchParams.has("boardId") ? request.nextUrl.searchParams.get("boardId") : undefined), { headers: publicShareHeaders });
  } catch (error) { return peopleRouteError(error); }
}
export async function PATCH(request: NextRequest, context: Context) {
  try {
    requirePeopleOrigin(request);
    const user = await requireTaskboardUserFromHeaders(request), { taskId } = await context.params;
    const input = await readBoundedWorkBody(request);
    return NextResponse.json(await authenticatedOutagePeople(user, taskId, input, request.nextUrl.searchParams.has("boardId") ? request.nextUrl.searchParams.get("boardId") : undefined), { headers: publicShareHeaders });
  } catch (error) { return peopleRouteError(error); }
}
