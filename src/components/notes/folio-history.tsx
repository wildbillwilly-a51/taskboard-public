"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import {
  createElement,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  History,
  RefreshCw,
  X,
} from "lucide-react";
import { folioRequest } from "@/lib/folio-client";
import {
  compareFolioVersions,
  folioHistoryRange,
  type FolioVersionDetail,
  type FolioVersionListing,
  type HistoryInlineRun,
  type HistoryInlineToken,
} from "@/lib/folio-history-model";
import { PageMentionProvider } from "./page-mention-provider";
import { PageMentionLabel } from "./page-mention";
import {
  useWikiFormatInventory,
  isWikiDocumentSupported,
} from "../wiki/wiki-format";
import styles from "./folio-history.module.css";

const Reader = dynamic(() => import("../public-note-body"), {
  ssr: false,
  loading: () => <p role="status">Loading document…</p>,
});
const date = (v: string) =>
  new Date(v).toLocaleString(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  });
const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
function safeHref(value: string) {
  try {
    return ["http:", "https:", "mailto:", "tel:"].includes(
      new URL(value, "https://taskboard.invalid").protocol,
    )
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}
function Inline({ token }: { token: HistoryInlineToken }) {
  let value: ReactNode = token.mentionId ? (
    <PageMentionLabel noteId={token.mentionId} />
  ) : (
    token.text
  );
  const s = token.styles ?? {};
  if (s.bold) value = <strong>{value}</strong>;
  if (s.italic) value = <em>{value}</em>;
  if (s.underline) value = <u>{value}</u>;
  if (s.strike) value = <s>{value}</s>;
  if (s.code) value = <code>{value}</code>;
  const color =
    typeof s.textColor === "string" && s.textColor !== "default"
      ? s.textColor
      : undefined;
  const backgroundColor =
    typeof s.backgroundColor === "string" && s.backgroundColor !== "default"
      ? s.backgroundColor
      : undefined;
  if (color || backgroundColor)
    value = <span style={{ color, backgroundColor }}>{value}</span>;
  // History follows the live Notes renderer; this small semantic text renderer
  // additionally refuses executable URL schemes without modifying stored data.
  if (token.href)
    value = safeHref(token.href) ? (
      <a href={safeHref(token.href)}>{value}</a>
    ) : (
      <span title="Link unavailable">{value}</span>
    );
  return value;
}
function Runs({ runs }: { runs: HistoryInlineRun[] }) {
  return runs.map((run, i) => {
    const text = run.values.map((t, j) => <Inline token={t} key={j} />);
    if (run.kind === "same") return <span key={i}>{text}</span>;
    const props = {
      "data-history-change": run.change,
      "data-change-kind": run.kind,
      className: run.kind === "added" ? styles.added : styles.removed,
    };
    return run.kind === "added" ? (
      <ins {...props} key={i}>
        {text}
      </ins>
    ) : (
      <del {...props} key={i}>
        {text}
      </del>
    );
  });
}
function TextBlock({
  block,
  runs,
}: {
  block: unknown;
  runs: HistoryInlineRun[];
}) {
  const b = obj(block),
    p = obj(b.props),
    style: CSSProperties = {
      textAlign: ["left", "center", "right", "justify"].includes(
        String(p.textAlignment),
      )
        ? (p.textAlignment as CSSProperties["textAlign"])
        : undefined,
      color:
        typeof p.textColor === "string" && p.textColor !== "default"
          ? p.textColor
          : undefined,
      backgroundColor:
        typeof p.backgroundColor === "string" && p.backgroundColor !== "default"
          ? p.backgroundColor
          : undefined,
    };
  const content = <Runs runs={runs} />;
  if (b.type === "heading") {
    const level = Math.max(1, Math.min(6, Number(p.level) || 1));
    return createElement(`h${level}`, { style }, content);
  }
  return b.type === "quote" ? (
    <blockquote style={style}>{content}</blockquote>
  ) : (
    <p style={style}>{content}</p>
  );
}
// A snapshot can reference soft-removed or permanently deleted files. Never let
// broken history images issue repeated requests; display an honest placeholder.
function maskUnavailable(content: unknown[], ids: string[]): unknown[] {
  const unavailable = (v: unknown) =>
    typeof v === "string" && ids.some((id) => v.includes(`/attachments/${id}`));
  const walk = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(walk);
    if (!v || typeof v !== "object") return v;
    const n = obj(v);
    if (unavailable(obj(n.props).url))
      return {
        type: "paragraph",
        content: [{ type: "text", text: "File unavailable", styles: {} }],
      };
    if (unavailable(n.href))
      return { type: "text", text: "File unavailable", styles: {} };
    return Object.fromEntries(Object.entries(n).map(([k, x]) => [k, walk(x)]));
  };
  return walk(content) as unknown[];
}
function Rich({
  content,
  version,
}: {
  content: unknown[];
  version: FolioVersionDetail;
}) {
  const blocks = useMemo(
    () => maskUnavailable(content, version.unavailableAttachmentIds),
    [content, version.unavailableAttachmentIds],
  );
  return (
    <Reader
      content={blocks}
      contentFormatVersion={version.format}
      authenticatedMentions
    />
  );
}
function Files({
  noteId,
  version,
}: {
  noteId: string;
  version: FolioVersionDetail;
}) {
  return (
    <ul className={styles.files}>
      {version.attachments.map((f) => (
        <li key={f.id}>
          {f.available ? (
            <a
              href={`/api/notes/${noteId}/attachments/${f.id}`}
              download={f.name}
            >
              {f.name}
            </a>
          ) : (
            <span>{f.name} · File unavailable</span>
          )}
          {f.removed && f.available ? (
            <small>Removed from current files</small>
          ) : null}
        </li>
      ))}
      {version.unavailableAttachmentIds
        .filter((id) => !version.attachments.some((f) => f.id === id))
        .map((id) => (
          <li key={id}>File unavailable</li>
        ))}
      {!version.attachments.length &&
      !version.unavailableAttachmentIds.length ? (
        <li>No files</li>
      ) : null}
    </ul>
  );
}
function PageSettings({
  noteId,
  version,
}: {
  noteId: string;
  version: FolioVersionDetail;
}) {
  const state = version.pageState;
  if (!state) return null;
  const banner = state.bannerAttachmentId
    ? version.attachments.find((f) => f.id === state.bannerAttachmentId)
    : undefined;
  return (
    <div className={styles.pageSettings}>
      {state.bannerAttachmentId ? (
        banner?.available ? (
          <Image
            unoptimized
            width={1200}
            height={360}
            src={`/api/notes/${noteId}/attachments/${state.bannerAttachmentId}?disposition=inline`}
            alt="Space banner in this version"
          />
        ) : (
          <p>Banner file unavailable</p>
        )
      ) : (
        <p>No banner</p>
      )}
      <p>
        {state.notesListVisible
          ? `Notes list shown ${state.notesListPosition} the page content`
          : "Notes list hidden"}
      </p>
      <small>The notes in a space follow its current connections.</small>
    </div>
  );
}
type Props = {
  noteId: string;
  canRestore: boolean;
  isPhone: boolean;
  onClose: () => void;
  onRestore: (version: FolioVersionDetail) => Promise<void>;
};

