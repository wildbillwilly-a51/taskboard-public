// On team boards, only current team managers (and global admins) archive,
// delete, restore or purge tasks while this is enabled.
export function isTeamLifecycleManagersEnabled() {
  return process.env.TASKBOARD_TEAM_LIFECYCLE_MANAGERS?.trim().toLowerCase() === "enabled";
}

export function isSameTeamPersonalBoardViewEnabled() {
  return process.env.TASKBOARD_SAME_TEAM_PERSONAL_BOARD_VIEW?.trim().toLowerCase() === "enabled";
}
