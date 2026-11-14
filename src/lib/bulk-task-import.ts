import type { TaskStatus } from "@/lib/taskboard-data";

export const bulkTaskImportVersion = 1 as const;
export const bulkTaskImportSource = "taskboard-json" as const;

const bulkTaskStatuses = new Set<TaskStatus>(["todo", "active", "waiting", "done"]);
const allowedRootKeys = new Set(["version", "source", "rangeLabel", "tasks"]);
const allowedTaskKeys = new Set(["bucket", "title", "summary", "nextAction", "note", "labels", "status", "dueAt"]);

export type BulkTaskImportTaskInput = {
  bucket: string;
  title: string;
  summary?: string;
  nextAction?: string;
  note?: string;
  labels?: string[];
  status?: TaskStatus;
  dueAt?: string | null;
};

export type BulkTaskImportTask = {
  bucket: string;
  title: string;
  summary: string;
  nextAction: string;
  note: string;
  labels: string[];
  status: TaskStatus;
  dueAt: string | null;
};

export type BulkTaskImportPayload = {
  version: typeof bulkTaskImportVersion;
  source: string;
  rangeLabel: string;
  tasks: BulkTaskImportTask[];
};

export type BulkTaskImportBucketMapping = {
  sourceBucket: string;
  targetBucketId: string;
};

export type BulkTaskImportNewBucket = {
  sourceBucket: string;
  title: string;
};

export type BulkTaskImportSubmission = BulkTaskImportPayload & {
  bucketMappings?: BulkTaskImportBucketMapping[];
  newBuckets?: BulkTaskImportNewBucket[];
};

export type BulkTaskImportParseResult = {
  payload: BulkTaskImportPayload;
  warnings: string[];
};

export function stripBulkTaskImportCodeFence(raw: string) {
  const trimmed = raw.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  return (fencedMatch?.[1] ?? trimmed).trim();
}

export function parseBulkTaskImportText(raw: string): BulkTaskImportParseResult {
  const candidate = JSON.parse(stripBulkTaskImportCodeFence(raw)) as unknown;
  return normalizeBulkTaskImportPayload(candidate);
}

export function normalizeBulkTaskImportPayload(candidate: unknown): BulkTaskImportParseResult {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Bulk import content must be a JSON object.");
  }

  const record = candidate as Record<string, unknown>;
  const warnings: string[] = [];
  const unknownRootKeys = Object.keys(record).filter((key) => !allowedRootKeys.has(key));
  if (unknownRootKeys.length > 0) {
    warnings.push(`Ignored unsupported root fields: ${unknownRootKeys.join(", ")}.`);
  }

  if (record.version !== bulkTaskImportVersion) {
    throw new Error(`Bulk import version must be ${bulkTaskImportVersion}.`);
  }

  if (!Array.isArray(record.tasks) || record.tasks.length === 0) {
    throw new Error("Bulk import content must include a non-empty tasks array.");
  }

  const source =
    typeof record.source === "string" && record.source.trim()
      ? record.source.trim()
      : bulkTaskImportSource;
  const rangeLabel =
    typeof record.rangeLabel === "string" && record.rangeLabel.trim()
      ? record.rangeLabel.trim()
      : "";

  return {
    payload: {
      version: bulkTaskImportVersion,
      source,
      rangeLabel,
      tasks: record.tasks.map((task, index) => normalizeBulkTaskImportTask(task, index, warnings)),
    },
    warnings,
  };
}

export function normalizeBulkTaskImportSubmission(
  candidate: unknown,
): { submission: BulkTaskImportSubmission; warnings: string[] } {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error("Bulk import submission must be a JSON object.");
  }

  const record = candidate as Record<string, unknown>;
  const { payload, warnings } = normalizeBulkTaskImportPayload(record);

  const bucketMappings = Array.isArray(record.bucketMappings)
    ? record.bucketMappings.map((entry, index) => normalizeBucketMapping(entry, index))
    : undefined;
  const newBuckets = Array.isArray(record.newBuckets)
    ? record.newBuckets.map((entry, index) => normalizeNewBucket(entry, index))
    : undefined;

  return {
    submission: {
      ...payload,
      ...(bucketMappings ? { bucketMappings } : {}),
      ...(newBuckets ? { newBuckets } : {}),
    },
    warnings,
  };
}

function normalizeBulkTaskImportTask(
  candidate: unknown,
  index: number,
  warnings: string[],
): BulkTaskImportTask {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error(`Task ${index + 1} must be an object.`);
  }

  const record = candidate as Record<string, unknown>;
  const unknownKeys = Object.keys(record).filter((key) => !allowedTaskKeys.has(key));
  if (unknownKeys.length > 0) {
    warnings.push(`Task ${index + 1}: ignored unsupported fields: ${unknownKeys.join(", ")}.`);
  }

  const bucket = requireTrimmedString(record.bucket, `Task ${index + 1} bucket`);
  const title = requireTrimmedString(record.title, `Task ${index + 1} title`);
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  const nextAction = typeof record.nextAction === "string" ? record.nextAction.trim() : "";
  const note = typeof record.note === "string" ? record.note.trim() : "";
  const labels = Array.isArray(record.labels)
    ? Array.from(
        new Set(
          record.labels
            .map((label) => String(label).trim())
            .filter(Boolean),
        ),
      )
    : [];
  const status = normalizeTaskStatus(record.status);
  const dueAt = normalizeDueAt(record.dueAt, index);

  return {
    bucket,
    title,
    summary,
    nextAction,
    note,
    labels,
    status,
    dueAt,
  };
}

function normalizeBucketMapping(candidate: unknown, index: number): BulkTaskImportBucketMapping {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error(`Bucket mapping ${index + 1} must be an object.`);
  }

  const record = candidate as Record<string, unknown>;
  return {
    sourceBucket: requireTrimmedString(record.sourceBucket, `Bucket mapping ${index + 1} sourceBucket`),
    targetBucketId: requireTrimmedString(record.targetBucketId, `Bucket mapping ${index + 1} targetBucketId`),
  };
}

function normalizeNewBucket(candidate: unknown, index: number): BulkTaskImportNewBucket {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error(`New bucket ${index + 1} must be an object.`);
  }

  const record = candidate as Record<string, unknown>;
  return {
    sourceBucket: requireTrimmedString(record.sourceBucket, `New bucket ${index + 1} sourceBucket`),
    title: requireTrimmedString(record.title, `New bucket ${index + 1} title`),
  };
}

function requireTrimmedString(candidate: unknown, fieldName: string) {
  if (typeof candidate !== "string" || !candidate.trim()) {
    throw new Error(`${fieldName} is required.`);
  }

  return candidate.trim();
}

function normalizeTaskStatus(candidate: unknown): TaskStatus {
  if (candidate === undefined || candidate === null || candidate === "") {
    return "todo";
  }

  if (typeof candidate !== "string" || !bulkTaskStatuses.has(candidate as TaskStatus)) {
    throw new Error("Task status must be one of: todo, active, waiting, done.");
  }

  return candidate as TaskStatus;
}

function normalizeDueAt(candidate: unknown, index: number) {
  if (candidate === undefined || candidate === null || candidate === "") {
    return null;
  }

  if (typeof candidate !== "string") {
    throw new Error(`Task ${index + 1} dueAt must be a string when provided.`);
  }

  const trimmed = candidate.trim();
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Task ${index + 1} dueAt must be a valid ISO date or datetime.`);
  }

  return trimmed;
}
