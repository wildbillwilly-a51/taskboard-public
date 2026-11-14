import "server-only";

import type { TaskboardCurrentUser } from "@/lib/taskboard-request";

export function isOfflineNotesBetaUser(
  user: (TaskboardCurrentUser & { isDisabled?: boolean }) | null | undefined,
): user is TaskboardCurrentUser & { id: string } {
  return Boolean(user?.id && user.authProvider === "authelia" && !user.isDisabled
    && process.env.TASKBOARD_OFFLINE_NOTES_BETA_USERS?.split(",")
      .some((id) => id.trim().toLowerCase() === user.id?.toLowerCase()));
}

export function isOfflineWorkBetaUser(user: Parameters<typeof isOfflineNotesBetaUser>[0]) {
  return isOfflineNotesBetaUser(user) && Boolean(process.env.TASKBOARD_OFFLINE_WORK_BETA_USERS
    ?.split(",").some((id) => id.trim().toLowerCase() === user.id.toLowerCase()));
}
