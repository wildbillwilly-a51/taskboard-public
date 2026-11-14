import { OutagePeopleError, parsePeopleChange, type PeopleChange } from "./outage-people";
import { bucketColor } from "./bucket-colors";

export type TravelInfo = { phase: "none" | "inbound" | "arrived" | "left"; arrival: string; departureDate: string; departureTime: string; leftDate: string; travelNotes: string };
export type PersonDetails = { travel: TravelInfo; discussedDay: string; revision: string | null; reportedAt: string | null; reporter: string; verified: boolean };
export type PeopleDetailsChange = { operation: "person-details"; mutationId: string; updates: PeopleChange["updates"]; travel: TravelInfo; discussedDay: string; location?: { value: string; expectedRevision: string | null }; reporterName?: string };
export const emptyTravel = (): TravelInfo => ({ phase: "none", arrival: "", departureDate: "", departureTime: "", leftDate: "", travelNotes: "" });
export const emptyPersonDetails = (): PersonDetails => ({ travel: emptyTravel(), discussedDay: "", revision: null, reportedAt: null, reporter: "", verified: false });
// Team colors come from the bucket palette (this order keeps saved teams' colors).
const teamPalette = (["Blue", "Teal", "Violet", "Cyan", "Indigo", "Lime", "Amber"] as const).map(bucketColor);
export const unassignedTeamColor = bucketColor("Slate");
// Use the full saved team order, including empty groups, before filtering the
// roster. New groups append, so filtering/reloading/adding one keeps old colors.
export function peopleTeamColors(names: string[]) { const colors: Record<string, string> = {}, used = new Set<string>(); for (const name of [...new Set(names)].filter(Boolean)) { let hash = 0; for (const char of name.normalize("NFKC").toLocaleLowerCase()) hash = (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0; const start = hash % teamPalette.length; const choices = teamPalette.map((_, index) => teamPalette[(start + index) % teamPalette.length]); colors[name] = choices.find(color => !used.has(color)) ?? teamPalette[start]; used.add(colors[name]); } return colors; }
export function calendarDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(value + "T12:00:00Z");
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value && value >= "1900-01-01" && value <= "2199-12-31";
}
export function parsePeopleDetailsChange(raw: unknown, shared = false): PeopleDetailsChange {
  if (!raw || typeof raw !== "object") throw new OutagePeopleError("Invalid attendee details.");
  const body = raw as Record<string, unknown>;
  if (Object.keys(body).some(key => !["operation", "mutationId", "updates", "travel", "discussedDay", "location", ...(shared ? ["reporterName"] : [])].includes(key)) || body.operation !== "person-details") throw new OutagePeopleError("Invalid attendee details.");
  const identity = parsePeopleChange({ mutationId: body.mutationId, updates: body.updates, field: "location", value: "", ...(shared ? { reporterName: body.reporterName } : {}) }, shared);
  if (identity.updates.length !== 1) throw new OutagePeopleError("Update one attendee's details at a time.");
  if (!body.travel || typeof body.travel !== "object" || Array.isArray(body.travel)) throw new OutagePeopleError("Invalid travel details.");
  const input = body.travel as Record<string, unknown>, keys = Object.keys(emptyTravel());
  if (Object.keys(input).some(key => !keys.includes(key)) || keys.some(key => typeof input[key] !== "string")) throw new OutagePeopleError("Invalid travel details.");
  if (!["none", "inbound", "arrived", "left"].includes(String(input.phase))) throw new OutagePeopleError("Choose a travel status.");
  const travel: TravelInfo = { phase: input.phase as TravelInfo["phase"], arrival: String(input.arrival), departureDate: String(input.departureDate), departureTime: String(input.departureTime), leftDate: String(input.leftDate), travelNotes: String(input.travelNotes).trim() };
  if (travel.arrival && (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(travel.arrival) || !calendarDate(travel.arrival.slice(0, 10)) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(travel.arrival.slice(11)))) throw new OutagePeopleError("Enter a valid arrival date and time.");
  if ([travel.departureDate, travel.leftDate].some(value => value && !calendarDate(value)) || travel.departureTime && !/^([01]\d|2[0-3]):[0-5]\d$/.test(travel.departureTime)) throw new OutagePeopleError("Enter valid departure details.");
  if (travel.travelNotes.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(travel.travelNotes)) throw new OutagePeopleError("Use up to 1,000 characters for travel notes.");
  if (typeof body.discussedDay !== "string" || body.discussedDay && !calendarDate(body.discussedDay)) throw new OutagePeopleError("Choose a valid discussion date.");
  let location: PeopleDetailsChange["location"];
  if (body.location !== undefined) {
    if (!body.location || typeof body.location !== "object" || Array.isArray(body.location) || Object.keys(body.location).some(key => !["value", "expectedRevision"].includes(key))) throw new OutagePeopleError("Invalid location report.");
    const loc = body.location as Record<string, unknown>;
    const parsed = parsePeopleChange({ mutationId: identity.mutationId, updates: [{ personKey: identity.updates[0].personKey, expectedRevision: loc.expectedRevision }], field: "location", value: loc.value, ...(shared ? { reporterName: identity.reporterName } : {}) }, shared);
    location = { value: parsed.value, expectedRevision: parsed.updates[0].expectedRevision };
  }
  return { operation: "person-details", mutationId: identity.mutationId, updates: identity.updates, travel, discussedDay: body.discussedDay, ...(location ? { location } : {}), ...(shared ? { reporterName: identity.reporterName } : {}) };
}
export function hasTravel(travel: TravelInfo) { return travel.phase === "inbound" || [travel.arrival, travel.departureDate, travel.departureTime, travel.leftDate, travel.travelNotes].some(value => !!value.trim()); }
export function travelDate(value: string) { return calendarDate(value) ? new Intl.DateTimeFormat(undefined, { timeZone: "UTC", weekday: "short", month: "numeric", day: "numeric", year: "2-digit" }).format(new Date(value + "T12:00:00Z")) : ""; }
export function travelTime(value: string) { if (!value) return ""; const [h, m] = value.split(":").map(Number); return `${h % 12 || 12}:${String(m).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; }
export function travelCaption(travel: TravelInfo) {
  if (travel.phase === "inbound") return travel.arrival ? `Arrives ${travelDate(travel.arrival.slice(0, 10))} · ${travelTime(travel.arrival.slice(11))}` : "Arrival not set";
  if (travel.phase === "arrived") return travel.departureDate ? `Leaves ${travelDate(travel.departureDate)}${travel.departureTime ? ` · ${travelTime(travel.departureTime)}` : ""}` : "Departure not set";
  if (travel.phase === "left") return travel.leftDate ? `Left ${travelDate(travel.leftDate)}` : "Left site";
  return "";
}
export function locationDuration(reportedAt: string | null, now: number) { if (!reportedAt) return "—"; const minutes = Math.max(0, Math.floor((now - Date.parse(reportedAt)) / 60000)); if (!Number.isFinite(minutes)) return "—"; const hours = Math.floor(minutes / 60), rest = minutes % 60; return hours ? `${hours}h${rest ? `${rest}m` : ""}` : `${minutes}m`; }
export function discussionDay(timeZone: string) { return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()); }
