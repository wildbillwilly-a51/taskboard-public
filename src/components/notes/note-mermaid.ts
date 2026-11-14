"use client";
import { createExtension } from "@blocknote/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";
import type { Node as PMNode } from "@tiptap/pm/model";
const key = new PluginKey<DecorationSet>("folioMermaid");
let queue = Promise.resolve();
function renderDiagram(source: string) {
  const figure = document.createElement("figure");
  figure.className = "folio-mermaid-render";
  figure.setAttribute("aria-label", "Mermaid diagram");
  const drawing = document.createElement("div");
  drawing.textContent = "Rendering diagram…";
  figure.append(drawing);
  const details = document.createElement("details"),
    summary = document.createElement("summary"),
    pre = document.createElement("pre");
  summary.textContent = "Diagram source";
  pre.textContent = source;
  details.append(summary, pre);
  figure.append(details);
  queue = queue
    .then(async () => {
      try {
        if (source.length > 20000 || /%%\s*\{|^\s*---/m.test(source))
          throw Error(
            "Diagram is too large or contains unsupported configuration.",
          );
        const [{ default: mermaid }, { default: purify }] = await Promise.all([
          import("mermaid"),
          import("dompurify"),
        ]);
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          htmlLabels: false,
          theme:
            document.documentElement.dataset.theme === "dark"
              ? "dark"
              : "default",
          maxTextSize: 20000,
          maxEdges: 500,
          suppressErrorRendering: true,
          flowchart: { htmlLabels: false },
          secure: [
            "secure",
            "securityLevel",
            "startOnLoad",
            "maxTextSize",
            "maxEdges",
            "htmlLabels",
            "theme",
          ],
        });
        const result = await mermaid.render(
          `folio-diagram-${crypto.randomUUID()}`,
          source,
        );
        drawing.innerHTML = purify.sanitize(result.svg, {
          USE_PROFILES: { svg: true, svgFilters: true },
          FORBID_TAGS: ["foreignObject", "script", "image", "use", "a"],
        });
        for (const style of drawing.querySelectorAll("style"))
          if (
            /@import|url\s*\(\s*['\" ]*(?:https?:|\/\/|data:)/i.test(
              style.textContent ?? "",
            )
          )
            style.remove();
        for (const el of drawing.querySelectorAll("*"))
          for (const a of [...el.attributes])
            if (/url\s*\(\s*['"]?(?:https?:|\/\/|data:)/i.test(a.value))
              el.removeAttribute(a.name);
        const rendered = document.createElement("img");
        rendered.alt = "Mermaid diagram";
        rendered.style.maxWidth = "100%";
        rendered.src =
          "data:image/svg+xml;charset=utf-8," +
          encodeURIComponent(drawing.innerHTML);
        drawing.replaceChildren(rendered);
      } catch {
        drawing.textContent =
          "Unable to render this diagram. The source is preserved below.";
        details.open = true;
      }
    })
    .catch(() => {});
  return figure;
}
export const NoteMermaid = createExtension(({ editor }) => {
  const build = (doc: PMNode) => {
    if (editor.isEditable) return DecorationSet.empty;
    const list: Decoration[] = [];
    doc.descendants((node, pos) => {
      if (
        node.type.name === "codeBlock" &&
        String(node.attrs.language).toLowerCase() === "mermaid"
      ) {
        list.push(
          Decoration.node(pos, pos + node.nodeSize, {
            class: "folio-mermaid-source",
          }),
        );
        list.push(
          Decoration.widget(
            pos + node.nodeSize,
            () => renderDiagram(node.textContent),
            { side: 1, key: `diagram:${pos}:${node.textContent}` },
          ),
        );
      }
    });
    return DecorationSet.create(doc, list);
  };
  return {
    key: "folioMermaid",
    mount() {
      const v = editor.prosemirrorView;
      v.dispatch(v.state.tr.setMeta(key, true).setMeta("addToHistory", false));
    },
    prosemirrorPlugins: [
      new Plugin<DecorationSet>({
        key,
        state: {
          init: (_, state) => build(state.doc),
          apply: (tr, old) =>
            tr.docChanged || tr.getMeta(key) ? build(tr.doc) : old,
        },
        view(view) {
          let editable = view.editable;
          return {
            update(v) {
              if (v.editable !== editable) {
                editable = v.editable;
                v.dispatch(
                  v.state.tr.setMeta(key, true).setMeta("addToHistory", false),
                );
              }
            },
          };
        },
        props: { decorations: (state) => key.getState(state) },
      }),
    ],
  };
});
