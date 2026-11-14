import type { Board, Bucket } from "@/lib/taskboard-data";

export type TaskDropPlacement = "before" | "after" | "append";

export function findRootTaskBucketId(buckets: Bucket[], taskId: string): string | null {
  return buckets.find((bucket) => bucket.tasks.some((task) => task.id === taskId))?.id ?? null;
}

export function getRootTaskIndex(buckets: Bucket[], bucketId: string, taskId: string) {
  const bucket = buckets.find((candidate) => candidate.id === bucketId);
  return bucket?.tasks.findIndex((task) => task.id === taskId) ?? -1;
}

// Before or after the hovered task, decided by where the pointer is. The dragged
// card's own center is a poor guide: a tall card grabbed near its bottom has its
// center far above the pointer, so dropping just below a bucket's last card
// would land one slot too high. Keyboard drags have no pointer and fall back to
// the dragged card's center.
export function getTaskDropPlacement(
  activeRect: { top: number; height: number } | null,
  overRect: { top: number; height: number },
  overType: "bucket" | "bucket-column" | "task" | undefined,
  pointerY: number | null = null,
): TaskDropPlacement {
  if (overType !== "task") {
    return "append";
  }

  const referenceY =
    pointerY ?? (activeRect ? activeRect.top + activeRect.height / 2 : null);
  if (referenceY === null) {
    return "before";
  }

  const overCenter = overRect.top + overRect.height / 2;
  return referenceY > overCenter ? "after" : "before";
}

/**
 * Placement for a drop inside the task's own bucket. The sortable list shows
 * the dragged card taking the hovered card's slot, so the card lands after the
 * hovered card when moving down and before it when moving up (or stays put
 * when the hovered card is itself).
 */
export function getSameBucketDropPlacement(
  tasks: ReadonlyArray<{ id: string }>,
  activeTaskId: string,
  overTaskId: string,
): TaskDropPlacement {
  const activeIndex = tasks.findIndex((task) => task.id === activeTaskId);
  const overIndex = tasks.findIndex((task) => task.id === overTaskId);

  return activeIndex >= 0 && overIndex > activeIndex ? "after" : "before";
}

export function moveRootTaskOnBoard(
  board: Board,
  activeTaskId: string,
  targetBucketId: string,
  placement: TaskDropPlacement,
  overTaskId?: string,
) {
  const sourceBucketId = findRootTaskBucketId(board.buckets, activeTaskId);
  const sourceBucket = board.buckets.find((bucket) => bucket.id === sourceBucketId);
  const targetBucket = board.buckets.find((bucket) => bucket.id === targetBucketId);

  if (!sourceBucket || !targetBucket) {
    return board;
  }

  const sourceIndex = sourceBucket.tasks.findIndex((task) => task.id === activeTaskId);
  if (sourceIndex < 0) {
    return board;
  }

  const overIndex = overTaskId
    ? targetBucket.tasks.findIndex((task) => task.id === overTaskId)
    : -1;
  let insertionIndex =
    placement === "append" || overIndex < 0
      ? targetBucket.tasks.length
      : overIndex + (placement === "after" ? 1 : 0);

  if (sourceBucket.id === targetBucket.id) {
    const nextTasks = [...sourceBucket.tasks];
    const [movedTask] = nextTasks.splice(sourceIndex, 1);

    if (sourceIndex < insertionIndex) {
      insertionIndex -= 1;
    }

    insertionIndex = Math.max(0, Math.min(insertionIndex, nextTasks.length));
    nextTasks.splice(insertionIndex, 0, movedTask);

    if (nextTasks.every((task, index) => task === sourceBucket.tasks[index])) {
      return board;
    }

    return {
      ...board,
      buckets: board.buckets.map((bucket) =>
        bucket.id === sourceBucket.id ? { ...bucket, tasks: nextTasks } : bucket,
      ),
    };
  }

  const movedTask = sourceBucket.tasks[sourceIndex];
  const nextSourceTasks = sourceBucket.tasks.filter((task) => task.id !== activeTaskId);
  const nextTargetTasks = [...targetBucket.tasks];
  insertionIndex = Math.max(0, Math.min(insertionIndex, nextTargetTasks.length));
  nextTargetTasks.splice(insertionIndex, 0, movedTask);

  return {
    ...board,
    buckets: board.buckets.map((bucket) => {
      if (bucket.id === sourceBucket.id) {
        return { ...bucket, tasks: nextSourceTasks };
      }

      if (bucket.id === targetBucket.id) {
        return { ...bucket, tasks: nextTargetTasks };
      }

      return bucket;
    }),
  };
}
