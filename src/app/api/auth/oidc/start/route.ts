import { NextRequest, NextResponse } from "next/server";
import { getLoginDestination } from "@/lib/login-destination";
import { beginOidcSignIn, setOidcTransaction } from "@/lib/oidc-auth";
import { readOidcSettings } from "@/lib/oidc-settings";
import { getReservedLocalAdminSetupStatus } from "@/lib/taskboard-store";

export async function GET(request: NextRequest) {
  const settings = readOidcSettings();
  if (!settings) return new NextResponse(null, { status: 404 });
  try {
    if ((await getReservedLocalAdminSetupStatus()).required) {
      return NextResponse.redirect(new URL("/setup", settings.callback));
    }
    const next = getLoginDestination(request.nextUrl.searchParams.get("next"));
    // Bound the encoded transaction cookie and leave room for its signature.
    const { url, transaction } = await beginOidcSignIn(settings, Buffer.byteLength(next) <= 1700 ? next : "/folio");
    return setOidcTransaction(NextResponse.redirect(url), settings.callback.protocol === "https:", transaction);
  } catch {
    return setOidcTransaction(NextResponse.redirect(new URL("/login?oidcError=1", settings.callback)),
      settings.callback.protocol === "https:");
  }
}
