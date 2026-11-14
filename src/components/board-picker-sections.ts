import type { AccessibleBoardSummary } from "@/lib/board-access";

export type BoardPickerSectionId =
  | "my_boards"
  | "team_boards"
  | "team_member_boards"
  | "shared_with_me"
  | "admin_access";

export type BoardPickerBoardItem = {
  board: AccessibleBoardSummary;
  badges: string[];
  sectionId: BoardPickerSectionId;
  searchText: string;
  isCurrentBoard: boolean;
};

export type BoardPickerGroup = {
  id: string;
  title: string;
  boards: BoardPickerBoardItem[];
};

export type BoardPickerSection = {
  id: BoardPickerSectionId;
  title: string;
  description: string;
  groups: BoardPickerGroup[];
  defaultCollapsed: boolean;
  totalCount: number;
};

export type BoardPickerSectionsResult = {
  sections: BoardPickerSection[];
  hiddenAdminBoardCount: number;
  totalBoardCount: number;
  visibleBoardCount: number;
  hasSearch: boolean;
};

type SectionDefinition = {
  id: BoardPickerSectionId;
  title: string;
  description: string;
  defaultCollapsed: boolean;
};

const SECTION_DEFINITIONS: SectionDefinition[] = [
  {
    id: "my_boards",
    title: "My boards",
    description: "Personal boards you own.",
    defaultCollapsed: false,
  },
  {
    id: "team_boards",
    title: "Team boards",
    description: "Boards owned by teams you can access.",
    defaultCollapsed: false,
  },
  {
    id: "team_member_boards",
    title: "Team member boards",
    description: "Read-only personal boards made visible through a team.",
    defaultCollapsed: false,
  },
  {
    id: "shared_with_me",
    title: "Shared with me",
    description: "Explicit personal-board grants from other users.",
    defaultCollapsed: false,
  },
  {
    id: "admin_access",
    title: "Admin access",
    description: "Boards visible only through app-admin access.",
    defaultCollapsed: true,
  },
];

const SECTION_RANK = new Map(
  SECTION_DEFINITIONS.map((definition, index) => [definition.id, index]),
);

const ACCESS_LABELS: Record<AccessibleBoardSummary["accessLevel"], string> = {
  admin: "Admin",
  owner: "Owner",
  editor: "Editor",
  viewer: "Viewer",
};

const SOURCE_LABELS: Record<AccessibleBoardSummary["source"], string> = {
  admin: "Admin access",
  board_member: "Explicit share",
  owner: "Owner",
  same_team_personal: "Teammate personal",
  team_default: "Team default",
  team_manager: "Team manager",
};

function normalizeSearch(value: string) {
  return value.trim().toLowerCase();
}

function getSectionId(board: AccessibleBoardSummary): BoardPickerSectionId {
  if (board.isPersonalBoard) {
    return "my_boards";
  }

  if (board.isTeamBoard) {
    return "team_boards";
  }

  if (
    board.isTeammatePersonalBoard &&
    board.source === "same_team_personal"
  ) {
    return "team_member_boards";
  }

  if (board.source === "board_member") {
    return "shared_with_me";
  }

  if (board.source === "admin") {
    return "admin_access";
  }

  if (board.isTeammatePersonalBoard) {
    return "shared_with_me";
  }

  return "admin_access";
}

function getGroupId(board: AccessibleBoardSummary, sectionId: BoardPickerSectionId) {
  if (sectionId === "team_boards") {
    return `team:${board.ownerTeamId ?? board.ownerTeamName ?? "unknown"}`;
  }

  if (sectionId === "team_member_boards") {
    return `team-member:${board.visibilityTeamId ?? board.visibilityTeamName ?? "unknown"}:${board.ownerUserId ?? board.ownerDisplayName ?? "unknown"}`;
  }

  if (sectionId === "shared_with_me") {
    return `owner:${board.ownerUserId ?? board.ownerDisplayName ?? "unknown"}`;
  }

  if (sectionId === "admin_access") {
    if (board.isTeamBoard) {
      return `admin-team:${board.ownerTeamId ?? board.ownerTeamName ?? "unknown"}`;
    }
    return `admin-owner:${board.ownerUserId ?? board.ownerDisplayName ?? "unknown"}`;
  }

  return sectionId;
}

function getGroupTitle(board: AccessibleBoardSummary, sectionId: BoardPickerSectionId) {
  if (sectionId === "team_boards") {
    return board.ownerTeamName ?? "Team boards";
  }

  if (sectionId === "team_member_boards") {
    const teamName = board.visibilityTeamName ?? "Team";
    const ownerName = board.ownerDisplayName ?? "Team member";
    return `${teamName} - ${ownerName}`;
  }

  if (sectionId === "shared_with_me") {
    return board.ownerDisplayName ?? "Shared personal boards";
  }

  if (sectionId === "admin_access") {
    if (board.isTeamBoard) {
      return board.ownerTeamName ?? "Team boards";
    }
    return board.ownerDisplayName ?? "Personal boards";
  }

  return "My boards";
}

function uniqueLabels(labels: string[]) {
  return labels.filter((label, index) => label && labels.indexOf(label) === index);
}

