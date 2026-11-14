// Column layout rules for the Notes workspace: which panes show at a given
// workspace width, and how stored column widths are clamped so the editor
// always keeps room. Pure, so it can be unit tested and shared with CSS
// (the thresholds below mirror the container queries in globals.css).

export const NOTES_LAYOUT = {
  sidebar: { min: 160, max: 420, default: 224 },
  list: { min: 200, max: 560, default: 300 },
  editorMin: 360,
  separator: 1,
  // Container widths, matching @container notes-frame in globals.css.
  wideMin: 960,
  singleBelow: 680,
} as const;

export type NotesLayoutMode = "wide" | "medium" | "single";
export type NotesPane = "nav" | "list" | "note";
export type NotesColumnWidths = { sidebar: number; list: number };

export function getNotesLayoutMode(width: number): NotesLayoutMode {
  if (width >= NOTES_LAYOUT.wideMin) {
    return "wide";
  }

  return width >= NOTES_LAYOUT.singleBelow ? "medium" : "single";
}

// Which resizable columns are on screen next to the editor.
export function getVisibleNotesColumns(mode: NotesLayoutMode, pane: NotesPane) {
  if (mode === "wide") {
    return { sidebar: true, list: true };
  }

  if (mode === "medium") {
    return pane === "nav" ? { sidebar: true, list: false } : { sidebar: false, list: true };
  }

  return { sidebar: false, list: false };
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}

export function normalizeNotesColumnWidths(value: unknown): NotesColumnWidths {
  const candidate = (value && typeof value === "object" ? value : {}) as Partial<Record<keyof NotesColumnWidths, unknown>>;
  const read = (key: keyof NotesColumnWidths) => {
    const number = Number(candidate[key]);
    const bounds = NOTES_LAYOUT[key];
    return Number.isFinite(number) ? clamp(Math.round(number), bounds.min, bounds.max) : bounds.default;
  };

  return { sidebar: read("sidebar"), list: read("list") };
}

// The widths actually used at this workspace width. Each visible column keeps
// its own minimum; the editor keeps NOTES_LAYOUT.editorMin when space allows,
// shrinking the list first and then the sidebar. Stored widths are untouched.
export function getEffectiveNotesColumnWidths(
  stored: NotesColumnWidths,
  width: number,
  pane: NotesPane,
): NotesColumnWidths {
  const mode = getNotesLayoutMode(width);
  const visible = getVisibleNotesColumns(mode, pane);
  const widths = normalizeNotesColumnWidths(stored);
  const separators = (visible.sidebar ? NOTES_LAYOUT.separator : 0) + (visible.list ? NOTES_LAYOUT.separator : 0);
  const available = width - separators - NOTES_LAYOUT.editorMin;

  let sidebar = widths.sidebar;
  let list = widths.list;

  if (visible.sidebar && visible.list) {
    const overflow = sidebar + list - available;

    if (overflow > 0) {
      const listShrink = Math.min(overflow, list - NOTES_LAYOUT.list.min);
      list -= listShrink;
      sidebar = clamp(sidebar - (overflow - listShrink), NOTES_LAYOUT.sidebar.min, sidebar);
    }
  } else if (visible.sidebar) {
    sidebar = clamp(sidebar, NOTES_LAYOUT.sidebar.min, available);
  } else if (visible.list) {
    list = clamp(list, NOTES_LAYOUT.list.min, available);
  }

  return { sidebar, list };
}

// Bounds for one column's separator at the current layout, used for dragging
// and for aria-valuemin/valuemax.
export function getNotesColumnBounds(
  column: keyof NotesColumnWidths,
  effective: NotesColumnWidths,
  width: number,
  pane: NotesPane,
) {
  const visible = getVisibleNotesColumns(getNotesLayoutMode(width), pane);
  const other = column === "sidebar" ? (visible.list ? effective.list : 0) : visible.sidebar ? effective.sidebar : 0;
  const separators = (visible.sidebar ? NOTES_LAYOUT.separator : 0) + (visible.list ? NOTES_LAYOUT.separator : 0);
  const bounds = NOTES_LAYOUT[column];
  const max = Math.min(bounds.max, width - separators - NOTES_LAYOUT.editorMin - other);

  return { min: bounds.min, max: Math.max(bounds.min, max) };
}
