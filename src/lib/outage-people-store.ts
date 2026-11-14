import "server-only";
import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { getPool } from "./db";
import { ensureDatabaseReady, getBoardRowById } from "./taskboard-store";
import { assertBoardAccess, resolveEffectiveBoardAccess } from "./board-access";
import type { TaskboardUserIdentity } from "./taskboard-request";
import { admitPublicTaskEdit, TaskShareUnavailable, withPublicTaskEdit, withPublicTaskRead } from "./public-task-share-store";
import { reservePublicTaskWriter } from "./public-task-write-limit";
import { sharedWorkScopeSql } from "./public-task-work-revision";
import { isUuid } from "./uuid";
import { canonicalPlace, placeKey, emptyPeopleReport, OutagePeopleError, parsePeopleChange, parsePeopleTeamChange, peopleRoster, type OutagePeopleState, type PeopleChange, type PeopleTeamChange, type PeopleField, type PeopleReport } from "./outage-people";
import { emptyPersonDetails, emptyTravel, parsePeopleDetailsChange, type PeopleDetailsChange, type TravelInfo } from "./outage-people-details";
type Command = PeopleChange | PeopleTeamChange | PeopleDetailsChange;

type Root = { id: string; board_id: string; attendees: unknown };
type Actor = { key: string; name: string; verified: boolean; admin?: boolean };
type ReportRow = {
  id?: string; person_key: string; field: PeopleField; value: string;
  linked_task_id: string | null; is_linked: boolean; revision: string;
  reported_at: string | Date; reporter_name: string; reporter_verified: boolean;
};
async function outage(client: PoolClient, id: string, write: boolean): Promise<Root> {
  if (!isUuid(id)) throw new OutagePeopleError("Invalid outage.");
  const row = (await client.query<Root>(`SELECT t.id,t.board_id,o.attendees FROM tasks t
    JOIN maintenance_outages o ON o.task_id=t.id AND o.board_id=t.board_id
    WHERE t.id=$1 AND t.work_item_type='maintenance_outage' AND t.deleted_at IS NULL AND t.archived_at IS NULL
      AND NOT t.is_read_only_import AND COALESCE(t.source_type,'native')='native'
    ${write ? "FOR UPDATE OF t,o" : ""}`, [id])).rows[0];
  if (!row) throw new OutagePeopleError("This outage is unavailable.", 404);
  return row;
}
async function scope(client: PoolClient, root: Root, lock = false) {
  if (lock) await client.query(`${sharedWorkScopeSql} SELECT t.id FROM tasks t JOIN scope s ON s.id=t.id ORDER BY t.id FOR SHARE OF t`, [root.id, root.board_id]);
  // Read again after any lock wait, so a concurrently moved ancestor cannot
  // make a previously computed descendant set authoritative.
  const rows = (await client.query<{ id: string; title: string }>(`${sharedWorkScopeSql} SELECT t.id,t.title FROM tasks t JOIN scope s ON s.id=t.id LIMIT 5001`, [root.id, root.board_id])).rows;
  if (rows.length > 5000) throw new OutagePeopleError("This outage has too many work items to display.");
  return new Map(rows.map(row => [row.id, row.title]));
}
function projectReport(row: ReportRow, allowed: Map<string, string>): PeopleReport {
  const unavailable = row.is_linked && (!row.linked_task_id || !allowed.has(row.linked_task_id));
  return { value: unavailable ? "" : row.value, revision: row.revision ?? row.id ?? null,
    reportedAt: new Date(row.reported_at).toISOString(), reporter: row.reporter_name,
    verified: row.reporter_verified, linkedTaskId: unavailable ? null : row.linked_task_id,
    ...(unavailable ? { unavailable: true } : {}) };
}
async function snapshot(client: PoolClient, root: Root, canEdit: boolean, viewerName: string, shared: boolean): Promise<OutagePeopleState> {
  const roster = peopleRoster(root.attendees), names = roster.map(p => p.key);
  const allowed = await scope(client, root);
  const [fields, history] = await Promise.all([
    client.query<ReportRow>("SELECT * FROM outage_people_fields WHERE task_id=$1 AND person_key=ANY($2::text[])", [root.id, names]),
    client.query<ReportRow>(`SELECT h.* FROM unnest($2::text[]) roster(person_key) CROSS JOIN LATERAL (
      SELECT h.*,h.id AS revision FROM outage_people_history h WHERE h.task_id=$1 AND h.person_key=roster.person_key
      ORDER BY reported_at DESC,id DESC LIMIT 5) h`, [root.id, names]),
  ]);
  const people = roster.map(person => ({ ...person, team: emptyPeopleReport(), location: emptyPeopleReport(), activity: emptyPeopleReport(), details: emptyPersonDetails(), history: [] as OutagePeopleState["people"][number]["history"] }));
  const byKey = new Map(people.map(person => [person.key, person]));
  for (const row of fields.rows) {
    const person = byKey.get(row.person_key);
    if (person) person[row.field] = projectReport(row, allowed);
  }
  for (const row of history.rows) byKey.get(row.person_key)?.history.push({ ...projectReport(row, allowed), id: row.id!, field: row.field });
  const details = await client.query<{ person_key: string; travel: TravelInfo; discussed_day: string; revision: string; reported_at: Date; reporter_name: string; reporter_verified: boolean }>("SELECT * FROM outage_people_details WHERE task_id=$1 AND person_key=ANY($2::text[])", [root.id, names]);
  for (const row of details.rows) { const person = byKey.get(row.person_key); if (person) person.details = { travel: { ...emptyTravel(), ...row.travel }, discussedDay: row.discussed_day, revision: row.revision, reportedAt: new Date(row.reported_at).toISOString(), reporter: row.reporter_name, verified: row.reporter_verified }; }
  const savedTeams = (await client.query<{ name: string }>("SELECT name FROM outage_people_teams WHERE task_id=$1 ORDER BY created_at,name", [root.id])).rows.map(row => row.name);
  return { people, teams: [...new Set([...savedTeams, ...people.map(p => p.team.value).filter(Boolean)])], locations: [...new Set(people.map(p => p.location.value).filter(Boolean))], canEdit, viewerName, shared };
}
async function receipt(client: PoolClient, root: Root, input: Command, actor: Actor) {
  const hash = createHash("sha256").update(JSON.stringify({ actor: actor.key, ...input })).digest("hex");
  const saved = (await client.query<{ actor_key: string; request_hash: string; applied_revisions: NonNullable<OutagePeopleState["applied"]> }>("SELECT actor_key,request_hash,applied_revisions FROM outage_people_mutations WHERE task_id=$1 AND mutation_id=$2", [root.id, input.mutationId])).rows[0];
  if (saved && (saved.actor_key !== actor.key || saved.request_hash !== hash)) throw new OutagePeopleError("This save identifier was already used for another update.", 409);
  return { hash, applied: saved?.applied_revisions };
}
async function rememberTeams(client: PoolClient, root: Root) {
  await client.query(`INSERT INTO outage_people_teams(task_id,name)
    SELECT DISTINCT task_id,value FROM outage_people_fields WHERE task_id=$1 AND field='team' AND value<>'' AND person_key=ANY($2::text[])
    ON CONFLICT DO NOTHING`, [root.id, peopleRoster(root.attendees).map(p => p.key)]);
}
async function change(client: PoolClient, root: Root, input: PeopleChange, actor: Actor, command: Command = input, recordReceipt = true) {
  const saved = await receipt(client, root, command, actor);
  if (saved.applied) {
    return saved.applied;
  }
  const roster = new Set(peopleRoster(root.attendees).map(p => p.key));
  if (input.updates.some(update => !roster.has(update.personKey))) throw new OutagePeopleError("An attendee changed. Reload the people board.", 409);
  if (!actor.verified && !roster.has(actor.name)) throw new OutagePeopleError("Choose a name from this outage's attendees.");
  const names = input.updates.map(update => update.personKey);
  const current = (await client.query<{ person_key: string; revision: string }>("SELECT person_key,revision FROM outage_people_fields WHERE task_id=$1 AND field=$2 AND person_key=ANY($3::text[])", [root.id, input.field, names])).rows;
  const revisions = new Map(current.map(row => [row.person_key, row.revision]));
  if (input.updates.some(update => (revisions.get(update.personKey) ?? null) !== update.expectedRevision)) throw new OutagePeopleError("This field changed elsewhere. Your text has been kept; load the latest report before saving again.", 409);
  let value = input.value;
  if (input.linkedTaskId) {
    const allowed = await scope(client, root, true);
    const title = allowed.get(input.linkedTaskId);
    if (!title || input.linkedTaskId === root.id) throw new OutagePeopleError("Choose work inside this outage.");
    value = title;
    if (value.length > 1000) throw new OutagePeopleError("This work title is too long to use as an activity.");
  }
  if (input.field === "location") {
    const places = (await client.query<{ value: string }>("SELECT value FROM outage_people_fields WHERE task_id=$1 AND field='location' AND person_key=ANY($2::text[])", [root.id, [...roster]])).rows.map(row => row.value);
    value = canonicalPlace(value, places);
  }
  const applied: NonNullable<OutagePeopleState["applied"]> = [];
  if (input.field === "team") {
    await rememberTeams(client, root);
    if (value) {
      const named = (await client.query<{ name: string }>("SELECT name FROM outage_people_teams WHERE task_id=$1 AND lower(btrim(name))=lower($2) ORDER BY (name=$2) DESC,name LIMIT 1", [root.id,value])).rows[0];
      if (input.requireTeam && !named) throw new OutagePeopleError("This team was removed. Review the latest assignments.",409);
      value = named?.name ?? value;
    }
    if (value) await client.query("INSERT INTO outage_people_teams(task_id,name) VALUES($1,$2) ON CONFLICT DO NOTHING", [root.id, value]);
  }
  for (const update of input.updates) {
    const revision = randomUUID();
    applied.push({ personKey: update.personKey, field: input.field, revision });
    const values = [root.id, update.personKey, input.field, value, input.linkedTaskId, Boolean(input.linkedTaskId), revision, actor.name, actor.verified];
    await client.query(`INSERT INTO outage_people_fields(task_id,person_key,field,value,linked_task_id,is_linked,revision,reporter_name,reporter_verified)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(task_id,person_key,field) DO UPDATE SET
      value=EXCLUDED.value,linked_task_id=EXCLUDED.linked_task_id,is_linked=EXCLUDED.is_linked,revision=EXCLUDED.revision,
      reported_at=clock_timestamp(),reporter_name=EXCLUDED.reporter_name,reporter_verified=EXCLUDED.reporter_verified`, values);
    await client.query(`INSERT INTO outage_people_history(id,task_id,person_key,field,value,linked_task_id,is_linked,reported_at,reporter_name,reporter_verified)
      SELECT revision,task_id,person_key,field,value,linked_task_id,is_linked,reported_at,reporter_name,reporter_verified FROM outage_people_fields
      WHERE task_id=$1 AND person_key=$2 AND field=$3`, [root.id, update.personKey, input.field]);
  }
  if (recordReceipt) await client.query("INSERT INTO outage_people_mutations(task_id,mutation_id,actor_key,request_hash,applied_revisions) VALUES($1,$2,$3,$4,$5::jsonb)", [root.id, input.mutationId, actor.key, saved.hash, JSON.stringify(applied)]);
  return applied;
}

