"use client";

import { createExtension, type ExtensionOptions } from "@blocknote/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import { noteSections, personalFoldKey, parsePersonalFolds, movesDraftFolds } from "@/lib/note-sections";

type FoldState = { folded: Set<string>; decorations: DecorationSet };
const key = new PluginKey<FoldState>("folioPersonalFolds");
type FoldOptions = { viewerId: string; noteId: string };

function sectionDocument(doc: PMNode) {
  const positions = new Map<string, { pos: number; size: number }>();
  doc.descendants((node, pos) => {
    if (node.type.name === "blockContainer" && typeof node.attrs.id === "string") positions.set(node.attrs.id, { pos, size: node.nodeSize });
  });
  const group = (node: PMNode): unknown[] => {
    const blocks: unknown[] = [];
    node.forEach(container => {
      const content = container.firstChild;
      if (!content) return;
      const children: unknown[] = [];
      container.forEach(child => { if (child.type.name === "blockGroup") children.push(...group(child)); });
      blocks.push({ id: container.attrs.id, type: content.type.name, props: content.attrs, content: content.textContent, children });
    });
    return blocks;
  };
  return { positions, sections: noteSections(doc.firstChild ? group(doc.firstChild) : []) };
}

// Decorations and their meta transactions belong only to this editor view.
// No heading prop, block hierarchy, saved JSON, Markdown or version is changed.
export const NoteSectionFolds = createExtension(({ editor, options }: ExtensionOptions<FoldOptions>) => {
  let identity = options;
  let storageKey = personalFoldKey(identity.viewerId, identity.noteId);
  const read = () => { try { return parsePersonalFolds(localStorage.getItem(storageKey)); } catch { return new Set<string>(); } };
  const write = (folded: Set<string>) => { try { localStorage.setItem(storageKey, JSON.stringify([...folded].slice(-500))); return true; } catch { return false; /* View state still works without storage. */ } };
  const build = (doc: PMNode, folded: Set<string>): FoldState => {
    if (editor.isEditable) return { folded, decorations: DecorationSet.empty };
    const { sections, positions } = sectionDocument(doc);
    const hidden = new Set(sections.filter(s => folded.has(s.id)).flatMap(s => s.members));
    const decorations: Decoration[] = [];
    for (const id of hidden) {
      const node = positions.get(id);
      if (node) decorations.push(Decoration.node(node.pos, node.pos + node.size, { class: "folio-section-hidden" }));
    }
    for (const section of sections) {
      if (!section.members.length || hidden.has(section.id)) continue;
      const node = positions.get(section.id);
      if (!node) continue;
      const closed = folded.has(section.id);
      decorations.push(Decoration.widget(node.pos + 2, () => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "folio-section-toggle";
        button.contentEditable = "false";
        button.setAttribute("aria-label", `${closed ? "Expand" : "Collapse"} ${section.label}`);
        button.setAttribute("aria-expanded", String(!closed));
        button.title = `${closed ? "Expand" : "Collapse"} section (your view only)`;
        button.textContent = closed ? "▸" : "▾";
        button.addEventListener("mousedown", e => e.preventDefault());
        button.addEventListener("click", e => {
          e.preventDefault(); e.stopPropagation();
          const view = editor.prosemirrorView;
          const current = key.getState(view.state);
          if (!current || editor.isEditable) return;
          const next = new Set(current.folded);
          if (next.has(section.id)) next.delete(section.id); else next.add(section.id);
          view.dispatch(view.state.tr.setMeta(key, next).setMeta("addToHistory", false));
          // A decoration replacement must not discard keyboard focus.
          view.dom.querySelector<HTMLButtonElement>(`[data-fold-id="${CSS.escape(section.id)}"]`)?.focus({ preventScroll: true });
        });
        button.dataset.foldId = section.id;
        return button;
      }, { key: `fold:${section.id}:${closed}:${section.label}`, side: -1, stopEvent: () => true }));
    }
    return { folded, decorations: DecorationSet.create(doc, decorations) };
  };
  return {
    key: "folioPersonalFolds",
    setIdentity(viewerId: string, noteId: string) {
      if (identity.viewerId === viewerId && identity.noteId === noteId) return;
      const view = editor.prosemirrorView;
      const moving = movesDraftFolds(identity.viewerId, identity.noteId, viewerId, noteId);
      const current = key.getState(view.state)?.folded ?? read();
      const oldKey = storageKey;
      identity = { viewerId, noteId };
      storageKey = personalFoldKey(viewerId, noteId);
      const next = moving ? current : read();
      // Creation changes identity without remounting the live draft editor.
      // Preserve those personal folds, but never transfer them to another user
      // or an unrelated note. A failed storage write leaves the old key intact.
      if (moving && write(next)) { try { localStorage.removeItem(oldKey); } catch { /* harmless stale preference */ } }
      view.dispatch(view.state.tr.setMeta(key, next).setMeta("addToHistory", false));
    },
    // BlockNoteView unmounts/remounts its view on Read/Edit changes while
    // retaining plugin state. Rebuild decorations at that public mount boundary.
    mount() {
      const view = editor.prosemirrorView;
      view.dispatch(view.state.tr.setMeta(key, true).setMeta("addToHistory", false));
    },
    prosemirrorPlugins: [new Plugin<FoldState>({
      key,
      state: {
        init: (_, state) => build(state.doc, read()),
        apply: (tr, previous) => {
          const next = tr.getMeta(key);
          if (!tr.docChanged && !next) return previous;
          if (next instanceof Set) write(next);
          return build(tr.doc, next instanceof Set ? next : previous.folded);
        },
      },
      view(view) {
        let editable = view.editable;
        return { update(view) { if (view.editable !== editable) { editable = view.editable; view.dispatch(view.state.tr.setMeta(key, true).setMeta("addToHistory", false)); } } };
      },
      props: { decorations: state => key.getState(state)?.decorations },
    })],
  };
});

export function revealPersonalSection(editor: { prosemirrorView: { state: import("@tiptap/pm/state").EditorState; dispatch: (tr: import("@tiptap/pm/state").Transaction) => void } }, blockId: string) {
  const view = editor.prosemirrorView;
  const current = key.getState(view.state);
  if (!current) return;
  const next = new Set(current.folded);
  for (const section of sectionDocument(view.state.doc).sections) if (section.id === blockId || section.members.includes(blockId)) next.delete(section.id);
  if (next.size !== current.folded.size) view.dispatch(view.state.tr.setMeta(key, next).setMeta("addToHistory", false));
}
