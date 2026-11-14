import type { NextRequest } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { createWikiApiHandlers } from "@/lib/wiki-api-handlers";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import * as store from "@/lib/wiki-store";

export const runtime = "nodejs";

const handlers = createWikiApiHandlers({ store, requireUser: requireTaskboardUserFromHeaders, isDatabaseConfigured });
export function GET(request: NextRequest, context: { params: Promise<{ spaceId: string }> }) {
  return handlers.getSpace(request, context);
}
export function PATCH(request: NextRequest, context: { params: Promise<{ spaceId: string }> }) {
  return handlers.updateSpace(request, context);
}
export function DELETE(request: NextRequest, context: { params: Promise<{ spaceId: string }> }) {
  return handlers.removeSpace(request, context);
}
