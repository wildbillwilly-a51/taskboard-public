import { NextResponse, type NextRequest } from "next/server";
import { OutagePeopleError } from "./outage-people";
import { SharedWorkError } from "./public-task-work-request";
import { TaskShareUnavailable } from "./public-task-share-store";
import { BoardAccessError } from "./board-access";
import { publicShareHeaders } from "./public-task-share-model";
import { getTaskboardPublicOrigin } from "./taskboard-request";

export function requirePeopleOrigin(request: NextRequest) {
  const origin = getTaskboardPublicOrigin({ headers: request.headers, fallbackOrigin: request.url });
  if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") throw new OutagePeopleError("Save from the outage workspace.", 403);
}
export function peopleRouteError(error: unknown) {
  if (error && typeof error === "object" && "code" in error && ["40P01", "40001"].includes(String(error.code))) {
    return NextResponse.json({ error: "The outage changed while saving. Reload and try again." }, { status: 409, headers: publicShareHeaders });
  }
  const unavailable = error instanceof TaskShareUnavailable;
  const known = error instanceof OutagePeopleError || error instanceof SharedWorkError || error instanceof BoardAccessError;
  return NextResponse.json({ error: unavailable ? "This shared workspace is unavailable." : known ? error.message : "Unable to load or save people. Try again." }, { status: unavailable ? 404 : known ? error.status : 503, headers: publicShareHeaders });
}
