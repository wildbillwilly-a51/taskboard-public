import { formatItemSpan, getItemSpan, type TimedItem } from "./work-windows";

const MINUTE_MS = 60_000;

function localDay(at: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", { year: "numeric", month: "numeric", day: "numeric", timeZone }).formatToParts(at);
  const part = (type: string) => Number(parts.find(value => value.type === type)!.value);
  return Date.UTC(part("year"), part("month") - 1, part("day"));
}

// Use elapsed time for duration, local calendar days for overnight annotations.
export function getTimelineLabels(item: TimedItem, timeZone: string) {
  const span = getItemSpan(item);
  if (!span) return null;
  const minutes = Math.round((span.end - span.start) / MINUTE_MS);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const duration = minutes === 0 ? "<1m" : [hours ? `${hours}h` : "", remainder ? `${remainder}m` : ""].filter(Boolean).join(" ");
  const fullTime = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone });
  const compactTime = (at: number) => fullTime.format(at).replace(":00", "").replace(/\s*AM/, "a").replace(/\s*PM/, "p");
  const days = Math.round((localDay(span.end, timeZone) - localDay(span.start, timeZone)) / 86_400_000);
  const suffix = days ? ` (+${days}d)` : "";
  const fullRange = item.allDay ? formatItemSpan(item, { timeZone }) : `${fullTime.format(span.start)} → ${fullTime.format(span.end)}${suffix}`;
  const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone });
  const lastDay = span.end - 86_400_000;
  const compactRange = item.allDay
    ? localDay(span.start, timeZone) === localDay(lastDay, timeZone)
      ? `${weekday.format(span.start)} · all day`
      : `${weekday.format(span.start)} → ${weekday.format(lastDay)} · all day`
    : `${compactTime(span.start)} → ${compactTime(span.end)}${suffix}`;
  const timestamp = new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone });
  return {
    duration,
    candidates: [`${duration} · ${fullRange}`, `${duration} · ${compactRange}`, duration],
    details: `Start: ${timestamp.format(span.start)}\nEnd: ${timestamp.format(span.end)}${item.allDay ? " (exclusive end of all-day range)" : ""}\nDuration: ${duration}`,
  };
}
