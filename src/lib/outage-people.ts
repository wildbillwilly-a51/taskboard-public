import { isUuid } from "./uuid";
import type { PersonDetails } from "./outage-people-details";

export type PeopleField = "team" | "location" | "activity";
export type PeopleReport = {
  value: string;
  revision: string | null;
  reportedAt: string | null;
  reporter: string;
  verified: boolean;
  linkedTaskId: string | null;
  unavailable?: boolean;
};
export type PeopleHistory = PeopleReport & { id: string; field: PeopleField };
export type OutagePerson = {
  key: string;
  name: string;
  team: PeopleReport;
  location: PeopleReport;
  activity: PeopleReport;
  history: PeopleHistory[];
  details?: PersonDetails;
};
export type PeopleGroup = { label: string; keys: string[]; team?: string };
export type AttendeeChange = { name: string; attending: boolean };
export function applyAttendeeChanges(attendees: unknown, changes: unknown): string[] {
  if (!Array.isArray(changes) || changes.length > 200) throw new OutagePeopleError("Choose up to 200 attendee changes at a time.");
  const names = new Set(peopleRoster(attendees).map(person => person.name));
  for (const raw of changes) {
    const item = object(raw, ["name", "attending"]);
    if (typeof item.name !== "string" || !item.name.trim() || item.name.trim().length > 200 || /[,\u0000-\u001f]/.test(item.name) || typeof item.attending !== "boolean") throw new OutagePeopleError("Use attendee names of 1 to 200 characters without commas.");
    const name = item.name.trim();
    if (item.attending && !names.has(name) && [...names].some(existing => existing.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new OutagePeopleError("An attendee with a similar name is already present. Use their existing entry.",409);
    if (item.attending) names.add(name); else names.delete(name);
  }
  if (names.size > 50) throw new OutagePeopleError("An outage can have up to 50 attendees.");
  return [...names];
}

// Keep existing rows in place while editing, but apply roster membership now.
// A new attendee must not stay hidden behind a frozen grouping.
export function reconcilePeopleGroups(frozen: PeopleGroup[], current: PeopleGroup[]): PeopleGroup[] {
  const roster = new Set(current.flatMap(group => group.keys)), placed = new Set<string>();
  const result = frozen.map(group => ({ ...group, keys: group.keys.filter(key => {
    if (!roster.has(key) || placed.has(key)) return false;
    placed.add(key); return true;
  }) }));
  const byLabel = new Map(result.map(group => [group.label, group]));
  for (const group of current) {
    const added = group.keys.filter(key => !placed.has(key));
    const existing = byLabel.get(group.label);
    if (existing) existing.keys.push(...added);
    else if (added.length || !group.keys.length) { const next = { ...group, keys: added }; result.push(next); byLabel.set(group.label, next); }
    for (const key of added) placed.add(key);
  }
  return result.filter(group => group.keys.length || current.some(next => next.label === group.label && !next.keys.length));
}
export type OutagePeopleState = {
  people: OutagePerson[];
  locations: string[];
  canEdit: boolean;
  viewerName: string;
  shared: boolean;
  teams?: string[];
  applied?: { personKey: string; field: PeopleField | "details"; revision: string }[];
};
export type PeopleChange = {
  mutationId: string;
  field: PeopleField;
  value: string;
  updates: { personKey: string; expectedRevision: string | null }[];
  linkedTaskId: string | null;
  reporterName?: string;
  requireTeam?: boolean;
};
export type PeopleTeamChange = {
  operation: "create-team" | "remove-team";
  mutationId: string;
  name: string;
  sourceTeamId: string | null;
  updates: PeopleChange["updates"];
  addUserIds: string[];
  reporterName?: string;
};
export function parsePeopleTeamChange(input: unknown, shared = false): PeopleTeamChange {
  const body = object(input, ["operation", "mutationId", "name", "sourceTeamId", "updates", "addUserIds", ...(shared ? ["reporterName"] : [])]);
  if (body.operation !== "create-team" && body.operation !== "remove-team") throw new OutagePeopleError("Choose a team action.");
  if (typeof body.name !== "string" || !body.name.trim() || body.name.trim().length > 80 || /[\u0000-\u001f]/.test(body.name)) throw new OutagePeopleError("Use a team name between 1 and 80 characters.");
  if (body.operation === "create-team" && body.name.trim().toLocaleLowerCase() === "unassigned") throw new OutagePeopleError("Choose a team name other than Unassigned.");
  const sourceTeamId = body.sourceTeamId ?? null;
  if (sourceTeamId !== null && (shared || typeof sourceTeamId !== "string" || !isUuid(sourceTeamId))) throw new OutagePeopleError("Sign in to use an existing Taskboard team.", 403);
  if (!Array.isArray(body.updates) || body.updates.length > 50 || !Array.isArray(body.addUserIds) || body.addUserIds.length > 50 || body.addUserIds.some(id => typeof id !== "string" || !isUuid(id)) || new Set(body.addUserIds).size !== body.addUserIds.length) throw new OutagePeopleError("Choose up to 50 people, once each.");
  if (body.addUserIds.length && (!sourceTeamId || shared)) throw new OutagePeopleError("Sign in to add members from a Taskboard team.", 403);
  if (body.operation === "remove-team" && (body.updates.length || body.addUserIds.length || sourceTeamId)) throw new OutagePeopleError("Only an empty outage team can be removed.");
  // Reuse the field parser's exact-name, CAS, identity and mutation-id checks.
  const parsed = parsePeopleChange({ mutationId: body.mutationId, field: "team", value: body.name, linkedTaskId: null,
    updates: body.updates.length ? body.updates : [{ personKey: "validation", expectedRevision: null }], ...(shared ? { reporterName: body.reporterName } : {}) }, shared);
  return { operation: body.operation, mutationId: parsed.mutationId, name: parsed.value, sourceTeamId: sourceTeamId as string | null, updates: body.updates.length ? parsed.updates : [], addUserIds: (body.addUserIds as string[]).slice().sort(), ...(shared ? { reporterName: parsed.reporterName } : {}) };
}
export class OutagePeopleError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
export const emptyPeopleReport = (): PeopleReport => ({ value: "", revision: null, reportedAt: null, reporter: "", verified: false, linkedTaskId: null });

// Attendees are exact, trimmed names in the existing outage model. Do not merge
// distinct roster entries by case, spacing, or Unicode normalization.
export function peopleRoster(attendees: unknown): { key: string; name: string }[] {
  if (!Array.isArray(attendees)) return [];
  return [...new Set(attendees.filter((name): name is string => typeof name === "string").map(name => name.trim()).filter(Boolean))].map(name => ({ key: name, name }));
}
export function placeKey(value: string) {
  return value.normalize("NFKC").trim().toLocaleLowerCase("en-US").replace(/[\s-]+/g, "");
}
export function canonicalPlace(value: string, known: string[]) {
  const trimmed = value.trim();
  return trimmed ? known.find(name => placeKey(name) === placeKey(trimmed)) ?? trimmed : "";
}
function object(value: unknown, allowed: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw new OutagePeopleError("Invalid people update.");
  return value as Record<string, unknown>;
}
export function parsePeopleChange(input: unknown, shared = false): PeopleChange {
  const body = object(input, ["mutationId", "field", "value", "updates", "linkedTaskId", "requireTeam", ...(shared ? ["reporterName"] : [])]);
  if (typeof body.mutationId !== "string" || !isUuid(body.mutationId)) throw new OutagePeopleError("Invalid save identifier.");
  if (!["team", "location", "activity"].includes(String(body.field))) throw new OutagePeopleError("Choose a people field to update.");
  const field = body.field as PeopleField, limit = field === "team" ? 80 : field === "location" ? 240 : 1000;
  if (body.requireTeam !== undefined && (typeof body.requireTeam !== "boolean" || field !== "team")) throw new OutagePeopleError("Choose a team on this outage.");
  if (typeof body.value !== "string" || body.value.trim().length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(body.value)) throw new OutagePeopleError(`Use no more than ${limit} characters.`);
  if (!Array.isArray(body.updates) || !body.updates.length || body.updates.length > 50) throw new OutagePeopleError("Choose between 1 and 50 attendees.");
  const seen = new Set<string>();
  const updates = body.updates.map(raw => {
    const entry = object(raw, ["personKey", "expectedRevision"]);
    if (typeof entry.personKey !== "string" || !entry.personKey.trim() || entry.personKey.length > 1000 || seen.has(entry.personKey)) throw new OutagePeopleError("Choose each attendee only once.");
    if (entry.expectedRevision !== null && (typeof entry.expectedRevision !== "string" || !isUuid(entry.expectedRevision))) throw new OutagePeopleError("Reload the people board before saving.", 409);
    seen.add(entry.personKey);
    return { personKey: entry.personKey, expectedRevision: entry.expectedRevision as string | null };
  }).sort((a, b) => a.personKey.localeCompare(b.personKey));
  const linkedTaskId = body.linkedTaskId ?? null;
  if (linkedTaskId !== null && (field !== "activity" || typeof linkedTaskId !== "string" || !isUuid(linkedTaskId) || !body.value.trim())) throw new OutagePeopleError("Choose work inside this outage.");
  if (shared && (typeof body.reporterName !== "string" || !body.reporterName.trim() || body.reporterName.length > 1000)) throw new OutagePeopleError("Choose who is reporting this update.");
  return { mutationId: body.mutationId, field, value: body.value.trim(), updates, linkedTaskId: linkedTaskId as string | null, ...(body.requireTeam ? { requireTeam: true } : {}), ...(shared ? { reporterName: (body.reporterName as string).trim() } : {}) };
}
