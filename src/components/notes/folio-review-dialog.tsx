"use client";
import { useState } from "react";
import type { NoteDetail } from "@/lib/notes-model";
import { saveFeatures } from "@/lib/folio-feature-client";
import { FeatureDialog } from "./folio-dialog";
import { FolioPeople } from "./folio-people";
import s from "./folio-features.module.css";
export function FolioReviewDialog({
  note,
  onClose,
  onSaved,
  viewerId,
}: {
  note: NoteDetail;
  onClose: () => void;
  onSaved: () => void;
  viewerId: string;
}) {
  const [maintainer, setMaintainer] = useState(
      note.features?.maintainerId ?? "",
    ),
    [due, setDue] = useState(note.features?.reviewDue ?? ""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const people = note.features?.people ?? [],
    options = [
      ...people,
      ...(!people.some((p) => p.id === viewerId)
        ? [{ id: viewerId, name: "Me", role: "Contributor" as const }]
        : []),
    ].filter((p) => p.id !== "shared-link");
  const save = async (reviewed = false) => {
    setBusy(true);
    setError("");
    try {
      await saveFeatures(note.id, {
        maintainerId: maintainer || null,
        reviewDue: due || null,
        reviewed,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <FeatureDialog title="People and review" onClose={onClose}>
      <div className={s.reviewPeople}>
        {people.map((p) => (
          <div key={p.id}>
            <FolioPeople people={[p]} />
            <span>
              {p.name}
              <small className={s.muted}> · {p.role}</small>
            </span>
          </div>
        ))}
      </div>
      <p className={s.muted}>
        Contributors have edited this note. These indicators do not show who is
        online.
      </p>
      <label>
        Maintainer
        <select className="ed-field"
          value={maintainer}
          onChange={(e) => setMaintainer(e.target.value)}
          disabled={!note.canEdit}
        >
          <option value="">Not assigned</option>
          {options.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        Next review
        <input className="ed-field"
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          disabled={!note.canEdit}
        />
      </label>
      <p className={s.muted}>
        {note.features?.reviewedAt
          ? `Last reviewed ${new Date(note.features.reviewedAt).toLocaleString()}`
          : "This note has not been marked reviewed."}{" "}
        Due notes appear under Review due in Find notes.
      </p>
      {error ? (
        <p role="alert" className={s.error}>
          {error}
        </p>
      ) : null}
      {note.canEdit ? (
        <footer>
          <button
            className="ui-button ed-button"
            disabled={busy}
            onClick={() => void save()}
          >
            Save details
          </button>
          <button
            className="ui-button ui-button-primary ed-button"
            disabled={busy}
            onClick={() => void save(true)}
          >
            Mark reviewed
          </button>
        </footer>
      ) : null}
    </FeatureDialog>
  );
}
