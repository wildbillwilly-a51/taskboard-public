// Typed times for the subtask time field. Values are "HH:mm" in 24-hour time;
// the field shows them as "8:30 PM".

function pad(value: number) {
  return String(value).padStart(2, "0");
}

// Reads what people type: "8", "8p", "8:30 pm", "830p", "20:30", "2030",
// "noon", "midnight". A bare hour without am or pm is read as written (so "8"
// is 8 AM and "20" is 8 PM). Returns null when it is not a time.
export function parseTimeText(text: string): string | null {
  const value = text.trim().toLowerCase().replace(/\./g, "");
  if (!value) {
    return null;
  }
  if (value === "noon") {
    return "12:00";
  }
  if (value === "midnight") {
    return "00:00";
  }

  const match = /^(\d{1,2})(?::?(\d{2}))?\s*(a|am|p|pm)?$/.exec(value);
  if (!match) {
    return null;
  }

  let hours = Number(match[1]);
  const minutes = match[2] ? Number(match[2]) : 0;
  const meridiem = match[3]?.[0];
  if (minutes > 59) {
    return null;
  }

  if (meridiem) {
    if (hours < 1 || hours > 12) {
      return null;
    }
    hours = (hours % 12) + (meridiem === "p" ? 12 : 0);
  } else if (hours > 23) {
    return null;
  }

  return `${pad(hours)}:${pad(minutes)}`;
}

export function formatTimeText(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return "";
  }

  const hours = Number(match[1]);
  const meridiem = hours < 12 ? "AM" : "PM";
  return `${hours % 12 === 0 ? 12 : hours % 12}:${match[2]} ${meridiem}`;
}

// The choices in the time list: every 15 minutes of the day.
export const QUARTER_HOUR_TIMES = Array.from({ length: 96 }, (_, index) =>
  `${pad(Math.floor(index / 4))}:${pad((index % 4) * 15)}`,
);

// The list entry at or just before a time, so the list opens where the value is.
export function nearestQuarterHourIndex(value: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    return -1;
  }
  return Number(match[1]) * 4 + Math.floor(Number(match[2]) / 15);
}
