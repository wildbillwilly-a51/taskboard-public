"use client";

import dynamic from "next/dynamic";
import type { RefObject } from "react";

import type { CalendarEntry } from "@/lib/taskboard-data";
import type { TaskboardCalendarTaskEvent } from "@/lib/calendar-task-events";
import type { TaskboardCalendarSourceEvent } from "@/lib/calendar-source-events";
import type { CalendarTaskScheduleUpdate } from "@/lib/calendar-resize";

export type CalendarBoardContext = {
  activeBoardId: string;
  activeBoardTitle: string;
  isExplicitBoardContext: boolean;
  requestedBoardId?: string;
  requestedBoardRejected: boolean;
};

export type CalendarPhoneActions = { newEntry: () => void; filters: () => void };

export type CalendarBoardOption = {
  accessLabel: string;
  boardId: string;
  canEdit: boolean;
  kindLabel: string;
  title: string;
};

export type CalendarBoardBucketOption = {
  id: string;
  title: string;
  color: string;
};

export type CalendarFocusContext = {
  initialDate?: string;
  initialOutageView?: boolean;
};

export type CalendarWorkspaceProps = {
  boardContext: CalendarBoardContext;
  boardBuckets: CalendarBoardBucketOption[];
  boardOptions: CalendarBoardOption[];
  calendarEntries: CalendarEntry[];
  canEditBoard: boolean;
  focusContext?: CalendarFocusContext;
  searchQuery?: string;
  sourceEvents: TaskboardCalendarSourceEvent[];
  taskEvents: TaskboardCalendarTaskEvent[];
};

const CalendarProofInner = dynamic(
  () =>
    import("./calendar-proof-inner").then(
      (module) => module.CalendarProofInner,
    ),
  {
    loading: () => (
      <div className="taskboard-calendar-proof taskboard-calendar-proof--loading">
        Loading calendar
      </div>
    ),
    ssr: false,
  },
);

export function CalendarProofApp({
  boardContext,
  boardBuckets,
  boardOptions,
  calendarEntries,
  canEditBoard,
  isPhone = false,
  onPhoneBoardChange,
  phoneActionsRef,
  embeddedInTaskboardShell = false,
  focusContext,
  onSidebarTaskSelect,
  onOutageViewChange,
  onTaskSchedulesUpdated,
  onCalendarDataChanged,
  searchQuery = "",
  selectedTaskId,
  sourceEvents,
  taskEvents,
}: CalendarWorkspaceProps & {
  embeddedInTaskboardShell?: boolean;
  isPhone?: boolean;
  phoneActionsRef?: RefObject<CalendarPhoneActions | null>;
  onPhoneBoardChange?: (boardId: string) => void;
  onSidebarTaskSelect?: (taskId: string | null) => void;
  onOutageViewChange?: (active: boolean) => void;
  onTaskSchedulesUpdated?: (updates: CalendarTaskScheduleUpdate[]) => void;
  onCalendarDataChanged?: () => void;
  selectedTaskId?: string | null;
}) {
  return (
    <CalendarProofInner
      boardContext={boardContext}
      boardBuckets={boardBuckets}
      boardOptions={boardOptions}
      isPhone={isPhone}
      onPhoneBoardChange={onPhoneBoardChange}
      phoneActionsRef={phoneActionsRef}
      calendarEntries={calendarEntries}
      canEditBoard={canEditBoard}
      embeddedInTaskboardShell={embeddedInTaskboardShell}
      focusContext={focusContext}
      onSidebarTaskSelect={onSidebarTaskSelect}
      onOutageViewChange={onOutageViewChange}
      onTaskSchedulesUpdated={onTaskSchedulesUpdated}
      onCalendarDataChanged={onCalendarDataChanged}
      searchQuery={searchQuery}
      selectedTaskId={selectedTaskId}
      sourceEvents={sourceEvents}
      taskEvents={taskEvents}
    />
  );
}
