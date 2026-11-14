import "server-only";

import ICAL from "ical.js";

export type ParsedIcsEvent = {
  uid: string;
  title: string;
  description: string;
  location: string;
  startsAt: string;
  endsAt: string | null;
  rawPayload: unknown;
};

export type ParsedIcsImport = {
  events: ParsedIcsEvent[];
  skippedPast: number;
  skippedRecurring: number;
  skippedUnsupported: number;
  errors: string[];
};

export function parseIcsEvents(input: string, fromDate: Date): ParsedIcsImport {
  const result: ParsedIcsImport = {
    events: [],
    skippedPast: 0,
    skippedRecurring: 0,
    skippedUnsupported: 0,
    errors: [],
  };

  let calendar: ICAL.Component;

  try {
    calendar = new ICAL.Component(ICAL.parse(input));
  } catch (error) {
    throw new Error("The selected file is not a valid .ics calendar.", {
      cause: error,
    });
  }

  const topLevelComponents = calendar.getAllSubcomponents();
  result.skippedUnsupported = topLevelComponents.filter((component) =>
    component.name !== "vevent" && component.name !== "vtimezone"
  ).length;

  for (const eventComponent of calendar.getAllSubcomponents("vevent")) {
    if (
      eventComponent.hasProperty("rrule") ||
      eventComponent.hasProperty("rdate") ||
      eventComponent.hasProperty("exdate")
    ) {
      result.skippedRecurring += 1;
      continue;
    }

    try {
      const event = new ICAL.Event(eventComponent);
      const uid = event.uid?.trim();

      if (!uid) {
        result.errors.push("Skipped an event with no UID.");
        continue;
      }

      const startsAt = event.startDate?.toJSDate();

      if (!startsAt || Number.isNaN(startsAt.getTime())) {
        result.errors.push(`Skipped "${event.summary || uid}" because it has no valid start date.`);
        continue;
      }

      if (startsAt < fromDate) {
        result.skippedPast += 1;
        continue;
      }

      const endsAt = event.endDate?.toJSDate();

      result.events.push({
        uid,
        title: normalizeTitle(event.summary, uid),
        description: event.description?.trim() ?? "",
        location: event.location?.trim() ?? "",
        startsAt: startsAt.toISOString(),
        endsAt: endsAt && !Number.isNaN(endsAt.getTime()) ? endsAt.toISOString() : null,
        rawPayload: eventComponent.toJSON(),
      });
    } catch (error) {
      result.errors.push(error instanceof Error ? error.message : "Skipped an unreadable event.");
    }
  }

  return result;
}

function normalizeTitle(value: string | undefined, fallback: string) {
  const title = value?.trim();
  return title || `Imported event ${fallback.slice(0, 8)}`;
}
