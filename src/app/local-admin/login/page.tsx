import { LoginForm } from "@/components/login-form";

export default async function LocalAdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const params = await searchParams;

  return (
    <LoginForm
      nextPath={params.next ?? "/folio"}
      endpoint="/api/auth/local-admin/login"
      eyebrow="Recovery access"
      title="Local admin sign in"
      passwordLabel="Admin password"
      submitLabel="Sign in"
      showUsername
    />
  );
}
