// The outline is a view of heading blocks, never another stored document.
export type NoteHeading = { id: string; text: string; level: number; depth: number; ancestors: string[] };

function inlineText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(inlineText).join("");
  if (!value || typeof value !== "object") return "";
  const node = value as Record<string, unknown>;
  if (node.type === "pageMention") return "Wiki page";
  return typeof node.text === "string" ? node.text : inlineText(node.content);
}

export function noteOutline(blocks: unknown[], editing = false): NoteHeading[] {
  const headings: NoteHeading[] = [];
  const stack: { level: number; visible: boolean }[] = [];
  const walk = (blocks: unknown[], ancestors: string[]) => {
    for (const value of blocks) {
      if (!value || typeof value !== "object") continue;
      const block = value as Record<string, unknown>;
      const id = typeof block.id === "string" ? block.id : "";
      if (block.type === "heading" && id) {
        const text = inlineText(block.content).replace(/\s+/g, " ").trim();
        const raw = (block.props as { level?: unknown } | undefined)?.level;
        const level = typeof raw === "number" && Number.isInteger(raw) && raw >= 1 && raw <= 6 ? raw : 1;
        while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
        // Hidden blank headings still delimit the hierarchy of later headings.
        const heading = { id, text: text || "Untitled section", level, depth: stack.filter(h => h.visible).length, ancestors };
        stack.push({ level, visible: Boolean(text) || editing });
        if (text || editing) headings.push(heading);
      }
      if (Array.isArray(block.children)) walk(block.children, id ? [...ancestors, id] : ancestors);
    }
  };
  walk(blocks, []);
  return headings;
}

export function sectionHref(noteId: string, blockId: string): string {
  return `/folio?note=${encodeURIComponent(noteId)}#section=${encodeURIComponent(blockId)}`;
}

export function sectionFromHash(hash: string): string | null {
  if (!hash.startsWith("#section=")) return null;
  try {
    const id = decodeURIComponent(hash.slice(9));
    return id && id.length <= 200 && !/[\u0000-\u001f\u007f]/.test(id) ? id : null;
  } catch { return null; }
}

// Call only at an explicit write boundary. Keep IDs that already identify blocks,
// and never derive identity from text, heading level, or document position.
export function withNoteBlockIds(blocks: unknown[], makeId: () => string): unknown[] {
  const reserved = new Set<string>();
  const collect = (values: unknown[]) => {
    for (const v of values) {
      if (!v || typeof v !== "object") continue;
      const node = v as Record<string, unknown>;
      if (typeof node.id === "string" && node.id.length > 0) reserved.add(node.id);
      if (Array.isArray(node.children)) collect(node.children);
    }
  };
  collect(blocks);
  const seen = new Set<string>();
  const walk = (values: unknown[]): unknown[] => values.map(v => {
    if (!v || typeof v !== "object") return v;
    const node = v as Record<string, unknown>;
    let id = typeof node.id === "string" && node.id.length > 0 ? node.id : "";
    if (!id || seen.has(id)) {
      do { id = makeId(); } while (reserved.has(id) || seen.has(id));
    }
    seen.add(id);
    return { ...node, id, ...(Array.isArray(node.children) ? { children: walk(node.children) } : {}) };
  });
  return walk(blocks);
}

// A read-mode link copy may assign runtime IDs to an older stored document.
// Copy ONLY identity, preserving the original rich JSON and Markdown. Refuse a
// structural mismatch instead of replacing content with an editor projection.
export function copyNoteBlockIds(stored: unknown[], rendered: unknown[]): unknown[] {
  const seen = new Set<string>();
  const sourceIds = new Set<string>();
  const walk = (source: unknown[], runtime: unknown[]): unknown[] => {
    if (source.length !== runtime.length) throw new Error("Reload this note before copying its section link.");
    return source.map((value, index) => {
      if (!value || typeof value !== "object" || !runtime[index] || typeof runtime[index] !== "object") throw new Error("Unsupported block identity.");
      const a = value as Record<string, unknown>, b = runtime[index] as Record<string, unknown>;
      if (a.type !== b.type || inlineText(a.content) !== inlineText(b.content) || typeof b.id !== "string" || !b.id || seen.has(b.id)) throw new Error("Reload this note before copying its section link.");
      if (typeof a.id === "string" && a.id && !sourceIds.has(a.id) && a.id !== b.id) throw new Error("Reload this note before copying its section link.");
      if (typeof a.id === "string" && a.id) sourceIds.add(a.id);
      seen.add(b.id);
      const children = Array.isArray(a.children) ? a.children : [];
      const runtimeChildren = Array.isArray(b.children) ? b.children : [];
      const next = walk(children, runtimeChildren);
      return { ...a, id: b.id, ...(Array.isArray(a.children) ? { children: next } : {}) };
    });
  };
  return walk(stored, rendered);
}
