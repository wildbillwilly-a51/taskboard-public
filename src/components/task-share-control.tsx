"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Share2, X } from "lucide-react";
import type { TaskShareManagement, TaskShareMode, TaskShareLink } from "@/lib/public-task-share-model";
import { useModalOutsideDismiss } from "./use-modal-outside-dismiss";
import "./task-share-control.css";

const modes: TaskShareMode[] = ["view", "edit_work"];
const emptyLink: TaskShareLink = { exists: false, active: false, expired: false, expiresAt: null };
const unavailable: TaskShareManagement = { allowed: false, active: false, noteTitles: [], excludedNoteTitles: [], fileCount: 0 };
type Action = "create" | "replace" | "disable" | "update";

// This controller survives popup dismissal; keyed instances isolate task scopes.
export function TaskWorkspaceSharing(props: { taskId: string; title: string; className: string }) {
  return <SharingSession key={props.taskId} {...props}/>;
}
function SharingSession({ taskId, title, className }: { taskId: string; title: string; className: string }) {
  const [status, setStatus] = useState<TaskShareManagement | null>(null);
  const [open, setOpen] = useState(false), [busy, setBusy] = useState<TaskShareMode | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState("");
  const latest = useRef<TaskShareManagement | null>(null), alive = useRef(true), pending = useRef(false), epoch = useRef(0), trigger = useRef<HTMLButtonElement>(null);
  const invalidate = useCallback(() => { epoch.current++; }, []);
  const apply = useCallback((value: TaskShareManagement) => { latest.current = value; if (alive.current) { setStatus(value); if (!value.allowed) setOpen(false); } }, []);
  const read = useCallback(async (afterWrite = false) => {
    if (pending.current && !afterWrite) return;
    const generation = epoch.current;
    try {
      const response = await fetch(`/api/tasks/${taskId}/public-share`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
      const result = await response.json();
      if (!alive.current) return;
      if ([401, 403, 404].includes(response.status)) { invalidate(); apply(unavailable); return; }
      if (generation !== epoch.current) return;
      if (!response.ok) {
        throw new Error(result.error || "Unable to load sharing. Try again.");
      }
      apply(result);
    } catch (reason) { if (alive.current && generation === epoch.current) setError(reason instanceof Error ? reason.message : "Unable to load sharing."); }
    finally { if (alive.current && generation === epoch.current) setLoading(false); }
  }, [apply, invalidate, taskId]);
  useEffect(() => {
    alive.current = true;
    const generation = epoch.current;
    queueMicrotask(() => { if (alive.current && generation === epoch.current) void read(); });
    return () => { alive.current = false; invalidate(); };
  }, [read, invalidate]);
  const change = async (mode: TaskShareMode, action: Action, expiresAt: string | null) => {
    if (pending.current || !latest.current?.allowed) return;
    const link = latest.current.links?.[mode] ?? emptyLink;
    pending.current = true; const generation = ++epoch.current; setBusy(mode); setError("");
    try {
      const response = await fetch(`/api/tasks/${taskId}/public-share`, { method: "POST", cache: "no-store", signal: AbortSignal.timeout(20_000), headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, mode, expiresAt, expectedShareId: link.exists ? link.id ?? null : null, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone }) });
      const result = await response.json();
      if (!alive.current) return;
      if ([401, 403, 404].includes(response.status)) { invalidate(); apply(unavailable); return; }
      if (generation !== epoch.current) return;
      if (!response.ok) throw new Error(result.error || "Unable to update sharing.");
      apply(result);
    } catch (reason) {
      if (alive.current && generation === epoch.current) {
        setError(reason instanceof Error ? reason.message : "Unable to update sharing.");
        // Recover a possibly committed URL; never retry a replacement automatically.
        await read(true);
      }
    } finally { pending.current = false; if (alive.current) { setBusy(null); setLoading(false); } }
  };
  if (status?.allowed === false) return null;
  const anyActive = !!status && (status.links?.view.active || status.editingEnabled && status.links?.edit_work.active);
  return <>
    <button ref={trigger} type="button" className={`${className} workspace-share-button`} aria-label="Share workspace" title={anyActive ? "Share workspace · link active" : "Share workspace"} aria-haspopup="dialog" aria-expanded={open} disabled={loading && !status} data-sharing-active={!!anyActive} onClick={() => { setOpen(true); if (!pending.current) { setError(""); void read(); } }}><Share2 aria-hidden="true"/>{anyActive ? <span className="workspace-sharing-dot" aria-hidden="true"/> : null}</button>
    {open && typeof document !== "undefined" ? createPortal(<SharingDialog status={status} title={title} busy={busy} error={error} change={change} close={() => setOpen(false)} returnFocus={() => trigger.current?.focus()}/>, document.body) : null}
    {error && !open && typeof document !== "undefined" ? createPortal(<div className="taskboard-shell workspace-share-error" data-keep-surfaces-open role="alert"><span>{error}</span><button type="button" aria-label="Dismiss sharing notice" onClick={() => setError("")}><X size={16}/></button></div>, document.body) : null}
  </>;
}

