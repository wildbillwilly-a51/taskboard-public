"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ExternalLink,
  LayoutDashboard,
  Pencil,
  Plus,
  ShieldCheck,
  Trash2,
  Users,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { useConfirm } from "@/components/ui/confirm-dialog";

type AppRole = "standard" | "manager" | "admin";
type TeamMemberRole = "manager" | "member";
type TeamBoardDefaultAccess = "viewer" | "editor";
type TeamBoardMemberGrantRole = "owner" | "editor" | "viewer";

type TeamSummary = {
  id: string;
  name: string;
  description: string;
  actorRole: TeamMemberRole | null;
  memberCount: number;
  archivedAt: string | null;
  canManage: boolean;
  canManageMembers: boolean;
  canView: boolean;
  personalBoardViewEnabled: boolean;
  createdAt: string;
  updatedAt: string;
};

type TeamMember = {
  userId: string;
  email: string;
  username: string | null;
  displayName: string;
  appRole: AppRole;
  isDisabled: boolean;
  teamRole: TeamMemberRole;
  createdAt: string;
  updatedAt: string;
};

type TeamMemberCandidate = {
  id: string;
  email: string;
  username: string | null;
  displayName: string;
};

type TeamBoardSummary = {
  boardId: string;
  teamId: string;
  teamName: string;
  title: string;
  description: string;
  boardType: "team";
  teamMemberDefaultAccess: TeamBoardDefaultAccess;
  accessLevel: "none" | "viewer" | "editor" | "owner" | "admin";
  canRead: boolean;
  canEdit: boolean;
  canManage: boolean;
  source: string | null;
  createdAt: string;
  updatedAt: string;
};

type TeamBoardMemberGrant = {
  userId: string;
  email: string;
  username: string | null;
  displayName: string;
  teamRole: TeamMemberRole;
  explicitRole: TeamBoardMemberGrantRole;
  teamMemberDefaultAccess: TeamBoardDefaultAccess;
  effectiveAccessLevel: "viewer" | "editor" | "owner" | "admin" | "none";
  canRead: boolean;
  canEdit: boolean;
  canManage: boolean;
  source: string | null;
  createdAt: string;
  updatedAt: string;
};

type TeamPayload = {
  ok?: boolean;
  team?: TeamSummary;
  teams?: TeamSummary[];
  member?: TeamMember;
  members?: TeamMember[];
  candidates?: TeamMemberCandidate[];
  board?: TeamBoardSummary;
  boards?: TeamBoardSummary[];
  grant?: TeamBoardMemberGrant;
  grants?: TeamBoardMemberGrant[];
  personalBoardVisibilityImpact?: TeamPersonalBoardVisibilityImpact;
  changed?: boolean;
  error?: string;
};

type TeamPersonalBoardVisibilityImpact = {
  affectedUsers: number;
  affectedPersonalBoards: number;
  visibilityPairs: number;
  tasks: number;
  notes: number;
  attachments: number;
  importedEvents: number;
  notifications: number;
};

const memberRoleOptions: TeamMemberRole[] = ["member", "manager"];
const teamBoardDefaultAccessOptions: TeamBoardDefaultAccess[] = ["viewer", "editor"];
const teamBoardMemberGrantRoleOptions: TeamBoardMemberGrantRole[] = [
  "viewer",
  "editor",
  "owner",
];

function getUsefulBoardGrantRoles(board: TeamBoardSummary): TeamBoardMemberGrantRole[] {
  return board.teamMemberDefaultAccess === "viewer" ? ["editor", "owner"] : ["owner"];
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(new Date(value));
}

async function readTeamPayload(response: Response) {
  return (await response.json().catch(() => ({}))) as TeamPayload;
}

