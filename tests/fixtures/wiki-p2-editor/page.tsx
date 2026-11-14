"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { setNotesToken } from "@/components/use-live-board-revision";
import type { NoteContentInput } from "@/lib/notes-model";
import { defaults, mentionDocument, mentionId, sourceId, spaceId } from "./documents";

const Editor = dynamic(() => import("@/components/notes/note-editor"), { ssr: false });
const Reader = dynamic(() => import("@/components/public-note-body"), { ssr: false });
const Probe = dynamic(() => import("./probe"), { ssr: false });
const Hosts = dynamic(() => import("./hosts"), { ssr: false });

export default function Fixture({ query = "" }: { query?: string }) {
  const params = new URLSearchParams(query);
  const kind = params.get("kind") ?? "wiki";
  const format = Number(params.get("format") ?? (kind === "ordinary" || kind === "defaults" ? "1" : "2"));
  const [editable, setEditable] = useState(params.get("readonly") !== "1");
  const [changed, setChanged] = useState<NoteContentInput>();
  const [count, setCount] = useState(0);
  const [session, setSession] = useState(0);
  const [formatting, setFormatting] = useState(false);
  const content = kind === "unknown" ? [{ type: "futureBlock", content: [] }]
    : kind === "defaults" ? defaults
    : kind === "empty" || kind === "ordinary" ? [{ type: "paragraph", content: [] }]
    : kind === "links" ? [{ type: "paragraph", content: [{ type: "link", href: "https://example.com/original", content: [{ type: "text", text: "A reference link", styles: {} }] }] }]
    : kind === "batch" ? [{ type: "paragraph", content: Array.from({ length: 205 }, (_, i) => ({ type: "pageMention", props: { noteId: `72000000-0000-4000-8000-${String(i).padStart(12, "0")}` } })) }]
    : mentionDocument;
  const context = kind === "public" || kind === "ordinary" || kind === "defaults" ? undefined : { spaceId, noteId: sourceId };
  if (params.get("surface")) return <Hosts surface={params.get("surface")!} />;
  return <main style={{ maxWidth: 850, margin: "24px auto", padding: 12 }}>
    <h1>Editor package fixture</h1>
    <nav style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
      <button onClick={() => setEditable(value => !value)}>Toggle editability</button>
      <button onClick={() => setFormatting(value => !value)}>Toggle formatting</button>
      <button onClick={() => setNotesToken(String(Date.now()))}>Notes token</button>
      <button onClick={() => window.dispatchEvent(new Event("taskboard-wiki-live"))}>Board token</button>
      <button onClick={() => setSession(value => value + 1)}>New session</button>
      <button onClick={() => { document.documentElement.dataset.theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark"; }}>Theme</button>
    </nav>
    {kind === "public" || kind === "reader" ? <Reader key={session} content={content} contentFormatVersion={format} wikiContext={context} />
      : <Editor key={session} initialBlocks={content} contentFormatVersion={format} wikiContext={context} editable={editable} mobile={params.get("mobile") === "1"} mobileFormatting={formatting} onCloseMobileFormatting={() => setFormatting(false)} onChange={value => { setChanged(value); setCount(value => value + 1); }} />}
    <output data-testid="changes">{count}</output>
    <pre data-testid="saved" style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{JSON.stringify(changed ?? null)}</pre>
    <Probe />
    <span hidden data-mention-id={mentionId} />
  </main>;
}
