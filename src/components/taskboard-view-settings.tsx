import { useState } from "react";
import {
  CHIP_BUTTON_ACTIVE_CLASS,
  COMPACT_INPUT_CLASS,
  COMPACT_LABEL_CLASS,
  COMPACT_PRIMARY_BUTTON_CLASS,
  COMPACT_SURFACE_BUTTON_CLASS,
  SMALL_CHIP_BUTTON_CLASS,
} from "@/components/taskboard-constants";
import type {
  Bucket,
  TaskStatus,
  ViewFilters,
  ViewLayoutMode,
  ViewPreset,
} from "@/lib/taskboard-data";

type ViewSourceFilter = NonNullable<ViewFilters["source"]>;
type ViewDueFilter = NonNullable<ViewFilters["due"]>;

const taskStatusOptions: ReadonlyArray<{ value: TaskStatus; label: string }> = [
  { value: "todo", label: "Todo" },
  { value: "active", label: "Active" },
  { value: "waiting", label: "Waiting" },
  { value: "done", label: "Done" },
];

const viewLayoutOptions: ReadonlyArray<{ value: ViewLayoutMode; label: string }> = [
  { value: "board", label: "Board" },
  { value: "agenda", label: "Agenda" },
  { value: "focus", label: "Focus" },
];

const dueFilterOptions: ReadonlyArray<{ value: ViewDueFilter; label: string }> = [
  { value: "any", label: "Any due date" },
  { value: "with", label: "Has due date" },
  { value: "without", label: "No due date" },
  { value: "overdue", label: "Overdue" },
  { value: "today", label: "Today" },
  { value: "week", label: "Next 7 days" },
];

const sourceFilterOptions: ReadonlyArray<{ value: ViewSourceFilter; label: string }> = [
  { value: "all", label: "All tasks" },
  { value: "native", label: "Native only" },
  { value: "imported", label: "Imported only" },
];

