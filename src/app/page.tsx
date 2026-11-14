import type { Metadata } from "next";
import { TaskboardApp } from "@/components/taskboard";
import { getExternalAccountActions, isExternalAuthOnly } from "@/lib/auth";
import { BoardAccessError, type AccessibleBoardSummary } from "@/lib/board-access";
import { mapImportedCalendarSourceEvents } from "@/lib/calendar-source-events";
import { getCurrentTaskboardUser } from "@/lib/taskboard-request";
import {
  listAccessibleBoards,
  listCalendarEntriesForBoard,
  listPersonalBoardImportedCalendarEvents,
  loadPreferredTaskboardState,
  loadTaskboardState,
} from "@/lib/taskboard-store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  manifest: "/taskboard.webmanifest",
  icons: { apple: "/offline-notes/personal-192.png" },
};

type HomeSearchParams = {
  boardId?: string | string[];
  taskId?: string | string[];
  from?: string | string[];
  view?: string | string[];
};

function getFirstSearchParamValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getInitialViewMode(value: string | undefined) {
  return value === "agenda" || value === "focus" ? value : "board";
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

export default async function Home({
  searchParams,
}: {
  searchParams?: Promise<HomeSearchParams>;
}) {
  const user = await getCurrentTaskboardUser();

  if (!user) {
    throw new Error("Taskboard identity is unavailable.");
  }

  const resolvedSearchParams = (await searchParams) ?? {};
  const requestedBoardId = getFirstSearchParamValue(resolvedSearchParams.boardId);
  const requestedTaskId = getFirstSearchParamValue(resolvedSearchParams.taskId);
  const requestedViewMode = getInitialViewMode(getFirstSearchParamValue(resolvedSearchParams.view));
  const requestedHandoffSource =
    getFirstSearchParamValue(resolvedSearchParams.from) === "calendar" ? "calendar" : null;
  let initialBoardNotice: string | null = null;
  let persistInitialBoardSelection = false;
  let state;

  try {
    if (requestedBoardId !== undefined) {
      state = await loadTaskboardState(user, { boardId: requestedBoardId });
      persistInitialBoardSelection = true;
    } else {
      state = await loadPreferredTaskboardState(user);
    }
  } catch (error) {
    if (!(error instanceof BoardAccessError)) {
      throw error;
    }

    state = await loadTaskboardState(user);
    initialBoardNotice = "The requested board could not be opened. Showing your default board.";
    persistInitialBoardSelection = false;
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

  const calendarEntries = state.persistenceEnabled
    ? await listCalendarEntriesForBoard(user, state.board.id)
    : [];
  const importedSourceRows =
    state.persistenceEnabled && requestedBoardId === undefined
      ? await listPersonalBoardImportedCalendarEvents(user, state.board.id)
      : [];
  const calendarSourceEvents = mapImportedCalendarSourceEvents(importedSourceRows);

  return (
    <TaskboardApp
      publicSharesEnabled={process.env.TASKBOARD_PUBLIC_SHARES_ENABLED === "true"}
      initialBoard={state.board}
      initialBoardAccess={state.boardAccess}
      initialAccessibleBoards={accessibleBoardState.boards}
      initialCurrentBoardId={accessibleBoardState.currentBoardId}
      initialPersonalBoardId={accessibleBoardState.personalBoardId}
      initialBoardNotice={initialBoardNotice}
      persistInitialBoardSelection={persistInitialBoardSelection}
      currentUser={state.currentUser}
      externalAuthOnly={isExternalAuthOnly()}
      externalAccountActions={getExternalAccountActions()}
      persistenceEnabled={state.persistenceEnabled}
      initialCalendarEntries={calendarEntries}
      initialCalendarSourceEvents={calendarSourceEvents}
      includeImportedCalendarEvents={requestedBoardId === undefined}
      initialSelectedTaskId={requestedTaskId}
      initialTaskHandoffSource={requestedHandoffSource}
      initialViewMode={requestedViewMode}
    />
  );
}
