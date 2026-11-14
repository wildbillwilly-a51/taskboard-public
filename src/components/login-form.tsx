"use client";

import { useState } from "react";
import { getLoginDestination } from "@/lib/login-destination";

const LOGIN_LABEL_CLASS = "text-[10px] font-semibold uppercase tracking-[0.14em] text-muted";
const LOGIN_CONTROL_CLASS =
  "ui-control rounded-[10px] border px-3 py-2 text-[11px] font-medium normal-case tracking-normal text-foreground outline-none transition";
const LOGIN_HELPER_CLASS = "text-[10px] font-medium leading-4";
const LOGIN_BUTTON_CLASS =
  "ui-button ui-button-primary rounded-full px-4 py-2 text-[11px] font-semibold leading-4 transition disabled:cursor-not-allowed disabled:opacity-60";

export function LoginForm({
  nextPath,
  endpoint = "/api/auth/login",
  title = "Sign in to Taskboard",
  eyebrow = "Private planner",
  passwordLabel = "App password",
  submitLabel = "Sign in",
  showUsername = false,
  showDisplayName = false,
  oidcHref,
  initialError,
}: {
  nextPath: string;
  endpoint?: string;
  title?: string;
  eyebrow?: string;
  passwordLabel?: string;
  submitLabel?: string;
  showUsername?: boolean;
  showDisplayName?: boolean;
  oidcHref?: string;
  initialError?: string;
}) {
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError("");

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...(showUsername ? { username } : {}),
          ...(showDisplayName ? { displayName } : {}),
          password,
        }),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "Unable to sign in.");
      }
      window.location.assign(getLoginDestination(nextPath));
    } catch (error) {
      setError(error instanceof Error ? error.message : "Unable to sign in.");
      setIsSubmitting(false);
    }
  }

  return (
    <main className="taskboard-shell flex min-h-screen items-center justify-center px-4 py-8">
      <form
        onSubmit={handleSubmit}
        className="panel-surface panel-strong flex w-full max-w-[380px] flex-col gap-3 rounded-[24px] p-5"
      >
        <div>
          <p className={LOGIN_LABEL_CLASS}>
            {eyebrow}
          </p>
          <h1 className="mt-1 text-[1.65rem] font-semibold tracking-tight text-foreground">
            {title}
          </h1>
        </div>

        {showUsername ? (
          <label className={`flex flex-col gap-1 ${LOGIN_LABEL_CLASS}`}>
            Username
            <input
              type="text"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              className={LOGIN_CONTROL_CLASS}
              autoComplete="username"
              autoFocus
            />
          </label>
        ) : null}

        {showDisplayName ? (
          <label className={`flex flex-col gap-1 ${LOGIN_LABEL_CLASS}`}>
            Display name
            <input
              type="text"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className={LOGIN_CONTROL_CLASS}
              autoComplete="name"
            />
          </label>
        ) : null}

        <label className={`flex flex-col gap-1 ${LOGIN_LABEL_CLASS}`}>
          {passwordLabel}
          <input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            className={LOGIN_CONTROL_CLASS}
            autoComplete="current-password"
            autoFocus={!showUsername}
          />
        </label>

        {error ? <p role="alert" className={`${LOGIN_HELPER_CLASS} text-[var(--danger-fg)]`}>{error}</p> : null}

        <button
          type="submit"
          disabled={isSubmitting}
          className={LOGIN_BUTTON_CLASS}
        >
          {isSubmitting ? "Submitting..." : submitLabel}
        </button>
        {oidcHref ? (
          <a href={oidcHref} className="ui-button ui-button-surface rounded-full border px-4 py-2 text-center text-[11px] font-semibold leading-4">
            Sign in with your identity provider
          </a>
        ) : null}
      </form>
    </main>
  );
}
