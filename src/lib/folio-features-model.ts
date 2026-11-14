import { isUuid } from "./notes-model";
export type FolioPerson = {
  id: string;
  name: string;
  role: "Owner" | "Contributor" | "Shared-link editor";
};
export type FolioFeatures = {
  people: FolioPerson[];
  maintainerId: string | null;
  maintainerName: string | null;
  reviewDue: string | null;
  reviewedAt: string | null;
  isTemplate: boolean;
  linkSharing: boolean;
};
export type FolioHit = {
  id: string;
  title: string;
  snippet: string;
  updatedAt: string;
  pageSpaceId: string | null;
  features: FolioFeatures;
};
export type FolioDiscovery = { notes: FolioHit[]; hasMore: boolean };
export type FolioDiscoveryInput = {
  q?: string;
  titleOnly?: boolean;
  spaceId?: string;
  keyword?: string;
  by?: string;
  before?: string;
  after?: string;
  due?: boolean;
  templates?: boolean;
  recent?: boolean;
  sort?: "updated" | "title" | "created" | "recent";
  offset?: number;
  backlinkTo?: string;
};
export type FolioShareMode = "read" | "write";
export type FolioShareLink = {
  mode: FolioShareMode;
  active: boolean;
  url?: string;
};
export function publicNotePath(path: string) {
  return /^\/share\/note\/[A-Za-z0-9_-]{43}(?:\/(?:data|save|files(?:\/[0-9a-f-]{36})?))?\/?$/.test(
    path,
  );
}
export function normalizeWebLink(value: string) {
  const raw = value.trim();
  const href = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(href);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      !url.hostname ||
      url.username ||
      url.password
    )
      throw Error();
    return url.href;
  } catch {
    throw new Error("Enter a valid http:// or https:// address.");
  }
}
export function assertFeatureId(id: unknown): asserts id is string {
  if (!isUuid(id)) throw new Error("Choose a valid note.");
}
export function initials(name: string) {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0])
      .join("")
      .toUpperCase() || "?"
  );
}
