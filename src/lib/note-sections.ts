import { noteOutline } from "./note-outline";

export type NoteSection = { id: string; label: string; members: string[] };

// A section ends at a sibling heading of equal/higher rank. Nested block groups
// have their own boundaries; they cannot close a section in the parent group.
export function noteSections(blocks: unknown[]): NoteSection[] {
  const labels = new Map(noteOutline(blocks, true).map(h => [h.id, h.text]));
  const sections: NoteSection[] = [];
  type Scope = { level: number; section: NoteSection };
  const walk = (values: unknown[], inherited: Scope[]) => {
    const siblings: Scope[] = [];
    for (const value of values) {
      if (!value || typeof value !== "object") continue;
      const block = value as Record<string, unknown>;
      const id = typeof block.id === "string" ? block.id : "";
      const props = block.props as { level?: number; isToggleable?: boolean } | undefined;
      if (block.type === "heading") {
        const level = props?.level ?? 1;
        while (siblings.length && siblings.at(-1)!.level >= level) siblings.pop();
      }
      const enclosing = [...inherited, ...siblings];
      if (id) for (const scope of enclosing) scope.section.members.push(id);
      if (block.type === "heading" && id && !props?.isToggleable) {
        const section = { id, label: labels.get(id) ?? "Untitled section", members: [] as string[] };
        sections.push(section);
        siblings.push({ level: props?.level ?? 1, section });
      }
      if (Array.isArray(block.children)) walk(block.children, [...inherited, ...siblings]);
    }
  };
  walk(blocks, []);
  return sections;
}

export function personalFoldKey(viewer: string, note: string) {
  return `taskboard-folio-folds:v1:${viewer}:${note}`;
}

export function movesDraftFolds(previousViewer: string, previousNote: string, viewer: string, note: string) {
  return previousViewer === viewer && previousNote.startsWith("new-note-draft:") && !note.startsWith("new-note-draft:");
}

export function parsePersonalFolds(raw: string | null): Set<string> {
  try {
    const ids: unknown = JSON.parse(raw ?? "[]");
    return new Set(Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200).slice(-500) : []);
  } catch { return new Set(); }
}