async function detailsChange(client: PoolClient, root: Root, input: PeopleDetailsChange, actor: Actor) {
  const saved = await receipt(client, root, input, actor);
  if (saved.applied) return saved.applied;
  const roster = new Set(peopleRoster(root.attendees).map(person => person.key)), update = input.updates[0];
  if (!roster.has(update.personKey)) throw new OutagePeopleError("An attendee changed. Reload the people board.", 409);
  if (!actor.verified && !roster.has(actor.name)) throw new OutagePeopleError("Choose a name from this outage's attendees.");
  const current = (await client.query<{ revision: string }>("SELECT revision FROM outage_people_details WHERE task_id=$1 AND person_key=$2", [root.id, update.personKey])).rows[0];
  if ((current?.revision ?? null) !== update.expectedRevision) throw new OutagePeopleError("Attendee details changed elsewhere. Your text has been kept; review the latest details.", 409);
  // Both writes share the locked outage transaction and a single replay receipt.
  const location = input.location ? (await client.query<{ value: string; revision: string }>("SELECT value,revision FROM outage_people_fields WHERE task_id=$1 AND person_key=$2 AND field='location'", [root.id, update.personKey])).rows[0] : undefined;
  if (input.location && (location?.revision ?? null) !== input.location.expectedRevision) throw new OutagePeopleError("Location changed elsewhere. Your travel text has been kept; review the latest location.", 409);
  const applied = input.location && placeKey(input.location.value) !== placeKey(location?.value ?? "") ? await change(client, root, { mutationId: input.mutationId, field: "location", value: input.location.value, linkedTaskId: null, updates: [{ personKey: update.personKey, expectedRevision: input.location.expectedRevision }] }, actor, input, false) : [];
  const revision = randomUUID();
  await client.query(`INSERT INTO outage_people_details(task_id,person_key,travel,discussed_day,revision,reporter_name,reporter_verified)
    VALUES($1,$2,$3::jsonb,$4,$5,$6,$7) ON CONFLICT(task_id,person_key) DO UPDATE SET travel=EXCLUDED.travel,discussed_day=EXCLUDED.discussed_day,revision=EXCLUDED.revision,reported_at=clock_timestamp(),reporter_name=EXCLUDED.reporter_name,reporter_verified=EXCLUDED.reporter_verified`, [root.id, update.personKey, JSON.stringify(input.travel), input.discussedDay, revision, actor.name, actor.verified]);
  applied.push({ personKey: update.personKey, field: "details", revision });
  await client.query("INSERT INTO outage_people_mutations(task_id,mutation_id,actor_key,request_hash,applied_revisions) VALUES($1,$2,$3,$4,$5::jsonb)", [root.id, input.mutationId, actor.key, saved.hash, JSON.stringify(applied)]);
  return applied;
}

