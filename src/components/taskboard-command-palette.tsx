"use client";

import Link from "next/link";
import {
  Fragment,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Search, X } from "lucide-react";

import { rankPaletteItems, SHORTCUT_SHEET } from "@/lib/taskboard-shortcuts";

export type PaletteCommand = {
  id: string;
  label: string;
  group: string;
  keywords?: string;
  shortcut?: readonly string[];
  // Short right-aligned note, such as "Current".
  detail?: string;
  disabled?: boolean;
  run: () => void;
};

export type PaletteMode = {
  title: string;
  placeholder: string;
  commands: PaletteCommand[];
};

export function KeyHint({ keys }: { keys: readonly string[] }) {
  return (
    <span className="taskboard-key-hint flex shrink-0 items-center gap-0.5">
      {keys.map((key) => (
        <kbd key={key} className="taskboard-kbd">
          {key}
        </kbd>
      ))}
    </span>
  );
}

function OverlayFrame({
  children,
  label,
  onClose,
  testId,
}: {
  children: ReactNode;
  label: string;
  onClose: () => void;
  testId: string;
}) {
  // Give focus back to whatever had it, unless the command just moved focus
  // somewhere on purpose (for example into the search box).
  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;

    return () => {
      const current = document.activeElement;
      if ((!current || current === document.body) && previousFocus?.isConnected) {
        previousFocus.focus({ preventScroll: true });
      }
    };
  }, []);

  if (typeof document === "undefined") {
    return null;
  }

  return createPortal(
    <div className="taskboard-shell fixed inset-0 z-[90] flex items-start justify-center px-3 pt-[min(14vh,7rem)]">
      <button
        type="button"
        tabIndex={-1}
        onClick={onClose}
        className="absolute inset-0 bg-[rgba(20,16,12,0.5)]"
        aria-label={`Close ${label.toLowerCase()}`}
      />
      <div
        role="dialog"
        data-keep-surfaces-open=""
        aria-modal="true"
        aria-label={label}
        data-testid={testId}
        onKeyDown={(event) => {
          // Keep Tab inside the dialog while it is open.
          if (event.key !== "Tab") {
            return;
          }

          const focusable = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'input, button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])',
            ),
          );
          if (focusable.length === 0) {
            event.preventDefault();
            return;
          }

          const first = focusable[0];
          const last = focusable[focusable.length - 1];
          const active = document.activeElement;
          if (event.shiftKey && (active === first || !event.currentTarget.contains(active))) {
            event.preventDefault();
            last.focus();
          } else if (!event.shiftKey && (active === last || !event.currentTarget.contains(active))) {
            event.preventDefault();
            first.focus();
          }
        }}
        className="taskboard-overlay-panel taskboard-command-surface panel-surface panel-strong relative z-10 flex max-h-[min(70vh,34rem)] w-[min(36rem,100%)] min-h-0 flex-col overflow-hidden rounded-[14px] border shadow-2xl"
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}

