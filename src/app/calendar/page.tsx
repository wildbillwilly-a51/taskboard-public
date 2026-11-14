import { redirect } from "next/navigation";
import { TaskboardApp } from "@/components/taskboard";
import { getExternalAccountActions, isExternalAuthOnly } from "@/lib/auth";
import { BoardAccessError, type AccessibleBoardSummary } from "@/lib/board-access";
import { toCalendarBoardOption } from "@/lib/calendar-board-options";
import { mapBoardTasksToCalendarEvents } from "@/lib/calendar-task-events";
import {
  mapImportedCalendarSourceEvents,
  suppressTaskEventsLinkedToImportedSources,
} from "@/lib/calendar-source-events";
import { getCurrentTaskboardUser } from "@/lib/taskboard-request";
import {
  listCalendarEntriesForBoard,
  listAccessibleBoards,
  listPersonalBoardImportedCalendarEvents,
  loadPreferredTaskboardState,
  loadTaskboardState,
} from "@/lib/taskboard-store";

export const metadata = {
  title: "Calendar | Taskboard",
};

export const dynamic = "force-dynamic";

type CalendarSearchParams = {
  boardId?: string | string[];
  date?: string | string[];
  taskId?: string | string[];
  view?: string | string[];
};

function getRequestedBoardId(searchParams: CalendarSearchParams) {
  const value = searchParams.boardId;
  return Array.isArray(value) ? value[0] : value;
}

function getFirstSearchParamValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getSafeCalendarDate(value: string | undefined) {
  if (
    !value ||
    !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(value)
  ) {
    return undefined;
  }

  const parsed = new Date(value.length === 10 ? `${value}T00:00:00` : value);
  return Number.isNaN(parsed.getTime()) ? undefined : value;
}

function withCurrentBoard(
  accessibleBoardState: {
    boards: AccessibleBoardSummary[];
    currentBoardId: string;
  },
  currentBoardId: string,
) {
  return {
    boards: accessibleBoardState.boards.map((board) => ({
      ...board,
      isCurrentBoard: board.boardId === currentBoardId,
    })),
    currentBoardId,
    personalBoardId: accessibleBoardState.currentBoardId,
  };
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams?: Promise<CalendarSearchParams>;
}) {
  const user = await getCurrentTaskboardUser();

  if (!user) {
    redirect("/login");
  }

  const resolvedSearchParams = (await searchParams) ?? {};
  const requestedBoardId = getRequestedBoardId(resolvedSearchParams);
  const requestedDate = getSafeCalendarDate(getFirstSearchParamValue(resolvedSearchParams.date));
  const requestedTaskId = getFirstSearchParamValue(resolvedSearchParams.taskId);
  const requestedOutageView = getFirstSearchParamValue(resolvedSearchParams.view) === "outages";
  let requestedBoardRejected = false;
  let state;

  try {
    state =
      requestedBoardId !== undefined
        ? await loadTaskboardState(user, { boardId: requestedBoardId })
        : await loadPreferredTaskboardState(user);
  } catch (error) {
    if (!(error instanceof BoardAccessError)) {
      throw error;
    }

    requestedBoardRejected = true;
    state = await loadTaskboardState(user);
  }

  if (requestedBoardId !== undefined && state.board.id !== requestedBoardId) {
    requestedBoardRejected = true;
  }

  let accessibleBoardState: {
    boards: AccessibleBoardSummary[];
    currentBoardId: string;
    personalBoardId: string;
  } = {
    boards: [
      {
        boardId: state.board.id,
        title: state.board.title,
        description: state.board.description,
        boardType: "personal",
        ownerUserId: state.currentUser.id ?? "",
        ownerDisplayName: state.currentUser.displayName,
        accessLevel: state.boardAccess.level === "admin" ? "admin" : "owner",
        canRead: true,
        canEdit: state.boardAccess.canEdit,
        canManage: state.boardAccess.canManage,
        source: state.boardAccess.source ?? "owner",
        isPersonalBoard: true,
        isTeammatePersonalBoard: false,
        isTeamBoard: false,
        isPrivate: true,
        isTeamVisible: false,
        accessReason: state.boardAccess.source ?? "owner",
        isCurrentBoard: true,
      },
    ],
    currentBoardId: state.board.id,
    personalBoardId: state.board.id,
  };

  if (state.persistenceEnabled) {
    accessibleBoardState = withCurrentBoard(await listAccessibleBoards(user), state.board.id);
  }

  const isExplicitBoardContext = requestedBoardId !== undefined && !requestedBoardRejected;
  const sourceRows =
    requestedBoardId === undefined
      ? await listPersonalBoardImportedCalendarEvents(user, state.board.id)
      : [];
  const calendarEntries = await listCalendarEntriesForBoard(user, state.board.id);
  const sourceEvents = mapImportedCalendarSourceEvents(sourceRows);
  const taskEvents = suppressTaskEventsLinkedToImportedSources(
    mapBoardTasksToCalendarEvents(state.board),
    sourceEvents,
  );

  return (
    <TaskboardApp
      publicSharesEnabled={process.env.TASKBOARD_PUBLIC_SHARES_ENABLED === "true"}
      key={`calendar:${state.board.id}`}
      initialBoard={state.board}
      initialBoardAccess={state.boardAccess}
      initialAccessibleBoards={accessibleBoardState.boards}
      initialCurrentBoardId={accessibleBoardState.currentBoardId}
      initialPersonalBoardId={accessibleBoardState.personalBoardId}
      initialBoardNotice={
        requestedBoardRejected
          ? "The requested board could not be opened. Showing your default board."
          : null
      }
      persistInitialBoardSelection={requestedBoardId !== undefined && !requestedBoardRejected}
      initialSelectedTaskId={requestedTaskId}
      includeImportedCalendarEvents={requestedBoardId === undefined}
      currentUser={state.currentUser}
      externalAuthOnly={isExternalAuthOnly()}
      externalAccountActions={getExternalAccountActions()}
      persistenceEnabled={state.persistenceEnabled}
      calendarWorkspace={{
        canEditBoard: state.boardAccess.canEdit,
        boardContext: {
          activeBoardId: state.board.id,
          activeBoardTitle: state.board.title,
          isExplicitBoardContext,
          requestedBoardId,
          requestedBoardRejected,
        },
        boardBuckets: state.board.buckets.map((bucket) => ({
          color: bucket.color,
          id: bucket.id,
          title: bucket.title,
        })),
        boardOptions: accessibleBoardState.boards.map(toCalendarBoardOption),
        calendarEntries,
        focusContext: {
          ...(requestedDate ? { initialDate: requestedDate } : {}),
          ...(requestedOutageView ? { initialOutageView: true } : {}),
        },
        sourceEvents,
        taskEvents,
      }}
    />
  );
}