export default function FolioHistory({
  noteId,
  canRestore,
  isPhone,
  onClose,
  onRestore,
}: Props) {
  const inventory = useWikiFormatInventory();
  const [refresh, setRefresh] = useState(0),
    [panel, setPanel] = useState(true),
    [changes, setChanges] = useState(true);
  const [listingState, setListing] = useState<{
    key: string;
    value: FolioVersionListing;
  } | null>(null);
  const [selection, setSelection] = useState<{
    anchor: string;
    target: string;
  } | null>(null);
  const [rangeControls, setRangeControls] = useState<{
    from: string;
    to: string;
  } | null>(null);
  const [preview, setPreview] = useState<{
    key: string;
    before: FolioVersionDetail | null;
    after: FolioVersionDetail;
  } | null>(null);
  const [error, setError] = useState(""),
    [paging, setPaging] = useState(false),
    [restoring, setRestoring] = useState(false),
    [activeChange, setActiveChange] = useState(0);
  const [message, setMessage] = useState("");
  const root = useRef<HTMLDivElement>(null),
    versionsButton = useRef<HTMLButtonElement>(null),
    drawer = useRef<HTMLDialogElement>(null);
  const listKey = `${noteId}:${refresh}`,
    listing = listingState?.key === listKey ? listingState.value : null,
    versions = listing?.versions ?? [];
  const range = rangeControls
    ? folioHistoryRange(versions, rangeControls.from, rangeControls.to)
    : selection
      ? folioHistoryRange(versions, selection.anchor, selection.target)
      : null;
  const selectedIds = range?.selected.map((v) => v.id) ?? [];
  const afterMeta = range?.after;
  const beforeMeta = range?.before;
  const isRange = Boolean(range && range.selected.length > 1);
  const needOlder = Boolean(range?.needsOlder && listing?.hasMore);
  const previewKey =
    afterMeta && !needOlder
      ? `${listKey}:${afterMeta.id}:${beforeMeta?.id ?? "empty"}`
      : "";
  const shown = preview?.key === previewKey ? preview : null;
  const supported = Boolean(
    shown &&
      isWikiDocumentSupported(
        shown.after.content,
        shown.after.format,
        inventory,
      ) &&
      (!shown.before ||
        isWikiDocumentSupported(
          shown.before.content,
          shown.before.format,
          inventory,
        )),
  );
  const comparison = useMemo(
    () =>
      shown && supported
        ? compareFolioVersions(shown.before, shown.after)
        : null,
    [shown, supported],
  );
  useEffect(() => {
    const c = new AbortController();
    void folioRequest<FolioVersionListing>(
      { action: "history", noteId },
      undefined,
      c.signal,
    )
      .then((value) => {
        if (c.signal.aborted) return;
        setListing({ key: listKey, value });
        setError("");
        setSelection((old) =>
          old &&
          value.versions.some((v) => v.id === old.anchor) &&
          value.versions.some((v) => v.id === old.target)
            ? old
            : value.versions[0]
              ? { anchor: value.versions[0].id, target: value.versions[0].id }
              : null,
        );
        setRangeControls(null);
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setError(e.message);
          setListing(null);
          setPreview(null);
        }
      });
    return () => c.abort();
  }, [listKey, noteId]);
  useEffect(() => {
    const cursor = needOlder ? listing?.nextBeforeVersion : null;
    if (!cursor) return;
    const c = new AbortController();
    void folioRequest<FolioVersionListing>(
      { action: "history", noteId, beforeVersion: cursor },
      undefined,
      c.signal,
    )
      .then((value) => {
        if (!c.signal.aborted)
          setListing((old) =>
            old?.key === listKey
              ? {
                  key: listKey,
                  value: {
                    ...value,
                    versions: [
                      ...old.value.versions,
                      ...value.versions.filter(
                        (v) => !old.value.versions.some((o) => o.id === v.id),
                      ),
                    ],
                  },
                }
              : old,
          );
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [needOlder, listing?.nextBeforeVersion, noteId, listKey]);
  useEffect(() => {
    if (!previewKey || !afterMeta) return;
    const c = new AbortController();
    const load = (id: string) =>
      folioRequest<{ version: FolioVersionDetail }>(
        { action: "historyVersion", noteId, versionId: id },
        undefined,
        c.signal,
      ).then((r) => r.version);
    const afterRequest = load(afterMeta.id);
    void Promise.all([
      afterRequest,
      beforeMeta
        ? beforeMeta.id === afterMeta.id
          ? afterRequest
          : load(beforeMeta.id)
        : Promise.resolve(null),
    ])
      .then(([after, before]) => {
        if (!c.signal.aborted) {
          setPreview({ key: previewKey, before, after });
          setError("");
          setActiveChange(0);
          setMessage("");
        }
      })
      .catch((e) => {
        if (!c.signal.aborted) {
          setError(e.message);
          setPreview(null);
        }
      });
    return () => c.abort();
  }, [previewKey, noteId, afterMeta, beforeMeta]);
  useEffect(() => {
    const el = drawer.current;
    if (!isPhone || !el) return;
    if (panel && !el.open) el.showModal();
    else if (!panel && el.open) el.close();
    return () => {
      if (el.open) el.close();
    };
  }, [panel, isPhone]);
  const closePanel = () => {
    setPanel(false);
    requestAnimationFrame(() => versionsButton.current?.focus());
  };
  const choose = (id: string, extend = false) => {
    if (restoring) return;
    setSelection((old) => ({
      anchor: extend && old ? old.anchor : id,
      target: id,
    }));
    setRangeControls(null);
    setError("");
    setMessage("");
    if (isPhone && !extend) closePanel();
  };
  const keySelect = (e: KeyboardEvent<HTMLButtonElement>, i: number) => {
    let at = i;
    if (e.key === "ArrowDown") at = Math.min(versions.length - 1, i + 1);
    else if (e.key === "ArrowUp") at = Math.max(0, i - 1);
    else if (e.key === "Home") at = 0;
    else if (e.key === "End") at = versions.length - 1;
    else return;
    e.preventDefault();
    choose(versions[at].id, e.shiftKey);
    requestAnimationFrame(() =>
      root.current
        ?.querySelector<HTMLButtonElement>(
          `[data-version-id="${versions[at].id}"]`,
        )
        ?.focus(),
    );
  };
  const more = async () => {
    if (!listing?.hasMore || !listing.nextBeforeVersion || paging) return;
    setPaging(true);
    setError("");
    try {
      const value = await folioRequest<FolioVersionListing>({
        action: "history",
        noteId,
        beforeVersion: listing.nextBeforeVersion,
      });
      setListing((old) =>
        old?.key === listKey
          ? {
              key: listKey,
              value: {
                ...value,
                versions: [
                  ...old.value.versions,
                  ...value.versions.filter(
                    (v) => !old.value.versions.some((o) => o.id === v.id),
                  ),
                ],
              },
            }
          : old,
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to load older versions.",
      );
    } finally {
      setPaging(false);
    }
  };
  const jump = (delta: number) => {
    if (!comparison?.total) return;
    const next =
      activeChange === 0
        ? delta > 0
          ? 1
          : comparison.total
        : ((activeChange - 1 + delta + comparison.total) % comparison.total) +
          1;
    root.current
      ?.querySelectorAll("[data-active-change]")
      .forEach((el) => el.removeAttribute("data-active-change"));
    const found = root.current?.querySelectorAll<HTMLElement>(
      `[data-history-change="${next}"]`,
    );
    found?.forEach((el) => el.setAttribute("data-active-change", "true"));
    found?.[0]?.scrollIntoView({ block: "center", behavior: "auto" });
    setActiveChange(next);
    setMessage(
      isRange
        ? `Change ${next} of ${comparison.total} in the selected range`
        : `Change ${next} of ${comparison.total}, ${shown?.after.author ?? "Former user"}, ${shown ? date(shown.after.savedAt) : ""}`,
    );
  };
  const restore = async () => {
    if (!shown || !supported || isRange || restoring || !canRestore) return;
    setRestoring(true);
    setError("");
    try {
      await onRestore(shown.after);
    } catch (e) {
      setPreview(null);
      setError(
        e instanceof Error
          ? e.message
          : "Unable to confirm restoration. Refresh history before retrying.",
      );
    } finally {
      setRestoring(false);
    }
  };
  const setRangeEndpoints = (from: string, to: string) => {
    const interval = folioHistoryRange(versions, from, to);
    if (interval)
      setRangeControls({
        from: interval.selected.at(-1)!.id,
        to: interval.after.id,
      });
  };
  const panelContent = (
    <>
      <header className={styles.panelHeader}>
        <h2 id="folio-versions-title">Versions</h2>
        <button aria-label="Close versions" onClick={closePanel}>
          <X size={17} />
        </button>
      </header>
      <p className={styles.hint}>
        {isPhone
          ? "Choose a version, or turn on Compare versions to review an interval."
          : "Choose a version. Shift-click to review a range."}
      </p>
      <label className={styles.compareLabel}>
        <input
          type="checkbox"
          checked={Boolean(rangeControls)}
          disabled={versions.length < 2 || restoring}
          onChange={(e) => {
            setRangeControls(
              e.target.checked
                ? {
                    to: afterMeta?.id ?? versions[0].id,
                    from:
                      range?.selected.at(-1)?.id ??
                      afterMeta?.id ??
                      versions[0].id,
                  }
                : null,
            );
            setError("");
          }}
        />
        Compare versions
      </label>
      {rangeControls ? (
        <div className={styles.compareFields}>
          <small>
            Review every edit from the first selected version through the last.
          </small>
          <label>
            First version
            <select
              aria-label="First version in range"
              value={rangeControls.from}
              disabled={restoring}
              onChange={(e) =>
                setRangeEndpoints(e.target.value, rangeControls.to)
              }
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  Version {v.version}
                </option>
              ))}
            </select>
          </label>
          <label>
            Last version
            <select
              aria-label="Last version in range"
              value={rangeControls.to}
              disabled={restoring}
              onChange={(e) =>
                setRangeEndpoints(rangeControls.from, e.target.value)
              }
            >
              {versions.map((v) => (
                <option key={v.id} value={v.id}>
                  Version {v.version}
                </option>
              ))}
            </select>
          </label>
          {isPhone ? (
            <button onClick={closePanel}>View comparison</button>
          ) : null}
        </div>
      ) : null}
      <ol className={styles.versionList}>
        {versions.map((v, i) => (
          <li key={v.id}>
            <button
              data-version-id={v.id}
              className={styles.version}
              aria-pressed={selectedIds.includes(v.id)}
              disabled={restoring}
              onClick={(e) => choose(v.id, e.shiftKey)}
              onKeyDown={(e) => keySelect(e, i)}
            >
              <span>
                <strong>Version {v.version}</strong>
                {i === 0 ? <small>Latest</small> : null}
              </span>
              <span>{v.author ?? "Former user"}</span>
              <time dateTime={v.savedAt}>{date(v.savedAt)}</time>
              {v.kind === "restore" ? (
                <small>Restored version</small>
              ) : v.kind === "start" ? (
                <small>Created</small>
              ) : null}
            </button>
          </li>
        ))}
      </ol>
      {listing?.hasMore ? (
        <button
          className={styles.loadMore}
          disabled={paging || restoring}
          onClick={() => void more()}
        >
          {paging ? "Loading…" : "Load older versions"}
        </button>
      ) : null}
    </>
  );
  const before = shown?.before,
    after = shown?.after;
  return (
    <div
      className={`taskboard-shell ${styles.root}`}
      data-editor-scale="true"
      ref={root}
      data-testid="folio-history"
      data-panel={panel && !isPhone}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !restoring) {
          e.stopPropagation();
          if (panel) closePanel();
          else onClose();
        }
      }}
    >
      <header className={styles.toolbar}>
        <button autoFocus onClick={onClose} disabled={restoring}>
          <ArrowLeft size={16} />
          Back to note
        </button>
        <span className={styles.toolbarTitle}>History</span>
        <button
          onClick={() => {
            setRefresh((v) => v + 1);
            setError("");
          }}
          disabled={restoring}
          aria-label="Refresh history"
        >
          <RefreshCw size={15} />
        </button>
        <button
          ref={versionsButton}
          aria-expanded={panel}
          onClick={() => setPanel((v) => !v)}
          disabled={restoring}
        >
          <History size={15} />
          Versions
        </button>
      </header>
      <div className={styles.reviewBar}>
        <label>
          <input
            type="checkbox"
            checked={changes}
            onChange={(e) => {
              setChanges(e.target.checked);
              setActiveChange(0);
              root.current
                ?.querySelectorAll("[data-active-change]")
                .forEach((el) => el.removeAttribute("data-active-change"));
            }}
          />
          Show changes
        </label>
        {changes && comparison ? (
          <div className={styles.changeNavigation}>
            <span>
              {comparison.total
                ? `${activeChange ? `${activeChange} of ` : ""}${comparison.total} ${comparison.total === 1 ? "change" : "changes"}`
                : "No changes"}
            </span>
            <button
              aria-label="Previous change"
              disabled={!comparison.total}
              onClick={() => jump(-1)}
            >
              <ArrowUp size={15} />
            </button>
            <button
              aria-label="Next change"
              disabled={!comparison.total}
              onClick={() => jump(1)}
            >
              <ArrowDown size={15} />
            </button>
          </div>
        ) : null}
        <button
          className={styles.restore}
          disabled={!canRestore || !shown || !supported || isRange || restoring}
          onClick={() => void restore()}
        >
          {restoring ? "Restoring…" : "Restore this version"}
        </button>
      </div>
      {error ? (
        <div className={styles.error} role="alert">
          {error}
          <button
            onClick={() => {
              setRefresh((v) => v + 1);
              setError("");
            }}
          >
            Refresh history
          </button>
        </div>
      ) : null}
      <div className={styles.layout}>
        <section
          className={styles.preview}
          aria-label="Version preview"
          aria-busy={Boolean(!shown && versions.length && !error)}
        >
          {!listing && !error ? (
            <p role="status">Loading history…</p>
          ) : listing && !versions.length ? (
            <p>
              No saved versions yet. Existing Notes begin Folio history when
              adopted.
            </p>
          ) : needOlder ? (
            <p>
              {error
                ? "Unable to load the adjacent revision."
                : "Loading adjacent revision…"}{" "}
              {error ? (
                <button onClick={() => void more()} disabled={paging}>
                  Retry
                </button>
              ) : null}
            </p>
          ) : !shown && !error ? (
            <p role="status">Loading version…</p>
          ) : null}
          {after ? (
            <>
              <div className={styles.metadata}>
                <strong>
                  {isRange
                    ? `Net changes: ${before ? `version ${before.version}` : "creation"} → version ${after.version}`
                    : `Version ${after.version}`}
                </strong>
                <span>
                  {isRange
                    ? `From ${before ? date(before.savedAt) : "creation"} through ${date(after.savedAt)}`
                    : `${after.author ?? "Former user"} · ${date(after.savedAt)}`}
                </span>
                {isRange ? (
                  <small>
                    Net changes across the interval. Individual changes are not
                    attributed to intermediate authors. Select one version to
                    restore it.
                  </small>
                ) : null}
                <small>
                  Restoring preserves current connections and newer current
                  files.
                </small>
              </div>
              {!inventory ? (
                <p role="status">Loading document schema…</p>
              ) : !supported ? (
                <p role="alert">
                  This document format is not supported. Its original content is
                  preserved; restore is unavailable.
                </p>
              ) : (
                <div className={styles.document}>
                  <PageMentionProvider
                    blocks={[...(before?.content ?? []), ...after.content]}
                    authenticatedMentions
                  >
                    <h1 className={styles.title}>
                      {changes && comparison ? (
                        <>
                          <Runs runs={comparison.title} />
                          {!after.title ? <em>Untitled note</em> : null}
                        </>
                      ) : (
                        after.title || "Untitled note"
                      )}
                    </h1>
                    {comparison?.large && changes ? (
                      <p className={styles.hint}>
                        Large revision: showing complete before and after
                        documents to keep comparison responsive.
                      </p>
                    ) : null}
                    {changes && comparison ? (
                      comparison.parts.map((part, i) =>
                        part.kind === "rich" ? (
                          <Rich key={i} content={part.blocks} version={after} />
                        ) : part.kind === "text" ? (
                          <div className={styles.textBlock} key={i}>
                            <TextBlock block={part.block} runs={part.runs} />
                          </div>
                        ) : (
                          <div
                            className={styles.replacement}
                            key={i}
                            data-history-change={part.change}
                          >
                            <small>{part.label}</small>
                            {part.before.length && before ? (
                              <section
                                className={styles.removedBlock}
                                aria-label="Removed content"
                              >
                                <small>Removed</small>
                                <Rich content={part.before} version={before} />
                              </section>
                            ) : null}
                            {part.after.length ? (
                              <section
                                className={styles.addedBlock}
                                aria-label="Added content"
                              >
                                <small>Added</small>
                                <Rich content={part.after} version={after} />
                              </section>
                            ) : null}
                          </div>
                        ),
                      )
                    ) : (
                      <Rich content={after.content} version={after} />
                    )}
                  </PageMentionProvider>
                  {after.pageState ? (
                    <section
                      className={styles.settingsComparison}
                      data-history-change={
                        changes
                          ? (comparison?.pageChange ?? undefined)
                          : undefined
                      }
                    >
                      <h2>Space page</h2>
                      {changes &&
                      comparison?.pageChanged &&
                      before?.pageState ? (
                        <div className={styles.removedBlock}>
                          <small>Before</small>
                          <PageSettings noteId={noteId} version={before} />
                        </div>
                      ) : null}
                      <div
                        className={
                          changes && comparison?.pageChanged
                            ? styles.addedBlock
                            : undefined
                        }
                      >
                        <small>
                          {changes && comparison?.pageChanged ? "After" : null}
                        </small>
                        <PageSettings noteId={noteId} version={after} />
                      </div>
                    </section>
                  ) : null}
                  <section
                    className={styles.settingsComparison}
                    data-history-change={
                      changes
                        ? (comparison?.filesChange ?? undefined)
                        : undefined
                    }
                  >
                    <h2>Files in this version</h2>
                    {changes && comparison?.filesChanged && before ? (
                      <div className={styles.removedBlock}>
                        <small>Before</small>
                        <Files noteId={noteId} version={before} />
                      </div>
                    ) : null}
                    <div
                      className={
                        changes && comparison?.filesChanged
                          ? styles.addedBlock
                          : undefined
                      }
                    >
                      <Files noteId={noteId} version={after} />
                    </div>
                  </section>
                </div>
              )}
            </>
          ) : null}
          <span className={styles.srOnly} role="status" aria-live="polite">
            {message}
          </span>
        </section>
        {panel && !isPhone ? (
          <aside
            className={styles.panel}
            aria-labelledby="folio-versions-title"
          >
            {panelContent}
          </aside>
        ) : null}
      </div>
      {isPhone ? (
        <dialog
          ref={drawer}
          className={styles.drawer}
          aria-labelledby="folio-versions-title"
          onCancel={(e) => {
            e.preventDefault();
            e.stopPropagation();
            closePanel();
          }}
          onClick={(e) => {
            if (e.target === e.currentTarget) closePanel();
          }}
        >
          <aside>{panelContent}</aside>
        </dialog>
      ) : null}
    </div>
  );
}