export function TeamsPage({
  currentUser,
  teams: initialTeams,
  teamBoards: initialTeamBoards = [],
}: {
  currentUser: {
    id: string;
    email: string;
    displayName: string;
    role: AppRole;
  };
  teams: TeamSummary[];
  teamBoards?: TeamBoardSummary[];
}) {
  const [teams, setTeams] = useState(initialTeams);
  const [selectedTeamId, setSelectedTeamId] = useState(initialTeams[0]?.id ?? "");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [loadedMembersTeamId, setLoadedMembersTeamId] = useState("");
  const [teamBoards, setTeamBoards] = useState<TeamBoardSummary[]>(initialTeamBoards);
  const [loadedTeamBoardsTeamId, setLoadedTeamBoardsTeamId] = useState(
    initialTeams[0]?.id ?? "",
  );
  const [boardGrantsByBoardId, setBoardGrantsByBoardId] = useState<
    Record<string, TeamBoardMemberGrant[]>
  >({});
  const [boardGrantForms, setBoardGrantForms] = useState<
    Record<string, { userId: string; role: TeamBoardMemberGrantRole }>
  >({});
  const [personalBoardVisibilityImpactByTeamId, setPersonalBoardVisibilityImpactByTeamId] =
    useState<Record<string, TeamPersonalBoardVisibilityImpact>>({});
  const [pendingAction, setPendingAction] = useState("");
  const [message, setMessage] = useState("");
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [editName, setEditName] = useState(initialTeams[0]?.name ?? "");
  const [editDescription, setEditDescription] = useState(initialTeams[0]?.description ?? "");
  const [memberSearchQuery, setMemberSearchQuery] = useState("");
  const [memberCandidates, setMemberCandidates] = useState<TeamMemberCandidate[]>([]);
  const [selectedMemberCandidate, setSelectedMemberCandidate] =
    useState<TeamMemberCandidate | null>(null);
  const [newMemberRole, setNewMemberRole] = useState<TeamMemberRole>("member");
  const [createBoardTitle, setCreateBoardTitle] = useState("");
  const [createBoardDescription, setCreateBoardDescription] = useState("");
  const [createBoardDefaultAccess, setCreateBoardDefaultAccess] =
    useState<TeamBoardDefaultAccess>("viewer");
  const [editingBoardId, setEditingBoardId] = useState("");
  const [editBoardTitle, setEditBoardTitle] = useState("");
  const [editBoardDescription, setEditBoardDescription] = useState("");
  const [editBoardDefaultAccess, setEditBoardDefaultAccess] =
    useState<TeamBoardDefaultAccess>("viewer");
  const canCreateTeam = currentUser.role === "admin" || currentUser.role === "manager";
  const selectedTeam = useMemo(
    () => teams.find((team) => team.id === selectedTeamId) ?? null,
    [selectedTeamId, teams],
  );
  const sortedTeams = useMemo(
    () => [...teams].sort((a, b) => a.name.localeCompare(b.name)),
    [teams],
  );

  async function refreshTeams() {
    const response = await fetch("/api/teams");
    const payload = await readTeamPayload(response);

    if (!response.ok || !payload.teams) {
      throw new Error(payload.error ?? "Unable to refresh teams.");
    }

    setTeams(payload.teams);
    return payload.teams;
  }

  function getBoardGrantForm(board: TeamBoardSummary) {
    return (
      boardGrantForms[board.boardId] ?? {
        userId: "",
        role: getUsefulBoardGrantRoles(board)[0] ?? "owner",
      }
    );
  }

  function updateBoardGrantForm(
    board: TeamBoardSummary,
    patch: Partial<{ userId: string; role: TeamBoardMemberGrantRole }>,
  ) {
    setBoardGrantForms((current) => ({
      ...current,
      [board.boardId]: {
        ...getBoardGrantForm(board),
        ...patch,
      },
    }));
  }

  async function fetchTeamBoardGrants(teamId: string, boardId: string) {
    const response = await fetch(`/api/teams/${teamId}/boards/${boardId}/members`);
    const payload = await readTeamPayload(response);

    if (!response.ok || !payload.grants) {
      throw new Error(payload.error ?? "Unable to load board grants.");
    }

    return payload.grants;
  }

  const loadTeamBoards = useCallback(async (teamId: string) => {
    if (!teamId) {
      setTeamBoards([]);
      setLoadedTeamBoardsTeamId("");
      setBoardGrantsByBoardId({});
      return;
    }

    setPendingAction(`boards:${teamId}`);
    setMessage("");

    try {
      const response = await fetch(`/api/teams/${teamId}/boards`);
      const payload = await readTeamPayload(response);

      if (!response.ok || !payload.boards) {
        throw new Error(payload.error ?? "Unable to load team boards.");
      }

      setTeamBoards(payload.boards);
      setLoadedTeamBoardsTeamId(teamId);
      const grantEntries = await Promise.all(
        payload.boards.map(async (board) => [
          board.boardId,
          await fetchTeamBoardGrants(teamId, board.boardId),
        ] as const),
      );
      setBoardGrantsByBoardId(Object.fromEntries(grantEntries));
    } catch (error) {
      setTeamBoards([]);
      setLoadedTeamBoardsTeamId("");
      setBoardGrantsByBoardId({});
      setMessage(error instanceof Error ? error.message : "Unable to load team boards.");
    } finally {
      setPendingAction("");
    }
  }, []);

  async function loadTeamBoardGrants(teamId: string, boardId: string) {
    setPendingAction(`board-grants:${boardId}`);
    setMessage("");

    try {
      const grants = await fetchTeamBoardGrants(teamId, boardId);
      setBoardGrantsByBoardId((current) => ({
        ...current,
        [boardId]: grants,
      }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load board grants.");
    } finally {
      setPendingAction("");
    }
  }

  async function loadMembers(teamId: string) {
    if (!teamId) {
      setMembers([]);
      setLoadedMembersTeamId("");
      return;
    }

    setPendingAction(`members:${teamId}`);
    setMessage("");

    try {
      const response = await fetch(`/api/teams/${teamId}/members`);
      const payload = await readTeamPayload(response);

      if (!response.ok || !payload.members) {
        throw new Error(payload.error ?? "Unable to load team members.");
      }

      setMembers(payload.members);
      setLoadedMembersTeamId(teamId);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to load team members.");
    } finally {
      setPendingAction("");
    }
  }

  function selectTeam(team: TeamSummary) {
    setSelectedTeamId(team.id);
    setEditName(team.name);
    setEditDescription(team.description);
    setMemberSearchQuery("");
    setMemberCandidates([]);
    setSelectedMemberCandidate(null);
    setCreateBoardTitle("");
    setCreateBoardDescription("");
    setCreateBoardDefaultAccess("viewer");
    setEditingBoardId("");
    setBoardGrantsByBoardId({});
    setBoardGrantForms({});
    void loadMembers(team.id);
  }

  async function createTeam() {
    setPendingAction("create");
    setMessage("");

    try {
      const response = await fetch("/api/teams", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: createName,
          description: createDescription,
        }),
      });
      const payload = await readTeamPayload(response);

      if (!response.ok || !payload.team) {
        throw new Error(payload.error ?? "Unable to create team.");
      }

      const nextTeams = await refreshTeams();
      setCreateName("");
      setCreateDescription("");
      const createdTeam = nextTeams.find((team) => team.id === payload.team?.id) ?? payload.team;
      selectTeam(createdTeam);
      setMessage("Team created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create team.");
    } finally {
      setPendingAction("");
    }
  }

  async function updateSelectedTeam() {
    if (!selectedTeam) {
      return;
    }

    setPendingAction("team:update");
    setMessage("");

    try {
      const response = await fetch(`/api/teams/${selectedTeam.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: editName,
          description: editDescription,
        }),
      });
      const payload = await readTeamPayload(response);

      if (!response.ok || !payload.team) {
        throw new Error(payload.error ?? "Unable to update team.");
      }

      setTeams((current) =>
        current.map((team) => (team.id === payload.team?.id ? payload.team : team)),
      );
      setMessage("Team updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update team.");
    } finally {
      setPendingAction("");
    }
  }

  async function loadPersonalBoardVisibilityImpact(teamId: string) {
    setPendingAction(`personal-board-visibility:impact:${teamId}`);
    setMessage("");

    try {
      const response = await fetch(`/api/teams/${teamId}/personal-board-visibility`);
      const payload = await readTeamPayload(response);

      if (!response.ok || !payload.personalBoardVisibilityImpact) {
        throw new Error(payload.error ?? "Unable to load personal board visibility impact.");
      }

      setPersonalBoardVisibilityImpactByTeamId((current) => ({
        ...current,
        [teamId]: payload.personalBoardVisibilityImpact as TeamPersonalBoardVisibilityImpact,
      }));

      return payload.personalBoardVisibilityImpact;
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to load personal board visibility impact.",
      );
      return null;
    } finally {
      setPendingAction("");
    }
  }

  async function updatePersonalBoardVisibility(enabled: boolean) {
    if (!selectedTeam) {
      return;
    }

    let impact = personalBoardVisibilityImpactByTeamId[selectedTeam.id];

    if (enabled) {
      impact = impact ?? (await loadPersonalBoardVisibilityImpact(selectedTeam.id)) ?? undefined;

      const confirmed = await confirm({
        title: "Let team members view each other's personal boards?",
        body:
          "Enabling this lets active members of this team view each other's personal boards as read-only. They may see task titles, notes, attachment metadata, imported event metadata, and saved board structure. They cannot edit through this access. Imports and notifications remain personal-board-only." +
          (impact
            ? `\n\nEstimated impact: ${impact.affectedUsers} users, ${impact.affectedPersonalBoards} personal boards, ${impact.visibilityPairs} read-only visibility pairs.`
            : ""),
        confirmLabel: "Enable read-only viewing",
        // Widens who can see personal boards, so focus starts on Cancel.
        focusCancel: true,
      });

      if (!confirmed) {
        return;
      }
    }

    setPendingAction(`personal-board-visibility:${selectedTeam.id}`);
    setMessage("");

    try {
      const response = await fetch(
        `/api/teams/${selectedTeam.id}/personal-board-visibility`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ enabled }),
        },
      );
      const payload = await readTeamPayload(response);

      if (!response.ok || !payload.team) {
        throw new Error(payload.error ?? "Unable to update personal board visibility.");
      }

      setTeams((current) =>
        current.map((team) => (team.id === payload.team?.id ? payload.team : team)),
      );

      if (payload.personalBoardVisibilityImpact) {
        setPersonalBoardVisibilityImpactByTeamId((current) => ({
          ...current,
          [payload.team?.id ?? selectedTeam.id]:
            payload.personalBoardVisibilityImpact as TeamPersonalBoardVisibilityImpact,
        }));
      }

      setMessage(
        payload.changed
          ? "Personal board visibility policy updated."
          : "Personal board visibility policy was already current.",
      );
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to update personal board visibility.",
      );
    } finally {
      setPendingAction("");
    }
  }

  async function createTeamBoard() {
    if (!selectedTeam) {
      return;
    }

    setPendingAction("board:create");
    setMessage("");

    try {
      const response = await fetch(`/api/teams/${selectedTeam.id}/boards`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: createBoardTitle,
          description: createBoardDescription,
          teamMemberDefaultAccess: createBoardDefaultAccess,
        }),
      });
      const payload = await readTeamPayload(response);

      if (!response.ok || !payload.board) {
        throw new Error(payload.error ?? "Unable to create team board.");
      }

      setCreateBoardTitle("");
      setCreateBoardDescription("");
      setCreateBoardDefaultAccess("viewer");
      await loadTeamBoards(selectedTeam.id);
      setMessage("Team board created.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to create team board.");
    } finally {
      setPendingAction("");
    }
  }

  function startEditingTeamBoard(board: TeamBoardSummary) {
    setEditingBoardId(board.boardId);
    setEditBoardTitle(board.title);
    setEditBoardDescription(board.description);
    setEditBoardDefaultAccess(board.teamMemberDefaultAccess);
  }

  async function updateTeamBoard(board: TeamBoardSummary) {
    if (!selectedTeam) {
      return;
    }

    setPendingAction(`board:${board.boardId}`);
    setMessage("");

    try {
      const response = await fetch(`/api/teams/${selectedTeam.id}/boards/${board.boardId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: editBoardTitle,
          description: editBoardDescription,
          teamMemberDefaultAccess: editBoardDefaultAccess,
        }),
      });
      const payload = await readTeamPayload(response);

      if (!response.ok || !payload.board) {
        throw new Error(payload.error ?? "Unable to update team board.");
      }

      setEditingBoardId("");
      await loadTeamBoards(selectedTeam.id);
      setMessage("Team board updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update team board.");
    } finally {
      setPendingAction("");
    }
  }

  async function addBoardGrant(board: TeamBoardSummary) {
    if (!selectedTeam) {
      return;
    }

    const form = getBoardGrantForm(board);
    if (!form.userId) {
      setMessage("Select a team member for the board grant.");
      return;
    }

    setPendingAction(`board-grant:add:${board.boardId}`);
    setMessage("");

    try {
      const response = await fetch(
        `/api/teams/${selectedTeam.id}/boards/${board.boardId}/members`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            userId: form.userId,
            role: form.role,
          }),
        },
      );
      const payload = await readTeamPayload(response);

      if (!response.ok || !payload.grant) {
        throw new Error(payload.error ?? "Unable to add board grant.");
      }

      setBoardGrantForms((current) => ({
        ...current,
        [board.boardId]: {
          userId: "",
          role: getUsefulBoardGrantRoles(board)[0] ?? "owner",
        },
      }));
      await loadTeamBoardGrants(selectedTeam.id, board.boardId);
      setMessage("Board grant added.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to add board grant.");
    } finally {
      setPendingAction("");
    }
  }

  async function updateBoardGrant(
    board: TeamBoardSummary,
    grant: TeamBoardMemberGrant,
    role: TeamBoardMemberGrantRole,
  ) {
    if (!selectedTeam) {
      return;
    }

    setPendingAction(`board-grant:${board.boardId}:${grant.userId}`);
    setMessage("");

    try {
      const response = await fetch(
        `/api/teams/${selectedTeam.id}/boards/${board.boardId}/members/${grant.userId}`,
        {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ role }),
        },
      );
      const payload = await readTeamPayload(response);

      if (!response.ok || !payload.grant) {
        throw new Error(payload.error ?? "Unable to update board grant.");
      }

      await loadTeamBoardGrants(selectedTeam.id, board.boardId);
      setMessage("Board grant updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update board grant.");
    } finally {
      setPendingAction("");
    }
  }

  async function removeBoardGrant(board: TeamBoardSummary, grant: TeamBoardMemberGrant) {
    if (!selectedTeam) {
      return;
    }

    setPendingAction(`board-grant:${board.boardId}:${grant.userId}`);
    setMessage("");

    try {
      const response = await fetch(
        `/api/teams/${selectedTeam.id}/boards/${board.boardId}/members/${grant.userId}`,
        { method: "DELETE" },
      );
      const payload = await readTeamPayload(response);

      if (!response.ok || !payload.ok) {
        throw new Error(payload.error ?? "Unable to remove board grant.");
      }

      await loadTeamBoardGrants(selectedTeam.id, board.boardId);
      setMessage("Board grant removed. Team default access still applies.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove board grant.");
    } finally {
      setPendingAction("");
    }
  }

  async function addMember() {
    if (!selectedTeam || !selectedMemberCandidate) {
      return;
    }

    setPendingAction("member:add");
    setMessage("");

    try {
      const response = await fetch(`/api/teams/${selectedTeam.id}/members`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          userId: selectedMemberCandidate.id,
          role: newMemberRole,
        }),
      });
      const payload = await readTeamPayload(response);

      if (!response.ok || !payload.member) {
        throw new Error(payload.error ?? "Unable to add team member.");
      }

      setMemberSearchQuery("");
      setMemberCandidates([]);
      setSelectedMemberCandidate(null);
      setNewMemberRole("member");
      await loadMembers(selectedTeam.id);
      await refreshTeams();
      setMessage("Team member added.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to add team member.");
    } finally {
      setPendingAction("");
    }
  }

  async function searchMemberCandidates() {
    if (!selectedTeam) {
      return;
    }

    const query = memberSearchQuery.trim();
    if (query.length < 2) {
      setMessage("Search for at least 2 characters.");
      setMemberCandidates([]);
      setSelectedMemberCandidate(null);
      return;
    }

    setPendingAction("member:search");
    setMessage("");
    setSelectedMemberCandidate(null);

    try {
      const response = await fetch(
        `/api/teams/${selectedTeam.id}/member-candidates?q=${encodeURIComponent(query)}`,
      );
      const payload = await readTeamPayload(response);

      if (!response.ok || !payload.candidates) {
        throw new Error(payload.error ?? "Unable to search users.");
      }

      setMemberCandidates(payload.candidates);
      if (payload.candidates.length === 0) {
        setMessage("No addable users found.");
      }
    } catch (error) {
      setMemberCandidates([]);
      setMessage(error instanceof Error ? error.message : "Unable to search users.");
    } finally {
      setPendingAction("");
    }
  }

  async function updateMemberRole(member: TeamMember, role: TeamMemberRole) {
    if (!selectedTeam) {
      return;
    }

    setPendingAction(`member:${member.userId}`);
    setMessage("");

    try {
      const response = await fetch(`/api/teams/${selectedTeam.id}/members/${member.userId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const payload = await readTeamPayload(response);

      if (!response.ok || !payload.member) {
        throw new Error(payload.error ?? "Unable to update team member.");
      }

      setMembers((current) =>
        current.map((currentMember) =>
          currentMember.userId === payload.member?.userId ? payload.member : currentMember,
        ),
      );
      setMessage("Team member updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update team member.");
    } finally {
      setPendingAction("");
    }
  }

  async function removeMember(member: TeamMember) {
    if (!selectedTeam) {
      return;
    }

    setPendingAction(`member:${member.userId}`);
    setMessage("");

    try {
      const response = await fetch(`/api/teams/${selectedTeam.id}/members/${member.userId}`, {
        method: "DELETE",
      });
      const payload = await readTeamPayload(response);

      if (!response.ok) {
        throw new Error(payload.error ?? "Unable to remove team member.");
      }

      setMembers((current) =>
        current.filter((currentMember) => currentMember.userId !== member.userId),
      );
      await refreshTeams();
      setMessage("Team member removed.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to remove team member.");
    } finally {
      setPendingAction("");
    }
  }

  const visibleMembers = loadedMembersTeamId === selectedTeamId ? members : [];
  const visibleTeamBoards = loadedTeamBoardsTeamId === selectedTeamId ? teamBoards : [];
  const canManageSelectedTeam = Boolean(selectedTeam?.canManage);
  const canManageSelectedMembers = Boolean(selectedTeam?.canManageMembers);
  const canTogglePersonalBoardVisibility = currentUser.role === "admin";
  const selectedPersonalBoardVisibilityImpact = selectedTeam
    ? personalBoardVisibilityImpactByTeamId[selectedTeam.id]
    : null;

  return (
    <main className="taskboard-shell min-h-screen px-3 py-3 md:px-5 md:py-5">
      {confirmDialog}
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-3">
        <header className="panel-surface panel-strong rounded-[18px] px-4 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                Teams
              </p>
              <h1 className="mt-1 text-[1.5rem] font-semibold tracking-tight text-foreground">
                Team administration
              </h1>
              <p className="mt-1 text-[11px] leading-4 text-muted">
                {currentUser.displayName} - {currentUser.role}
              </p>
            </div>
            <Link
              href="/"
              className="ui-chip-button ui-button-surface inline-flex items-center gap-1 rounded-[10px] border px-3 py-1.5 text-[11px] font-medium"
            >
              <ArrowLeft className="h-3 w-3" />
              Back to board
            </Link>
          </div>
        </header>

        {message ? (
          <div className="panel-surface rounded-[12px] border border-border/70 px-3 py-2 text-[12px] text-foreground">
            {message}
          </div>
        ) : null}

        <div className="grid gap-3 lg:grid-cols-[minmax(280px,0.75fr)_minmax(0,1.25fr)]">
          <section className="panel-surface rounded-[14px] border border-border/70 px-3 py-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-[13px] font-semibold text-foreground">Teams</h2>
                <p className="mt-0.5 text-[10px] leading-4 text-muted">
                  {teams.length} visible
                </p>
              </div>
              <Users className="h-4 w-4 text-muted" />
            </div>

            {canCreateTeam ? (
              <form
                className="mt-3 grid gap-2 rounded-[12px] border border-border/70 px-3 py-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void createTeam();
                }}
              >
                <input
                  value={createName}
                  onChange={(event) => setCreateName(event.target.value)}
                  className="ui-control rounded-[8px] border px-2.5 py-1.5 text-[11px] text-foreground"
                  placeholder="Team name"
                  aria-label="Team name"
                />
                <textarea
                  value={createDescription}
                  onChange={(event) => setCreateDescription(event.target.value)}
                  className="ui-control min-h-[68px] resize-y rounded-[8px] border px-2.5 py-1.5 text-[11px] text-foreground"
                  placeholder="Description"
                  aria-label="Team description"
                />
                <button
                  type="submit"
                  disabled={pendingAction === "create"}
                  className="ui-chip-button ui-button-surface inline-flex items-center justify-center gap-1 rounded-[9px] border px-2.5 py-1 text-[11px] font-medium disabled:opacity-60"
                >
                  <Plus className="h-3 w-3" />
                  Create team
                </button>
              </form>
            ) : null}

            <div className="mt-3 grid gap-1.5">
              {sortedTeams.length > 0 ? (
                sortedTeams.map((team) => (
                  <button
                    key={team.id}
                    type="button"
                    onClick={() => selectTeam(team)}
                    className={`rounded-[10px] border px-3 py-2 text-left transition ${
                      team.id === selectedTeamId
                        ? "ui-chip-active border-border"
                        : "ui-button-surface border-border/70"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-[12px] font-semibold text-foreground">{team.name}</span>
                      <span className="text-[10px] text-muted">{team.memberCount}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted">
                      <span>{team.actorRole ?? (currentUser.role === "admin" ? "admin" : "viewer")}</span>
                      {team.canManage ? <span>manage</span> : <span>view</span>}
                    </div>
                  </button>
                ))
              ) : (
                <div className="rounded-[12px] border border-border/70 px-3 py-3 text-[12px] text-muted">
                  No teams available.
                </div>
              )}
            </div>
          </section>

          <section className="panel-surface rounded-[14px] border border-border/70 px-3 py-3">
            {selectedTeam ? (
              <div className="grid gap-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                      Selected team
                    </p>
                    <h2 className="mt-1 text-[1.2rem] font-semibold text-foreground">
                      {selectedTeam.name}
                    </h2>
                    <p className="mt-1 text-[11px] leading-4 text-muted">
                      Updated {formatDate(selectedTeam.updatedAt)}
                    </p>
                  </div>
                  <span className="inline-flex w-fit items-center gap-1 rounded-full border border-border/70 px-2 py-0.5 text-[10px] font-medium text-foreground">
                    <ShieldCheck className="h-3 w-3" />
                    {canManageSelectedTeam ? "Manager" : "Member"}
                  </span>
                </div>

                <form
                  className="grid gap-2 rounded-[12px] border border-border/70 px-3 py-3"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void updateSelectedTeam();
                  }}
                >
                  <input
                    value={editName}
                    disabled={!canManageSelectedTeam}
                    onChange={(event) => setEditName(event.target.value)}
                    className="ui-control rounded-[8px] border px-2.5 py-1.5 text-[11px] text-foreground disabled:opacity-60"
                    aria-label="Selected team name"
                  />
                  <textarea
                    value={editDescription}
                    disabled={!canManageSelectedTeam}
                    onChange={(event) => setEditDescription(event.target.value)}
                    className="ui-control min-h-[82px] resize-y rounded-[8px] border px-2.5 py-1.5 text-[11px] text-foreground disabled:opacity-60"
                    aria-label="Selected team description"
                  />
                  {canManageSelectedTeam ? (
                    <button
                      type="submit"
                      disabled={pendingAction === "team:update"}
                      className="ui-chip-button ui-button-surface w-fit rounded-[9px] border px-2.5 py-1 text-[11px] font-medium disabled:opacity-60"
                    >
                      Save team
                    </button>
                  ) : null}
                </form>

                <div className="grid gap-3 rounded-[12px] border border-border/70 px-3 py-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-[12px] font-semibold text-foreground">
                        Personal board visibility
                      </h3>
                      <p className="mt-1 text-[11px] leading-4 text-muted">
                        {selectedTeam.personalBoardViewEnabled
                          ? "Enabled for this team when the server feature flag is enabled."
                          : "Disabled for this team."}
                      </p>
                    </div>
                    <span className="inline-flex w-fit items-center rounded-full border border-border/70 px-2 py-0.5 text-[10px] font-medium text-foreground">
                      {selectedTeam.personalBoardViewEnabled ? "enabled" : "disabled"}
                    </span>
                  </div>

                  {canTogglePersonalBoardVisibility ? (
                    <div className="grid gap-2 rounded-[10px] border border-border/70 px-2.5 py-2">
                      <p className="text-[11px] leading-4 text-muted">
                        Enabling this lets active members of this team view teammate
                        personal boards as read-only. They may see task titles, notes,
                        attachment metadata, imported event metadata, and saved board
                        structure. They cannot edit through this access. Imports,
                        Notifications
                        remain personal-board-only.
                      </p>

                      {selectedPersonalBoardVisibilityImpact ? (
                        <div className="grid gap-1 text-[11px] text-muted sm:grid-cols-2">
                          <span>
                            Users: {selectedPersonalBoardVisibilityImpact.affectedUsers}
                          </span>
                          <span>
                            Boards:{" "}
                            {selectedPersonalBoardVisibilityImpact.affectedPersonalBoards}
                          </span>
                          <span>
                            Visibility pairs:{" "}
                            {selectedPersonalBoardVisibilityImpact.visibilityPairs}
                          </span>
                          <span>Tasks: {selectedPersonalBoardVisibilityImpact.tasks}</span>
                          <span>Notes: {selectedPersonalBoardVisibilityImpact.notes}</span>
                          <span>
                            Attachments: {selectedPersonalBoardVisibilityImpact.attachments}
                          </span>
                          <span>
                            Imports: {selectedPersonalBoardVisibilityImpact.importedEvents}
                          </span>
                          <span>
                            Notifications:{" "}
                            {selectedPersonalBoardVisibilityImpact.notifications}
                          </span>
                        </div>
                      ) : null}

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            selectedTeam
                              ? void loadPersonalBoardVisibilityImpact(selectedTeam.id)
                              : undefined
                          }
                          disabled={
                            pendingAction ===
                            `personal-board-visibility:impact:${selectedTeam.id}`
                          }
                          className="ui-chip-button ui-button-surface rounded-[9px] border px-2.5 py-1 text-[11px] font-medium disabled:opacity-60"
                        >
                          Preview impact
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            void updatePersonalBoardVisibility(
                              !selectedTeam.personalBoardViewEnabled,
                            )
                          }
                          disabled={
                            pendingAction ===
                            `personal-board-visibility:${selectedTeam.id}`
                          }
                          className="ui-chip-button ui-button-surface rounded-[9px] border px-2.5 py-1 text-[11px] font-medium disabled:opacity-60"
                        >
                          {selectedTeam.personalBoardViewEnabled ? "Disable" : "Enable"}
                        </button>
                      </div>
                    </div>
                  ) : null}
                </div>

                <div className="rounded-[12px] border border-border/70">
                  <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-2">
                    <div>
                      <h3 className="text-[12px] font-semibold text-foreground">Team boards</h3>
                      <p className="mt-0.5 text-[10px] text-muted">
                        {visibleTeamBoards.length} loaded
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadTeamBoards(selectedTeam.id)}
                      disabled={pendingAction === `boards:${selectedTeam.id}`}
                      className="ui-chip-button ui-button-surface rounded-[9px] border px-2.5 py-1 text-[11px] font-medium disabled:opacity-60"
                    >
                      Refresh
                    </button>
                  </div>

                  {canManageSelectedTeam ? (
                    <form
                      className="grid gap-2 border-b border-border/70 px-3 py-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void createTeamBoard();
                      }}
                    >
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
                        <input
                          value={createBoardTitle}
                          onChange={(event) => setCreateBoardTitle(event.target.value)}
                          className="ui-control rounded-[8px] border px-2.5 py-1.5 text-[11px] text-foreground"
                          placeholder="Board title"
                          aria-label="Team board title"
                        />
                        <select
                          value={createBoardDefaultAccess}
                          onChange={(event) =>
                            setCreateBoardDefaultAccess(
                              event.target.value as TeamBoardDefaultAccess,
                            )
                          }
                          className="ui-control rounded-[8px] border px-2.5 py-1.5 text-[11px] text-foreground"
                          aria-label="Team board default access"
                        >
                          {teamBoardDefaultAccessOptions.map((access) => (
                            <option key={access} value={access}>
                              {access}
                            </option>
                          ))}
                        </select>
                      </div>
                      <textarea
                        value={createBoardDescription}
                        onChange={(event) => setCreateBoardDescription(event.target.value)}
                        className="ui-control min-h-[62px] resize-y rounded-[8px] border px-2.5 py-1.5 text-[11px] text-foreground"
                        placeholder="Description"
                        aria-label="Team board description"
                      />
                      <button
                        type="submit"
                        disabled={pendingAction === "board:create"}
                        className="ui-chip-button ui-button-surface inline-flex w-fit items-center justify-center gap-1 rounded-[9px] border px-2.5 py-1 text-[11px] font-medium disabled:opacity-60"
                      >
                        <Plus className="h-3 w-3" />
                        Create board
                      </button>
                    </form>
                  ) : null}

                  <div className="grid gap-2 px-3 py-3">
                    {visibleTeamBoards.length > 0 ? (
                      visibleTeamBoards.map((board) => {
                        const isEditing = editingBoardId === board.boardId;
                        const canManageBoard = canManageSelectedTeam && board.canManage;
                        const isPending = pendingAction === `board:${board.boardId}`;
                        const boardGrants = boardGrantsByBoardId[board.boardId] ?? [];
                        const grantedUserIds = new Set(
                          boardGrants.map((grant) => grant.userId),
                        );
                        const usefulGrantRoles = getUsefulBoardGrantRoles(board);
                        const grantForm = getBoardGrantForm(board);
                        const addableGrantMembers = visibleMembers.filter(
                          (member) =>
                            !member.isDisabled &&
                            member.teamRole === "member" &&
                            !grantedUserIds.has(member.userId),
                        );

                        return (
                          <div
                            key={board.boardId}
                            className="rounded-[12px] border border-border/70 px-3 py-3"
                          >
                            {isEditing && canManageBoard ? (
                              <form
                                className="grid gap-2"
                                onSubmit={(event) => {
                                  event.preventDefault();
                                  void updateTeamBoard(board);
                                }}
                              >
                                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_150px]">
                                  <input
                                    value={editBoardTitle}
                                    onChange={(event) => setEditBoardTitle(event.target.value)}
                                    className="ui-control rounded-[8px] border px-2.5 py-1.5 text-[11px] text-foreground"
                                    aria-label={`Title for ${board.title}`}
                                  />
                                  <select
                                    value={editBoardDefaultAccess}
                                    onChange={(event) =>
                                      setEditBoardDefaultAccess(
                                        event.target.value as TeamBoardDefaultAccess,
                                      )
                                    }
                                    className="ui-control rounded-[8px] border px-2.5 py-1.5 text-[11px] text-foreground"
                                    aria-label={`Default access for ${board.title}`}
                                  >
                                    {teamBoardDefaultAccessOptions.map((access) => (
                                      <option key={access} value={access}>
                                        {access}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <textarea
                                  value={editBoardDescription}
                                  onChange={(event) =>
                                    setEditBoardDescription(event.target.value)
                                  }
                                  className="ui-control min-h-[62px] resize-y rounded-[8px] border px-2.5 py-1.5 text-[11px] text-foreground"
                                  aria-label={`Description for ${board.title}`}
                                />
                                <div className="flex flex-wrap items-center gap-2">
                                  <button
                                    type="submit"
                                    disabled={isPending}
                                    className="ui-chip-button ui-button-surface rounded-[9px] border px-2.5 py-1 text-[11px] font-medium disabled:opacity-60"
                                  >
                                    Save board
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setEditingBoardId("")}
                                    className="ui-chip-button ui-button-surface rounded-[9px] border px-2.5 py-1 text-[11px] font-medium"
                                  >
                                    Cancel
                                  </button>
                                </div>
                              </form>
                            ) : (
                              <div className="grid gap-2">
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                                  <div className="min-w-0">
                                    <div className="flex items-center gap-2">
                                      <LayoutDashboard className="h-3.5 w-3.5 shrink-0 text-muted" />
                                      <h4 className="truncate text-[12px] font-semibold text-foreground">
                                        {board.title}
                                      </h4>
                                    </div>
                                    {board.description ? (
                                      <p className="mt-1 text-[11px] leading-4 text-muted">
                                        {board.description}
                                      </p>
                                    ) : null}
                                  </div>
                                  <div className="flex shrink-0 flex-wrap items-center gap-1.5 text-[10px]">
                                    <span className="rounded-full border border-border/70 px-2 py-0.5 text-foreground">
                                      {board.accessLevel}
                                    </span>
                                    <span className="rounded-full border border-border/70 px-2 py-0.5 text-muted">
                                      default {board.teamMemberDefaultAccess}
                                    </span>
                                  </div>
                                </div>
                                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                                  <div
                                    className="max-w-full truncate font-mono text-[10px] text-muted"
                                    title={board.boardId}
                                  >
                                    {board.boardId}
                                  </div>
                                  <div className="flex flex-wrap items-center gap-2">
                                    <Link
                                      href={`/?boardId=${encodeURIComponent(board.boardId)}`}
                                      className="ui-chip-button ui-button-surface inline-flex w-fit items-center gap-1 rounded-[9px] border px-2.5 py-1 text-[11px] font-medium"
                                    >
                                      <ExternalLink className="h-3 w-3" />
                                      Open board
                                    </Link>
                                    {canManageBoard ? (
                                      <button
                                        type="button"
                                        onClick={() => startEditingTeamBoard(board)}
                                        className="ui-chip-button ui-button-surface inline-flex w-fit items-center gap-1 rounded-[9px] border px-2.5 py-1 text-[11px] font-medium"
                                      >
                                        <Pencil className="h-3 w-3" />
                                        Edit
                                      </button>
                                    ) : (
                                      <span className="text-[11px] text-muted">View only</span>
                                    )}
                                  </div>
                                </div>
                                <div className="border-t border-border/70 pt-2">
                                  <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center sm:justify-between">
                                    <div>
                                      <h5 className="text-[11px] font-semibold text-foreground">
                                        Explicit member grants
                                      </h5>
                                      <p className="mt-0.5 text-[10px] leading-4 text-muted">
                                        Team members inherit default {board.teamMemberDefaultAccess}.
                                        Removing a grant reverts to that default.
                                      </p>
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void loadTeamBoardGrants(selectedTeam.id, board.boardId)
                                      }
                                      disabled={
                                        pendingAction === `board-grants:${board.boardId}`
                                      }
                                      className="ui-chip-button ui-button-surface w-fit rounded-[9px] border px-2.5 py-1 text-[11px] font-medium disabled:opacity-60"
                                    >
                                      Refresh grants
                                    </button>
                                  </div>

                                  {boardGrants.length > 0 ? (
                                    <div className="mt-2 grid gap-1.5">
                                      {boardGrants.map((grant) => {
                                        const grantPending =
                                          pendingAction ===
                                          `board-grant:${board.boardId}:${grant.userId}`;
                                        const editableRoles = Array.from(
                                          new Set([
                                            grant.explicitRole,
                                            ...usefulGrantRoles,
                                          ]),
                                        ).filter((role) =>
                                          teamBoardMemberGrantRoleOptions.includes(role),
                                        );

                                        return (
                                          <div
                                            key={grant.userId}
                                            className="grid gap-2 rounded-[10px] border border-border/70 px-2 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
                                          >
                                            <div className="min-w-0">
                                              <div className="truncate text-[11px] font-medium text-foreground">
                                                {grant.displayName}
                                              </div>
                                              <div className="mt-0.5 truncate text-[10px] text-muted">
                                                {grant.email}
                                                {grant.username
                                                  ? ` - ${grant.username}`
                                                  : ""}
                                              </div>
                                              <div className="mt-1 flex flex-wrap gap-1 text-[10px] text-muted">
                                                <span className="rounded-full border border-border/70 px-2 py-0.5">
                                                  explicit {grant.explicitRole}
                                                </span>
                                                <span className="rounded-full border border-border/70 px-2 py-0.5">
                                                  effective {grant.effectiveAccessLevel}
                                                </span>
                                                <span className="rounded-full border border-border/70 px-2 py-0.5">
                                                  team {grant.teamRole}
                                                </span>
                                              </div>
                                            </div>
                                            {canManageBoard ? (
                                              <div className="flex flex-wrap items-center gap-2">
                                                <select
                                                  value={grant.explicitRole}
                                                  onChange={(event) =>
                                                    void updateBoardGrant(
                                                      board,
                                                      grant,
                                                      event.target
                                                        .value as TeamBoardMemberGrantRole,
                                                    )
                                                  }
                                                  disabled={grantPending}
                                                  className="ui-control rounded-[8px] border px-2.5 py-1.5 text-[11px] text-foreground disabled:opacity-60"
                                                  aria-label={`Explicit board access for ${grant.displayName}`}
                                                >
                                                  {editableRoles.map((role) => (
                                                    <option key={role} value={role}>
                                                      {role}
                                                    </option>
                                                  ))}
                                                </select>
                                                <button
                                                  type="button"
                                                  onClick={() =>
                                                    void removeBoardGrant(board, grant)
                                                  }
                                                  disabled={grantPending}
                                                  className="ui-chip-button ui-button-surface rounded-[9px] border px-2.5 py-1 text-[11px] font-medium disabled:opacity-60"
                                                >
                                                  Remove
                                                </button>
                                              </div>
                                            ) : null}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  ) : (
                                    <div className="mt-2 rounded-[10px] border border-border/70 px-2.5 py-2 text-[11px] text-muted">
                                      No explicit member grants.
                                    </div>
                                  )}

                                  {canManageBoard ? (
                                    <form
                                      className="mt-2 grid gap-2 rounded-[10px] border border-border/70 px-2 py-2"
                                      onSubmit={(event) => {
                                        event.preventDefault();
                                        void addBoardGrant(board);
                                      }}
                                    >
                                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_120px_auto]">
                                        <select
                                          value={grantForm.userId}
                                          onChange={(event) =>
                                            updateBoardGrantForm(board, {
                                              userId: event.target.value,
                                            })
                                          }
                                          className="ui-control min-w-0 rounded-[8px] border px-2.5 py-1.5 text-[11px] text-foreground"
                                          aria-label={`Team member for ${board.title} grant`}
                                        >
                                          <option value="">
                                            {loadedMembersTeamId === selectedTeamId
                                              ? "Select team member"
                                              : "Refresh members first"}
                                          </option>
                                          {addableGrantMembers.map((member) => (
                                            <option key={member.userId} value={member.userId}>
                                              {member.displayName} - {member.email}
                                            </option>
                                          ))}
                                        </select>
                                        <select
                                          value={grantForm.role}
                                          onChange={(event) =>
                                            updateBoardGrantForm(board, {
                                              role: event.target
                                                .value as TeamBoardMemberGrantRole,
                                            })
                                          }
                                          className="ui-control rounded-[8px] border px-2.5 py-1.5 text-[11px] text-foreground"
                                          aria-label={`Grant role for ${board.title}`}
                                        >
                                          {usefulGrantRoles.map((role) => (
                                            <option key={role} value={role}>
                                              {role}
                                            </option>
                                          ))}
                                        </select>
                                        <button
                                          type="submit"
                                          disabled={
                                            pendingAction ===
                                              `board-grant:add:${board.boardId}` ||
                                            !grantForm.userId
                                          }
                                          className="ui-chip-button ui-button-surface rounded-[9px] border px-2.5 py-1 text-[11px] font-medium disabled:opacity-60"
                                        >
                                          Add grant
                                        </button>
                                      </div>
                                    </form>
                                  ) : null}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                    ) : (
                      <div className="rounded-[12px] border border-border/70 px-3 py-4 text-[12px] text-muted">
                        No team boards.
                      </div>
                    )}
                  </div>
                </div>

                <div className="rounded-[12px] border border-border/70">
                  <div className="flex items-center justify-between gap-3 border-b border-border/70 px-3 py-2">
                    <div>
                      <h3 className="text-[12px] font-semibold text-foreground">Members</h3>
                      <p className="mt-0.5 text-[10px] text-muted">
                        {visibleMembers.length} loaded
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void loadMembers(selectedTeam.id)}
                      disabled={pendingAction === `members:${selectedTeam.id}`}
                      className="ui-chip-button ui-button-surface rounded-[9px] border px-2.5 py-1 text-[11px] font-medium disabled:opacity-60"
                    >
                      Refresh
                    </button>
                  </div>

                  {canManageSelectedMembers ? (
                    <form
                      className="grid gap-2 border-b border-border/70 px-3 py-3"
                      onSubmit={(event) => {
                        event.preventDefault();
                        void addMember();
                      }}
                    >
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                        <input
                          value={memberSearchQuery}
                          onChange={(event) => {
                            setMemberSearchQuery(event.target.value);
                            setMemberCandidates([]);
                            setSelectedMemberCandidate(null);
                          }}
                          className="ui-control rounded-[8px] border px-2.5 py-1.5 text-[11px] text-foreground"
                          placeholder="Search email, username, or name"
                          aria-label="Search users to add"
                        />
                        <button
                          type="button"
                          onClick={() => void searchMemberCandidates()}
                          disabled={pendingAction === "member:search"}
                          className="ui-chip-button ui-button-surface rounded-[9px] border px-2.5 py-1 text-[11px] font-medium disabled:opacity-60"
                        >
                          Search
                        </button>
                      </div>

                      {memberCandidates.length > 0 ? (
                        <div className="grid gap-1 rounded-[10px] border border-border/70 px-2 py-2">
                          {memberCandidates.map((candidate) => (
                            <button
                              key={candidate.id}
                              type="button"
                              onClick={() => setSelectedMemberCandidate(candidate)}
                              className={`rounded-[8px] border px-2 py-1.5 text-left transition ${
                                selectedMemberCandidate?.id === candidate.id
                                  ? "ui-chip-active border-border"
                                  : "ui-button-surface border-border/70"
                              }`}
                            >
                              <div className="text-[11px] font-medium text-foreground">
                                {candidate.displayName}
                              </div>
                              <div className="mt-0.5 text-[10px] text-muted">
                                {candidate.email}
                                {candidate.username ? ` - ${candidate.username}` : ""}
                              </div>
                            </button>
                          ))}
                        </div>
                      ) : null}

                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_130px_auto]">
                        <div className="rounded-[8px] border border-border/70 px-2.5 py-1.5 text-[11px] text-muted">
                          {selectedMemberCandidate
                            ? `Selected: ${selectedMemberCandidate.email}`
                            : "Select a user from search results"}
                        </div>
                        <select
                          value={newMemberRole}
                          onChange={(event) => setNewMemberRole(event.target.value as TeamMemberRole)}
                          className="ui-control rounded-[8px] border px-2.5 py-1.5 text-[11px] text-foreground"
                          aria-label="New member role"
                        >
                          {memberRoleOptions.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                        <button
                          type="submit"
                          disabled={pendingAction === "member:add" || !selectedMemberCandidate}
                          className="ui-chip-button ui-button-surface inline-flex items-center justify-center gap-1 rounded-[9px] border px-2.5 py-1 text-[11px] font-medium disabled:opacity-60"
                        >
                          <Plus className="h-3 w-3" />
                          Add
                        </button>
                      </div>
                    </form>
                  ) : null}

                  <div className="overflow-x-auto">
                    <table className="min-w-full border-collapse text-left text-[12px]">
                      <thead className="border-b border-border/70 text-[10px] uppercase tracking-[0.12em] text-muted">
                        <tr>
                          <th className="px-3 py-2 font-semibold">User</th>
                          <th className="px-3 py-2 font-semibold">App role</th>
                          <th className="px-3 py-2 font-semibold">Team role</th>
                          <th className="px-3 py-2 font-semibold">Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {visibleMembers.length > 0 ? (
                          visibleMembers.map((member) => {
                            const isPending = pendingAction === `member:${member.userId}`;

                            return (
                              <tr key={member.userId} className="border-b border-border/50 last:border-b-0">
                                <td className="px-3 py-3 align-top">
                                  <div className="font-medium text-foreground">{member.displayName}</div>
                                  <div className="mt-0.5 text-[11px] text-muted">{member.email}</div>
                                  <div className="mt-1 max-w-[260px] truncate font-mono text-[10px] text-muted" title={member.userId}>
                                    {member.userId}
                                  </div>
                                  {member.isDisabled ? (
                                    <div className="mt-1 text-[10px] text-destructive">Disabled</div>
                                  ) : null}
                                </td>
                                <td className="px-3 py-3 align-top text-foreground">{member.appRole}</td>
                                <td className="px-3 py-3 align-top">
                                  <select
                                    value={member.teamRole}
                                    disabled={!canManageSelectedMembers || isPending}
                                    onChange={(event) =>
                                      void updateMemberRole(member, event.target.value as TeamMemberRole)
                                    }
                                    className="ui-control rounded-[8px] border px-2 py-1 text-[11px] text-foreground disabled:opacity-60"
                                    aria-label={`Team role for ${member.email}`}
                                  >
                                    {memberRoleOptions.map((role) => (
                                      <option key={role} value={role}>
                                        {role}
                                      </option>
                                    ))}
                                  </select>
                                </td>
                                <td className="px-3 py-3 align-top">
                                  {canManageSelectedMembers ? (
                                    <button
                                      type="button"
                                      disabled={isPending}
                                      onClick={() => void removeMember(member)}
                                      className="ui-chip-button ui-button-surface inline-flex items-center gap-1 rounded-[9px] border px-2.5 py-1 text-[11px] font-medium disabled:opacity-60"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                      Remove
                                    </button>
                                  ) : (
                                    <span className="text-[11px] text-muted">View only</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })
                        ) : (
                          <tr>
                            <td className="px-3 py-4 text-[12px] text-muted" colSpan={4}>
                              No members loaded. Use Refresh to load team members.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-[12px] border border-border/70 px-3 py-4 text-[12px] text-muted">
                Select or create a team.
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
