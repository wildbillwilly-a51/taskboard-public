"use client";
import { useEffect, useState } from "react";
import { FeatureDialog } from "./folio-dialog";
import s from "./folio-features.module.css";
export function FolioFilePreview({
  name,
  baseUrl,
  downloadUrl,
  onClose,
}: {
  name: string;
  baseUrl: string;
  downloadUrl: string;
  onClose: () => void;
}) {
  const [value, setValue] = useState<{ kind: string; text?: string }>(),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    fetch(`${baseUrl}${baseUrl.includes("?") ? "&" : "?"}metadata=1`, {
      signal: c.signal,
      cache: "no-store",
    })
      .then(async (r) => {
        if (!r.ok) throw Error("Preview unavailable.");
        setValue(await r.json());
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [baseUrl]);
  return (
    <FeatureDialog title={name} onClose={onClose} className={s.preview}>
      <a href={downloadUrl} download rel="noreferrer" className="ui-button ed-button">
        Download
      </a>
      {error ? (
        <p role="alert">{error}</p>
      ) : !value ? (
        <p role="status">Loading preview…</p>
      ) : value.kind === "image" ? (
        <img src={baseUrl} alt={name} />
      ) : value.kind === "pdf" ? (
        <iframe title={name} src={baseUrl} />
      ) : value.kind === "text" ? (
        <pre>{value.text}</pre>
      ) : (
        <p>
          This file is available to download. A preview is not available for
          this format.
        </p>
      )}
    </FeatureDialog>
  );
}
