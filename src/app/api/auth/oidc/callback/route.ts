import { NextRequest, NextResponse } from "next/server";
import { isAccountEmail } from "@/lib/account-email";
import { setTaskboardSession } from "@/lib/auth-response";
import { getLoginDestination } from "@/lib/login-destination";
import { completeOidcSignIn, oidcTransactionCookie, readOidcTransaction, setOidcTransaction } from "@/lib/oidc-auth";
import { readOidcSettings } from "@/lib/oidc-settings";
import { getOrCreateOidcAccount } from "@/lib/taskboard-store";

export async function GET(request: NextRequest) {
  const settings = readOidcSettings();
  if (!settings) return new NextResponse(null, { status: 404 });
  const secure = settings.callback.protocol === "https:";
  const failed = () => setOidcTransaction(
    NextResponse.redirect(new URL("/login?oidcError=1", settings.callback)), secure,
  );
  const transaction = readOidcTransaction(request.cookies.get(oidcTransactionCookie)?.value);
  if (!transaction || request.nextUrl.searchParams.get("state") !== transaction.state) return failed();
  try {
    const claims = await completeOidcSignIn(settings, request.nextUrl.search, transaction);
    if (!claims?.sub || claims.sub.length > 255 || claims.sub.includes("\u0000")) return failed();
    const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
    const profileEmail = claims.email_verified !== false && isAccountEmail(email) ? email : null;
    const displayName = typeof claims.name === "string" ? claims.name.replaceAll("\u0000", "").trim().slice(0, 120) : "";
    const account = await getOrCreateOidcAccount({
      issuer: claims.iss, subject: claims.sub, email: profileEmail,
      displayName: displayName || profileEmail || "Identity provider user",
    });
    if (!account) return failed();
    const response = setOidcTransaction(NextResponse.redirect(
      new URL(getLoginDestination(transaction.destination), settings.callback),
    ), secure);
    return await setTaskboardSession(response, {
      userId: account.id, authProvider: "oidc", reservedAdmin: false, version: account.version,
    });
  } catch {
    return failed();
  }
}
