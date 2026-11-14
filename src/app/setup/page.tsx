import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { getReservedLocalAdminSetupStatus } from "@/lib/taskboard-store";

export const dynamic = "force-dynamic";

export default async function SetupPage() {
  const setupStatus = await getReservedLocalAdminSetupStatus().catch(() => ({ required: true }));

  if (!setupStatus.required) {
    redirect("/");
  }

  return (
    <LoginForm
      nextPath="/folio"
      endpoint="/api/auth/setup"
      eyebrow="Initial setup"
      title="Create local admin"
      passwordLabel="Admin password"
      submitLabel="Create admin"
      showUsername
      showDisplayName
    />
  );
}
