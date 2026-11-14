import Link from "next/link";
import { ArrowLeft, ChevronLeft, ChevronRight, Settings2, UserCog } from "lucide-react";
import type { AdminAuditEventListItem } from "@/lib/taskboard-store";
import type { AdminAuditEventFilters } from "@/lib/admin-audit-policy";

const actionOptions = [
  "user.created",
  "user.role_changed",
  "user.disabled_changed",
  "team.created",
  "team.updated",
  "team.member.added",
  "team.member.role_changed",
  "team.member.removed",
  "team_board.created",
  "team_board.updated",
  "team_board.default_access_changed",
  "team_board.member_grant.added",
  "team_board.member_grant.changed",
  "team_board.member_grant.removed",
  "app.permission_settings.changed",
  "board.privacy_changed",
  "personal_board.member_grant.added",
  "personal_board.member_grant.changed",
  "personal_board.member_grant.removed",
];

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function formatJson(value: unknown) {
  return JSON.stringify(value ?? {}, null, 2);
}

function targetLabel(event: AdminAuditEventListItem) {
  const targets = [
    event.targetUser
      ? `User: ${event.targetUser.displayName || event.targetUser.email || event.targetUser.id}`
      : "",
    event.targetTeam ? `Team: ${event.targetTeam.name}` : "",
    event.targetBoard ? `Board: ${event.targetBoard.title}` : "",
  ].filter(Boolean);

  return targets.length > 0 ? targets.join(" / ") : "No target";
}

function buildPageHref(filters: AdminAuditEventFilters, nextOffset: number) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(filters)) {
    if (key === "offset" || value === undefined || value === "" || value === null) {
      continue;
    }
    params.set(key, String(value));
  }

  if (nextOffset > 0) {
    params.set("offset", String(nextOffset));
  }

  const query = params.toString();
  return query ? `/admin/audit?${query}` : "/admin/audit";
}

