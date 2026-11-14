import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

export type TestAttachment = {
  id: string;
  noteId?: string;
  displayName: string;
  originalName: string;
  sizeBytes: number;
  mimeType: string;
};

export type TestTaskNote = {
  id: string;
  body: string;
  createdAt: string;
  updatedAt?: string;
  authorName: string;
  editorName?: string;
  attachments: TestAttachment[];
};

export type TestTask = {
  id: string;
  title: string;
  summary?: string;
  status?: "todo" | "active" | "waiting" | "done";
  labels: string[];
  color: string;
  icon: string;
  startAt?: string;
  endAt?: string;
  dueAt?: string;
  recurrence?: {
    frequency: "daily" | "weekly" | "monthly" | "weekday" | "custom";
    interval: number;
    mode: "on_schedule" | "after_completion";
  };
  subtasks: TestTask[];
  notes: TestTaskNote[];
  attachments: TestAttachment[];
  importedFrom?: {
    source: "google" | "outlook" | "ics" | "manual";
    readOnly: boolean;
  };
};

export type TestCalendarSourceEvent = {
  id: string;
  title: string;
  start: string;
  end: string;
  data: {
    kind: "imported-source";
    importedEventId: string;
    sourceEventId?: string;
    linkedTaskId?: string;
    provider: string;
    syncStatus: string;
    readOnly: boolean;
  };
};

export type TestBucket = {
  id: string;
  title: string;
  tasks: TestTask[];
};

export type TestBoard = {
  id: string;
  title: string;
  buckets: TestBucket[];
};

export type TestRecycleBinItem = {
  id: string;
  title: string;
  providerLabel: string;
  originalBucketTitle?: string;
  deletedAt: string;
  purgeAfterAt: string;
};

export type TestArchiveItem = {
  id: string;
  title: string;
  providerLabel: string;
  originalBucketTitle?: string;
  archivedAt: string;
  completedAt?: string;
};

export type TestTaskNotification = {
  id: string;
  taskId: string;
  title: string;
  kind: "scheduled" | "overdue";
  dueAt: string;
  triggerAt: string;
  readAt?: string;
  bucketTitle?: string;
  providerLabel?: string;
};