type ExpiryDraft = { preset: string; custom: string };
function localDate(value: string) { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }
function savedLabel(link: TaskShareLink) { return link.expiresAt ? new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(link.expiresAt)) : "No expiry"; }
function canUpdateExpiry(link: TaskShareLink) { return link.active && (!link.expiresAt || Date.parse(link.expiresAt) > Date.now()); }
function initialDraft(mode: TaskShareMode, link: TaskShareLink): ExpiryDraft { return canUpdateExpiry(link) ? { preset: "saved", custom: link.expiresAt ? localDate(link.expiresAt) : "" } : { preset: mode === "view" ? "never" : "168", custom: "" }; }

function SharingDialog({ status, title, busy, error, change, close, returnFocus }: {
  status: TaskShareManagement | null; title: string; busy: TaskShareMode | null; error: string;
  change: (mode: TaskShareMode, action: Action, expiresAt: string | null) => Promise<void>; close: () => void; returnFocus: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null), fields = useRef<Partial<Record<TaskShareMode, HTMLInputElement | null>>>({});
  useModalOutsideDismiss(dialog, close);
  const [expiry, setExpiry] = useState<Record<TaskShareMode, ExpiryDraft>>(() => ({ view: initialDraft("view", status?.links?.view ?? emptyLink), edit_work: initialDraft("edit_work", status?.links?.edit_work ?? emptyLink) }));
  const [notice, setNotice] = useState<Partial<Record<TaskShareMode, string>>>({}), [copied, setCopied] = useState<TaskShareMode | null>(null);
  const signatures = useRef(modes.map(mode => JSON.stringify(status?.links?.[mode])));
  const onReturn = useRef(returnFocus); onReturn.current = returnFocus;
  useEffect(() => { const element = dialog.current; element?.showModal(); return () => { element?.close(); onReturn.current(); }; }, []);
  useEffect(() => {
    for (const [index, mode] of modes.entries()) {
      const signature = JSON.stringify(status?.links?.[mode]);
      if (signatures.current[index] === signature) continue;
      signatures.current[index] = signature;
      setExpiry(previous => ({ ...previous, [mode]: initialDraft(mode, status?.links?.[mode] ?? emptyLink) }));
    }
  }, [status]);
  useEffect(() => { if (!copied) return; const timer = setTimeout(() => setCopied(null), 2000); return () => clearTimeout(timer); }, [copied]);
  const deadline = (mode: TaskShareMode, draft: ExpiryDraft) => {
    if (draft.preset === "saved") return status?.links?.[mode].expiresAt ?? null;
    if (draft.preset === "never") return null;
    if (draft.preset === "custom") {
      const value = new Date(draft.custom);
      if (!draft.custom || !Number.isFinite(value.getTime()) || value.getTime() <= Date.now()) throw new Error("Choose an expiry in the future.");
      return value.toISOString();
    }
    return new Date(Date.now() + Number(draft.preset) * 3600000).toISOString();
  };
  const act = async (mode: TaskShareMode, action: Action, draft = expiry[mode]) => {
    setNotice(previous => ({ ...previous, [mode]: "" }));
    try {
      const next = (action === "create" || action === "replace") && draft.preset === "saved" && !canUpdateExpiry(status?.links?.[mode] ?? emptyLink) ? initialDraft(mode, emptyLink) : draft;
      const until = action === "disable" ? null : deadline(mode, next);
      if (until && Date.parse(until) <= Date.now()) throw new Error("Choose an expiry in the future.");
      await change(mode, action, until);
    } catch (reason) { setNotice(previous => ({ ...previous, [mode]: reason instanceof Error ? reason.message : "Unable to update sharing." })); }
  };
  const copy = async (mode: TaskShareMode, link: TaskShareLink) => {
    if (!link.active || !link.url) return;
    try { await navigator.clipboard.writeText(new URL(link.url, window.location.origin).href); setCopied(mode); }
    catch { fields.current[mode]?.focus(); fields.current[mode]?.select(); setNotice(previous => ({ ...previous, [mode]: "Select and copy the link above." })); }
  };
  return <dialog ref={dialog} className="taskboard-shell taskboard-popover workspace-share-dialog" data-editor-scale="true" data-keep-surfaces-open aria-labelledby="task-share-title" onCancel={event => { event.preventDefault(); close(); }} onKeyDown={event => event.stopPropagation()} onPointerDown={event => event.stopPropagation()} onClick={event => { event.stopPropagation(); if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) { event.preventDefault(); close(); } } }}>
    <header><div><h2 id="task-share-title">Share workspace</h2><p>{title}</p></div><button type="button" className="work-button" aria-label="Close sharing" onClick={close}><X size={16}/></button></header>
    <div className="workspace-share-content">
      <p className="work-muted">Anyone with a link gets its access. Saved updates appear automatically.</p>
      {error ? <p role="alert" className="ui-danger-banner">{error}</p> : null}
      {!status ? <p role="status">Loading sharing…</p> : modes.filter(mode => mode === "view" || status.editingEnabled).map(mode => {
        const link = status.links?.[mode] ?? emptyLink, edit = mode === "edit_work", label = edit ? "Edit work" : "Read-only", draft = expiry[mode];
        const state = link.unavailable ? "Unavailable" : link.expired ? "Expired" : link.active ? "Active" : link.disabled ? "Disabled" : "Not generated";
        return <section key={mode} className="workspace-share-link" aria-label={`${label} link`}>
          <div className="workspace-share-link-heading"><h3>{label}</h3><span data-active={link.active}>{busy === mode ? "Saving…" : state}</span></div>
          <p className="work-muted">{edit ? "Edit subtasks, checklists, working notes and People. Task details, Notes and Files stay read-only." : "View Work, Working notes, Notes and Files without editing."}</p>
          <input ref={element => { fields.current[mode] = element; }} className="work-input workspace-share-url" aria-label={`${label} link URL`} readOnly value={link.url ? new URL(link.url, window.location.origin).href : ""} placeholder={link.disabled ? "Link disabled" : link.exists ? "Existing link URL unavailable" : "No link generated"} onFocus={event => event.currentTarget.select()}/>
          {link.retrieval ? <p className="workspace-share-hint">{link.retrieval === "legacy" ? "This link was created before saved URLs were available. Generate a new link to copy it; the previous link will stop working." : "The saved URL is temporarily unavailable. The existing link has not been replaced."}</p> : null}
          <div className="workspace-share-expiry"><label>Expires <select className="work-input" aria-label={`${label} link expiry`} value={draft.preset} disabled={!!busy} onChange={event => {
            const next = { ...draft, preset: event.target.value }; setExpiry(previous => ({ ...previous, [mode]: next }));
            if (canUpdateExpiry(link) && next.preset !== "custom" && next.preset !== "saved") void act(mode, "update", next);
          }}>{canUpdateExpiry(link) ? <option value="saved">Current: {savedLabel(link)}</option> : null}<option value="never">No expiry</option><option value="1">In 1 hour</option><option value="24">In 1 day</option><option value="168">In 7 days</option><option value="720">In 30 days</option><option value="custom">Custom date…</option></select></label><small className="work-muted">{canUpdateExpiry(link) ? "Changes save automatically" : "Applies to the next link"}</small></div>
          {draft.preset === "custom" ? <label className="workspace-share-custom">Expiry · {Intl.DateTimeFormat().resolvedOptions().timeZone}<input className="work-input" type="datetime-local" aria-label={`${label} expiry date and time`} value={draft.custom} disabled={!!busy} onChange={event => setExpiry(previous => ({ ...previous, [mode]: { ...previous[mode], custom: event.target.value } }))} onBlur={() => { if (canUpdateExpiry(link) && draft.custom) void act(mode, "update"); }} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); if (canUpdateExpiry(link)) void act(mode, "update"); } }}/></label> : null}
          <div className="workspace-share-buttons"><button type="button" className="work-button workspace-share-generate" disabled={!!busy || !status.canGenerateLinks} onClick={() => void act(mode, link.exists ? "replace" : "create")}>Generate Link</button><button type="button" className="work-button workspace-share-disable" disabled={!!busy || !link.exists} onClick={() => void act(mode, "disable")}>Disable Link</button><button type="button" className="work-button" disabled={!!busy || !link.active || !link.url} onClick={() => void copy(mode, link)}>{copied === mode ? "Copied" : "Copy Link"}</button></div>
          <p className="workspace-share-hint">Generating a new link disables the previous {edit ? "edit" : "read-only"} link.</p>
          {notice[mode] ? <p className="workspace-share-hint" role="status">{notice[mode]}</p> : null}
        </section>;
      })}
      {status?.canGenerateLinks === false ? <p className="work-muted" role="status">New link generation is temporarily unavailable. Existing links are unchanged.</p> : null}
      {status ? <details className="workspace-share-inventory"><summary>Includes {status.fileCount} files and {status.noteTitles.length} linked notes</summary><p>Notes are included while you own them or manage their source board.</p>{status.noteTitles.length ? <ul>{status.noteTitles.map((name, index) => <li key={index}>{name}</li>)}</ul> : null}{status.excludedNoteTitles.length ? <p>Not included: {status.excludedNoteTitles.join(", ")}</p> : null}</details> : null}
    </div>
  </dialog>;
}
