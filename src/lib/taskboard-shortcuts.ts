export type ShortcutCommandId =
  | "palette"
  | "help"
  | "new-task"
  | "search"
  | "next-card"
  | "previous-card"
  | "next-bucket"
  | "previous-bucket"
  | "open-workspace"
  | "status-todo"
  | "status-active"
  | "status-waiting"
  | "status-done"
  | "due"
  | "snooze"
  | "move";

type ShortcutKeyEvent = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
};

const SINGLE_KEY_COMMANDS: Record<string, ShortcutCommandId> = {
  "?": "help",
  n: "new-task",
  "/": "search",
  j: "next-card",
  k: "previous-card",
  l: "next-bucket",
  h: "previous-bucket",
  w: "open-workspace",
  "1": "status-todo",
  "2": "status-active",
  "3": "status-waiting",
  "4": "status-done",
  d: "due",
  s: "snooze",
  m: "move",
};

// Ctrl/Cmd+K always opens the palette. Single keys (no modifiers; Shift only
// for "?") work unless the viewer turned them off in Options.
export function resolveShortcut(
  event: ShortcutKeyEvent,
  options: { singleKeys: boolean },
): ShortcutCommandId | null {
  if (event.altKey) {
    return null;
  }

  if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === "k") {
    return "palette";
  }

  if (!options.singleKeys || event.ctrlKey || event.metaKey) {
    return null;
  }

  const key = event.key.length === 1 ? event.key.toLowerCase() : "";
  if (!key || (event.shiftKey && key !== "?")) {
    return null;
  }

  return SINGLE_KEY_COMMANDS[key] ?? null;
}

type TargetLike = {
  closest?: (selector: string) => unknown;
  isContentEditable?: boolean;
  tagName?: string;
};

const TYPING_SELECTOR =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="textbox"], [role="combobox"]';
const OVERLAY_SELECTOR =
  '[role="dialog"], [role="menu"], [role="listbox"], [aria-modal="true"], .taskboard-popover';

// Regions with a selection of their own, such as the work tab's subtask
// board. Inside one, the open task is not what the viewer has picked, so
// task shortcuts would change the wrong item.
const OWN_SELECTION_SELECTOR = "[data-selection-scope]";

// Single keys never fire while the viewer is typing, working inside a dialog,
// menu or popover, or inside a region with its own selection; those keep
// their own keyboard behavior.
export function isShortcutBlockedTarget(target: unknown) {
  const element = target as TargetLike | null;

  if (!element || typeof element.closest !== "function") {
    return false;
  }

  return Boolean(
    element.isContentEditable ||
      element.closest(TYPING_SELECTOR) ||
      element.closest(OVERLAY_SELECTOR) ||
      element.closest(OWN_SELECTION_SELECTOR),
  );
}

// Panels and dialogs that sit above the board. While one is open, single keys
// stay off so they cannot act on the board behind it. The task workspace is
// excluded: it is where task shortcuts are most useful.
export const OPEN_OVERLAY_SELECTOR = [
  ".taskboard-overlay-panel:not(.taskboard-task-workspace-panel)",
  '[role="dialog"]',
  '[aria-modal="true"]',
  // The undo toast shares the popover surface but must not block shortcuts.
  '.taskboard-popover:not([data-testid="undo-toast"])',
].join(", ");

export type ShortcutSheetGroup = {
  title: string;
  items: ReadonlyArray<{ keys: readonly string[]; label: string }>;
};

export const SHORTCUT_SHEET: readonly ShortcutSheetGroup[] = [
  {
    title: "Anywhere",
    items: [
      { keys: ["Ctrl", "K"], label: "Command palette" },
      { keys: ["?"], label: "Show keyboard shortcuts" },
      { keys: ["/"], label: "Search" },
      { keys: ["N"], label: "New task" },
      { keys: ["Esc"], label: "Close the top layer" },
    ],
  },
  {
    title: "Move around",
    items: [
      { keys: ["J"], label: "Next task" },
      { keys: ["K"], label: "Previous task" },
      { keys: ["H"], label: "Previous bucket" },
      { keys: ["L"], label: "Next bucket" },
      { keys: ["Enter"], label: "Open task in the sidebar" },
      { keys: ["W"], label: "Open task workspace" },
    ],
  },
  {
    title: "Change the current task",
    items: [
      { keys: ["1"], label: "Todo" },
      { keys: ["2"], label: "Active" },
      { keys: ["3"], label: "Waiting" },
      { keys: ["4"], label: "Done" },
      { keys: ["D"], label: "Due date" },
      { keys: ["S"], label: "Snooze" },
      { keys: ["M"], label: "Move to bucket" },
    ],
  },
];

export type PaletteSearchItem = {
  label: string;
  group?: string;
  keywords?: string;
};

// Every query word must appear in the label, group or keywords. Matches at the
// start of the label rank first, then matches at the start of a word.
export function rankPaletteItems<T extends PaletteSearchItem>(items: readonly T[], query: string) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return [...items];
  }

  return items
    .map((item, index) => {
      const label = item.label.toLowerCase();
      const haystack = `${label} ${(item.group ?? "").toLowerCase()} ${(item.keywords ?? "").toLowerCase()}`;

      if (!words.every((word) => haystack.includes(word))) {
        return null;
      }

      const first = words[0];
      const score = label.startsWith(first)
        ? 0
        : new RegExp(`(^|[\\s/-])${first.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).test(label)
          ? 1
          : label.includes(first)
            ? 2
            : 3;

      return { item, index, score };
    })
    .filter((entry): entry is { item: T; index: number; score: number } => entry !== null)
    .sort((left, right) => left.score - right.score || left.index - right.index)
    .map((entry) => entry.item);
}
