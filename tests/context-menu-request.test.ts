import assert from "node:assert/strict";
import test from "node:test";

import { isBlankAppContextMenu, isContextMenuKey, keepsNativeContextMenu, resolveTaskMenuTarget } from "../src/lib/context-menu-request";

// A stand-in for an element: `closest` answers whether any of its ancestors
// (itself included) matches one of the selectors in the list it is given.
const element = (ancestors: string[], options: { isContentEditable?: boolean } = {}) => ({
  isContentEditable: options.isContentEditable ?? false,
  closest: (selector: string) =>
    selector.split(",").map((part) => part.trim()).some((part) => ancestors.includes(part)) ? {} : null,
});

test("task surfaces open the app menu", () => {
  assert.equal(keepsNativeContextMenu(element(["button", "article"])), false);
  assert.equal(keepsNativeContextMenu(element(["div"]), { pointerType: "mouse" }), false);
  // FullCalendar wraps events in an anchor without href; that is not a link.
  assert.equal(keepsNativeContextMenu(element(["a"])), false);
});

test("text entry, editors, real links and media keep the browser menu", () => {
  for (const ancestor of ["input", "textarea", "select", '[contenteditable="true"]', '[contenteditable=""]', "a[href]", "img", "video", "iframe"]) {
    assert.equal(keepsNativeContextMenu(element([ancestor])), true, ancestor);
  }
  assert.equal(keepsNativeContextMenu(element(["div"], { isContentEditable: true })), true);
});

test("touch, selected text and handled events keep the browser menu", () => {
  assert.equal(keepsNativeContextMenu(element(["button"]), { pointerType: "touch" }), true);
  assert.equal(keepsNativeContextMenu(element(["button"]), { hasSelection: true }), true);
  assert.equal(keepsNativeContextMenu(element(["button"]), { defaultPrevented: true }), true);
  assert.equal(keepsNativeContextMenu(null), true);
});

test("only blank app layout suppresses an unhandled secondary pointer click", () => {
  assert.equal(isBlankAppContextMenu(element(["div"]), { button: 2 }), true);
  for (const ancestor of ["button", "input", "a[href]", "img", "p", "pre", ".bn-container", '[data-note-row]', '[data-space-row]', '[data-testid="task-card"]', ".fc-event"]) {
    assert.equal(isBlankAppContextMenu(element([ancestor]), { button: 2 }), false, ancestor);
  }
  const prose = { ...element(["span"]), childNodes: [{ nodeType: 3, textContent: "Readable text" }] };
  assert.equal(isBlankAppContextMenu(prose, { button: 2 }), false);
  assert.equal(isBlankAppContextMenu(element(["div"]), { button: 0 }), false, "keyboard context menu");
  for (const options of [{ pointerType: "touch" }, { hasSelection: true }, { defaultPrevented: true }]) {
    assert.equal(isBlankAppContextMenu(element(["div"]), { button: 2, ...options }), false);
  }
  assert.equal(isBlankAppContextMenu(null, { button: 2 }), false);
});

test("the Menu key and Shift+F10 open a menu; modified keys do not", () => {
  assert.equal(isContextMenuKey({ key: "ContextMenu", shiftKey: false }), true);
  assert.equal(isContextMenuKey({ key: "F10", shiftKey: true }), true);
  assert.equal(isContextMenuKey({ key: "F10", shiftKey: false }), false);
  assert.equal(isContextMenuKey({ key: "F10", shiftKey: true, ctrlKey: true }), false);
  assert.equal(isContextMenuKey({ key: "ContextMenu", shiftKey: false, altKey: true }), false);
});

// A small tree of stand-in elements for target resolution.
type FakeNode = {
  attrs: Record<string, string>;
  parent: FakeNode | null;
  children: FakeNode[];
  closest: (selector: string) => FakeNode | null;
  querySelector: (selector: string) => FakeNode | null;
  getAttribute: (name: string) => string | null;
};
const matches = (node: FakeNode, selector: string) =>
  selector.split(",").map((part) => part.trim()).some((part) => {
    const [, name, value] = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(part) ?? [];
    return Boolean(name) && name in node.attrs && (value === undefined || node.attrs[name] === value);
  });
function node(attrs: Record<string, string>, children: FakeNode[] = []): FakeNode {
  const self: FakeNode = {
    attrs,
    parent: null,
    children,
    closest(selector) {
      for (let current: FakeNode | null = self; current; current = current.parent) {
        if (matches(current, selector)) return current;
      }
      return null;
    },
    querySelector(selector) {
      for (const child of self.children) {
        if (matches(child, selector)) return child;
        const found = child.querySelector(selector);
        if (found) return found;
      }
      return null;
    },
    getAttribute: (name) => attrs[name] ?? null,
  };
  for (const child of children) child.parent = self;
  return self;
}

test("a right-click on a card's button, border or a header finds its task", () => {
  const title = node({});
  const button = node({ "data-task-nav": "t1" }, [title]);
  const card = node({ "data-testid": "task-card", "data-task-id": "t1" }, [button]);
  assert.deepEqual(resolveTaskMenuTarget(title), { taskId: "t1", trigger: button });
  assert.deepEqual(resolveTaskMenuTarget(card), { taskId: "t1", trigger: button });

  const headerText = node({});
  const header = node({ "data-task-menu-target": "t2" }, [headerText]);
  assert.deepEqual(resolveTaskMenuTarget(headerText), { taskId: "t2", trigger: header });
});

test("drop placeholders and unrelated elements are not task targets", () => {
  assert.equal(resolveTaskMenuTarget(node({ "data-testid": "task-drop-placeholder", "data-task-id": "t1" })), null);
  assert.equal(resolveTaskMenuTarget(node({ "data-testid": "bucket-column" })), null);
});