export type TaskboardApiClient = {
  baseUrl: string;
  cookie: string;
  request: (pathname: string, init?: RequestInit) => Promise<Response>;
  getBoard: () => Promise<TestBoard>;
  getRecycleBin: () => Promise<TestRecycleBinItem[]>;
  getArchives: () => Promise<TestArchiveItem[]>;
  getNotifications: () => Promise<{ unreadCount: number; items: TestTaskNotification[] }>;
  createBucket: (title: string) => Promise<{ board: TestBoard }>;
  reorderBuckets: (bucketIds: string[]) => Promise<{ board: TestBoard }>;
  createTask: (bucketId: string, title: string) => Promise<{ taskId: string; board: TestBoard }>;
  createSubtask: (taskId: string, title: string) => Promise<{ subtaskId: string; board: TestBoard }>;
  bulkImportTasks: (body: Record<string, unknown>) => Promise<{
    board: TestBoard;
    createdTaskCount: number;
    createdBucketCount: number;
    warnings?: string[];
  }>;
  moveTask: (taskId: string, targetBucketId: string, targetIndex: number) => Promise<void>;
  patchTask: (
    taskId: string,
    body: Record<string, unknown>,
  ) => Promise<{ board: TestBoard }>;
  archiveTask: (taskId: string) => Promise<{ board: TestBoard; archives?: TestArchiveItem[] }>;
  deleteTask: (taskId: string) => Promise<{ board: TestBoard }>;
  deleteBucket: (bucketId: string) => Promise<{ board: TestBoard }>;
  restoreRecycleBinItem: (taskId: string) => Promise<{ board: TestBoard; taskId?: string }>;
  restoreArchiveItem: (taskId: string) => Promise<{ board: TestBoard; taskId?: string; archives?: TestArchiveItem[] }>;
  permanentlyDeleteRecycleBinItem: (taskId: string) => Promise<{ board: TestBoard }>;
  uploadAttachments: (taskId: string, files: File[]) => Promise<{ board: TestBoard }>;
  deleteAttachment: (
    taskId: string,
    attachmentId: string,
  ) => Promise<{ board: TestBoard }>;
  renameAttachment: (
    taskId: string,
    attachmentId: string,
    displayName: string,
  ) => Promise<{ board: TestBoard }>;
  createNote: (taskId: string, body: string) => Promise<{ board: TestBoard }>;
  updateNote: (
    taskId: string,
    noteId: string,
    body: string,
  ) => Promise<{ board: TestBoard }>;
  deleteNote: (taskId: string, noteId: string) => Promise<{ board: TestBoard }>;
  uploadNoteAttachments: (
    taskId: string,
    noteId: string,
    files: File[],
  ) => Promise<{ board: TestBoard }>;
  downloadAttachment: (
    taskId: string,
    attachmentId: string,
    disposition?: "attachment" | "inline",
  ) => Promise<Response>;
  importOutlookEvents: (
    events: OutlookTestImportEvent[],
    args?: {
      rangeStart?: string;
      rangeEnd?: string;
      filtered?: number;
      recurringRolled?: number;
    },
  ) => Promise<{
    board: TestBoard;
    created: number;
    updated: number;
    skipped: number;
    filtered: number;
    stale: number;
    recurringRolled: number;
    errors: string[];
    bucketId: string;
  }>;
  importIcsFixture: (
    fixturePath?: string,
    fromDate?: string,
  ) => Promise<{ board: TestBoard; created: number; updated: number }>;
  getCalendarSourceEvents: (boardId: string) => Promise<TestCalendarSourceEvent[]>;
  convertCalendarSourceEvent: (
    importedEventId: string,
    args: { bucketId: string; scope: "occurrence" | "series" },
  ) => Promise<{ taskId: string; alreadyConverted: boolean; sourceEventId: string }>;
  updateNotification: (
    notificationId: string,
    action: "read" | "dismiss",
  ) => Promise<void>;
  readAllNotifications: () => Promise<void>;
};

export type OutlookTestImportEvent = {
  sourceRecordId: string;
  title: string;
  description?: string;
  location?: string;
  startsAt: string;
  endsAt: string;
  organizer?: string;
  isRecurring?: boolean;
  rawPayload?: unknown;
};

type JsonObject = Record<string, unknown>;

type BoardResponse = {
  board: TestBoard;
};

type RecycleBinResponse = {
  items: TestRecycleBinItem[];
};

type ArchivesResponse = {
  items: TestArchiveItem[];
};

type NotificationsResponse = {
  unreadCount: number;
  items: TestTaskNotification[];
};

const defaultBaseUrl = process.env.TASKBOARD_BASE_URL ?? "http://localhost:3000";
const envValues = readEnvFile(path.resolve(".env"));
const defaultPassword = process.env.TASKBOARD_APP_PASSWORD ?? envValues.TASKBOARD_APP_PASSWORD ?? "";
const calendarFixturePath = path.resolve("tests", "fixtures", "calendar-import-smoke.ics");

export function readEnvFile(filePath: string) {
  if (!existsSync(filePath)) {
    return {} as Record<string, string>;
  }

  return Object.fromEntries(
    readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separatorIndex = line.indexOf("=");
        return [line.slice(0, separatorIndex), line.slice(separatorIndex + 1)];
      }),
  );
}

export async function assertServerReachable(baseUrl = defaultBaseUrl) {
  try {
    await fetch(`${baseUrl}/login`);
  } catch (error) {
    throw new Error(
      `Taskboard is not reachable at ${baseUrl}. Start Docker or the dev server before running tests.`,
      { cause: error },
    );
  }
}

