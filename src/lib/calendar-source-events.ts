import type { CalendarSource } from "@/lib/taskboard-data";
import type { TaskboardCalendarTaskEvent } from "@/lib/calendar-task-events";

export type ImportedCalendarSourceRow = {
  id: string;
  provider: CalendarSource;
  externalEventId: string | null;
  title: string;
  startsAt: string | Date | null;
  endsAt: string | Date | null;
  location: string;
  syncStatus: "active" | "stale" | "deleted";
  linkedTaskId: string | null;
  linkedTaskIsReadOnlyImport: boolean | null;
  isRecurring: boolean;
};

export type TaskboardCalendarSourceEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  color: string;
  backgroundColor: string;
  location?: string;
  data: {
    kind: "imported-source";
    source: string;
    sourceType: "calendar-event";
    status: string;
    badge: string;
    owner: string;
    readOnly: true;
    importedEventId: string;
    sourceEventId?: string;
    linkedTaskId?: string;
    tone: "stored";
    provider: CalendarSource;
    providerLabel: string;
    syncStatus: "active" | "stale";
    hasRecurrence?: boolean;
    suppressLinkedTaskEvent: boolean;
  };
};

const storedSourceColor = "#64748b";

function normalizeDateValue(value: string | Date | null) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? value.toISOString() : undefined;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed && Number.isFinite(Date.parse(trimmed)) ? trimmed : undefined;
}

function addHours(value: string, hours: number) {
  return new Date(Date.parse(value.trim()) + hours * 60 * 60 * 1000).toISOString();
}

function providerLabel(provider: CalendarSource) {
  switch (provider) {
    case "ics":
      return "ICS";
    case "google":
      return "Google";
    default:
      return "Calendar";
  }
}

function hexToRgba(value: string, alpha: number) {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());

  if (!match) {
    return `rgba(37, 99, 235, ${alpha})`;
  }

  const hex = match[1];
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function mapImportedCalendarSourceEvents(
  rows: ImportedCalendarSourceRow[],
): TaskboardCalendarSourceEvent[] {
  return rows.flatMap((row) => {
    if (row.syncStatus !== "active") {
      return [];
    }

    const start = normalizeDateValue(row.startsAt);

    if (!start) {
      return [];
    }

    const end = normalizeDateValue(row.endsAt) ?? addHours(start, 1);
    const color = storedSourceColor;
    const displayLabel = providerLabel(row.provider);

    return [
      {
        id: `source-${row.provider}-${row.id}`,
        title: row.title,
        start,
        end,
        color,
        backgroundColor: hexToRgba(color, 0.16),
        ...(row.location ? { location: row.location } : {}),
        data: {
          kind: "imported-source",
          source: displayLabel,
          sourceType: "calendar-event",
          status: displayLabel,
          badge: displayLabel,
          owner: displayLabel,
          readOnly: true,
          importedEventId: row.id,
          ...(row.externalEventId ? { sourceEventId: row.externalEventId } : {}),
          ...(row.linkedTaskId ? { linkedTaskId: row.linkedTaskId } : {}),
          tone: "stored",
          provider: row.provider,
          providerLabel: displayLabel,
          syncStatus: row.syncStatus,
          ...(row.isRecurring ? { hasRecurrence: true } : {}),
          suppressLinkedTaskEvent: Boolean(row.linkedTaskId),
        },
      },
    ];
  });
}

export function suppressTaskEventsLinkedToImportedSources(
  taskEvents: TaskboardCalendarTaskEvent[],
  sourceEvents: TaskboardCalendarSourceEvent[],
) {
  const suppressedTaskIds = new Set(
    sourceEvents
      .filter((event) => event.data.suppressLinkedTaskEvent)
      .map((event) => event.data.linkedTaskId)
      .filter((value): value is string => Boolean(value)),
  );

  if (suppressedTaskIds.size === 0) {
    return taskEvents;
  }

  return taskEvents.filter((event) => !suppressedTaskIds.has(event.data.taskId));
}
