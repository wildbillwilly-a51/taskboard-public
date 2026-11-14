import type { AccessibleBoardSummary } from "@/lib/board-access";
import type { CalendarBoardOption } from "@/components/calendar-proof";

// A board as the calendar's board picker offers it. Used by the calendar page
// and by the shell when the board list changes live.
export function toCalendarBoardOption(board: AccessibleBoardSummary): CalendarBoardOption {
  return {
    accessLabel: board.accessLevel,
    boardId: board.boardId,
    canEdit: board.canEdit,
    kindLabel: board.isTeamBoard ? "Team board" : board.isTeammatePersonalBoard ? "Teammate board" : "Personal board",
    title: board.title,
  };
}
