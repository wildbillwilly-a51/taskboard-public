"use client";
import { useEffect, useState } from "react";
import type {
  FolioShareLink,
  FolioShareMode,
} from "@/lib/folio-features-model";
import { featureRequest } from "@/lib/folio-feature-client";
import { FeatureDialog } from "./folio-dialog";
import s from "./folio-features.module.css";
export function FolioShareDialog({
  noteId,
  onClose,
}: {
  noteId: string;
  onClose: () => void;
}) {
  const [links, setLinks] = useState<FolioShareLink[]>([]),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false),
    [copied, setCopied] = useState(""),
    [confirmation, setConfirmation] = useState<{
      action: string;
      mode: FolioShareMode;
    } | null>(null);
  useEffect(() => {
    const c = new AbortController();
    void featureRequest<{ links: FolioShareLink[] }>(
      `/api/folio/shares?noteId=${noteId}`,
      undefined,
      c.signal,
    )
      .then((r) => setLinks(r.links))
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [noteId]);
  const act = async (
    action: string,
    mode: FolioShareMode,
    confirmed = false,
  ) => {
    if (["regenerate", "disable"].includes(action) && !confirmed) {
      setConfirmation({ action, mode });
      return;
    }
    setConfirmation(null);
    setCopied("");
    setBusy(true);
    setError("");
    try {
      setLinks(
        (
          await featureRequest<{ links: FolioShareLink[] }>(
            "/api/folio/shares",
            { noteId, action, mode },
          )
        ).links,
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <FeatureDialog title="Share this note" onClose={onClose}>
      <p>
        Anyone with a link can access this note without signing in. Links have
        no expiry; you can disable or replace either link independently.
      </p>
      {confirmation ? (
        <section role="alertdialog" aria-label="Confirm sharing change">
          <p>
            {confirmation.action === "disable"
              ? "Disable this link? Everyone using it will lose access."
              : "Replace this link? The previous address will stop working."}
          </p>
          <div className={s.row}>
            <button
              className="ui-button ed-button"
              autoFocus
              onClick={() => setConfirmation(null)}
            >
              Cancel
            </button>
            <button
              className="ui-button ed-button"
              onClick={() =>
                void act(confirmation.action, confirmation.mode, true)
              }
            >
              {confirmation.action === "disable"
                ? "Disable link"
                : "Replace link"}
            </button>
          </div>
        </section>
      ) : null}
      {(["read", "write"] as const).map((mode) => {
        const link = links.find((l) => l.mode === mode);
        return (
          <section key={mode}>
            <h3>{mode === "read" ? "Read-only" : "Read/write"}</h3>
            <p className={s.muted}>
              {mode === "read"
                ? "Read the note and its attachments."
                : "Edit title and content, and add or remove attachments. Connections and sharing controls remain private."}
            </p>
            {link?.active && link.url ? (
              <>
                <p className={s.shareUrl}>
                  {typeof location === "undefined" ? "" : location.origin}
                  {link.url}
                </p>
                <div className={s.row}>
                  <button
                    className="ui-button ed-button"
                    disabled={busy}
                    onClick={() =>
                      void navigator.clipboard
                        .writeText(new URL(link.url!, location.origin).href)
                        .then(() => setCopied(mode))
                        .catch(() => setError("Copy the address above."))
                    }
                  >
                    {copied === mode ? "Copied" : "Copy link"}
                  </button>
                  <button
                    className="ui-button ed-button"
                    disabled={busy}
                    onClick={() => void act("disable", mode)}
                  >
                    Disable
                  </button>
                  <button
                    className="ui-button ed-button"
                    disabled={busy}
                    onClick={() => void act("regenerate", mode)}
                  >
                    Replace link
                  </button>
                </div>
              </>
            ) : (
              <button
                className="ui-button ed-button"
                disabled={busy || !links.length}
                onClick={() => void act("create", mode)}
              >
                Create {mode === "read" ? "read-only" : "read/write"} link
              </button>
            )}
          </section>
        );
      })}
      {error ? (
        <p className={s.error} role="alert">
          {error}
        </p>
      ) : null}
    </FeatureDialog>
  );
}
