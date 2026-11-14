import type { FolioPageState } from "./folio-model";

export type FolioVersionSummary = {
  id: string;
  version: number;
  title: string;
  author: string | null;
  savedAt: string;
  kind: string;
};
export type FolioVersionListing = {
  versions: FolioVersionSummary[];
  hasMore: boolean;
  nextBeforeVersion: number | null;
};
export type FolioVersionFile = {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  removed: boolean;
  available: boolean;
};
export type FolioVersionDetail = FolioVersionSummary & {
  content: unknown[];
  markdown: string;
  format: number;
  attachments: FolioVersionFile[];
  unavailableAttachmentIds: string[];
  pageState: FolioPageState | null;
  token: string;
};
export function stableHistoryValue(value: unknown): string {
  if (value === undefined) return "null";
  if (Array.isArray(value))
    return `[${value.map(stableHistoryValue).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map(
        (k) =>
          `${JSON.stringify(k)}:${stableHistoryValue((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}
export type DiffChunk<T> = { kind: "same" | "removed" | "added"; values: T[] };
// Prefix/suffix trimming avoids quadratic work on long, lightly edited notes.
// Large unmatched regions are retained in full as bounded replacement chunks.
export function historySequenceDiff<T>(
  old: T[],
  next: T[],
  key: (v: T) => string,
  budget = 80_000,
): DiffChunk<T>[] {
  const a = old.map(key),
    b = next.map(key),
    out: DiffChunk<T>[] = [];
  const append = (kind: DiffChunk<T>["kind"], values: T[]) => {
    if (!values.length) return;
    const last = out.at(-1);
    if (last?.kind === kind) {
      for (const v of values) last.values.push(v);
    } else out.push({ kind, values: [...values] });
  };
  let start = 0,
    endA = a.length,
    endB = b.length;
  while (start < endA && start < endB && a[start] === b[start]) start++;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  append("same", next.slice(0, start));
  const n = endA - start,
    m = endB - start;
  if (!n) append("added", next.slice(start, endB));
  else if (!m) append("removed", old.slice(start, endA));
  else if (n * m > budget) {
    append("removed", old.slice(start, endA));
    append("added", next.slice(start, endB));
  } else {
    const width = m + 1,
      grid = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        grid[i * width + j] =
          a[start + i] === b[start + j]
            ? grid[(i + 1) * width + j + 1] + 1
            : Math.max(grid[(i + 1) * width + j], grid[i * width + j + 1]);
    let i = 0,
      j = 0;
    while (i < n || j < m) {
      if (i < n && j < m && a[start + i] === b[start + j]) {
        append("same", [next[start + j]]);
        i++;
        j++;
      } else if (
        i < n &&
        (j === m || grid[(i + 1) * width + j] >= grid[i * width + j + 1])
      )
        append("removed", [old[start + i++]]);
      else append("added", [next[start + j++]]);
    }
  }
  append("same", next.slice(endB));
  return out;
}
type Node = Record<string, unknown>;
const node = (v: unknown): Node =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Node) : {};
export type HistoryInlineToken = {
  text?: string;
  mentionId?: string;
  href?: string;
  styles?: Record<string, unknown>;
  key: string;
};
function inlineTokens(
  content: unknown,
  href?: string,
): HistoryInlineToken[] | null {
  if (!Array.isArray(content)) return null;
  const tokens: HistoryInlineToken[] = [];
  for (const value of content) {
    const item = node(value);
    if (item.type === "link" && typeof item.href === "string") {
      const nested = inlineTokens(item.content, item.href);
      if (!nested) return null;
      tokens.push(...nested);
    } else if (item.type === "text" && typeof item.text === "string") {
      const styles = node(item.styles);
      // Treat very long strings as one semantic token, preserving their bytes.
      const parts =
        item.text.length > 40_000
          ? [item.text]
          : (item.text.match(/\s+|[\p{L}\p{N}_]+|[^\s\p{L}\p{N}_]+/gu) ?? []);
      for (const text of parts)
        tokens.push({
          text,
          href,
          styles,
          key: stableHistoryValue([text, href, styles]),
        });
    } else if (
      item.type === "pageMention" &&
      typeof node(item.props).noteId === "string"
    ) {
      const mentionId = node(item.props).noteId as string;
      tokens.push({
        mentionId,
        href,
        key: stableHistoryValue(["mention", mentionId, href]),
      });
    } else return null;
    if (tokens.length > 25_000) return null;
  }
  return tokens;
}
export type HistoryInlineRun = DiffChunk<HistoryInlineToken> & {
  change: number | null;
};
export type HistoryPart =
  | { kind: "rich"; blocks: unknown[] }
  | { kind: "text"; block: unknown; runs: HistoryInlineRun[] }
  | {
      kind: "replace";
      before: unknown[];
      after: unknown[];
      change: number;
      label: string;
    };
export type HistoryComparison = {
  parts: HistoryPart[];
  title: HistoryInlineRun[];
  total: number;
  large: boolean;
  filesChanged: boolean;
  filesChange: number | null;
  pageChanged: boolean;
  pageChange: number | null;
};
function blockKey(v: unknown) {
  const b = node(v);
  return typeof b.id === "string" ? `id:${b.id}` : stableHistoryValue(v);
}
export function compareFolioVersions(
  before: FolioVersionDetail | null,
  after: FolioVersionDetail,
): HistoryComparison {
  let counter = 0;
  const runs = (
    chunks: DiffChunk<HistoryInlineToken>[],
  ): HistoryInlineRun[] => {
    let changing = false,
      id: number | null = null;
    return chunks.map((c) => {
      if (c.kind === "same") {
        changing = false;
        id = null;
      } else if (!changing) {
        id = ++counter;
        changing = true;
      }
      return { ...c, change: id };
    });
  };
  const plain = (text: string) =>
    inlineTokens([{ type: "text", text, styles: {} }])!;
  const title = runs(
    historySequenceDiff(
      plain(before?.title ?? ""),
      plain(after.title),
      (v) => v.key,
    ),
  );
  const titleChanges = counter;
  const parts: HistoryPart[] = [];
  const rich = (blocks: unknown[]) => {
    if (!blocks.length) return;
    const last = parts.at(-1);
    if (last?.kind === "rich") last.blocks.push(...blocks);
    else parts.push({ kind: "rich", blocks: [...blocks] });
  };
  const replace = (a: unknown[], b: unknown[], label = "Content changed") =>
    parts.push({
      kind: "replace",
      before: a,
      after: b,
      change: ++counter,
      label,
    });
  // Only the small textual renderer interprets these installed BlockNote0.56
  // defaults. Other props/shapes use the original rich reader intact.
  const textProps = (b: Node) =>
    Object.fromEntries(
      Object.entries(node(b.props)).filter(
        ([k, v]) =>
          !(
            ((k === "backgroundColor" || k === "textColor") &&
              v === "default") ||
            (k === "textAlignment" && v === "left") ||
            (k === "isToggleable" && v === false) ||
            (b.type === "heading" && k === "level" && v === 1)
          ),
      ),
    );
  const simpleText = (b: Node) =>
    Object.entries(textProps(b)).every(([k]) =>
      ["backgroundColor", "textColor", "textAlignment", "level"].includes(k),
    );
  const basicTokens = (tokens: HistoryInlineToken[] | null) =>
    tokens?.every((t) =>
      Object.entries(t.styles ?? {}).every(
        ([k, v]) =>
          ["bold", "italic", "underline", "strike", "code"].includes(k) ||
          (["textColor", "backgroundColor"].includes(k) && v === "default"),
      ),
    );
  const pair = (a: unknown, b: unknown) => {
    if (stableHistoryValue(a) === stableHistoryValue(b)) {
      rich([b]);
      return;
    }
    const x = node(a),
      y = node(b),
      children = (v: Node) =>
        !Array.isArray(v.children) || v.children.length === 0;
    const old = inlineTokens(x.content),
      next = inlineTokens(y.content);
    if (
      x.type === y.type &&
      ["paragraph", "heading", "quote"].includes(String(x.type)) &&
      children(x) &&
      children(y) &&
      simpleText(x) &&
      simpleText(y) &&
      !Object.keys(textProps(x)).some(
        (k) => k === "backgroundColor" || k === "textColor",
      ) &&
      stableHistoryValue(textProps(x)) === stableHistoryValue(textProps(y)) &&
      old &&
      next &&
      basicTokens(old) &&
      basicTokens(next)
    ) {
      parts.push({
        kind: "text",
        block: b,
        runs: runs(historySequenceDiff(old, next, (t) => t.key)),
      });
    } else
      replace(
        [a],
        [b],
        x.type === y.type
          ? "Content or formatting changed"
          : "Block type changed",
      );
  };
  const excessiveBlocks =
    after.content.length + (before?.content.length ?? 0) > 3000;
  const sameBody =
    stableHistoryValue(before?.content ?? []) ===
    stableHistoryValue(after.content);
  const chunks =
    excessiveBlocks || sameBody
      ? []
      : historySequenceDiff(before?.content ?? [], after.content, blockKey);
  const oldByKey = new Map(
    (excessiveBlocks || sameBody ? [] : (before?.content ?? [])).map((v) => [
      blockKey(v),
      v,
    ]),
  );
  let large = false;
  if (sameBody) rich(after.content);
  else if (chunks.length > 60 || excessiveBlocks) {
    replace(before?.content ?? [], after.content, "Document changed");
    large = true;
  } else
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      if (c.kind === "same") {
        for (const b of c.values) pair(oldByKey.get(blockKey(b)) ?? b, b);
        continue;
      }
      const added =
        c.kind === "removed" && chunks[i + 1]?.kind === "added"
          ? chunks[++i].values
          : [];
      if (c.kind === "added") {
        replace([], c.values, "Content added");
        continue;
      }
      // Similar neighboring paragraphs without old block IDs can still be reviewed inline.
      if (c.values.length === added.length && added.length)
        for (let j = 0; j < added.length; j++) pair(c.values[j], added[j]);
      else
        replace(
          c.values,
          added,
          added.length ? "Content changed" : "Content removed",
        );
    }
  const richReaders = parts.reduce(
    (n, p) =>
      n +
      (p.kind === "rich"
        ? 1
        : p.kind === "replace"
          ? Number(Boolean(p.before.length)) + Number(Boolean(p.after.length))
          : 0),
    0,
  );
  if (richReaders > 32 || parts.length > 300) {
    counter = titleChanges;
    parts.length = 0;
    replace(before?.content ?? [], after.content, "Document changed");
    large = true;
  }
  const filesChanged =
    stableHistoryValue(before?.attachments.map((f) => f.id) ?? []) !==
      stableHistoryValue(after.attachments.map((f) => f.id)) ||
    stableHistoryValue(before?.unavailableAttachmentIds ?? []) !==
      stableHistoryValue(after.unavailableAttachmentIds);
  const filesChange = filesChanged ? ++counter : null;
  const pageChanged =
      stableHistoryValue(before?.pageState ?? null) !==
      stableHistoryValue(after.pageState),
    pageChange = pageChanged ? ++counter : null;
  return {
    parts,
    title,
    total: counter,
    large,
    filesChanged,
    filesChange,
    pageChanged,
    pageChange,
  };
}
// Inclusive selected interval: compare its oldest predecessor with newest content.
export function folioHistoryRange(
  versions: FolioVersionSummary[],
  anchor: string,
  target: string,
) {
  const a = versions.findIndex((v) => v.id === anchor),
    b = versions.findIndex((v) => v.id === target);
  if (a < 0 || b < 0) return null;
  const newest = Math.min(a, b),
    oldest = Math.max(a, b);
  return {
    selected: versions.slice(newest, oldest + 1),
    after: versions[newest],
    before: versions[oldest + 1] ?? null,
    needsOlder: oldest === versions.length - 1,
  };
}
