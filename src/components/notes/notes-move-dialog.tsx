"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

export type NotesMoveOption = { value: string; label: string; group: string; disabled?: boolean };

export function NotesMoveDialog({ title, initialValue, options, warning, onMove, onClose }: {
  title: string;
  initialValue: string;
  options: NotesMoveOption[];
  warning?: (value: string) => string | null;
  onMove: (value: string) => Promise<string | null>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(initialValue);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const panelRef = useRef<HTMLFormElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef(onClose);
  const titleId = useId();
  const warningId = useId();
  useEffect(() => { closeRef.current = onClose; });
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Tab" && busyRef.current) {
        event.preventDefault(); event.stopPropagation();panelRef.current?.focus();
      }
      if (event.key === "Escape") {
        event.preventDefault(); event.stopPropagation();
        if (!busyRef.current) closeRef.current();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => {
      window.removeEventListener("keydown", key, true);
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const message = warning?.(value);

  return createPortal(<div className="app-dialog-backdrop" data-keep-surfaces-open=""
    onMouseDown={event => { if (event.target === event.currentTarget && !busyRef.current) onClose(); }}>
    <form ref={panelRef} tabIndex={-1} className="app-dialog" role="dialog" aria-modal="true" aria-busy={busy} aria-labelledby={titleId}
      aria-describedby={message ? warningId : undefined}
      onKeyDown={event => {
        if (event.key !== "Tab") return;
        const fields = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("select:not(:disabled), button:not(:disabled)") ?? []);
        if (!fields.length) { event.preventDefault();panelRef.current?.focus();return; }
        const first = fields[0]; const last = fields.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }}
      onSubmit={async event => {
        event.preventDefault();
        if (busyRef.current || value === initialValue || options.find(option => option.value === value)?.disabled) return;
        busyRef.current = true; setBusy(true); setError("");
        panelRef.current?.focus();
        try {
          const failure = await onMove(value);
          if (failure) setError(failure); else onClose();
        } catch (failure) { setError(failure instanceof Error ? failure.message : "Unable to move this item."); }
        finally {
          busyRef.current = false; setBusy(false);
          // Disabling the focused submit button moves focus to the body.
          // On failure the dialog stays open, so return focus inside it.
          window.requestAnimationFrame(() => cancelRef.current?.focus());
        }
      }}>
      <h2 id={titleId} className="app-dialog-title">{title}</h2>
      <label className="notes-move-field">Destination
        <select className="notes-select" value={value} disabled={busy} onChange={event => { setValue(event.target.value); setError(""); }}>
          {[...new Set(options.map(option => option.group))].map(group => <optgroup key={group} label={group}>
            {options.filter(option => option.group === group).map(option => <option key={option.value} value={option.value} disabled={option.disabled}>{option.label}</option>)}
          </optgroup>)}
        </select>
      </label>
      {message ? <p id={warningId} className="app-dialog-body" role="status">{message}</p> : null}
      {error ? <p className="inline-name-field-error" role="alert">{error}</p> : null}
      <div className="app-dialog-actions">
        <button ref={cancelRef} type="button" className="ui-button" disabled={busy} onClick={onClose}>Cancel</button>
        <button type="submit" className="ui-button ui-button-primary" disabled={busy || value === initialValue}>{busy ? "Moving…" : "Move"}</button>
      </div>
    </form>
  </div>, document.querySelector('[data-testid="taskboard-shell"]') ?? document.body);
}
