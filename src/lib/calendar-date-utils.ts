const dateOnlyPattern = /^\d{4}-\d{2}-\d{2}$/;

export type CalendarTimeSelection = {
  start: Date;
  end: Date;
};

export function normalizeCalendarTimeSelection(
  start: unknown,
  end: unknown,
  minimumMinutes = 15,
): CalendarTimeSelection | null {
  if (!(start instanceof Date) || Number.isNaN(start.getTime())) {
    return null;
  }

  const safeMinimumMinutes = Number.isFinite(minimumMinutes) && minimumMinutes > 0
    ? minimumMinutes
    : 15;
  const minimumEndTime = start.getTime() + safeMinimumMinutes * 60_000;
  const requestedEndTime = end instanceof Date && Number.isFinite(end.getTime())
    ? end.getTime()
    : minimumEndTime;

  return {
    start: new Date(start.getTime()),
    end: new Date(Math.max(requestedEndTime, minimumEndTime)),
  };
}

export function normalizeCalendarTaskDate(value: unknown) {
  if (value instanceof Date) {
    const time = value.getTime();
    return Number.isFinite(time) ? value.toISOString() : undefined;
  }

  if (typeof value !== "string") {
    return undefined;
  }

  const normalized = value.trim();

  if (!normalized) {
    return undefined;
  }

  return Number.isFinite(Date.parse(normalized)) ? normalized : undefined;
}

export function getCalendarFocusDateTime(value: unknown) {
  const normalized = normalizeCalendarTaskDate(value);

  if (!normalized || dateOnlyPattern.test(normalized)) {
    return normalized;
  }

  return new Date(normalized).toISOString();
}

export function getCalendarFocusDate(value: unknown) {
  if (!value) {
    return null;
  }

  const trimmed = typeof value === "string" ? value.trim() : null;

  if (trimmed === "") {
    return null;
  }

  if (trimmed && dateOnlyPattern.test(trimmed)) {
    return trimmed;
  }

  const date = value instanceof Date ? value : trimmed ? new Date(trimmed) : null;

  if (!date || Number.isNaN(date.getTime())) {
    return null;
  }

  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}
