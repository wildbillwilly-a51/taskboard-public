import { getTimeZoneOffsetMs, getZonedDay, getZonedHourInstant } from "./task-schedule";
import type { TimeSpan } from "./work-windows";

const HOUR_MS = 60 * 60 * 1000;
const NIGHT_START_HOUR = 18;
const NIGHT_END_HOUR = 6;

export type TimelineTick = { at: number; label: string };

// Axis ticks and night shading for a timeline strip. Days and nights follow
// the task's time zone, not the viewer's, and each one is resolved on its own
// calendar day so a DST change shifts it by an hour instead of drifting.
export function getTimelineAxis(range: TimeSpan, timeZone: string) {
  const spanHours = (range.end - range.start) / HOUR_MS;
  const ticks: TimelineTick[] = [];
  const nights: TimeSpan[] = [];
  if (spanHours > 36) {
    const dayLabel = new Intl.DateTimeFormat("en-US", { weekday: "short", day: "numeric", timeZone });
    const first = getZonedDay(range.start, timeZone);
    const onDay = (offset: number, hour: number) => getZonedHourInstant({ ...first, day: first.day + offset }, hour, timeZone);
    for (let offset = 0, at = onDay(0, 0); at < range.end; at = onDay(++offset, 0)) {
      if (at >= range.start) ticks.push({ at, label: dayLabel.format(at) });
    }
    // Start with the night before the first day, which may cover its early hours.
    for (let offset = -1, start = onDay(-1, NIGHT_START_HOUR); start < range.end; start = onDay(++offset, NIGHT_START_HOUR)) {
      const end = onDay(offset + 1, NIGHT_END_HOUR);
      if (end > range.start) nights.push({ start, end });
    }
  } else {
    const hourLabel = new Intl.DateTimeFormat("en-US", { hour: "numeric", timeZone });
    const step = spanHours > 18 ? 2 : 1;
    // Align to the top of the hour in the task's zone (some zones sit on the half hour).
    const offsetMs = getTimeZoneOffsetMs(range.start, timeZone);
    const first = Math.floor((range.start + offsetMs) / HOUR_MS) * HOUR_MS - offsetMs;
    for (let at = first; at <= range.end; at += step * HOUR_MS) {
      if (at >= range.start) ticks.push({ at, label: hourLabel.format(at) });
    }
  }
  return { ticks, nights };
}
