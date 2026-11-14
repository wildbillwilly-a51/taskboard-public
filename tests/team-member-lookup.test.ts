import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const storeSource = readFileSync("src/lib/taskboard-store.ts", "utf8");
const routeSource = readFileSync(
  "src/app/api/teams/[teamId]/member-candidates/route.ts",
  "utf8",
);
const teamsPageSource = readFileSync("src/components/teams-page.tsx", "utf8");

function sourceBlock(start: string, end: string) {
  const startIndex = storeSource.indexOf(start);
  const endIndex = storeSource.indexOf(end, startIndex + start.length);

  assert.notEqual(startIndex, -1, `Missing source start: ${start}`);
  assert.notEqual(endIndex, -1, `Missing source end: ${end}`);

  return storeSource.slice(startIndex, endIndex);
}

test("team member candidate lookup is team-manager scoped and excludes non-addable users", () => {
  const lookupSource = sourceBlock(
    "export async function listTeamMemberCandidates",
    "export async function addTeamMember",
  );

  assert.match(lookupSource, /assertCanManageTeamMembers/);
  assert.match(lookupSource, /Search query must be at least 2 characters/);
  assert.match(lookupSource, /users\.is_disabled = FALSE/);
  assert.match(lookupSource, /team_members\.user_id IS NULL/);
  assert.match(lookupSource, /LIMIT 10/);
});

test("team member candidate results expose only safe display fields", () => {
  const lookupSource = sourceBlock(
    "function mapTeamMemberCandidateRow",
    "async function mapTeamBoardMemberGrantRow",
  );

  assert.match(lookupSource, /id: row\.id/);
  assert.match(lookupSource, /email: row\.email/);
  assert.match(lookupSource, /username: row\.username/);
  assert.match(lookupSource, /displayName: row\.display_name/);
  assert.doesNotMatch(lookupSource, /password/i);
  assert.doesNotMatch(lookupSource, /token/i);
  assert.doesNotMatch(lookupSource, /secret/i);
  assert.doesNotMatch(lookupSource, /auth_provider/i);
  assert.doesNotMatch(lookupSource, /local_password_hash/i);
});

test("member-candidates route is team scoped and returns candidates only", () => {
  assert.match(routeSource, /requireTaskboardUserFromHeaders/);
  assert.match(routeSource, /const \{ teamId \} = await context\.params/);
  assert.match(routeSource, /listTeamMemberCandidates\(user, teamId, q\)/);
  assert.match(routeSource, /candidates:/);
  assert.doesNotMatch(routeSource, /listAdminUsers/);
  assert.doesNotMatch(routeSource, /local_password_hash|password_hash|cookie|token|secret/i);
});

test("teams page lookup submits the selected candidate user id", () => {
  assert.match(teamsPageSource, /member-candidates\?q=/);
  assert.match(teamsPageSource, /selectedMemberCandidate\.id/);
  assert.match(teamsPageSource, /Search email, username, or name/);
  assert.doesNotMatch(teamsPageSource, /placeholder="User ID"/);
});