export function CommandPalette({ mode, onClose }: { mode: PaletteMode; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const listId = useId();
  const results = useMemo(() => rankPaletteItems(mode.commands, query), [mode.commands, query]);
  const clampedIndex = Math.min(activeIndex, Math.max(results.length - 1, 0));
  const activeCommand = results[clampedIndex] ?? null;
  const optionId = (index: number) => `${listId}-option-${index}`;

  useEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-index="${clampedIndex}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [clampedIndex]);

  const runCommand = (command: PaletteCommand | null) => {
    if (!command || command.disabled) {
      return;
    }

    onClose();
    command.run();
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) {
      return;
    }

    const move = (next: number) => {
      event.preventDefault();
      if (results.length > 0) {
        setActiveIndex((next + results.length) % results.length);
      }
    };

    switch (event.key) {
      case "ArrowDown":
        move(clampedIndex + 1);
        return;
      case "ArrowUp":
        move(clampedIndex - 1);
        return;
      case "Home":
        move(0);
        return;
      case "End":
        move(results.length - 1);
        return;
      case "Enter":
        event.preventDefault();
        runCommand(activeCommand);
        return;
      case "Escape":
        // Close only the palette; the sidebar and workspace stay open.
        event.preventDefault();
        event.stopPropagation();
        onClose();
        return;
      case "k":
      case "K":
        if (event.ctrlKey || event.metaKey) {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
        return;
      default:
        return;
    }
  };

  return (
    <OverlayFrame label={mode.title} onClose={onClose} testId="command-palette">
      <div className="flex shrink-0 items-center gap-2 border-b border-border/70 px-3">
        <Search className="h-4 w-4 shrink-0 text-muted" aria-hidden="true" />
        <input
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={activeCommand ? optionId(clampedIndex) : undefined}
          aria-autocomplete="list"
          aria-label={mode.placeholder}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleKeyDown}
          placeholder={mode.placeholder}
          className="taskboard-command-input h-11 min-w-0 flex-1 bg-transparent text-[13px] font-medium text-foreground outline-none placeholder:text-muted"
          spellCheck={false}
          autoComplete="off"
        />
        <KeyHint keys={["Esc"]} />
      </div>

      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={mode.title}
        className="pretty-scrollbar min-h-0 flex-1 overflow-y-auto p-1.5"
      >
        {results.length === 0 ? (
          <p className="px-2 py-6 text-center text-[11px] text-muted">
            Nothing matches &ldquo;{query.trim()}&rdquo;.
          </p>
        ) : (
          results.map((command, index) => {
            const showGroup = index === 0 || results[index - 1].group !== command.group;
            const isActive = index === clampedIndex;

            return (
              <Fragment key={command.id}>
                {showGroup ? (
                  <div role="presentation" className="taskboard-command-group px-2 pb-1 pt-2 first:pt-1">
                    {command.group}
                  </div>
                ) : null}
                <div
                  id={optionId(index)}
                  role="option"
                  aria-selected={isActive}
                  aria-disabled={command.disabled || undefined}
                  data-index={index}
                  data-active={isActive ? "true" : undefined}
                  data-command-id={command.id}
                  onMouseMove={() => {
                    if (!isActive) {
                      setActiveIndex(index);
                    }
                  }}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => runCommand(command)}
                  className={`taskboard-command-option flex min-h-8 cursor-pointer items-center justify-between gap-3 rounded-[8px] px-2 py-1.5 text-[12px] font-medium leading-4 ${
                    command.disabled ? "cursor-not-allowed opacity-45" : "text-foreground"
                  }`}
                >
                  <span className="min-w-0 truncate">{command.label}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {command.detail ? (
                      <span className="text-[10px] font-semibold text-muted">{command.detail}</span>
                    ) : null}
                    {command.shortcut ? <KeyHint keys={command.shortcut} /> : null}
                  </span>
                </div>
              </Fragment>
            );
          })
        )}
      </div>

      <div className="taskboard-command-footer flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-border/70 px-3 py-1.5 text-[10px] text-muted">
        <span className="flex items-center gap-1">
          <KeyHint keys={["↑", "↓"]} /> move
        </span>
        <span className="flex items-center gap-1">
          <KeyHint keys={["Enter"]} /> run
        </span>
        <span className="flex items-center gap-1">
          <KeyHint keys={["?"]} /> all shortcuts
        </span>
      </div>
    </OverlayFrame>
  );
}

export function ShortcutSheet({
  onClose,
  optionsHref,
  singleKeysEnabled,
}: {
  onClose: () => void;
  optionsHref: string;
  singleKeysEnabled: boolean;
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);

  // Focus the sheet itself so Escape and ? work at once, without putting a
  // focus ring on the close button.
  useEffect(() => {
    bodyRef.current?.focus({ preventScroll: true });
  }, []);

  return (
    <OverlayFrame label="Keyboard shortcuts" onClose={onClose} testId="shortcut-sheet">
      <div
        ref={bodyRef}
        tabIndex={-1}
        className="pretty-scrollbar grid min-h-0 gap-3 overflow-y-auto p-4 outline-none"
        onKeyDown={(event) => {
          if (event.key === "Escape" || event.key === "?") {
            event.preventDefault();
            event.stopPropagation();
            onClose();
          }
        }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="grid gap-1">
            <h2 className="text-[1rem] font-semibold text-foreground">Keyboard shortcuts</h2>
            <p className="text-[11px] leading-4 text-muted">
              {singleKeysEnabled
                ? "Single keys work when you are not typing in a field."
                : "Single-key shortcuts are off. Ctrl+K still opens the command palette."}{" "}
              <Link href={optionsHref} className="font-semibold text-foreground underline underline-offset-2">
                Change in Options
              </Link>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full p-1 text-muted transition hover:bg-foreground/8 hover:text-foreground"
            aria-label="Close keyboard shortcuts"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {SHORTCUT_SHEET.map((group) => (
            <section key={group.title} className="grid content-start gap-1.5">
              <h3 className="taskboard-command-group">{group.title}</h3>
              <dl className="grid gap-1">
                {group.items.map((item) => (
                  <div key={item.label} className="flex items-center justify-between gap-2 text-[11px] leading-4">
                    <dt className="text-foreground">{item.label}</dt>
                    <dd>
                      <KeyHint keys={item.keys} />
                    </dd>
                  </div>
                ))}
              </dl>
            </section>
          ))}
        </div>
      </div>
    </OverlayFrame>
  );
}
