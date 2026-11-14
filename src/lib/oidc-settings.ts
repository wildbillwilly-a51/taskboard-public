import "server-only";
import { isExternalAuthOnly, isSessionSigningConfigured } from "@/lib/auth";

export const oidcCallbackPath = "/api/auth/oidc/callback";

export function readOidcSettings() {
  if (isExternalAuthOnly() || !isSessionSigningConfigured()) return null;
  const issuerValue = process.env.TASKBOARD_OIDC_ISSUER?.trim();
  const clientId = process.env.TASKBOARD_OIDC_CLIENT_ID?.trim();
  const clientSecret = process.env.TASKBOARD_OIDC_CLIENT_SECRET?.trim();
  const callbackValue = process.env.TASKBOARD_OIDC_CALLBACK_URL?.trim();
  if (!issuerValue || !clientId || !clientSecret || !callbackValue) return null;
  try {
    const issuer = new URL(issuerValue);
    const callback = new URL(callbackValue);
    if (issuer.protocol !== "https:" || issuer.username || issuer.password || issuer.search || issuer.hash
      || issuer.pathname.includes("/.well-known/")) return null;
    const insecureLocalCallback = callback.protocol === "http:"
      && ["127.0.0.1", "localhost", "[::1]"].includes(callback.hostname);
    if ((callback.protocol !== "https:" && !insecureLocalCallback)
      || callback.username || callback.password || callback.search || callback.hash
      || callback.pathname !== oidcCallbackPath
      || (callback.protocol === "https:" && process.env.AUTH_COOKIE_SECURE !== "true")) return null;
    return { issuer, clientId, clientSecret, callback };
  } catch {
    return null;
  }
}
