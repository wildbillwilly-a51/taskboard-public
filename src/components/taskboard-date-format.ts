import { useSyncExternalStore } from "react";

export const SERVER_DISPLAY_TIME_ZONE = "UTC";

const DATE_ONLY_VALUE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function subscribeToDisplayTimeZone() {
  return () => {};
}

function getBrowserDisplayTimeZone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || SERVER_DISPLAY_TIME_ZONE;
}

function getServerDisplayTimeZone() {
  return SERVER_DISPLAY_TIME_ZONE;
}

// Server HTML and the hydration pass format in UTC so markup matches; React then
// re-renders each consumer in the viewer's time zone, which inputs also use.
export function useDisplayTimeZone() {
  return useSyncExternalStore(
    subscribeToDisplayTimeZone,
    getBrowserDisplayTimeZone,
    getServerDisplayTimeZone,
  );
}

// Values are typed as strings, but database timestamps can arrive as Date
// objects (pg returns Date and server-to-client serialization preserves it).
type DateValue = string | Date;

function getIsClientSnapshot() {
  return true;
}

function getIsClientServerSnapshot() {
  return false;
}

// False on the server and during hydration, true afterwards. Use it for output
// that depends on the viewer's local date so server HTML always matches.
export function useIsClient() {
  return useSyncExternalStore(subscribeToDisplayTimeZone, getIsClientSnapshot, getIsClientServerSnapshot);
}

const nowMinuteListeners = new Set<() => void>();
let nowMinuteValue = 0;
let nowMinuteTimer: ReturnType<typeof setInterval> | null = null;

function readCurrentMinute() {
  return Math.floor(Date.now() / 60_000) * 60_000;
}

// One shared timer for every consumer; it runs only while something listens.
function subscribeToNowMinute(listener: () => void) {
  nowMinuteListeners.add(listener);

  if (!nowMinuteTimer) {
    nowMinuteValue = readCurrentMinute();
    nowMinuteTimer = setInterval(() => {
      const next = readCurrentMinute();
      if (next !== nowMinuteValue) {
        nowMinuteValue = next;
        nowMinuteListeners.forEach((notify) => notify());
      }
    }, 15_000);
  }

  return () => {
    nowMinuteListeners.delete(listener);
    if (nowMinuteListeners.size === 0 && nowMinuteTimer) {
      clearInterval(nowMinuteTimer);
      nowMinuteTimer = null;
    }
  };
}

function getNowMinuteSnapshot() {
  if (!nowMinuteValue) {
    nowMinuteValue = readCurrentMinute();
  }
  return nowMinuteValue;
}

function getNowMinuteServerSnapshot() {
  return null;
}

// The current time to the minute, or null on the server and during hydration.
// Use it for anything that depends on "now", such as overdue markers.
export function useNowMinute(): number | null {
  return useSyncExternalStore(subscribeToNowMinute, getNowMinuteSnapshot, getNowMinuteServerSnapshot);
}

// Date-only strings parse as UTC midnight; format them in UTC so the calendar
// date does not shift. Timestamps use the viewer's display time zone.
function getFormatTimeZone(value: DateValue, timeZone: string) {
  return typeof value === "string" && DATE_ONLY_VALUE_PATTERN.test(value.trim())
    ? SERVER_DISPLAY_TIME_ZONE
    : timeZone;
}

export function formatDate(value: DateValue, timeZone: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Invalid date";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: getFormatTimeZone(value, timeZone),
  }).format(date);
}

export type AgendaGroupLabel = "Earlier" | "Today" | "Tomorrow" | "Next 7 days" | "Later" | "No date";

function startOfLocalDay(value: Date) {
  return new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
}

// Agenda section for an item's timestamp in the viewer's local time. Items
// without a date use Number.POSITIVE_INFINITY, matching the agenda sort.
export function getAgendaGroupLabel(timestamp: number, now = new Date()): AgendaGroupLabel {
  if (!Number.isFinite(timestamp)) {
    return "No date";
  }

  const today = startOfLocalDay(now);
  const tomorrow = startOfLocalDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1));
  const dayAfterTomorrow = startOfLocalDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2));
  const weekAhead = startOfLocalDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7));

  if (timestamp < today) {
    return "Earlier";
  }
  if (timestamp < tomorrow) {
    return "Today";
  }
  if (timestamp < dayAfterTomorrow) {
    return "Tomorrow";
  }
  if (timestamp < weekAhead) {
    return "Next 7 days";
  }
  return "Later";
}

export function formatDateOnly(value: DateValue, timeZone: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "Invalid date";
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: getFormatTimeZone(value, timeZone),
  }).format(date);
}
