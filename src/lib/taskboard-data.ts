export type TaskStatus = "todo" | "active" | "waiting" | "done";

export type TaskIcon =
  | "flag"
  | "calendar"
  | "sparkles"
  | "rocket"
  | "layers"
  | "message"
  | "bolt"
  | "checklist"
  | "check"
  | "kanban"
  | "folder"
  | "server"
  | "database"
  | "cloud"
  | "terminal"
  | "wrench"
  | "settings"
  | "shield"
  | "bell"
  | "alarm"
  | "file"
  | "spreadsheet"
  | "mail"
  | "phone"
  | "users"
  | "briefcase"
  | "target"
  | "alert"
  | "bug"
  | "hammer"
  | "hard-drive"
  | "network"
  | "git-branch"
  | "package"
  | "archive"
  | "clock"
  | "megaphone"
  | "bookmark"
  | "star"
  | "pin"
  | "lightbulb";

export type BucketIcon =
  | "sun"
  | "brain"
  | "inbox"
  | "kanban"
  | "folder"
  | "server"
  | "database"
  | "wrench"
  | "settings"
  | "shield"
  | "bell"
  | "file"
  | "users"
  | "briefcase"
  | "target"
  | "archive"
  | "megaphone"
  | "lightbulb"
  | "network";

export type CalendarSource = "google" | "ics" | "manual";
export type ViewLayoutMode = "board" | "agenda" | "focus" | "list";

export type CalendarEntry = {
  id: string;
  boardId: string;
  title: string;
  startAt: string;
  endAt: string;
  allDay: boolean;
  location: string;
  description: string;
  color: string;
  updatedAt: string;
  linkedTaskId?: string;
};

export type ViewFilters = {
  statuses?: TaskStatus[];
  labels?: string[];
  due?: "any" | "with" | "without" | "overdue" | "today" | "week";
  source?: "all" | "native" | "imported";
  bucketIds?: string[];
};

export type ViewPreset = {
  id: string;
  name: string;
  layoutMode: ViewLayoutMode;
  filters: ViewFilters;
  hiddenFields: string[];
  displayOptions: Record<string, boolean | string | number>;
};

export type ChecklistItem = {
  id: string;
  label: string;
  done: boolean;
};

export type TaskAttachmentPreviewKind = "image" | "pdf" | "none";

export type TaskRecurrenceFrequency = "daily" | "weekly" | "monthly" | "weekday" | "custom";
export type TaskRecurrenceMode = "on_schedule" | "after_completion";

export type TaskRecurrenceRule = {
  frequency: TaskRecurrenceFrequency;
  interval: number;
  mode: TaskRecurrenceMode;
};

export type TaskReminderConfig = {
  reminderOffsetMinutes: number | null;
  overdueReminderEnabled: boolean;
};

export type TaskNotificationKind = "scheduled" | "overdue";

export type TaskNotification = {
  id: string;
  taskId: string;
  title: string;
  kind: TaskNotificationKind;
  dueAt: string;
  triggerAt: string;
  readAt?: string;
  bucketTitle?: string;
  providerLabel?: string;
};

export type TaskAttachment = {
  id: string;
  noteId?: string;
  originalName: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  previewKind: TaskAttachmentPreviewKind;
};

export type TaskNote = {
  id: string;
  body: string;
  createdAt: string;
  updatedAt?: string;
  authorName: string;
  editorName?: string;
  attachments: TaskAttachment[];
};

export type RecycleBinItem = {
  id: string;
  title: string;
  source: CalendarSource | "native";
  providerLabel: string;
  readOnlyImport: boolean;
  convertedImport: boolean;
  deletedAt: string;
  purgeAfterAt: string;
  originalBucketTitle?: string;
  // Set when the item is a subtask deleted on its own.
  parentTitle?: string;
  attachmentCount: number;
  subtaskCount: number;
};

export type ArchiveItem = {
  id: string;
  title: string;
  source: CalendarSource | "native";
  providerLabel: string;
  readOnlyImport: boolean;
  convertedImport: boolean;
  archivedAt: string;
  completedAt?: string;
  originalBucketTitle?: string;
  attachmentCount: number;
  subtaskCount: number;
};

export type Task = {
  id: string;
  title: string;
  summary: string;
  nextAction?: string;
  status: TaskStatus;
  completedAt?: string;
  createdAt?: string;
  color: string;
  icon: TaskIcon;
  startAt?: string;
  endAt?: string;
  allDay?: boolean;
  dueAt?: string;
  recurrence?: TaskRecurrenceRule;
  reminderConfig?: TaskReminderConfig;
  labels: string[];
  primaryNote?: TaskNote;
  notes: TaskNote[];
  checklist: ChecklistItem[];
  attachments: TaskAttachment[];
  subtasks: Task[];
  workItemType?: "task" | "maintenance_outage";
  maintenanceOutage?: {
    locationId?: string;
    locationName?: string;
    owner: string;
    attendees: string[];
  };
  importedFrom?: {
    source: CalendarSource;
    readOnly: boolean;
    convertToTask: boolean;
    providerLabel: string;
    syncStatus?: "active" | "stale" | "deleted";
    isRecurring?: boolean;
  };
};

