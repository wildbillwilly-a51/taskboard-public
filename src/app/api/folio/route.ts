import { NextRequest, NextResponse } from "next/server";
import { requireTaskboardUserFromHeaders } from "@/lib/taskboard-request";
import {
  assertNotesRequestFields,
  readNotesJsonBody,
  notesRouteErrorResponse,
} from "@/lib/notes-route";
import { WikiRuleError } from "@/lib/notes-errors";
import { isUuid } from "@/lib/notes-model";
import {
  browseFolioTasks,
  changeFolioConnection,
  createFolioNote,
  createFolioSpace,
  folioHistory,
  getFolioHistoryVersion,
  getFolioLibrary,
  getFolioRevision,
  getFolioSpacePage,
  getFolioTaskTarget,
  listFolioNotes,
  manageFolioSpace,
  manageFolioSpaces,
  restoreFolioVersion,
  setFolioFavorite,
  searchFolioTargets,
  restoreFolioTaskSpace,
} from "@/lib/folio-store";
import { maxFolioSpaceSelection, type FolioView } from "@/lib/folio-model";
import { adoptLegacyFolioNote } from "@/lib/folio-legacy-store";

export const runtime = "nodejs";
const json = (value: unknown) =>
  NextResponse.json(
    { ok: true, ...(value as object) },
    { headers: { "Cache-Control": "private, no-store" } },
  );
const invalid = () =>
  new WikiRuleError("invalid_folio_request", "Invalid Folio request.", 400);
