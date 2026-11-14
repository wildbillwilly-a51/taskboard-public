"use client";
import { useEffect, useState } from "react";
import type { NoteDetail } from "@/lib/notes-model";
import type { FolioFeatures } from "@/lib/folio-features-model";
import { featureRequest, saveFeatures } from "@/lib/folio-feature-client";
import { FolioPeople } from "./folio-people";
import { FolioReviewDialog } from "./folio-review-dialog";
import { FolioShareDialog } from "./folio-share-dialog";
import { FolioDiscoveryDialog } from "./folio-discovery-dialog";
import s from "./folio-features.module.css";
export function FolioNoteTools({
  note,
  viewerId,
  onOpen,
  onFeatures,
}: {
  note: NoteDetail;
  viewerId: string;
  onOpen: (id: string) => void;
  onFeatures: (f: FolioFeatures) => void;
}) {
  const [dialog, setDialog] = useState<"people" | "share" | "backlinks" | null>(
      null,
    ),
    [backlinks, setBacklinks] = useState<number | null>(null),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    void featureRequest<{ notes: unknown[]; hasMore: boolean }>(
      `/api/folio/discovery?backlinkTo=${note.id}`,
      undefined,
      c.signal,
    )
      .then((r) => setBacklinks(r.notes.length + (r.hasMore ? 1 : 0)))
      .catch(() => {});
    return () => c.abort();
  }, [note.id, note.contentVersion]);
  const refresh = () => {
    void featureRequest<{ features: FolioFeatures }>(
      `/api/folio/discovery?action=features&noteId=${note.id}`,
    )
      .then((r) => onFeatures(r.features))
      .catch((e) => setError(e.message));
  };
  return (
    <>
      <div className={s.bar}>
        <button className="ui-button ed-button" onClick={() => setDialog("people")}>
          <FolioPeople people={note.features?.people} /> People and review
        </button>
        <button className="ui-button ed-button" onClick={() => setDialog("backlinks")}>
          Linked from
          {backlinks === null ? "" : ` (${backlinks > 40 ? "40+" : backlinks})`}
        </button>
        {note.ownerUserId === viewerId &&
        note.folio?.kind === "document" &&
        !note.archived &&
        !note.deletedAt ? (
          <button className="ui-button ed-button" onClick={() => setDialog("share")}>
            Share
          </button>
        ) : null}
        {note.canEdit && !note.archived && !note.deletedAt ? (
          <button
            className="ui-button ed-button"
            onClick={() =>
              void saveFeatures(note.id, {
                isTemplate: !note.features?.isTemplate,
              })
                .then((r) => onFeatures(r.features))
                .catch((e) => setError(e.message))
            }
          >
            {note.features?.isTemplate
              ? "Remove template status"
              : "Save as template"}
          </button>
        ) : null}
        {note.features?.reviewDue ? (
          <span
            className={`${s.badge} ${note.features.reviewDue <= new Date().toLocaleDateString("en-CA") ? s.due : ""}`}
          >
            Review {note.features.reviewDue}
          </span>
        ) : null}
      </div>
      {error ? (
        <p className={s.error} role="alert">
          {error}
        </p>
      ) : null}
      {dialog === "people" ? (
        <FolioReviewDialog
          note={note}
          viewerId={viewerId}
          onClose={() => setDialog(null)}
          onSaved={refresh}
        />
      ) : dialog === "share" ? (
        <FolioShareDialog noteId={note.id} onClose={() => {setDialog(null);refresh();}} />
      ) : dialog === "backlinks" ? (
        <FolioDiscoveryDialog
          backlinkTo={note.id}
          initialMode="search"
          onClose={() => setDialog(null)}
          onOpen={onOpen}
        />
      ) : null}
    </>
  );
}
