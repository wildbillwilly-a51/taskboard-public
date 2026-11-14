import { redirect } from "next/navigation";
import { TaskboardApp } from "@/components/taskboard";
import { cookies, headers } from "next/headers";
import { AUTH_COOKIE_NAME, verifySessionCookieValue } from "@/lib/auth";
import { getExternalAccountActions, isExternalAuthOnly } from "@/lib/auth";
import { BoardAccessError, type AccessibleBoardSummary } from "@/lib/board-access";
import { isUuid, type NoteHomeBoardOption } from "@/lib/notes-model";
import { listNoteHomeOptions } from "@/lib/notes-store";
import { getCurrentTaskboardUser } from "@/lib/taskboard-request";
import { isOfflineNotesBetaUser } from "@/lib/offline-notes-config";
import {
  listAccessibleBoards,
  loadPreferredTaskboardState,
  loadTaskboardState,
} from "@/lib/taskboard-store";

export const metadata = {
  title: "Folio | Taskboard",
};

export const dynamic = "force-dynamic";

type NotesSearchParams = {
  note?: string | string[];
  space?: string | string[];
  boardId?: string | string[];
  bucketId?: string | string[];
  new?: string | string[];
  linkTaskId?: string | string[];
};

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function NotesPage({
  searchParams,
}: {
  searchParams?: Promise<NotesSearchParams>;
}) {
  const user = await getCurrentTaskboardUser();

  if (!user) {
    redirect("/login");
  }

  const params = (await searchParams) ?? {};
  const cookieStore=await cookies();
  const session=await verifySessionCookieValue(cookieStore.get(AUTH_COOKIE_NAME)?.value);
  const requestHeaders=await headers();
  const sessionKey=session?.sessionId??(session?String(session.expiresAt):requestHeaders.get('x-taskboard-navigation-session')??cookieStore.get('taskboard_navigation')?.value??'browser');
  const requestedBoardId = first(params.boardId);
  const requestedNoteId = first(params.note);
  const requestedBucketId = first(params.bucketId);
  const requestedLinkTaskId = first(params.linkTaskId);
  let state;

  // The shell around Notes shows the requested board when there is one (so
  // "Link a task" offers its tasks), otherwise the user's preferred board.
  try {
    state =
      requestedBoardId !== undefined
        ? await loadTaskboardState(user, { boardId: requestedBoardId })
        : await loadPreferredTaskboardState(user);
  } catch (error) {
    if (!(error instanceof BoardAccessError)) {
      throw error;
    }

    state = await loadTaskboardState(user);
  }

  let accessibleBoards: AccessibleBoardSummary[] = [];
  let personalBoardId = state.board.id;
  let homeOptions: NoteHomeBoardOption[] = [];

  if (state.persistenceEnabled) {
    const listing = await listAccessibleBoards(user);
    personalBoardId = listing.currentBoardId;
    accessibleBoards = listing.boards.map((board) => ({
      ...board,
      isCurrentBoard: board.boardId === state.board.id,
    }));
    homeOptions = await listNoteHomeOptions(user);
  }

  return (
    <TaskboardApp
      publicSharesEnabled={process.env.TASKBOARD_PUBLIC_SHARES_ENABLED === "true"}
      initialBoard={state.board}
      initialBoardAccess={state.boardAccess}
      initialAccessibleBoards={accessibleBoards}
      initialCurrentBoardId={state.board.id}
      initialPersonalBoardId={personalBoardId}
      currentUser={state.currentUser}
      externalAuthOnly={isExternalAuthOnly()}
      externalAccountActions={getExternalAccountActions()}
      persistenceEnabled={state.persistenceEnabled}
      notesWorkspace={{
        offlineNotesAvailable: isOfflineNotesBetaUser(user),
        sessionKey,
        initialSpaceId:isUuid(first(params.space))?first(params.space):null,
        homeOptions,
        initialNoteId: isUuid(requestedNoteId) ? requestedNoteId : null,
        initialBoardId: isUuid(requestedBoardId) ? requestedBoardId : null,
        initialBucketId: isUuid(requestedBucketId) ? requestedBucketId : null,
        createOnOpen: first(params.new) === "1",
        initialLinkTaskId: isUuid(requestedLinkTaskId) ? requestedLinkTaskId : null,
      }}
    />
  );
}
