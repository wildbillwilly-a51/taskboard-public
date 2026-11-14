import type { CalendarEntry } from "@/lib/taskboard-data";

export type TaskboardCalendarEntryEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  allDay?: boolean;
  color: string;
  backgroundColor: string;
  location?: string;
  data: {
    kind: "calendar-entry";
    source: "Taskboard Calendar";
    sourceType: "calendar-event";
    status: "Calendar item";
    badge: "Calendar item";
    owner: "Taskboard";
    readOnly: false;
    calendarEntryId: string;
    boardId: string;
    linkedTaskId?: string;
    tone: "calendar";
    location?: string;
    summary?: string;
  };
};

function hexToRgba(value: string, alpha: number) {
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());

  if (!match) {
    return `rgba(20, 184, 166, ${alpha})`;
  }

  const hex = match[1];
  const red = Number.parseInt(hex.slice(0, 2), 16);
  const green = Number.parseInt(hex.slice(2, 4), 16);
  const blue = Number.parseInt(hex.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

export function mapCalendarEntriesToCalendarEvents(
  entries: CalendarEntry[],
): TaskboardCalendarEntryEvent[] {
  return entries
    .filter((entry) => !entry.linkedTaskId)
    .map((entry) => ({
      id: `calendar-entry-${entry.id}`,
      title: entry.title,
      start: entry.startAt,
      end: entry.endAt,
      ...(entry.allDay ? { allDay: true } : {}),
      color: entry.color,
      backgroundColor: hexToRgba(entry.color, 0.16),
      ...(entry.location ? { location: entry.location } : {}),
      data: {
        kind: "calendar-entry",
        source: "Taskboard Calendar",
        sourceType: "calendar-event",
        status: "Calendar item",
        badge: "Calendar item",
        owner: "Taskboard",
        readOnly: false,
        calendarEntryId: entry.id,
        boardId: entry.boardId,
        ...(entry.linkedTaskId ? { linkedTaskId: entry.linkedTaskId } : {}),
        tone: "calendar",
        ...(entry.location ? { location: entry.location } : {}),
        ...(entry.description ? { summary: entry.description } : {}),
      },
    }));
}
