import type { NextRequest } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { createWikiApiHandlers } from "@/lib/wiki-api-handlers";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import * as store from "@/lib/wiki-store";

export const runtime = "nodejs";

const handlers = createWikiApiHandlers({ store, requireUser: requireTaskboardUserFromHeaders, isDatabaseConfigured });
export function POST(request: NextRequest, context: { params: Promise<{ noteId: string; versionId: string }> }) {
  return handlers.restoreVersion(request, context);
}