async function teamChange(client: PoolClient, root: Root, input: PeopleTeamChange, actor: Actor) {
  const saved = await receipt(client, root, input, actor);
  if (saved.applied) return saved.applied;
  const originalRoster = peopleRoster(root.attendees);
  if (!actor.verified && !originalRoster.some(p => p.name === actor.name)) throw new OutagePeopleError("Choose a name from this outage's attendees.");
  await rememberTeams(client, root);
  const existing = (await client.query<{ name: string }>(input.operation === "remove-team" ? "SELECT name FROM outage_people_teams WHERE task_id=$1 AND name=$2" : "SELECT name FROM outage_people_teams WHERE task_id=$1 AND lower(btrim(name))=lower($2)", [root.id, input.name])).rows;
  if (existing.length > 1) throw new OutagePeopleError("Several existing groups have this name. Choose a different team name.", 409);
  const name = existing[0]?.name ?? input.name;
  if (input.operation === "remove-team") {
    if (!existing.length) throw new OutagePeopleError("This team changed. Reload the people board.", 409);
    const members = await client.query("SELECT 1 FROM outage_people_fields WHERE task_id=$1 AND field='team' AND value=$2 AND person_key=ANY($3::text[]) LIMIT 1", [root.id, name, originalRoster.map(p => p.key)]);
    if (members.rowCount) throw new OutagePeopleError("Move this team's people before removing it.", 409);
    await client.query("DELETE FROM outage_people_teams WHERE task_id=$1 AND name=$2", [root.id, name]);
  } else {
    if (existing.length && !input.sourceTeamId) throw new OutagePeopleError("This team is already on the board. Use Add people beside it.", 409);
    const updates = input.updates.slice();
    const importedNames: string[] = [];
    if (input.sourceTeamId) {
      const allowed = await client.query(`SELECT id FROM teams WHERE id=$1 AND archived_at IS NULL
        AND ($3::boolean OR EXISTS(SELECT 1 FROM team_members WHERE team_id=$1 AND user_id=$2)) FOR SHARE`, [input.sourceTeamId, actor.key, !!actor.admin]);
      if (!actor.verified || !allowed.rowCount) throw new OutagePeopleError("This Taskboard team is unavailable.", 403);
      const members = (await client.query<{ id: string; display_name: string }>(`SELECT u.id,u.display_name FROM users u JOIN team_members m ON m.user_id=u.id
        WHERE m.team_id=$1 AND u.id=ANY($2::uuid[]) AND NOT u.is_disabled FOR SHARE OF u,m`, [input.sourceTeamId, input.addUserIds])).rows;
      if (members.length !== input.addUserIds.length) throw new OutagePeopleError("Team membership changed. Review the attending members.", 409);
      for (const member of members) {
        const memberName = member.display_name.trim();
        if (!memberName || memberName.length > 200 || /[,\u0000-\u001f]/.test(memberName) || importedNames.some(name => name.toLocaleLowerCase() === memberName.toLocaleLowerCase())) throw new OutagePeopleError("Selected members must have distinct names of 1 to 200 characters without commas.");
        importedNames.push(memberName);
        if (!originalRoster.some(p => p.key === memberName) && originalRoster.some(p => p.key.toLocaleLowerCase() === memberName.toLocaleLowerCase())) throw new OutagePeopleError("An attendee with a similar name is already present. Assign their existing entry instead.",409);
        if (!updates.some(update => update.personKey === memberName)) {
          // A returning attendee may have retained reports that were invisible
          // while absent. Only newly appended names use their stored revision.
          if (originalRoster.some(p => p.key === memberName)) throw new OutagePeopleError(`${memberName} is already attending. Review the people board.`, 409);
          const old = (await client.query<{ revision: string }>("SELECT revision FROM outage_people_fields WHERE task_id=$1 AND person_key=$2 AND field='team'", [root.id, memberName])).rows[0];
          updates.push({ personKey: memberName, expectedRevision: old?.revision ?? null });
        }
      }
    }
    const attendeeNames = [...new Set([...originalRoster.map(p => p.name), ...importedNames])];
    if (attendeeNames.length > 50 || updates.length > 50) throw new OutagePeopleError("An outage can have up to 50 attendees. Choose fewer members.");
    if (attendeeNames.length !== originalRoster.length) {
      await client.query("UPDATE maintenance_outages SET attendees=$2::jsonb,updated_at=now() WHERE task_id=$1", [root.id, JSON.stringify(attendeeNames)]);
      await client.query("UPDATE tasks SET updated_at=now() WHERE id=$1", [root.id]);
      root.attendees = attendeeNames;
    }
    await client.query("INSERT INTO outage_people_teams(task_id,name) VALUES($1,$2) ON CONFLICT DO NOTHING", [root.id, name]);
    if (updates.length) return change(client, root, { mutationId: input.mutationId, field: "team", value: name, linkedTaskId: null, updates, ...(input.reporterName ? { reporterName: input.reporterName } : {}) }, actor, input);
  }
  await client.query("INSERT INTO outage_people_mutations(task_id,mutation_id,actor_key,request_hash) VALUES($1,$2,$3,$4)", [root.id, input.mutationId, actor.key, saved.hash]);
  return [];
}
function parseCommand(input: unknown, shared = false) {
  if (input && typeof input === "object" && "operation" in input && input.operation === "person-details") return parsePeopleDetailsChange(input, shared);
  return input && typeof input === "object" && "operation" in input ? parsePeopleTeamChange(input, shared) : parsePeopleChange(input, shared);
}
function applyCommand(client: PoolClient, root: Root, input: Command, actor: Actor) {
  if ("operation" in input && input.operation === "person-details") return detailsChange(client, root, input, actor);
  return "operation" in input ? teamChange(client, root, input, actor) : change(client, root, input, actor);
}

