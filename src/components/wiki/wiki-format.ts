"use client";
import { useEffect, useState } from "react";
import { assertNoteContentFormat, type NoteSchemaInventory } from "@/lib/notes-content-format";
// Load the installed schema only at the browser boundary. The CJS test runner
// must not instantiate BlockNote, and SSR must not load its DOM dependencies.
let inventoryPromise: Promise<NoteSchemaInventory> | undefined;
export function useWikiFormatInventory() {
  const [inventory, setInventory] = useState<NoteSchemaInventory | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let active = true;
    inventoryPromise ??= import("@blocknote/core").then(core => ({ blockTypes: Object.keys(core.defaultBlockSpecs), inlineContentTypes: [...Object.keys(core.defaultInlineContentSpecs), "pageMention"], styleTypes: Object.keys(core.defaultStyleSpecs) }));
    void inventoryPromise.then(value => { if (active) setInventory(value); }).catch(() => { inventoryPromise = undefined; if (active) setError(new Error("Unable to load the document editor. Your content is preserved; retry loading the page.")); });
    return () => { active = false; };
  }, []);
  if (error) throw error;
  return inventory;
}
export function isWikiDocumentSupported(content: unknown[], format: number, inventory: NoteSchemaInventory | null): boolean {
  if (!inventory) return false;
  try { assertNoteContentFormat(content, format, inventory); return true; } catch { return false; }
}
