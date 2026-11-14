"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { featureRequest } from "@/lib/folio-feature-client";
import { fixedPopoverPosition } from "@/components/ui/context-menu";
import s from "./folio-features.module.css";
export function FolioLinkPreview({
  noteId,
  children,
}: {
  noteId: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false),
    [value, setValue] = useState<{
      title: string;
      snippet: string;
      updatedAt: string;
    } | null>(null),
    [point, setPoint] = useState({ x: 0, y: 0 }),
    ref = useRef<HTMLSpanElement>(null),
    preview = useRef<HTMLDivElement>(null),
    closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelClose = useCallback(() => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = null;
  }, []);
  useEffect(() => cancelClose, [cancelClose]);
  useLayoutEffect(() => {
    const node = preview.current;
    if (!open || !value || !node) return;
    const place = () => {
      const anchor = ref.current?.getBoundingClientRect();
      if (!anchor) return;
      const next = fixedPopoverPosition(node, { x: anchor.left, y: anchor.bottom + 6 });
      setPoint(current => current.x === next.left && current.y === next.top ? current : { x: next.left, y: next.top });
    };
    place();
    const observer = new ResizeObserver(place);
    observer.observe(node);
    window.addEventListener("resize", place);
    return () => { observer.disconnect(); window.removeEventListener("resize", place); };
  }, [open, value]);
  const contains = (target: EventTarget | null) => target instanceof Node &&
    (ref.current?.contains(target) || preview.current?.contains(target));
  const close = (restoreFocus = false) => {
    cancelClose();
    if (restoreFocus && preview.current?.contains(document.activeElement))
      ref.current?.querySelector<HTMLElement>("button, a")?.focus({ preventScroll: true });
    setOpen(false);
  };
  const leave = (target: EventTarget | null) => {
    cancelClose();
    if (!contains(target)) closeTimer.current = setTimeout(() => setOpen(false), 250);
  };
  useEffect(() => {
    if (!open) return;
    const outside = (e: PointerEvent) => {
      if (!(e.target instanceof Node) || !ref.current?.contains(e.target) && !preview.current?.contains(e.target)) {
        cancelClose();
        setOpen(false);
      }
    };
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      e.stopPropagation();
      cancelClose();
      if (preview.current?.contains(document.activeElement))
        ref.current?.querySelector<HTMLElement>("button, a")?.focus({ preventScroll: true });
      setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape);
    };
  }, [open, cancelClose]);
  useEffect(() => {
    if (!open) return;
    const c = new AbortController(),
      t = setTimeout(
        () =>
          void featureRequest<{
            title: string;
            snippet: string;
            updatedAt: string;
          }>(
            `/api/folio/discovery?action=preview&noteId=${noteId}`,
            undefined,
            c.signal,
          )
            .then(setValue)
            .catch(() => {}),
        180,
      );
    return () => {
      clearTimeout(t);
      c.abort();
    };
  }, [open, noteId]);
  const show = () => {
    cancelClose();
    if (open) return;
    setValue(null);
    const r = ref.current?.getBoundingClientRect();
    if (r)
      setPoint({
        x: Math.max(8, Math.min(r.left, window.innerWidth - 350)),
        y: Math.max(8, Math.min(r.bottom + 6, window.innerHeight - 200)),
      });
    setOpen(true);
  };
  return (
    <span
      ref={ref}
      onMouseEnter={show}
      onMouseLeave={(e) => leave(e.relatedTarget)}
      onFocus={(e) => { if (e.currentTarget.contains(e.target) && !contains(e.relatedTarget)) show(); }}
      onBlur={(e) => {
        if (!contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => {
        const lastTrigger = ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], [tabindex]:not([tabindex="-1"])');
        const atEnd = lastTrigger ? lastTrigger[lastTrigger.length - 1] === document.activeElement : false;
        if (open && preview.current && e.target instanceof Node && ref.current?.contains(e.target) &&
          (e.key === "ArrowDown" || e.key === "Tab" && !e.shiftKey && atEnd)) {
          e.preventDefault();
          preview.current.querySelector<HTMLButtonElement>("button")?.focus();
        }
      }}
    >
      {children}
      {open && value
        ? createPortal(
            <div
              ref={preview}
              role="dialog"
              aria-label="Note preview"
              className={`taskboard-shell ${s.surface} ${s.popover}`}
              data-editor-scale="true"
              style={{ left: point.x, top: point.y }}
              onMouseEnter={cancelClose}
              onMouseLeave={(e) => leave(e.relatedTarget)}
            >
              <header><strong>{value.title}</strong><button type="button" className="ui-button ed-button ed-icon-button" aria-label="Close note preview" onClick={() => close(true)}><X aria-hidden="true" /></button></header>
              <span className={s.linkSnippet}>
                {value.snippet}
              </span>
              <small>
                Last edited {new Date(value.updatedAt).toLocaleDateString()}
              </small>
            </div>,
            document.querySelector('[data-testid="folio-workspace"]')?.closest(".notes-frame") ?? document.body,
          )
        : null}
    </span>
  );
}
