import assert from "node:assert/strict";
import test from "node:test";
import {
  compareFolioVersions,
  folioHistoryRange,
  historySequenceDiff,
  stableHistoryValue,
  type FolioVersionDetail,
} from "../src/lib/folio-history-model";
const paragraph = (text: string, id = "p", styles = {}) => ({
  id,
  type: "paragraph",
  props: {},
  content: [{ type: "text", text, styles }],
  children: [],
});
const version = (
  content: unknown[],
  more: Partial<FolioVersionDetail> = {},
): FolioVersionDetail => ({
  id: "v",
  version: 2,
  title: "Title",
  author: "Writer",
  savedAt: "2026-11-05T12:00:00Z",
  kind: "edit",
  content,
  markdown: "",
  format: 2,
  attachments: [],
  unavailableAttachmentIds: [],
  pageState: null,
  token: "a".repeat(64),
  ...more,
});
test("history comparison preserves unchanged rich blocks and highlights Unicode text edits without mutating snapshots", () => {
  const a = version([paragraph("Hello café 👩🏽‍💻 world")]),
    b = version([paragraph("Hello café 👩🏽‍💻 team")]);
  const saved = JSON.stringify([a, b]);
  const d = compareFolioVersions(a, b);
  assert.equal(d.total, 1);
  const p = d.parts[0];
  assert.equal(p.kind, "text");
  if (p.kind !== "text") return;
  assert.equal(
    p.runs
      .filter((r) => r.kind !== "added")
      .flatMap((r) => r.values)
      .map((v) => v.text ?? "")
      .join(""),
    "Hello café 👩🏽‍💻 world",
  );
  assert.equal(
    p.runs
      .filter((r) => r.kind !== "removed")
      .flatMap((r) => r.values)
      .map((v) => v.text ?? "")
      .join(""),
    "Hello café 👩🏽‍💻 team",
  );
  assert.equal(JSON.stringify([a, b]), saved);
});
test("formatting-only and link-destination changes remain visible even when text is identical", () => {
  const a = version([paragraph("same")]),
    b = version([paragraph("same", "p", { bold: true })]);
  assert.equal(compareFolioVersions(a, b).total, 1);
  const link = (href: string) => ({
    id: "p",
    type: "paragraph",
    props: {},
    content: [
      {
        type: "link",
        href,
        content: [{ type: "text", text: "Caption", styles: {} }],
      },
    ],
    children: [],
  });
  const d = compareFolioVersions(version([link("/a")]), version([link("/b")]));
  assert.equal(d.total, 1);
  const p = d.parts[0];
  assert.equal(p.kind, "text");
  if (p.kind === "text")
    assert.deepEqual(
      p.runs.map((r) => [r.kind, r.values[0]?.href]),
      [
        ["removed", "/a"],
        ["added", "/b"],
      ],
    );
});
test("complex tables, nested lists and media retain their complete before/after rich blocks", () => {
  for (const type of ["table", "bulletListItem", "image"]) {
    const a = {
      id: "b",
      type,
      props: { url: "/old.png" },
      content:
        type === "table"
          ? {
              type: "tableContent",
              rows: [{ cells: [[{ type: "text", text: "old" }]] }],
            }
          : [],
      children: [paragraph("nested")],
    };
    const b = { ...a, props: { url: "/new.png" } };
    const d = compareFolioVersions(version([a]), version([b]));
    assert.equal(d.total, 1);
    assert.equal(d.parts[0].kind, "replace");
    if (d.parts[0].kind === "replace") {
      assert.deepEqual(d.parts[0].before, [a]);
      assert.deepEqual(d.parts[0].after, [b]);
    }
  }
});
test("title, attachments and page layout are navigable changes when the body is unchanged", () => {
  const a = version([paragraph("Body")]),
    b = version(a.content, {
      title: "New title",
      attachments: [
        {
          id: "file",
          name: "banner.png",
          mimeType: "image/png",
          sizeBytes: 1,
          available: true,
          removed: false,
        },
      ],
      pageState: {
        bannerAttachmentId: "file",
        notesListVisible: false,
        notesListPosition: "before",
      },
    });
  const d = compareFolioVersions(a, b);
  assert.equal(d.total, 3);
  assert.equal(d.filesChange, 2);
  assert.equal(d.pageChange, 3);
  assert.equal(d.parts[0].kind, "rich");
});
test("bounded comparison falls back to complete documents instead of mounting unbounded rich readers", () => {
  const old = Array.from({ length: 100 }, (_, i) => ({
    id: `i${i}`,
    type: "image",
    props: { url: `/old-${i}` },
  }));
  const next = old.map((v) => ({
    ...v,
    props: { url: v.props.url.replace("old", "new") },
  }));
  const d = compareFolioVersions(version(old), version(next));
  assert.equal(d.large, true);
  assert.equal(d.parts.length, 1);
  if (d.parts[0].kind === "replace") {
    assert.deepEqual(d.parts[0].before, old);
    assert.deepEqual(d.parts[0].after, next);
  }
  const many = Array.from({ length: 4000 }, (_, i) =>
    paragraph(String(i), String(i)),
  );
  assert.equal(compareFolioVersions(version(many), version(many)).total, 0);
  const files = version(many, {
    attachments: [
      {
        id: "file",
        name: "x",
        mimeType: "text/plain",
        sizeBytes: 1,
        available: true,
        removed: false,
      },
    ],
  });
  const fileOnly = compareFolioVersions(version(many), files);
  assert.equal(fileOnly.total, 1);
  assert.equal(fileOnly.large, false);
  assert.equal(fileOnly.parts[0].kind, "rich");
});
test("sequence comparison round trips both documents, including bounded fallback and repeated tokens", () => {
  let seed = 17;
  const random = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed;
  };
  for (let n = 0; n < 200; n++) {
    const a = Array.from({ length: random() % 30 }, () => String(random() % 7)),
      b = Array.from({ length: random() % 30 }, () => String(random() % 7));
    const chunks = historySequenceDiff(a, b, (v) => v, n % 2 ? 8 : 80000);
    assert.deepEqual(
      chunks.filter((c) => c.kind !== "added").flatMap((c) => c.values),
      a,
    );
    assert.deepEqual(
      chunks.filter((c) => c.kind !== "removed").flatMap((c) => c.values),
      b,
    );
  }
});
test("inclusive revision range compares the oldest selected predecessor and identifies an unloaded predecessor", () => {
  const list = Array.from({ length: 5 }, (_, i) => ({
    ...version([]),
    id: `v${5 - i}`,
    version: 5 - i,
  }));
  const range = folioHistoryRange(list, "v4", "v2")!;
  assert.deepEqual(
    range.selected.map((v) => v.version),
    [4, 3, 2],
  );
  assert.equal(range.after.version, 4);
  assert.equal(range.before?.version, 1);
  assert.equal(range.needsOlder, false);
  assert.equal(folioHistoryRange(list, "v1", "v3")?.needsOlder, true);
  assert.equal(folioHistoryRange(list, "missing", "v3"), null);
});
test("snapshot canonicalization is stable across JSON object key order", () => {
  assert.equal(
    stableHistoryValue({ a: 1, b: { x: 2, y: 3 } }),
    stableHistoryValue({ b: { y: 3, x: 2 }, a: 1 }),
  );
});
test("installed text defaults do not become false formatting changes after editor normalization", () => {
  const a = version([paragraph("Body")]);
  const b = version([
    {
      ...paragraph("Body"),
      props: {
        textAlignment: "left",
        backgroundColor: "default",
        textColor: "default",
      },
    },
  ]);
  assert.equal(compareFolioVersions(a, b).total, 0);
  const h = {
    id: "h",
    type: "heading",
    content: [{ type: "text", text: "Heading", styles: {} }],
  };
  assert.equal(
    compareFolioVersions(
      version([h]),
      version([{ ...h, props: { level: 1, isToggleable: false } }]),
    ).total,
    0,
  );
});
