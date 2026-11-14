import Link from "next/link";
import { TeamsPage } from "@/components/teams-page";
import { getCurrentTaskboardUser } from "@/lib/taskboard-request";
import { listTeamBoards, listTeams } from "@/lib/taskboard-store";

export const dynamic = "force-dynamic";

export default async function TeamsRoutePage() {
  const user = await getCurrentTaskboardUser();

  if (!user?.id || user.isDisabled) {
    return (
      <main className="taskboard-shell min-h-screen px-3 py-3 md:px-5 md:py-5">
        <div className="panel-surface panel-strong mx-auto max-w-[720px] rounded-[18px] px-4 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
            Teams
          </p>
          <h1 className="mt-1 text-[1.35rem] font-semibold tracking-tight text-foreground">
            Access denied
          </h1>
          <p className="mt-2 text-[12px] leading-5 text-muted">
            Team administration requires an active Taskboard account.
          </p>
          <Link
            href="/"
            className="ui-chip-button ui-button-surface mt-4 inline-flex rounded-[10px] border px-3 py-1.5 text-[11px] font-medium"
          >
            Back to board
          </Link>
        </div>
      </main>
    );
  }

  const teams = await listTeams(user);
  const teamBoards = teams[0]?.id ? await listTeamBoards(user, teams[0].id) : [];

  return (
    <TeamsPage
      currentUser={{
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        role: user.role ?? "standard",
      }}
      teams={teams}
      teamBoards={teamBoards}
    />
  );
}
