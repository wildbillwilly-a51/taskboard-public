"use client";

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

export type ContextMenuAction = {
  /** Stable key; defaults to the label. */
  id?: string;
  label: string;
  icon?: ReactNode;
  run: (trigger: HTMLElement) => void;
  disabled?: boolean;
  /** Shown as the item's tooltip while it is disabled. */
  disabledReason?: string;
  danger?: boolean;
  separator?: boolean;
  /** Defined for one choice of a group (status): a radio item, checked or not. */
  checked?: boolean;
  /**
   * "restore" (default) returns focus to the item that opened the menu before
   * the action runs. "handoff" first establishes that same stable origin,
   * then lets the destination own focus without any later restoration.
   */
  focus?: "restore" | "handoff";
};

export type ContextMenuAnchor = { x: number; y: number; trigger: HTMLElement };

export type ContextMenuClassNames = {
  menu: string;
  heading: string;
  item: string;
  danger: string;
  separated: string;
};

const DEFAULT_CLASS_NAMES: ContextMenuClassNames = {
  menu: "context-menu",
  heading: "context-menu-heading",
  item: "context-menu-item",
  danger: "context-menu-danger",
  separated: "context-menu-separated",
};

/** Convert a viewport anchor to a fixed popover's actual CSS containing block. */
export function fixedPopoverPosition(menu: HTMLElement, anchor: { x: number; y: number }) {
  const bounds = menu.getBoundingClientRect();
  const viewport = window.visualViewport;
  const root = document.documentElement.getBoundingClientRect();
  const left = Math.max(viewport?.offsetLeft ?? 0, root.left), top = viewport?.offsetTop ?? 0;
  const right = Math.min((viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth), root.right);
  const originX = bounds.left - Number.parseFloat(menu.style.left || "0");
  const originY = bounds.top - Number.parseFloat(menu.style.top || "0");
  return {
    left: Math.max(left + 8, Math.min(anchor.x, right - bounds.width - 8)) - originX,
    top: Math.max(top + 8, Math.min(anchor.y, top + (viewport?.height ?? window.innerHeight) - bounds.height - 8)) - originY,
  };
}

// The app's right-click menu, opened at the pointer or under a focused item.
// Surfaces decide when to open it (see src/lib/context-menu-request.ts); text
// fields, rich editors and links keep the browser's own menu.
export function ContextMenu({ anchor, label, actions, onClose, classNames = DEFAULT_CLASS_NAMES, portalTarget, id, showCloseButton = false }: {
  anchor: ContextMenuAnchor;
  label: string;
  actions: ContextMenuAction[];
  onClose: (restoreFocus: boolean) => void;
  classNames?: ContextMenuClassNames;
  /** A native dialog owns its top-layer menus; other callers keep their existing portal. */
  portalTarget?: HTMLElement | null;
  id?: string;
  /** Opt in without changing unrelated menus. */
  showCloseButton?: boolean;
}) {
  const menuRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const [position, setPosition] = useState({ left: anchor.x, top: anchor.y });
  useLayoutEffect(() => { closeRef.current = onClose; });

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu) return;
    const place = () => {
      // Stable both-edge scrollbar gutters shift the fixed containing block.
      // Pointer/trigger coordinates are viewport coordinates; convert the
      // clamped result back into the menu's actual CSS coordinate space.
      const next = fixedPopoverPosition(menu, anchor);
      setPosition(current => current.left === next.left && current.top === next.top ? current : next);
    };
    place();
    // Fonts, text preferences and newly available actions can change the menu
    // after opening. Keep it in the viewport as its actual dimensions change.
    const observer = new ResizeObserver(place);
    observer.observe(menu);
    menu.querySelector<HTMLButtonElement>('[role^="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
    return () => observer.disconnect();
  }, [anchor]);

  useEffect(() => {
    const triggerRect = anchor.trigger.getBoundingClientRect();
    const pointer = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node) && !anchor.trigger.contains(event.target as Node)) closeRef.current(false);
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        closeRef.current(true);
      }
    };
    const scroll = (event: Event) => {
      if (menuRef.current?.contains(event.target as Node)) return;
      const current = anchor.trigger.getBoundingClientRect();
      // A queued scroll event from bringing the row into view must not close
      // a menu that opened afterwards. Close when its anchor actually moves.
      if (!anchor.trigger.isConnected || Math.abs(current.top - triggerRect.top) > 0.5 || Math.abs(current.left - triggerRect.left) > 0.5) {
        closeRef.current(false);
      }
    };
    const resize = () => closeRef.current(true);
    document.addEventListener("pointerdown", pointer, true);
    window.addEventListener("keydown", key, true);
    window.addEventListener("scroll", scroll, true);
    window.addEventListener("resize", resize);
    return () => {
      document.removeEventListener("pointerdown", pointer, true);
      window.removeEventListener("keydown", key, true);
      window.removeEventListener("scroll", scroll, true);
      window.removeEventListener("resize", resize);
    };
  }, [anchor.trigger]);

  return createPortal(<div id={id} ref={menuRef} role="menu" aria-label={label}
    className={`${classNames.menu} taskboard-popover`} style={{ ...position, position: "fixed" }}
    data-editor-scale="true" data-keep-surfaces-open=""
    onContextMenu={event => event.preventDefault()}
    onKeyDown={event => {
      const items = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>("button:not(:disabled)") ?? []);
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "Tab") { onClose(true); return; }
      const next = event.key === "ArrowDown" ? (index + 1) % items.length
        : event.key === "ArrowUp" ? (index - 1 + items.length) % items.length
          : event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : null;
      if (next !== null) { event.preventDefault(); event.stopPropagation(); items[next]?.focus(); }
    }}>
    <div className={classNames.heading} style={showCloseButton ? { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 } : undefined}>
      {label}
      {showCloseButton ? <button type="button" className="ui-button ed-button ed-icon-button" aria-label={`Close ${label}`} onClick={() => onClose(true)}><X aria-hidden="true" /></button> : null}
    </div>
    {actions.map(action => <button key={action.id ?? action.label} type="button"
      role={action.checked === undefined ? "menuitem" : "menuitemradio"}
      aria-checked={action.checked === undefined ? undefined : action.checked}
      disabled={action.disabled} title={action.disabled ? action.disabledReason : undefined}
      className={`${classNames.item} ${action.danger ? classNames.danger : ""} ${action.separator ? classNames.separated : ""}`}
      onClick={() => {
        // A removed menu item cannot be a dialog's return-focus target. Do
        // this before running the action; never restore after its new UI opens.
        if (action.focus === "handoff" && anchor.trigger.isConnected) anchor.trigger.focus({ preventScroll: true });
        onClose(action.focus !== "handoff");
        action.run(anchor.trigger);
      }}>{action.icon}{action.label}</button>)}
  </div>, portalTarget ?? document.querySelector('[data-testid="taskboard-shell"]') ?? document.body);
}
