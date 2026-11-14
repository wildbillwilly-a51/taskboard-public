import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { isExternalAuthOnly } from "@/lib/auth";
import { getLoginDestination } from "@/lib/login-destination";
import { readOidcSettings } from "@/lib/oidc-settings";
import { getReservedLocalAdminSetupStatus } from "@/lib/taskboard-store";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; oidcError?: string }>;
}) {
  if (isExternalAuthOnly()) {
    redirect("/");
  }

  const setupStatus = await getReservedLocalAdminSetupStatus().catch(() => ({ required: false }));

  if (setupStatus.required) {
    redirect("/setup");
  }

  const params = await searchParams;
  const next = getLoginDestination(params.next);
  return <LoginForm
    nextPath={next}
    showUsername
    passwordLabel="Password"
    oidcHref={readOidcSettings() ? `/api/auth/oidc/start?next=${encodeURIComponent(next)}` : undefined}
    initialError={params.oidcError ? "Identity provider sign-in failed. Try again or ask your Taskboard administrator." : undefined}
  />;
}
