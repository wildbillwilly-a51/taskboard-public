"use client";

import { useEffect, useRef, type RefObject } from "react";

// Inline pickers have no native dialog backdrop. Consume an outside gesture
// before an enclosing workspace sees it, and leave native modal children alone.
export function usePopoverOutsideDismiss(
  ref: RefObject<HTMLElement | null>,
  anchor: RefObject<HTMLElement | null>,
  close: () => void,
  enabled: boolean,
) {
  const latest = useRef(close);
  useEffect(() => { latest.current = close; }, [close]);
  useEffect(() => {
    if (!enabled) return;
    const outside = (event: MouseEvent) => {
      const surface = ref.current;
      const target = event.target;
      return surface && target instanceof Node && !document.querySelector("dialog:modal") &&
        !surface.contains(target) && !anchor.current?.contains(target);
    };
    const pointerDown = (event: PointerEvent) => { if (outside(event)) event.stopPropagation(); };
    const click = (event: MouseEvent) => {
      if (!outside(event)) return;
      event.stopPropagation(); event.preventDefault(); latest.current();
    };
    document.addEventListener("pointerdown", pointerDown, true);
    document.addEventListener("click", click, true);
    return () => { document.removeEventListener("pointerdown", pointerDown, true); document.removeEventListener("click", click, true); };
  }, [enabled, ref, anchor]);
}

// Capture outside gestures before the workspace's dismissal listener. Native
// dialog backdrops do not receive clicks in a reserved scrollbar gutter.
export function useModalOutsideDismiss(ref: RefObject<HTMLDialogElement | null>, close: () => void, enabled = true) {
  const latest = useRef(close);
  useEffect(() => { latest.current = close; }, [close]);
  useEffect(() => {
    if (!enabled) return;
    const outside = (event: MouseEvent) => {
      const element = ref.current;
      if (!element?.matches(":modal")) return false;
      const activeDialog = document.activeElement?.closest("dialog:modal");
      if (activeDialog && activeDialog !== element) return false;
      const target = event.target;
      const rect = element.getBoundingClientRect();
      return !(target instanceof Node && element.contains(target)) || target === element &&
        (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom);
    };
    const pointerDown = (event: PointerEvent) => { if (outside(event)) event.stopPropagation(); };
    const click = (event: MouseEvent) => {
      if (!outside(event)) return;
      event.stopPropagation(); event.preventDefault(); latest.current();
    };
    document.addEventListener("pointerdown", pointerDown, true);
    document.addEventListener("click", click, true);
    return () => { document.removeEventListener("pointerdown", pointerDown, true); document.removeEventListener("click", click, true); };
  }, [enabled, ref]);
}
