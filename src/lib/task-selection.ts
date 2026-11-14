export type TaskSelectionState = {
  selectedTaskId: string | null;
  isInspectorVisible: boolean;
};

// What stays open after a task is archived or deleted. The removed task need
// not be the open one: a right-click menu or a keyboard shortcut can remove
// any card. So the open task stays open whenever it survives, and the
// selection only moves (to the parent or a neighbour) when the open task was
// removed with it. A closed inspector is never opened by a removal.
//
// Read `current` when the request has finished, not when it started: the
// viewer may have opened another task, or closed the inspector, meanwhile.
export function getSelectionAfterTaskRemoval({
  current,
  retainedTaskId,
  hasTask,
  fallbackTaskId,
  firstTaskId,
}: {
  current: TaskSelectionState;
  /** An archived task the inspector still shows (Done stays); it is not on the board. */
  retainedTaskId: string | null;
  /** Whether a task id is on the board after the removal. */
  hasTask: (taskId: string) => boolean;
  /** The parent of a removed subtask, or the neighbour of a removed card. */
  fallbackTaskId: string | null;
  firstTaskId: string | null;
}): TaskSelectionState {
  const { selectedTaskId, isInspectorVisible } = current;
  if (!selectedTaskId || hasTask(selectedTaskId) || selectedTaskId === retainedTaskId) {
    return current;
  }

  const nextTaskId = fallbackTaskId && hasTask(fallbackTaskId) ? fallbackTaskId : firstTaskId;
  return { selectedTaskId: nextTaskId, isInspectorVisible: isInspectorVisible && Boolean(nextTaskId) };
}
