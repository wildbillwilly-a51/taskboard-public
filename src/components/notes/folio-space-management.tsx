"use client";

import { useMemo, useState } from "react";
import {
  maxFolioSpaceSelection,
  type FolioSpace,
  type FolioSpaceBatchChange,
} from "@/lib/folio-model";
import styles from "./folio.module.css";

const libraryLabel = (space: FolioSpace) => space.kind === "personal" ? "Personal" : "Folio";

function ancestry(space: FolioSpace, byId: ReadonlyMap<string, FolioSpace>) {
  const result: FolioSpace[] = [];
  const seen = new Set<string>();
  for (let current: FolioSpace | undefined = space; current && !seen.has(current.id); current = current.parentId ? byId.get(current.parentId) : undefined) {
    result.unshift(current);
    seen.add(current.id);
  }
  return result;
}

export function FolioSpaceLocation({
  spaces, selectedIds, scope, value, onChange, disabled,
}: {
  spaces: readonly FolioSpace[];
  selectedIds: readonly string[];
  scope: "personal" | "shared" | "both";
  value: string | null | undefined;
  onChange: (id: string | null) => void;
  disabled?: boolean;
}) {
  const byId = new Map(spaces.map(space => [space.id, space]));
  const selected = new Set(selectedIds);
  const options = spaces.flatMap(space => {
    if (space.archived || (space.kind !== "personal" && space.kind !== "shared")) return [];
    const path = ancestry(space, byId);
    if (path.some(item => selected.has(item.id))) return [];
    return [{ id: space.id, kind: space.kind, label: path.map(item => item.title).join(" / ") }];
  });
  return (
    <label>
      Location
      <select
        className="ed-field"
        required
        disabled={disabled}
        value={value === null ? "folio" : value ?? ""}
        onChange={event => onChange(event.target.value === "folio" ? null : event.target.value)}
      >
        {value === undefined ? <option value="" disabled>Choose a location</option> : null}
        {scope !== "shared" ? <optgroup label="Personal">
          {options.filter(item => item.kind === "personal").map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </optgroup> : null}
        {scope !== "personal" ? <optgroup label="Folio">
          <option value="folio">Folio (top level)</option>
          {options.filter(item => item.kind === "shared").map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
        </optgroup> : null}
      </select>
    </label>
  );
}

export function FolioShareNotice() {
  return <p>Spaces, subspaces, their pages, and connected notes moved to Folio become available to everyone with Taskboard access.</p>;
}

export function FolioBulkSpaceForm({
  spaces, busy, error, onSubmit,
}: {
  spaces: readonly FolioSpace[];
  busy: boolean;
  error: string;
  onSubmit: (ids: string[], change: FolioSpaceBatchChange) => void;
}) {
  const [query, setQuery] = useState("");
  const [selection, setSelection] = useState<Set<string>>(() => new Set());
  const [action, setAction] = useState<"move" | "archive" | "delete">("move");
  const [destination, setDestination] = useState<string | null>();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const byId = useMemo(() => new Map(spaces.map(space => [space.id, space])), [spaces]);
  const entries = useMemo(() => {
    return spaces.filter(space => space.canManage && !space.root).map(space => ({
      space,
      label: `${libraryLabel(space)} / ${ancestry(space, byId).map(item => item.title).join(" / ")}`,
    })).sort((a, b) => a.label.localeCompare(b.label));
  }, [spaces, byId]);
  const filtered = entries.filter(item => item.label.toLowerCase().includes(query.trim().toLowerCase()));
  const selected = entries.filter(item => selection.has(item.space.id)).map(item => item.space);
  const ids = selected.map(space => space.id);
  const containsPersonal = selected.some(space => space.kind === "personal");
  const containsShared = selected.some(space => space.kind === "shared");
  const target = destination ? byId.get(destination) : undefined;
  const validTarget = target && !target.archived && !(containsShared && target.kind === "personal") &&
    !ancestry(target, byId).some(space => selection.has(space.id));
  const location = destination === null || validTarget ? destination : undefined;
  const sharing = containsPersonal && (location === null || Boolean(location && target?.kind === "shared"));
  const disabled = busy || !ids.length || (
    action === "move" ? location === undefined :
    action === "archive" ? containsPersonal : !confirmDelete
  );
  function changeSelection(next: Set<string>) {
    setSelection(next);
    setConfirmDelete(false);
  }
  return (
    <form onSubmit={event => {
      event.preventDefault();
      if (disabled) return;
      if (action === "move" && location !== undefined) onSubmit(ids, { parentId: location, share: sharing });
      if (action === "archive") onSubmit(ids, { archived: true });
      if (action === "delete") onSubmit(ids, { remove: true });
    }}>
      <label>
        Find spaces
        <input className="ed-field" type="search" data-dialog-initial-focus disabled={busy} value={query} onChange={event => setQuery(event.target.value)} />
      </label>
      <div className={styles.spaceFormActions}>
        <span role="status">{ids.length} selected</span>
        <button className="ui-button ed-button" type="button" disabled={busy || !filtered.length || ids.length >= maxFolioSpaceSelection} onClick={() => {
          changeSelection(new Set([...ids, ...filtered.map(item => item.space.id)].slice(0, maxFolioSpaceSelection)));
        }}>Select results</button>
        <button className="ui-button ed-button" type="button" disabled={busy || !ids.length} onClick={() => changeSelection(new Set())}>Clear selection</button>
      </div>
      {ids.length === maxFolioSpaceSelection ? <p>Select up to {maxFolioSpaceSelection} spaces per batch.</p> : null}
      <div className={styles.spaceSelection} role="group" aria-label="Spaces to manage">
        {filtered.length ? filtered.map(({ space, label }) => (
          <label className={styles.spaceSelectionRow} key={space.id}>
            <input type="checkbox" checked={selection.has(space.id)} disabled={busy || (!selection.has(space.id) && ids.length >= maxFolioSpaceSelection)} onChange={event => {
              const next = new Set(ids);
              if (event.target.checked) next.add(space.id);
              else next.delete(space.id);
              changeSelection(next);
            }} />
            <span>{label}</span>
          </label>
        )) : <p>No matching spaces.</p>}
      </div>
      <label>
        Action
        <select className="ed-field" disabled={busy} value={action} onChange={event => {
          setAction(event.target.value as typeof action);
          setConfirmDelete(false);
        }}>
          <option value="move">Move</option>
          <option value="archive">Archive</option>
          <option value="delete">Delete</option>
        </select>
      </label>
      {action === "move" ? <>
        <FolioSpaceLocation spaces={spaces} selectedIds={ids} scope={containsShared ? "shared" : "both"} value={location} onChange={setDestination} disabled={busy} />
        {sharing ? <FolioShareNotice /> : null}
      </> : null}
      {action === "archive" ? <p>{containsPersonal ? "Choose only shared Folio spaces to archive." : "Selected spaces and their subspaces move to Archive."}</p> : null}
      {action === "delete" ? <>
        <p>Subspaces you keep move up. Notes without an active space go to Unconnected, where everyone with Taskboard access can see them.</p>
        <label className={styles.spaceSelectionRow}>
          <input type="checkbox" checked={confirmDelete} disabled={busy} onChange={event => setConfirmDelete(event.target.checked)} />
          <span>Permanently delete the selected spaces, their pages, and page attachments.</span>
        </label>
      </> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className={styles.spaceFormActions}>
        <button className={`ui-button ed-button ${action === "delete" ? styles.spaceDelete : "ui-button-primary"}`} disabled={disabled}>
          {busy ? "Working…" : action === "delete" ? "Delete spaces" : action === "archive" ? "Archive spaces" : sharing ? "Move to Folio" : "Move spaces"}
        </button>
      </div>
    </form>
  );
}
