import Link from "next/link";
import { AdminPermissionSettingsPage } from "@/components/admin-permission-settings-page";
import { isSameTeamPersonalBoardViewEnabled } from "@/lib/taskboard-config";
import { getCurrentAdminTaskboardUser } from "@/lib/taskboard-request";
import { getAdminPermissionSettings } from "@/lib/taskboard-store";

export const dynamic = "force-dynamic";

export default async function PermissionSettingsAdminPage() {
  const admin = await getCurrentAdminTaskboardUser();

  if (!admin) {
    return (
      <main className="taskboard-shell min-h-screen px-3 py-3 md:px-5 md:py-5">
        <div className="panel-surface panel-strong mx-auto max-w-[720px] rounded-[18px] px-4 py-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
            Admin
          </p>
          <h1 className="mt-1 text-[1.35rem] font-semibold tracking-tight text-foreground">
            Access denied
          </h1>
          <p className="mt-2 text-[12px] leading-5 text-muted">
            Permission settings are available only to Taskboard admins.
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

  const settings = await getAdminPermissionSettings(admin);

  return (
    <AdminPermissionSettingsPage
      initialSettings={settings}
      envGateStatus={isSameTeamPersonalBoardViewEnabled() ? "enabled" : "not_enabled"}
    />
  );
}
