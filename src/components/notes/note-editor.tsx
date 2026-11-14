"use client";

// BlockNote editor for one note. Loaded only on the client (next/dynamic with
// ssr: false from the Notes workspace), so the board bundle never includes it.
import { BlockNoteView } from "@blocknote/ariakit";
import "@blocknote/ariakit/style.css";
import {
  FormattingToolbar,
  FormattingToolbarController,
  LinkToolbar,
  LinkToolbarController,
  EditLinkButton,
  OpenLinkButton,
  DeleteLinkButton,
  getFormattingToolbarItems,
  useCreateBlockNote,
  useBlockNoteEditor,
  useEditorState,
  type LinkToolbarProps,
} from "@blocknote/react";
import { LinkToolbarExtension } from "@blocknote/core/extensions";
import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type RefObject } from "react";
import { ChevronDown, Heading2, Link2, ListTodo, X } from "lucide-react";
import { type NoteContentInput } from "@/lib/notes-model";
import type { NoteEditorFormatProps } from "@/lib/notes-editor-contract";
import { canRenderNoteContent, notesEditorSchema, normalizePageMentionClipboard, serializeNoteContent } from "@/lib/notes-editor-schema";
import { PageMentionProvider } from "./page-mention-provider";
import { WikiMentionMenu } from "./wiki-mention-menu";
import { copyPageMentions } from "./page-mention-clipboard";
import { NoteContents, type NoteContentsOptions } from "./note-contents";
import { NoteSectionFolds } from "./note-section-folds";
import {NoteInsertTools} from './note-insert-tools';
import {NoteMermaid} from './note-mermaid';

type ColorScheme = "light" | "dark";

function readColorScheme(): ColorScheme {
  return document.documentElement.dataset.theme === "light" ? "light" : "dark";
}

