"use client";
import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { useModalOutsideDismiss } from "@/components/use-modal-outside-dismiss";
import s from "./folio-features.module.css";
export function FeatureDialog({
  title,
  onClose,
  children,
  className,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useModalOutsideDismiss(ref, onClose);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    ref.current?.showModal();
    return () => {
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-label={title}
      className={`taskboard-shell ${s.surface} ${className ?? s.dialog}`}
      data-editor-scale="true"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <header>
        <h2 className="ed-title">{title}</h2>
        <button
          type="button"
          className="ui-button ed-button ed-icon-button"
          aria-label={`Close ${title}`}
          onClick={onClose}
        >
          <X aria-hidden="true" />
        </button>
      </header>
      {children}
    </dialog>
  );
}
