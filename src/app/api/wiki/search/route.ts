import type { NextRequest } from "next/server";
import { isDatabaseConfigured } from "@/lib/db";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import { createWikiDiscoveryApiHandlers } from "@/lib/wiki-discovery-api";
import * as topics from "@/lib/wiki-topics-store";
import * as discovery from "@/lib/wiki-discovery-store";

export const runtime = "nodejs";
const handlers = createWikiDiscoveryApiHandlers({ store: { ...topics, ...discovery }, requireUser: requireTaskboardUserFromHeaders, isDatabaseConfigured });
export function GET(request: NextRequest) { return handlers.search(request); }
