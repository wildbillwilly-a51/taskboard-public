import {
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { ChevronDown, X, type LucideIcon } from "lucide-react";
import {
  CHIP_BUTTON_ACTIVE_CLASS,
  CHIP_BUTTON_CLASS,
  COMPACT_MENU_ITEM_CLASS,
  SMALL_CHIP_BUTTON_CLASS,
  TASK_EDITOR_ITEM_TEXT_CLASS,
  TASK_EDITOR_SELECT_CLASS,
  taskIcons,
  themeOptions,
} from "@/components/taskboard-constants";
import type { Task, TaskIcon } from "@/lib/taskboard-data";
import type { ThemePreference } from "@/lib/ui-settings";

export function useDismissibleSurface({
  isOpen,
  onClose,
  refs,
  closeOnEscape = true,
}: {
  isOpen: boolean;
  onClose: () => void;
  refs: Array<RefObject<HTMLElement | null>>;
  // A large surface with its own layered Escape handling (the task workspace)
  // opts out, so fields and menus inside it get Escape first.
  closeOnEscape?: boolean;
}) {
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;

      if (!(target instanceof Node)) {
        return;
      }

      // Notifications such as the Undo toast sit outside every panel but
      // act on what is open, so clicking them leaves panels open.
      if (target instanceof Element && target.closest("[data-keep-surfaces-open]")) {
        return;
      }

      for (const ref of refs) {
        if (ref.current?.contains(target)) {
          return;
        }
      }

      onClose();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (!closeOnEscape || event.key !== "Escape" || event.defaultPrevented) {
        return;
      }

      // Marking Escape as handled lets panel-level handlers leave the panel open.
      event.preventDefault();
      onClose();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    // Capture phase so an open menu or popover handles Escape before the panel does.
    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown, true);
    };
  }, [closeOnEscape, isOpen, onClose, refs]);
}

export function SurfaceCloseButton({
  onClick,
  label = "Close",
  className = "",
}: {
  onClick: () => void;
  label?: string;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className={`taskboard-surface-close ui-button ui-button-surface inline-flex h-7 w-7 items-center justify-center rounded-full border border-border/70 text-muted transition hover:text-foreground ${className}`.trim()}
    >
      <X className="h-3.5 w-3.5" />
    </button>
  );
}

export function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="taskboard-section-card rounded-[10px] border border-border/70 p-2">
      <h3 className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted">
        {title}
      </h3>
      {children}
    </section>
  );
}