// Follows Taskboard's resolved Light/Dark setting on <html data-theme>.
function useTaskboardColorScheme() {
  const [scheme, setScheme] = useState<ColorScheme>(() =>
    typeof document === "undefined" ? "dark" : readColorScheme(),
  );

  useEffect(() => {
    const observer = new MutationObserver(() => setScheme(readColorScheme()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
  }, []);

  return scheme;
}

export type NoteEditorProps = NoteEditorFormatProps & {
  initialBlocks: unknown[];
  editable: boolean;
  onChange: (content: NoteContentInput) => void;
  uploadFile?: (file: File) => Promise<string>;
  resolveFileUrl?: (url:string)=>Promise<string>;
  // Each increase moves the cursor into the body (Enter in the title).
  focusRequest?: number;
  mobile?: boolean;
  mobileFormatting?: boolean;
  onCloseMobileFormatting?: () => void;
  // Hosts may adapt their floating surfaces without changing Notes' defaults.
  editorView?: typeof BlockNoteView;
  contents?: NoteContentsOptions;
};

type SetLinkToolbarOpen = (open: boolean) => void;
const MobileToolbarContext = createContext<{ enabled: boolean; close?: () => void; linkToolbarOpenerRef?: RefObject<SetLinkToolbarOpen | undefined> }>({ enabled: false });

export default function NoteEditor(props: NoteEditorProps) {
  if (!canRenderNoteContent(props.initialBlocks, props.contentFormatVersion ?? 1)) {
    return <p role="alert">This document format is not supported. Its content has been preserved.</p>;
  }
  return <SupportedNoteEditor {...props} />;
}

function SupportedNoteEditor({ initialBlocks, editable, onChange, uploadFile,resolveFileUrl, focusRequest = 0, mobile = false, mobileFormatting = false, onCloseMobileFormatting, editorView: EditorView = BlockNoteView, contentFormatVersion = 1, wikiContext,authenticatedMentions=false, contents }: NoteEditorProps) {
  const colorScheme = useTaskboardColorScheme();
  const onChangeRef = useRef(onChange);
  const uploadRef = useRef(uploadFile);
  const fileResolver=useRef(resolveFileUrl);
  useLayoutEffect(() => { fileResolver.current=resolveFileUrl; }, [resolveFileUrl]);
  const wikiRef = useRef(Boolean(wikiContext||authenticatedMentions) && contentFormatVersion === 2);
  const [blocks, setBlocks] = useState(initialBlocks);
  const [serializationError, setSerializationError] = useState(false);

  useEffect(() => {
    onChangeRef.current = onChange;
    uploadRef.current = uploadFile;
    wikiRef.current = Boolean(wikiContext||authenticatedMentions) && contentFormatVersion === 2;
  }, [onChange, uploadFile, wikiContext, authenticatedMentions,contentFormatVersion]);

  // The parent remounts this component (key = note id) for each note, so the
  // initial content is read once.
  const editor = useCreateBlockNote({
    schema: notesEditorSchema,
    extensions: [NoteMermaid(),...(contents ? [NoteSectionFolds({ viewerId: contents.viewerId, noteId: contents.noteId })] : [])],
    resolveFileUrl:url=>fileResolver.current?fileResolver.current(url):Promise.resolve(url),
    initialContent: initialBlocks.length > 0 ? (initialBlocks as never) : undefined,
    // ProseMirror uses this for both clipboard paste and external drag/drop.
    _tiptapOptions: { editorProps: { transformPastedHTML: html => html.includes("pageMention") ? normalizePageMentionClipboard(html, wikiRef.current) : html } },
    pasteHandler: ({ event, editor, defaultPasteHandler }) => {
      const internal = event.clipboardData?.getData("blocknote/html");
      const html = internal || event.clipboardData?.getData("text/html");
      if (html?.includes('pageMention')) {
        editor.pasteHTML(normalizePageMentionClipboard(html, wikiRef.current), Boolean(internal));
        return true;
      }
      return defaultPasteHandler();
    },
    uploadFile: (file: File) => {
      if (!uploadRef.current) {
        return Promise.reject(new Error("Uploads are not available."));
      }

      return uploadRef.current(file);
    },
  });

  const foldViewer = contents?.viewerId, foldNote = contents?.noteId;
  useLayoutEffect(() => {
    if (foldViewer && foldNote) editor.getExtension(NoteSectionFolds)?.setIdentity(foldViewer, foldNote);
  }, [editor, foldViewer, foldNote]);

  // BlockNote's link controller opens only when the selection or document
  // changes. After the phone link menu is closed or a link is edited, the
  // caret stays inside the link, so tapping that link again moves nothing and
  // the menu stayed shut (the fading copy left on screen is inert HTML).
  // Reopen it through the controller's own setter when the tapped link is the
  // one holding the caret; any other tap moves the selection and opens it.
  const linkToolbarOpenerRef = useRef<SetLinkToolbarOpen | undefined>(undefined);
  useEffect(() => {
    if (!editable) { linkToolbarOpenerRef.current?.(false); linkToolbarOpenerRef.current = undefined; }
  }, [editable]);
  const reopenTappedLink = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = event.target instanceof Element ? event.target.closest("a") : null;
    if (!anchor || !editor.isEditable || !editor.domElement?.contains(anchor)) return;
    const links = editor.getExtension(LinkToolbarExtension);
    const tapped = links?.getLinkAtElement(anchor);
    const atCaret = links?.getLinkAtSelection();
    if (tapped && atCaret && tapped.range.from === atCaret.range.from) linkToolbarOpenerRef.current?.(true);
  };

  // Focus only when a new request arrives, not when the editor mounts.
  const handledFocusRequestRef = useRef(focusRequest);

  useEffect(() => {
    if (focusRequest !== handledFocusRequestRef.current) {
      handledFocusRequestRef.current = focusRequest;
      if (editable) editor.focus();
    }
  }, [editor, focusRequest, editable]);

  return (
    <PageMentionProvider blocks={blocks} wikiContext={wikiContext} authenticatedMentions={authenticatedMentions} editable={editable}><MobileToolbarContext value={{ enabled: mobileFormatting && editable, close: onCloseMobileFormatting, linkToolbarOpenerRef }}><div onCopyCapture={event => { copyPageMentions(event, Boolean(wikiContext||authenticatedMentions)); }} onCutCapture={event => { if (copyPageMentions(event, Boolean(wikiContext||authenticatedMentions)) && editable) editor._tiptapEditor.commands.deleteSelection(); }}>
    {serializationError ? <p role="alert">These edits could not be saved because they contain unsupported content. Your text remains here; undo the last insertion to continue saving.</p> : null}
    {contents ? <NoteContents editor={editor} options={contents} serialize={() => serializeNoteContent(editor.document, contentFormatVersion, projected => editor.blocksToMarkdownLossy(projected as never))} /> : null}
    <EditorView
      editor={editor}
      editable={editable}
      theme={colorScheme}
      formattingToolbar={false}
      linkToolbar={editable && !mobile}
      sideMenu={editable && !mobile}
      slashMenu={false}
      tableHandles={editable}
      filePanel={editable}
      data-taskboard-notes=""
      className="notes-editor-view"
      onClick={mobile ? reopenTappedLink : undefined}
      onChange={() => {
        if (!editable) return;
        const blocks = editor.document as unknown[];
        let content: NoteContentInput;
        try { content = serializeNoteContent(blocks, contentFormatVersion, projected => editor.blocksToMarkdownLossy(projected as never)); }
        catch { setSerializationError(true); return; }
        setSerializationError(false);
        setBlocks(content.blocks);
        onChangeRef.current(content);
      }}
    >
      {editable ? <FormattingToolbarController formattingToolbar={mobile ? PhoneFormattingToolbar : CompactFormattingToolbar} /> : null}
      {editable && mobile ? <LinkToolbarController linkToolbar={PhoneLinkToolbar} /> : null}
      <NoteInsertTools folio={authenticatedMentions} editable={editable}/>
      {editable && (wikiContext||authenticatedMentions) && contentFormatVersion === 2 ? <WikiMentionMenu folio={authenticatedMentions}/> : null}
    </EditorView></div></MobileToolbarContext></PageMentionProvider>
  );
}

function PhoneLinkToolbar(props: LinkToolbarProps) {
  const editor = useBlockNoteEditor();
  const { linkToolbarOpenerRef } = useContext(MobileToolbarContext);
  const { setToolbarOpen } = props;
  useEffect(() => {
    if (linkToolbarOpenerRef && setToolbarOpen) linkToolbarOpenerRef.current = setToolbarOpen;
    // Keep the controller setter after its floating contents close: tapping the
    // unchanged caret link uses it to reopen. The parent clears it on disable.
  }, [linkToolbarOpenerRef, setToolbarOpen]);
  return <LinkToolbar {...props}>
    <EditLinkButton {...props} />
    <OpenLinkButton url={props.url} />
    <DeleteLinkButton range={props.range} setToolbarOpen={props.setToolbarOpen} />
    <button type="button" aria-label="Close link menu" onClick={() => { props.setToolbarOpen?.(false); editor.focus(); }}><X aria-hidden="true" /></button>
  </LinkToolbar>;
}

// BlockNote's mobile controller owns visual-viewport positioning and preserves
// editor focus/selection when its controls are touched. Keep it opt-in via Aa.
function PhoneFormattingToolbar() {
  const { enabled } = useContext(MobileToolbarContext);
  return enabled ? <PhoneFormattingControls /> : null;
}

function PhoneFormattingControls() {
  const editor = useBlockNoteEditor();
  const { close } = useContext(MobileToolbarContext);
  const state = useEditorState({ editor, selector: ({ editor }) => ({ block: editor.getTextCursorPosition().block, selectionEmpty: editor.prosemirrorState.selection.empty }) });
  const block = state.block;
  const items = getFormattingToolbarItems();
  const item = (key: string) => items.find(item => item.key === key);
  return <FormattingToolbar>
    {item("boldStyleButton")}
    {item("italicStyleButton")}
    <button type="button" aria-label="Heading" aria-pressed={block.type === "heading"} onPointerDown={event => event.preventDefault()}
      onClick={() => { editor.updateBlock(block, block.type === "heading" ? { type: "paragraph" } : { type: "heading", props: { level: 2 } }); editor.focus(); }}><Heading2 aria-hidden="true" /></button>
    <button type="button" aria-label="Checklist" aria-pressed={block.type === "checkListItem"} onPointerDown={event => event.preventDefault()}
      onClick={() => { editor.updateBlock(block, { type: block.type === "checkListItem" ? "paragraph" : "checkListItem" }); editor.focus(); }}><ListTodo aria-hidden="true" /></button>
    {state.selectionEmpty ? <button type="button" aria-label="Select text to add a link" disabled><Link2 aria-hidden="true" /></button> : item("createLinkButton")}
    <button type="button" aria-label="Collapse formatting" onPointerDown={event => event.preventDefault()} onClick={close}><ChevronDown aria-hidden="true" /></button>
  </FormattingToolbar>;
}

// The default toolbar without text alignment, which notes rarely need; it
// keeps the toolbar narrow enough for the editor pane and phones.
function CompactFormattingToolbar() {
  return (
    <FormattingToolbar>
      {getFormattingToolbarItems().filter((item) => !String(item.key ?? "").startsWith("textAlign"))}
    </FormattingToolbar>
  );
}