export function ViewSettingsPanel({
  view,
  buckets,
  labels,
  onCancel,
  onSave,
}: {
  view: ViewPreset;
  buckets: Bucket[];
  labels: string[];
  onCancel: () => void;
  onSave: (patch: { name: string; layoutMode: ViewLayoutMode; filters: ViewFilters }) => void;
}) {
  const [draftName, setDraftName] = useState(view.name);
  const [draftLayoutMode, setDraftLayoutMode] = useState<ViewLayoutMode>(
    view.layoutMode === "list" ? "board" : view.layoutMode,
  );
  const [draftStatuses, setDraftStatuses] = useState<TaskStatus[]>(view.filters.statuses ?? []);
  const [draftLabels, setDraftLabels] = useState((view.filters.labels ?? []).join(", "));
  const [draftDue, setDraftDue] = useState<ViewDueFilter>(view.filters.due ?? "any");
  const [draftSource, setDraftSource] = useState<ViewSourceFilter>(view.filters.source ?? "all");
  const [draftBucketIds, setDraftBucketIds] = useState<string[]>(view.filters.bucketIds ?? []);

  const selectedBucketCount =
    draftBucketIds.length === 0 ? buckets.length : draftBucketIds.length;

  const toggleStatus = (status: TaskStatus) => {
    setDraftStatuses((current) =>
      current.includes(status)
        ? current.filter((value) => value !== status)
        : [...current, status],
    );
  };

  const toggleBucket = (bucketId: string) => {
    setDraftBucketIds((current) => {
      const normalizedCurrent =
        current.length === 0 ? buckets.map((bucket) => bucket.id) : current;
      const next = normalizedCurrent.includes(bucketId)
        ? normalizedCurrent.filter((value) => value !== bucketId)
        : [...normalizedCurrent, bucketId];

      if (next.length === 0 || next.length === buckets.length) {
        return [];
      }

      return next;
    });
  };

  const handleSave = () => {
    const name = draftName.trim();

    if (!name) {
      return;
    }

    onSave({
      name,
      layoutMode: draftLayoutMode,
      filters: buildViewFiltersFromDraft({
        statuses: draftStatuses,
        labelText: draftLabels,
        due: draftDue,
        source: draftSource,
        bucketIds: draftBucketIds,
        bucketCount: buckets.length,
      }),
    });
  };

  return (
    <div className="taskboard-popover mt-2 rounded-[18px] border p-2">
      <div className="mb-2">
        <p className={COMPACT_LABEL_CLASS}>View settings</p>
      </div>
      <div className="grid gap-2 lg:grid-cols-[minmax(170px,0.8fr)_minmax(0,1.5fr)_minmax(0,1.1fr)]">
        <label className="block">
          <span className={COMPACT_LABEL_CLASS}>View name</span>
          <input
            value={draftName}
            onChange={(event) => setDraftName(event.target.value)}
            className={COMPACT_INPUT_CLASS}
          />
        </label>

        <div>
          <span className={COMPACT_LABEL_CLASS}>Layout</span>
          <div className="flex flex-wrap gap-1">
            {viewLayoutOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setDraftLayoutMode(option.value)}
                className={
                  draftLayoutMode === option.value
                    ? CHIP_BUTTON_ACTIVE_CLASS
                    : SMALL_CHIP_BUTTON_CLASS
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className={COMPACT_LABEL_CLASS}>Labels</span>
          <input
            value={draftLabels}
            onChange={(event) => setDraftLabels(event.target.value)}
            placeholder={labels.length ? labels.join(", ") : "Planning, Review"}
            className={COMPACT_INPUT_CLASS}
          />
        </label>
      </div>

      <div className="mt-2 grid gap-2 lg:grid-cols-[minmax(0,1.1fr)_minmax(130px,0.7fr)_minmax(130px,0.7fr)]">
        <div>
          <span className={COMPACT_LABEL_CLASS}>Status</span>
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              onClick={() => setDraftStatuses([])}
              className={
                draftStatuses.length === 0
                  ? CHIP_BUTTON_ACTIVE_CLASS
                  : SMALL_CHIP_BUTTON_CLASS
              }
            >
              All
            </button>
            {taskStatusOptions.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => toggleStatus(option.value)}
                className={
                  draftStatuses.includes(option.value)
                    ? CHIP_BUTTON_ACTIVE_CLASS
                    : SMALL_CHIP_BUTTON_CLASS
                }
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        <label className="block">
          <span className={COMPACT_LABEL_CLASS}>Due</span>
          <select
            value={draftDue}
            onChange={(event) => setDraftDue(event.target.value as ViewDueFilter)}
            className={COMPACT_INPUT_CLASS}
          >
            {dueFilterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className={COMPACT_LABEL_CLASS}>Source</span>
          <select
            value={draftSource}
            onChange={(event) => setDraftSource(event.target.value as ViewSourceFilter)}
            className={COMPACT_INPUT_CLASS}
          >
            {sourceFilterOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="mt-2">
        <div className="flex items-center justify-between gap-2">
          <span className={COMPACT_LABEL_CLASS}>Buckets</span>
          <button
            type="button"
            onClick={() => setDraftBucketIds([])}
            className={SMALL_CHIP_BUTTON_CLASS}
          >
            All buckets ({selectedBucketCount})
          </button>
        </div>
        <div className="flex flex-wrap gap-1">
          {buckets.map((bucket) => {
            const selected = draftBucketIds.length === 0 || draftBucketIds.includes(bucket.id);

            return (
              <button
                key={bucket.id}
                type="button"
                onClick={() => toggleBucket(bucket.id)}
                className={selected ? CHIP_BUTTON_ACTIVE_CLASS : SMALL_CHIP_BUTTON_CLASS}
              >
                {bucket.title}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-2 flex justify-end gap-1.5">
        <button type="button" onClick={onCancel} className={COMPACT_SURFACE_BUTTON_CLASS}>
          Cancel
        </button>
        <button
          type="button"
          onClick={handleSave}
          disabled={!draftName.trim()}
          className={`${COMPACT_PRIMARY_BUTTON_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          Save view
        </button>
      </div>
    </div>
  );
}

function buildViewFiltersFromDraft({
  statuses,
  labelText,
  due,
  source,
  bucketIds,
  bucketCount,
}: {
  statuses: TaskStatus[];
  labelText: string;
  due: ViewDueFilter;
  source: ViewSourceFilter;
  bucketIds: string[];
  bucketCount: number;
}): ViewFilters {
  const filters: ViewFilters = {};
  const labels = parseLabelInput(labelText);
  const uniqueStatuses = Array.from(new Set(statuses));
  const uniqueBucketIds = Array.from(new Set(bucketIds));

  if (uniqueStatuses.length > 0 && uniqueStatuses.length < taskStatusOptions.length) {
    filters.statuses = uniqueStatuses;
  }

  if (labels.length > 0) {
    filters.labels = labels;
  }

  if (due !== "any") {
    filters.due = due;
  }

  if (source !== "all") {
    filters.source = source;
  }

  if (uniqueBucketIds.length > 0 && uniqueBucketIds.length < bucketCount) {
    filters.bucketIds = uniqueBucketIds;
  }

  return filters;
}

function parseLabelInput(value: string) {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((label) => label.trim())
        .filter(Boolean),
    ),
  );
}
