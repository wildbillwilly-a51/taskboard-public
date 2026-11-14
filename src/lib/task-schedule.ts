export type RememberedTaskScheduleTimes = {
  startTime: string;
  endTime: string;
};

function splitEditorDateTime(value: string) {
  const [date = "", time = ""] = value.split("T");
  return { date, time: time.slice(0, 5) };
}

function combineEditorDateTime(date: string, time: string) {
  return date ? `${date}T${time || "00:00"}` : "";
}

export function getRememberedTaskScheduleTimes(
  startAt: string,
  endAt: string,
): RememberedTaskScheduleTimes {
  return {
    startTime: splitEditorDateTime(startAt).time,
    endTime: splitEditorDateTime(endAt).time,
  };
}

export function getTaskScheduleForAllDayToggle({
  endAt,
  nextAllDay,
  rememberedTimes,
  startAt,
}: {
  endAt: string;
  nextAllDay: boolean;
  rememberedTimes: RememberedTaskScheduleTimes;
  startAt: string;
}) {
  const start = splitEditorDateTime(startAt);
  const end = splitEditorDateTime(endAt);

  return {
    startAt:
      start.date && (nextAllDay || rememberedTimes.startTime)
        ? combineEditorDateTime(
            start.date,
            nextAllDay ? "00:00" : rememberedTimes.startTime,
          )
        : startAt,
    endAt:
      end.date && (nextAllDay || rememberedTimes.endTime)
        ? combineEditorDateTime(
            end.date,
            nextAllDay ? "00:00" : rememberedTimes.endTime,
          )
        : endAt,
  };
}

function isValidTimeZone(timeZone: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone }).format(0);
    return true;
  } catch {
    return false;
  }
}

// How far a time zone's wall clock runs ahead of UTC at an instant.
export function getTimeZoneOffsetMs(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  const wallClockAsUtc = Date.UTC(
    value("year"),
    value("month") - 1,
    value("day"),
    value("hour"),
    value("minute"),
    value("second"),
  );
  return wallClockAsUtc - Math.floor(instant / 1000) * 1000;
}

export type ZonedDay = { year: number; month: number; day: number };

// The calendar day an instant falls on in a time zone (month is 1-based).
export function getZonedDay(instant: number, timeZone: string): ZonedDay {
  const dateParts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(instant);
  const value = (type: string) => Number(dateParts.find((part) => part.type === type)?.value);
  return { year: value("year"), month: value("month"), day: value("day") };
}

// The instant a wall-clock hour on a calendar day occurs in a time zone. Days
// past the end of a month roll over, so callers can step with `day + n`.
export function getZonedHourInstant({ year, month, day }: ZonedDay, hour: number, timeZone: string) {
  const wallClockAsUtc = Date.UTC(year, month - 1, day, hour);
  let instant = wallClockAsUtc - getTimeZoneOffsetMs(wallClockAsUtc, timeZone);
  // Re-resolve once in case a DST change falls between the guess and the hour.
  instant = wallClockAsUtc - getTimeZoneOffsetMs(instant, timeZone);
  return instant;
}

// A task saved without a date starts today as an all-day task. All-day starts
// are stored as local midnight, matching the editor's all-day toggle, so the
// day is resolved in the viewer's time zone (the server's when none is valid).
export function getStartOfTodayInTimeZone(now: Date, timeZone?: string | null) {
  const zone =
    timeZone && isValidTimeZone(timeZone)
      ? timeZone
      : Intl.DateTimeFormat().resolvedOptions().timeZone;
  return new Date(getZonedHourInstant(getZonedDay(now.getTime(), zone), 0, zone)).toISOString();
}
