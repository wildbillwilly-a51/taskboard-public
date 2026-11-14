import type { FolioSpace } from "./folio-model";

export function canDeleteFolioSpace(space: Pick<FolioSpace, "kind" | "root" | "canManage" | "canDelete">) {
  return !space.root && (space.kind === "personal" || space.kind === "shared") &&
    Boolean(space.canDelete ?? space.canManage);
}

/** Disclosure is independent from selection; lazy responses never change it. */
export function toggleFolioExpanded(expanded: readonly string[], id: string, open?: boolean) {
  const next = open ?? !expanded.includes(id);
  return next ? [...new Set([...expanded, id])] : expanded.filter(value => value !== id);
}

type BoardIdentity = Pick<FolioSpace, "kind" | "title" | "boardType" | "boardTitle" | "boardOwnerUserId" | "boardOwnerDisplayName" | "boardOwnerTeamName">;
export function folioBoardDescriptor(space: BoardIdentity, viewerId: string) {
  if (space.kind !== "board" && space.kind !== "task") return "";
  let owner = "Board";
  if (space.boardType === "team") owner = space.boardOwnerTeamName ? `Team · ${space.boardOwnerTeamName}` : "Team board";
  if (space.boardType === "personal") {
    owner = space.boardOwnerUserId === viewerId ? "Your board" : space.boardOwnerDisplayName ? `Shared by ${space.boardOwnerDisplayName}` : "Shared personal board";
  }
  return space.kind === "task" ? `${space.boardTitle ?? "Board"} · ${owner}` : owner;
}

export function folioConnectionLabel(space: BoardIdentity, viewerId: string) {
  const identity = folioBoardDescriptor(space, viewerId);
  return identity ? `${space.title} — ${identity}` : space.title;
}

/** Reads coalesce per branch, without suppressing other branches or mutations. */
export function createFolioBranchLoader() {
  const pending = new Map<string, Promise<void>>();
  return (id: string, load: () => Promise<void>) => {
    const existing = pending.get(id);
    if (existing) return existing;
    const request = Promise.resolve().then(load).finally(() => pending.delete(id));
    pending.set(id, request);
    return request;
  };
}
