"use client";
import type { NoteEditorFormatProps } from "@/lib/notes-editor-contract";
import { useEffect, useRef, useSyncExternalStore } from "react";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/ariakit";
import "@blocknote/ariakit/style.css";
import { canRenderNoteContent, notesEditorSchema } from "@/lib/notes-editor-schema";
import { PageMentionProvider } from "@/components/notes/page-mention-provider";
import { copyPageMentions } from "@/components/notes/page-mention-clipboard";
function subscribeTheme(update: () => void) {
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
    return () => observer.disconnect();
}
const readTheme = () => document.documentElement.dataset.theme === "light" ? "light" as const : "dark" as const;
const serverTheme = () => "dark" as const;
type Props = NoteEditorFormatProps & {
    content: unknown[];
};
export default function PublicNoteBody(props: Props) {
    if (!canRenderNoteContent(props.content, props.contentFormatVersion ?? 1)) return <p role="alert">This document format is not supported. Its content has been preserved.</p>;
    return <SupportedBody {...props} />;
}
function SupportedBody({ content, wikiContext, authenticatedMentions=false }: Props) {
    const editor = useCreateBlockNote({ schema: notesEditorSchema, initialContent: content.length ? content as never : undefined });
    const theme = useSyncExternalStore(subscribeTheme, readTheme, serverTheme);
    const previous = useRef(JSON.stringify(content));
    useEffect(() => {
        const value = JSON.stringify(content);
        if (value !== previous.current) {
            editor.replaceBlocks(editor.document, content.length ? content as never : [{ type: "paragraph" }]);
            previous.current = value;
        }
    }, [content, editor]);
    // Read-only document: no draft store, upload handler, or change callback.
    // Authenticated mention lookup is an explicit Folio-host opt-in.
    return <PageMentionProvider blocks={content} wikiContext={wikiContext} authenticatedMentions={authenticatedMentions}><div onCopyCapture={event => { copyPageMentions(event, Boolean(wikiContext||authenticatedMentions)); }} onCutCapture={event => { copyPageMentions(event, Boolean(wikiContext||authenticatedMentions)); }}><BlockNoteView editor={editor} theme={theme} editable={false} formattingToolbar={false} linkToolbar={false} sideMenu={false} slashMenu={false} tableHandles={false} filePanel={false} data-taskboard-notes="" className="notes-editor-view"/></div></PageMentionProvider>;
}
