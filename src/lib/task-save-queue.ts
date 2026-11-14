// One writer per task. Every save of a task (editor autosave, keyboard
// shortcuts, the palette, context menus, undo) goes through this queue, so
// requests for one task run one at a time and in the order they were made.
//
// Without it, each task editor kept its own queue and a shortcut saved beside
// it, so two requests for the same task could be in flight together. An
// editor that was replaced (another task opened, the workspace expanded or
// closed) also kept sending while its successor started a queue of its own.
//
// Two kinds of entry:
// - "draft": editor autosave. A draft waiting behind the request in flight
//   absorbs the next draft from the same source, so typing does not pile up
//   requests.
// - "action": status, due date, move, promote, undo. Never merged, so each
//   caller learns whether its own change was saved, and a later change cannot
//   swallow an earlier one (a Done that completes a recurring task, say).
//
// Each entry names its source. An editor treats only its own entries as its
// pending choices; everything else (another editor it replaced, shortcuts,
// menus) is a server change it follows once it lands.
//
// Each entry also carries the request that sends it, made when it was queued,
// so a request waiting while the viewer switches boards still goes to the
// board it was made on.

export type SaveEntryKind = "draft" | "action";

export type SaveResult<TPatch> = { saved: boolean; patch: TPatch };

type Entry<TPatch> = {
  kind: SaveEntryKind;
  source: string;
  patch: TPatch;
  save: (patch: TPatch) => Promise<boolean>;
  settle: Array<(result: SaveResult<TPatch>) => void>;
};

type TaskQueue<TPatch> = {
  sending: Entry<TPatch> | null;
  waiting: Entry<TPatch>[];
};

export type TaskSaveQueue<TPatch extends object> = {
  enqueue: (
    taskId: string,
    patch: TPatch,
    options: { kind: SaveEntryKind; source: string; save: (patch: TPatch) => Promise<boolean> },
  ) => Promise<SaveResult<TPatch>>;
  /**
   * Everything in flight or waiting for a task (from one source, if given),
   * merged in order; null when there is none. The same object is returned
   * until the task's queue changes, so it can be read during render.
   */
  getPendingPatch: (taskId: string, source?: string) => TPatch | null;
  subscribe: (taskId: string, listener: () => void) => () => void;
};

export function createTaskSaveQueue<TPatch extends object>({
  merge = (previous, next) => ({ ...previous, ...next }),
}: {
  merge?: (previous: TPatch, next: TPatch) => TPatch;
} = {}): TaskSaveQueue<TPatch> {
  const queues = new Map<string, TaskQueue<TPatch>>();
  const listeners = new Map<string, Set<() => void>>();
  const versions = new Map<string, number>();
  const pendingCache = new Map<string, { version: number; patch: TPatch | null }>();

  const notify = (taskId: string) => {
    versions.set(taskId, (versions.get(taskId) ?? 0) + 1);
    for (const listener of listeners.get(taskId) ?? []) {
      listener();
    }
  };

  const run = async (taskId: string) => {
    const queue = queues.get(taskId);
    if (!queue || queue.sending) {
      return;
    }

    const entry = queue.waiting.shift();
    if (!entry) {
      queues.delete(taskId);
      return;
    }

    queue.sending = entry;
    notify(taskId);
    let saved = false;
    try {
      saved = await entry.save(entry.patch);
    } catch (error) {
      console.error("Task save failed.", error);
    }
    // Settled entries are no longer pending when their callers hear back.
    queue.sending = null;
    if (queue.waiting.length === 0) {
      queues.delete(taskId);
    }
    notify(taskId);
    for (const settle of entry.settle) {
      settle({ saved, patch: entry.patch });
    }
    void run(taskId);
  };

  return {
    enqueue: (taskId, patch, { kind, source, save }) =>
      new Promise((resolve) => {
        const queue = queues.get(taskId) ?? { sending: null, waiting: [] };
        queues.set(taskId, queue);
        const last = queue.waiting.at(-1);
        if (kind === "draft" && last?.kind === "draft" && last.source === source) {
          last.patch = merge(last.patch, patch);
          last.save = save;
          last.settle.push(resolve);
        } else {
          queue.waiting.push({ kind, source, patch, save, settle: [resolve] });
        }
        notify(taskId);
        void run(taskId);
      }),
    getPendingPatch: (taskId, source) => {
      const key = `${taskId}\u0000${source ?? ""}`;
      const version = versions.get(taskId) ?? 0;
      const cached = pendingCache.get(key);
      if (cached?.version === version) {
        return cached.patch;
      }
      const queue = queues.get(taskId);
      const entries = (queue ? [...(queue.sending ? [queue.sending] : []), ...queue.waiting] : [])
        .filter((entry) => source === undefined || entry.source === source);
      const patch = entries.length === 0
        ? null
        : entries.slice(1).reduce((merged, entry) => merge(merged, entry.patch), entries[0].patch);
      pendingCache.set(key, { version, patch });
      return patch;
    },
    subscribe: (taskId, listener) => {
      const set = listeners.get(taskId) ?? new Set();
      set.add(listener);
      listeners.set(taskId, set);
      return () => {
        set.delete(listener);
        if (set.size === 0) {
          listeners.delete(taskId);
        }
      };
    },
  };
}
