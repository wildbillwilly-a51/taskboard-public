import { NextRequest, NextResponse } from "next/server";
import { boardRouteErrorResponse, getBoardContextFromRequest } from "@/lib/board-route";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { deleteBucket, getBoardStateFromDatabase, updateBucket } from "@/lib/taskboard-store";
import type { BucketIcon } from "@/lib/taskboard-data";

type RouteContext = {
  params: Promise<{
    bucketId: string;
  }>;
};

export async function PATCH(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const { bucketId } = await context.params;
  const user = await requireTaskboardUserFromHeaders(request);
  const body = (await request.json()) as {
    boardId?: string;
    collapsed?: boolean;
    title?: string;
    color?: string;
    icon?: BucketIcon;
  };
  const boardContext = getBoardContextFromRequest(request, body);

  if (
    typeof body.collapsed !== "boolean" &&
    typeof body.title !== "string" &&
    typeof body.color !== "string" &&
    typeof body.icon !== "string"
  ) {
    return NextResponse.json(
      { error: "Provide title, collapsed, color, and/or icon." },
      { status: 400 },
    );
  }

  if (typeof body.title === "string" && !body.title.trim()) {
    return NextResponse.json({ error: "title must not be empty." }, { status: 400 });
  }

  try {
    await updateBucket(user, bucketId, {
      title: typeof body.title === "string" ? body.title.trim() : undefined,
      collapsed: body.collapsed,
      color: typeof body.color === "string" ? body.color : undefined,
      icon: typeof body.icon === "string" ? body.icon : undefined,
    }, boardContext);

    return NextResponse.json({ ok: true, ...(await getBoardStateFromDatabase(user, boardContext)) });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to update bucket.");
  }
}

export async function DELETE(request: NextRequest, context: RouteContext) {
  if (!isDatabaseConfigured()) {
    return NextResponse.json(
      { error: "Persistence is unavailable because DATABASE_URL is not configured." },
      { status: 503 },
    );
  }

  const { bucketId } = await context.params;
  const user = await requireTaskboardUserFromHeaders(request);
  const boardContext = getBoardContextFromRequest(request);

  try {
    await deleteBucket(user, bucketId, boardContext);
    return NextResponse.json({ ok: true, ...(await getBoardStateFromDatabase(user, boardContext)) });
  } catch (error) {
    return boardRouteErrorResponse(error, "Unable to delete bucket.");
  }
}
