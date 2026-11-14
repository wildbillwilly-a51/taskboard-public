"use client";
import type { ReactNode } from "react";
import { WikiItemMenu, type WikiMenuAction } from "./wiki-item-menu";

export function WikiActionMenu({ actions, children }: { actions: WikiMenuAction[]; children: ReactNode }) {
  return <WikiItemMenu label="Page actions" actions={actions} className="wiki-action-menu wiki-page-menu-heading">{children}</WikiItemMenu>;
}
