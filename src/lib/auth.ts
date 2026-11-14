export const AUTH_COOKIE_NAME = "taskboard_session";
export const DEFAULT_AUTH_MODE = "password";
export const DEFAULT_EXTERNAL_AUTH_EMAIL_HEADER = "Remote-Email";
export const DEFAULT_EXTERNAL_AUTH_NAME_HEADER = "Remote-Name";
export const DEFAULT_EXTERNAL_AUTH_USER_HEADER = "Remote-User";

export type TaskboardAuthMode = "password" | "authelia";
export type TaskboardAuthProvider = "local" | "authelia";
export type TaskboardUserRole = "standard" | "manager" | "admin";
export type ExternalAuthIdentity = {
  email: string;
  displayName: string;
  username: string;
};
export type TaskboardSession = {
  sessionId?: string;
  userId: string;
  authProvider: TaskboardAuthProvider;
  reservedAdmin: boolean;
  expiresAt: number;
};
export type ExternalAccountActions = {
  logoutUrl: string | null;
  changePasswordUrl: string | null;
  passwordResetUrl: string | null;
};

const encoder = new TextEncoder();
const maxAgeSeconds = 60 * 60 * 24 * 30;

export function getAuthMode(): TaskboardAuthMode {
  return process.env.TASKBOARD_AUTH_MODE === "authelia" ? "authelia" : DEFAULT_AUTH_MODE;
}

export function isExternalAuthOnly() {
  return getAuthMode() === "authelia";
}

function getExternalAuthHeaderName(
  envName: string,
  fallback: string,
) {
  const configured = process.env[envName]?.trim();
  return configured || fallback;
}

export function getExternalAuthEmailHeaderName() {
  return getExternalAuthHeaderName(
    "TASKBOARD_AUTH_EMAIL_HEADER",
    DEFAULT_EXTERNAL_AUTH_EMAIL_HEADER,
  );
}

export function getExternalAuthNameHeaderName() {
  return getExternalAuthHeaderName(
    "TASKBOARD_AUTH_NAME_HEADER",
    DEFAULT_EXTERNAL_AUTH_NAME_HEADER,
  );
}

export function getExternalAuthUserHeaderName() {
  return getExternalAuthHeaderName(
    "TASKBOARD_AUTH_USER_HEADER",
    DEFAULT_EXTERNAL_AUTH_USER_HEADER,
  );
}

export function readExternalAuthIdentity(
  headers: Pick<Headers, "get">,
): ExternalAuthIdentity | null {
  const email = headers.get(getExternalAuthEmailHeaderName())?.trim() ?? "";

  if (!email) {
    return null;
  }

  const username = headers.get(getExternalAuthUserHeaderName())?.trim() ?? "";
  const displayNameHeader = headers.get(getExternalAuthNameHeaderName())?.trim() ?? "";
  const emailLocalPart = email.split("@")[0]?.trim() ?? "";
  const displayName = displayNameHeader || username || emailLocalPart || email;

  return {
    email,
    displayName,
    username,
  };
}

function getAuthSecret() {
  return process.env.AUTH_SECRET?.trim() ?? "";
}

export function isSessionSigningConfigured() {
  return Boolean(getAuthSecret());
}

export function isAuthConfigured() {
  if (isExternalAuthOnly()) {
    return true;
  }

  return Boolean(getAuthSecret() && (process.env.TASKBOARD_APP_PASSWORD?.trim() || process.env.DATABASE_URL?.trim()));
}

function readHttpsUrlFromEnv(envName: string) {
  const configured = process.env[envName]?.trim();

  if (!configured) {
    return null;
  }

  try {
    const url = new URL(configured);

    if (url.protocol !== "https:") {
      console.warn(`${envName} must be an HTTPS URL. Account action hidden.`);
      return null;
    }

    return url.toString();
  } catch {
    console.warn(`${envName} is not a valid URL. Account action hidden.`);
    return null;
  }
}

export function getExternalAccountActions(): ExternalAccountActions {
  if (!isExternalAuthOnly()) {
    return {
      logoutUrl: null,
      changePasswordUrl: null,
      passwordResetUrl: null,
    };
  }

  return {
    logoutUrl: readHttpsUrlFromEnv("TASKBOARD_EXTERNAL_LOGOUT_URL"),
    changePasswordUrl: readHttpsUrlFromEnv("TASKBOARD_EXTERNAL_CHANGE_PASSWORD_URL"),
    passwordResetUrl: readHttpsUrlFromEnv("TASKBOARD_EXTERNAL_PASSWORD_RESET_URL"),
  };
}

export function getAuthCookieMaxAge() {
  return maxAgeSeconds;
}

async function importKey(secret: string) {
  return crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toBase64Url(bytes: ArrayBuffer) {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function encodeBase64Url(value: string) {
  return btoa(value).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function decodeBase64Url(value: string) {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), "=");
  return atob(padded);
}

async function sign(value: string) {
  const key = await importKey(getAuthSecret());
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(value));
  return toBase64Url(signature);
}

export async function createSessionCookieValue(session: Omit<TaskboardSession, "expiresAt">) {
  if (!isSessionSigningConfigured()) {
    throw new Error("Session signing is not configured.");
  }

  const expiresAt = Date.now() + maxAgeSeconds * 1000;
  const payload = encodeBase64Url(JSON.stringify({ ...session, sessionId:crypto.randomUUID(), expiresAt }));
  return `${payload}.${await sign(payload)}`;
}

export async function verifySessionCookieValue(value: string | undefined) {
  if (!isSessionSigningConfigured() || !value) {
    return null;
  }

  const separatorIndex = value.lastIndexOf(".");

  if (separatorIndex < 0) {
    return null;
  }

  const payload = value.slice(0, separatorIndex);
  const signature = value.slice(separatorIndex + 1);

  if (payload.startsWith("solo:")) {
    return null;
  }

  if (signature !== (await sign(payload))) {
    return null;
  }

  let session: TaskboardSession;

  try {
    session = JSON.parse(decodeBase64Url(payload)) as TaskboardSession;
  } catch {
    return null;
  }

  const expiresAt = Number(session.expiresAt);

  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    return null;
  }

  if (
    !session.userId ||
    (session.authProvider !== "local" && session.authProvider !== "authelia") ||
    typeof session.reservedAdmin !== "boolean"
  ) {
    return null;
  }

  return session;
}
