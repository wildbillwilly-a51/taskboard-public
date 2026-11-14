"use client";
// Synthetic HTTP boundary, real Folio workspace/editor/outline. Mount only from
// an owned temporary QA route; never expose this fixture in a production route.
import { useEffect, useState } from "react";
import { FolioWorkspace } from "../../../src/components/notes/folio-workspace";
import type { NoteDetail } from "../../../src/lib/notes-model";
import { defaultFolioPageState } from "../../../src/lib/folio-model";
import { useUiSettings } from "../../../src/components/settings-provider";
const noteId = "77000000-0000-4000-8000-000000000001";
const createdId = "77000000-0000-4000-8000-000000000005";
const pageId = "77000000-0000-4000-8000-000000000002";
const spaceId = "77000000-0000-4000-8000-000000000003";
const owner = "77000000-0000-4000-8000-000000000004";
const heading = (id: string, text: string, level = 1, children: unknown[] = []) => ({ id, type: "heading", props: { level }, content: text, children });
const content = [heading("overview", "Overview"), ...Array.from({ length: 14 }, (_, n) => ({ id: `p${n}`, type: "paragraph", content: `Opening paragraph ${n + 1}. Automatic contents follows headings without maintenance.` })),
  heading("setup", "Setup", 2), { id: "setup-body", type: "paragraph", content: "Set up a safe workspace before changing shared configuration." }, heading("details", "Details", 4), { id: "details-body", type: "paragraph", content: "Detailed instructions remain part of the original document when folded." }, heading("duplicate", "Setup", 2),
  { ...heading("folded", "Folded section", 1, [heading("hidden-child", "Nested destination", 3)]), props: { level: 1, isToggleable: true } },
  ...Array.from({ length: 14 }, (_, n) => ({ id: `end${n}`, type: "paragraph", content: `Ending paragraph ${n + 1}. Keep reading to verify active section tracking.` })), heading("blank", "", 1)];
const wideContent = [
  { id: "wide-code", type: "codeBlock", props: {language: "typescript"}, content: [{type: "text", text: "const safe = 'A long code example can use more width than a normal paragraph without changing the prose measure.';", styles: {}}] },
  { id: "wide-table", type: "table", content: {type: "tableContent", columnWidths: [280,280,280], rows: [{cells: [[{type:"text",text:"First column",styles:{}}],[{type:"text",text:"Second column",styles:{}}],[{type:"text",text:"Third column",styles:{}}]]}]}}
];
const note = (id: string, page = false): NoteDetail => ({ id, title: page ? "Documentation" : "Contents verification", displayTitle: page ? "Documentation" : "Contents verification", snippet: "", content, contentMarkdown: "# Overview", contentFormatVersion: 2, contentVersion: 1,
  home: { kind: "personal" }, notebookId: null, labels: [], pinned: false, archived: false, deletedAt: null, purgeAfterAt: null, ownerUserId: owner, ownerDisplayName: "Fixture writer", updatedByDisplayName: "Fixture writer", createdAt: "2026-11-06T00:00:00Z", updatedAt: "2026-11-06T00:00:00Z", canEdit: true, linkedTaskCount: 0, attachmentCount: 0, linkedTasks: [], attachments: [],
  folio: { kind: page ? "space_page" : "document", audience: "public", unconnected: !page, favorite: false, connections: [], pageSpaceId: page ? spaceId : null, pageState: { ...defaultFolioPageState, notesListVisible: page } } });

