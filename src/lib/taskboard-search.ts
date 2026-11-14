import type { Board, Bucket, Task } from "@/lib/taskboard-data";

export function normalizeSearchText(value: string) {
  return value
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu) ?? [];
}

export function getTaskSearchTokens(query: string) {
  return Array.from(new Set(normalizeSearchText(query.trim())));
}

function pushOptionalText(parts: string[], value: string | number | boolean | null | undefined) {
  if (value === null || value === undefined) {
    return;
  }

  parts.push(String(value));
}

function appendTaskSearchParts(parts: string[], task: Task) {
  pushOptionalText(parts, task.title);
  pushOptionalText(parts, task.primaryNote?.body);
  pushOptionalText(parts, task.summary);
  pushOptionalText(parts, task.nextAction);
  pushOptionalText(parts, task.status);
  pushOptionalText(parts, task.startAt);
  pushOptionalText(parts, task.endAt);
  pushOptionalText(parts, task.dueAt);
  pushOptionalText(parts, task.completedAt);
  pushOptionalText(parts, task.color);
  pushOptionalText(parts, task.icon);
  pushOptionalText(parts, task.workItemType === "maintenance_outage" ? "maintenance outage" : "task");
  if (task.maintenanceOutage) {
    pushOptionalText(parts, task.maintenanceOutage.locationName);
    pushOptionalText(parts, task.maintenanceOutage.owner);
    for (const attendee of task.maintenanceOutage.attendees) {
      pushOptionalText(parts, attendee);
    }
  }

  if (task.recurrence) {
    pushOptionalText(parts, task.recurrence.frequency);
    pushOptionalText(parts, task.recurrence.interval);
    pushOptionalText(parts, task.recurrence.mode);
  }

  if (task.reminderConfig) {
    pushOptionalText(parts, task.reminderConfig.reminderOffsetMinutes);
    pushOptionalText(parts, task.reminderConfig.overdueReminderEnabled ? "overdue reminder" : "");
  }

  if (task.importedFrom) {
    pushOptionalText(parts, task.importedFrom.source);
    pushOptionalText(parts, task.importedFrom.providerLabel);
    pushOptionalText(parts, task.importedFrom.syncStatus);
    pushOptionalText(parts, task.importedFrom.isRecurring ? "recurring" : "");
    pushOptionalText(parts, task.importedFrom.readOnly ? "read only" : "");
    pushOptionalText(parts, task.importedFrom.convertToTask ? "convert to task" : "");
  }

  for (const label of task.labels) {
    pushOptionalText(parts, label);
  }

  for (const item of task.checklist) {
    pushOptionalText(parts, item.label);
    pushOptionalText(parts, item.done ? "done" : "");
  }

  for (const attachment of task.attachments) {
    pushOptionalText(parts, attachment.displayName);
    pushOptionalText(parts, attachment.originalName);
    pushOptionalText(parts, attachment.mimeType);
  }

  for (const note of task.notes) {
    pushOptionalText(parts, note.body);
    pushOptionalText(parts, note.authorName);
    pushOptionalText(parts, note.editorName);

    for (const attachment of note.attachments) {
      pushOptionalText(parts, attachment.displayName);
      pushOptionalText(parts, attachment.originalName);
      pushOptionalText(parts, attachment.mimeType);
    }
  }

  for (const subtask of task.subtasks) {
    appendTaskSearchParts(parts, subtask);
  }
}

export function buildTaskSearchText(task: Task, bucketTitle: string) {
  const parts = [bucketTitle];
  appendTaskSearchParts(parts, task);
  return parts.join(" ");
}

// Every query token must start some word in the task, so search-as-you-type
// matches "plan" against "planning" while still requiring all tokens (AND).
function taskTextMatchesTokens(task: Task, bucketTitle: string, queryTokens: string[]) {
  const taskTokens = Array.from(new Set(normalizeSearchText(buildTaskSearchText(task, bucketTitle))));
  return queryTokens.every((queryToken) =>
    taskTokens.some((taskToken) => taskToken.startsWith(queryToken)),
  );
}

export function taskMatchesSearch(task: Task, bucketTitle: string, query: string) {
  const queryTokens = getTaskSearchTokens(query);

  if (queryTokens.length === 0) {
    return true;
  }

  return taskTextMatchesTokens(task, bucketTitle, queryTokens);
}

export function filterBoardByTaskSearch(board: Board, query: string): Board {
  const queryTokens = getTaskSearchTokens(query);

  if (queryTokens.length === 0) {
    return board;
  }

  return {
    ...board,
    buckets: board.buckets.map((bucket) => ({
      ...bucket,
      tasks: bucket.tasks.filter((task) => taskTextMatchesTokens(task, bucket.title, queryTokens)),
    })),
  };
}

export function countRootTasksInBuckets(buckets: Bucket[]) {
  return buckets.reduce((count, bucket) => count + bucket.tasks.length, 0);
}
