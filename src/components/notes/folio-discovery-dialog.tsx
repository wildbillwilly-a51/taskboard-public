"use client";
import { useEffect, useState } from "react";
import { FeatureDialog } from "./folio-dialog";
import { discoverNotes } from "@/lib/folio-feature-client";
import type { FolioDiscoveryInput, FolioHit } from "@/lib/folio-features-model";
import type { FolioSpace } from "@/lib/folio-model";
import s from "./folio-features.module.css";
export function FolioDiscoveryDialog({
  onClose,
  onOpen,
  spaces = [],
  initialQuery = "",
  initialMode = "recent",
  backlinkTo,
}: {
  onClose: () => void;
  onOpen: (id: string) => void;
  spaces?: FolioSpace[];
  initialQuery?: string;
  initialMode?: "recent" | "search" | "due" | "templates";
  backlinkTo?: string;
}) {
  const [q, setQ] = useState(initialQuery),
    [mode, setMode] = useState(initialMode),
    [spaceId, setSpace] = useState(""),
    [keyword, setKeyword] = useState(""),
    [by, setBy] = useState(""),
    [after, setAfter] = useState(""),
    [sort, setSort] = useState<FolioDiscoveryInput["sort"]>("updated"),
    [notes, setNotes] = useState<FolioHit[]>([]),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [offset, setOffset] = useState(0),
    [more, setMore] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    const t = setTimeout(() => {
      setBusy(true);
      setError("");
      void discoverNotes(
        {
          q,
          ...(spaceId ? { spaceId } : {}),
          keyword,
          by,
          after: after || undefined,
          sort,
          offset,
          backlinkTo,
          recent: !q && mode === "recent",
          due: mode === "due",
          templates: mode === "templates",
        },
        c.signal,
      )
        .then((r) => {
          setNotes((old) => (offset ? [...old, ...r.notes] : r.notes));
          setMore(r.hasMore);
        })
        .catch((e) => {
          if (!c.signal.aborted) setError(e.message);
        })
        .finally(() => {
          if (!c.signal.aborted) setBusy(false);
        });
    }, 150);
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [q, mode, spaceId, keyword, by, after, sort, backlinkTo, offset]);
  const reset = (fn: () => void) => {
    setBusy(true);
    fn();
    setOffset(0);
  };
  return (
    <FeatureDialog
      title={backlinkTo ? "Linked from" : "Find notes and spaces"}
      onClose={onClose}
      className={`${s.dialog} ${s.discoveryDialog}`}
    >
      <input
        autoFocus
        className={`ed-field ${s.searchInput}`}
        aria-label="Search notes by title or content"
        placeholder="Search notes and spaces…"
        value={q}
        onChange={(e) => reset(() => setQ(e.target.value))}
      />
      {!backlinkTo ? (
        <div className={s.tabs}>
          {(["recent", "search", "due", "templates"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className="ui-button ed-button"
              aria-pressed={mode === m}
              onClick={() => reset(() => setMode(m))}
            >
              {
                {
                  recent: "Recently viewed",
                  search: "Search",
                  due: "Review due",
                  templates: "Templates",
                }[m]
              }
            </button>
          ))}
        </div>
      ) : null}
      <details>
        <summary>Filters and sorting</summary>
        <div className={s.filters}>
          <label>
            Space
            <select className="ed-field"
              value={spaceId}
              onChange={(e) => reset(() => setSpace(e.target.value))}
            >
              <option value="">Any accessible space</option>
              {spaces
                .filter((v) => !v.archived)
                .map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.title}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Keyword
            <input className="ed-field"
              value={keyword}
              onChange={(e) => reset(() => setKeyword(e.target.value))}
            />
          </label>
          <label>
            Owner or contributor
            <input className="ed-field"
              value={by}
              onChange={(e) => reset(() => setBy(e.target.value))}
            />
          </label>
          <label>
            Edited since
            <input className="ed-field"
              type="date"
              value={after}
              onChange={(e) => reset(() => setAfter(e.target.value))}
            />
          </label>
          <label>
            Sort
            <select className="ed-field"
              value={sort}
              onChange={(e) =>
                reset(() =>
                  setSort(e.target.value as FolioDiscoveryInput["sort"]),
                )
              }
            >
              <option value="updated">Recently updated</option>
              <option value="title">Title</option>
              <option value="created">Recently created</option>
              <option value="recent">Recently viewed</option>
            </select>
          </label>
        </div>
      </details>
      {error ? (
        <p className={s.error} role="alert">
          {error}
        </p>
      ) : null}
      <div className={s.results} aria-busy={busy}>
        {notes.map((n) => (
          <button
            key={n.id}
            className={s.hit}
            onClick={() => {
              onOpen(n.id);
              onClose();
            }}
          >
            <strong>{n.title}</strong>
            <small>
              {n.pageSpaceId ? "Space page · " : ""}
              {n.snippet}
            </small>
            <small>
              {new Date(n.updatedAt).toLocaleDateString()}
              {n.features.reviewDue ? ` · Review ${n.features.reviewDue}` : ""}
            </small>
          </button>
        ))}
        {!busy && !notes.length ? (
          <p className={s.muted}>
            {mode === "recent" && !q
              ? "Notes you open will appear here. Use Search to find another note."
              : mode === "due"
                ? "No notes are due for your review."
                : "No matching notes."}
          </p>
        ) : null}
        {busy ? (
          <p role="status">Searching…</p>
        ) : more ? (
          <button
            className="ui-button ed-button"
            onClick={() => setOffset((o) => o + 40)}
          >
            Load more
          </button>
        ) : null}
      </div>
    </FeatureDialog>
  );
}
