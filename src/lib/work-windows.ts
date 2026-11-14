// Subtask times inside a task or outage. A subtask with a start and end is
// scheduled work; when it also has children, it reads as a window the
// children fill. Everything here is derived: nothing extra is stored.

export type TimedItem = {
  startAt?: string | null;
  endAt?: string | null;
  allDay?: boolean;
};

export type TimeSpan = { start: number; end: number };

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// The span an item covers, in epoch milliseconds. All-day items store their
// last day inclusively, so they run to the end of that day. An item without
// both dates has no span.
export function getItemSpan(item: TimedItem): TimeSpan | null {
  if (!item.startAt || !item.endAt) {
    return null;
  }

  const start = new Date(item.startAt).getTime();
  let end = new Date(item.endAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) {
    return null;
  }

  if (item.allDay) {
    end += DAY_MS;
  }

  return end > start ? { start, end } : null;
}

// Total length of the spans with overlaps counted once.
export function getUnionMs(spans: TimeSpan[]) {
  const sorted = [...spans].sort((left, right) => left.start - right.start);
  let total = 0;
  let current: TimeSpan | null = null;

  for (const span of sorted) {
    if (!current || span.start > current.end) {
      if (current) {
        total += current.end - current.start;
      }
      current = { ...span };
    } else {
      current.end = Math.max(current.end, span.end);
    }
  }

  return current ? total + (current.end - current.start) : total;
}

export type WindowFill = {
  totalHours: number;
  scheduledHours: number;
};

// How much of a window its children's times cover. Parallel work counts once,
// and only the part inside the window counts.
export function getWindowFill(window: TimedItem, children: TimedItem[]): WindowFill | null {
  const span = getItemSpan(window);
  if (!span) {
    return null;
  }

  const clipped = children
    .map(getItemSpan)
    .filter((child): child is TimeSpan => child !== null)
    .map((child) => ({ start: Math.max(child.start, span.start), end: Math.min(child.end, span.end) }))
    .filter((child) => child.end > child.start);

  return {
    totalHours: roundHours((span.end - span.start) / HOUR_MS),
    scheduledHours: roundHours(getUnionMs(clipped) / HOUR_MS),
  };
}

export function isOutsideWindow(window: TimedItem, child: TimedItem) {
  const outer = getItemSpan(window);
  const inner = getItemSpan(child);
  return Boolean(outer && inner && (inner.start < outer.start || inner.end > outer.end));
}

export function roundHours(hours: number) {
  return Math.round(hours * 10) / 10;
}

export function formatHours(hours: number) {
  return Number.isInteger(hours) ? String(hours) : hours.toFixed(1);
}

type FormatOptions = { timeZone: string; includeDay?: boolean };

function formatParts(date: Date, timeZone: string) {
  const day = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    timeZone,
  }).format(date).replace(",", "");
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    timeZone,
  }).format(date);
  return { day, time };
}

// "Tue Dec 8 · 8:00 PM → 5:00 AM" for a window that runs overnight,
// "8:30 PM → 10:30 PM" inside a window (includeDay false), and
// "Mon Dec 7 → Thu Dec 10" for all-day spans. Spans over a day name both days.
export function formatItemSpan(item: TimedItem, { timeZone, includeDay = true }: FormatOptions) {
  const span = getItemSpan(item);
  if (!span) {
    return "";
  }

  const start = formatParts(new Date(span.start), timeZone);

  if (item.allDay) {
    const lastDay = formatParts(new Date(span.end - DAY_MS), timeZone);
    return lastDay.day === start.day ? `${start.day} · all day` : `${start.day} → ${lastDay.day}`;
  }

  const end = formatParts(new Date(span.end), timeZone);
  if (span.end - span.start > DAY_MS) {
    return `${start.day} ${start.time} → ${end.day} ${end.time}`;
  }

  const times = `${start.time} → ${end.time}`;
  return includeDay ? `${start.day} · ${times}` : times;
}
