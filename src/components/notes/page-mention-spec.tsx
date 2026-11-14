"use client";
import { createReactInlineContentSpec } from "@blocknote/react";
import { isUuid } from "@/lib/notes-model";
import { pageMentionHref } from "@/lib/notes-content-format";
import { wikiLabels } from "@/lib/wiki-labels";
import { PageMentionLabel } from "./page-mention";

export const pageMentionSpec = createReactInlineContentSpec(
  { type: "pageMention", propSchema: { noteId: { default: "" } }, content: "none" },
  {
    render: ({ inlineContent, getPos }) => getPos() === undefined
      ? <span>{wikiLabels.page}</span>
      : <PageMentionLabel noteId={inlineContent.props.noteId} />,
    toExternalHTML: ({ inlineContent }) => isUuid(inlineContent.props.noteId)
      ? <a href={pageMentionHref(inlineContent.props.noteId)}>{wikiLabels.page}</a>
      : <span>{wikiLabels.page}</span>,
    parse: element => {
      const id = element.getAttribute("data-note-id");
      return element.getAttribute("data-inline-content-type") === "pageMention" && isUuid(id) ? { noteId: id.toLowerCase() } : undefined;
    },
  },
);
