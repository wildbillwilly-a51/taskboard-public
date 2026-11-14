"use client";

import Link from "next/link";
import { ArrowLeft, ClipboardList, Save, Settings2, UserCog } from "lucide-react";
import { useState } from "react";
import type { AdminPermissionSettings } from "@/lib/taskboard-store";
import type { PersonalBoardVisibilitySetting } from "@/lib/admin-permission-settings-policy";

type EnvGateStatus = "enabled" | "not_enabled";

type PermissionSettingsResponse = {
  settings?: AdminPermissionSettings;
  sameTeamPersonalBoardVisibilityEnvGate?: EnvGateStatus;
  changed?: boolean;
  error?: string;
};

const sameTeamWarning =
  "Enabling this setting does not expose boards by itself. Teammate personal-board visibility still also requires the server env gate, team opt-in, and board-level team-visible association. If all gates are enabled, active team members may view associated teammate personal boards as read-only.";

function cloneSettings(settings: AdminPermissionSettings): AdminPermissionSettings {
  return { ...settings };
}

export function AdminPermissionSettingsPage({
  initialSettings,
  envGateStatus,
}: {
  initialSettings: AdminPermissionSettings;
  envGateStatus: EnvGateStatus;
}) {
  const [settings, setSettings] = useState(() => cloneSettings(initialSettings));
  const [savedSettings, setSavedSettings] = useState(() => cloneSettings(initialSettings));
  const [message, setMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const isDirty =
    settings.sameTeamPersonalBoardVisibilityAllowed !==
      savedSettings.sameTeamPersonalBoardVisibilityAllowed ||
    settings.defaultPersonalBoardVisibility !== savedSettings.defaultPersonalBoardVisibility ||
    settings.managersCanConfigureTeamPersonalBoardVisibility !==
      savedSettings.managersCanConfigureTeamPersonalBoardVisibility ||
    settings.usersCanMakeBoardsPrivate !== savedSettings.usersCanMakeBoardsPrivate ||
    settings.adminsCanViewPrivateBoards !== savedSettings.adminsCanViewPrivateBoards;

  function updateBoolean(key: keyof Pick<
    AdminPermissionSettings,
    | "sameTeamPersonalBoardVisibilityAllowed"
    | "managersCanConfigureTeamPersonalBoardVisibility"
    | "usersCanMakeBoardsPrivate"
    | "adminsCanViewPrivateBoards"
  >, value: boolean) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  async function saveSettings() {
    setIsSaving(true);
    setMessage("");

    try {
      const response = await fetch("/api/admin/settings/permissions", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          sameTeamPersonalBoardVisibilityAllowed:
            settings.sameTeamPersonalBoardVisibilityAllowed,
          defaultPersonalBoardVisibility: settings.defaultPersonalBoardVisibility,
          managersCanConfigureTeamPersonalBoardVisibility:
            settings.managersCanConfigureTeamPersonalBoardVisibility,
          usersCanMakeBoardsPrivate: settings.usersCanMakeBoardsPrivate,
          adminsCanViewPrivateBoards: settings.adminsCanViewPrivateBoards,
        }),
      });
      const payload = (await response.json().catch(() => ({}))) as PermissionSettingsResponse;

      if (!response.ok || !payload.settings) {
        throw new Error(payload.error ?? "Unable to update permission settings.");
      }

      setSettings(cloneSettings(payload.settings));
      setSavedSettings(cloneSettings(payload.settings));
      setMessage(payload.changed ? "Permission settings saved." : "No changes to save.");
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Unable to update permission settings.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <main className="taskboard-shell min-h-screen px-3 py-3 md:px-5 md:py-5">
      <div className="mx-auto flex w-full max-w-[960px] flex-col gap-3">
        <header className="panel-surface panel-strong rounded-[18px] px-4 py-4">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
                Admin
              </p>
              <h1 className="mt-1 text-[1.5rem] font-semibold tracking-tight text-foreground">
                Permission settings
              </h1>
              <p className="mt-1 text-[11px] leading-4 text-muted">
                Configure global permission gates. Board privacy controls are a separate phase.
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
                href="/admin/audit"
                className="ui-chip-button ui-button-surface inline-flex items-center gap-1 rounded-[10px] border px-3 py-1.5 text-[11px] font-medium"
              >
                <ClipboardList className="h-3 w-3" />
                Audit log
              </Link>
            </div>
          </div>
        </header>

        {message ? (
          <div className="panel-surface rounded-[12px] border border-border/70 px-3 py-2 text-[12px] text-foreground">
            {message}
          </div>
        ) : null}

        <section className="panel-surface rounded-[14px] border border-border/70 px-4 py-4">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-[0.95rem] font-semibold text-foreground">
                Same-team personal-board visibility
              </h2>
              <p className="mt-1 text-[11px] leading-4 text-muted">
                Server env gate `TASKBOARD_SAME_TEAM_PERSONAL_BOARD_VIEW` is read-only here.
              </p>
            </div>
            <span className="inline-flex w-fit rounded-full border border-border/70 px-2.5 py-1 text-[11px] font-medium text-foreground">
              Env gate: {envGateStatus === "enabled" ? "enabled" : "not enabled"}
            </span>
          </div>

          <div className="mt-4 grid gap-3">
            <label className="flex items-start gap-3 rounded-[12px] border border-border/70 px-3 py-3">
              <input
                type="checkbox"
                checked={settings.sameTeamPersonalBoardVisibilityAllowed}
                onChange={(event) =>
                  updateBoolean("sameTeamPersonalBoardVisibilityAllowed", event.target.checked)
                }
                className="mt-0.5"
              />
              <span>
                <span className="block text-[12px] font-medium text-foreground">
                  Allow same-team personal-board visibility
                </span>
                <span className="mt-1 block text-[11px] leading-4 text-muted">
                  {sameTeamWarning}
                </span>
              </span>
            </label>

            <label className="grid gap-1 rounded-[12px] border border-border/70 px-3 py-3">
              <span className="text-[12px] font-medium text-foreground">
                Default personal-board visibility
              </span>
              <select
                value={settings.defaultPersonalBoardVisibility}
                onChange={(event) =>
                  setSettings((current) => ({
                    ...current,
                    defaultPersonalBoardVisibility:
                      event.target.value as PersonalBoardVisibilitySetting,
                  }))
                }
                className="ui-control max-w-[260px] rounded-[8px] border px-2 py-1.5 text-[12px] text-foreground"
              >
                <option value="private">private</option>
                <option value="team_visible">team_visible</option>
              </select>
              <span className="text-[11px] leading-4 text-muted">
                This setting is stored for future personal-board creation behavior. It does not retroactively change existing boards.
              </span>
            </label>
          </div>
        </section>

        <section className="panel-surface rounded-[14px] border border-border/70 px-4 py-4">
          <h2 className="text-[0.95rem] font-semibold text-foreground">
            Global behavior
          </h2>
          <div className="mt-3 grid gap-3">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={settings.managersCanConfigureTeamPersonalBoardVisibility}
                onChange={(event) =>
                  updateBoolean(
                    "managersCanConfigureTeamPersonalBoardVisibility",
                    event.target.checked,
                  )
                }
                className="mt-0.5"
              />
              <span className="text-[12px] text-foreground">
                Managers can configure team personal-board visibility
              </span>
            </label>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={settings.usersCanMakeBoardsPrivate}
                onChange={(event) =>
                  updateBoolean("usersCanMakeBoardsPrivate", event.target.checked)
                }
                className="mt-0.5"
              />
              <span className="text-[12px] text-foreground">
                Users can make boards private
              </span>
            </label>
            <p className="text-[12px] text-muted">
              Administrators need the same board ownership, sharing, or team access
              as everyone else. Personal-only notes are visible only to their owner.
            </p>
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-[11px] text-muted">
            Last updated {new Date(savedSettings.updatedAt).toLocaleString()}
          </p>
          <button
            type="button"
            disabled={isSaving || !isDirty}
            onClick={() => void saveSettings()}
            className="ui-chip-button ui-button-primary inline-flex items-center gap-1 rounded-[10px] border px-3 py-1.5 text-[11px] font-medium disabled:opacity-60"
          >
            <Save className="h-3 w-3" />
            Save settings
          </button>
        </div>

        <div className="panel-surface rounded-[12px] border border-border/70 px-3 py-2 text-[11px] leading-4 text-muted">
          <Settings2 className="mr-1 inline h-3 w-3 align-[-2px]" />
          This page changes global permission gates only. It does not enable the
          server env flag, change team opt-in rows, or change any board-level
          personal visibility setting.
        </div>
      </div>
    </main>
  );
}
