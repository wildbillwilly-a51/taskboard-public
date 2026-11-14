"use client";

import { ChevronDown, ChevronLeft, ChevronRight, Plus, SlidersHorizontal, X } from "lucide-react";
import dayjs, { type Dayjs } from "dayjs";
import { useRouter } from "next/navigation";
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type RefObject } from "react";
import type { CalendarBoardOption, CalendarPhoneActions } from "@/components/calendar-proof";
import type { CalendarEvent, CalendarEventFilter } from "@/components/calendar-proof-inner";
import { calendarTimelineLayout, mobileCalendarWeek, occursOnCalendarDay, MOBILE_CALENDAR_HOUR_HEIGHT } from "@/lib/mobile-calendar-layout";

type PhoneView = "agenda" | "day" | "week" | "month";
const views: { id: PhoneView; label: string }[] = [{ id: "agenda", label: "Agenda" }, { id: "day", label: "Day" }, { id: "week", label: "Week overview" }, { id: "month", label: "Month + agenda" }];
const filters: { id: CalendarEventFilter; label: string }[] = [{ id: "all", label: "All events" }, { id: "taskboard", label: "Tasks" }, { id: "calendar", label: "Calendar entries" }, { id: "stored", label: "Imports" }, { id: "converted", label: "Converted" }];

function eventType(event: CalendarEvent) {
  if (event.data.workItemType === "maintenance_outage" || event.data.windowRole) return "Outage";
  return ({ "calendar-entry": "Calendar entry", "imported-source": "Import · read-only", "sample-source": "Sample import", "taskboard-task": event.data.importedFrom ? "Converted task" : "Task", "converted-task": "Converted task" })[event.data.kind];
}

function eventClock(event: CalendarEvent, date: Dayjs) {
  if (event.allDay) return "All day";
  return dayjs(event.start).isBefore(date.startOf("day")) ? "Continues" : dayjs(event.start).format("h:mm A");
}

export function PhoneCalendarSheet({ children, label, onClose, busy = false, dirty = false }: {
  children: ReactNode | ((requestClose: () => void) => ReactNode); label: string; onClose: () => void; busy?: boolean; dirty?: boolean;
}) {
  const surface = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const close = useRef<HTMLButtonElement>(null);
  const [confirm, setConfirm] = useState(false);
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const requestClose = () => { if (!busy) { if (dirty) { setPendingHref(null); setConfirm(true); } else onClose(); } };
  useEffect(() => {
    const previous = document.activeElement;
    const header = document.querySelector<HTMLElement>("[data-phone-calendar] .taskboard-mobile-header");
    if (header) header.inert = true;
    // Leave the entry form's autofocus intact; detail sheets start at Close.
    if (!surface.current?.contains(document.activeElement)) close.current?.focus({ preventScroll: true });
    return () => { if (header) header.inert = false; if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true }); };
  }, []);
  useEffect(() => {
    if (confirm) surface.current?.querySelector<HTMLElement>('[role="alertdialog"] button')?.focus();
  }, [confirm]);
  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation();
        if (confirm) { setPendingHref(null); setConfirm(false); } else requestClose();
      }
      if (event.key === "Tab") {
        const items = Array.from(surface.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled)') ?? []).filter(item => item.getClientRects().length && !item.closest("[inert]"));
        const first = items[0], last = items[items.length - 1];
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    const navigation = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (link && !surface.current?.contains(link) && (dirty || busy)) {
        event.preventDefault(); event.stopPropagation();
        if (!busy) { setPendingHref(link.href); setConfirm(true); }
      }
    };
    const unload = (event: BeforeUnloadEvent) => { if (dirty || busy) event.preventDefault(); };
    document.addEventListener("keydown", key, true);
    document.addEventListener("click", navigation, true);
    window.addEventListener("beforeunload", unload);
    return () => { document.removeEventListener("keydown", key, true); document.removeEventListener("click", navigation, true); window.removeEventListener("beforeunload", unload); };
  });
  return <div className="phone-calendar-sheet-layer">
    <button type="button" tabIndex={-1} aria-label={`Dismiss ${label}`} className="phone-calendar-sheet-backdrop" onClick={requestClose} />
    <div ref={surface} className="phone-calendar-sheet" role="dialog" aria-modal="true" aria-label={label}>
      <header><strong>{label}</strong><button ref={close} disabled={busy} type="button" aria-label={`Close ${label}`} onClick={requestClose}><X aria-hidden="true" />Close</button></header>
      {confirm ? <div className="phone-calendar-discard" role="alertdialog" aria-label="Discard changes?">
        <p>Discard unsaved changes?</p><button type="button" onClick={() => { setPendingHref(null); setConfirm(false); }}>Keep editing</button><button type="button" onClick={() => { onClose(); if (pendingHref) router.push(pendingHref); }}>Discard changes</button>
      </div> : null}
      <div inert={confirm}>{typeof children === "function" ? children(requestClose) : children}</div>
    </div>
  </div>;
}

