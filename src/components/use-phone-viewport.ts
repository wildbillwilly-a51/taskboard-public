"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { isPhoneKeyboardOpen, PHONE_MEDIA_QUERY } from "@/lib/phone-layout";

export function usePhoneViewport() {
  const [viewport, setViewport] = useState({ isPhone: false, keyboardOpen: false, height: 0, top: 0 });

  useEffect(() => {
    const media = window.matchMedia(PHONE_MEDIA_QUERY);
    let baseline = window.innerHeight;
    let width = document.documentElement.clientWidth;
    let frame = 0;
    let focusTimer = 0;
    const update = () => {
      const visible = window.visualViewport;
      const height = visible?.height ?? window.innerHeight;
      const scale = visible?.scale ?? 1;
      const focused = document.activeElement;
      const editableFocused = focused instanceof HTMLElement && (
        focused.isContentEditable ||
        focused instanceof HTMLTextAreaElement && !focused.readOnly && !focused.disabled ||
        focused instanceof HTMLInputElement && !focused.readOnly && !focused.disabled &&
          !["button", "checkbox", "radio", "range", "file", "submit"].includes(focused.type)
      );
      if (Math.abs(document.documentElement.clientWidth - width) > 80) {
        width = document.documentElement.clientWidth;
        baseline = window.innerHeight;
      }
      baseline = Math.max(baseline, height * scale);
      const keyboardOpen = media.matches && isPhoneKeyboardOpen({ baselineHeight: baseline, visibleHeight: height, scale, editableFocused });
      const next = { isPhone: media.matches, keyboardOpen, height: Math.round(height), top: Math.round(visible?.offsetTop ?? 0) };
      setViewport(current => Object.keys(next).every(key => current[key as keyof typeof current] === next[key as keyof typeof next]) ? current : next);
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(update);
    };
    const onFocus = () => {
      schedule();
      window.clearTimeout(focusTimer);
      focusTimer = window.setTimeout(schedule, 350);
    };
    update();
    media.addEventListener("change", schedule);
    window.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", onFocus);
    return () => {
      cancelAnimationFrame(frame);
      window.clearTimeout(focusTimer);
      media.removeEventListener("change", schedule);
      window.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("resize", schedule);
      window.visualViewport?.removeEventListener("scroll", schedule);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", onFocus);
    };
  }, []);

  return {
    ...viewport,
    style: {
      ...(viewport.height ? { "--phone-height": `${viewport.height}px` } : {}),
      "--phone-top": `${viewport.top}px`,
    } as CSSProperties,
  };
}
