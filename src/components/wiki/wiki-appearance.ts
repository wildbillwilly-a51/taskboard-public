import type { CSSProperties } from "react";
import { bucketColorOptions } from "@/lib/bucket-colors";

// The same identity palette as Board and People. Identity is stable across
// navigation and reloads; no new persisted setting or board color is implied.
export function wikiSpaceStyle(id: string, archived = false): CSSProperties {
  let hash = 0;
  for (const char of id) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0;
  return { "--bucket-color": bucketColorOptions[archived ? 9 : hash % (bucketColorOptions.length - 1)].value } as CSSProperties;
}