export default function ContentsFixture() {
  const { updateSetting } = useUiSettings();
  const [releaseCreate, setReleaseCreate] = useState<(() => void) | null>(null);
  const [ready, setReady] = useState(false);
  const [phone, setPhone] = useState(false);
  const [receipt, setReceipt] = useState({ writes: 0, firstId: "", markdown: "" });
  const [params] = useState(() => typeof window === "undefined" ? new URLSearchParams() : new URLSearchParams(window.location.search));
  useEffect(() => {
    const notes = new Map([[noteId, note(noteId)], [pageId, note(pageId, true)]]);
    if (params.has("draft")) {
      try { const saved = JSON.parse(sessionStorage.getItem("folio-design-draft-fixture") ?? "null"); if (saved?.id === createdId) notes.set(createdId, saved); } catch { /* synthetic storage only */ }
    }
    if (params.has("wide")) notes.get(noteId)!.content = [content[0], ...wideContent, ...content.slice(1)];
    if (params.has("empty")) notes.get(noteId)!.content = [{ id: "plain", type: "paragraph", content: "No headings yet." }];
    if (params.has("legacy")) notes.get(noteId)!.content = [{ type: "heading", props: { level: 1 }, content: "Legacy heading" }];
    if (params.has("readonly")) notes.get(noteId)!.canEdit = false;
    const original = window.fetch;
    const clipboardDescriptor = Object.getOwnPropertyDescriptor(navigator, "clipboard");
    if (params.has("clipboardFail")) Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: () => Promise.reject(new Error("Synthetic clipboard denial")) } });
    window.fetch = async (input, init) => {
      const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url, location.origin);
      const send = (value: unknown, status = 200) => Promise.resolve(new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } }));
      if (url.pathname === "/api/folio") {
        if (init?.method === "POST" && JSON.parse(String(init.body)).action === "createNote") {
          if (params.has("draft")) await new Promise<void>(resolve => setReleaseCreate(() => resolve));
          const created = {...note(createdId), title:"", displayTitle:"Untitled note", content:[], contentMarkdown:""};
          notes.set(createdId, created);
          if (params.has("draft")) sessionStorage.setItem("folio-design-draft-fixture", JSON.stringify(created));
          return send({note: created});
        }
        if (url.searchParams.get("action") === "list") return send({ notes: [notes.get(noteId)], hasMore: false, offset: 0 });
        if (url.searchParams.get("action") === "page") return send({ note: notes.get(pageId) });
        return send({ spaces: [{ id: spaceId, kind: "shared", title: "Documentation", parentId: null, ownerUserId: null, boardId: null, taskId: null, root: false, archived: false, pageNoteId: pageId, canManage: true }], rootSpaceId: spaceId });
      }
      if (url.pathname.startsWith("/api/notes/")) {
        const item = notes.get(url.pathname.split("/")[3]);
        if (!item) return send({ error: "Not found" }, 404);
        if (init?.method === "PATCH") {
          if (params.has("fail")) return send({ error: "Synthetic save failed" }, 503);
          const body = JSON.parse(String(init.body));
          if (body.expectedVersion !== item.contentVersion) return send({ code: "note_conflict", currentVersion: item.contentVersion }, 409);
          if (body.title !== undefined) item.title = body.title;
          if (body.labels !== undefined) item.labels = body.labels;
          if (body.content) { item.content = body.content.blocks; item.contentMarkdown = body.content.markdown; }
          item.contentVersion++;
          if (params.has("draft") && item.id === createdId) sessionStorage.setItem("folio-design-draft-fixture", JSON.stringify(item));
          setReceipt(old => ({ writes: old.writes + 1, firstId: String((item.content[0] as { id?: unknown })?.id ?? ""), markdown: item.contentMarkdown }));
        }
        return send({ note: item });
      }
      return original(input, init);
    };
    const media = matchMedia("(max-width: 767px)");
    const change = () => setPhone(media.matches);
    const frame = requestAnimationFrame(() => { change(); setReady(true); });
    media.addEventListener("change", change);
    return () => { cancelAnimationFrame(frame); window.fetch = original; media.removeEventListener("change", change); if (params.has("clipboardFail")) { if (clipboardDescriptor) Object.defineProperty(navigator, "clipboard", clipboardDescriptor); else Reflect.deleteProperty(navigator, "clipboard"); } };
  }, [params]);
  return ready ? <><main className="taskboard-shell" data-phone-notes={phone} style={{ display: "flex", height: "100dvh", overflow: "hidden" }}><FolioWorkspace initialNoteId={params.get("note") ?? (params.has("page") ? pageId : noteId)} sessionKey="contents-fixture" homeOptions={[]} createRequest={0} searchQuery="" onClearSearch={() => {}} viewerId={params.get("viewer") ?? owner} isPhone={phone} /></main><div style={{position:"fixed",bottom:8,right:8,zIndex:60,display:"flex",gap:8}}><button onClick={() => updateSetting("theme", "light")}>QA light</button>{releaseCreate ? <button onClick={() => {releaseCreate(); setReleaseCreate(null);}}>QA release create</button> : null}<button onClick={() => updateSetting("theme", "dark")}>QA dark</button></div><output hidden data-testid="fixture-receipt">{JSON.stringify(receipt)}</output></> : <p>Preparing synthetic Folio fixture…</p>;
}
