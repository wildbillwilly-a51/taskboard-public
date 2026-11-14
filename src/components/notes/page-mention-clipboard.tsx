"use client";

import type { ClipboardEvent } from "react";
import { normalizePageMentionClipboard } from "@/lib/notes-editor-schema";

// BlockNote skips its copy handler inside contenteditable=false (all readers,
// and selections ending inside an atom). Capture before its handler or native
// browser copying can serialize the viewer's resolved title and open controls.
export function copyPageMentions(event: ClipboardEvent<HTMLElement>, allowLinks: boolean): boolean {
  const editor = event.currentTarget.querySelector(".bn-editor");
  const selection = window.getSelection();
  if (!editor || !selection?.rangeCount || selection.isCollapsed) return false;
  const focus = selection.focusNode instanceof Element ? selection.focusNode : selection.focusNode?.parentElement;
  // Preserve BlockNote's normal slice/Markdown export when its handler runs.
  if (!focus?.closest('[contenteditable="false"]')) return false;
  const range = selection.getRangeAt(0).cloneRange();
  const selector = '[data-inline-content-type="pageMention"]';
  if (![...editor.querySelectorAll(selector)].some(atom => range.intersectsNode(atom))) return false;
  // Partial label selections are still atomic exports; never copy a title
  // substring whose cloned fragment has lost the mention's enclosing marker.
  const enclosingAtom = (node: Node) => (node instanceof Element ? node : node.parentElement)?.closest(selector);
  const start = enclosingAtom(range.startContainer), end = enclosingAtom(range.endContainer);
  if (start && editor.contains(start)) range.setStartBefore(start);
  if (end && editor.contains(end)) range.setEndAfter(end);
  const fragment = document.createElement("div"); fragment.append(range.cloneContents());
  if (!allowLinks) for (const atom of fragment.querySelectorAll(selector)) atom.replaceWith(document.createTextNode("Wiki page"));
  const internal = normalizePageMentionClipboard(fragment.innerHTML, true);
  const external = document.createElement("div"); external.innerHTML = normalizePageMentionClipboard(fragment.innerHTML, false);
  // The native clipboard sanitizer has no document base URL. Give generic
  // wiki links an absolute URL so it cannot rewrite relative hrefs to empty.
  for (const link of external.querySelectorAll<HTMLAnchorElement>('a[href^="/wiki/_/"]')) link.href = new URL(link.getAttribute("href")!, window.location.origin).href;
  const text = external.cloneNode(true) as HTMLDivElement;
  for (const block of text.querySelectorAll(".bn-inline-content, p, pre, li, tr")) block.append(document.createTextNode("\n"));
  event.clipboardData.clearData();
  event.clipboardData.setData("text/html", external.innerHTML);
  event.clipboardData.setData("text/plain", text.textContent?.trimEnd() ?? "");
  if (allowLinks) event.clipboardData.setData("blocknote/html", internal);
  event.preventDefault(); event.stopPropagation();
  return true;
}
