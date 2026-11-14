import dayjs, { type Dayjs } from "dayjs";

export type MobileCalendarRange = { start: string | Dayjs; end: string | Dayjs; allDay?: boolean };
export const MOBILE_CALENDAR_HOUR_HEIGHT = 56;

// End dates are exclusive, including all-day dates. A zero-duration event still
// belongs to its starting day. Slice by local dates, not fixed 24-hour offsets.
export function occursOnCalendarDay(event: MobileCalendarRange, date: Dayjs) {
  const start = dayjs(event.start);
  const end = dayjs(event.end);
  const day = date.startOf("day");
  return start.isBefore(day.add(1, "day")) && (end.isAfter(day) || start.isSame(day, "day"));
}

export function mobileCalendarWeek(date: Dayjs) {
  return date.startOf("day").subtract((date.day() + 6) % 7, "day");
}

export function calendarTimelineLayout<T extends MobileCalendarRange>(events: T[], date: Dayjs) {
  const day = date.startOf("day");
  const clockMinute = (value: Dayjs) => value.hour() * 60 + value.minute();
  const segments = events.filter(event => !event.allDay && occursOnCalendarDay(event, day)).map(event => {
    const start = dayjs(event.start);
    const end = dayjs(event.end);
    const from = start.isBefore(day) ? 0 : clockMinute(start);
    const to = end.isSame(day, "day") ? Math.max(from + 1, clockMinute(end)) : 1440;
    return { event, from, to: Math.min(1440, to), lane: 0, lanes: 1 };
  }).sort((a, b) => a.from - b.from || b.to - a.to);
  // Assign lanes per overlap group; an unrelated later meeting gets full width.
  let group: typeof segments = [];
  let groupEnd = -1;
  let ends: number[] = [];
  const finish = () => { for (const item of group) item.lanes = ends.length; };
  for (const item of segments) {
    if (item.from >= groupEnd) { finish(); group = []; ends = []; }
    let lane = ends.findIndex(end => end <= item.from);
    if (lane < 0) lane = ends.length;
    // The visible mark follows duration; its touch target is at least 44px.
    // Keep short adjacent targets in different lanes so neither steals taps.
    const hitEnd = Math.max(item.to, item.from + 44 * 60 / MOBILE_CALENDAR_HOUR_HEIGHT);
    ends[lane] = hitEnd;
    item.lane = lane;
    group.push(item);
    groupEnd = Math.max(...ends);
  }
  finish();
  return {
    segments,
    firstHour: Math.min(7, ...segments.map(item => Math.floor(item.from / 60))),
    lastHour: Math.min(24, Math.max(20, ...segments.map(item => Math.ceil(item.to / 60)))),
  };
}
