import type { PoolClient } from "pg";

export const outagePeopleSchema = `
CREATE TABLE IF NOT EXISTS outage_people_details (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  person_key TEXT NOT NULL,
  travel JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(travel)='object' AND octet_length(travel::text)<=4096),
  discussed_day TEXT NOT NULL DEFAULT '',
  revision UUID NOT NULL,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  reporter_name TEXT NOT NULL,
  reporter_verified BOOLEAN NOT NULL,
  PRIMARY KEY(task_id,person_key)
);
CREATE TABLE IF NOT EXISTS outage_people_teams (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(task_id,name)
);
CREATE TABLE IF NOT EXISTS outage_people_fields (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  person_key TEXT NOT NULL,
  field TEXT NOT NULL CHECK (field IN ('team','location','activity')),
  value TEXT NOT NULL DEFAULT '',
  linked_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  is_linked BOOLEAN NOT NULL DEFAULT FALSE,
  revision UUID NOT NULL,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  reporter_name TEXT NOT NULL,
  reporter_verified BOOLEAN NOT NULL,
  PRIMARY KEY (task_id,person_key,field),
  CHECK (char_length(value) <= CASE field WHEN 'team' THEN 80 WHEN 'location' THEN 240 ELSE 1000 END),
  CHECK (NOT is_linked OR field='activity')
);
CREATE TABLE IF NOT EXISTS outage_people_history (
  id UUID PRIMARY KEY,
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  person_key TEXT NOT NULL,
  field TEXT NOT NULL CHECK (field IN ('team','location','activity')),
  value TEXT NOT NULL,
  linked_task_id UUID REFERENCES tasks(id) ON DELETE SET NULL,
  is_linked BOOLEAN NOT NULL DEFAULT FALSE,
  reported_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  reporter_name TEXT NOT NULL,
  reporter_verified BOOLEAN NOT NULL
);
CREATE INDEX IF NOT EXISTS outage_people_history_person_idx
  ON outage_people_history(task_id,person_key,reported_at DESC,id DESC);
CREATE TABLE IF NOT EXISTS outage_people_mutations (
  task_id UUID NOT NULL REFERENCES tasks(id) ON DELETE CASCADE,
  mutation_id UUID NOT NULL,
  actor_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  applied_revisions JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(task_id,mutation_id)
);
ALTER TABLE outage_people_mutations ADD COLUMN IF NOT EXISTS applied_revisions JSONB NOT NULL DEFAULT '[]'::jsonb;
`;
export async function ensureOutagePeopleSchema(client: PoolClient) {
  await client.query(outagePeopleSchema);
}
