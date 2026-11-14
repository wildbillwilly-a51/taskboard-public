"use client";

import Link from "next/link";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { useMemo, useState } from "react";
import type { TaskboardAuthProvider, TaskboardUserRole } from "@/lib/auth";

type AdminUserListItem = {
  id: string;
  email: string;
  username: string | null;
  displayName: string;
  role: TaskboardUserRole;
  isDisabled: boolean;
  isReservedLocalAdmin: boolean;
  authProvider: TaskboardAuthProvider;
  createdAt: string;
  updatedAt: string;
};

type AdminUsersResponse = {
  user?: AdminUserListItem;
  error?: string;
};

const roleOptions: TaskboardUserRole[] = ["standard", "manager", "admin"];

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function AdminUsersPage({
  currentUserId,
  users: initialUsers,
}: {
  currentUserId?: string;
  users: AdminUserListItem[];
}) {
  const [users, setUsers] = useState(initialUsers);
  const [pendingUserId, setPendingUserId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const sortedUsers = useMemo(
    () => [...users].sort((a, b) => Number(b.isReservedLocalAdmin) - Number(a.isReservedLocalAdmin) || a.email.localeCompare(b.email)),
    [users],
  );

  async function patchUser(userId: string, body: { role?: TaskboardUserRole; isDisabled?: boolean }) {
    setPendingUserId(userId);
    setMessage("");

    try {
      const response = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = (await response.json().catch(() => ({}))) as AdminUsersResponse;

      if (!response.ok || !payload.user) {
        throw new Error(payload.error ?? "Unable to update user.");
      }

      setUsers((current) =>
        current.map((user) => (user.id === payload.user?.id ? payload.user : user)),
      );
      setMessage("User updated.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Unable to update user.");
    } finally {
      setPendingUserId(null);
    }
  }

  return (
    <main className="taskboard-shell min-h-screen px-3 py-3 md:px-5 md:py-5">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-3">
        <header className="panel-surface panel-strong rounded-[18px] px-4 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                Admin
              </p>
              <h1 className="mt-1 text-[1.5rem] font-semibold tracking-tight text-foreground">
                Users
              </h1>
              <p className="mt-1 text-[11px] leading-4 text-muted">
                Manage existing Taskboard users, roles, and disabled state.
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

        <section className="panel-surface overflow-hidden rounded-[14px] border border-border/70">
          <div className="overflow-x-auto">
            <table className="min-w-full border-collapse text-left text-[12px]">
              <thead className="border-b border-border/70 text-[10px] uppercase tracking-[0.12em] text-muted">
                <tr>
                  <th className="px-3 py-2 font-semibold">User</th>
                  <th className="px-3 py-2 font-semibold">Provider</th>
                  <th className="px-3 py-2 font-semibold">Role</th>
                  <th className="px-3 py-2 font-semibold">Status</th>
                  <th className="px-3 py-2 font-semibold">Updated</th>
                  <th className="px-3 py-2 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {sortedUsers.map((user) => {
                  const isSelf = user.id === currentUserId;
                  const isProtected = user.isReservedLocalAdmin || isSelf;
                  const isPending = pendingUserId === user.id;

                  return (
                    <tr key={user.id} className="border-b border-border/50 last:border-b-0">
                      <td className="px-3 py-3 align-top">
                        <div className="font-medium text-foreground">{user.displayName}</div>
                        <div className="mt-0.5 text-[11px] text-muted">{user.email}</div>
                        <div className="mt-1 max-w-[260px] truncate font-mono text-[10px] text-muted" title={user.id}>
                          {user.id}
                        </div>
                        <div className="mt-1 text-[10px] text-muted">
                          username: {user.username || "(none)"}
                        </div>
                        {user.isReservedLocalAdmin ? (
                          <span className="mt-2 inline-flex items-center gap-1 rounded-full border border-border/70 px-2 py-0.5 text-[10px] font-medium text-foreground">
                            <ShieldCheck className="h-3 w-3" />
                            Reserved local admin
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 py-3 align-top text-foreground">{user.authProvider}</td>
                      <td className="px-3 py-3 align-top">
                        <select
                          value={user.role}
                          disabled={isPending || isProtected}
                          onChange={(event) =>
                            void patchUser(user.id, { role: event.target.value as TaskboardUserRole })
                          }
                          className="ui-control rounded-[8px] border px-2 py-1 text-[11px] text-foreground disabled:opacity-60"
                          aria-label={`Role for ${user.email}`}
                        >
                          {roleOptions.map((role) => (
                            <option key={role} value={role}>
                              {role}
                            </option>
                          ))}
                        </select>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <span className={user.isDisabled ? "text-destructive" : "text-foreground"}>
                          {user.isDisabled ? "Disabled" : "Active"}
                        </span>
                      </td>
                      <td className="px-3 py-3 align-top text-[11px] text-muted">
                        <div>{formatDate(user.updatedAt)}</div>
                        <div className="mt-1">Created {formatDate(user.createdAt)}</div>
                      </td>
                      <td className="px-3 py-3 align-top">
                        <button
                          type="button"
                          disabled={isPending || isProtected}
                          onClick={() => void patchUser(user.id, { isDisabled: !user.isDisabled })}
                          className="ui-chip-button ui-button-surface rounded-[9px] border px-2.5 py-1 text-[11px] font-medium disabled:opacity-60"
                        >
                          {user.isDisabled ? "Enable" : "Disable"}
                        </button>
                        {isSelf ? (
                          <p className="mt-1 text-[10px] leading-4 text-muted">Self-lockout protected</p>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
