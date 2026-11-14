import { NextRequest, NextResponse } from "next/server";
import { getPublicTaskWorkspace, TaskShareUnavailable } from "@/lib/public-task-share-store";
import { publicShareHeaders } from "@/lib/public-task-share-model";
export const dynamic = "force-dynamic";
type Context = {
    params: Promise<{
        token: string;
    }>;
};
export async function GET(request: NextRequest, context: Context) {
    try {
        const { token } = await context.params;
        const data = await getPublicTaskWorkspace(token, request.nextUrl.origin);
        const etag = `"${data.revision}"`;
        if (request.headers.get("if-none-match") === etag)
            return new NextResponse(null, { status: 304, headers: { ...publicShareHeaders, ETag: etag } });
        return NextResponse.json(data, { headers: { ...publicShareHeaders, ETag: etag } });
    }
    catch (error) {
        return NextResponse.json({ error: "This shared workspace is unavailable." }, { status: error instanceof TaskShareUnavailable ? 404 : 503, headers: publicShareHeaders });
    }
}
export async function HEAD(request: NextRequest, context: Context) {
    const response = await GET(request, context);
    return new NextResponse(null, { status: response.status, headers: response.headers });
}