export function MobileCalendar({ events, initialDate, boardId, boardTitle, boardOptions, onBoardChange, actionsRef, filter, onFilterChange, isOutages, hideSamples, onHideSamplesChange, canCreate, onNew, onEvent, sheet }: {
  events: CalendarEvent[]; initialDate?: string; boardId: string; boardTitle: string; boardOptions: CalendarBoardOption[];
  onBoardChange?: (id: string) => void; filter: CalendarEventFilter; onFilterChange: (filter: CalendarEventFilter) => void;
  isOutages: boolean; hideSamples: boolean; onHideSamplesChange: (checked: boolean) => void;
  canCreate: boolean; onNew: (date: Dayjs) => void; onEvent: (event: CalendarEvent) => void; sheet?: ReactNode;
  actionsRef?: RefObject<CalendarPhoneActions | null>;
}) {
  const [view, setView] = useState<PhoneView>("agenda");
  const [date, setDate] = useState(() => dayjs(initialDate).isValid() ? dayjs(initialDate).startOf("day") : dayjs().startOf("day"));
  const [menu, setMenu] = useState<"views" | "date" | "filters" | null>(null);
  const [month, setMonth] = useState(() => date.startOf("month"));
  const menuRoot = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement | null>(null);
  const content = useRef<HTMLDivElement>(null);
  function newEntry() { if (!canCreate) return; setMenu(null); onNew(date.isSame(dayjs(), "day") ? dayjs().startOf("hour").add(1, "hour") : date.hour(9)); }
  useImperativeHandle(actionsRef, () => ({ newEntry, filters: () => { trigger.current = null; setMenu("filters"); } }));
  function closeMenu() { setMenu(null); trigger.current?.focus({ preventScroll: true }); }
  function toggleMenu(value: typeof menu, button: HTMLButtonElement) {
    trigger.current = button;
    if (value === "date") setMonth(date.startOf("month"));
    setMenu(current => current === value ? null : value);
  }
  useEffect(() => {
    if (!menu) return;
    const pointer = (event: PointerEvent) => {
      if (event.target instanceof Node && !menuRoot.current?.contains(event.target) && !trigger.current?.contains(event.target)) setMenu(null);
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") { event.preventDefault(); setMenu(null); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", pointer);
    document.addEventListener("keydown", key);
    menuRoot.current?.querySelector<HTMLElement>("button")?.focus({ preventScroll: true });
    return () => { document.removeEventListener("pointerdown", pointer); document.removeEventListener("keydown", key); };
  }, [menu]);
  useEffect(() => { content.current?.scrollTo({ top: 0 }); }, [date, view]);
  const week = mobileCalendarWeek(date);
  const days = Array.from({ length: view === "month" || view === "day" ? 1 : view === "week" ? 7 : 4 }, (_, index) => (view === "week" ? week : date).add(index, "day"));
  const dayEvents = (day: Dayjs) => events.filter(event => occursOnCalendarDay(event, day)).sort((a, b) => Number(Boolean(b.allDay)) - Number(Boolean(a.allDay)) || dayjs(a.start).valueOf() - dayjs(b.start).valueOf());
  const monthGrid = (value: Dayjs, picker: boolean) => {
    const start = mobileCalendarWeek(value.startOf("month"));
    const length = Math.ceil((value.daysInMonth() + (value.startOf("month").day() + 6) % 7) / 7) * 7;
    return <div className="phone-calendar-month" aria-label={picker ? "Choose calendar date" : "Month dates"}>
      {["M", "T", "W", "T", "F", "S", "S"].map((label, i) => <span key={i} aria-hidden="true">{label}</span>)}
      {Array.from({ length }, (_, index) => { const day = start.add(index, "day"); return <button type="button" key={day.format("YYYY-MM-DD")} aria-label={day.format("dddd, MMMM D, YYYY")} aria-pressed={day.isSame(date, "day")} data-other-month={!day.isSame(value, "month") || undefined} data-today={day.isSame(dayjs(), "day") || undefined} onClick={() => { setDate(day); if (picker) closeMenu(); }}>
        {day.date()}<i data-has-events={events.some(event => occursOnCalendarDay(event, day)) || undefined} />
      </button>; })}
    </div>;
  };
  const rows = (day: Dayjs) => {
    const items = dayEvents(day);
    return items.length ? items.map(event => <button type="button" className="phone-calendar-event" key={event.id} data-tone={event.data.tone} data-outage={eventType(event) === "Outage" || undefined} data-overlay={event.data.overlay} onClick={() => onEvent(event)}>
      <time>{event.allDay || dayjs(event.start).isBefore(day.startOf("day")) ? eventClock(event, day) : <>{dayjs(event.start).format("h:mm")}<small>{dayjs(event.start).format("A")}</small></>}</time><span><strong>{event.title}</strong><small>{eventType(event)}{!event.allDay ? ` · ${dayjs(event.start).format("h:mm")}–${dayjs(event.end).format("h:mm A")}` : ""}{event.location ? ` · ${event.location}` : ""}{dayjs(event.end).isAfter(day.add(1, "day")) ? " · Continues" : ""}</small></span><ChevronRight aria-hidden="true" />
    </button>) : <p className="phone-calendar-empty">No events scheduled</p>;
  };
  const timeline = calendarTimelineLayout(dayEvents(date), date);
  const hourPixels = MOBILE_CALENDAR_HOUR_HEIGHT;
  return <section className="phone-calendar" aria-label="Calendar workspace" data-calendar-active-view={view}>
    <div className="phone-calendar-datebar">
      <button type="button" className="phone-calendar-date-title" aria-label="Choose date" aria-expanded={menu === "date"} onClick={event => toggleMenu("date", event.currentTarget)}><span className="phone-calendar-full-month">{date.format("MMMM YYYY")}</span><span className="phone-calendar-short-month">{date.format("MMM YYYY")}</span><ChevronDown aria-hidden="true" /></button>
      <button type="button" onClick={() => { setDate(dayjs().startOf("day")); setMenu(null); }}>Today</button>
      <button type="button" aria-label="Choose Calendar view" aria-expanded={menu === "views"} onClick={event => toggleMenu("views", event.currentTarget)}>{({ agenda: "Agenda", day: "Day", week: "Week", month: "Month" })[view]}<ChevronDown aria-hidden="true" /></button>
    </div>
    {view !== "month" ? <div className="phone-calendar-week" aria-label="Week dates">{Array.from({ length: 7 }, (_, index) => { const day = week.add(index, "day"); return <button key={index} type="button" aria-label={day.format("dddd, MMMM D, YYYY")} aria-pressed={day.isSame(date, "day")} data-today={day.isSame(dayjs(), "day") || undefined} onClick={() => setDate(day)}><span>{day.format("ddd")}</span><b>{day.date()}</b></button>; })}</div> : null}
    <div className="phone-calendar-context"><button type="button" className="phone-calendar-board" aria-label="Choose Calendar board" aria-expanded={menu === "filters"} onClick={event => toggleMenu("filters", event.currentTarget)}><span>{isOutages ? "Outages" : boardTitle}</span><ChevronDown aria-hidden="true" /></button><button type="button" aria-label="Calendar filters" aria-expanded={menu === "filters"} onClick={event => toggleMenu("filters", event.currentTarget)}><SlidersHorizontal aria-hidden="true" />{isOutages ? "Outages" : filters.find(item => item.id === filter)?.label}</button></div>
    {menu ? <div className={`phone-calendar-popover phone-calendar-popover--${menu}`} style={menu === "filters" ? { top: view === "month" ? 92 : 150, maxHeight: `calc(100% - ${view === "month" ? 102 : 160}px)` } : undefined} ref={menuRoot} role="dialog" aria-label={menu === "views" ? "Calendar views" : menu === "date" ? "Date picker" : "Calendar filters"}>
      <header><strong>{menu === "views" ? "Calendar view" : menu === "date" ? month.format("MMMM YYYY") : "Filter calendar"}</strong><button type="button" aria-label="Close calendar menu" onClick={closeMenu}><X aria-hidden="true" />Close</button></header>
      {menu === "views" ? views.map(item => <button type="button" key={item.id} aria-pressed={view === item.id} onClick={() => { setView(item.id); closeMenu(); }}>{item.label}</button>) : menu === "date" ? <>
        <div className="phone-calendar-month-nav"><button type="button" aria-label="Previous month" onClick={() => setMonth(current => current.subtract(1, "month"))}><ChevronLeft aria-hidden="true" /></button><label>Jump to date<input type="date" aria-label="Jump to date" value={date.format("YYYY-MM-DD")} onChange={event => { const next = dayjs(event.target.value); if (next.isValid()) { setDate(next); setMonth(next.startOf("month")); closeMenu(); } }} /></label><button type="button" aria-label="Next month" onClick={() => setMonth(current => current.add(1, "month"))}><ChevronRight aria-hidden="true" /></button></div>{monthGrid(month, true)}
      </> : <>
        <label>Board<select aria-label="Calendar board" value={boardId} onChange={event => { onBoardChange?.(event.target.value); closeMenu(); }}>{boardOptions.map(board => <option key={board.boardId} value={board.boardId}>{board.title}</option>)}</select></label>
        {!isOutages ? filters.map(item => <button type="button" key={item.id} aria-pressed={filter === item.id} onClick={() => { onFilterChange(item.id); closeMenu(); }}>{item.label}</button>) : null}
        <label><input type="checkbox" checked={isOutages} onChange={event => onFilterChange(event.target.checked ? "outage" : "all")} />Outages</label>
        <label><input type="checkbox" checked={hideSamples} onChange={event => onHideSamplesChange(event.target.checked)} />Hide local samples</label>
      </>}
    </div> : null}
    <div className="phone-calendar-content" ref={content} aria-label="Calendar events">
      {view === "month" ? <><div className="phone-calendar-month-nav"><button type="button" aria-label="Previous month" onClick={() => setDate(current => current.subtract(1, "month"))}><ChevronLeft aria-hidden="true" /></button><strong>{date.format("MMMM YYYY")}</strong><button type="button" aria-label="Next month" onClick={() => setDate(current => current.add(1, "month"))}><ChevronRight aria-hidden="true" /></button></div>{monthGrid(date, false)}</> : null}
      {view === "day" ? <>
        <h2>{date.format("dddd, MMMM D")}</h2>
        {dayEvents(date).filter(event => event.allDay).map(event => <button type="button" className="phone-calendar-all-day" key={event.id} onClick={() => onEvent(event)}>All day · {event.title}</button>)}
        <div className="phone-calendar-timeline" style={{ height: (timeline.lastHour - timeline.firstHour) * hourPixels + 24 }}>
          {Array.from({ length: timeline.lastHour - timeline.firstHour + 1 }, (_, index) => <div className="phone-calendar-hour" key={index} style={{ top: index * hourPixels }}><time>{date.hour(timeline.firstHour + index).format("h A")}</time></div>)}
          {timeline.segments.map(({ event, from, to, lane, lanes }) => { const height = (to - from) / 60 * hourPixels; return <button type="button" className="phone-calendar-time-event" data-tone={event.data.tone} data-outage={eventType(event) === "Outage" || undefined} data-overlay={event.data.overlay} key={event.id} aria-label={`${event.title}, ${eventClock(event, date)}`} style={{ top: (from / 60 - timeline.firstHour) * hourPixels, left: `calc(46px + (100% - 52px) * ${lane / lanes})`, width: `calc((100% - 52px) / ${lanes} - 3px)`, height: Math.max(44, height) }} onClick={() => onEvent(event)}><span style={{ height: Math.max(24, height) }}><strong>{event.title}</strong>{height >= 54 ? <small>{eventClock(event, date)}–{dayjs(event.end).format("h:mm A")}</small> : null}</span></button>; })}
        </div>
      </> : days.filter(day => view !== "agenda" || day.isSame(date, "day") || dayEvents(day).length).map(day => <div key={day.format("YYYY-MM-DD")} className="phone-calendar-agenda-day"><h2>{day.format("dddd, MMM D")}<span>{dayEvents(day).length} {dayEvents(day).length === 1 ? "item" : "items"}</span></h2>{rows(day)}</div>)}
    </div>
    <button type="button" className="phone-calendar-new" aria-label="New entry" title={canCreate ? "New entry" : "This board is read-only"} disabled={!canCreate} onClick={newEntry}><Plus aria-hidden="true" /></button>
    {sheet}
  </section>;
}
