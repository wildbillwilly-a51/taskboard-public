// When a right-click or the keyboard menu key opens one of the app's own
// menus, and when it is left to the browser. Every surface with a context
// menu (Notes rows, task cards, and later the calendars) asks here, so the
// browser's menu stays available in the same places everywhere.

type ElementLike = {
  closest: (selector: string) => unknown;
  isContentEditable?: boolean;
};

// Text entry, rich editors, real links and media keep the browser's menu
// (spelling, paste, open in new tab, save image). An anchor without href is
// not a link: FullCalendar wraps every event in one.
const NATIVE_MENU_SELECTOR = [
  "input",
  "textarea",
  "select",
  '[contenteditable=""]',
  '[contenteditable="true"]',
  "a[href]",
  "img",
  "video",
  "audio",
  "iframe",
  "embed",
  "object",
].join(", ");

export function keepsNativeContextMenu(
  target: unknown,
  options: { pointerType?: string; hasSelection?: boolean; defaultPrevented?: boolean } = {},
) {
  const element = target as ElementLike | null;
  if (!element || typeof element.closest !== "function") {
    return true;
  }

  // Touch keeps its long-press behavior; touch surfaces have their own menus.
  // Selected text keeps Copy; something that already handled the event wins.
  return Boolean(
    options.defaultPrevented ||
      options.pointerType === "touch" ||
      options.hasSelection ||
      element.isContentEditable ||
      element.closest(NATIVE_MENU_SELECTOR),
  );
}

// Called only on the app shell's bubbling phase, after item-specific menus had
// their chance. Preserve controls, item padding, prose and native content. Only
// an unhandled secondary pointer click on empty layout chrome is a no-op.
export function isBlankAppContextMenu(
  target: unknown,
  options: { button: number; pointerType?: string; hasSelection?: boolean; defaultPrevented?: boolean },
) {
  if (options.button !== 2 || keepsNativeContextMenu(target, options)) return false;
  const element = target as ElementLike & { childNodes?: ArrayLike<{ nodeType: number; textContent: string | null }> };
  if (element.closest([
    "button", "label", "summary", '[role="button"]', '[role="menu"]', '[role="menuitem"]',
    '[role="tab"]', '[role="checkbox"]', '[role="switch"]', '[role="slider"]',
    "p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "pre", "code", "blockquote", "td", "th",
    ".bn-container", '[data-note-row]', '[data-space-row]', '[data-task-nav]',
    '[data-task-menu-target]', '[data-testid="task-card"]', ".wiki-item-menu", ".fc-event",
  ].join(", "))) return false;
  return !Array.from(element.childNodes ?? []).some(node => node.nodeType === 3 && node.textContent?.trim());
}

// The Menu key and Shift+F10 open the menu for the focused item.
export function isContextMenuKey(event: { key: string; shiftKey: boolean; ctrlKey?: boolean; altKey?: boolean; metaKey?: boolean }) {
  if (event.ctrlKey || event.altKey || event.metaKey) {
    return false;
  }

  return event.key === "ContextMenu" || (event.shiftKey && event.key === "F10");
}

type TaskTargetElement = {
  closest: (selector: string) => TaskTargetElement | null;
  querySelector: (selector: string) => TaskTargetElement | null;
  getAttribute: (name: string) => string | null;
};

// The task a right-click or menu key is about, and the element the menu
// returns focus to. Task headers name theirs with data-task-menu-target. Cards
// and rows carry data-task-nav, the attribute keyboard navigation uses, on
// their focusable button; a card's border and padding sit outside that button,
// so the card itself counts too. Drop placeholders and the drag overlay carry
// neither marker on a card, so they never match.
export function resolveTaskMenuTarget<T extends TaskTargetElement>(target: T): { taskId: string; trigger: T } | null {
  const element = target.closest('[data-task-menu-target], [data-task-nav], [data-testid="task-card"]') as T | null;
  if (!element) {
    return null;
  }

  const headerTaskId = element.getAttribute("data-task-menu-target");
  if (headerTaskId) {
    return { taskId: headerTaskId, trigger: element };
  }

  const nav = (element.getAttribute("data-task-nav") ? element : element.querySelector("[data-task-nav]")) as T | null;
  const taskId = nav?.getAttribute("data-task-nav");
  return nav && taskId ? { taskId, trigger: nav } : null;
}

// True when the viewer has selected text that includes the clicked element.
export function hasSelectionWithin(target: unknown) {
  if (typeof window === "undefined" || !(target instanceof Node)) {
    return false;
  }

  const selection = window.getSelection();
  return Boolean(selection && !selection.isCollapsed && selection.toString().trim() && selection.containsNode(target, true));
}
