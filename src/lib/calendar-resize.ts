export type CalendarResizeEdge = "start-time" | "end-time" | "start-date" | "end-date";
export type CalendarTaskScheduleScope = "single" | "series";

export type CalendarResizeRange = {
  startAt: string;
  endAt: string;
};

export type CalendarTaskScheduleUpdate = CalendarResizeRange & {
  taskId: string;
};

export const calendarResizeStepMinutes = 15;
export const calendarResizeMinimumDurationMs = calendarResizeStepMinutes * 60 * 1000;
const defaultCalendarTaskDurationMs = 60 * 60 * 1000;

const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

type CalendarResizeTimestampInput = string | Date | { toISOString(): string };

function normalizeCalendarResizeTimestamp(value: CalendarResizeTimestampInput | null | undefined) {
  if (typeof value === "string") {
    return value;
  }

  if (!value) {
    return null;
  }

  try {
    const normalized = value.toISOString();
    return Number.isFinite(Date.parse(normalized)) ? normalized : null;
  } catch {
    return null;
  }
}

export function isTimedCalendarResizeRange(range: CalendarResizeRange) {
  if (dateOnlyPattern.test(range.startAt.trim()) || dateOnlyPattern.test(range.endAt.trim())) {
    return false;
  }

  const startMs = Date.parse(range.startAt);
  const endMs = Date.parse(range.endAt);
  return Number.isFinite(startMs) && Number.isFinite(endMs) && endMs - startMs >= calendarResizeMinimumDurationMs;
}

export function getEffectiveCalendarTaskResizeRange(args: {
  startAt?: CalendarResizeTimestampInput | null;
  endAt?: CalendarResizeTimestampInput | null;
  dueAt?: CalendarResizeTimestampInput | null;
  allDay?: boolean;
}): CalendarResizeRange | null {
  if (args.allDay) {
    return null;
  }

  const startAt = normalizeCalendarResizeTimestamp(args.startAt);
  const endAt = normalizeCalendarResizeTimestamp(args.endAt);
  const dueAt = normalizeCalendarResizeTimestamp(args.dueAt);

  if (startAt && endAt) {
    const range = { startAt, endAt };
    return isTimedCalendarResizeRange(range) ? range : null;
  }

  const singleDate = startAt ?? endAt ?? dueAt;
  if (!singleDate || dateOnlyPattern.test(singleDate.trim())) {
    return null;
  }

  const startMs = Date.parse(singleDate);
  if (!Number.isFinite(startMs)) {
    return null;
  }

  return {
    startAt: new Date(startMs).toISOString(),
    endAt: new Date(startMs + defaultCalendarTaskDurationMs).toISOString(),
  };
}

export function getCalendarResizeEdges(view: "month" | "week" | "day"):
  CalendarResizeEdge[] {
  if (view === "month") {
    return ["start-date", "end-date"];
  }

  if (view === "week") {
    return ["start-time", "end-time", "start-date", "end-date"];
  }

  return ["start-time", "end-time"];
}

function addLocalDays(value: string, days: number) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function moveToLocalDate(value: string, targetDate: string) {
  const source = new Date(value);
  const target = new Date(targetDate);
  target.setHours(
    source.getHours(),
    source.getMinutes(),
    source.getSeconds(),
    source.getMilliseconds(),
  );
  return target.toISOString();
}

export function resizeCalendarRangeToDateSpan(
  range: CalendarResizeRange,
  startDate: string,
  endDateExclusive: string,
) {
  const inclusiveEndDate = new Date(endDateExclusive);
  inclusiveEndDate.setDate(inclusiveEndDate.getDate() - 1);

  return acceptCalendarResizeRange({
    startAt: moveToLocalDate(range.startAt, startDate),
    endAt: moveToLocalDate(range.endAt, inclusiveEndDate.toISOString()),
  });
}

function acceptCalendarResizeRange(range: CalendarResizeRange) {
  return isTimedCalendarResizeRange(range) ? range : null;
}

export function resizeCalendarRangeByKeyboard(
  range: CalendarResizeRange,
  edge: CalendarResizeEdge,
  direction: -1 | 1,
) {
  const stepMs = calendarResizeStepMinutes * 60 * 1000;

  switch (edge) {
    case "start-time":
      return acceptCalendarResizeRange({
        ...range,
        startAt: new Date(Date.parse(range.startAt) + direction * stepMs).toISOString(),
      });
    case "end-time":
      return acceptCalendarResizeRange({
        ...range,
        endAt: new Date(Date.parse(range.endAt) + direction * stepMs).toISOString(),
      });
    case "start-date":
      return acceptCalendarResizeRange({
        ...range,
        startAt: addLocalDays(range.startAt, direction),
      });
    case "end-date":
      return acceptCalendarResizeRange({
        ...range,
        endAt: addLocalDays(range.endAt, direction),
      });
  }
}
