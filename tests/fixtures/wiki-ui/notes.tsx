"use client";
import { useEffect, useState } from "react";
import { NotesWorkspace } from "../../../src/components/notes/notes-workspace";
import { ids } from "./state";
export default function NotesFixture() {
  const [phone, setPhone] = useState(false);
  useEffect(() => { const media = matchMedia("(max-width: 767px)"); const change = () => setPhone(media.matches); change(); media.addEventListener("change", change); return () => media.removeEventListener("change", change); }, []);
  return <div className="taskboard-shell" style={{ height: "100dvh", display: "flex" }}><NotesWorkspace initialNoteId={ids.note} homeOptions={[{ boardId: ids.board, title: "Example team", canEdit: true, isPersonalBoard: false, buckets: [] }]} createRequest={0} searchQuery="" onClearSearch={() => {}} viewerId="fixture-user" linkableTasks={[]} linkableTasksBoardId={ids.board} isPhone={phone} /></div>;
}
