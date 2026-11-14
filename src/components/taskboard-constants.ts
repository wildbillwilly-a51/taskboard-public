import {
  AlarmClock,
  Archive,
  Bell,
  Bookmark,
  Brain,
  BriefcaseBusiness,
  Bug,
  CalendarRange,
  CircleAlert,
  CircleCheckBig,
  ClipboardList,
  Clock3,
  Cloud,
  Database,
  FileSpreadsheet,
  FileText,
  Flag,
  FolderKanban,
  GitBranch,
  Hammer,
  HardDrive,
  Inbox,
  KanbanSquare,
  Layers3,
  Lightbulb,
  Mail,
  Megaphone,
  MessageSquare,
  Monitor,
  Moon,
  Network,
  PackageCheck,
  Phone,
  Pin,
  Rocket,
  Server,
  Settings,
  ShieldCheck,
  Sparkles,
  Star,
  SunMedium,
  Target,
  Terminal,
  Users,
  Wrench,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type {
  BucketIcon,
  CalendarSource,
  TaskIcon,
  TaskStatus,
} from "@/lib/taskboard-data";

export const taskIcons: Record<TaskIcon, LucideIcon> = {
  flag: Flag,
  calendar: CalendarRange,
  sparkles: Sparkles,
  rocket: Rocket,
  layers: Layers3,
  message: MessageSquare,
  bolt: Zap,
  checklist: ClipboardList,
  check: CircleCheckBig,
  kanban: KanbanSquare,
  folder: FolderKanban,
  server: Server,
  database: Database,
  cloud: Cloud,
  terminal: Terminal,
  wrench: Wrench,
  settings: Settings,
  shield: ShieldCheck,
  bell: Bell,
  alarm: AlarmClock,
  file: FileText,
  spreadsheet: FileSpreadsheet,
  mail: Mail,
  phone: Phone,
  users: Users,
  briefcase: BriefcaseBusiness,
  target: Target,
  alert: CircleAlert,
  bug: Bug,
  hammer: Hammer,
  "hard-drive": HardDrive,
  network: Network,
  "git-branch": GitBranch,
  package: PackageCheck,
  archive: Archive,
  clock: Clock3,
  megaphone: Megaphone,
  bookmark: Bookmark,
  star: Star,
  pin: Pin,
  lightbulb: Lightbulb,
};

export const bucketIcons: Record<BucketIcon, LucideIcon> = {
  sun: SunMedium,
  brain: Brain,
  inbox: Inbox,
  kanban: KanbanSquare,
  folder: FolderKanban,
  server: Server,
  database: Database,
  wrench: Wrench,
  settings: Settings,
  shield: ShieldCheck,
  bell: Bell,
  file: FileText,
  users: Users,
  briefcase: BriefcaseBusiness,
  target: Target,
  archive: Archive,
  megaphone: Megaphone,
  lightbulb: Lightbulb,
  network: Network,
};

export const taskColorOptions = [
  { value: "#ea580c", label: "Ember" },
  { value: "#d97706", label: "Amber" },
  { value: "#0f766e", label: "Teal" },
  { value: "#0891b2", label: "Cyan" },
  { value: "#2563eb", label: "Blue" },
  { value: "#6366f1", label: "Indigo" },
  { value: "#8b5cf6", label: "Violet" },
  { value: "#65a30d", label: "Lime" },
  { value: "#475569", label: "Slate" },
] as const;

export { bucketColorOptions } from "@/lib/bucket-colors";

export const taskIconOptions = [
  { value: "flag", label: "Flag" },
  { value: "calendar", label: "Calendar" },
  { value: "sparkles", label: "Sparkles" },
  { value: "rocket", label: "Rocket" },
  { value: "layers", label: "Layers" },
  { value: "message", label: "Message" },
  { value: "bolt", label: "Bolt" },
  { value: "checklist", label: "Checklist" },
  { value: "check", label: "Check" },
  { value: "kanban", label: "Kanban" },
  { value: "folder", label: "Folder" },
  { value: "server", label: "Server" },
  { value: "database", label: "Database" },
  { value: "cloud", label: "Cloud" },
  { value: "terminal", label: "Terminal" },
  { value: "wrench", label: "Wrench" },
  { value: "settings", label: "Settings" },
  { value: "shield", label: "Shield" },
  { value: "bell", label: "Bell" },
  { value: "alarm", label: "Alarm" },
  { value: "file", label: "File" },
  { value: "spreadsheet", label: "Spreadsheet" },
  { value: "mail", label: "Mail" },
  { value: "phone", label: "Phone" },
  { value: "users", label: "Users" },
  { value: "briefcase", label: "Briefcase" },
  { value: "target", label: "Target" },
  { value: "alert", label: "Alert" },
  { value: "bug", label: "Bug" },
  { value: "hammer", label: "Hammer" },
  { value: "hard-drive", label: "Hard Drive" },
  { value: "network", label: "Network" },
  { value: "git-branch", label: "Git Branch" },
  { value: "package", label: "Package" },
  { value: "archive", label: "Archive" },
  { value: "clock", label: "Clock" },
  { value: "megaphone", label: "Megaphone" },
  { value: "bookmark", label: "Bookmark" },
  { value: "star", label: "Star" },
  { value: "pin", label: "Pin" },
  { value: "lightbulb", label: "Lightbulb" },
] as const satisfies ReadonlyArray<{ value: TaskIcon; label: string }>;

export const bucketIconOptions = [
  { value: "sun", label: "Sun" },
  { value: "brain", label: "Brain" },
  { value: "inbox", label: "Inbox" },
  { value: "kanban", label: "Kanban" },
  { value: "folder", label: "Folder" },
  { value: "server", label: "Server" },
  { value: "database", label: "Database" },
  { value: "wrench", label: "Wrench" },
  { value: "settings", label: "Settings" },
  { value: "shield", label: "Shield" },
  { value: "bell", label: "Bell" },
  { value: "file", label: "File" },
  { value: "users", label: "Users" },
  { value: "briefcase", label: "Briefcase" },
  { value: "target", label: "Target" },
  { value: "archive", label: "Archive" },
  { value: "megaphone", label: "Megaphone" },
  { value: "lightbulb", label: "Lightbulb" },
  { value: "network", label: "Network" },
] as const satisfies ReadonlyArray<{ value: BucketIcon; label: string }>;

export const themeOptions = [
  { value: "light", label: "Light", icon: SunMedium },
  { value: "dark", label: "Dark", icon: Moon },
  { value: "system", label: "System", icon: Monitor },
] as const;

export const sourceLabels: Record<CalendarSource, string> = {
  google: "Google",
  ics: ".ics",
  manual: "Manual",
};

export const COMPACT_LABEL_CLASS =
  "mb-0.5 block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted";
export const COMPACT_BODY_TEXT_CLASS = "text-[10px] leading-4";
export const COMPACT_CONTROL_TEXT_CLASS = "text-[11px] leading-4";
export const COMPACT_INPUT_CLASS =
  "ui-control ui-select h-7 w-full rounded-[7px] border px-2 py-0.5 text-[11px] leading-4 text-foreground outline-none transition";
export const COMPACT_INLINE_INPUT_CLASS =
  "ui-control ui-inline-input h-7 min-w-0 flex-1 rounded-[7px] border px-1.5 py-0.5 text-[10px] leading-4 text-foreground outline-none transition";
export const COMPACT_MENU_ITEM_CLASS =
  "ui-menu-item flex w-full items-center rounded-[7px] px-2 py-1.5 text-left text-[11px] font-medium leading-4 text-foreground transition";
// Task editor controls take a role from skins/editor-scale.css, which owns their
// type and control size. Outside the editor the roles keep the board scale.
export const TASK_EDITOR_LABEL_CLASS = "ed-label mb-0.5 block text-muted";
export const TASK_EDITOR_TEXT_CLASS = "task-editor-text ed-body";
export const TASK_EDITOR_MUTED_TEXT_CLASS = `${TASK_EDITOR_TEXT_CLASS} text-muted`;
export const TASK_EDITOR_ITEM_TEXT_CLASS = "task-editor-item-text ed-body font-medium";
export const TASK_EDITOR_INPUT_CLASS =
  "ui-control ui-select ed-field w-full min-w-0 max-w-full rounded-[7px] border text-foreground outline-none transition";
export const TASK_EDITOR_SELECT_CLASS = TASK_EDITOR_INPUT_CLASS;
// Titles edit in place with the title role instead of field metrics.
export const TASK_EDITOR_TITLE_INPUT_CLASS =
  "ui-control ui-select ed-title w-full min-w-0 max-w-full whitespace-normal break-words rounded-[10px] border text-foreground outline-none transition";
export const TASK_EDITOR_BUTTON_CLASS =
  "ui-button ed-button inline-flex items-center gap-1 rounded-[7px] transition";
export const TASK_EDITOR_INLINE_INPUT_CLASS =
  "ui-control ui-inline-input ed-field min-w-0 flex-1 rounded-[7px] border text-foreground outline-none transition";
export const TASK_EDITOR_INLINE_BUTTON_CLASS =
  "ui-button ui-inline-button ed-button rounded-[7px] border transition";
export const TASK_ATTACHMENT_ACTION_BUTTON_CLASS =
  `${TASK_EDITOR_INLINE_BUTTON_CLASS} inline-flex max-w-full items-center justify-center gap-1 whitespace-nowrap align-middle [&>svg]:shrink-0`;
export const TASK_EDITOR_MENU_ITEM_CLASS =
  "ui-menu-item ed-menu-item flex w-full items-center gap-1.5 rounded-[7px] text-left font-medium text-foreground transition";
export const TINY_META_CLASS = "text-[10px] font-semibold uppercase tracking-[0.14em] text-muted";
export const BOARD_TITLE_EDIT_INPUT_CLASS =
  "ui-control rounded-[10px] border px-2 py-1 text-[11px] font-semibold leading-4 text-foreground outline-none";
export const BOARD_DESCRIPTION_EDIT_INPUT_CLASS =
  "ui-control rounded-[10px] border px-2 py-1 text-[10px] leading-4 text-muted outline-none";
export const COMPACT_PRIMARY_BUTTON_CLASS =
  "ui-button ui-button-primary rounded-[10px] px-2.5 py-1 text-[11px] font-medium leading-4";
export const COMPACT_SURFACE_BUTTON_CLASS =
  "ui-button ui-button-surface rounded-[10px] border px-2.5 py-1 text-[11px] font-medium leading-4";
export const ADD_TASK_ACTION_CLASS =
  "h-7 rounded-[8px] px-2 py-0.5 text-[10px] font-medium leading-4";
export const ADD_TASK_BUTTON_CLASS =
  "taskboard-add-button rounded-[12px] border border-dashed border-border/60 px-3 py-1 text-[10px] font-medium leading-4 transition";
export const EMPTY_STATE_TEXT_CLASS = `${COMPACT_BODY_TEXT_CLASS} text-muted`;
export const BUCKET_TITLE_CLASS =
  "taskboard-bucket-title block truncate text-[13px] font-bold leading-4 tracking-[-0.01em] text-foreground";
export const BUCKET_MESSAGE_TITLE_CLASS = "text-[11px] font-medium leading-4 text-foreground";
export const TASK_CARD_TITLE_CLASS = "taskboard-card-title line-clamp-2 text-[11px] font-semibold leading-4 text-foreground";
export const TASK_CARD_BODY_CLASS = `${COMPACT_BODY_TEXT_CLASS} text-muted`;
export const AGENDA_TITLE_CLASS = "truncate text-[13px] font-semibold leading-5 text-foreground";
export const AGENDA_META_CLASS = "text-[10px] font-medium leading-4 text-muted";
export const AGENDA_BADGE_CLASS =
  "taskboard-agenda-badge shrink-0 rounded-[10px] px-2.5 py-1 text-[10px] font-medium leading-4";
export const CHIP_BUTTON_CLASS =
  "ui-chip-button ui-button-surface inline-flex h-7 items-center gap-1 rounded-[11px] border px-2 py-1 text-[11px] font-medium leading-4 transition sm:px-2.5";
export const SMALL_CHIP_BUTTON_CLASS =
  "ui-chip-button ui-button-surface inline-flex h-7 items-center gap-1 rounded-[10px] border px-2 py-0.5 text-[11px] font-medium leading-4 transition";
export const CHIP_BUTTON_ACTIVE_CLASS =
  "ui-chip-button ui-chip-active inline-flex h-7 items-center gap-1 rounded-[10px] border px-2 py-0.5 text-[11px] font-medium leading-4 transition";
export const ICON_BUTTON_CLASS =
  "ui-button ui-button-surface inline-flex items-center justify-center rounded-full border p-1.5 leading-none text-muted transition hover:text-foreground";

// The task sidebar's status buttons, in order, with each one's pressed look.
// The work tab's subtask panel uses the same buttons.
export const sidebarStatusButtonOptions: ReadonlyArray<{
  value: TaskStatus;
  label: string;
  activeClassName: string;
}> = [
  {
    value: "active",
    label: "Active",
    activeClassName: "border-amber-400/90 bg-amber-500/10 ring-1 ring-amber-400/35",
  },
  {
    value: "todo",
    label: "Todo",
    activeClassName: "border-slate-400/90 bg-slate-500/10 ring-1 ring-slate-400/35",
  },
  {
    value: "waiting",
    label: "Waiting",
    activeClassName: "border-sky-400/90 bg-sky-500/10 ring-1 ring-sky-400/35",
  },
  {
    value: "done",
    label: "Done",
    activeClassName: "border-emerald-400/90 bg-emerald-500/10 ring-1 ring-emerald-400/35",
  },
];
