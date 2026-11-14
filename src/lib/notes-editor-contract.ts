// Optional at the checkpoint; the editor package implements their behavior.
export type WikiEditorContext = { spaceId: string; noteId?: string };
export type NoteEditorFormatProps = { contentFormatVersion?: number; wikiContext?: WikiEditorContext; authenticatedMentions?:boolean };
