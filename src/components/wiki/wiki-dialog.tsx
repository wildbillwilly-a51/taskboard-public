"use client";
import { WikiButton } from "./wiki-controls";
import "@/app/wiki/wiki.css";
import { useEffect, useRef, type ReactNode } from "react";

let locks = 0, originalOverflow = "";
export function WikiDialog({ title, onClose, children, drawer = false, alert = false }: { title: string; onClose: () => void; children: ReactNode; drawer?: boolean; alert?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    if (locks++ === 0) originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const element = ref.current;
    element?.showModal();
    return () => { element?.close(); if (--locks === 0) document.body.style.overflow = originalOverflow; queueMicrotask(() => { if (previous?.isConnected) previous.focus(); }); };
  }, []);
  return <dialog ref={ref} role={alert ? "alertdialog" : undefined} className={drawer ? "wiki-dialog wiki-drawer" : "wiki-dialog"} aria-label={title} onKeyDown={event => {
    if (event.key !== "Tab") return;
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('a[href],button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')).filter(item => item.getClientRects().length > 0 && item.closest("dialog") === event.currentTarget);
    const first = items[0], last = items.at(-1);
    if (!first) { event.preventDefault(); event.currentTarget.focus(); }
    else if (event.shiftKey && (document.activeElement === first || document.activeElement === event.currentTarget)) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }} onCancel={event => { event.preventDefault(); event.stopPropagation(); if (event.target === event.currentTarget) onClose(); }} onClick={event => { if (event.target === event.currentTarget) { const box = event.currentTarget.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose(); } }}><div className="wiki-heading"><h2>{title}</h2><WikiButton onClick={onClose} aria-label={`Close ${title}`}>Close</WikiButton></div>{children}</dialog>;
}
