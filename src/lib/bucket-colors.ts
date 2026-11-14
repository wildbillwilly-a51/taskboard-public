// The bucket palette. Bucket headers, Board columns, outage windows and
// People teams all draw their identity colors from it.
export const bucketColorOptions = [
  { value: "#ea580c", label: "Ember" },
  { value: "#d97706", label: "Amber" },
  { value: "#0f766e", label: "Teal" },
  { value: "#0891b2", label: "Cyan" },
  { value: "#2563eb", label: "Blue" },
  { value: "#6366f1", label: "Indigo" },
  { value: "#8b5cf6", label: "Violet" },
  { value: "#e11d48", label: "Rose" },
  { value: "#65a30d", label: "Lime" },
  { value: "#475569", label: "Slate" },
] as const;

export type BucketColorLabel = (typeof bucketColorOptions)[number]["label"];

export function bucketColor(label: BucketColorLabel): string {
  return bucketColorOptions.find((option) => option.label === label)!.value;
}
