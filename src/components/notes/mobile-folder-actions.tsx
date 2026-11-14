"use client";

import { FolderPlus, MoreHorizontal, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function MobileFolderActions({ onRename, onCreate, onDelete }: { onRename: () => void; onCreate: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = () => { setOpen(false); trigger.current?.focus(); };
  useEffect(() => {
    if (!open) return;
    root.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  return <div ref={root} className="notes-menu-root">
    <button ref={trigger} type="button" className="notes-icon-button" aria-label="Folder actions" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen(value => !value)}><MoreHorizontal aria-hidden="true" /></button>
    {open ? <div className="notes-menu taskboard-popover" role="menu" aria-label="Folder actions" onKeyDown={event => {
      const items = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'));
      const index = items.indexOf(document.activeElement as HTMLButtonElement);
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      if (event.key === "Tab") setOpen(false);
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        items[event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 : (index + (event.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
      }
    }}>
      <button type="button" role="menuitem" className="notes-menu-item" onClick={() => { close(); onRename(); }}><Pencil aria-hidden="true" />Rename notebook</button>
      <button type="button" role="menuitem" className="notes-menu-item" onClick={() => { close(); onCreate(); }}><FolderPlus aria-hidden="true" />New notebook inside this one</button>
      <button type="button" role="menuitem" className="notes-menu-item notes-menu-danger" onClick={() => { close(); onDelete(); }}><Trash2 aria-hidden="true" />Delete notebook</button>
      <button type="button" role="menuitem" className="notes-menu-item" onClick={close}><X aria-hidden="true" />Close</button>
    </div> : null}
  </div>;
}
