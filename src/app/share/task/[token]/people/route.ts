import { NextRequest, NextResponse } from "next/server";
import { publicOutagePeople, updatePublicOutagePeople } from "@/lib/outage-people-store";
import { peopleRouteError, requirePeopleOrigin } from "@/lib/outage-people-route";
import { readBoundedWorkBody } from "@/lib/public-task-work-request";
import { publicShareHeaders } from "@/lib/public-task-share-model";

export const dynamic = "force-dynamic";
type Context = { params: Promise<{ token: string }> };
export async function GET(_request: NextRequest, context: Context) {
  try { return NextResponse.json(await publicOutagePeople((await context.params).token), { headers: publicShareHeaders }); }
  catch (error) { return peopleRouteError(error); }
}
export async function HEAD(request: NextRequest, context: Context) {
  const response = await GET(request, context);
  return new NextResponse(null, { status: response.status, headers: response.headers });
}
export async function PATCH(request: NextRequest, context: Context) {
  try {
    requirePeopleOrigin(request);
    const raw = await readBoundedWorkBody(request);
    return NextResponse.json(await updatePublicOutagePeople((await context.params).token, raw), { headers: publicShareHeaders });
  } catch (error) { return peopleRouteError(error); }
}
