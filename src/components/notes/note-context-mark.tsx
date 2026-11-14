import { Inbox } from "lucide-react";
import type { NotesBucketContext } from "@/lib/notes-bucket-context";

export function NoteContextMark({ context, labelled = false }: {
  context: NotesBucketContext | undefined;
  labelled?: boolean;
}) {
  if (!context) return null;
  return <span className="notes-context-mark" role={labelled ? "img" : undefined}
    aria-label={labelled ? context.label : undefined} aria-hidden={labelled ? undefined : true}>
    <Inbox aria-hidden="true" />
  </span>;
}