export function getBoardPickerBadges(board: AccessibleBoardSummary, isCurrentBoard = board.isCurrentBoard) {
  return uniqueLabels([
    isCurrentBoard ? "Current" : "",
    ACCESS_LABELS[board.accessLevel],
    board.isPersonalBoard ? "Personal" : "",
    board.isTeamBoard ? "Team" : "",
    board.isTeammatePersonalBoard ? "Teammate personal" : "",
    board.source === "board_member" ? "Explicit share" : "",
    board.source === "team_default" ? "Team default" : "",
    board.source === "team_manager" ? "Team manager" : "",
    board.source === "admin" ? "Admin access" : "",
    board.isPrivate ? "Private" : "",
    board.isTeamVisible ? "Team visible" : "",
    !board.canEdit ? "Read-only" : "",
  ]);
}

function buildSearchText(board: AccessibleBoardSummary, badges: string[], sectionId: BoardPickerSectionId) {
  const section = SECTION_DEFINITIONS.find((definition) => definition.id === sectionId);

  return [
    board.title,
    board.description,
    board.ownerDisplayName,
    board.ownerTeamName,
    board.visibilityTeamName,
    board.accessLevel,
    board.source,
    board.accessReason,
    SOURCE_LABELS[board.source],
    ACCESS_LABELS[board.accessLevel],
    section?.title,
    section?.description,
    ...badges,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function compareItems(left: BoardPickerBoardItem, right: BoardPickerBoardItem) {
  if (left.isCurrentBoard !== right.isCurrentBoard) {
    return left.isCurrentBoard ? -1 : 1;
  }

  const titleCompare = left.board.title.localeCompare(right.board.title, undefined, {
    sensitivity: "base",
  });

  if (titleCompare !== 0) {
    return titleCompare;
  }

  return left.board.boardId.localeCompare(right.board.boardId);
}

function compareGroups(left: BoardPickerGroup, right: BoardPickerGroup) {
  return left.title.localeCompare(right.title, undefined, { sensitivity: "base" });
}

export function buildBoardPickerSections(
  boards: AccessibleBoardSummary[],
  options: {
    currentBoardId?: string;
    searchQuery?: string;
    showAdminAccess?: boolean;
  } = {},
): BoardPickerSectionsResult {
  const query = normalizeSearch(options.searchQuery ?? "");
  const hasSearch = query.length > 0;
  const bestByBoardId = new Map<
    string,
    {
      board: AccessibleBoardSummary;
      sectionId: BoardPickerSectionId;
    }
  >();

  for (const board of boards) {
    const sectionId = getSectionId(board);
    const existing = bestByBoardId.get(board.boardId);

    if (
      !existing ||
      (SECTION_RANK.get(sectionId) ?? Number.MAX_SAFE_INTEGER) <
        (SECTION_RANK.get(existing.sectionId) ?? Number.MAX_SAFE_INTEGER)
    ) {
      bestByBoardId.set(board.boardId, { board, sectionId });
    }
  }

  const groupsBySection = new Map<BoardPickerSectionId, Map<string, BoardPickerGroup>>();
  let hiddenAdminBoardCount = 0;
  let visibleBoardCount = 0;

  for (const { board, sectionId } of bestByBoardId.values()) {
    const isCurrentBoard =
      options.currentBoardId ? board.boardId === options.currentBoardId : board.isCurrentBoard;
    const badges = getBoardPickerBadges(board, isCurrentBoard);
    const item: BoardPickerBoardItem = {
      board,
      badges,
      sectionId,
      searchText: buildSearchText(board, badges, sectionId),
      isCurrentBoard,
    };

    if (hasSearch && !item.searchText.includes(query)) {
      continue;
    }

    if (sectionId === "admin_access" && !options.showAdminAccess && !item.isCurrentBoard) {
      hiddenAdminBoardCount += 1;
      continue;
    }

    let groups = groupsBySection.get(sectionId);
    if (!groups) {
      groups = new Map();
      groupsBySection.set(sectionId, groups);
    }

    const groupId = getGroupId(board, sectionId);
    const group =
      groups.get(groupId) ??
      {
        id: groupId,
        title: getGroupTitle(board, sectionId),
        boards: [],
      };

    group.boards.push(item);
    groups.set(groupId, group);
    visibleBoardCount += 1;
  }

  const sections: BoardPickerSection[] = [];

  for (const definition of SECTION_DEFINITIONS) {
    const groups = groupsBySection.get(definition.id);

    if (!groups) {
      continue;
    }

    const sortedGroups = Array.from(groups.values()).sort(compareGroups);
    for (const group of sortedGroups) {
      group.boards.sort(compareItems);
    }

    sections.push({
      id: definition.id,
      title: definition.title,
      description: definition.description,
      defaultCollapsed: definition.defaultCollapsed,
      groups: sortedGroups,
      totalCount: sortedGroups.reduce((count, group) => count + group.boards.length, 0),
    });
  }

  return {
    sections,
    hiddenAdminBoardCount,
    totalBoardCount: bestByBoardId.size,
    visibleBoardCount,
    hasSearch,
  };
}
