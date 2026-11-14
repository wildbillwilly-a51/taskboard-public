"use client";

import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";

export type ConfirmOptions = {
  title: string;
  body?: string;
  confirmLabel: string;
  cancelLabel?: string;
  // Danger styles the confirm button and starts focus on Cancel.
  tone?: "default" | "danger";
  // Start focus on Cancel for a non-destructive but consequential change.
  focusCancel?: boolean;
};

type PendingConfirm = ConfirmOptions & { resolve: (confirmed: boolean) => void };

// In-app confirmation in place of the browser confirm dialog (owner rule: no
// browser dialogs). `confirm(options)` resolves true or false; render `dialog` once in
// the component tree. Do not give the panel the .taskboard-popover class: a
// density rule forces popover padding to 4px.
export function useConfirm() {
  const [pending, setPending] = useState<PendingConfirm | null>(null);

  const confirm = useCallback(
    (options: ConfirmOptions) =>
      new Promise<boolean>((resolve) => {
        setPending({ ...options, resolve });
      }),
    [],
  );

  const settle = useCallback(
    (confirmed: boolean) => {
      pending?.resolve(confirmed);
      setPending(null);
    },
    [pending],
  );

  const dialog = pending ? <ConfirmDialog options={pending} onSettle={settle} /> : null;
  return { confirm, dialog };
}

function ConfirmDialog({ options, onSettle }: { options: ConfirmOptions; onSettle: (confirmed: boolean) => void }) {
  const titleId = useId();
  const bodyId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const cancelRef = useRef<HTMLButtonElement | null>(null);
  const confirmRef = useRef<HTMLButtonElement | null>(null);
  const isDanger = options.tone === "danger";
  const startOnCancel = isDanger || options.focusCancel === true;
  const onSettleRef = useRef(onSettle);

  useEffect(() => {
    onSettleRef.current = onSettle;
  }, [onSettle]);

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    (startOnCancel ? cancelRef.current : confirmRef.current)?.focus();
    return () => {
      if (previous?.isConnected) {
        previous.focus();
      }
    };
  }, [startOnCancel]);

  useEffect(() => {
    // Window capture runs before the app's document-level Escape handlers, so
    // Escape cancels the dialog without also closing the menu or workspace
    // behind it.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      onSettleRef.current(false);
    };

    window.addEventListener("keydown", handleKeyDown, true);
    return () => window.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Tab") {
      return;
    }

    // Keep focus inside the dialog.
    const focusable = Array.from(panelRef.current?.querySelectorAll<HTMLElement>("button") ?? []);
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return createPortal(
    <div
      className="app-dialog-backdrop"
      data-keep-surfaces-open=""
      data-testid="confirm-dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onSettle(false);
        }
      }}
    >
      <div
        ref={panelRef}
        className="app-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={options.body ? bodyId : undefined}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId} className="app-dialog-title">
          {options.title}
        </h2>
        {options.body ? (
          <p id={bodyId} className="app-dialog-body">
            {options.body}
          </p>
        ) : null}
        <div className="app-dialog-actions">
          <button ref={cancelRef} type="button" className="ui-button" onClick={() => onSettle(false)}>
            {options.cancelLabel ?? "Cancel"}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`ui-button ${isDanger ? "app-dialog-danger" : "ui-button-primary"}`}
            onClick={() => onSettle(true)}
          >
            {options.confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    // Inside the app shell so it gets the app's type scale and button styles.
    document.querySelector("[data-testid=\"taskboard-shell\"], .taskboard-shell") ?? document.body,
  );
}