export function ColorSwatchDropdown({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedOption =
    options.find((option) => option.value === value) ?? options[0];
  useDismissibleSurface({
    isOpen,
    onClose: () => setIsOpen(false),
    refs: [rootRef],
  });

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className={`${TASK_EDITOR_SELECT_CLASS} flex items-center justify-between gap-2`}
        aria-label={`Selected color ${selectedOption.label}`}
      >
        <span className="flex items-center gap-2">
          <span
            className="h-3.5 w-3.5 rounded-full border border-black/10"
            style={{ backgroundColor: selectedOption.value }}
          />
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" />
      </button>

      {isOpen ? (
        <div className="taskboard-popover absolute left-0 top-9 z-[90] w-[92px] rounded-[9px] border border-border/70 p-1">
          <div className="grid grid-cols-3 gap-1">
            {options.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={`flex h-6 w-6 items-center justify-center rounded-full border transition ${
                  value === option.value
                    ? "scale-110 border-foreground"
                    : "taskboard-swatch-border"
                }`}
                style={{ backgroundColor: option.value }}
                aria-label={`Set task color to ${option.label}`}
                title={option.label}
              />
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function IconDropdown({
  value,
  onChange,
  options,
}: {
  value: TaskIcon;
  onChange: (value: TaskIcon) => void;
  options: ReadonlyArray<{ value: TaskIcon; label: string }>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = options.find((option) => option.value === value) ?? options[0];
  const SelectedIcon = taskIcons[selectedOption.value];
  useDismissibleSurface({
    isOpen,
    onClose: () => setIsOpen(false),
    refs: [rootRef],
  });

  return (
    <div ref={rootRef} className="taskboard-icon-dropdown relative">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className={`${TASK_EDITOR_SELECT_CLASS} flex items-center justify-between gap-2`}
        aria-label={`Selected icon ${selectedOption.label}`}
      >
        <span className="flex items-center gap-2">
          <span className="taskboard-icon-surface taskboard-icon-dropdown-preview flex h-4 w-4 items-center justify-center rounded-[6px]">
            <SelectedIcon className="h-3.5 w-3.5" />
          </span>
        </span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" />
      </button>

      {isOpen ? (
        <div className="taskboard-popover taskboard-icon-picker-menu pretty-scrollbar absolute left-0 top-9 z-[90] max-h-[min(70vh,420px)] w-[120px] overflow-y-auto rounded-[9px] border border-border/70 p-1">
          <div className="grid grid-cols-3 gap-1">
            {options.map((option) => {
              const OptionIcon = taskIcons[option.value];

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  className={`taskboard-icon-picker-cell ui-button ui-button-surface flex h-8 w-8 items-center justify-center rounded-[7px] border transition ${
                    value === option.value
                      ? "taskboard-icon-picker-cell-active border-foreground text-foreground"
                      : "border-border text-muted"
                  }`}
                  aria-label={`Set task icon to ${option.label}`}
                  title={option.label}
                >
                  <OptionIcon className="h-4 w-4" />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export function ThemeDropdown({
  value,
  onChange,
}: {
  value: ThemePreference;
  onChange: (value: ThemePreference) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = themeOptions.find((option) => option.value === value) ?? themeOptions[0];
  const SelectedIcon = selectedOption.icon;
  useDismissibleSurface({
    isOpen,
    onClose: () => setIsOpen(false),
    refs: [rootRef],
  });

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setIsOpen((current) => !current)}
        className={CHIP_BUTTON_CLASS}
      >
        <SelectedIcon className="h-3 w-3" />
        {selectedOption.label}
      </button>

      {isOpen ? (
        <div className="taskboard-popover absolute right-0 top-9 z-[90] min-w-[100px] rounded-[10px] border border-border/70 p-1">
          {themeOptions.map((option) => {
            const OptionIcon = option.icon;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setIsOpen(false);
                }}
                className={COMPACT_MENU_ITEM_CLASS}
              >
                <OptionIcon className="mr-1 h-3 w-3" />
                {option.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export function MetaTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="taskboard-meta-tile rounded-[8px] border border-border/60 px-2 py-1.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-muted">{label}</p>
      <p className={`mt-1 ${TASK_EDITOR_ITEM_TEXT_CLASS} text-foreground`}>{value}</p>
    </div>
  );
}

export function InlineMeta({ icon: Icon, text }: { icon: LucideIcon; text: string }) {
  return (
    <span className="taskboard-inline-meta taskboard-label-chip inline-flex items-center gap-1 rounded-[9px] px-2.5 py-0.5">
      <Icon className="h-3 w-3" />
      {text}
    </span>
  );
}

export function CompactMeta({
  icon: Icon,
  text,
  label,
  className = "",
}: {
  icon: LucideIcon;
  text: string;
  /** Full meaning for hover and screen readers when the compact text is terse, such as "1/3". */
  label?: string;
  className?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap ${className}`}
      title={label}
      aria-label={label}
    >
      <Icon className="h-2.5 w-2.5" aria-hidden="true" />
      {text}
    </span>
  );
}

export function ViewButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`taskboard-view-mode-button ${active ? CHIP_BUTTON_ACTIVE_CLASS : SMALL_CHIP_BUTTON_CLASS}`}
    >
      <Icon className="h-3 w-3" />
      {label}
    </button>
  );
}

// The board sizes the badge with text-[10px]; the task editor passes its chip role.
export function StatusBadge({ status, sizeClassName = "text-[10px]" }: { status: Task["status"]; sizeClassName?: string }) {
  const labelMap: Record<Task["status"], { text: string; className: string }> = {
    todo: {
      text: "Todo",
      className: "bg-slate-200 text-slate-700",
    },
    active: {
      text: "Active",
      className: "bg-amber-200 text-amber-900",
    },
    waiting: {
      text: "Waiting",
      className: "bg-sky-200 text-sky-900",
    },
    done: {
      text: "Done",
      className: "bg-emerald-200 text-emerald-900",
    },
  };

  const definition = labelMap[status];

  return (
    <span
      className={`taskboard-status-badge rounded-[9px] px-2 py-0.5 ${sizeClassName} font-semibold ${definition.className}`}
    >
      {definition.text}
    </span>
  );
}

export function TaskCardStatus({ status }: { status: Task["status"] }) {
  const definitionMap: Record<
    Task["status"],
    { text: string; dotClassName: string; textClassName: string }
  > = {
    todo: {
      text: "Todo",
      dotClassName: "bg-slate-400",
      textClassName: "text-slate-600",
    },
    active: {
      text: "Active",
      dotClassName: "bg-amber-500",
      textClassName: "text-amber-800",
    },
    waiting: {
      text: "Waiting",
      dotClassName: "bg-sky-500",
      textClassName: "text-sky-800",
    },
    done: {
      text: "Done",
      dotClassName: "bg-emerald-500",
      textClassName: "text-emerald-800",
    },
  };
  const definition = definitionMap[status];

  return (
    <span
      className={`taskboard-status-chip inline-flex shrink-0 items-center gap-1 rounded-[9px] px-1.5 py-0.5 text-[10px] font-semibold ${definition.textClassName}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${definition.dotClassName}`} />
      {definition.text}
    </span>
  );
}

/** Plain status names, used where status is shown as a colored bar. */
export const TASK_STATUS_LABELS: Record<Task["status"], string> = {
  todo: "Todo",
  active: "Active",
  waiting: "Waiting",
  done: "Done",
};