export type MaintenanceLocation = {
  id: string;
  name: string;
  isActive: boolean;
};

export type Bucket = {
  id: string;
  title: string;
  color: string;
  icon: BucketIcon;
  collapsed: boolean;
  tasks: Task[];
};

export type Board = {
  id: string;
  title: string;
  description: string;
  views: ViewPreset[];
  buckets: Bucket[];
  maintenanceLocations?: MaintenanceLocation[];
  // Database board revision this snapshot represents (board-revision-schema.ts).
  revision?: number;
};

export const defaultViewPresets: ViewPreset[] = [
  {
    id: "view-board",
    name: "Board",
    layoutMode: "board",
    filters: {},
    hiddenFields: [],
    displayOptions: {},
  },
  {
    id: "view-today",
    name: "Today",
    layoutMode: "agenda",
    filters: { due: "today" },
    hiddenFields: [],
    displayOptions: {},
  },
  {
    id: "view-focus",
    name: "Focus",
    layoutMode: "focus",
    filters: { statuses: ["active"] },
    hiddenFields: [],
    displayOptions: {},
  },
  {
    id: "view-imports",
    name: "Imports",
    layoutMode: "agenda",
    filters: { source: "imported" },
    hiddenFields: [],
    displayOptions: {},
  },
];

// A sample subtask is like any subtask: a title, done or not, and the work
// inside it. Its detail belongs to the task (see subtask-rule.ts).
function sampleSubtask(id: string, title: string, status: "todo" | "done", subtasks: Task[] = []): Task {
  return { id, title, summary: "", status, color: "#64748b", icon: "layers", labels: [], checklist: [], notes: [], attachments: [], subtasks };
}

