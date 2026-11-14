type CalendarEventCategory = {
  kind: string;
  workItemType?: string;
  outageTaskId?: string;
};

/** Windows and work nested inside an outage belong to the same calendar mode. */
export function isOutageCalendarEvent(data: CalendarEventCategory) {
  return data.kind === "taskboard-task" &&
    (data.workItemType === "maintenance_outage" || Boolean(data.outageTaskId));
}

/** The Outages switch chooses one category; it never overlays the other. */
export function calendarEventMatchesMode(data: CalendarEventCategory, outages: boolean) {
  return isOutageCalendarEvent(data) === outages;
}
