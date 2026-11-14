"use client";

import { useEffect, useRef, useState } from "react";
import { WorkItemTimeEditor, type WorkItemPatch } from "@/components/work-item-time-editor";
import type { Task } from "@/lib/taskboard-data";

export function TaskActionTimeDialog({ task, onSave, onClose }: {
  task: Task;
  onSave: (patch: WorkItemPatch) => Promise<boolean>;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { dialog.current?.showModal(); }, []);
  return <dialog ref={dialog} className="taskboard-popover w-[min(30rem,calc(100vw-2rem))] rounded-xl p-4 text-foreground"
    aria-label={`Set time for ${task.title}`} data-testid="task-action-time-dialog"
    data-keep-surfaces-open=""
    onKeyDown={(event) => { if (event.key === "Escape") event.stopPropagation(); }}
    onCancel={(event) => { event.preventDefault(); if (!saving) onClose(); }}>
    <h2 className="mb-3 font-semibold">Set time for {task.title}</h2>
    <fieldset disabled={saving}>
      <WorkItemTimeEditor item={task} parentSpan={null} depth={0} onCancel={onClose} onSave={async (patch) => {
        if (saving) return;
        setSaving(true);
        try {
          if (await onSave(patch)) onClose();
          else setError("The time could not be saved. Try again.");
        } finally { setSaving(false); }
      }} />
    </fieldset>
    {error ? <p role="alert">{error}</p> : null}
  </dialog>;
}
