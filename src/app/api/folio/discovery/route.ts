import { NextRequest, NextResponse } from "next/server";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import {
  notesRouteErrorResponse,
  readNotesJsonBody,
  assertNotesRequestFields,
} from "@/lib/notes-route";
import {
  discoverFolio,
  readFolioFeatures,
  readFolioPreview,
  recordFolioView,
  setFolioFeatures,
  invalidFeature,
  resolveFolioMentions,
} from "@/lib/folio-discovery-store";
import type { FolioDiscoveryInput } from "@/lib/folio-features-model";
export const runtime = "nodejs";
const json = (v: unknown) =>
  NextResponse.json(v, { headers: { "Cache-Control": "private, no-store" } });
export async function GET(request: NextRequest) {
  try {
    const user = await requireTaskboardUserFromHeaders(request),
      p = request.nextUrl.searchParams;
    if (p.get("action") === "features")
      return json(await readFolioFeatures(user, p.get("noteId") ?? ""));
    if (p.get("action") === "preview")
      return json(await readFolioPreview(user, p.get("noteId") ?? ""));
    const allowed = [
      "q",
      "titleOnly",
      "spaceId",
      "keyword",
      "by",
      "before",
      "after",
      "due",
      "templates",
      "recent",
      "sort",
      "offset",
      "backlinkTo",
    ];
    if (
      [...p.keys()].some(
        (k) => !allowed.includes(k) || p.getAll(k).length !== 1,
      )
    )
      throw invalidFeature();
    const input: FolioDiscoveryInput = {};
    for (const k of [
      "q",
      "spaceId",
      "keyword",
      "by",
      "before",
      "after",
      "backlinkTo",
    ] as const)
      if (p.has(k)) input[k] = p.get(k)!;
    for (const k of ["titleOnly", "due", "templates", "recent"] as const)
      if (p.has(k)) {
        if (!["0", "1"].includes(p.get(k)!)) throw invalidFeature();
        input[k] = p.get(k) === "1";
      }
    if (p.has("sort")) {
      if (!["updated", "title", "created", "recent"].includes(p.get("sort")!))
        throw invalidFeature();
      input.sort = p.get("sort") as FolioDiscoveryInput["sort"];
    }
    if (p.has("offset")) input.offset = Number(p.get("offset"));
    return json(await discoverFolio(user, input));
  } catch (e) {
    return notesRouteErrorResponse(e, "Unable to search Folio.");
  }
}
export async function POST(request: NextRequest) {
  try {
    const user = await requireTaskboardUserFromHeaders(request),
      b = await readNotesJsonBody(request);
    if (b.action === "resolve") {
      assertNotesRequestFields(b, ["action", "noteIds"]);
      if (!Array.isArray(b.noteIds)) throw invalidFeature();
      return json({
        mentions: await resolveFolioMentions(user, { noteIds: b.noteIds }),
      });
    }
    assertNotesRequestFields(b, ["action", "noteId", "features"]);
    if (typeof b.noteId !== "string") throw invalidFeature();
    if (b.action === "view") {
      await recordFolioView(user, b.noteId);
      return json({ ok: true });
    }
    if (
      b.action === "features" &&
      b.features &&
      typeof b.features === "object" &&
      !Array.isArray(b.features)
    )
      return json(
        await setFolioFeatures(
          user,
          b.noteId,
          b.features as Record<string, unknown>,
        ),
      );
    throw invalidFeature();
  } catch (e) {
    return notesRouteErrorResponse(e, "Unable to update note details.");
  }
}
