"use client";

import { Plus } from "lucide-react";
import { useEffect, useId, useMemo, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { NoteHomeBoardOption } from "@/lib/notes-model";

export type LinkableTask = { id: string; title: string; bucketTitle: string };

type BoardTasks = { status: "loading" | "ready" | "error"; tasks: LinkableTask[] };

async function fetchBoardTasks(boardId: string, signal: AbortSignal): Promise<LinkableTask[]> {
  // The existing board read, with the usual board access checks.
  const response = await fetch(`/api/board?boardId=${encodeURIComponent(boardId)}`, { signal });

  if (!response.ok) {
    throw new Error("Unable to load that board's tasks.");
  }

  const state = (await response.json()) as {
    board?: { buckets?: Array<{ title: string; tasks?: Array<{ id: string; title: string }> }> };
  };

  return (state.board?.buckets ?? []).flatMap((bucket) =>
    (bucket.tasks ?? []).map((task) => ({ id: task.id, title: task.title, bucketTitle: bucket.title })),
  );
}

// "Link a task": choose a board, type to filter its tasks, pick one with the
// mouse or Arrow keys and Enter.
export function TaskLinkPicker({
  boards,
  initialBoardId,
  shellBoardId,
  shellTasks,
  excludeIds,
  isPhone = false,
  onPick,
}: {
  boards: NoteHomeBoardOption[];
  initialBoardId: string;
  shellBoardId: string;
  shellTasks: LinkableTask[];
  excludeIds: Set<string>;
  // Desktop fields take Taskboard's shared classes; the phone keeps its own.
  isPhone?: boolean;
  onPick: (taskId: string) => void;
}) {
  const listId = useId();
  const [boardId, setBoardId] = useState(initialBoardId);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [loaded, setLoaded] = useState<Record<string, BoardTasks>>({});

  useEffect(() => {
    if (!isOpen || boardId === shellBoardId || loaded[boardId]) {
      return;
    }

    const controller = new AbortController();
    fetchBoardTasks(boardId, controller.signal)
      .then((tasks) => setLoaded((current) => ({ ...current, [boardId]: { status: "ready", tasks } })))
      .catch(() => {
        if (!controller.signal.aborted) {
          setLoaded((current) => ({ ...current, [boardId]: { status: "error", tasks: [] } }));
        }
      });

    return () => controller.abort();
  }, [boardId, isOpen, loaded, shellBoardId]);

  const boardTasks: BoardTasks =
    boardId === shellBoardId ? { status: "ready", tasks: shellTasks } : loaded[boardId] ?? { status: "loading", tasks: [] };

  const matches = useMemo(() => {
    const tokens = query.toLowerCase().split(/\s+/).filter(Boolean);
    return boardTasks.tasks
      .filter((task) => !excludeIds.has(task.id))
      .filter((task) => tokens.every((token) => task.title.toLowerCase().includes(token)))
      .slice(0, 8);
  }, [boardTasks.tasks, excludeIds, query]);

  const pick = (taskId: string | undefined) => {
    if (!taskId) {
      return;
    }

    onPick(taskId);
    setQuery("");
    setIsOpen(false);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setIsOpen(true);
        setActiveIndex((index) => Math.min(index + 1, Math.max(matches.length - 1, 0)));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
        break;
      case "Enter":
        if (isOpen && matches[activeIndex]) {
          event.preventDefault();
          pick(matches[activeIndex].id);
        }
        break;
      case "Escape":
        if (isOpen) {
          event.preventDefault();
          event.stopPropagation();
          setIsOpen(false);
        }
        break;
    }
  };

  const status =
    boardTasks.status === "loading"
      ? "Loading tasks…"
      : boardTasks.status === "error"
        ? "Couldn't load this board's tasks."
        : matches.length === 0
          ? query
            ? "No matching tasks."
            : "No tasks left to link."
          : "";

  return (
    <div className="notes-task-picker">
      <select
        className={`notes-select notes-task-picker-board${isPhone ? "" : " ui-select ed-field"}`}
        aria-label="Board to link a task from"
        value={boardId}
        onChange={(event) => {
          setBoardId(event.target.value);
          setActiveIndex(0);
          setIsOpen(true);
        }}
      >
        {boards.map((board) => (
          <option key={board.boardId} value={board.boardId}>
            {board.title}
          </option>
        ))}
      </select>
      <div className={`notes-task-picker-field${isPhone ? "" : " ui-control"}`}>
        <Plus className="h-3 w-3 shrink-0" aria-hidden="true" />
        <input
          className="notes-task-picker-input"
          role="combobox"
          aria-expanded={isOpen}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={isOpen && matches[activeIndex] ? `${listId}-${matches[activeIndex].id}` : undefined}
          aria-label="Link a task"
          placeholder="Link a task…"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          onBlur={() => window.setTimeout(() => setIsOpen(false), 120)}
          onKeyDown={handleKeyDown}
        />
      </div>
      {isOpen ? (
        <ul id={listId} role="listbox" aria-label="Tasks" className="notes-task-picker-list taskboard-popover">
          {matches.map((task, index) => (
            <li
              key={task.id}
              id={`${listId}-${task.id}`}
              role="option"
              aria-selected={index === activeIndex}
              className="notes-task-picker-option"
              onMouseEnter={() => setActiveIndex(index)}
              onMouseDown={(event) => {
                event.preventDefault();
                pick(task.id);
              }}
            >
              <span className="truncate">{task.title}</span>
              <span className="notes-task-picker-bucket">{task.bucketTitle}</span>
            </li>
          ))}
          {status ? <li className="notes-task-picker-status">{status}</li> : null}
        </ul>
      ) : null}
    </div>
  );
}
