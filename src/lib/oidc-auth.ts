import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";
import * as oidc from "openid-client";
import { readOidcSettings, oidcCallbackPath } from "@/lib/oidc-settings";

export const oidcTransactionCookie = "taskboard_oidc";
const transactionSeconds = 600;
type OidcSettings = NonNullable<ReturnType<typeof readOidcSettings>>;
type Transaction = {
  expires: number; state: string; nonce: string; verifier: string; destination: string;
};

function transactionSignature(value: string) {
  return createHmac("sha256", process.env.AUTH_SECRET!.trim()).update("taskboard-oidc:").update(value).digest();
}

export function setOidcTransaction(response: NextResponse, secure: boolean, transaction?: Transaction) {
  let value = "";
  if (transaction) {
    const payload = Buffer.from(JSON.stringify(transaction)).toString("base64url");
    value = `${payload}.${transactionSignature(payload).toString("base64url")}`;
  }
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  response.cookies.set(oidcTransactionCookie, value, {
    httpOnly: true, secure, sameSite: "lax", path: oidcCallbackPath,
    maxAge: transaction ? transactionSeconds : 0,
  });
  return response;
}

export function readOidcTransaction(value: string | undefined): Transaction | null {
  if (!value || value.length > 3800) return null;
  const [payload, signature, ...extra] = value.split(".");
  if (!payload || !signature || extra.length) return null;
  const supplied = Buffer.from(signature, "base64url");
  const expected = transactionSignature(payload);
  if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) return null;
  try {
    const transaction: Transaction = JSON.parse(Buffer.from(payload, "base64url").toString());
    return transaction.expires > Date.now() ? transaction : null;
  } catch {
    return null;
  }
}

function discover(settings: OidcSettings) {
  return oidc.discovery(settings.issuer, settings.clientId, undefined,
    oidc.ClientSecretPost(settings.clientSecret),
    { timeout: 8, execute: [oidc.enableNonRepudiationChecks] });
}

export async function beginOidcSignIn(settings: OidcSettings, destination: string) {
  const config = await discover(settings);
  const transaction = {
    state: oidc.randomState(), nonce: oidc.randomNonce(), verifier: oidc.randomPKCECodeVerifier(),
    expires: Date.now() + transactionSeconds * 1000, destination,
  };
  const url = oidc.buildAuthorizationUrl(config, {
    redirect_uri: settings.callback.href,
    scope: "openid profile email",
    code_challenge: await oidc.calculatePKCECodeChallenge(transaction.verifier),
    code_challenge_method: "S256",
    state: transaction.state,
    nonce: transaction.nonce,
  });
  return { url, transaction };
}

export async function completeOidcSignIn(settings: OidcSettings, query: string, transaction: Transaction) {
  const config = await discover(settings);
  const callback = new URL(settings.callback);
  callback.search = query;
  const tokens = await oidc.authorizationCodeGrant(config, callback, {
    expectedState: transaction.state,
    expectedNonce: transaction.nonce,
    pkceCodeVerifier: transaction.verifier,
  });
  return tokens.claims();
}
