"use client";

import { createContext, useContext, type ReactNode } from "react";
import { fetchWikiSpaces } from "@/lib/wiki-client";
import { searchWikiPagesRequest } from "@/lib/wiki-discovery-client";
import { useWikiResource } from "./wiki-resource";

function useNavigationResources() {
  const spaces = useWikiResource("spaces", () => fetchWikiSpaces(true), true);
  const recent = useWikiResource("recent", signal => searchWikiPagesRequest({ q: "", limit: 10 }, signal), true);
  return { spaces, recent };
}

const NavigationContext = createContext<ReturnType<typeof useNavigationResources> | null>(null);
export function WikiNavigationProvider({ children }: { children: ReactNode }) {
  const value = useNavigationResources();
  return <NavigationContext.Provider value={value}>{children}</NavigationContext.Provider>;
}
export function useWikiNavigation() {
  const value = useContext(NavigationContext);
  if (!value) throw new Error("Wiki navigation requires its provider.");
  return value;
}
