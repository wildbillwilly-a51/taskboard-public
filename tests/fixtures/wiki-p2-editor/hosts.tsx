"use client";
import { NotesWorkspace } from "@/components/notes/notes-workspace";
import { TaskLinkedNotes } from "@/components/notes/task-linked-notes";
import { TaskWorkspaceLayout } from "@/components/task-workspace-layout";
import { setNotesToken } from "@/components/use-live-board-revision";
import { ids } from "../wiki-ui/state";

export default function Hosts({ surface }: { surface: string }) {
  const phone = window.innerWidth < 768; // This fixture is loaded with ssr:false.
  return <div className="taskboard-shell" style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
    <button onClick={() => setNotesToken(String(Date.now()))}>Refresh access and mentions</button>
    {surface === "notes" ? <NotesWorkspace initialNoteId={ids.note} homeOptions={[{ boardId: ids.board, title: "Example team", canEdit: true, isPersonalBoard: false, buckets: [] }]} createRequest={0} searchQuery="" onClearSearch={() => {}} viewerId="fixture-user" linkableTasks={[]} linkableTasksBoardId={ids.board} isPhone={phone} />
      : <TaskWorkspaceLayout work={null} workingNotes={null} details={null} files={null} notesCount={0} filesCount={0} notes={<TaskLinkedNotes enabled taskId={ids.note} boardId={ids.board} bucketId={null} canEdit />} />}
  </div>;
}