function id(value: unknown): string {
  if (!isUuid(value)) throw invalid();
  return value;
}
function bool(value: unknown): boolean {
  if (typeof value !== "boolean") throw invalid();
  return value;
}
function offset(value: string | null) {
  const n = value === null ? 0 : Number(value);
  if (!Number.isSafeInteger(n) || n < 0) throw invalid();
  return n;
}
export async function GET(request: NextRequest) {
  try {
    const user = await requireTaskboardUserFromHeaders(request),
      p = request.nextUrl.searchParams;
    if ([...p.keys()].some((k) => p.getAll(k).length !== 1)) throw invalid();
    switch (p.get("action") ?? "library") {
      case "library":
        return json(await getFolioLibrary(user));
      case "revision":
        return json({ revision: await getFolioRevision(user) });
      case "tasks":
        return json(
          await browseFolioTasks(
            user,
            id(p.get("boardId")),
            p.get("q") ?? "",
            offset(p.get("offset")),
          ),
        );
      case "targets":
        return json(
          await searchFolioTargets(
            user,
            p.get("q") ?? "",
            offset(p.get("offset")),
          ),
        );
      case "page":
        return json({
          note: await getFolioSpacePage(user, id(p.get("spaceId"))),
        });
      case "taskTarget":
        return json(await getFolioTaskTarget(user, id(p.get("taskId"))));
      case "history":
        return json(
          await folioHistory(
            user,
            id(p.get("noteId")),
            offset(p.get("offset")),
            p.has("beforeVersion") ? offset(p.get("beforeVersion")) : undefined,
          ),
        );
      case "historyVersion":
        return json({
          version: await getFolioHistoryVersion(
            user,
            id(p.get("noteId")),
            id(p.get("versionId")),
          ),
        });
      case "list": {
        const kind = p.get("view") ?? "home";
        if (
          ![
            "home",
            "favorites",
            "unconnected",
            "trash",
            "archive",
            "search",
            "space",
          ].includes(kind)
        )
          throw invalid();
        const view: FolioView =
          kind === "space"
            ? { kind, spaceId: id(p.get("spaceId")) }
            : { kind: kind as Exclude<FolioView["kind"], "space"> };
        return json(
          await listFolioNotes(user, {
            view,
            query: p.get("q") ?? undefined,
            offset: offset(p.get("offset")),
          }),
        );
      }
      default:
        throw invalid();
    }
  } catch (error) {
    return notesRouteErrorResponse(error, "Unable to load Folio.");
  }
}
export async function POST(request: NextRequest) {
  try {
    const user = await requireTaskboardUserFromHeaders(request),
      b = await readNotesJsonBody(request);
    const fields = (allowed: string[]) =>
      assertNotesRequestFields(b, ["action", ...allowed]);
    switch (b.action) {
      case "createNote": {
        fields(["title", "content"]);
        return json({
          note: await createFolioNote(user, {
            title: b.title,
            content: b.content,
          }),
        });
      }
      case "connect":
        fields(["noteId", "spaceId", "add"]);
        return json(
          await changeFolioConnection(
            user,
            id(b.noteId),
            id(b.spaceId),
            bool(b.add),
          ),
        );
      case "adoptLegacy":
        fields(["noteId", "spaceId", "expectedVersion"]);
        if (!Number.isSafeInteger(b.expectedVersion)) throw invalid();
        return json({
          note: await adoptLegacyFolioNote(
            user,
            id(b.noteId),
            id(b.spaceId),
            Number(b.expectedVersion),
          ),
        });
      case "restoreTaskSpace":
        fields(["spaceId"]);
        await restoreFolioTaskSpace(user, id(b.spaceId));
        return json({});
      case "favorite":
        fields(["noteId", "favorite"]);
        return json({
          note: await setFolioFavorite(user, id(b.noteId), bool(b.favorite)),
        });
      case "createSpace":
        fields(["title", "parentId", "personal"]);
        return json(
          await createFolioSpace(user, {
            title: b.title,
            parentId: b.parentId === null ? null : id(b.parentId),
            personal: bool(b.personal),
          }),
        );
      case "manageSpace": {
        fields(["spaceId", "title", "parentId", "archived", "remove", "share"]);
        const input: {
          title?: unknown;
          parentId?: string | null;
          archived?: boolean;
          remove?: boolean;
          share?: boolean;
        } = {};
        if ("title" in b) input.title = b.title;
        if ("parentId" in b)
          input.parentId = b.parentId === null ? null : id(b.parentId);
        if ("archived" in b) input.archived = bool(b.archived);
        if ("remove" in b) input.remove = bool(b.remove);
        if ("share" in b) {
          if (!("parentId" in b)) throw invalid();
          input.share = bool(b.share);
        }
        if (
          !Object.keys(input).length ||
          (input.remove && Object.keys(input).length !== 1)
        )
          throw invalid();
        await manageFolioSpace(user, id(b.spaceId), input);
        return json({});
      }
      case "manageSpaces": {
        if (!Array.isArray(b.spaceIds) || b.spaceIds.length > maxFolioSpaceSelection) throw invalid();
        const spaceIds = b.spaceIds.map(id);
        if ("parentId" in b) {
          fields(["spaceIds", "parentId", "share"]);
          await manageFolioSpaces(user, spaceIds, {
            parentId: b.parentId === null ? null : id(b.parentId),
            share: "share" in b && bool(b.share),
          });
        } else if (b.archived === true) {
          fields(["spaceIds", "archived"]);
          await manageFolioSpaces(user, spaceIds, { archived: true });
        } else if (b.remove === true) {
          fields(["spaceIds", "remove"]);
          await manageFolioSpaces(user, spaceIds, { remove: true });
        } else {
          throw invalid();
        }
        return json({});
      }
      case "restoreVersion":
        fields([
          "noteId",
          "versionId",
          "expectedVersion",
          "expectedSnapshotToken",
        ]);
        if (
          typeof b.expectedSnapshotToken !== "string" ||
          !/^[a-f0-9]{64}$/.test(b.expectedSnapshotToken)
        )
          throw invalid();
        if (
          !Number.isSafeInteger(b.expectedVersion) ||
          Number(b.expectedVersion) < 1
        )
          throw invalid();
        return json({
          note: await restoreFolioVersion(
            user,
            id(b.noteId),
            id(b.versionId),
            Number(b.expectedVersion),
            b.expectedSnapshotToken as string | undefined,
          ),
        });
      default:
        throw invalid();
    }
  } catch (error) {
    return notesRouteErrorResponse(error, "Unable to update Folio.");
  }
}
