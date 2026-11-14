import type { TaskStatus } from "@/lib/taskboard-data";

type OfflineRecord = { id: string; title: string; version: string; boardTitle: string };
export type OfflineTask = OfflineRecord & {
  kind: "task"; status: TaskStatus; dueAt: string | null; subtask: boolean; bucket: string | null;
};
export type OfflineEvent = OfflineRecord & {
  kind: "event"; startAt: string; endAt: string; allDay: boolean;
};
export type OfflineWorkItem = OfflineTask | OfflineEvent;
export type OfflineWorkPatch = {
  title?: string; status?: TaskStatus; dueAt?: string | null; startAt?: string; endAt?: string;
};
export type OfflineWorkSave = {
  operationId: string; itemId: string; kind: OfflineWorkItem["kind"]; version: string; patch: OfflineWorkPatch;
};
export type OfflineWorkSnapshot = { ownerId: string; items: OfflineWorkItem[] };
export type OfflineWorkSaveResult =
  | { kind: "saved"; version: string }
  | { kind: "conflict"; reason: "changed" | "unavailable" };

export const offlineWorkApi = "/api/offline-work";
export const offlineTaskStatuses = { todo: "To do", active: "Active", waiting: "Waiting", done: "Done" } as const;
