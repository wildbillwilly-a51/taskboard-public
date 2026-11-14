"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { ContextMenu, type ContextMenuAction } from "@/components/ui/context-menu";
import {
  SuggestionMenuController,
  getDefaultReactSlashMenuItems,
  useBlockNoteEditor,
} from "@blocknote/react";
import { FeatureDialog } from "./folio-dialog";
import { FolioDiscoveryDialog } from "./folio-discovery-dialog";
import { normalizeWebLink } from "@/lib/folio-features-model";
import s from "./folio-features.module.css";
export function NoteInsertTools({
  folio,
  editable,
}: {
  folio: boolean;
  editable: boolean;
}) {
  const editor = useBlockNoteEditor(),
    [mode, setMode] = useState<"url" | "note" | null>(null),
    [context, setContext] = useState<{ x: number; y: number } | null>(null),
    [url, setUrl] = useState(""),
    [title, setTitle] = useState(""),
    [error, setError] = useState("");
  const selection = useRef<{ from: number; to: number } | null>(null);
  const remember = useCallback(() => {
    const { from, to } = editor.prosemirrorView.state.selection;
    selection.current = { from, to };
  }, [editor]);
  const restore = () => {
    editor.focus();
    if (selection.current)
      editor._tiptapEditor.commands.setTextSelection(selection.current);
  };
  const open = (next: "url" | "note") => {
    remember();
    const { from, to } = selection.current!;
    setTitle(editor.prosemirrorView.state.doc.textBetween(from, to, " "));
    setUrl("");
    setError("");
    setContext(null);
    setMode(next);
  };
  useEffect(() => {
    const dom = editor.domElement;
    if (!dom || !editable) return;
    const context = (e: MouseEvent) => {
      if ((e.target as HTMLElement).closest("a,img,video,audio") || e.shiftKey)
        return;
      e.preventDefault();
      remember();
      setContext({
        x: Math.max(8, Math.min(e.clientX, window.innerWidth - 245)),
        y: Math.max(8, Math.min(e.clientY, window.innerHeight - 210)),
      });
    };
    dom.addEventListener("contextmenu", context);
    return () => dom.removeEventListener("contextmenu", context);
  }, [editor, editable, remember]);
  useEffect(() => {
    if (!context) return;
    const close = (e: PointerEvent) => {
      if (!(e.target as Element).closest("#note-insert-context"))
        setContext(null);
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setContext(null);
        editor.focus();
      }
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", key);
    };
  }, [context, editor]);
  const insertNote = (id: string) => {
    restore();
    editor.insertInlineContent([
      { type: "pageMention", props: { noteId: id } },
      " ",
    ] as never);
    setMode(null);
  };
  const finish = () => {
    try {
      const href = normalizeWebLink(url);
      restore();
      editor.createLink(href, title.trim() || url.trim());
      setMode(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const items = async (query: string) =>
    [
      ...getDefaultReactSlashMenuItems(editor),
      {
        title: "Insert hyperlink",
        subtext: "URL with an optional link title",
        group: "Links",
        aliases: ["url", "link", "hyperlink"],
        onItemClick: () => open("url"),
      },
      ...(folio
        ? [
            {
              title: "Insert note link",
              subtext: "Find and reference a Folio note",
              group: "Links",
              aliases: ["note", "reference"],
              onItemClick: () => open("note"),
            },
          ]
        : []),
      {
        title: "Mermaid diagram",
        subtext: "Write a diagram as code",
        group: "Insert",
        aliases: ["diagram", "flowchart"],
        onItemClick: () => {
          editor.insertBlocks(
            [
              {
                type: "codeBlock",
                props: { language: "mermaid" },
                content: "flowchart TD\n  Start --> Finish",
              },
            ] as never,
            editor.getTextCursorPosition().block,
            "after",
          );
        },
      },
    ].filter((item) =>
      [item.title, ...(item.aliases ?? [])].some((v) =>
        v.toLowerCase().includes(query.toLowerCase()),
      ),
    );
  return (
    <>
      {editable ? (
        <SuggestionMenuController triggerCharacter="/" getItems={items} />
      ) : null}
      {mode === "url" ? (
        <FeatureDialog
          title="Insert hyperlink"
          onClose={() => {
            setMode(null);
            restore();
          }}
        >
          <label>
            URL
            <input
              className="ed-field"
              autoFocus
              type="text"
              inputMode="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com"
            />
          </label>
          <label>
            Link title (optional)
            <input
              className="ed-field"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Leave blank to display the URL"
            />
          </label>
          {error ? (
            <p role="alert" className={s.error}>
              {error}
            </p>
          ) : null}
          <footer>
            <button className="ui-button ui-button-primary ed-button" onClick={finish}>
              Insert link
            </button>
          </footer>
        </FeatureDialog>
      ) : mode === "note" ? (
        <FolioDiscoveryDialog
          onClose={() => {
            setMode(null);
            editor.focus();
          }}
          onOpen={insertNote}
        />
      ) : null}
      {context && editor.domElement
        ? <ContextMenu id="note-insert-context" label="Insert and clipboard" showCloseButton
            classNames={{ menu: `taskboard-shell ${s.surface} ${s.menu} notes-context-menu`, heading: "notes-context-heading", item: "notes-menu-item", danger: "notes-menu-danger", separated: "notes-context-separated" }}
            anchor={{ ...context, trigger: editor.domElement }}
            portalTarget={document.querySelector('[data-testid="folio-workspace"]')?.closest<HTMLElement>(".notes-frame")}
            onClose={(returnFocus) => { setContext(null); if (returnFocus) restore(); }}
            actions={[
              { label: "Insert hyperlink", focus: "handoff", run: () => { restore(); open("url"); } },
              ...(folio ? [{ label: "Insert note link", focus: "handoff", run: () => { restore(); open("note"); } } satisfies ContextMenuAction] : []),
              { label: "Copy selected text", run: () => { restore(); document.execCommand("copy"); } },
              { label: "Cut selected text", run: () => { restore(); document.execCommand("cut"); } },
            ]} />
        : null}
    </>
  );
}
