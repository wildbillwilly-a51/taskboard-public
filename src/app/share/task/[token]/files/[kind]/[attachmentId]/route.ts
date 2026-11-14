import { NextRequest, NextResponse } from "next/server";
import { createReadStream } from "node:fs";
import { Readable } from "node:stream";
import { getPublicTaskFile, TaskShareUnavailable } from "@/lib/public-task-share-store";
import { publicShareHeaders } from "@/lib/public-task-share-model";
export const dynamic = "force-dynamic";
type Context = {
    params: Promise<{
        token: string;
        kind: string;
        attachmentId: string;
    }>;
};
async function serve(request: NextRequest, context: Context, head = false) {
    try {
        const { token, kind, attachmentId } = await context.params;
        const file = await getPublicTaskFile(token, kind, attachmentId);
        const inline = request.nextUrl.searchParams.get("inline") === "1" && file.preview !== "none";
        const headers: Record<string, string> = { ...publicShareHeaders,
            "Content-Type": inline ? file.mime : "application/octet-stream",
            "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(file.name.replace(/[\r\n]/g, ""))}`,
            // HTML sandboxing disables Chromium's native PDF viewer. Only signature-
            // checked bitmaps/PDFs render inline; executable document types download.
            "Content-Security-Policy": "default-src 'none'; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-ancestors 'self'",
            "Accept-Ranges": "bytes",
        };
        let status = 200, start = 0, end = file.sizeBytes - 1;
        const range = request.headers.get("range");
        if (range) {
            const match = /^bytes=(\d*)-(\d*)$/.exec(range);
            start = match?.[1] ? Number(match[1]) : Math.max(0, file.sizeBytes - Number(match?.[2] || 0));
            end = match?.[1] && match[2] ? Math.min(Number(match[2]), file.sizeBytes - 1) : file.sizeBytes - 1;
            if (!match || !Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= file.sizeBytes)
                return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${file.sizeBytes}` } });
            headers["Content-Range"] = `bytes ${start}-${end}/${file.sizeBytes}`;
            status = 206;
        }
        headers["Content-Length"] = String(Math.max(0, end - start + 1));
        const body = head || !file.sizeBytes ? null : Readable.toWeb(createReadStream(file.diskPath, { start, end })) as ReadableStream<Uint8Array>;
        return new NextResponse(body, { status, headers });
    }
    catch (error) {
        return NextResponse.json({ error: "This shared workspace is unavailable." }, { status: error instanceof TaskShareUnavailable ? 404 : 503, headers: publicShareHeaders });
    }
}
export const GET = (request: NextRequest, context: Context) => serve(request, context);
export const HEAD = (request: NextRequest, context: Context) => serve(request, context, true);
