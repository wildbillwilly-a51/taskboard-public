"use client";
import { useLayoutEffect, useRef } from "react";
import { useUiSettings } from "@/components/settings-provider";
export function WikiTitle({ value, disabled, onChange }: { value: string; disabled: boolean; onChange: (value: string) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const { settings } = useUiSettings();
  useLayoutEffect(() => {
    const input = ref.current;
    if (!input) return;
    const size = () => { input.style.height = "auto"; input.style.height = `${input.scrollHeight}px`; };
    size();
    let width = input.parentElement?.clientWidth;
    const observer = new ResizeObserver(() => { const next = input.parentElement?.clientWidth; if (next !== width) { width = next; size(); } });
    if (input.parentElement) observer.observe(input.parentElement);
    return () => observer.disconnect();
  }, [value, settings.fontScale]);
  return <><h1 className="wiki-sr-only">{value || "Untitled page"}</h1><textarea ref={ref} rows={1} className="wiki-inline-title task-note-title" aria-label="Page title" placeholder="Untitled page" value={value} disabled={disabled} maxLength={300} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) event.preventDefault(); }} onChange={event => onChange(event.target.value.replace(/\r?\n/g, " "))} /></>;
}
