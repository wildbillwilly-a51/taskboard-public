import type {
  FolioDiscoveryInput,
  FolioDiscovery,
  FolioFeatures,
} from "./folio-features-model";
import type { WikiMentionResolution } from "./wiki-discovery-model";
export async function resolveFolioMentionsRequest(
  input: { noteIds: string[] },
  signal?: AbortSignal,
) {
  return (
    await featureRequest<{ mentions: WikiMentionResolution[] }>(
      "/api/folio/discovery",
      { action: "resolve", ...input },
      signal,
    )
  ).mentions;
}
export async function featureRequest<T>(
  url: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const r = await fetch(url, {
    cache: "no-store",
    signal,
    ...(body === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
  });
  const v = await r.json();
  if (!r.ok) throw new Error(v.error ?? "Unable to complete this request.");
  return v;
}
export function discoverNotes(
  input: FolioDiscoveryInput = {},
  signal?: AbortSignal,
) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(input))
    if (v !== undefined)
      p.set(k, typeof v === "boolean" ? (v ? "1" : "0") : String(v));
  return featureRequest<FolioDiscovery>(
    `/api/folio/discovery?${p}`,
    undefined,
    signal,
  );
}
export const saveFeatures = (
  noteId: string,
  features: Record<string, unknown>,
) =>
  featureRequest<{ features: FolioFeatures }>("/api/folio/discovery", {
    action: "features",
    noteId,
    features,
  });
