"use client";

import { useState, type CSSProperties } from "react";

import type { Task } from "@/lib/taskboard-data";
import { getItemSpan, type TimeSpan } from "@/lib/work-windows";
import { WorkDateTimeInput } from "@/components/work-date-time-input";

// What a subtask save may change (see subtask-rule.ts).
export type WorkItemPatch = {
  title?: string;
  status?: "todo" | "done";
  startAt?: string | null;
  endAt?: string | null;
  allDay?: boolean;
};

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

// datetime-local and date inputs work in the viewer's local time.
function pad(value: number) {
  return String(value).padStart(2, "0");
}
function toLocalDateTimeInput(value: number) {
  const date = new Date(value);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
function toLocalDateInput(value: number) {
  return toLocalDateTimeInput(value).slice(0, 10);
}
function fromLocalInput(value: string) {
  if (!value) {
    return null;
  }
  const date = new Date(value.length === 10 ? `${value}T00:00` : value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

// Sets, changes, or clears a subtask's time. The work list and the board
// both open it.
export function WorkItemTimeEditor({
  item,
  parentSpan,
  depth,
  onCancel,
  onSave,
}: {
  item: Task;
  parentSpan: TimeSpan | null;
  depth: number;
  onCancel: () => void;
  onSave: (patch: WorkItemPatch) => void | Promise<void>;
}) {
  const current = getItemSpan(item);
  // A new time inside a window starts where the window starts, one hour long.
  const seedStart = current?.start ?? parentSpan?.start ?? null;
  const seedEnd = current?.end ?? (seedStart !== null ? Math.min(seedStart + HOUR_MS, parentSpan?.end ?? Infinity) : null);
  const [allDay, setAllDay] = useState(Boolean(item.allDay));
  const [start, setStart] = useState(seedStart === null ? "" : item.allDay ? toLocalDateInput(seedStart) : toLocalDateTimeInput(seedStart));
  const [end, setEnd] = useState(
    seedEnd === null ? "" : item.allDay ? toLocalDateInput(seedEnd - DAY_MS) : toLocalDateTimeInput(seedEnd),
  );
  const startIso = fromLocalInput(start);
  const endIso = fromLocalInput(end);
  const isValid = Boolean(startIso && endIso && (allDay ? endIso >= startIso : endIso > startIso));

  return (
    <div className="work-time-editor" style={{ "--work-depth": depth } as CSSProperties} data-testid="task-subtask-time-editor">
      {allDay ? (
        <>
          <label className="work-time-field">
            <span>First day</span>
            <input type="date" value={start} onChange={(event) => setStart(event.target.value)} className="work-input" />
          </label>
          <label className="work-time-field">
            <span>Last day</span>
            <input type="date" value={end} onChange={(event) => setEnd(event.target.value)} className="work-input" />
          </label>
        </>
      ) : (
        <>
          <WorkDateTimeInput
            label="Start"
            value={start}
            onChange={(next) => {
              setStart(next);
              // Keep the end after the start: a fresh end lands one hour later.
              const nextStart = fromLocalInput(next);
              if (nextStart && (!endIso || endIso <= nextStart)) {
                setEnd(toLocalDateTimeInput(new Date(nextStart).getTime() + HOUR_MS));
              }
            }}
          />
          <WorkDateTimeInput label="End" value={end} onChange={setEnd} />
        </>
      )}
      <label className="work-time-check">
        <input
          type="checkbox"
          checked={allDay}
          onChange={(event) => {
            const nextAllDay = event.target.checked;
            setAllDay(nextAllDay);
            setStart((value) => (value ? (nextAllDay ? value.slice(0, 10) : `${value.slice(0, 10)}T20:00`) : value));
            setEnd((value) => (value ? (nextAllDay ? value.slice(0, 10) : `${value.slice(0, 10)}T21:00`) : value));
          }}
        />
        All day
      </label>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className="work-button work-button-primary"
          disabled={!isValid}
          onClick={() => void onSave({ startAt: startIso, endAt: endIso, allDay })}
        >
          Save time
        </button>
        {current ? (
          <button type="button" className="work-button" onClick={() => void onSave({ startAt: null, endAt: null, allDay: false })}>
            Clear time
          </button>
        ) : null}
        <button type="button" className="work-button" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