export async function login(baseUrl = defaultBaseUrl, password = defaultPassword) {
  if (!password) {
    throw new Error("TASKBOARD_APP_PASSWORD is required in the environment or .env.");
  }

  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ password }),
  });

  const payload = (await response.json().catch(() => null)) as { error?: string } | null;

  if (!response.ok) {
    throw new Error(payload?.error ?? `Unable to sign in: ${response.status}`);
  }

  const setCookie = response.headers.get("set-cookie");
  if (!setCookie) {
    throw new Error("Login succeeded but no session cookie was returned.");
  }

  return setCookie.split(";")[0] ?? "";
}

export async function createAuthenticatedClient(args?: {
  baseUrl?: string;
  password?: string;
}): Promise<TaskboardApiClient> {
  const baseUrl = args?.baseUrl ?? defaultBaseUrl;
  const cookie = await login(baseUrl, args?.password ?? defaultPassword);

  const request = async (pathname: string, init: RequestInit = {}) => {
    const headers = new Headers(init.headers ?? {});
    headers.set("cookie", cookie);

    return fetch(new URL(pathname, baseUrl), {
      ...init,
      headers,
    });
  };

  const getBoard = async () => {
    const response = await request("/api/board");
    const body = (await response.json()) as BoardResponse & { error?: string };

    if (!response.ok) {
      throw new Error(body.error ?? `Unable to load board: ${response.status}`);
    }

    return body.board;
  };

  const bulkImportTasks = async (body: Record<string, unknown>) => {
    const response = await request("/api/imports/bulk", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    const payload = (await response.json()) as {
      board: TestBoard;
      createdTaskCount: number;
      createdBucketCount: number;
      warnings?: string[];
      error?: string;
    };

    if (!response.ok) {
      throw new Error(payload.error ?? `Unable to bulk import tasks: ${response.status}`);
    }

    return payload;
  };

  const getRecycleBin = async () => {
    const response = await request("/api/recycle-bin");
    const body = (await response.json()) as RecycleBinResponse & { error?: string };

    if (!response.ok) {
      throw new Error(body.error ?? `Unable to load recycle bin: ${response.status}`);
    }

    return body.items ?? [];
  };

  const getArchives = async () => {
    const response = await request("/api/archives");
    const body = (await response.json()) as ArchivesResponse & { error?: string };

    if (!response.ok) {
      throw new Error(body.error ?? `Unable to load archives: ${response.status}`);
    }

    return body.items ?? [];
  };

  const getNotifications = async () => {
    const response = await request("/api/notifications");
    const body = (await response.json()) as NotificationsResponse & { error?: string };

    if (!response.ok) {
      throw new Error(body.error ?? `Unable to load notifications: ${response.status}`);
    }

    return {
      unreadCount: body.unreadCount ?? 0,
      items: body.items ?? [],
    };
  };

  const createBucket = async (title: string) => {
    return requestJson<{ board: TestBoard }>(request, "/api/buckets", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ title }),
    });
  };

  const reorderBuckets = async (bucketIds: string[]) => {
    return requestJson<{ board: TestBoard }>(request, "/api/buckets/reorder", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bucketIds }),
    });
  };

  const createTask = async (bucketId: string, title: string) => {
    return requestJson<{ taskId: string; board: TestBoard }>(request, "/api/tasks", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ bucketId, title }),
    });
  };

  const createSubtask = async (taskId: string, title: string) => {
    return requestJson<{ subtaskId: string; board: TestBoard }>(
      request,
      `/api/tasks/${taskId}/subtasks`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ title }),
      },
    );
  };

  const moveTask = async (taskId: string, targetBucketId: string, targetIndex: number) => {
    await requestJson(request, "/api/tasks/reorder", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ taskId, targetBucketId, targetIndex }),
    });
  };

  const patchTask = async (taskId: string, body: Record<string, unknown>) => {
    return requestJson<{ board: TestBoard }>(request, `/api/tasks/${taskId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  };

  const deleteTask = async (taskId: string) => {
    return requestJson<{ board: TestBoard }>(request, `/api/tasks/${taskId}`, {
      method: "DELETE",
    });
  };

  const archiveTask = async (taskId: string) => {
    return requestJson<{ board: TestBoard; archives?: TestArchiveItem[] }>(
      request,
      `/api/tasks/${taskId}/archive`,
      {
        method: "POST",
      },
    );
  };

  const deleteBucket = async (bucketId: string) => {
    return requestJson<{ board: TestBoard }>(request, `/api/buckets/${bucketId}`, {
      method: "DELETE",
    });
  };

  const restoreRecycleBinItem = async (taskId: string) => {
    return requestJson<{ board: TestBoard; taskId?: string }>(
      request,
      `/api/recycle-bin/${taskId}/restore`,
      {
        method: "POST",
      },
    );
  };

  const restoreArchiveItem = async (taskId: string) => {
    return requestJson<{ board: TestBoard; taskId?: string; archives?: TestArchiveItem[] }>(
      request,
      `/api/archives/${taskId}/restore`,
      {
        method: "POST",
      },
    );
  };

  const permanentlyDeleteRecycleBinItem = async (taskId: string) => {
    return requestJson<{ board: TestBoard }>(request, `/api/recycle-bin/${taskId}`, {
      method: "DELETE",
    });
  };

  const uploadAttachments = async (taskId: string, files: File[]) => {
    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file);
    }

    return requestJson<{ board: TestBoard }>(request, `/api/tasks/${taskId}/attachments`, {
      method: "POST",
      body: formData,
    });
  };

  const renameAttachment = async (taskId: string, attachmentId: string, displayName: string) => {
    return requestJson<{ board: TestBoard }>(
      request,
      `/api/tasks/${taskId}/attachments/${attachmentId}`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ displayName }),
      },
    );
  };

  const deleteAttachment = async (taskId: string, attachmentId: string) => {
    return requestJson<{ board: TestBoard }>(
      request,
      `/api/tasks/${taskId}/attachments/${attachmentId}`,
      {
        method: "DELETE",
      },
    );
  };

  const createNote = async (taskId: string, body: string) => {
    return requestJson<{ board: TestBoard }>(request, `/api/tasks/${taskId}/notes`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    });
  };

  const updateNote = async (taskId: string, noteId: string, body: string) => {
    return requestJson<{ board: TestBoard }>(request, `/api/tasks/${taskId}/notes/${noteId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ body }),
    });
  };

  const deleteNote = async (taskId: string, noteId: string) => {
    return requestJson<{ board: TestBoard }>(request, `/api/tasks/${taskId}/notes/${noteId}`, {
      method: "DELETE",
    });
  };

  const uploadNoteAttachments = async (taskId: string, noteId: string, files: File[]) => {
    const formData = new FormData();
    for (const file of files) {
      formData.append("files", file);
    }

    return requestJson<{ board: TestBoard }>(
      request,
      `/api/tasks/${taskId}/notes/${noteId}/attachments`,
      {
        method: "POST",
        body: formData,
      },
    );
  };

  const downloadAttachment = async (
    taskId: string,
    attachmentId: string,
    disposition: "attachment" | "inline" = "attachment",
  ) => {
    const response = await request(
      `/api/tasks/${taskId}/attachments/${attachmentId}?disposition=${disposition}`,
    );

    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(body?.error ?? `Unable to download attachment: ${response.status}`);
    }

    return response;
  };

  const importOutlookEvents = async (
    events: OutlookTestImportEvent[],
    args?: {
      rangeStart?: string;
      rangeEnd?: string;
      filtered?: number;
      recurringRolled?: number;
    },
  ) => {
    const rangeStart =
      args?.rangeStart ?? new Date(Date.now() - 1000 * 60 * 60).toISOString();
    const rangeEnd =
      args?.rangeEnd ?? new Date(Date.now() + 1000 * 60 * 60 * 24 * 45).toISOString();

    return requestJson<{
      board: TestBoard;
      created: number;
      updated: number;
      skipped: number;
      filtered: number;
      stale: number;
      recurringRolled: number;
      errors: string[];
      bucketId: string;
    }>(request, "/api/imports/outlook-local", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        source: "outlook-local",
        rangeStart,
        rangeEnd,
        events,
        sourceStats: {
          filtered: args?.filtered ?? 0,
          recurringRolled: args?.recurringRolled ?? 0,
        },
      }),
    });
  };

  const importIcsFixture = async (fixturePath = calendarFixturePath, fromDate?: string) => {
    const formData = new FormData();
    formData.append(
      "file",
      new File([readFileSync(fixturePath)], path.basename(fixturePath), {
        type: "text/calendar",
      }),
    );
    formData.append("fromDate", fromDate ?? new Date().toISOString());

    return requestJson<{ board: TestBoard; created: number; updated: number }>(
      request,
      "/api/imports/ics",
      {
        method: "POST",
        body: formData,
      },
    );
  };

  // Imports are calendar-first: an Outlook or ICS import stores source
  // events only, and a person adds the linked task from Calendar.
  const getCalendarSourceEvents = async (boardId: string) => {
    const response = await request(
      `/api/calendar/snapshot?boardId=${encodeURIComponent(boardId)}&imported=1`,
    );
    const body = (await response.json()) as {
      sourceEvents?: TestCalendarSourceEvent[];
      error?: string;
    };

    if (!response.ok) {
      throw new Error(body.error ?? `Unable to load calendar source events: ${response.status}`);
    }

    return body.sourceEvents ?? [];
  };

  const convertCalendarSourceEvent = async (
    importedEventId: string,
    args: { bucketId: string; scope: "occurrence" | "series" },
  ) => {
    return requestJson<{ taskId: string; alreadyConverted: boolean; sourceEventId: string }>(
      request,
      `/api/calendar/source-events/${importedEventId}/convert`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(args),
      },
    );
  };

  const updateNotification = async (
    notificationId: string,
    action: "read" | "dismiss",
  ) => {
    await requestJson(request, `/api/notifications/${notificationId}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action }),
    });
  };

  const readAllNotifications = async () => {
    await requestJson(request, "/api/notifications/read-all", {
      method: "POST",
    });
  };

  return {
    baseUrl,
    cookie,
    request,
    getBoard,
    bulkImportTasks,
    getRecycleBin,
    getArchives,
    getNotifications,
    createBucket,
    reorderBuckets,
    createTask,
    createSubtask,
    moveTask,
    patchTask,
    archiveTask,
    deleteTask,
    deleteBucket,
    restoreRecycleBinItem,
    restoreArchiveItem,
    permanentlyDeleteRecycleBinItem,
    uploadAttachments,
    deleteAttachment,
    renameAttachment,
    createNote,
    updateNote,
    deleteNote,
    uploadNoteAttachments,
    downloadAttachment,
    importOutlookEvents,
    importIcsFixture,
    getCalendarSourceEvents,
    convertCalendarSourceEvent,
    updateNotification,
    readAllNotifications,
  };
}

export function createTestPrefix(label: string) {
  return `Regression ${label} ${Date.now()}`;
}

export async function cleanupSyntheticArtifacts(
  client: TaskboardApiClient,
  prefix: string,
) {
  const board = await client.getBoard();
  const prefixedBuckets = board.buckets.filter((bucket) => bucket.title.startsWith(prefix));

  for (const bucket of prefixedBuckets) {
    await client.deleteBucket(bucket.id);
  }

  const refreshedBoard = await client.getBoard();
  const matchingTasks = collectRootTasks(refreshedBoard).filter((task) =>
    task.title.startsWith(prefix),
  );

  for (const task of matchingTasks) {
    await client.deleteTask(task.id);
  }

  // Purging a recycled root also purges subtasks that were recycled on their
  // own, so read the bin again after each purge instead of working from a
  // list that may name items already gone.
  const purgedIds = new Set<string>();
  for (;;) {
    const matchingRecycleItem = (await client.getRecycleBin()).find(
      (item) =>
        item.title.startsWith(prefix) ||
        (item.originalBucketTitle ? item.originalBucketTitle.startsWith(prefix) : false),
    );

    if (!matchingRecycleItem) {
      break;
    }

    if (purgedIds.has(matchingRecycleItem.id)) {
      throw new Error(`Recycle-bin item ${matchingRecycleItem.id} is still listed after it was purged.`);
    }

    purgedIds.add(matchingRecycleItem.id);
    await client.permanentlyDeleteRecycleBinItem(matchingRecycleItem.id);
  }
}

export function collectRootTasks(board: TestBoard) {
  return board.buckets.flatMap((bucket) => bucket.tasks);
}

export function findBucketByTitle(board: TestBoard, title: string) {
  return board.buckets.find((bucket) => bucket.title === title) ?? null;
}

export function findTaskByTitle(board: TestBoard, title: string): TestTask | null {
  for (const bucket of board.buckets) {
    for (const task of bucket.tasks) {
      const found = findTaskInTree(task, title);
      if (found) {
        return found;
      }
    }
  }

  return null;
}

export function findTaskLocation(board: TestBoard, taskId: string) {
  for (const bucket of board.buckets) {
    for (const task of bucket.tasks) {
      const found = findTaskByIdInTree(task, taskId);
      if (found) {
        return {
          bucketId: bucket.id,
          bucketTitle: bucket.title,
          task: found,
        };
      }
    }
  }

  return null;
}

export function buildOutlookTestEvent(args: {
  sourceRecordId: string;
  title: string;
  startsAt?: string;
  endsAt?: string;
  description?: string;
  location?: string;
  organizer?: string;
  isRecurring?: boolean;
}) {
  // Outlook appointments start on whole minutes, so the default does too.
  const defaultStart = new Date(Date.now() + 1000 * 60 * 60 * 24);
  defaultStart.setUTCSeconds(0, 0);
  const startsAt = args.startsAt ?? defaultStart.toISOString();
  const endsAt =
    args.endsAt ?? new Date(new Date(startsAt).getTime() + 1000 * 60 * 30).toISOString();

  return {
    sourceRecordId: args.sourceRecordId,
    title: args.title,
    description: args.description ?? "Regression test Outlook event.",
    location: args.location ?? "Taskboard Test",
    startsAt,
    endsAt,
    organizer: args.organizer ?? "taskboard-regression@example.local",
    isRecurring: args.isRecurring ?? false,
    rawPayload: {
      subject: args.title,
      sourceRecordId: args.sourceRecordId,
    },
  } satisfies OutlookTestImportEvent;
}

export function createTextFile(name: string, text: string, type = "text/plain") {
  return new File([text], name, { type });
}

export function createPngFile(name = "preview.png") {
  const pngBase64 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Pbb8AAAAASUVORK5CYII=";
  return new File([Buffer.from(pngBase64, "base64")], name, {
    type: "image/png",
  });
}

export function extractFilenameFromContentDisposition(
  contentDisposition: string | null,
) {
  if (!contentDisposition) {
    return "";
  }

  const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match?.[1]) {
    return decodeURIComponent(utf8Match[1]);
  }

  const basicMatch = contentDisposition.match(/filename=\"?([^\";]+)\"?/i);
  return basicMatch?.[1] ?? "";
}

async function requestJson<T extends JsonObject>(
  request: (pathname: string, init?: RequestInit) => Promise<Response>,
  pathname: string,
  init?: RequestInit,
) {
  const response = await request(pathname, init);
  const body = (await response.json().catch(() => null)) as (T & { error?: string }) | null;

  if (!response.ok) {
    throw new Error(body?.error ?? `Request failed with status ${response.status}`);
  }

  if (!body) {
    throw new Error(`Request succeeded without a JSON body for ${pathname}.`);
  }

  return body;
}

function findTaskInTree(task: TestTask, title: string): TestTask | null {
  if (task.title === title) {
    return task;
  }

  for (const subtask of task.subtasks) {
    const found = findTaskInTree(subtask, title);
    if (found) {
      return found;
    }
  }

  return null;
}

function findTaskByIdInTree(task: TestTask, taskId: string): TestTask | null {
  if (task.id === taskId) {
    return task;
  }

  for (const subtask of task.subtasks) {
    const found = findTaskByIdInTree(subtask, taskId);
    if (found) {
      return found;
    }
  }

  return null;
}
