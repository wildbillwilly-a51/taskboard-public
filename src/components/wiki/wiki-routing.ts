import { isUuid } from "@/lib/notes-model";

export type WikiSearch = Record<string, string | string[] | undefined>;
export function first(value: string | string[] | undefined) { return Array.isArray(value) ? value[0] : value; }
export function wikiViewQuery(search: WikiSearch) {
  const params = new URLSearchParams();
  if (first(search.view) === "history") {
    params.set("view", "history");
    const version = first(search.version);
    if (isUuid(version)) params.set("version", version);
  }
  return params.size ? `?${params}` : "";
}
