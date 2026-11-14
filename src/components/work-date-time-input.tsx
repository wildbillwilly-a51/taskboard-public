"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import {
  QUARTER_HOUR_TIMES,
  formatTimeText,
  nearestQuarterHourIndex,
  parseTimeText,
} from "@/lib/time-text";

// A date and a time for subtask times. The browser's own date-and-time
// picker scrolls its hour and minute columns several steps per wheel click,
// so the time here is a typed field with a quarter-hour list that moves one
// entry per wheel click. The value stays "YYYY-MM-DDTHH:mm" in local time.
export function WorkDateTimeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const labelId = useId();
  const date = value.slice(0, 10);
  const time = value.slice(11, 16);

  return (
    <div className="work-time-field" role="group" aria-labelledby={labelId}>
      <span id={labelId}>{label}</span>
      <div className="work-date-time">
        <input
          type="date"
          aria-label={`${label} date`}
          value={date}
          onChange={(event) => {
            const nextDate = event.target.value;
            if (nextDate) {
              onChange(`${nextDate}T${time || "08:00"}`);
            }
          }}
          className="work-input work-date-input"
        />
        <WorkTimeCombobox
          label={`${label} time`}
          value={time}
          // A time picked before any date lands on today.
          onChange={(nextTime) => onChange(`${date || todayDateInput()}T${nextTime}`)}
        />
      </div>
    </div>
  );
}

function todayDateInput() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function WorkTimeCombobox({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const wheelRemainderRef = useRef(0);
  const [draft, setDraft] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => nearestQuarterHourIndex(value));
  const shownText = draft ?? formatTimeText(value);

  function open() {
    setActiveIndex(Math.max(0, nearestQuarterHourIndex(value)));
    setIsOpen(true);
  }

  function commitDraft() {
    if (draft === null) {
      return;
    }
    const parsed = parseTimeText(draft);
    if (parsed) {
      onChange(parsed);
    }
    setDraft(null);
  }

  function choose(index: number) {
    onChange(QUARTER_HOUR_TIMES[index]);
    setDraft(null);
    setIsOpen(false);
  }

  // Open with the current value in the middle of the list, and keep the
  // active entry in view while the arrow keys move it.
  useLayoutEffect(() => {
    const list = listRef.current;
    if (!isOpen || !list || activeIndex < 0) {
      return;
    }
    const option = list.children[activeIndex] as HTMLElement | undefined;
    if (!option) {
      return;
    }
    if (option.offsetTop < list.scrollTop || option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = option.offsetTop - (list.clientHeight - option.offsetHeight) / 2;
    }
  }, [activeIndex, isOpen]);

  // One wheel click moves the list one entry. Trackpads send many small
  // deltas, which add up to an entry about every 40px.
  useEffect(() => {
    const list = listRef.current;
    if (!isOpen || !list) {
      return;
    }

    function handleWheel(event: WheelEvent) {
      event.preventDefault();
      const target = list;
      if (!target) {
        return;
      }
      const rowHeight = (target.firstElementChild as HTMLElement | null)?.offsetHeight || 28;
      let steps: number;
      if (event.deltaMode !== WheelEvent.DOM_DELTA_PIXEL) {
        steps = Math.sign(event.deltaY);
      } else {
        wheelRemainderRef.current += event.deltaY;
        if (Math.abs(event.deltaY) >= 40) {
          steps = Math.sign(event.deltaY);
          wheelRemainderRef.current = 0;
        } else {
          steps = Math.trunc(wheelRemainderRef.current / 40);
          wheelRemainderRef.current -= steps * 40;
        }
      }
      target.scrollTop += steps * rowHeight;
    }

    list.addEventListener("wheel", handleWheel, { passive: false });
    return () => list.removeEventListener("wheel", handleWheel);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    function handlePointerDown(event: PointerEvent) {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isOpen]);

  return (
    <div className="work-time-combobox" ref={rootRef}>
      <input
        type="text"
        role="combobox"
        aria-label={label}
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={isOpen && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
        autoComplete="off"
        placeholder="8:00 PM"
        value={shownText}
        onFocus={open}
        onClick={() => {
          if (!isOpen) {
            open();
          }
        }}
        onChange={(event) => {
          setDraft(event.target.value);
          const parsed = parseTimeText(event.target.value);
          if (parsed) {
            setActiveIndex(nearestQuarterHourIndex(parsed));
          }
          setIsOpen(true);
        }}
        onBlur={() => {
          commitDraft();
          setIsOpen(false);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!isOpen) {
              open();
              return;
            }
            setDraft(null);
            setActiveIndex((index) =>
              Math.min(QUARTER_HOUR_TIMES.length - 1, Math.max(0, index + (event.key === "ArrowDown" ? 1 : -1))));
          } else if (event.key === "Enter") {
            event.preventDefault();
            if (draft !== null) {
              commitDraft();
              setIsOpen(false);
            } else if (isOpen && activeIndex >= 0) {
              choose(activeIndex);
            }
          } else if (event.key === "Escape" && (isOpen || draft !== null)) {
            // Closes only the list; the workspace's layered Escape sees it handled.
            event.preventDefault();
            event.stopPropagation();
            setDraft(null);
            setIsOpen(false);
          }
        }}
        className="work-input work-time-input"
      />
      {isOpen ? (
        <ul className="work-time-list" id={listId} ref={listRef} role="listbox" aria-label={label}>
          {QUARTER_HOUR_TIMES.map((option, index) => (
            <li
              key={option}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={option === value}
              data-active={index === activeIndex ? "true" : undefined}
              className="work-time-option"
              onPointerDown={(event) => event.preventDefault()}
              onClick={() => choose(index)}
            >
              {formatTimeText(option)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