export async function authenticatedOutagePeople(user: TaskboardUserIdentity, taskId: string, input?: unknown, explicitBoardId?: string | null) {
  await ensureDatabaseReady();
  const pool = getPool();
  if (!pool) throw new OutagePeopleError("Persistence is unavailable.", 503);
  const client = await pool.connect(), write = input !== undefined;
  try {
    await client.query(write ? "BEGIN" : "BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query("SET LOCAL statement_timeout='5s'");
    // Read an already authenticated user; polling never provisions or rewrites profiles.
    const account = (await client.query<{ id: string; display_name: string; role: "admin" | "standard"; is_disabled: boolean }>(`SELECT id,display_name,role,is_disabled FROM users WHERE id=$1 ${write ? "FOR SHARE" : ""}`, [user.id ?? null])).rows[0];
    if (!account || account.is_disabled || user.isDisabled) throw new OutagePeopleError("Taskboard access is required.", 403);
    const root = await outage(client, taskId, write);
    if (explicitBoardId !== undefined && explicitBoardId !== root.board_id) throw new OutagePeopleError("This outage is outside the selected board.", 403);
    const board = await getBoardRowById(client, root.board_id);
    if (!board) throw new OutagePeopleError("This board is unavailable.", 404);
    const access = await resolveEffectiveBoardAccess(client, { ...user, id: account.id, displayName: account.display_name, role: account.role }, board);
    assertBoardAccess(access, write ? "edit" : "read");
    const applied = write ? await applyCommand(client, root, parseCommand(input), { key: account.id, name: account.display_name, verified: true, admin: account.role === "admin" }) : undefined;
    const data = await snapshot(client, root, access.canEdit, account.display_name, false);
    await client.query("COMMIT");
    return { ...data, ...(applied ? { applied: applied.filter(entry => data.people.some(p => p.key === entry.personKey)) } : {}) };
  } catch (error) {
    await client.query("ROLLBACK");
    if (error && typeof error === "object" && "code" in error && ["40P01", "40001"].includes(String(error.code))) throw new OutagePeopleError("The outage changed while saving. Reload and try again.", 409);
    throw error;
  } finally { client.release(); }
}
export async function publicOutagePeople(token: string) {
  return withPublicTaskRead(token, async (client, share) => {
    const root = await outage(client, share.task_id, false);
    return snapshot(client, root, share.access_mode === "edit_work", "", true);
  });
}
export async function updatePublicOutagePeople(token: string, raw: unknown) {
  const release = reservePublicTaskWriter();
  try {
    if (!await admitPublicTaskEdit(token)) throw new OutagePeopleError("Too many updates. Try again shortly.", 429);
    const input = parseCommand(raw, true);
    const applied = await withPublicTaskEdit(token, async (client, share) => {
      const root = await outage(client, share.task_id, true);
      const applied = await applyCommand(client, root, input, { key: share.id, name: input.reporterName!, verified: false });
      const valid = await client.query("SELECT id FROM task_public_shares WHERE id=$1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>clock_timestamp())", [share.id]);
      if (!valid.rowCount) throw new TaskShareUnavailable();
      return applied;
    });
    // A revoked/expired share must not return data even after its save committed.
    const data = await publicOutagePeople(token);
    return { ...data, applied: applied.filter(entry => data.people.some(p => p.key === entry.personKey)) };
  } finally { release(); }
}
