import Link from "next/link";
import { parseAdminAuditEventFilters } from "@/lib/admin-audit-policy";
import { AdminAuditPage } from "@/components/admin-audit-page";
import { getCurrentAdminTaskboardUser } from "@/lib/taskboard-request";
import { listAdminAuditEvents } from "@/lib/taskboard-store";

export const dynamic = "force-dynamic";

type AuditSearchParams = Record<string, string | string[] | undefined>;

function searchParamsToUrlSearchParams(searchParams: AuditSearchParams) {
  const params = new URLSearchParams();

  for (const [key, value] of Object.entries(searchParams)) {
    if (Array.isArray(value)) {
      for (const item of value) {
        params.append(key, item);
      }
      continue;
    }

    if (value !== undefined) {
      params.set(key, value);
    }
  }

  return params;
}

export default async function AuditAdminPage({
  searchParams,
}: {
  searchParams?: Promise<AuditSearchParams>;
}) {
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
            Audit log access is available only to Taskboard admins.
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

  const filters = parseAdminAuditEventFilters(
    searchParamsToUrlSearchParams((await searchParams) ?? {}),
  );
  const result = await listAdminAuditEvents(admin, filters);

  return (
    <AdminAuditPage
      events={result.events}
      filters={filters}
      pagination={result.pagination}
    />
  );
}