export const seedBoard: Board = {
  id: "board-personal-command",
  title: "Personal Command Board",
  description:
    "A Planner-style board tuned for solo planning, nested project work, and imported calendar events that can be converted into real tasks when needed.",
  views: defaultViewPresets,
  buckets: [
    {
      id: "bucket-today",
      title: "Today",
      color: "#d97706",
      icon: "sun",
      collapsed: false,
      tasks: [
        {
          id: "task-weekly-review",
          title: "Weekly review and reprioritize the board",
          summary:
            "Clean up the backlog, set focus items, and decide what needs to move into the next sprint bucket.",
          status: "active",
          color: "#ea580c",
          icon: "flag",
          dueAt: "2026-04-17T18:00:00",
          labels: ["Planning", "Review"],
          notes: [
            {
              id: "note-weekly-review-1",
              body:
                "This is the control point task that keeps the whole board useful. The UI should make this kind of recurring planning work feel fast rather than form-heavy.",
              createdAt: "2026-04-17T09:00:00",
              authorName: "Taskboard",
              attachments: [],
            },
          ],
          checklist: [
            { id: "review-1", label: "Archive stale items", done: true },
            { id: "review-2", label: "Pull in new calendar commitments", done: true },
            { id: "review-3", label: "Choose top 3 priorities", done: false },
            { id: "capture-1", label: "Email notes inbox", done: true },
            { id: "capture-2", label: "Phone quick-capture list", done: false },
          ],
          attachments: [],
          subtasks: [
            sampleSubtask("task-review-energy", "Review energy budget for the week", "done"),
            sampleSubtask("task-review-capture", "Capture loose notes into actionable tasks", "todo", [
              sampleSubtask("task-review-capture-phone", "Clear starred notes on iPhone", "todo"),
            ]),
          ],
        },
        {
          id: "task-google-focus",
          title: "Imported: product design sync",
          summary:
            "Pulled in from Google Calendar as a read-only event. It can stay informational or be converted into a task.",
          status: "waiting",
          color: "#0f766e",
          icon: "calendar",
          dueAt: "2026-04-18T09:30:00",
          labels: ["Imported", "Meeting"],
          notes: [
            {
              id: "note-google-focus-1",
              body:
                "Imported events should default to read-only so the sync model stays sane, then allow a one-click conversion to a normal task if follow-up work is needed.",
              createdAt: "2026-04-18T09:30:00",
              authorName: "Taskboard",
              attachments: [],
            },
          ],
          checklist: [
            { id: "meeting-1", label: "Review agenda", done: false },
            { id: "meeting-2", label: "Capture follow-up task", done: false },
          ],
          attachments: [],
          subtasks: [],
          importedFrom: {
            source: "google",
            readOnly: true,
            convertToTask: true,
            providerLabel: "Google Calendar",
          },
        },
      ],
    },
    {
      id: "bucket-deep-work",
      title: "Deep Work",
      color: "#155e75",
      icon: "brain",
      collapsed: false,
      tasks: [
        {
          id: "task-self-hosted-app",
          title: "Build self-hosted planner app",
          summary:
            "Design the MVP with drag-and-drop buckets, nested subtasks, checklists, color customization, and calendar imports.",
          status: "active",
          color: "#0f766e",
          icon: "rocket",
          dueAt: "2026-04-21T17:00:00",
          labels: ["Product", "Build"],
          notes: [
            {
              id: "note-self-hosted-app-1",
              body:
                "This is the anchor project. It needs a real data model for unlimited nested subtasks, separate checklist items, and imported event records that can become tasks.",
              createdAt: "2026-04-19T10:00:00",
              authorName: "Taskboard",
              attachments: [],
            },
          ],
          checklist: [
            { id: "build-1", label: "Lock product behavior for imports", done: true },
            { id: "build-2", label: "Sketch schema and sync model", done: false },
            { id: "build-3", label: "Prototype responsive board UI", done: false },
            { id: "schema-1", label: "tasks.parent_task_id", done: true },
            { id: "schema-2", label: "checklist_items table", done: true },
            { id: "schema-3", label: "saved view presets", done: false },
          ],
          attachments: [],
          subtasks: [
            sampleSubtask("task-app-schema", "Define schema for boards, buckets, tasks, and views", "todo"),
            sampleSubtask("task-app-sync", "Model one-way calendar ingestion", "todo", [
              sampleSubtask("task-app-sync-google", "Google incremental sync worker", "todo"),
              sampleSubtask("task-app-sync-ics", "Manual .ics import flow", "todo"),
            ]),
          ],
        },
        {
          id: "task-calendar-event",
          title: "Imported: vendor check-in",
          summary:
            ".ics event imported as context only. Use convert-to-task if it creates actual follow-up work.",
          status: "waiting",
          color: "#334155",
          icon: "calendar",
          dueAt: "2026-04-19T13:00:00",
          labels: ["Imported", "Calendar"],
          checklist: [],
          notes: [],
          attachments: [],
          subtasks: [],
          importedFrom: {
            source: "ics",
            readOnly: true,
            convertToTask: true,
            providerLabel: ".ics import",
          },
        },
      ],
    },
    {
      id: "bucket-later",
      title: "Waiting / Later",
      color: "#475569",
      icon: "inbox",
      collapsed: true,
      tasks: [
        {
          id: "task-theme-system",
          title: "Design custom view presets",
          summary:
            "Make it easy to switch between minimal, dense, and agenda-oriented views without changing the data itself.",
          status: "todo",
          color: "#6366f1",
          icon: "sparkles",
          labels: ["UX"],
          checklist: [
            { id: "preset-1", label: "Compact card mode", done: false },
            { id: "preset-2", label: "Hide imported events", done: false },
          ],
          notes: [],
          attachments: [],
          subtasks: [],
        },
      ],
    },
    {
      id: "bucket-admin",
      title: "Admin",
      color: "#8b5cf6",
      icon: "brain",
      collapsed: false,
      tasks: [
        {
          id: "task-admin-reconcile",
          title: "Reconcile recurring admin tasks",
          summary: "Keep low-energy operational work visible but compact.",
          status: "todo",
          color: "#8b5cf6",
          icon: "layers",
          labels: ["Admin"],
          checklist: [
            { id: "admin-1", label: "Invoice review", done: false },
            { id: "admin-2", label: "Password cleanup", done: false },
          ],
          notes: [],
          attachments: [],
          subtasks: [],
        },
      ],
    },
    {
      id: "bucket-ideas",
      title: "Ideas",
      color: "#0891b2",
      icon: "sun",
      collapsed: false,
      tasks: [
        {
          id: "task-ideas-capture",
          title: "Capture rough product ideas",
          summary: "Quick holding area before ideas become real project work.",
          status: "todo",
          color: "#0891b2",
          icon: "sparkles",
          labels: ["Ideas"],
          checklist: [],
          notes: [],
          attachments: [],
          subtasks: [],
        },
      ],
    },
    {
      id: "bucket-errands",
      title: "Errands",
      color: "#65a30d",
      icon: "inbox",
      collapsed: false,
      tasks: [
        {
          id: "task-errands-batch",
          title: "Batch short errands",
          summary: "Small real-world tasks grouped for one outing.",
          status: "waiting",
          color: "#65a30d",
          icon: "flag",
          labels: ["Errands"],
          checklist: [],
          notes: [],
          attachments: [],
          subtasks: [],
        },
      ],
    },
  ],
};
