"use client";
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import type { NoteContentInput, NoteDetail } from "@/lib/notes-model";
import type { FolioSpace } from "@/lib/folio-model";
import type { FolioHit } from "@/lib/folio-features-model";
import { folioTemplates } from "@/lib/folio-templates";
import { discoverNotes, featureRequest } from "@/lib/folio-feature-client";
import { fetchNote } from "@/lib/notes-client";
import { FeatureDialog } from "./folio-dialog";
import s from "./folio-features.module.css";
const Preview = dynamic(() => import("./note-editor"), { ssr: false });
export function FolioCreateDialog({
  spaces,
  onClose,
  onCreated,
}: {
  spaces: FolioSpace[];
  onClose: () => void;
  onCreated: (note: NoteDetail, destination: string) => void;
}) {
  const [template, setTemplate] = useState("procedure"),
    [title, setTitle] = useState("Procedure"),
    [destination, setDestination] = useState(""),
    [markdown, setMarkdown] = useState<string>(folioTemplates[0].markdown),
    [content, setContent] = useState<NoteContentInput | null>(null),
    [custom, setCustom] = useState<FolioHit[]>([]),
    [sourceId, setSource] = useState<string | null>(null),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    void discoverNotes({ templates: true }, c.signal)
      .then((r) => setCustom(r.notes))
      .catch(() => {});
    return () => c.abort();
  }, []);
  const parse = async (text: string) => {
    const [{ BlockNoteEditor }, schema] = await Promise.all([
      import("@blocknote/core"),
      import("@/lib/notes-editor-schema"),
    ]);
    const editor = BlockNoteEditor.create({ schema: schema.notesEditorSchema });
    try {
      const blocks = await editor.tryParseMarkdownToBlocks(text);
      return schema.serializeNoteContent(blocks, 2, (b) =>
        editor.blocksToMarkdownLossy(b as never),
      );
    } finally {
      editor._tiptapEditor.destroy();
    }
  };
  const select = (id: string) => {
    setTemplate(id);
    setPreview(false);
    setContent(null);
    setSource(null);
    const t = folioTemplates.find((t) => t.id === id);
    if (t) {
      setTitle(t.title);
      setMarkdown(t.markdown);
    } else if (id === "blank") {
      setTitle("");
      setMarkdown("");
    } else if (id === "import") {
      setTitle("");
      setMarkdown("");
    } else {
      setSource(id);
      setTitle(custom.find((t) => t.id === id)?.title ?? "");
    }
  };
  const inspect = async () => {
    setBusy(true);
    setError("");
    try {
      if (sourceId) {
        const r = await fetchNote(sourceId);
        setContent({
          formatVersion: 2,
          blocks: r.content,
          markdown: r.contentMarkdown,
          text: "",
        });
      } else setContent(await parse(markdown));
      setPreview(true);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const create = async () => {
    setBusy(true);
    setError("");
    try {
      const r = await featureRequest<{ note: NoteDetail }>(
        "/api/folio/create",
        {
          title,
          destination: destination || null,
          ...(sourceId
            ? { sourceId }
            : { content: content ?? (await parse(markdown)) }),
        },
      );
      onCreated(r.note, destination);
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <FeatureDialog
      title="Create from template or Markdown"
      onClose={onClose}
      className={`${s.dialog} ${preview ? s.templatePreviewDialog : ""}`}
    >
      <label>
        Start with
        <select className="ed-field" value={template} onChange={(e) => select(e.target.value)}>
          <option value="blank">Blank note</option>
          {folioTemplates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.title}
            </option>
          ))}
          <option value="import">Import Markdown (.md)</option>
          {custom.map((n) => (
            <option key={n.id} value={n.id}>
              {n.title} · Saved template
            </option>
          ))}
        </select>
      </label>
      <label>
        Note title
        <input className="ed-field"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          maxLength={300}
        />
      </label>
      <label>
        Create in
        <select className="ed-field"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
        >
          <option value="">Unconnected · Shared</option>
          {spaces
            .filter(
              (s) => !s.archived && ["personal", "shared"].includes(s.kind),
            )
            .map((v) => (
              <option key={v.id} value={v.id}>
                {v.title} · {v.kind === "personal" ? "Only you" : "Shared"}
              </option>
            ))}
        </select>
      </label>
      {template === "import" ? (
        <>
          <label>
            Markdown file
            <input className="ed-field"
              type="file"
              accept=".md,.markdown,text/markdown,text/plain"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                if (f.size > 1024 * 1024) {
                  setError("Markdown files must be under 1 MB.");
                  return;
                }
                void f.text().then((text) => {
                  setMarkdown(text);
                  setTitle(f.name.replace(/\.(md|markdown)$/i, ""));
                  setContent(null);
                  setPreview(false);
                });
              }}
            />
          </label>
          <p className={s.muted}>
            Common Markdown, tables, links, and code are supported. Attach local
            images/files separately; conversion may simplify unsupported
            formatting.
          </p>
        </>
      ) : null}
      {preview && content ? (
        <div>
          <h3>Preview</h3>
          <Preview
            key={`${template}:${markdown.length}`}
            initialBlocks={content.blocks}
            contentFormatVersion={2}
            editable={false}
            onChange={() => {}}
          />
        </div>
      ) : null}
      {error ? (
        <p role="alert" className={s.error}>
          {error}
        </p>
      ) : null}
      <footer>
        <button
          className="ui-button ed-button"
          disabled={busy}
          onClick={() => void inspect()}
        >
          Preview
        </button>
        <button
          className="ui-button ui-button-primary ed-button"
          disabled={busy || (template === "import" && !markdown)}
          onClick={() => void create()}
        >
          {busy ? "Working…" : "Create note"}
        </button>
      </footer>
    </FeatureDialog>
  );
}
