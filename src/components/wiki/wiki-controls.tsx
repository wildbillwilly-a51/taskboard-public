"use client";

import { createContext, useContext, type ComponentProps, type ReactNode } from "react";
import { TASK_EDITOR_BUTTON_CLASS, TASK_EDITOR_INPUT_CLASS, TASK_EDITOR_MENU_ITEM_CLASS } from "@/components/taskboard-constants";

type ButtonProps = ComponentProps<"button"> & { variant?: "surface" | "primary" | "menu" | "icon" };
const LinenContext = createContext(false);
export function WikiControlsProvider({ children }: { children: ReactNode }) {
  return <LinenContext.Provider value={true}>{children}</LinenContext.Provider>;
}

// Use the task workspace's roles rather than sizing every Wiki control again.
// Leave `type` to the caller so existing submit buttons retain form semantics.
export function WikiButton({ className = "", variant = "surface", ...props }: ButtonProps) {
  const linen = useContext(LinenContext);
  const role = variant === "menu" ? TASK_EDITOR_MENU_ITEM_CLASS
    : variant === "icon" ? "ui-button ui-button-surface ed-icon-button"
    : `${TASK_EDITOR_BUTTON_CLASS} ${variant === "primary" ? "ui-button-primary" : "ui-button-surface"}`;
  return <button {...props} className={linen ? `wiki-button ${role} ${className}` : className} />;
}

export function WikiInput({ className = "", ...props }: ComponentProps<"input">) {
  const linen = useContext(LinenContext);
  return <input {...props} className={linen ? `${TASK_EDITOR_INPUT_CLASS} ${className}` : className} />;
}

export function WikiSelect({ className = "", ...props }: ComponentProps<"select">) {
  const linen = useContext(LinenContext);
  return <select {...props} className={linen ? `${TASK_EDITOR_INPUT_CLASS} ${className}` : className} />;
}

export function WikiTextarea({ className = "", ...props }: ComponentProps<"textarea">) {
  const linen = useContext(LinenContext);
  return <textarea {...props} className={linen ? `${TASK_EDITOR_INPUT_CLASS} ${className}` : className} />;
}
