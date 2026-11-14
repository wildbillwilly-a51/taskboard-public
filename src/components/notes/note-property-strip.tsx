"use client";

import { Folder, Plus, X } from "lucide-react";
import Link from "next/link";
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  type RefObject,
} from "react";

import type { NoteLinkedTask } from "@/lib/notes-model";
import { notesBucketStyle, type NotesBucketContext } from "@/lib/notes-bucket-context";
import { NoteContextMark } from "./note-context-mark";

// Desktop note properties on one line: where the note lives, its labels or
// tags, and its linked tasks. Adding a label or linking a task opens the
// existing control in a small popup; the phone keeps its Note details sheet.

type CloseReason = "escape" | "outside" | "done";

export function NotePropertyStrip({
  home,
  homeContext,
  labelNoun,
  labels,
  canEdit,
  onRemoveLabel,
  labelInput,
  onLabelPopupClose,
  linkedTasks,
  onUnlink,
  renderPicker,
}: {
  // The Home select, labelled "Home".
  home: ReactNode;
  homeContext?: NotesBucketContext;
  labelNoun: "label" | "tag";
  labels: string[];
  canEdit: boolean;
  onRemoveLabel: (label: string) => void;
  // The label input and its suggestions.
  labelInput: ReactNode;
  // Closing the label popup keeps what was typed, like the task editor's field.
  onLabelPopupClose: () => void;
  linkedTasks: NoteLinkedTask[];
  onUnlink: (taskId: string) => void;
  // The task picker; call done() after a pick. Null when linking isn't possible.
  renderPicker: ((done: () => void) => ReactNode) | null;
}) {
  const stripRef = useRef<HTMLDivElement | null>(null);
  const showLabels = labels.length > 0 || canEdit;
  const showLinks = linkedTasks.length > 0 || (canEdit && renderPicker !== null);
  const addLabelName = labelNoun === "label" ? "Add label" : "Add tag";

  return (
    <div ref={stripRef} className="notes-property-strip" role="group" aria-label="Note properties">
      <span className="notes-strip-home" data-notes-context={homeContext ? "bucket" : undefined} style={notesBucketStyle(homeContext)}>
        {homeContext ? <NoteContextMark context={homeContext} /> : <Folder aria-hidden="true" />}
        {home}
      </span>

      {showLabels ? (
        <div className="notes-strip-group" role="group" aria-label={labelNoun === "label" ? "Labels" : "Tags"}>
          {labels.map((label) => (
            <span key={label} className="notes-chip taskboard-label-chip ed-chip">
              <span className="notes-chip-text" title={label}>{label}</span>
              {canEdit ? (
                <button type="button" className="taskboard-label-chip-remove" aria-label={`Remove ${label}`} onClick={() => onRemoveLabel(label)}>
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              ) : null}
            </span>
          ))}
          {canEdit ? (
            <StripPopup stripRef={stripRef} label={labelNoun === "label" ? "Label" : "Tag"} title={addLabelName}
              onClose={onLabelPopupClose}>
              {() => labelInput}
            </StripPopup>
          ) : null}
        </div>
      ) : null}

      {showLinks ? (
        <div className="notes-strip-group" role="group" aria-label="Linked tasks">
          {linkedTasks.map((task) => (
            <span key={task.id} className="notes-chip notes-task-chip taskboard-label-chip ed-chip" data-status={task.status}>
              <Link
                href={`/?boardId=${encodeURIComponent(task.boardId)}&taskId=${encodeURIComponent(task.id)}`}
                title={`${task.boardTitle}${task.bucketTitle ? ` · ${task.bucketTitle}` : ""}`}
              >
                {task.title}
              </Link>
              {canEdit ? (
                <button type="button" className="taskboard-label-chip-remove" aria-label={`Unlink ${task.title}`} onClick={() => onUnlink(task.id)}>
                  <X className="h-3 w-3" aria-hidden="true" />
                </button>
              ) : null}
            </span>
          ))}
          {canEdit && renderPicker ? (
            <StripPopup stripRef={stripRef} label="Link task" title="Link a task" wide>
              {renderPicker}
            </StripPopup>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

// A "+ Name" button with a popup under it. The popup is placed against the
// strip so it never runs past the editor's edge; it closes on Escape (focus
// returns to the button), on a press outside (focus stays where it went) and
// when its content says it is done.
function StripPopup({
  stripRef,
  label,
  title,
  wide = false,
  onClose,
  children,
}: {
  stripRef: RefObject<HTMLDivElement | null>;
  label: string;
  title: string;
  wide?: boolean;
  onClose?: (reason: CloseReason) => void;
  children: (done: () => void) => ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [left, setLeft] = useState(0);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popupRef = useRef<HTMLDivElement | null>(null);
  const buttonId = useId();

  const close = useCallback((reason: CloseReason) => {
    onClose?.(reason);
    setIsOpen(false);
    if (reason !== "outside") {
      document.getElementById(buttonId)?.focus();
    }
  }, [onClose, buttonId]);
  const done = useCallback(() => close("done"), [close]);

  useLayoutEffect(() => {
    if (!isOpen) {
      return;
    }

    // Under the button, but never past the strip's right edge, also when the
    // strip narrows while the popup is open.
    const place = () => {
      const strip = stripRef.current?.getBoundingClientRect();
      const button = buttonRef.current?.getBoundingClientRect();
      const popupBox = popupRef.current?.getBoundingClientRect();

      if (strip && button && popupBox) {
        const maxLeft = Math.max(0, strip.width - popupBox.width);
        setLeft(Math.min(Math.max(0, button.left - strip.left), maxLeft));
      }
    };
    place();

    // Typing starts in the popup's text field (the task search, not its board choice).
    const popup = popupRef.current;
    (popup?.querySelector<HTMLElement>("input") ?? popup?.querySelector<HTMLElement>("select, button"))?.focus();

    const observer = new ResizeObserver(place);
    if (stripRef.current) {
      observer.observe(stripRef.current);
    }
    return () => observer.disconnect();
  }, [isOpen, stripRef]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointer = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!popupRef.current?.contains(target) && !buttonRef.current?.contains(target)) {
        close("outside");
      }
    };

    document.addEventListener("pointerdown", handlePointer);
    return () => document.removeEventListener("pointerdown", handlePointer);
  }, [isOpen, close]);

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      event.stopPropagation();
      close("escape");
    }
  };

  return (
    <>
      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        className="notes-strip-add"
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        title={title}
        onClick={() => (isOpen ? close("escape") : setIsOpen(true))}
        // Shift+Tab from the popup lands here; Escape still closes it.
        onKeyDown={(event) => {
          if (event.key === "Escape" && isOpen) {
            event.preventDefault();
            close("escape");
          }
        }}
      >
        <Plus className="h-3 w-3" aria-hidden="true" />
        {label}
      </button>
      {isOpen ? (
        <div
          ref={popupRef}
          className={`notes-strip-popup taskboard-popover${wide ? " notes-strip-popup-wide" : ""}`}
          role="dialog"
          aria-label={title}
          style={{ left }}
          onKeyDown={handleKeyDown}
          onBlur={(event) => {
            const next = event.relatedTarget as Node | null;
            if (next && !popupRef.current?.contains(next) && next !== buttonRef.current) {
              close("outside");
            }
          }}
        >
          {children(done)}
        </div>
      ) : null}
    </>
  );
}
