// Ids live in Postgres UUID columns, which accept any 8-4-4-4-12 hex value.
// No RFC 4122 version or variant is required: ids created by the seed
// (stableUuid in taskboard-store) are deterministic SHA-1 hex and carry
// neither, and every route must still accept them.
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}