export function AdminAuditPage({
  events,
  filters,
  pagination,
}: {
  events: AdminAuditEventListItem[];
  filters: AdminAuditEventFilters;
  pagination: {
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}) {
  const previousOffset = Math.max(0, pagination.offset - pagination.limit);
  const nextOffset = pagination.offset + pagination.limit;

  return (
    <main className="taskboard-shell min-h-screen px-3 py-3 md:px-5 md:py-5">
      <div className="mx-auto flex w-full max-w-[1280px] flex-col gap-3">
        <header className="panel-surface panel-strong rounded-[18px] px-4 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                Admin
              </p>
              <h1 className="mt-1 text-[1.5rem] font-semibold tracking-tight text-foreground">
                Audit log
              </h1>
              <p className="mt-1 text-[11px] leading-4 text-muted">
                Review administrative user, team, team-board, and grant changes.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link
                href="/"
                className="ui-chip-button ui-button-surface inline-flex items-center gap-1 rounded-[10px] border px-3 py-1.5 text-[11px] font-medium"
              >
                <ArrowLeft className="h-3 w-3" />
                Back to board
              </Link>
              <Link
                href="/admin/users"
                className="ui-chip-button ui-button-surface inline-flex items-center gap-1 rounded-[10px] border px-3 py-1.5 text-[11px] font-medium"
              >
                <UserCog className="h-3 w-3" />
                User administration
              </Link>
              <Link
                href="/admin/settings/permissions"
                className="ui-chip-button ui-button-surface inline-flex items-center gap-1 rounded-[10px] border px-3 py-1.5 text-[11px] font-medium"
              >
                <Settings2 className="h-3 w-3" />
                Permission settings
              </Link>
            </div>
          </div>
        </header>

        <form
          action="/admin/audit"
          className="panel-surface grid gap-3 rounded-[14px] border border-border/70 px-3 py-3 text-[12px] md:grid-cols-2 xl:grid-cols-4"
        >
          <label className="grid gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
              Action
            </span>
            <select
              name="action"
              defaultValue={filters.action ?? ""}
              className="ui-control rounded-[8px] border px-2 py-1.5 text-[12px] text-foreground"
            >
              <option value="">All actions</option>
              {actionOptions.map((action) => (
                <option key={action} value={action}>
                  {action}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
              From
            </span>
            <input
              type="date"
              name="from"
              defaultValue={filters.from?.slice(0, 10) ?? ""}
              className="ui-control rounded-[8px] border px-2 py-1.5 text-[12px] text-foreground"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
              To
            </span>
            <input
              type="date"
              name="to"
              defaultValue={filters.to?.slice(0, 10) ?? ""}
              className="ui-control rounded-[8px] border px-2 py-1.5 text-[12px] text-foreground"
            />
          </label>
          <label className="grid gap-1">
            <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
              Limit
            </span>
            <input
              type="number"
              min="1"
              max="200"
              name="limit"
              defaultValue={filters.limit}
              className="ui-control rounded-[8px] border px-2 py-1.5 text-[12px] text-foreground"
            />
          </label>
          {[
            ["actorUserId", "Actor user ID", filters.actorUserId],
            ["targetUserId", "Target user ID", filters.targetUserId],
            ["targetTeamId", "Target team ID", filters.targetTeamId],
            ["targetBoardId", "Target board ID", filters.targetBoardId],
          ].map(([name, label, value]) => (
            <label key={name} className="grid gap-1">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                {label}
              </span>
              <input
                name={name}
                defaultValue={value ?? ""}
                className="ui-control rounded-[8px] border px-2 py-1.5 font-mono text-[11px] text-foreground"
              />
            </label>
          ))}
          <div className="flex items-end gap-2">
            <button
              type="submit"
              className="ui-chip-button ui-button-surface rounded-[10px] border px-3 py-1.5 text-[11px] font-medium"
            >
              Apply filters
            </button>
            <Link
              href="/admin/audit"
              className="ui-chip-button ui-button-surface rounded-[10px] border px-3 py-1.5 text-[11px] font-medium"
            >
              Reset
            </Link>
          </div>
        </form>

        <section className="panel-surface overflow-hidden rounded-[14px] border border-border/70">
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-[12px]">
              <thead className="border-b border-border/70 text-[10px] uppercase tracking-[0.12em] text-muted">
                <tr>
                  <th className="px-3 py-2 font-semibold">Time</th>
                  <th className="px-3 py-2 font-semibold">Action</th>
                  <th className="px-3 py-2 font-semibold">Actor</th>
                  <th className="px-3 py-2 font-semibold">Target</th>
                  <th className="px-3 py-2 font-semibold">Changes</th>
                </tr>
              </thead>
              <tbody>
                {events.length === 0 ? (
                  <tr>
                    <td className="px-3 py-8 text-center text-muted" colSpan={5}>
                      No audit events match these filters.
                    </td>
                  </tr>
                ) : (
                  events.map((event) => (
                    <tr key={event.id} className="border-b border-border/50 last:border-b-0">
                      <td className="px-3 py-3 align-top text-[11px] text-muted">
                        <div>{formatDate(event.createdAt)}</div>
                        <div className="mt-1 max-w-[220px] truncate font-mono text-[10px]" title={event.id}>
                          {event.id}
                        </div>
                      </td>
                      <td className="px-3 py-3 align-top font-mono text-[11px] text-foreground">
                        {event.action}
                      </td>
                      <td className="px-3 py-3 align-top">
                        {event.actor ? (
                          <>
                            <div className="font-medium text-foreground">{event.actor.displayName}</div>
                            <div className="mt-0.5 text-[11px] text-muted">{event.actor.email}</div>
                          </>
                        ) : (
                          <span className="text-muted">Deleted user</span>
                        )}
                      </td>
                      <td className="px-3 py-3 align-top text-foreground">{targetLabel(event)}</td>
                      <td className="px-3 py-3 align-top">
                        <div className="grid gap-2 xl:grid-cols-2">
                          <div>
                            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                              Previous
                            </div>
                            <pre className="max-h-[180px] overflow-auto rounded-[8px] border border-border/60 bg-background/50 p-2 text-[10px] leading-4 text-foreground">
                              {formatJson(event.previousValues)}
                            </pre>
                          </div>
                          <div>
                            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
                              New
                            </div>
                            <pre className="max-h-[180px] overflow-auto rounded-[8px] border border-border/60 bg-background/50 p-2 text-[10px] leading-4 text-foreground">
                              {formatJson(event.newValues)}
                            </pre>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </section>

        <nav className="flex items-center justify-between text-[12px] text-muted">
          <Link
            href={buildPageHref(filters, previousOffset)}
            aria-disabled={pagination.offset === 0}
            className="ui-chip-button ui-button-surface inline-flex items-center gap-1 rounded-[10px] border px-3 py-1.5 font-medium aria-disabled:pointer-events-none aria-disabled:opacity-50"
          >
            <ChevronLeft className="h-3 w-3" />
            Previous
          </Link>
          <span>
            Showing {events.length} events from offset {pagination.offset}
          </span>
          <Link
            href={buildPageHref(filters, nextOffset)}
            aria-disabled={!pagination.hasMore}
            className="ui-chip-button ui-button-surface inline-flex items-center gap-1 rounded-[10px] border px-3 py-1.5 font-medium aria-disabled:pointer-events-none aria-disabled:opacity-50"
          >
            Next
            <ChevronRight className="h-3 w-3" />
          </Link>
        </nav>
      </div>
    </main>
  );
}
