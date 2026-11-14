"use client";

import { Menu, Popover } from "@ariakit/react";
import { components, type BlockNoteView } from "@blocknote/ariakit";
import { BlockNoteViewRaw, ComponentsContext, usePortalElement, type ComponentProps } from "@blocknote/react";
import { createContext, forwardRef, useContext } from "react";

// Keyboard shortcuts can open a form whose button is outside the scrolling
// toolbar. Keep its reference rectangle within the visible viewport.
function visibleAnchor(anchor: HTMLElement | null) {
  if (!anchor) return null;
  const box = anchor.getBoundingClientRect(), viewport = window.visualViewport;
  const root = document.documentElement.getBoundingClientRect();
  const left = Math.max(root.left, viewport?.offsetLeft ?? 0) + 8;
  const right = Math.min(root.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? innerWidth)) - 8;
  const top = (viewport?.offsetTop ?? 0) + 8;
  const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight) - 8;
  return { x: Math.max(left, Math.min(box.left, right - box.width)), y: Math.max(top, Math.min(box.top, bottom - box.height)), width: box.width, height: box.height };
}

const WikiPopover = forwardRef<HTMLDivElement, ComponentProps["Generic"]["Popover"]["Content"]>(function WikiPopover({ className, children, variant }, ref) {
  const portalElement = usePortalElement();
  return <Popover ref={ref} className={["bn-ak-popover", className, variant === "panel-popover" ? "bn-ak-panel-popover" : ""].filter(Boolean).join(" ")}
    getAnchorRect={visibleAnchor} gutter={4} fitViewport slide autoFocusOnShow={false} unmountOnHide
    portal={portalElement !== null} portalElement={portalElement}>{children}</Popover>;
});

const MenuScope = createContext<{ portalElement: HTMLElement | null; preventFocusOnOpen: boolean }>({ portalElement: null, preventFocusOnOpen: false });
function WikiMenuRoot(props: ComponentProps["Generic"]["Menu"]["Root"]) {
  return <MenuScope.Provider value={{ portalElement: props.portalElement, preventFocusOnOpen: props.preventFocusOnOpen ?? false }}><components.Generic.Menu.Root {...props} /></MenuScope.Provider>;
}
const WikiMenuDropdown = forwardRef<HTMLDivElement, ComponentProps["Generic"]["Menu"]["Dropdown"]>(function WikiMenuDropdown({ children, className }, ref) {
  const { portalElement, preventFocusOnOpen } = useContext(MenuScope);
  // A nested palette may need to overlap its parent on a phone. Keep Ariakit's
  // menu/focus/selection behavior and enable its own viewport sizing policy.
  return <Menu ref={ref} className={["bn-ak-menu", className].filter(Boolean).join(" ")} gutter={4} fitViewport overlap slide
    getAnchorRect={visibleAnchor} unmountOnHide autoFocusOnShow={preventFocusOnOpen ? () => false : true}
    portal={portalElement !== null} portalElement={portalElement}>{children}</Menu>;
});

const wikiComponents = { ...components, Generic: { ...components.Generic,
  Menu: { ...components.Generic.Menu, Root: WikiMenuRoot, Dropdown: WikiMenuDropdown },
  Popover: { ...components.Generic.Popover, Content: WikiPopover },
} };

export const WikiEditorView: typeof BlockNoteView = props => <ComponentsContext.Provider value={wikiComponents}><BlockNoteViewRaw {...props} className={["bn-ariakit", props.className].filter(Boolean).join(" ")} /></ComponentsContext.Provider>;
