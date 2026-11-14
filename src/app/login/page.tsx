import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { isExternalAuthOnly } from "@/lib/auth";
import { getReservedLocalAdminSetupStatus } from "@/lib/taskboard-store";

export const dynamic = "force-dynamic";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  if (isExternalAuthOnly()) {
    redirect("/");
  }

  const setupStatus = await getReservedLocalAdminSetupStatus().catch(() => ({ required: false }));

  if (setupStatus.required) {
    redirect("/setup");
  }

  const params = await searchParams;
  return <LoginForm nextPath={params.next ?? "/folio"} />;
}
