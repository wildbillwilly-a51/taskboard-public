"use client";

import { Archive, ArchiveRestore, Download, ListChecks, MoreHorizontal, RotateCcw, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";

// The note's "…" menu. Opening it focuses the first item; Arrow keys, Home
// and End move between items; Escape or Tab closes it and Escape returns
// focus to the button.
export function NoteActionsMenu({
  isTrashed,
  canEdit,
  canDeleteForever = canEdit,
  isArchived,
  onConvert,
  onArchive,
  onExport,
  onTrash,
  onRestore,
  onDeleteForever,
  onDetails,
  onOpen,
  isPhone = false,
}: {
  isTrashed: boolean;
  canEdit: boolean;
  canDeleteForever?: boolean;
  isArchived: boolean;
  onConvert: () => void;
  onArchive: () => void;
  onExport: () => void;
  onTrash: () => void;
  onRestore: () => void;
  onDeleteForever: () => void;
  onDetails?: () => void;
  onOpen?: () => void;
  // Desktop menu rows take Taskboard's shared menu classes; the phone keeps its own.
  isPhone?: boolean;
}) {
  const itemClass = isPhone ? "notes-menu-item" : "notes-menu-item ui-menu-item ed-menu-item";
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  const items = () =>
    Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("[role='menuitem']:not(:disabled)") ?? []);

  const close = (restoreFocus: boolean) => {
    setIsOpen(false);

    if (restoreFocus) {
      buttonRef.current?.focus();
    }
  };

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    items()[0]?.focus();

    const handlePointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointer);
    return () => document.removeEventListener("pointerdown", handlePointer);
  }, [isOpen]);

  const handleMenuKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        list[(index + 1) % list.length]?.focus();
        break;
      case "ArrowUp":
        event.preventDefault();
        list[(index - 1 + list.length) % list.length]?.focus();
        break;
      case "Home":
        event.preventDefault();
        list[0]?.focus();
        break;
      case "End":
        event.preventDefault();
        list[list.length - 1]?.focus();
        break;
      case "Escape":
        event.preventDefault();
        event.stopPropagation();
        close(true);
        break;
      case "Tab":
        close(false);
        break;
    }
  };

  const choose = (action: () => void) => {
    close(true);
    action();
  };

  return (
    <div className="notes-menu-root" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        className="notes-icon-button"
        aria-label="Note actions"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        onClick={() => { if (!isOpen) onOpen?.(); setIsOpen((current) => !current); }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" && !isOpen) {
            event.preventDefault();
            onOpen?.();
            setIsOpen(true);
          }
        }}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>
      {isOpen ? (
        <div
          ref={menuRef}
          className="notes-menu taskboard-popover"
          role="menu"
          aria-label="Note actions"
          onKeyDown={handleMenuKeyDown}
        >
          {onDetails ? <button type="button" role="menuitem" className={itemClass} onClick={() => choose(onDetails)}><SlidersHorizontal className="h-3.5 w-3.5" aria-hidden="true" />Note details</button> : null}
          {isTrashed ? (
            <>
              <button type="button" role="menuitem" className={itemClass} disabled={!canEdit} onClick={() => choose(onRestore)}>
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Restore
              </button>
              {canDeleteForever ? <button
                type="button"
                role="menuitem"
                className={`${itemClass} notes-menu-danger`}
                onClick={() => choose(onDeleteForever)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Delete forever
              </button> : null}
            </>
          ) : (
            <>
              <button type="button" role="menuitem" className={itemClass} disabled={!canEdit} onClick={() => choose(onConvert)}>
                <ListChecks className="h-3.5 w-3.5" aria-hidden="true" />
                Convert to task
              </button>
              <button type="button" role="menuitem" className={itemClass} disabled={!canEdit} onClick={() => choose(onArchive)}>
                {isArchived ? (
                  <ArchiveRestore className="h-3.5 w-3.5" aria-hidden="true" />
                ) : (
                  <Archive className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {isArchived ? "Unarchive" : "Archive"}
              </button>
              <button type="button" role="menuitem" className={itemClass} onClick={() => choose(onExport)}>
                <Download className="h-3.5 w-3.5" aria-hidden="true" />
                Export Markdown
              </button>
              <button
                type="button"
                role="menuitem"
                className={`${itemClass} notes-menu-danger`}
                disabled={!canEdit}
                onClick={() => choose(onTrash)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                Move to trash
              </button>
            </>
          )}
          {onDetails ? <button type="button" role="menuitem" className={itemClass} onClick={() => close(true)}><X className="h-3.5 w-3.5" aria-hidden="true" />Close</button> : null}
        </div>
      ) : null}
    </div>
  );
}
